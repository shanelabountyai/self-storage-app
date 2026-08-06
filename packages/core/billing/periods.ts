// PRD 02 US-17. What a billing period IS, before anything tries to invoice one.
//
// Two policies, per facility (D-27 makes `anniversary` the default):
//
//   anniversary    — periods run from the lease's own billing day to the same
//                    day next month. A tenant who moved in on the 20th is
//                    billed on the 20th, forever.
//   first_of_month — every lease at the facility bills on the 1st.
//
// Dates here are calendar dates with no time component, the same convention as
// `JobRun.businessDate`: a billing period is a range of DAYS a tenant occupies
// a unit, and attaching a timezone to it would imply an instant it does not
// have. Callers convert to and from facility-local business dates at the edge.

export const BILLING_POLICIES = ['anniversary', 'first_of_month'] as const
export type BillingPolicy = (typeof BILLING_POLICIES)[number]

export type BillingPeriod = {
  /// Inclusive. The day the period starts and the invoice is due.
  start: Date
  /// EXCLUSIVE — the first day of the NEXT period. Half-open, so consecutive
  /// periods tile the calendar with no day counted twice and no day missed,
  /// which is exactly the bug an inclusive end date produces on the boundary.
  end: Date
}

const DAY_MS = 86_400_000

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
}

/// The billing day a lease should use under a policy, given the day it starts.
///
/// Under `anniversary` this is the move-in day, which is what makes the
/// move-in payment a full period rather than a partial one. Clamped to 28
/// because a 29th/30th/31st billing day does not exist in every month — the
/// same reason the database constrains the column to 1–28.
export function billingDayFor(policy: BillingPolicy, startDate: Date): number {
  if (policy === 'first_of_month') return 1
  return Math.min(startDate.getUTCDate(), 28)
}

/// The period containing `date`.
///
/// `billingDay` is ignored under `first_of_month` — the policy is the
/// authority, not the column, so a facility that switches policy does not need
/// every lease rewritten before the next run is correct.
export function billingPeriodFor(
  policy: BillingPolicy,
  billingDay: number,
  date: Date,
): BillingPeriod {
  const day = policy === 'first_of_month' ? 1 : Math.min(Math.max(billingDay, 1), 28)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()

  // Before the billing day means we are still inside the period that started
  // last month.
  const startMonth = date.getUTCDate() >= day ? month : month - 1
  const start = utcDate(year, startMonth, day)
  return { start, end: utcDate(year, startMonth + 1, day) }
}

/// The period immediately after this one. `Date.UTC` normalises month 12 into
/// January of the next year, so no wrap-around arithmetic is needed.
export function nextBillingPeriod(period: BillingPeriod): BillingPeriod {
  const start = period.end
  return {
    start,
    end: utcDate(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
  }
}

/// Whole days in a period. The denominator of every proration, and the reason
/// US-18 says "days in the billing period" rather than 30: February bills 28
/// days and a day in it is worth more than a day in July.
export function daysInPeriod(period: BillingPeriod): number {
  return Math.round((period.end.getTime() - period.start.getTime()) / DAY_MS)
}

/// Period starts strictly after `after`, up to and including `through`.
///
/// This is what the nightly generator asks: "which periods begin in my
/// look-ahead window that I have not already billed?" `after` is the lease
/// start date, and excluding a period that starts on or before it is what
/// stops the nightly run re-billing the month the move-in payment already
/// covered — the checkout charged a full period beginning that very day.
export function periodStartsBetween(
  policy: BillingPolicy,
  billingDay: number,
  after: Date,
  through: Date,
  maxPeriods = 12,
): BillingPeriod[] {
  if (through.getTime() <= after.getTime()) return []

  const periods: BillingPeriod[] = []
  let period = billingPeriodFor(policy, billingDay, after)
  // Walk forward to the first period that starts strictly after `after`.
  while (period.start.getTime() <= after.getTime()) period = nextBillingPeriod(period)

  while (period.start.getTime() <= through.getTime() && periods.length < maxPeriods) {
    periods.push(period)
    period = nextBillingPeriod(period)
  }
  return periods
}
