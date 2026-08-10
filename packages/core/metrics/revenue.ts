// PRD 02 US-39.2/US-39.5, §8. Economic occupancy, rate variance, and the
// billed-vs-collected split.

import { allocatePayment, type AllocationCategory } from '../billing/allocation.ts'

export type UnitForPotential = {
  /// Effective status, used only to decide whether this unit is sellable
  /// inventory (see `isRentable` in occupancy.ts — same rule, same reason).
  rentable: boolean
  /// The unit type's current street rate. Gross potential is measured at
  /// street, never at web: the web rate is a discount we chose to offer, and
  /// measuring against it would hide exactly that discount.
  streetRateCents: number
}

export type EconomicOccupancyResult = {
  collectedCents: number
  grossPotentialCents: number
  /// collected ÷ gross potential, 0–1. Can exceed 1 in a month where arrears
  /// are collected on top of current rent — that is real and is not clamped,
  /// because clamping would hide a genuine catch-up month.
  ratio: number
}

/// US-39.2 / §4.11's metrics AC: **collected ÷ gross potential at street.**
///
/// Formula:
///   gross potential = sum(street rate) over every RENTABLE unit, for one month
///   collected       = rent actually collected in that month
///   economic occupancy = collected / gross potential
///
/// Two things this is deliberately not:
///   - Not in-place rent ÷ street rent. That measures discounting alone and
///     ignores vacancy and non-payment entirely, which is why a site can be
///     "97% economically occupied" with a third of its tenants not paying.
///   - Not measured against occupied units only. The denominator is every
///     unit that *could* have earned, which is what makes this the number
///     that catches vacancy and delinquency in one figure.
///
/// The caller supplies `collectedCents` for a specific period and units whose
/// street rates cover the same period. This function does no date maths — it
/// cannot see the period, so it cannot get it wrong on the caller's behalf.
export function economicOccupancy(
  collectedCents: number,
  units: readonly UnitForPotential[],
): EconomicOccupancyResult {
  const grossPotentialCents = units.reduce(
    (total, unit) => (unit.rentable ? total + unit.streetRateCents : total),
    0,
  )
  return {
    collectedCents,
    grossPotentialCents,
    ratio: grossPotentialCents === 0 ? 0 : collectedCents / grossPotentialCents,
  }
}

export function sumEconomicOccupancy(
  results: readonly EconomicOccupancyResult[],
): EconomicOccupancyResult {
  const collectedCents = results.reduce((total, r) => total + r.collectedCents, 0)
  const grossPotentialCents = results.reduce((total, r) => total + r.grossPotentialCents, 0)
  return {
    collectedCents,
    grossPotentialCents,
    ratio: grossPotentialCents === 0 ? 0 : collectedCents / grossPotentialCents,
  }
}

export type RateVarianceRow = {
  unitNumber: string
  unitTypeName: string
  inPlaceRateCents: number
  streetRateCents: number
  /// street − in-place. Positive means the tenant is paying BELOW street —
  /// the direction that represents money left on the table, and the one the
  /// Phase-2 rate-increase worklist sorts by.
  gapCents: number
  /// Months since this lease's rate last changed, or since it began. Null
  /// when unknown. A big gap on a lease raised last month is not actionable;
  /// the same gap on one untouched for two years is the whole worklist.
  monthsSinceLastChange: number | null
}

/// US-39.2's rate variance report, and §4.11's "rate variance is a report,
/// not a column": in-place vs current street per occupied unit, sorted by the
/// gap, largest first. Ties break on the longer-untouched lease, since that
/// is the one more likely to accept an increase without complaint.
/// Generic over the row so the Phase-2 rate-increase worklist (B-076) can
/// order ITS shape by the same definition rather than re-implementing the
/// comparator — §4.11's "one metrics definition layer" applies to an
/// ordering exactly as much as to a ratio. The report's own `RateVarianceRow`
/// satisfies the constraint unchanged.
export function rateVariance<T extends Pick<RateVarianceRow, 'gapCents' | 'monthsSinceLastChange'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (b.gapCents !== a.gapCents) return b.gapCents - a.gapCents
    return (b.monthsSinceLastChange ?? 0) - (a.monthsSinceLastChange ?? 0)
  })
}

