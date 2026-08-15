import { describeDayRange, prorate } from './proration.ts'
import { daysInPeriod, type BillingPeriod } from './periods.ts'

// PRD 02 US-17. What goes on a recurring invoice, and what it adds up to.
//
// Zero I/O, like every other core module: the caller reads the lease, the
// effective tax components and the facility policy and hands them over. That
// is what makes every boundary below testable without a database, and it is
// why the adapter cannot quietly compute a total of its own.

export type TaxRate = {
  jurisdiction: string
  rateBasisPoints: number
}

export type ChargeLine = {
  type: 'rent' | 'protection' | 'fee'
  description: string
  monthlyCents: number
  /// Whether this line is part of the taxable base.
  ///
  /// Texas taxes self-storage rent as a taxable service (D-10 makes Texas the
  /// default). A protection plan is not rent and is not taxed the same way, so
  /// the caller says so per line rather than this module assuming one base for
  /// everything — the assumption `calculateMoveInCost` had to make before real
  /// invoices existed, and flagged in its own comment as B-044's to model.
  taxable: boolean
}

export type InvoiceLine = {
  /// Mirrors `LineItemType` in the schema. `discount` is positive cents that
  /// the total subtracts — see `buildInvoice`.
  type: 'rent' | 'protection' | 'fee' | 'tax' | 'discount'
  description: string
  quantity: number
  unitAmountCents: number
  amountCents: number
}

export type BuildInvoiceInput = {
  period: BillingPeriod
  charges: readonly ChargeLine[]
  taxRates?: readonly TaxRate[]
  /// Charge only part of the period, inclusive/exclusive. Omit for a full
  /// period, which is the ordinary monthly case.
  prorateFrom?: Date
  prorateTo?: Date
  /// PRD 04 FR-PROMO-4 (B-070). Money off this period, in positive cents, from
  /// a promotion's snapshotted schedule.
  ///
  /// Capped at the charges — a discount larger than the bill would turn into a
  /// credit, and a promotion that pays a tenant is not a promotion.
  discountCents?: number
  /// What the tenant reads on the line. "First month free", "SPRING25".
  discountDescription?: string
  /// PRD 10 §5.5 (B-100). Further discounts that stack with the promotion
  /// above, each keeping its OWN line.
  ///
  /// A list rather than a second scalar, and separate lines rather than one
  /// merged figure, because §5.5 makes both an acceptance criterion: "the
  /// invoice shows two separate discount lines with distinct descriptions, not
  /// one merged figure." A tenant who was given a promotional rate AND earned
  /// a referral reward is owed an invoice that says so — merging them reads as
  /// one unexplained number and is the version somebody queries at the counter.
  ///
  /// They stack deliberately (§5.5): a promotion is a price the business
  /// advertises, a referral reward is payment for work a tenant did, and
  /// refusing to stack them means a friend referred during a "first month free"
  /// campaign earns nothing.
  extraDiscounts?: readonly { amountCents: number; description: string }[]
}

export type BuiltInvoice = {
  lines: InvoiceLine[]
  /// GROSS charges, before any discount. Kept gross deliberately: B-055's
  /// revenue report reads "billed" from the line items and "discounts given"
  /// separately, and netting them here would make a promotion invisible in the
  /// one report that exists to price it.
  subtotalCents: number
  /// Positive cents actually taken off, which may be less than asked for when
  /// the discount exceeded the charges.
  discountCents: number
  taxCents: number
  /// subtotal − discount + tax.
  totalCents: number
}

/// Basis points of a cent-denominated base, rounded half-up.
///
/// Applied per jurisdiction, not to a summed rate: a 6.25% state and a 2% city
/// rate on $129.00 are $8.06 and $2.58 — $10.64 — where a combined 8.25%
/// rounds to $10.64 as well here, but the two diverge on other bases, and it
/// is the per-jurisdiction figures a filing actually reports. Matches
/// `calculateMoveInCost`, deliberately: an estimate that rounds differently
/// from the invoice is US-301's release-blocking defect.
function taxOn(baseCents: number, rateBasisPoints: number): number {
  return Math.round((baseCents * rateBasisPoints) / 10_000)
}

