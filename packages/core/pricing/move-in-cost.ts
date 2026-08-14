// PRD 01 US-301. What a renter would pay to move in today, itemized.
//
// This is deliberately the ONLY implementation. US-301 makes it a
// release-blocking defect for the total at unit selection to disagree with the
// total at checkout, so B-017's browse estimate and B-020's checkout stepper
// both call this. Zero I/O: callers read the effective rate, fee and tax rows
// and hand them over, which is also what makes it exhaustively testable.
//
// Everything is integer cents (CLAUDE.md). Nothing here rounds to dollars.

export type TaxRate = {
  /// "state", "city", "county" — shown per jurisdiction on an invoice later,
  /// so the estimate rounds per jurisdiction rather than on the total.
  jurisdiction: string
  rateBasisPoints: number
}

export type MoveInCostInput = {
  /// The rate for renting online — the one the renter will actually be charged.
  webRateCents: number
  /// The counter rate. Equal to the web rate when there is no online discount,
  /// and never rendered as a struck-through "saving" in that case.
  streetRateCents: number
  /// One-time, from the facility's effective fee schedule. Absent when the
  /// facility has no admin fee configured — which is different from zero only
  /// in that we do not render a $0.00 line.
  adminFeeCents?: number
  taxRates?: readonly TaxRate[]
  /// What a promotion takes off the FIRST period, in cents (positive).
  ///
  /// Added because the facility page advertised a discount and the checkout
  /// charged the undiscounted rate — the browse estimate applied a promotion
  /// this function had never heard of, so the two disagreed by exactly the
  /// discount. US-301 makes that a release-blocking defect, and it is only
  /// enforceable because there is one implementation; the fix is to teach the
  /// one implementation about promotions rather than to discount in two places.
  ///
  /// It reduces the taxable base as well as the total: tax is owed on what is
  /// actually charged, not on the price before a discount.
  promoDiscountCents?: number
  /// The promotion's plain-language terms, used as the line's label so the
  /// discount says which promotion it is rather than appearing as an unexplained
  /// credit (US-301).
  promoTerms?: string
}

export type CostLine = {
  key: string
  label: string
  amountCents: number
  /// Plain-language explanation of anything the number cannot say by itself.
  /// US-301: components not knowable before checkout are named and explained,
  /// never silently omitted.
  note?: string
}

export type MoveInCost = {
  lines: CostLine[]
  totalDueTodayCents: number
  /// What recurs. Rent plus tax on rent — not the admin fee, which is one-time,
  /// and not a protection plan, which is chosen at checkout.
  ongoingMonthlyCents: number
  /// street − web, floored at zero. Zero means "no discount", and the UI must
  /// then render one price with no strike-through: a struck-through price
  /// identical to the price charged is a fabricated discount (US-301).
  savingCents: number
}

/// Basis points of a cent-denominated base, rounded half-up to whole cents.
function taxOn(baseCents: number, rateBasisPoints: number): number {
  return Math.round((baseCents * rateBasisPoints) / 10_000)
}

export function calculateMoveInCost(input: MoveInCostInput): MoveInCost {
  const { webRateCents, streetRateCents, adminFeeCents, taxRates = [] } = input
  // Clamped: a promotion may not exceed the rent it discounts, and may never
  // turn a move-in into a payout.
  const promoDiscountCents = Math.min(Math.max(0, input.promoDiscountCents ?? 0), webRateCents)
  const discountedRentCents = webRateCents - promoDiscountCents

  // The taxable base is rent plus the admin fee. Texas treats self-storage as a
  // taxable service and the admin fee travels with it (D-10 makes Texas the
  // default, built per-state configurable). Per-component taxability — a state
  // that taxes rent but exempts fees, or exempts a protection plan — is
  // B-044's to model when it builds real invoices; getting it wrong here would
  // understate the estimate, and US-301's rule is that no fee may first appear
  // at the payment step.
  // ponytail: one taxable base for rent + admin fee; split per component when
  // a second state's rules actually require it.
  // Monthly is the STANDARD rate: a first-period promotion does not change what
  // recurs, and "then $X/mo" has to be the figure the tenant will actually keep
  // paying.
  const monthlyTaxableBase = webRateCents
  const todayTaxableBase = discountedRentCents + (adminFeeCents ?? 0)

  const taxToday = taxRates.reduce((sum, rate) => sum + taxOn(todayTaxableBase, rate.rateBasisPoints), 0)
  const taxMonthly = taxRates.reduce(
    (sum, rate) => sum + taxOn(monthlyTaxableBase, rate.rateBasisPoints),
    0,
  )

  const lines: CostLine[] = [
    {
      key: 'rent',
      label: 'First month rent',
      amountCents: webRateCents,
      note: 'If you move in part-way through a month, we charge only the days you use and the amount drops.',
    },
  ]

  if (promoDiscountCents > 0) {
    lines.push({
      key: 'promo',
      label: input.promoTerms ?? 'Promotion',
      amountCents: -promoDiscountCents,
      note: 'Applied to your first month only. After that you pay the standard rate.',
    })
  }

  if (adminFeeCents !== undefined && adminFeeCents > 0) {
    lines.push({
      key: 'admin',
      label: 'One-time admin fee',
      amountCents: adminFeeCents,
      note: 'Charged once, when you move in.',
    })
  }

  if (taxToday > 0) {
    lines.push({ key: 'tax', label: 'Tax', amountCents: taxToday })
  }

  // Named with a zero amount rather than left out. The renter must choose a
  // protection plan or show proof of their own cover, and discovering that at
  // the payment step is exactly the surprise US-301 forbids.
  lines.push({
    key: 'protection',
    label: 'Protection plan',
    amountCents: 0,
    note: 'You either choose a plan or show proof of your own cover — you pick at checkout, so it is not in this total yet.',
  })

  return {
    lines,
    totalDueTodayCents: discountedRentCents + (adminFeeCents ?? 0) + taxToday,
    ongoingMonthlyCents: webRateCents + taxMonthly,
    savingCents: Math.max(0, streetRateCents - webRateCents),
  }
}
