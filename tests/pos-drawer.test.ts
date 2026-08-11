import { describe, expect, it } from 'vitest'
import {
  closeProblem,
  depositSlip,
  expectedDrawer,
  isLowStock,
  margin,
  priceSale,
  saleProblem,
  varianceNeedsNote,
  varianceOf,
  type DrawerMovement,
} from '../packages/core/pos'

// B-078 / PRD 02 US-33 and US-34. The arithmetic somebody's job depends on
// being right, proved without fixtures.

const cash = (amountCents: number, changeCents = 0): DrawerMovement => ({
  method: 'cash',
  amountCents,
  changeCents,
})

describe('expectedDrawer', () => {
  it('is the float when nothing happened', () => {
    expect(expectedDrawer(20_000, [])).toEqual({ expectedCashCents: 20_000, expectedChecksCents: 0 })
  })

  it('adds cash taken', () => {
    expect(expectedDrawer(20_000, [cash(5_000)]).expectedCashCents).toBe(25_000)
  })

  it('counts the amount applied, not the note handed over', () => {
    // A $100 note against a $60 bill: the drawer is up $60, not $100.
    expect(expectedDrawer(0, [cash(6_000, 4_000)]).expectedCashCents).toBe(6_000)
  })

  it('takes cash refunds back out', () => {
    expect(expectedDrawer(20_000, [cash(5_000), cash(-2_000)]).expectedCashCents).toBe(23_000)
  })

  it('keeps cheques and money orders off the cash total', () => {
    const result = expectedDrawer(20_000, [
      { method: 'check', amountCents: 9_000 },
      { method: 'money_order', amountCents: 1_000 },
    ])
    expect(result.expectedCashCents).toBe(20_000)
    expect(result.expectedChecksCents).toBe(10_000)
  })

  it('IGNORES card entirely — it never touches the drawer', () => {
    // The single most common way a naive till reconciliation gets built
    // wrong: every drawer looks over by the day's card takings.
    const result = expectedDrawer(20_000, [{ method: 'card', amountCents: 50_000 }])
    expect(result.expectedCashCents).toBe(20_000)
    expect(result.expectedChecksCents).toBe(0)
  })

  it('ignores ACH too', () => {
    expect(expectedDrawer(0, [{ method: 'ach', amountCents: 9_900 }]).expectedCashCents).toBe(0)
  })
})

describe('varianceOf', () => {
  it('is positive when the drawer is over', () => {
    expect(varianceOf(25_100, 25_000)).toBe(100)
  })

  it('is negative when short', () => {
    expect(varianceOf(24_900, 25_000)).toBe(-100)
  })

  it('is zero when it balances', () => {
    expect(varianceOf(25_000, 25_000)).toBe(0)
  })
})

describe('varianceNeedsNote', () => {
  it('does not fire inside the threshold', () => {
    expect(varianceNeedsNote(300, 500)).toBe(false)
  })

  it('does not fire exactly at the threshold', () => {
    expect(varianceNeedsNote(500, 500)).toBe(false)
  })

  it('fires past it', () => {
    expect(varianceNeedsNote(501, 500)).toBe(true)
  })

  it('treats an overage exactly like a shortage', () => {
    // An overage usually means a payment was never recorded — the same
    // failure seen from the other side.
    expect(varianceNeedsNote(-800, 500)).toBe(true)
    expect(varianceNeedsNote(800, 500)).toBe(true)
  })

  it('demands a note for any variance at a zero threshold', () => {
    expect(varianceNeedsNote(1, 0)).toBe(true)
    expect(varianceNeedsNote(0, 0)).toBe(false)
  })
})

describe('closeProblem', () => {
  const base = {
    status: 'open' as const,
    countedCashCents: 25_000,
    countedChecksCents: 0,
    varianceCents: 0,
    thresholdCents: 500,
    note: '',
  }

  it('allows a balanced close with no note', () => {
    expect(closeProblem(base)).toBeNull()
  })

  it('allows a small variance with no note', () => {
    expect(closeProblem({ ...base, varianceCents: 200 })).toBeNull()
  })

  it('refuses a big variance with no note', () => {
    expect(closeProblem({ ...base, varianceCents: 2_000 })).toBe('note_required')
  })

  it('allows a big variance once explained', () => {
    expect(closeProblem({ ...base, varianceCents: 2_000, note: 'miscounted the twenties' })).toBeNull()
  })

  it('treats whitespace as no note', () => {
    expect(closeProblem({ ...base, varianceCents: 2_000, note: '   ' })).toBe('note_required')
  })

  it('refuses a negative count', () => {
    expect(closeProblem({ ...base, countedCashCents: -1 })).toBe('count_negative')
  })

  it('refuses to close an already-closed drawer', () => {
    expect(closeProblem({ ...base, status: 'closed' })).toBe('not_open')
  })
})

