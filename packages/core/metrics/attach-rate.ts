// PRD 02 US-44 / §4.11's own AC: attach rate is reportable and has an owner.
// B-155 (operator review 2026-08-21). Dollars were already reported
// (`Lease.protectionCents` feeds revenue) and the ratio was not — a dollar
// figure cannot be coached against, a percentage can.

import { MOVE_SOURCES, type MoveSource } from './moves.ts'

/// One move-in, as this metric needs to see it. `staffId` is the staff member
/// who took the payment that completed the move-in — read from
/// `Payment.receivedByStaffId` (US-32), the session actor, never a form
/// field. Null for a move-in with no staff behind it (an online, self-service
/// checkout paid by card), reported as its own bucket rather than folded into
/// a real staffer's count.
export type AttachEvent = {
  enrolled: boolean
  channel: MoveSource
  staffId: string | null
}

export type AttachRateBucket = {
  moveIns: number
  enrolled: number
  /// enrolled ÷ moveIns, 0–1. Zero, not null, when moveIns is zero — an empty
  /// bucket has nothing to coach, and null would need a second check at every
  /// call site a real zero didn't.
  rate: number
}

/// Stands in for a null `staffId`. A real staff id is a cuid and can never
/// collide with it.
export const UNASSIGNED_STAFF = 'unassigned'

export type AttachRateResult = {
  overall: AttachRateBucket
  byChannel: Record<MoveSource, AttachRateBucket>
  /// Keyed by staffId, or `UNASSIGNED_STAFF`.
  byStaff: Record<string, AttachRateBucket>
}

function emptyBucket(): AttachRateBucket {
  return { moveIns: 0, enrolled: 0, rate: 0 }
}

function emptyByChannel(): Record<MoveSource, AttachRateBucket> {
  return Object.fromEntries(MOVE_SOURCES.map((source) => [source, emptyBucket()])) as Record<
    MoveSource,
    AttachRateBucket
  >
}

function addTo(bucket: AttachRateBucket, enrolled: boolean): void {
  bucket.moveIns += 1
  if (enrolled) bucket.enrolled += 1
}

function rateOf(bucket: AttachRateBucket): number {
  return bucket.moveIns === 0 ? 0 : bucket.enrolled / bucket.moveIns
}

function finalizeRates(result: AttachRateResult): AttachRateResult {
  result.overall.rate = rateOf(result.overall)
  for (const source of MOVE_SOURCES) result.byChannel[source].rate = rateOf(result.byChannel[source])
  for (const key of Object.keys(result.byStaff)) result.byStaff[key].rate = rateOf(result.byStaff[key])
  return result
}

/// Plan-enrolled leases ÷ new move-ins, overall and split by channel and by
/// staff member.
export function attachRate(events: readonly AttachEvent[]): AttachRateResult {
  const overall = emptyBucket()
  const byChannel = emptyByChannel()
  const byStaff: Record<string, AttachRateBucket> = {}

  for (const event of events) {
    addTo(overall, event.enrolled)
    addTo(byChannel[event.channel], event.enrolled)
    const staffKey = event.staffId ?? UNASSIGNED_STAFF
    byStaff[staffKey] ??= emptyBucket()
    addTo(byStaff[staffKey], event.enrolled)
  }

  return finalizeRates({ overall, byChannel, byStaff })
}

/// D-25: roll-ups sum the components and recompute the ratio, never average
/// the ratios — averaging a 100%-attach 2-lease month with a 10%-attach
/// 40-lease month as 55% would hide the site that actually needs coaching.
export function sumAttachRate(results: readonly AttachRateResult[]): AttachRateResult {
  const overall = emptyBucket()
  const byChannel = emptyByChannel()
  const byStaff: Record<string, AttachRateBucket> = {}

  for (const result of results) {
    overall.moveIns += result.overall.moveIns
    overall.enrolled += result.overall.enrolled
    for (const source of MOVE_SOURCES) {
      byChannel[source].moveIns += result.byChannel[source].moveIns
      byChannel[source].enrolled += result.byChannel[source].enrolled
    }
    for (const [staffId, bucket] of Object.entries(result.byStaff)) {
      byStaff[staffId] ??= emptyBucket()
      byStaff[staffId].moveIns += bucket.moveIns
      byStaff[staffId].enrolled += bucket.enrolled
    }
  }

  return finalizeRates({ overall, byChannel, byStaff })
}
