// PRD 02 US-39.2, §8. Economic occupancy and rate variance.

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
export function rateVariance(rows: readonly RateVarianceRow[]): RateVarianceRow[] {
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
