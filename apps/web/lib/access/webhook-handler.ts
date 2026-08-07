import { prisma } from '@storage/db'
import { flagsFor, REPEATED_DENIAL_WINDOW_MINUTES } from '@storage/core/access'

// PRD 03 FR-4. Turning a verified webhook payload into an AccessEvent, with
// US-5's anomaly flags computed as it lands. Assumes the caller has already
// verified the signature — same division of labour as B-019's Stripe
// reconciler: the route verifies, this applies.

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
///
/// US-5 AC3's flags are computed HERE, against the state of the world as the
/// event lands, and stored on the row. The alternative — deriving them when
/// the log is rendered — would let today's thresholds rewrite what the system
/// thought last March, and the flag is the thing a manager is later asked
/// about.
export async function applyHardwareWebhookEvent(payload: HardwareWebhookPayload): Promise<void> {
  const occurredAt = new Date(payload.occurredAt)

  const credential = payload.credentialId
    ? await prisma.accessCredential.findUnique({
        where: { id: payload.credentialId },
        select: { grant: { select: { state: true } } },
      })
    : null

  // The window ends at this event and includes it, so the fifth denial in
  // fifteen minutes is the one that flags — not the sixth.
  //
  // Scoped to the facility rather than the credential: five denials spread
  // across five different codes at one gate is a stranger working through
  // numbers, which is the more alarming version of this pattern and the one a
  // per-credential count would miss entirely.
  const recentDenials =
    payload.result === 'denied'
      ? (await prisma.accessEvent.count({
          where: {
            facilityId: payload.facilityId,
            result: 'denied',
            occurredAt: {
              gte: new Date(occurredAt.getTime() - REPEATED_DENIAL_WINDOW_MINUTES * 60_000),
              lte: occurredAt,
            },
          },
        })) + 1
      : 0

  const flags = flagsFor({
    result: payload.result,
    reason: payload.reason,
    credentialKnown: payload.credentialId !== null,
    grantState: credential?.grant.state ?? null,
    recentDenials,
  })

  await prisma.accessEvent.upsert({
    where: { vendorEventId: payload.vendorEventId },
    create: {
      facilityId: payload.facilityId,
      vendorEventId: payload.vendorEventId,
      credentialId: payload.credentialId,
      result: payload.result,
      reason: payload.reason,
      flags,
      occurredAt,
    },
    // A redelivery changes nothing — the row already reflects what happened,
    // flags included. Recomputing on redelivery would let a replayed backlog
    // (US-7 AC3) re-count its own denials and invent a `denied_repeated` that
    // never happened at the gate.
    update: {},
  })
}
