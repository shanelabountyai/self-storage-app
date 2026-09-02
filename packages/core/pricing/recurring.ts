import type { TaxRate } from './move-in-cost.ts'

// B-227 / PRD 01 US-601, US-704, US-301. What a lease actually charges every
// month.
//
// **Three screens computed this independently and all three were wrong**, each
// in its own way, and the invoice that arrived agreed with none of them:
//
//   - the portal dashboard summed `monthlyRateCents + protectionCents`
//   - `/portal/methods` made the identical sum into "We charge $155.00 on day 1"
//   - checkout's autopay disclosure used `ongoingMonthlyCents`, which is rent
//     plus tax and NO protection, because at checkout the plan is not chosen yet
//
// Rent is taxable and protection is not (`invoices.ts` `chargesFor`, and Texas
// taxes self-storage as a taxable service). So the real charge is rent + tax on
// rent + protection, and the portal's figure was LOWER than the one the renter
// authorised. "You said $155 and took $167.36" is a disputed autopay charge,
// and `/portal/methods` is the screen that gets screenshotted.
//
// D-11a permits a default-on autopay enrolment only with an adjacent, accurate
// disclosure. A disclosure that understates the amount is not one.
//
// Zero I/O, like `calculateMoveInCost` and for the same reason: callers read
// the rate, the premium and the facility's tax rows and hand them over, which
// is what makes it exhaustively testable. It reckons tax exactly as
// `calculateMoveInCost` does for the monthly figure — per jurisdiction, rounded
// half-up per jurisdiction rather than on the total — so the two cannot drift.

export type RecurringInput = {
  /// The lease's own rate. NOT a street or web rate: after move-in the only
  /// rate that means anything is the one on the lease, which a rate increase
  /// moves independently of the unit type's published price.
  monthlyRateCents: number
  /// The protection premium, or zero where the tenant showed proof of their own
  /// cover. Untaxed — a protection plan is not rent.
  protectionCents: number
  taxRates?: readonly TaxRate[]
}

export type RecurringCharge = {
  rentCents: number
  taxCents: number
  protectionCents: number
  /// What the invoice will total. The one figure any screen should print.
  totalCents: number
}

/// Basis points of a cent-denominated base, rounded half-up to whole cents.
///
/// Duplicated from `move-in-cost.ts` rather than exported from it, deliberately
/// — it is three tokens of arithmetic, and the alternative is widening that
/// module's public surface so a second module can borrow a private helper.
function taxOn(baseCents: number, rateBasisPoints: number): number {
  return Math.round((baseCents * rateBasisPoints) / 10_000)
}

export function monthlyRecurring(input: RecurringInput): RecurringCharge {
  const { monthlyRateCents, protectionCents, taxRates = [] } = input
  const taxCents = taxRates.reduce(
    (sum, rate) => sum + taxOn(monthlyRateCents, rate.rateBasisPoints),
    0,
  )
  return {
    rentCents: monthlyRateCents,
    taxCents,
    protectionCents,
    totalCents: monthlyRateCents + taxCents + protectionCents,
  }
}

/// What the figure is made of, for the sentence beside it.
///
/// US-301 requires components be named rather than silently omitted, and this
/// row exists because a total nobody could decompose was wrong for months
/// without anybody noticing. The list is built from what is actually non-zero,
/// so a lease with no protection plan does not claim one and a facility with no
/// tax component does not print the word "tax" beside a figure containing none.
export function recurringParts(charge: RecurringCharge): string[] {
  return [
    'rent',
    ...(charge.taxCents > 0 ? ['tax'] : []),
    ...(charge.protectionCents > 0 ? ['your protection plan'] : []),
  ]
}

/// "rent, tax and your protection plan" — an Oxford-free list, because it is
/// read aloud beside a figure rather than parsed.
///
/// Here rather than in either page: both `/portal` and `/portal/methods` print
/// this sentence, and two copies of a joiner is how they end up phrasing the
/// same figure differently.
export function listParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