export function buildInvoice(input: BuildInvoiceInput): BuiltInvoice {
  const { period, charges, taxRates = [] } = input
  const partial = input.prorateFrom !== undefined || input.prorateTo !== undefined
  const from = input.prorateFrom ?? period.start
  const to = input.prorateTo ?? period.end

  const lines: InvoiceLine[] = []
  let taxableBase = 0
  let subtotal = 0

  for (const charge of charges) {
    // A zero-amount charge is left off entirely rather than rendered as a
    // $0.00 line — a lease with no protection plan should not show one.
    if (charge.monthlyCents === 0) continue

    const result = prorate({ monthlyCents: charge.monthlyCents, period, from, to })
    if (result.amountCents === 0 && result.days === 0) continue

    const prorated = partial && result.days !== result.daysInPeriod
    lines.push({
      type: charge.type,
      description: prorated
        ? `${charge.description} (${describeDayRange(result.from, result.to)}, ${result.days} of ${result.daysInPeriod} days)`
        : charge.description,
      quantity: 1,
      unitAmountCents: result.amountCents,
      amountCents: result.amountCents,
    })

    subtotal += result.amountCents
    if (charge.taxable) taxableBase += result.amountCents
  }

  // The discount, before tax — and this ordering is the load-bearing part.
  //
  // Tax is owed on what the tenant is actually charged. Computing it on the
  // gross and then subtracting the discount would over-collect tax on money
  // nobody paid, which is not a rounding difference: it is collecting a state's
  // tax on a sale that did not happen, on every discounted invoice.
  // Each discount is capped by what is LEFT after the ones before it, so the
  // stack as a whole can never exceed the charges — §5.5's "the floor is zero,
  // never a credit". Capping each against the full subtotal independently
  // would let two $50 rewards take $100 off a $60 invoice.
  const requested: { amountCents: number; description: string }[] = []
  if ((input.discountCents ?? 0) > 0) {
    requested.push({
      amountCents: Math.floor(input.discountCents!),
      description: input.discountDescription?.trim() || 'Discount',
    })
  }
  for (const extra of input.extraDiscounts ?? []) {
    if (extra.amountCents > 0) {
      requested.push({
        amountCents: Math.floor(extra.amountCents),
        description: extra.description.trim() || 'Discount',
      })
    }
  }

  let discount = 0
  for (const one of requested) {
    const remaining = subtotal - discount
    if (remaining <= 0) break
    const applied = Math.min(Math.max(0, one.amountCents), remaining)
    if (applied === 0) continue
    lines.push({
      type: 'discount',
      description: one.description,
      quantity: 1,
      // Positive cents, subtracted from the total below rather than stored
      // negative. B-055's revenue report sums these as "given away", and a
      // negative here would report the discount as negative money given away.
      unitAmountCents: applied,
      amountCents: applied,
    })
    discount += applied
  }

  if (discount > 0) {
    // Taxable base shrinks by whatever share of the discount landed on taxable
    // charges. Capped at the base itself so a discount bigger than the taxable
    // rent cannot drive it negative and produce a tax credit.
    taxableBase = Math.max(0, taxableBase - Math.min(discount, taxableBase))
  }

  let taxTotal = 0
  for (const rate of taxRates) {
    const amount = taxOn(taxableBase, rate.rateBasisPoints)
    if (amount === 0) continue
    lines.push({
      type: 'tax',
      description: `${rate.jurisdiction} tax (${(rate.rateBasisPoints / 100).toFixed(2)}%)`,
      quantity: 1,
      unitAmountCents: amount,
      amountCents: amount,
    })
    taxTotal += amount
  }

  return {
    lines,
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: taxTotal,
    totalCents: subtotal - discount + taxTotal,
  }
}

/// Invoice numbers are per facility, sequential and gapless (US-17's AC).
///
/// Zero-padded so the series sorts the same lexicographically as numerically —
/// `number` is a string column, and `10` sorting before `9` in every list and
/// export is the kind of thing nobody notices until an auditor does. Widens
/// past six digits rather than truncating.
export function formatInvoiceNumber(sequence: number): string {
  return String(sequence).padStart(6, '0')
}

export { daysInPeriod }
