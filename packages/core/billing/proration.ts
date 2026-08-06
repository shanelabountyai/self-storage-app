import { daysInPeriod, type BillingPeriod } from './periods.ts'

// PRD 02 US-18. The proration formula, written once.
//
// The documented formula, from the AC verbatim: "daily rate = monthly rate /
// days in billing period; rounding half-up to cents at line level."
//
// Rounding at LINE level, not at daily-rate level, and that distinction is the
// whole reason this is one function rather than a multiplication at four call
// sites. A daily rate rounded to cents first and then multiplied by 19 days
// carries the rounding error 19 times: $129.00 over 31 days is 4.16129…/day,
// rounded to 4.16 and multiplied out gives $79.04, where the correct answer is
// $79.06. Two cents per lease per move-out is not a rounding difference an
// auditor accepts, because it is systematically in the operator's favour.
//
// B-077's transfer wizard is specified to reuse this rather than build a
// second implementation — a transfer is a prorated move-out and a prorated
// move-in on the same day, so it calls this twice.

/// Rounds half-up to whole cents. `Math.round` rounds half toward +Infinity,
/// which for the non-negative amounts this handles is half-up; the explicit
/// guard is there so a negative amount (a credit) rounds half-up in magnitude
/// rather than toward zero, and does not silently disagree with the positive
/// case on a .5.
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

export type ProrationInput = {
  /// The full-period amount — rent, or a protection premium, which US-44 says
  /// prorates identically.
  monthlyCents: number
  period: BillingPeriod
  /// Inclusive first day charged. Clamped into the period.
  from: Date
  /// EXCLUSIVE last day charged, matching `BillingPeriod.end`. Clamped into
  /// the period.
  to: Date
}

export type ProrationResult = {
  amountCents: number
  /// Days actually charged, after clamping. Zero when the range does not
  /// overlap the period at all.
  days: number
  daysInPeriod: number
  /// Inclusive/exclusive day range as clamped — US-18's AC requires every
  /// prorated line to show the day range it charged, so the caller is handed
  /// the range rather than being trusted to recompute it.
  from: Date
  to: Date
}

/// Prorates a monthly amount across part of a billing period.
///
/// Clamps rather than rejects: a move-out date beyond the period end charges
/// through the end of the period, and a move-in before the period start
/// charges from the start. Callers routinely hold a date from a different
/// period (a notice given in advance, a backdated abandonment) and the useful
/// answer is "the part that falls inside this period", not an exception.
export function prorate(input: ProrationInput): ProrationResult {
  const { monthlyCents, period } = input
  const total = daysInPeriod(period)

  const from = new Date(
    Math.min(Math.max(input.from.getTime(), period.start.getTime()), period.end.getTime()),
  )
  const to = new Date(
    Math.min(Math.max(input.to.getTime(), from.getTime()), period.end.getTime()),
  )

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)

  // A full period is never routed through the division. Not an optimisation:
  // it guarantees the prorated amount for a complete period is EXACTLY the
  // monthly rate, with no chance of a rounding step making a full month bill
  // a cent under.
  if (days === total) {
    return { amountCents: monthlyCents, days, daysInPeriod: total, from, to }
  }

  return {
    amountCents: roundHalfUp((monthlyCents * days) / total),
    days,
    daysInPeriod: total,
    from,
    to,
  }
}

/// The refund side of a move-out: the part of an already-billed period the
/// tenant did NOT use.
///
/// Expressed as its own function rather than left to callers to subtract,
/// because "charged + refunded === the full period" must hold exactly, and two
/// independent roundings do not guarantee that. This subtracts the charged
/// amount from the whole, so the two always reconcile to the penny.
export function unusedRemainder(input: ProrationInput): ProrationResult {
  const used = prorate(input)
  return {
    amountCents: input.monthlyCents - used.amountCents,
    days: used.daysInPeriod - used.days,
    daysInPeriod: used.daysInPeriod,
    from: used.to,
    to: input.period.end,
  }
}

/// Human day range for an invoice line, e.g. "20 Aug – 1 Sep".
///
/// The `to` date is exclusive internally but a tenant reads a line as covering
/// days they occupied, so this renders the last day CHARGED — the day before
/// the exclusive end. US-18's AC ("every prorated line shows the day range")
/// is a promise to a person, not to the schema.
export function describeDayRange(from: Date, toExclusive: Date): string {
  const lastCharged = new Date(toExclusive.getTime() - 86_400_000)
  const format = (date: Date) =>
    new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
  return `${format(from)} – ${format(lastCharged)}`
}
