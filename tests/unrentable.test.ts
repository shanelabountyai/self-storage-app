import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UNRENTABLE_LIMITS,
  daysUnrentable,
  rentLostCents,
  unrentableLimitRefusal,
} from '../packages/core/inventory'

// PRD 02 US-8 "AC (unrentable says why)" (B-433).

describe('rentLostCents', () => {
  it('is whole cents, and a year of days is twelve months of rent', () => {
    expect(rentLostCents(10_000, 0)).toBe(0)
    expect(rentLostCents(10_000, 365)).toBe(120_000)
    // 12_999 * 12 * 17 / 365 = 7265.19...
    expect(rentLostCents(12_999, 17)).toBe(7265)
    expect(Number.isInteger(rentLostCents(8_950, 41))).toBe(true)
  })
})

describe('daysUnrentable', () => {
  it('counts whole days and never goes negative', () => {
    const setAt = new Date('2026-09-01T15:00:00Z')
    expect(daysUnrentable(setAt, new Date('2026-09-01T23:00:00Z'))).toBe(0)
    expect(daysUnrentable(setAt, new Date('2026-09-11T15:00:00Z'))).toBe(10)
    expect(daysUnrentable(setAt, new Date('2026-08-01T00:00:00Z'))).toBe(0)
  })
})

describe('unrentableLimitRefusal', () => {
  const setAt = new Date('2026-10-01T12:00:00Z')
  const within = new Date('2026-10-20T00:00:00Z')
  const base = { unitsAfter: 1, setAt, reviewAt: within, limits: DEFAULT_UNRENTABLE_LIMITS, mayExceed: false }

  it('allows a change inside both limits', () => {
    expect(unrentableLimitRefusal(base)).toBeNull()
    expect(unrentableLimitRefusal({ ...base, unitsAfter: 5 })).toBeNull()
  })

  it('refuses the unit past the count', () => {
    expect(unrentableLimitRefusal({ ...base, unitsAfter: 6 })).toMatch(/More than 5/)
  })

  it('refuses a review date past the days, and no date at all', () => {
    expect(unrentableLimitRefusal({ ...base, reviewAt: new Date('2026-11-05T00:00:00Z') })).toMatch(/30 days/)
    expect(unrentableLimitRefusal({ ...base, reviewAt: null })).toMatch(/30 days/)
  })

  it('refuses nothing to somebody who may exceed the limits', () => {
    expect(unrentableLimitRefusal({ ...base, unitsAfter: 99, reviewAt: null, mayExceed: true })).toBeNull()
  })
})
