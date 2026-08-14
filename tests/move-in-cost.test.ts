import { describe, expect, it } from 'vitest'
import { calculateMoveInCost } from '../packages/core/pricing'

// B-017 / PRD 01 US-301. The total shown while browsing and the total shown at
// checkout must come from this one function — a discrepancy between them is a
// release-blocking defect, not a rounding issue.

const TEXAS = [
  { jurisdiction: 'state', rateBasisPoints: 625 },
  { jurisdiction: 'city', rateBasisPoints: 200 },
]

describe('calculateMoveInCost', () => {
  it('foots rent + admin fee + tax to the total due today', () => {
    const cost = calculateMoveInCost({
      webRateCents: 12_900,
      streetRateCents: 14_900,
      adminFeeCents: 2_500,
      taxRates: TEXAS,
    })

    // Taxable base today is rent + admin = 15,400.
    // state 6.25% = 962.5 -> 963; city 2% = 308. Tax = 1,271.
    expect(cost.totalDueTodayCents).toBe(12_900 + 2_500 + 1_271)

    // The itemization must actually add up to the figure it foots to,
    // ignoring the named-but-zero protection line.
    const summed = cost.lines.reduce((total, line) => total + line.amountCents, 0)
    expect(summed).toBe(cost.totalDueTodayCents)
  })

  it('excludes the one-time fee from the recurring total', () => {
    const cost = calculateMoveInCost({
      webRateCents: 12_900,
      streetRateCents: 12_900,
      adminFeeCents: 2_500,
      taxRates: TEXAS,
    })
    // Monthly base is rent alone: state 806.25 -> 806, city 258. Tax = 1,064.
    expect(cost.ongoingMonthlyCents).toBe(12_900 + 1_064)
    expect(cost.ongoingMonthlyCents).toBeLessThan(cost.totalDueTodayCents)
  })

  it('rounds each jurisdiction separately, the way an invoice will list them', () => {
    // One 8.25% line on 15,400 would be 1,270.5 -> 1,271 (round half up), which
    // happens to match here; the point is that the two jurisdictions are
    // rounded independently rather than summed as a single rate.
    const twoRates = calculateMoveInCost({
      webRateCents: 10_001,
      streetRateCents: 10_001,
      taxRates: TEXAS,
    })
    const state = Math.round((10_001 * 625) / 10_000)
    const city = Math.round((10_001 * 200) / 10_000)
    expect(twoRates.lines.find((l) => l.key === 'tax')?.amountCents).toBe(state + city)
  })

  it('reports no saving when the two rates are equal', () => {
    // A struck-through price identical to the price charged is a fabricated
    // discount, so the UI keys off this being zero.
    const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 12_900 })
    expect(cost.savingCents).toBe(0)
  })

  it('never reports a negative saving', () => {
    // A web rate above the street rate is a data error, not a surcharge to
    // advertise. It must not render as "-$20 off".
    const cost = calculateMoveInCost({ webRateCents: 14_900, streetRateCents: 12_900 })
    expect(cost.savingCents).toBe(0)
  })

  it('omits an absent admin fee rather than rendering a $0.00 line', () => {
    const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 12_900 })
    expect(cost.lines.map((l) => l.key)).not.toContain('admin')
    expect(cost.totalDueTodayCents).toBe(12_900)
  })

  it('names the protection plan even though it costs nothing yet', () => {
    // US-301: components not knowable before checkout are named and explained,
    // not omitted. Discovering a required charge at the payment step is the
    // surprise the whole story exists to prevent.
    const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 12_900 })
    const protection = cost.lines.find((l) => l.key === 'protection')
    expect(protection).toBeDefined()
    expect(protection?.amountCents).toBe(0)
    expect(protection?.note).toMatch(/checkout/)
  })

  it('says a mid-month start is prorated rather than pretending it is not', () => {
    const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 12_900 })
    expect(cost.lines.find((l) => l.key === 'rent')?.note).toMatch(/part-way through a month/)
  })

  it('handles a facility with no tax configured', () => {
    const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 14_900, adminFeeCents: 2_500 })
    expect(cost.lines.map((l) => l.key)).not.toContain('tax')
    expect(cost.totalDueTodayCents).toBe(15_400)
    expect(cost.savingCents).toBe(2_000)
  })

  describe('promotions (the advertised price and the charged price)', () => {
    // The bug this exists for: the facility page applied a promotion through
    // `offerFor` and the checkout charged `calculateMoveInCost` without one, so
    // the card advertised "50% off your first month" and every figure from
    // "Rent now" onwards was the full rate. US-301 makes that disagreement a
    // release-blocking defect, and it is only enforceable because there is one
    // implementation — so the one implementation had to learn about promos.

    const TAX = [{ jurisdiction: 'state', rateBasisPoints: 825 }]

    it('takes the discount off the total and names which promotion did it', () => {
      const cost = calculateMoveInCost({
        webRateCents: 12_900,
        streetRateCents: 12_900,
        adminFeeCents: 2_500,
        promoDiscountCents: 6_450,
        promoTerms: '50% off your first month',
      })
      const line = cost.lines.find((l) => l.key === 'promo')
      expect(line?.label).toBe('50% off your first month')
      // Negative, so the column adds up as read rather than needing a rule
      // about which lines to subtract.
      expect(line?.amountCents).toBe(-6_450)
      expect(cost.totalDueTodayCents).toBe(12_900 - 6_450 + 2_500)
    })

    it('taxes what is actually charged, not the price before the discount', () => {
      const discounted = calculateMoveInCost({
        webRateCents: 12_900,
        streetRateCents: 12_900,
        adminFeeCents: 2_500,
        taxRates: TAX,
        promoDiscountCents: 6_450,
      })
      const full = calculateMoveInCost({
        webRateCents: 12_900,
        streetRateCents: 12_900,
        adminFeeCents: 2_500,
        taxRates: TAX,
      })
      expect(discounted.lines.find((l) => l.key === 'tax')!.amountCents).toBeLessThan(
        full.lines.find((l) => l.key === 'tax')!.amountCents,
      )
      // 8.25% of (129.00 - 64.50 + 25.00)
      expect(discounted.lines.find((l) => l.key === 'tax')!.amountCents).toBe(738)
    })

    it('leaves the recurring total alone — a first-month promo is not a rent cut', () => {
      const cost = calculateMoveInCost({
        webRateCents: 12_900,
        streetRateCents: 12_900,
        taxRates: TAX,
        promoDiscountCents: 6_450,
      })
      // "then $X/mo" has to be what the tenant will actually keep paying.
      expect(cost.ongoingMonthlyCents).toBe(12_900 + Math.round((12_900 * 825) / 10_000))
    })

    it('renders no promo line when there is no promotion', () => {
      const cost = calculateMoveInCost({ webRateCents: 12_900, streetRateCents: 12_900 })
      expect(cost.lines.map((l) => l.key)).not.toContain('promo')
    })

    it('never lets a promotion exceed the rent it discounts', () => {
      // A misconfigured promotion must not turn a move-in into a payout.
      const cost = calculateMoveInCost({
        webRateCents: 12_900,
        streetRateCents: 12_900,
        adminFeeCents: 2_500,
        promoDiscountCents: 99_999,
      })
      expect(cost.totalDueTodayCents).toBe(2_500)
      expect(cost.lines.find((l) => l.key === 'promo')?.amountCents).toBe(-12_900)
    })
  })

})
