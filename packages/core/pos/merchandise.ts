// PRD 02 US-34 (B-078). Merchandise sale arithmetic and the COGS figure.
//
// Pure, for the same reason `tender.ts` and `drawer.ts` are: this decides
// what a customer is charged and what the margin report says, and both should
// be provable without a database.

export type SaleLineInput = {
  productId: string
  quantity: number
  unitPriceCents: number
  unitCostCents: number
  taxable: boolean
}

export type PricedLine = SaleLineInput & { lineTotalCents: number; lineCostCents: number }

export type SaleTotals = {
  lines: PricedLine[]
  subtotalCents: number
  /// Tax on the taxable lines only — US-34's "tax category" is per product,
  /// so a sale of a taxable lock and a non-taxable item is not one rate
  /// applied to the whole basket.
  taxCents: number
  totalCents: number
  /// The COGS snapshot: what these goods cost us.
  costCents: number
}

export type SaleProblem = 'no_lines' | 'quantity_not_positive' | 'price_negative' | 'insufficient_stock'

/// Rounds half-up to whole cents, matching `proration.ts`'s rule — one
/// rounding convention across the codebase, applied at line level.
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/// Prices a basket. `taxBasisPoints` is the facility's combined rate in
/// hundredths of a percent, the same unit `TaxComponent.rateBasisPoints`
/// uses — so the caller sums its components rather than this inventing a
/// second tax model.
export function priceSale(lines: readonly SaleLineInput[], taxBasisPoints: number): SaleTotals {
  const priced: PricedLine[] = lines.map((line) => ({
    ...line,
    lineTotalCents: line.unitPriceCents * line.quantity,
    lineCostCents: line.unitCostCents * line.quantity,
  }))

  const subtotalCents = priced.reduce((sum, line) => sum + line.lineTotalCents, 0)
  const taxableBase = priced
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum + line.lineTotalCents, 0)
  // Tax computed on the taxable subtotal once, not per line: rounding each
  // line's tax and summing drifts from the figure a customer would get by
  // applying the rate to what they see on the receipt.
  const taxCents = roundHalfUp((taxableBase * taxBasisPoints) / 10_000)

  return {
    lines: priced,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    costCents: priced.reduce((sum, line) => sum + line.lineCostCents, 0),
  }
}

/// Every reason a sale is refused, cheapest first.
export function saleProblem(
  lines: readonly (SaleLineInput & { stockCount: number })[],
): SaleProblem | null {
  if (lines.length === 0) return 'no_lines'
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return 'quantity_not_positive'
    if (line.unitPriceCents < 0 || line.unitCostCents < 0) return 'price_negative'
    // Refused rather than allowed to go negative: a stock count that can go
    // below zero is one nobody trusts, and the fix is a stock adjustment,
    // not a sale that pretends there was inventory.
    if (line.quantity > line.stockCount) return 'insufficient_stock'
  }
  return null
}

/// US-34's low-stock alert. Null threshold means the operator has opted out
/// for this product rather than wanting an alert at zero.
export function isLowStock(stockCount: number, lowStockAt: number | null): boolean {
  return lowStockAt !== null && stockCount <= lowStockAt
}

export type MarginRow = { revenueCents: number; costCents: number }

/// US-34's "simple COGS report": what it sold for, what it cost, and the
/// margin between. Null margin ratio when nothing sold — 0% margin reads as
/// selling at cost, and "no sales" is not that.
export function margin(rows: readonly MarginRow[]): {
  revenueCents: number
  costCents: number
  marginCents: number
  marginRatio: number | null
} {
  const revenueCents = rows.reduce((sum, row) => sum + row.revenueCents, 0)
  const costCents = rows.reduce((sum, row) => sum + row.costCents, 0)
  return {
    revenueCents,
    costCents,
    marginCents: revenueCents - costCents,
    marginRatio: revenueCents > 0 ? (revenueCents - costCents) / revenueCents : null,
  }
}
