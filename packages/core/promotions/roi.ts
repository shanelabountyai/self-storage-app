import type { DiscountPeriod } from './schedule.ts'

// PRD 04 §3.2 US-4 (B-082 part 4). What a promotion actually cost, and what it
// bought.
//
// Two numbers that are routinely reported as one, and the difference is the
// whole point of the report:
//
//   * COMMITTED is what the promotion promised away at redemption —
//     `PromoRedemption.totalCents`, the sum of the schedule.
//   * REALISED is what has actually come off an invoice — the schedule entries
//     whose `periodIndex` is in `appliedPeriods`, which billing appends as it
//     writes each line.
//
// A "first month free, then 50% off for two" promo commits three periods on the
// day it is redeemed. A tenant who moves out after five weeks realises one. An
// ROI report quoting the committed figure overstates the cost of every promo
// with a short tenancy, and one quoting only the realised figure understates
// the exposure of every promo still running. Both are true; neither alone is.
//
// Pure, and the arithmetic is here rather than in the query so it can be tested
// without a database and cannot differ between the report and any later caller.

export type RedemptionCost = {
  committedCents: number
  realisedCents: number
  /// Committed but not yet discounted — what this promotion still owes, which
  /// is the number that moves when a tenant leaves early.
  outstandingCents: number
}

/// The cost of one redemption.
///
/// `periods` comes back from the database as JSON, so it is validated rather
/// than trusted: a malformed entry contributes nothing instead of `NaN`, which
/// would otherwise poison the whole report's total with no indication which row
/// did it.
export function redemptionCost(
  periods: readonly DiscountPeriod[],
  appliedPeriods: readonly number[],
  /// The denormalised total, which billing does NOT recompute. Used as the
  /// committed figure so this function agrees with `PromoRedemption.totalCents`
  /// rather than offering a second opinion about it — see the note below.
  totalCents: number,
): RedemptionCost {
  const applied = new Set(appliedPeriods)
  const realisedCents = periods
    .filter((period) => Number.isFinite(period?.amountCents) && applied.has(period?.periodIndex))
    .reduce((sum, period) => sum + period.amountCents, 0)

  return {
    committedCents: totalCents,
    realisedCents,
    // Clamped at zero. Realised should never exceed committed, but if billing
    // ever applied a period that is not in the schedule, a negative
    // "outstanding" would read as the promotion having earned money back.
    outstandingCents: Math.max(0, totalCents - realisedCents),
  }
}

export type PromotionRoi = {
  promotionId: string
  name: string
  /// Redemptions in range. Not the same as `Promotion.redemptionCount`, which
  /// is lifetime and is a claim counter rather than a report.
  redemptions: number
  /// Redemptions that reached a lease. A redemption attached to a reservation
  /// that was never converted cost nothing and bought nothing.
  moveIns: number
  /// Of those move-ins, how many are still renting today.
  stillRenting: number
  committedCents: number
  realisedCents: number
  outstandingCents: number
  /// Monthly rent, at today's rate, across the leases still renting. The
  /// recurring revenue the discount is still buying.
  monthlyRentCents: number
}

/// Months of rent it takes to earn back what a promotion realised.
///
/// The single number an operator acts on: "this promo gives away six weeks of
/// rent and the tenants stay eleven months" is a decision, while "we discounted
/// $4,300" is a fact with no verdict attached.
///
/// Null rather than Infinity when nothing is still renting — a promotion whose
/// tenants have all left has no payback period, and rendering "∞ months" in a
/// table invites somebody to read it as a very large number rather than as
/// "this did not work".
export function paybackMonths(roi: PromotionRoi): number | null {
  if (roi.monthlyRentCents <= 0) return null
  if (roi.realisedCents <= 0) return 0
  return roi.realisedCents / roi.monthlyRentCents
}

/// Totals across every promotion in the report.
///
/// Summed from the same rows the table renders rather than queried separately:
/// a footer that disagrees with the column above it is the classic report bug,
/// and the only way it cannot happen is for there to be one source.
export function roiTotals(rows: readonly PromotionRoi[]): {
  redemptions: number
  moveIns: number
  stillRenting: number
  committedCents: number
  realisedCents: number
  outstandingCents: number
  monthlyRentCents: number
} {
  return rows.reduce(
    (total, row) => ({
      redemptions: total.redemptions + row.redemptions,
      moveIns: total.moveIns + row.moveIns,
      stillRenting: total.stillRenting + row.stillRenting,
      committedCents: total.committedCents + row.committedCents,
      realisedCents: total.realisedCents + row.realisedCents,
      outstandingCents: total.outstandingCents + row.outstandingCents,
      monthlyRentCents: total.monthlyRentCents + row.monthlyRentCents,
    }),
    {
      redemptions: 0,
      moveIns: 0,
      stillRenting: 0,
      committedCents: 0,
      realisedCents: 0,
      outstandingCents: 0,
      monthlyRentCents: 0,
    },
  )
}
