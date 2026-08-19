import { describe, expect, it } from 'vitest'
import {
  COOLDOWN_DAYS,
  MIN_UNITS_FOR_SUGGESTION,
  projectedMonthlyUpliftCents,
  suggestStreetRate,
  type SuggestionInput,
} from '../packages/core/pricing/street-rate-suggestion'

// PRD 02 US-12 (B-088 part 1). The rule that proposes a price change an
// operator applies in one click, which is why it is tested against plain values
// before any screen exists.

function input(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    unitTypeId: 'ut-1',
    occupiedCount: 19,
    rentableCount: 20,
    occupancyRatio: 0.95,
    streetRateCents: 10_000,
    webRateCents: 9_000,
    daysSinceRateChange: 120,
    hasScheduledChange: false,
    ...overrides,
  }
}

describe('suggestStreetRate', () => {
  it('raises a tight type, rounded to real money', () => {
    const result = suggestStreetRate(input())
    expect(result.reason).toBe('raise')
    expect(result.increase).toBe(0.08)
    // 10_000 × 1.08 = 10_800 exactly, so the rounding changes nothing.
    expect(result.suggestedStreetRateCents).toBe(10_800)
  })

  it('uses US-12’s own 92% threshold for the smaller step', () => {
    const result = suggestStreetRate(input({ occupancyRatio: 0.93 }))
    expect(result.increase).toBe(0.04)
    expect(result.suggestedStreetRateCents).toBe(10_400)
  })

  it('says nothing at all when demand is soft, rather than proposing a cut', () => {
    // D-74. A soft type is a promotions problem, and B-070 already built that
    // engine — a suggested price CUT is a much larger commitment than a
    // temporary offer and this rule deliberately never proposes one.
    const result = suggestStreetRate(input({ occupancyRatio: 0.6 }))
    expect(result.reason).toBe('demand_is_soft')
    expect(result.suggestedStreetRateCents).toBeNull()
  })

  it('is silent just below the threshold, not "almost"', () => {
    expect(suggestStreetRate(input({ occupancyRatio: 0.9199 })).reason).toBe('demand_is_soft')
    expect(suggestStreetRate(input({ occupancyRatio: 0.92 })).reason).toBe('raise')
  })

  it('refuses a sample too small for occupancy to mean anything', () => {
    // Four units at 100% is one move-out from 75%.
    const result = suggestStreetRate(
      input({ rentableCount: MIN_UNITS_FOR_SUGGESTION - 1, occupiedCount: 4, occupancyRatio: 1 }),
    )
    expect(result.reason).toBe('too_few_units')
  })

  it('holds off until the last change has had a quarter to work', () => {
    // The ratchet this rule exists to prevent: occupancy does not fall the day
    // a rate rises, so without the cooldown an operator clicking weekly would
    // compound +8% into a 50% rise in a quarter, each click defensible.
    expect(suggestStreetRate(input({ daysSinceRateChange: COOLDOWN_DAYS - 1 })).reason).toBe(
      'cooling_off',
    )
    expect(suggestStreetRate(input({ daysSinceRateChange: COOLDOWN_DAYS })).reason).toBe('raise')
  })

  it('treats an unknown last-change date as "wait", never as "long enough ago"', () => {
    expect(suggestStreetRate(input({ daysSinceRateChange: null })).reason).toBe('cooling_off')
  })

  it('stays quiet when a change is already queued, rather than double-applying', () => {
    // `/admin/units/types` can schedule a future rate. Suggesting on top of one
    // means the operator applies this, the queued row lands next week, and the
    // price moved twice for a single decision.
    const result = suggestStreetRate(input({ hasScheduledChange: true }))
    expect(result.reason).toBe('change_scheduled')
    expect(result.suggestedStreetRateCents).toBeNull()
  })

  it('refuses a type that has no price yet', () => {
    // Applying a percentage to nothing produces nothing. A type with no rate
    // needs somebody to set one.
    expect(suggestStreetRate(input({ streetRateCents: 0 })).reason).toBe('no_rate')
  })

  it('keeps the online discount instead of quietly retiring it', () => {
    // Street 100 → 108 is ×1.08; the web rate must move by the same proportion,
    // not up to the street rate. Setting both equal would delete a discount
    // nobody decided to stop offering.
    const result = suggestStreetRate(input({ streetRateCents: 10_000, webRateCents: 9_000 }))
    expect(result.suggestedStreetRateCents).toBe(10_800)
    // 9_000 × (10_800 / 10_000) = 9_720, rounded up to the whole dollar.
    expect(result.suggestedWebRateCents).toBe(9_800)
    // The property that actually matters: the online discount survives. It was
    // 10% off street and is still within a point of that — setting both to the
    // street rate would have retired a discount nobody decided to stop offering.
    expect(result.suggestedWebRateCents!).toBeLessThan(result.suggestedStreetRateCents!)
    const discount = 1 - result.suggestedWebRateCents! / result.suggestedStreetRateCents!
    expect(discount).toBeGreaterThan(0.08)
    expect(discount).toBeLessThan(0.12)
  })

  it('rounds up, so a raise is never rounded back to standing still', () => {
    // $101 + 4% = $105.04. Rounding to the NEAREST dollar would give $105,
    // which is fine here — but on rates where the increase is under half a
    // dollar it would land back on the current price, and a "suggestion" that
    // changes nothing is worse than silence. Hence up, always.
    const result = suggestStreetRate(input({ streetRateCents: 10_100, occupancyRatio: 0.93 }))
    expect(result.suggestedStreetRateCents! % 100).toBe(0)
    expect(result.suggestedStreetRateCents!).toBeGreaterThan(10_100)
  })

  it('does not let rounding rewrite the band it came from', () => {
    // The bug the first draft shipped: rounding up to the nearest $5 turned a
    // 4% band into +5% on a $100 rate and +8% on a $37 one — double what the
    // rule decided. An operator has to be able to reason about the step, so
    // the rounding may cost at most a dollar on top of it.
    for (let cents = 2_000; cents <= 60_000; cents += 311) {
      const result = suggestStreetRate(input({ streetRateCents: cents, webRateCents: cents }))
      if (result.reason !== 'raise') continue
      const banded = cents * (1 + result.increase!)
      expect(result.suggestedStreetRateCents! - banded, `at ${cents}`).toBeLessThan(100)
      expect(result.suggestedStreetRateCents!, `at ${cents}`).toBeGreaterThanOrEqual(banded)
    }
  })

  it('never proposes the price it is already charging', () => {
    // Asserted across a sweep of rates rather than one, because this is the
    // property that makes the screen trustworthy at a glance.
    for (let cents = 1_000; cents <= 50_000; cents += 137) {
      const result = suggestStreetRate(input({ streetRateCents: cents, webRateCents: cents }))
      if (result.reason !== 'raise') continue
      expect(result.suggestedStreetRateCents, `at ${cents}`).toBeGreaterThan(cents)
    }
  })
})

describe('projectedMonthlyUpliftCents', () => {
  it('counts occupied units only, because a raise earns nothing until a unit turns over', () => {
    const suggestion = suggestStreetRate(input())
    const total = projectedMonthlyUpliftCents([
      { occupiedCount: 19, streetRateCents: 10_000, suggestion },
    ])
    // 19 occupied × $8 = $152, NOT 20 × $8.
    expect(total).toBe(19 * 800)
  })

  it('ignores every row that is not a raise', () => {
    const soft = suggestStreetRate(input({ occupancyRatio: 0.5 }))
    expect(
      projectedMonthlyUpliftCents([{ occupiedCount: 10, streetRateCents: 10_000, suggestion: soft }]),
    ).toBe(0)
  })
})
