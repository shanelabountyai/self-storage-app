import { prisma } from '@storage/db'
import type { GateCommandType } from '@storage/db'
import { opensGate, windowFingerprint, type GrantState } from '@storage/core/access'
import { hashCode } from './secret'

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

/// One entry as the CONTROLLER holds it. B-080 added the read side of the port,
/// and reconciliation (FR-9) is the only reason it exists: a port that can only
/// write can tell you a command was accepted, never that the hardware still
/// agrees with you a month later.
///
/// `codeHash` rather than the code, always. A real vendor mostly will not
/// return a PIN at all, and the ones that would should not be asked — the diff
/// compares hashes and SR-1 keeps codes out of logs and screens either way.
export type ControllerEntry = {
  /// Null when the controller holds something we cannot match to a credential.
  /// The ghost-code case, and the finding that matters most.
  credentialId: string | null
  /// The vendor's own id, so a person can find the row in the vendor's portal.
  externalId: string
  codeHash: string | null
  opens: boolean
  /// Normalized by the adapter through `windowFingerprint`, so two adapters
  /// with different schedule shapes still produce comparable values.
  windowFingerprint: string | null
}

export type ControllerSnapshot =
  | { verifiable: true; entries: ControllerEntry[] }
  /// The manual adapter, and any vendor whose API cannot enumerate. Explicitly
  /// NOT the same as "no drift" — a screen that renders this as a clean bill of
  /// health is worse than one that shows nothing.
  | { verifiable: false; reason: string }

export type GateAdapter = {
  name: string
  send(command: GateCommandInput): Promise<AdapterResult>
  /// What the controller currently holds. Every adapter implements it; one that
  /// genuinely cannot read back returns `verifiable: false` rather than
  /// omitting the method, so a caller never has to ask whether it exists.
  snapshot(facilityId: string): Promise<ControllerSnapshot>
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
  snapshot: snapshotSimulatedController,
}

/// Reads back what the simulated controller holds (B-080, FR-9).
///
/// Reads `SimulatedGateCode` — the vendor's own database — and nothing of ours.
/// That is the whole point: a snapshot that consulted `AccessCredential` would
/// agree with us by construction and could never find a single drift, which is
/// the one way to make this feature useless while appearing to work.
export async function snapshotSimulatedController(facilityId: string): Promise<ControllerSnapshot> {
  const rows = await prisma.simulatedGateCode.findMany({ where: { facilityId } })

  const known = new Set(
    (
      await prisma.accessCredential.findMany({
        where: { facilityId },
        select: { id: true },
      })
    ).map((credential) => credential.id),
  )

  return {
    verifiable: true,
    entries: rows.map((row) => ({
      // A row whose credential no longer exists on our side is reported with a
      // null credentialId — a ghost — rather than silently attributed.
      credentialId: known.has(row.credentialId) ? row.credentialId : null,
      externalId: row.id,
      codeHash: hashCode(row.code),
      opens: row.active,
      windowFingerprint: windowFingerprint({
        schedule: row.windowSchedule,
        exempt: row.windowExempt,
      }),
    })),
  }
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
    async snapshot() {
      return { verifiable: false, reason: 'The scripted test adapter holds no state' }
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
    name: 'facility-configured',
    async send(command) {
      const config = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
      if (config?.offline) {
        return { ok: false, retryable: true, message: 'Gate controller is offline (simulated)' }
      }
      if (config?.latencyMs) await delay(config.latencyMs)
      return (await driverFor(facilityId)).send(command)
    },
    async snapshot() {
      // Fault injection applies here too, and it has to: a reconciliation run
      // against an offline controller must report "could not verify", never an
      // empty entry list — which would read as "the controller holds nothing"
      // and flag every credential at the site as missing.
      const config = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
      if (config?.offline) {
        return { verifiable: false, reason: 'Gate controller is offline (simulated)' }
      }
      return (await driverFor(facilityId)).snapshot(facilityId)
    },
  }
}

/// Which driver this facility's `gateAdapter` column selects.
///
/// `manual` is deliberately absent: B-027's drain checks `usesManualAdapter`
/// and parks the command as a task BEFORE it ever reaches an adapter, so a
/// manual facility never gets here to send. It does reach `snapshot` through
/// reconciliation, which is why the fallback answers "not verifiable" rather
/// than throwing — a site whose keypad is driven by a person with a clipboard
/// genuinely cannot be enumerated, and saying so is the honest report.
async function driverFor(facilityId: string): Promise<GateAdapter> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { gateAdapter: true },
  })

  if (facility?.gateAdapter === 'pti_cloud') {
    const { ptiCloudAdapter } = await import('./vendors/pti-cloud')
    return ptiCloudAdapter
  }
  if (facility?.gateAdapter === 'manual') {
    return {
      name: 'manual',
      async send() {
        return { ok: false, retryable: false, message: 'This facility is on the manual adapter' }
      },
      async snapshot() {
        return {
          verifiable: false,
          reason: 'This facility is on the manual adapter — there is nothing to read back from',
        }
      },
    }
  }
  return simulatedAdapter
}