/// Whole months between two instants, floored. Used for
/// `monthsSinceLastChange`; exported because the rent-roll screen shows the
/// same figure and must not compute its own.
export function wholeMonthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  // Not yet a full month if the day-of-month has not come round again.
  return to.getUTCDate() < from.getUTCDate() ? Math.max(0, months - 1) : Math.max(0, months)
}

// ── US-39.5: billed vs collected, by category (B-055) ────────────────────

/// The categories money is reported in. Deliberately the SAME four the
/// allocation order uses (`ALLOCATION_CATEGORIES`) rather than a reporting-only
/// list, because "how much rent did we collect" and "where did this payment go"
/// have to be the same question or the report cannot be reconciled against a
/// tenant's ledger.
///
/// US-39.5 also names "merchandise". There are no merchandise SKUs in the
/// system — POS sells nothing but payments today — so inventing an always-zero
/// column would suggest a number is being tracked when nothing produces it.
export const REVENUE_CATEGORIES = ['rent', 'fee', 'protection', 'tax'] as const
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number]

export type CategoryTotals = Record<RevenueCategory, number>

export function emptyCategoryTotals(): CategoryTotals {
  return { rent: 0, fee: 0, protection: 0, tax: 0 }
}

export function sumCategoryTotals(totals: readonly CategoryTotals[]): CategoryTotals {
  return totals.reduce((acc, one) => {
    for (const category of REVENUE_CATEGORIES) acc[category] += one[category]
    return acc
  }, emptyCategoryTotals())
}

export function categoryTotal(totals: CategoryTotals): number {
  return REVENUE_CATEGORIES.reduce((sum, category) => sum + totals[category], 0)
}

/// What an invoice charged, per category.
///
/// `discount` is excluded rather than negated into one of the four: a promo is
/// reported on its own line (US-39.5 asks for "discounts/promos given"), and
/// folding it into rent would make billed-rent understate what was actually
/// charged while hiding how much was given away.
export function billedByCategory(
  lines: readonly { type: string; amountCents: number }[],
): CategoryTotals {
  const totals = emptyCategoryTotals()
  for (const line of lines) {
    if ((REVENUE_CATEGORIES as readonly string[]).includes(line.type)) {
      totals[line.type as RevenueCategory] += line.amountCents
    }
  }
  return totals
}

/// How much of an invoice's paid amount each category received.
///
/// `Invoice` stores ONE paid total, not a paid amount per line, so this has to
/// be derived — and it is derived by replaying the facility's own allocation
/// order over the invoice's categories, not by splitting proportionally. That
/// matters: a $50 payment against an invoice of $10 tax + $90 rent pays the tax
/// in full and $40 of rent, because that is what `allocatePayment` actually did
/// with the money. A proportional split would report $5 tax and $45 rent —
/// tidier, and disagreeing with the tenant's own ledger.
///
/// Reuses `allocatePayment` rather than restating the rule, so a facility that
/// reorders its categories gets a report that follows.
export function collectedByCategory(
  gross: CategoryTotals,
  paidCents: number,
  order?: readonly AllocationCategory[],
): CategoryTotals {
  const totals = emptyCategoryTotals()
  if (paidCents <= 0) return totals

  const anyGross = REVENUE_CATEGORIES.some((category) => gross[category] > 0)
  if (!anyGross) {
    // Paid money against an invoice with no categorised lines. Reported as
    // rent rather than dropped, matching `claimsFor`'s own fallback — money in
    // a slightly wrong bucket beats money that vanishes from the report.
    totals.rent = paidCents
    return totals
  }

  const epoch = new Date(0)
  const result = allocatePayment(
    paidCents,
    REVENUE_CATEGORIES.filter((category) => gross[category] > 0).map((category) => ({
      invoiceId: 'one',
      category: category as AllocationCategory,
      outstandingCents: gross[category],
      dueDate: epoch,
    })),
    order,
  )
  for (const line of result.lines) totals[line.category as RevenueCategory] += line.amountCents
  // Paid more than the categorised lines add up to — possible when a discount
  // line made the invoice total smaller than its gross. The excess is real
  // money and belongs somewhere it can be seen.
  totals.rent += result.unappliedCents
  return totals
}
