// PRD 02 §4.6 US-28 (B-062). The proceeds waterfall.
//
// "Applied by the system in a fixed and stated order — reasonable sale costs →
// lien balance (rent, late fees, lien fees) → surplus — and posted as ledger
// entries against the lease, never typed in as a total."
//
// Both halves of that AC are the point. The ORDER is fixed here rather than
// left to whoever fills in the form, and the RESULT is a set of ledger
// postings rather than three numbers somebody typed — because a surplus figure
// typed into a box is a surplus figure that can be wrong in the direction that
// keeps money which is not ours.
//
// The identity this file guarantees:
//
//     costsRecoveredCents + appliedToLienCents + surplusCents === grossProceedsCents
//
// Every cent of what the sale raised is accounted to exactly one of the three
// buckets. `distribute` refuses to return otherwise.

export type WaterfallInput = {
  /// What the sale raised, before anything is taken out.
  grossProceedsCents: number
  /// Reasonable costs OF THE SALE — advertising, auctioneer, lock cutting.
  /// Not the tenant's arrears; those are the lien balance below.
  saleCostsCents: number
  /// What the lease owed at the moment of sale, before sale costs are added.
  lienBalanceCents: number
}

export type WaterfallResult = {
  /// Sale costs actually recovered from the proceeds. Less than
  /// `saleCostsCents` when the sale did not raise enough to cover them.
  costsRecoveredCents: number
  /// Applied against what the tenant owed.
  appliedToLienCents: number
  /// Owed BACK to the former tenant. A liability with a statutory life, not
  /// revenue — see surplus.ts.
  surplusCents: number
  /// What remains owed after the sale. Positive means the sale did not clear
  /// the debt; a deficiency does not vanish because the goods are gone.
  deficiencyCents: number
}

export class WaterfallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WaterfallError'
  }
}

/// Applies the waterfall. Pure, integer cents, total by construction.
export function distribute(input: WaterfallInput): WaterfallResult {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isInteger(value)) {
      throw new WaterfallError(`${name} must be an integer number of cents, got ${value}.`)
    }
    if (value < 0) {
      // A negative gross, cost or balance is a data-entry error, and silently
      // continuing would produce a "surplus" out of arithmetic rather than out
      // of money.
      throw new WaterfallError(`${name} cannot be negative.`)
    }
  }

  // 1. Sale costs, first and only up to what came in.
  const costsRecoveredCents = Math.min(input.saleCostsCents, input.grossProceedsCents)
  let remaining = input.grossProceedsCents - costsRecoveredCents

  // 2. The lien balance.
  const appliedToLienCents = Math.min(input.lienBalanceCents, remaining)
  remaining -= appliedToLienCents

  // 3. Whatever is left is the former tenant's.
  const surplusCents = remaining

  // What the sale failed to cover. Unrecovered sale costs count: they were
  // incurred on this lease's account and the tenant still owes them.
  const unrecoveredCosts = input.saleCostsCents - costsRecoveredCents
  const deficiencyCents = input.lienBalanceCents - appliedToLienCents + unrecoveredCosts

  const result = { costsRecoveredCents, appliedToLienCents, surplusCents, deficiencyCents }

  const accounted = costsRecoveredCents + appliedToLienCents + surplusCents
  if (accounted !== input.grossProceedsCents) {
    // Unreachable by construction, asserted anyway: money that fell out of the
    // waterfall is the failure this whole file exists to make impossible, and
    // it is one addition to check.
    throw new WaterfallError(
      `The waterfall did not account for every cent: ${accounted} distributed from ${input.grossProceedsCents}.`,
    )
  }
  if (surplusCents > 0 && deficiencyCents > 0) {
    throw new WaterfallError('A sale cannot produce both a surplus and a deficiency.')
  }

  return result
}

export type LedgerPosting = {
  /// Matches `LedgerEntryType`. Kept as a plain string so this module stays
  /// free of the database enum.
  type: 'charge' | 'payment'
  /// Signed cents, as the ledger stores them: charges positive, payments
  /// negative.
  amountCents: number
  description: string
}

/// The ledger entries a completed sale posts, in order.
///
/// This is the "posted as ledger entries against the lease, never typed in as a
/// total" half of the AC. The surplus is deliberately NOT among them: the
/// lease's balance is settled by the payment below, and the surplus is money
/// owed to a PERSON rather than to a closed lease. Posting it as a credit
/// against the lease would make it look discharged the moment it was recorded,
/// which is exactly how a surplus gets quietly retained.
export function ledgerPostings(input: WaterfallInput, result: WaterfallResult): LedgerPosting[] {
  const postings: LedgerPosting[] = []

  if (input.saleCostsCents > 0) {
    postings.push({
      type: 'charge',
      amountCents: input.saleCostsCents,
      description: 'Auction sale costs',
    })
  }

  const applied = result.costsRecoveredCents + result.appliedToLienCents
  if (applied > 0) {
    postings.push({
      type: 'payment',
      amountCents: -applied,
      description: 'Auction proceeds applied',
    })
  }

  return postings
}
