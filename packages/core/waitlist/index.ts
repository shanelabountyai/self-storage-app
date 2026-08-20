// PRD 01 §9 Phase 3 (B-090 part 1). "Waitlists for sold-out unit types with
// notify-me."
//
// The rules, with no database and no clock of their own, so the one decision
// that actually matters here is testable: **how many people get told about a
// unit that just became free.**
//
// Everything else in this feature is a form and a mail. This is the part with
// a wrong answer: tell everybody, and eleven of twelve people drive to a
// facility to find the unit gone, which is worse than never writing to them.
// Tell one and say nothing more, and a prospect who has changed their mind
// blocks the queue indefinitely.

/// How long a notified prospect keeps their claim before the next person in
/// line is told.
///
/// 72 hours, and the number is a judgement rather than a measurement: it has
/// to span a weekend, because somebody who gets the mail on Friday evening
/// should still have their unit on Monday morning. Shorter and the list is
/// unfair to anybody who does not read mail daily; much longer and a free unit
/// sits unrentable while one person thinks about it.
///
/// A constant rather than a per-facility column, the position D-73 and D-74
/// both took: there is no usage to tune against, and a field configuring
/// behaviour ships with its control or does not ship.
export const CLAIM_WINDOW_HOURS = 72

export type WaitlistStatus = 'waiting' | 'notified' | 'expired' | 'cancelled'

/// How many waiting prospects may be notified right now.
///
/// **Availability minus the claims already outstanding**, never simply the
/// number of available units. A prospect notified an hour ago is holding a
/// moral claim on one of those units even though nothing in the database
/// reserves it — counting them is what stops the second sweep, ten minutes
/// later, telling the next person about the same unit.
///
/// Clamped at zero rather than allowed to go negative: more outstanding claims
/// than units means somebody's window has not expired yet and units were taken
/// in the meantime, which is a legitimate state and not an error.
export function notifiableCount(
  availableUnits: number,
  outstandingClaims: number,
  waitingCount: number,
): number {
  return Math.max(0, Math.min(availableUnits - outstandingClaims, waitingCount))
}

/// Whether a notified entry's claim window has elapsed.
export function claimExpired(notifiedAt: Date, now: Date, windowHours = CLAIM_WINDOW_HOURS): boolean {
  return now.getTime() - notifiedAt.getTime() >= windowHours * 3_600_000
}

/// Normalises an address for storage and for the "are you already on this
/// list" check. Matches the partial unique index, which is on `lower(email)` —
/// two spellings of one address are one person, and they must not get two
/// mails about one unit.
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/// Deliberately permissive. This is a prospect handing us a way to reach them
/// about one unit, not an account being created: rejecting an address that
/// would in fact have worked costs a rental, and a typo costs one bounced mail
/// which the suppression list already handles. The real check is whether the
/// mail is delivered, and `Message` records that.
export function isPlausibleEmail(email: string): boolean {
  const trimmed = email.trim()
  return trimmed.length >= 5 && trimmed.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)
}

export type WaitlistPosition = {
  /// 1-based, among entries still waiting. Shown to the prospect so "you are
  /// on the list" is a fact rather than a reassurance.
  position: number
  total: number
}

/// Where an entry sits in the queue, FIFO by join time.
///
/// FIFO and not by any notion of value: the alternative is ranking prospects,
/// and a storage waitlist that quietly serves the person who looked at a more
/// expensive unit first is a thing you would have to disclose.
export function positionOf(
  entryId: string,
  waitingIdsOldestFirst: readonly string[],
): WaitlistPosition | null {
  const index = waitingIdsOldestFirst.indexOf(entryId)
  if (index === -1) return null
  return { position: index + 1, total: waitingIdsOldestFirst.length }
}
