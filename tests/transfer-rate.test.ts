import { describe, expect, it } from 'vitest'
import { isRateRise, transferRateFor } from '../packages/core/pricing/transfer-rate'

// B-162 / D-93 / PRD 02 §4.4 US-14. What rate a transfer opens the new lease at.

// A tenant 20% under street on a 10×10: pays $120 where a new tenant pays $150.
const legacy = { inPlaceRateCents: 12_000, fromStreetRateCents: 15_000 }

describe('transferRateFor — preserve_discount', () => {
  const policy = 'preserve_discount' as const

  it('costs exactly what they pay now on a like-for-like move', () => {
    // The defect the row was raised for: this used to return $150, a $30
    // rent rise served with no notice period, no approval and no
    // `TenantRateIncrease` record, through a screen for a service request the
    // tenant asked for.
    expect(transferRateFor({ policy, ...legacy, toStreetRateCents: 15_000 })).toBe(12_000)
  })

  it('prices a downsize down, keeping the same discount', () => {
    // 5×10 at $100 street, 20% off → $80. Carrying the dollar rate instead
    // would charge $120 for a unit nobody else pays $100 for.
    expect(transferRateFor({ policy, ...legacy, toStreetRateCents: 10_000 })).toBe(8_000)
  })

  it('prices an upsize up, keeping the same discount', () => {
    expect(transferRateFor({ policy, ...legacy, toStreetRateCents: 25_000 })).toBe(20_000)
  })

  it('rounds to whole cents', () => {
    // $99.99 against $149.99 street, moving to $199.99: not a round ratio.
    expect(
      transferRateFor({
        policy,
        inPlaceRateCents: 9_999,
        fromStreetRateCents: 14_999,
        toStreetRateCents: 19_999,
      }),
    ).toBe(13_332)
  })

  it('never charges above the new unit type’s street rate', () => {
    // A tenant paying ABOVE street — the market softened after an increase —
    // must not carry the premium onto a unit nobody else pays it for.
    expect(
      transferRateFor({
        policy,
        inPlaceRateCents: 18_000,
        fromStreetRateCents: 15_000,
        toStreetRateCents: 15_000,
      }),
    ).toBe(15_000)
  })

  it('falls back to street when the old unit type has no published rate', () => {
    // A de-priced legacy type. There is no discount to measure, so there is
    // nothing to preserve — and returning the in-place rate would freeze it
    // for ever on every unit the tenant ever moves to.
    expect(
      transferRateFor({ policy, inPlaceRateCents: 12_000, fromStreetRateCents: null, toStreetRateCents: 15_000 }),
    ).toBe(15_000)
    expect(
      transferRateFor({ policy, inPlaceRateCents: 12_000, fromStreetRateCents: 0, toStreetRateCents: 15_000 }),
    ).toBe(15_000)
  })
})

describe('transferRateFor — the other two policies', () => {
  it('street ignores what they were paying', () => {
    expect(transferRateFor({ policy: 'street', ...legacy, toStreetRateCents: 15_000 })).toBe(15_000)
    expect(transferRateFor({ policy: 'street', ...legacy, toStreetRateCents: 10_000 })).toBe(10_000)
  })

  it('in_place carries the dollar rate, above street included', () => {
    // Recorded rather than guarded: this is the policy's own consequence and
    // an operator choosing it is choosing this. The preview states the figure.
    expect(transferRateFor({ policy: 'in_place', ...legacy, toStreetRateCents: 10_000 })).toBe(12_000)
  })
})

describe('isRateRise', () => {
  it('is true only when the new rate is higher', () => {
    expect(isRateRise(12_000, 15_000)).toBe(true)
    expect(isRateRise(12_000, 12_000)).toBe(false)
    expect(isRateRise(12_000, 8_000)).toBe(false)
  })
})