describe('depositSlip', () => {
  it('separates what was taken from what is banked', () => {
    const slip = depositSlip(20_000, [cash(6_000, 4_000), { method: 'check', amountCents: 9_000 }])
    expect(slip.openingFloatCents).toBe(20_000)
    expect(slip.cashTakenCents).toBe(6_000)
    // Reported, but already netted inside `cashTakenCents` — not subtracted
    // again from the expected total.
    expect(slip.changeGivenCents).toBe(4_000)
    expect(slip.checksCents).toBe(9_000)
    expect(slip.expectedCashCents).toBe(26_000)
    // The float stays in the till; only what is above it goes to the bank.
    expect(slip.depositCashCents).toBe(6_000)
  })

  it('reports cash refunds separately', () => {
    const slip = depositSlip(10_000, [cash(-2_500)])
    expect(slip.cashRefundedCents).toBe(2_500)
    expect(slip.expectedCashCents).toBe(7_500)
  })

  it('never reports a negative deposit', () => {
    // A drawer that went below its float is short, not owed money.
    expect(depositSlip(10_000, [cash(-12_000)]).depositCashCents).toBe(0)
  })

  it('shows card takings without counting them in the drawer', () => {
    const slip = depositSlip(0, [{ method: 'card', amountCents: 50_000 }])
    expect(slip.cardCents).toBe(50_000)
    expect(slip.expectedCashCents).toBe(0)
  })
})

describe('priceSale (US-34)', () => {
  const lock = { productId: 'p1', quantity: 2, unitPriceCents: 1_299, unitCostCents: 650, taxable: true }
  const exempt = { productId: 'p2', quantity: 1, unitPriceCents: 1_000, unitCostCents: 400, taxable: false }

  it('multiplies out each line', () => {
    const totals = priceSale([lock], 0)
    expect(totals.subtotalCents).toBe(2_598)
    expect(totals.costCents).toBe(1_300)
  })

  it('taxes only the taxable lines', () => {
    // 8.25% of 2598 = 214.335 → 214. The exempt line is not in the base.
    const totals = priceSale([lock, exempt], 825)
    expect(totals.subtotalCents).toBe(3_598)
    expect(totals.taxCents).toBe(214)
    expect(totals.totalCents).toBe(3_812)
  })

  it('charges no tax at a zero rate', () => {
    expect(priceSale([lock], 0).taxCents).toBe(0)
  })

  it('sums cost across mixed lines for COGS', () => {
    expect(priceSale([lock, exempt], 0).costCents).toBe(1_700)
  })
})

describe('saleProblem', () => {
  const line = { productId: 'p1', quantity: 1, unitPriceCents: 1_000, unitCostCents: 400, taxable: true, stockCount: 5 }

  it('accepts a normal line', () => {
    expect(saleProblem([line])).toBeNull()
  })

  it('refuses an empty basket', () => {
    expect(saleProblem([])).toBe('no_lines')
  })

  it('refuses zero or fractional quantities', () => {
    expect(saleProblem([{ ...line, quantity: 0 }])).toBe('quantity_not_positive')
    expect(saleProblem([{ ...line, quantity: 1.5 }])).toBe('quantity_not_positive')
  })

  it('refuses selling more than is on the shelf', () => {
    expect(saleProblem([{ ...line, quantity: 6 }])).toBe('insufficient_stock')
  })

  it('allows selling the last one', () => {
    expect(saleProblem([{ ...line, quantity: 5 }])).toBeNull()
  })
})

describe('isLowStock', () => {
  it('fires at or below the threshold', () => {
    expect(isLowStock(2, 2)).toBe(true)
    expect(isLowStock(1, 2)).toBe(true)
  })

  it('does not fire above it', () => {
    expect(isLowStock(3, 2)).toBe(false)
  })

  it('never fires when the operator opted out', () => {
    // Null is "no alert", not "alert at zero" — which would fire once the
    // shelf is already empty and the sale already lost.
    expect(isLowStock(0, null)).toBe(false)
  })
})

describe('margin', () => {
  it('computes revenue, cost and the ratio', () => {
    const result = margin([{ revenueCents: 1_000, costCents: 400 }, { revenueCents: 500, costCents: 250 }])
    expect(result.revenueCents).toBe(1_500)
    expect(result.costCents).toBe(650)
    expect(result.marginCents).toBe(850)
    expect(result.marginRatio).toBeCloseTo(850 / 1_500)
  })

  it('has a null ratio when nothing sold', () => {
    // 0% margin reads as selling at cost; "no sales" is not that.
    expect(margin([]).marginRatio).toBeNull()
  })
})
