import { randomUUID } from 'node:crypto'
import { prisma } from '@storage/db'
import { gateHoursDecision } from '@storage/core/access'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { applyHardwareWebhookEvent, type HardwareWebhookPayload } from './webhook-handler'
import { signHardwarePayload } from './webhook-signature'
import { signingSecret } from './webhook-secrets'

// PRD 03 US-7. The mock gate-controller service: the "vendor side" of the
// simulation. A real keypad talks to a real vendor's cloud, which evaluates
// the code and calls our webhook; this plays that vendor's part so the whole
// loop runs with no hardware and no network dependency (AC1).

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type KeypadOutcome = {
  result: 'granted' | 'denied'
  reason: 'ok' | 'unknown_code' | 'inactive' | 'outside_hours'
  /// Whether the resulting event actually reached our webhook, or is sitting
  /// in the vendor's undelivered backlog (US-7 AC3's webhook-failure fault).
  delivered: boolean
  vendorEventId: string
}

/// `applyHardwareWebhookEvent` is called in-process rather than over a real
/// HTTP round trip to this app's own `/api/hardware/webhook`. The route is
/// still real and is what a genuine vendor integration would POST to
/// (B-085) — this just avoids the fragility of a server action self-fetching
/// its own origin in dev. The full signature is still generated and verified
/// through the same functions the route uses, so the security path FR-8 wants
/// exercised is exercised for real; only the transport is short-circuited.
// ponytail: in-process delivery, not a real self-fetch; revisit if a
// dev-server proxy ever makes a genuine loopback call cheap and reliable.
async function deliver(payload: HardwareWebhookPayload): Promise<void> {
  // B-080: the facility's ACTIVE secret, which is the one a real vendor would
  // have been given. Falls back to the environment secret at a site nobody has
  // rotated, so this behaves exactly as it did before rotation existed.
  const secret = await signingSecret(payload.facilityId)
  if (!secret) throw new Error('Hardware webhook secret unavailable')
  const body = JSON.stringify(payload)
  // Signed and then immediately re-verified via the same call the route makes
  // — see webhook-signature.test.ts for the direct coverage of this pair.
  signHardwarePayload(body, secret)
  await applyHardwareWebhookEvent(payload)
}

/// Someone at the gate enters a code. Evaluates it against the mock
/// controller's own database (`SimulatedGateCode` — the vendor's, never
/// ours), and attempts to deliver the resulting event through the signed
/// webhook path, respecting whatever fault injection is configured.
/// `at` is the moment somebody stood at the keypad. It defaults to now and is
/// only ever passed explicitly by tests — but it is a parameter rather than a
/// `Date.now()` buried in the window check, because "was the gate open then"
/// is the question this function answers and a caller has to be able to ask it
/// about 3am without waiting until 3am.
export async function evaluateKeypadEntry(
  facilityId: string,
  code: string,
  at: Date = new Date(),
): Promise<KeypadOutcome> {
  const config = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
  if (config?.latencyMs) await delay(config.latencyMs)

  const matches = await prisma.simulatedGateCode.findMany({ where: { facilityId, code } })
  const active = matches.find((row) => row.active)

  // US-4 AC2: "simulated keypad denies out-of-window attempts as
  // `denied: outside_hours`." Evaluated against the window the controller was
  // last PUSHED (`windowSchedule`), never against `Facility.gateHours` — see
  // the adapter's `set_time_window` case for why that distinction is the
  // whole design.
  //
  // The facility's timezone is read here rather than pushed, because a real
  // controller is physically at the facility and knows what time it is. What
  // it does not know, and has to be told, is the schedule.
  let outsideHours = false
  if (active && !active.windowExempt) {
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      select: { timezone: true },
    })
    const decision = gateHoursDecision(
      parseWeeklySchedule(active.windowSchedule),
      at,
      facility?.timezone ?? 'UTC',
    )
    outsideHours = !decision.open
  }

  const result: KeypadOutcome['result'] = active && !outsideHours ? 'granted' : 'denied'
  const reason: KeypadOutcome['reason'] = outsideHours
    ? 'outside_hours'
    : active
      ? 'ok'
      : matches.length > 0
        ? 'inactive'
        : 'unknown_code'

  const vendorEventId = randomUUID()
  const payload: HardwareWebhookPayload = {
    facilityId,
    vendorEventId,
    // The credential is named even on an out-of-hours denial: it is a known
    // tenant at the gate at the wrong time, which is a different fact from a
    // stranger trying numbers, and the flags downstream need to tell them
    // apart.
    credentialId: active?.credentialId ?? null,
    result,
    reason,
    occurredAt: at.toISOString(),
  }

  await prisma.simulatedVendorEvent.create({
    data: { facilityId, vendorEventId, payload: payload as never, delivered: false },
  })

  // Offline or webhook-failing: the gate itself still decides granted/denied
  // from its own local memory (a real standalone keypad does not stop working
  // because the network is down) — only reporting the event home fails.
  if (config?.offline || config?.webhookFailing) {
    return { result, reason, delivered: false, vendorEventId }
  }

  try {
    await deliver(payload)
  } catch {
    // B-086 part 2. An undelivered event is exactly the state above, and the
    // row is already in the backlog for `replayVendorEventBacklog` to retry —
    // so a delivery that fails for a reason nobody injected is reported the
    // same way rather than thrown.
    //
    // It used to throw, and the caller that made that matter is new: a
    // configuration gap (no `HARDWARE_WEBHOOK_SECRET`, which
    // `hardwareWebhookSecret()` refuses to invent under `NODE_ENV=production`)
    // turned into a 500 on the TENANT'S unlock button, on the screen whose
    // whole subject is somebody standing at a gate. The gate's decision and
    // reporting it home are different facts, and this function's own comment
    // three lines up already said so — the throw was the one path that did not
    // honour it.
    return { result, reason, delivered: false, vendorEventId }
  }

  await prisma.simulatedVendorEvent.update({
    where: { vendorEventId },
    data: { delivered: true },
  })

  return { result, reason, delivered: true, vendorEventId }
}

/// US-7 AC3's "event backlog replay". An explicit human action, so it tries
/// every undelivered event regardless of the current fault toggles — the
/// point of pressing this button is "attempt it now", not "attempt it only if
/// still convenient".
export async function replayVendorEventBacklog(facilityId: string): Promise<{ delivered: number }> {
  const pending = await prisma.simulatedVendorEvent.findMany({
    where: { facilityId, delivered: false },
    orderBy: { createdAt: 'asc' },
  })

  let delivered = 0
  for (const event of pending) {
    await deliver(event.payload as unknown as HardwareWebhookPayload)
    await prisma.simulatedVendorEvent.update({
      where: { id: event.id },
      data: { delivered: true },
    })
    delivered += 1
  }
  return { delivered }
}

export type SimulatorConfig = {
  offline: boolean
  latencyMs: number
  webhookFailing: boolean
}

export async function simulatorConfigFor(facilityId: string): Promise<SimulatorConfig> {
  const row = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
  return { offline: row?.offline ?? false, latencyMs: row?.latencyMs ?? 0, webhookFailing: row?.webhookFailing ?? false }
}

export async function setSimulatorConfig(facilityId: string, config: SimulatorConfig): Promise<void> {
  await prisma.gateSimulatorConfig.upsert({
    where: { facilityId },
    create: { facilityId, ...config },
    update: config,
  })
}
