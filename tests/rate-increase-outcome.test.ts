import { describe, expect, it } from 'vitest'
import {
  averageIncreaseCents,
  averageIncreasePercent,
  rateIncreaseOutcome,
  sumRateIncreaseOutcome,
  type AppliedIncrease,
} from '@storage/core/metrics'

// B-400. A fixture batch effective 1 June: one lease moves out at day 45 for
// price, one takes a retention cut at day 20, one sits still.
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const EFFECTIVE = day('2026-06-01')

const leftAt45: AppliedIncrease = {
  inPlaceCents: 10_000,
  newRateCents: 11_000,
  effectiveDate: EFFECTIVE,
  moveOut: { date: day('2026-07-16'), cause: 'price_or_rate_increase' },
  retentionCuts: [],
}
const cutAt20: AppliedIncrease = {
  inPlaceCents: 8_000,
  newRateCents: 9_000,
  effectiveDate: EFFECTIVE,
  moveOut: null,
  retentionCuts: [{ effectiveDate: day('2026-06-21'), reductionCents: 600 }],
}
const stayed: AppliedIncrease = {
  inPlaceCents: 12_000,
  newRateCents: 13_500,
  effectiveDate: EFFECTIVE,
  moveOut: null,
  retentionCuts: [],
}
const batch = [leftAt45, cutAt20, stayed]

describe('rateIncreaseOutcome (B-400)', () => {
  const outcome = rateIncreaseOutcome(batch, day('2026-10-01'))

  it('counts and averages the increase, weighted by in-place rate', () => {
    expect(outcome.count).toBe(3)
    expect(outcome.increaseCents).toBe(3_500)
    expect(averageIncreaseCents(outcome)).toBe(1_167)
    expect(averageIncreasePercent(outcome)).toBeCloseTo(3_500 / 30_000)
  })

  it('puts a day-45 move-out in the 60 and 90-day windows, not the 30', () => {
    expect(outcome.windows[30]).toEqual({ measured: 3, movedOut: 0, movedOutForPrice: 0 })
    expect(outcome.windows[60]).toEqual({ measured: 3, movedOut: 1, movedOutForPrice: 1 })
    expect(outcome.windows[90]).toEqual({ measured: 3, movedOut: 1, movedOutForPrice: 1 })
  })

  it('counts a retention cut within 90 days on the same lease', () => {
    expect(outcome.retentionCutLeases).toBe(1)
    expect(outcome.retentionCutCents).toBe(600)
  })

  it('nets kept increases (less cuts) against the rent that left', () => {
    // kept: (9000 − 8000 − 600) + (13500 − 12000) = 1900; lost: 10000.
    expect(outcome.keptIncreaseCents).toBe(1_900)
    expect(outcome.lostRentCents).toBe(10_000)
    expect(outcome.netMonthlyCents).toBe(-8_100)
  })

  it('ignores a retention cut after day 90', () => {
    const late = { ...stayed, retentionCuts: [{ effectiveDate: day('2026-09-15'), reductionCents: 500 }] }
    expect(rateIncreaseOutcome([late], day('2026-10-01')).retentionCutLeases).toBe(0)
  })

  it('does not measure a window that has not elapsed — 40 days in has a 30-day figure only', () => {
    const early = rateIncreaseOutcome(batch, day('2026-07-11'))
    expect(early.windows[30].measured).toBe(3)
    expect(early.windows[60].measured).toBe(0)
    expect(early.windows[90].measured).toBe(0)
    expect(early.netMonthlyCents).toBe(0)
    expect(early.retentionCutLeases).toBe(0)
  })

  it('does not close a window on its own last day', () => {
    // Day 30 is 1 July: a move-out that day is inside the window, so it is
    // not measured until 2 July.
    expect(rateIncreaseOutcome(batch, day('2026-07-01')).windows[30].measured).toBe(0)
    expect(rateIncreaseOutcome(batch, day('2026-07-02')).windows[30].measured).toBe(3)
  })

  it('rolls up to exactly the sum of its facilities', () => {
    const today = day('2026-10-01')
    const a = rateIncreaseOutcome([leftAt45], today)
    const b = rateIncreaseOutcome([cutAt20, stayed], today)
    expect(sumRateIncreaseOutcome([a, b])).toEqual(outcome)
  })
})
