import { describe, expect, it } from 'vitest'
import {
  billedByCategory,
  categoryTotal,
  collectedByCategory,
  emptyCategoryTotals,
  sumCategoryTotals,
  REVENUE_CATEGORIES,
} from '../packages/core/metrics/revenue'

// B-055 / PRD 02 US-39.5. Billed vs collected, by category.

describe('billedByCategory', () => {
  it('sums lines into their own categories', () => {
    expect(
      billedByCategory([
        { type: 'rent', amountCents: 12_900 },
        { type: 'rent', amountCents: 1_000 },
        { type: 'tax', amountCents: 1_064 },
        { type: 'protection', amountCents: 1_400 },
        { type: 'fee', amountCents: 2_500 },
      ]),
    ).toEqual({ rent: 13_900, tax: 1_064, protection: 1_400, fee: 2_500 })
  })

  it('leaves discounts out — they are reported on their own line', () => {
    // Folding a promo into rent would understate what was charged while hiding
    // how much was given away, which is the one thing US-39.5 asks to see.
    const totals = billedByCategory([
      { type: 'rent', amountCents: 10_000 },
      { type: 'discount', amountCents: 2_000 },
    ])
    expect(totals.rent).toBe(10_000)
    expect(categoryTotal(totals)).toBe(10_000)
  })

  it('ignores a line type it does not recognise rather than guessing', () => {
    expect(categoryTotal(billedByCategory([{ type: 'merchandise', amountCents: 500 }]))).toBe(0)
  })
})

describe('collectedByCategory', () => {
  const gross = { rent: 9_000, tax: 1_000, fee: 0, protection: 0 }

  it('pays in the facility order, not proportionally', () => {
    // $50 against $10 tax + $90 rent. The default order settles tax first, so
    // this is $10 tax and $40 rent — what `allocatePayment` actually did with
    // the money. A proportional split would say $5 and $45: tidier, and
    // disagreeing with the tenant's own ledger.
    expect(collectedByCategory(gross, 5_000)).toEqual({
      tax: 1_000,
      rent: 4_000,
      fee: 0,
      protection: 0,
    })
  })

  it('follows a facility that reordered its categories', () => {
    expect(collectedByCategory(gross, 5_000, ['rent', 'tax', 'fee', 'protection'])).toEqual({
      rent: 5_000,
      tax: 0,
      fee: 0,
      protection: 0,
    })
  })

  it('splits nothing when nothing was paid', () => {
    expect(collectedByCategory(gross, 0)).toEqual(emptyCategoryTotals())
  })

  it('never loses a cent — the split always sums to what was paid', () => {
    const mixed = { rent: 12_900, tax: 1_064, fee: 2_500, protection: 1_400 }
    for (const paid of [1, 999, 1_064, 1_065, 8_000, 17_863, 17_864]) {
      expect(categoryTotal(collectedByCategory(mixed, paid))).toBe(paid)
    }
  })

  it('reports payment against an uncategorised invoice as rent', () => {
    // The same fallback `claimsFor` uses: money in a slightly wrong bucket
    // beats money that vanishes from the report.
    expect(collectedByCategory(emptyCategoryTotals(), 5_000).rent).toBe(5_000)
  })

  it('keeps an overpayment visible rather than dropping it', () => {
    // Possible when a discount made the invoice total smaller than its gross
    // lines. The excess is real money.
    expect(categoryTotal(collectedByCategory({ ...gross, rent: 100 }, 5_000))).toBe(5_000)
  })
})

describe('the roll-up rule', () => {
  it('sums category totals with nothing dropped and nothing counted twice', () => {
    const a = { rent: 100, tax: 10, fee: 5, protection: 1 }
    const b = { rent: 200, tax: 20, fee: 0, protection: 2 }
    const total = sumCategoryTotals([a, b])
    expect(total).toEqual({ rent: 300, tax: 30, fee: 5, protection: 3 })
    expect(categoryTotal(total)).toBe(categoryTotal(a) + categoryTotal(b))
  })

  it('covers every declared category', () => {
    // Catches a category added to the list without being added to the empty
    // record — which would report as undefined and render as NaN.
    const empty = emptyCategoryTotals()
    for (const category of REVENUE_CATEGORIES) expect(empty[category]).toBe(0)
    expect(Object.keys(empty).sort()).toEqual([...REVENUE_CATEGORIES].sort())
  })
})
