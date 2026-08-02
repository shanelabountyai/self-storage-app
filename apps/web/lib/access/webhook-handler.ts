import { prisma } from '@storage/db'

// PRD 03 FR-4 (minimal slice). Turning a verified webhook payload into an
// AccessEvent. Assumes the caller has already verified the signature — same
// division of labour as B-019's Stripe reconciler: the route verifies, this
// applies.

export type HardwareWebhookPayload = {
  facilityId: string
  vendorEventId: string
  credentialId: string | null
  result: 'granted' | 'denied'
  reason: string
  occurredAt: string
}

/// Idempotent by `vendorEventId` (FR-4: "dedup by (facilityId, vendorEventId)").
/// A redelivered webhook — the mock vendor replaying its backlog, or a real
/// vendor retrying a non-2xx — must log the gate event once, not twice.
export async function applyHardwareWebhookEvent(payload: HardwareWebhookPayload): Promise<void> {
  await prisma.accessEvent.upsert({
    where: { vendorEventId: payload.vendorEventId },
    create: {
      facilityId: payload.facilityId,
      vendorEventId: payload.vendorEventId,
      credentialId: payload.credentialId,
      result: payload.result,
      reason: payload.reason,
      occurredAt: new Date(payload.occurredAt),
    },
    // A redelivery changes nothing — the row already reflects what happened.
    update: {},
  })
}
