import { prisma } from '@storage/db'
import type { GateCommandType } from '@storage/db'
import { opensGate, type GrantState } from '@storage/core/access'

// PRD 03 §4.1 / FR-3. The port every gate controller sits behind.
//
// CLAUDE.md: gate hardware runs against the simulated adapter — never assume a
// real vendor API. D-4 settled the same posture for undecided vendors: define
// the contract, ship something real behind it, and write the first driver when
// there is a controller on a bench.

export type GateCommandInput = {
  type: GateCommandType
  facilityId: string
  grantId: string | null
  credentialId: string | null
  /// Opaque to the port itself — the code, the zone, whatever a real vendor
  /// needs. Never the plaintext PIN in a log.
  payload: Record<string, unknown>
}

export type AdapterResult =
  | { ok: true }
  /// Retry me. A controller that is offline, slow, or rate-limiting.
  | { ok: false; retryable: true; message: string }
  /// Do not retry. A rejected code, an unknown zone — retrying will fail
  /// identically and only delays the staff alert that is the real fix.
  | { ok: false; retryable: false; message: string }

export type GateAdapter = {
  name: string
  send(command: GateCommandInput): Promise<AdapterResult>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/// The state mutation a real vendor would perform on receiving each command
/// type — applied here against `SimulatedGateCode`, which plays the vendor's
/// own database (see the model's comment: we never store the plaintext, so the
/// simulator has to keep it somewhere that is honestly not `AccessCredential`).
async function applyToSimulatedController(command: GateCommandInput): Promise<AdapterResult> {
  switch (command.type) {
    case 'set_credential': {
      const code = command.payload.code
      if (typeof code !== 'string' || !command.credentialId) {
        return { ok: false, retryable: false, message: 'set_credential requires a credentialId and a code' }
      }
      const credential = await prisma.accessCredential.findUnique({
        where: { id: command.credentialId },
        select: { grant: { select: { state: true } } },
      })
      if (!credential) return { ok: false, retryable: false, message: 'Unknown credential' }

      await prisma.simulatedGateCode.upsert({
        where: { credentialId: command.credentialId },
        create: {
          facilityId: command.facilityId,
          credentialId: command.credentialId,
          code,
          active: opensGate(credential.grant.state as GrantState),
        },
        update: { code, active: opensGate(credential.grant.state as GrantState) },
      })
      return { ok: true }
    }

    case 'grant_access':
    case 'resume_access':
    case 'suspend_access':
    case 'revoke_access': {
      if (!command.grantId) {
        return { ok: false, retryable: false, message: `${command.type} requires a grantId` }
      }
      const active = command.type === 'grant_access' || command.type === 'resume_access'
      const credentials = await prisma.accessCredential.findMany({
        where: { grantId: command.grantId },
        select: { id: true },
      })
      // Nothing to flip yet is not a failure — grant_access is issued before a
      // credential necessarily exists; set_credential will arrive active.
      if (credentials.length > 0) {
        await prisma.simulatedGateCode.updateMany({
          where: { credentialId: { in: credentials.map((c) => c.id) } },
          data: { active },
        })
      }
      return { ok: true }
    }

    case 'set_time_window': {
      // US-4 AC1: "changes propagate to all active grants via `setTimeWindow`."
      //
      // Written onto the CONTROLLER's rows, which is the point — a real vendor
      // enforces the window it was last told about. A simulator that instead
      // read `Facility.gateHours` at keypad time could never reproduce the one
      // failure this design has to be able to show: hours edited, command
      // dead-lettered, gate still running last week's schedule.
      if (!command.grantId) {
        return { ok: false, retryable: false, message: 'set_time_window requires a grantId' }
      }
      const credentials = await prisma.accessCredential.findMany({
        where: { grantId: command.grantId },
        select: { id: true },
      })
      if (credentials.length === 0) return { ok: true }

      await prisma.simulatedGateCode.updateMany({
        where: { credentialId: { in: credentials.map((c) => c.id) } },
        data: {
          windowSchedule: (command.payload.schedule ?? null) as never,
          windowExempt: command.payload.extendedHours === true,
        },
      })
      return { ok: true }
    }

    default:
      return { ok: false, retryable: false, message: `Unhandled command type: ${command.type}` }
  }
}

/// The zero-fault adapter: applies the command with no offline/latency
/// simulation. What tests use, and what `adapterFor` wraps with the
/// per-facility fault configuration below.
export const simulatedAdapter: GateAdapter = {
  name: 'simulated',
  send: applyToSimulatedController,
}

/// For tests and for the "what happens when the car park is offline" drill.
export function scriptedAdapter(results: AdapterResult[]): GateAdapter {
  let index = 0
  return {
    name: 'scripted',
    async send() {
      const result = results[Math.min(index, results.length - 1)]
      index += 1
      return result
    },
  }
}

/// Per-facility adapter selection (FR-3), wrapped with US-7 AC3's fault
/// injection: `offline` fails every command retryable — without touching
/// controller state — so B-027's existing retry/backoff/dead-letter path is
/// exercised for real from a UI toggle rather than reimplemented here.
/// `latencyMs` delays a successful send, to demonstrate that nothing in the
/// checkout or provisioning path blocks on it (B-026/B-027 already made that
/// true; this is where you go to watch it stay true).
export function adapterFor(facilityId: string): GateAdapter {
  return {
    name: 'simulated',
    async send(command) {
      const config = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
      if (config?.offline) {
        return { ok: false, retryable: true, message: 'Gate controller is offline (simulated)' }
      }
      if (config?.latencyMs) await delay(config.latencyMs)
      return applyToSimulatedController(command)
    },
  }
}
