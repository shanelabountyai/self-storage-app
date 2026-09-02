import { describe, expect, it } from 'vitest'
import { calculateMoveInCost, monthlyRecurring, recurringParts, type TaxRate } from '@storage/core/pricing'

// B-227. The figure three screens printed differently and the invoice agreed
// with none of.
const TX = [{ jurisdiction: 'state', rateBasisPoints: 625 }]

describe('what a lease charges every month', () => {
  it('taxes the rent and not the protection premium', () => {
    // The whole defect in one assertion. Texas taxes self-storage as a taxable
    // service; a protection plan is not rent (`invoices.ts` `chargesFor`).
    const charge = monthlyRecurring({
      monthlyRateCents: 14_000,
      protectionCents: 1_500,
      taxRates: TX,
    })
    expect(charge).toEqual({
      rentCents: 14_000,
      taxCents: 875,
      protectionCents: 1_500,
      totalCents: 16_375,
    })
  })

  it('is larger than the sum the portal used to print', () => {
    // `monthlyRateCents + protectionCents` — the portal's old figure, and the
    // direction that matters: it UNDERSTATED what autopay would take, which is
    // what turns a charge into a dispute.
    const charge = monthlyRecurring({
      monthlyRateCents: 14_000,
      protectionCents: 1_500,
      taxRates: TX,
    })
    expect(charge.totalCents).toBeGreaterThan(14_000 + 1_500)
  })

  it('rounds per jurisdiction, exactly as the move-in estimate does', () => {
    // Two jurisdictions rounded separately can differ by a cent from one
    // rounding of their combined rate. `calculateMoveInCost` rounds per
    // jurisdiction, so this must too or the checkout disclosure and the portal
    // disagree by a cent — which reads as a bug in whichever screen is second.
    const split = monthlyRecurring({
      monthlyRateCents: 9_999,
      protectionCents: 0,
      taxRates: [
        { jurisdiction: 'state', rateBasisPoints: 625 },
        { jurisdiction: 'city', rateBasisPoints: 200 },
      ],
    })
    expect(split.taxCents).toBe(625 + 200)
  })

  it('charges no tax where a facility has no tax components', () => {
    // The demo seed's own case, and the reason this defect was invisible to the
    // e2e suite: with no TaxComponent rows the gap is exactly zero.
    const charge = monthlyRecurring({ monthlyRateCents: 14_000, protectionCents: 1_500 })
    expect(charge.totalCents).toBe(15_500)
    expect(charge.taxCents).toBe(0)
  })

  it('names only the parts that are actually there', () => {
    expect(recurringParts(monthlyRecurring({ monthlyRateCents: 14_000, protectionCents: 1_500, taxRates: TX })))
      .toEqual(['rent', 'tax', 'your protection plan'])
    // No plan and no tax component: the sentence must not claim either.
    expect(recurringParts(monthlyRecurring({ monthlyRateCents: 14_000, protectionCents: 0 })))
      .toEqual(['rent'])
  })
})

// B-227. **The assertion the row asks for: the portal's figure equals the
// disclosure the tenant signed.**
//
// Pure rather than end-to-end, and that is not a shortcut — it is the only way
// this can be checked at all right now. The demo seed writes no `TaxComponent`
// rows, so the gap between the two surfaces is exactly $0 in every e2e run and
// the defect was invisible to the whole suite for as long as it existed. A
// test that only ran against demo data would have passed on the bug.
describe('the portal figure and the checkout disclosure', () => {
  // What checkout puts in front of the renter: `calculateMoveInCost`'s ongoing
  // monthly (rent + tax on rent) plus the protection premium the session
  // recorded at step 3 (`lib/checkout/payment.ts`).
  const checkoutDisclosure = (rate: number, protection: number, taxRates: TaxRate[]) =>
    calculateMoveInCost({ webRateCents: rate, streetRateCents: rate, taxRates })
      .ongoingMonthlyCents + protection

  it('agree, with tax and a protection plan in play', () => {
    const rate = 14_000
    const protection = 1_500
    expect(monthlyRecurring({ monthlyRateCents: rate, protectionCents: protection, taxRates: TX }).totalCents)
      .toBe(checkoutDisclosure(rate, protection, TX))
  })

  it('agree across several rates, protections and tax mixes', () => {
    // A difference is a defect, not a rounding note — so this sweeps the
    // rounding boundaries rather than asserting one happy number. Per-jurisdiction
    // rounding is where the two would drift by a cent if either changed.
    const rates = [9_999, 10_000, 12_345, 14_000, 20_001]
    const protections = [0, 1_500, 2_999]
    const mixes: TaxRate[][] = [
      [],
      TX,
      [
        { jurisdiction: 'state', rateBasisPoints: 625 },
        { jurisdiction: 'city', rateBasisPoints: 200 },
      ],
    ]
    for (const rate of rates) {
      for (const protection of protections) {
        for (const taxRates of mixes) {
          expect(
            monthlyRecurring({ monthlyRateCents: rate, protectionCents: protection, taxRates })
              .totalCents,
            `rate ${rate}, protection ${protection}, ${taxRates.length} jurisdiction(s)`,
          ).toBe(checkoutDisclosure(rate, protection, taxRates))
        }
      }
    }
  })

  it('states the magnitude of what the portal used to leave out', () => {
    // The row asked for this to be measured rather than guessed. The gap is
    // exactly the tax on rent: at $140 rent and Texas's 6.25% the portal
    // promised $155.00 and autopay took $163.75.
    const charge = monthlyRecurring({ monthlyRateCents: 14_000, protectionCents: 1_500, taxRates: TX })
    const oldPortalFigure = 14_000 + 1_500
    expect(charge.totalCents - oldPortalFigure).toBe(charge.taxCents)
    expect(charge.totalCents).toBe(16_375)
  })
})
