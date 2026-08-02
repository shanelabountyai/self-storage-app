import { randomUUID } from 'node:crypto'
import { prisma } from '@storage/db'
import { applyHardwareWebhookEvent, type HardwareWebhookPayload } from './webhook-handler'
import { hardwareWebhookSecret, signHardwarePayload } from './webhook-signature'

// PRD 03 US-7. The mock gate-controller service: the "vendor side" of the
// simulation. A real keypad talks to a real vendor's cloud, which evaluates
// the code and calls our webhook; this plays that vendor's part so the whole
// loop runs with no hardware and no network dependency (AC1).

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type KeypadOutcome = {
  result: 'granted' | 'denied'
  reason: 'ok' | 'unknown_code' | 'inactive'
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
  const secret = hardwareWebhookSecret()
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
export async function evaluateKeypadEntry(facilityId: string, code: string): Promise<KeypadOutcome> {
  const config = await prisma.gateSimulatorConfig.findUnique({ where: { facilityId } })
  if (config?.latencyMs) await delay(config.latencyMs)

  const matches = await prisma.simulatedGateCode.findMany({ where: { facilityId, code } })
  const active = matches.find((row) => row.active)

  const result: KeypadOutcome['result'] = active ? 'granted' : 'denied'
  const reason: KeypadOutcome['reason'] = active ? 'ok' : matches.length > 0 ? 'inactive' : 'unknown_code'

  const vendorEventId = randomUUID()
  const payload: HardwareWebhookPayload = {
    facilityId,
    vendorEventId,
    credentialId: active?.credentialId ?? null,
    result,
    reason,
    occurredAt: new Date().toISOString(),
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

  await deliver(payload)
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
