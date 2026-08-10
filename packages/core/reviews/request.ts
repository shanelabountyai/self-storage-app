import { daysBetween } from '../jobs/schedule.ts'

// PRD 04 US-7 AC1 (B-071). "A review-request email sends automatically N days
// after move-in completion (default 7, configurable per facility)."

/// Whether a lease has reached its facility's review-request delay, as of
/// `businessDate` — both facility-local calendar days (`businessDateFor`'s
/// UTC-midnight shape), the same device `daysPastDue` uses.
///
/// `>=` rather than `===`: a job that catches up several missed nights, or a
/// facility that only just configured its Google review link, must still
/// raise every lease that has already cleared the delay — not only the one
/// whose exact day happens to be today.
export function reviewRequestDue(
  moveInBusinessDate: Date,
  delayDays: number,
  businessDate: Date,
): boolean {
  return daysBetween(moveInBusinessDate, businessDate) >= delayDays
}
