import { prisma } from '@storage/db'
import { businessDateFor } from '@storage/core/jobs'
import { reviewRequestDue } from '@storage/core/reviews'
import { emitEvent } from '@storage/core/events'

// PRD 04 US-7 AC1/AC2 (B-071). Raises the review-request event N days after
// move-in, once per tenancy.
//
// A per-facility scheduled job, not an event-driven wait: PRD 05's own comms
// engine reacts to events at the moment they happen, and "N days after X"
// needs something that ticks every night and asks "has enough time passed
// yet" — the same shape B-043's expiry scans and B-097's follow-up sweep
// already use for their own day-counted triggers.

export type ReviewRequestResult = { raised: number; skippedNoLink: boolean }

/// Raises `review.requested` for every lease that has cleared its facility's
/// delay and has never been asked. Stamps `Lease.reviewRequestSentAt` in the
/// SAME transaction as the emit — the outbox's own idempotency only dedupes an
/// event that already exists, so guaranteeing "once per tenancy" is this
/// producer's job, not the outbox's.
export async function raiseReviewRequests(
  facilityId: string,
  businessDate: Date,
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<ReviewRequestResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, googleReviewUrl: true, reviewRequestDelayDays: true },
  })

  // A review ask with nowhere to leave the review is worse than not asking.
  // Deliberately not stamped as sent: once the link is configured, the next
  // run's `reviewRequestDue` check (">=", not "===") catches every tenancy
  // that already cleared the delay while nobody had set one.
  if (!facility.googleReviewUrl) {
    recordItem?.({ itemId: facilityId, ok: true, message: 'skipped — no Google review link configured' })
    return { raised: 0, skippedNoLink: true }
  }

  // A loose SQL filter (never sent, cannot possibly be due yet is excluded by
  // definition since we only widen from here); the exact per-lease check
  // needs the facility's timezone and runs in JS below.
  const candidates = await prisma.lease.findMany({
    where: { facilityId, reviewRequestSentAt: null, startDate: { lte: businessDate } },
    select: { id: true, startDate: true },
  })

  let raised = 0
  for (const lease of candidates) {
    const moveInDay = businessDateFor(lease.startDate, facility.timezone)
    if (!reviewRequestDue(moveInDay, facility.reviewRequestDelayDays, businessDate)) continue

    const sent = await prisma.$transaction(async (tx) => {
      // Lost the race if another run already stamped this lease between the
      // read above and here — the update matches zero rows and this tx no-ops.
      const updated = await tx.lease.updateMany({
        where: { id: lease.id, reviewRequestSentAt: null },
        data: { reviewRequestSentAt: new Date() },
      })
      if (updated.count === 0) return false

      await emitEvent(
        { name: 'review.requested', entityType: 'Lease', entityId: lease.id, facilityId },
        tx,
      )
      return true
    })
    if (sent) raised += 1
  }

  recordItem?.({ itemId: facilityId, ok: true, message: `raised ${raised} review request${raised === 1 ? '' : 's'}` })
  return { raised, skippedNoLink: false }
}
