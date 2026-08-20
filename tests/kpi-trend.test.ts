import { describe, expect, it } from 'vitest'
import type { PeriodSnapshot } from '../packages/core/accounting'
import {
  delta,
  monthsBack,
  rollUpByMonth,
  type FiledPeriod,
} from '../apps/web/lib/admin/kpi-trend'

// PRD 00 §6 Phase 3 (B-088 part 2). The roll-up maths, which is where an owner
// dashboard quietly goes wrong.

function snapshot(overrides: {
  occupiedUnits: number
  rentableUnits: number
  economic?: number
  collected?: number
}): PeriodSnapshot {
  return {
    version: 2,
    takenAt: '2026-08-01T00:00:00.000Z',
    pointInTime: {
      unitOccupancyRatio:
        overrides.rentableUnits === 0 ? 0 : overrides.occupiedUnits / overrides.rentableUnits,
      occupiedUnits: overrides.occupiedUnits,
      rentableUnits: overrides.rentableUnits,
      squareFootRatio:
        overrides.rentableUnits === 0 ? 0 : overrides.occupiedUnits / overrides.rentableUnits,
      arD0to10Cents: 0,
      arD11to30Cents: 0,
      arD31to60Cents: 0,
      arD61to90Cents: 0,
      arOver90Cents: 0,
      arTotalCents: 1_000,
    },
    periodDerived: {
      billedCents: 10_000,
      collectedCents: overrides.collected ?? 9_000,
      billedByCategory: { rent: 10_000, fee: 0, protection: 0, tax: 0 },
      collectedByCategory: { rent: 9_000, fee: 0, protection: 0, tax: 0 },
      discountsCents: 0,
      referralRewardsCents: 0,
      writeOffsCents: 0,
      refundsCents: 0,
      unappliedCents: 0,
      economicOccupancyRatio: overrides.economic ?? 0.9,
      grossPotentialCents: 11_000,
      moveIns: 2,
      moveOuts: 1,
      netMoves: 1,
    },
  }
}

function filed(facilityId: string, year: number, month: number, snap: PeriodSnapshot): FiledPeriod {
  return { facilityId, year, month, snapshot: snap }
}

describe('rollUpByMonth', () => {
  it('recomputes the portfolio ratio from components instead of averaging ratios', () => {
    // The classic error, and the one `sumOccupancy` already documents: a
    // 100%-occupied 4-unit site and a 50%-occupied 400-unit site average to 75%
    // and roll up to 50.5%. The second is the portfolio.
    const points = rollUpByMonth([
      filed('small', 2026, 7, snapshot({ occupiedUnits: 4, rentableUnits: 4 })),
      filed('large', 2026, 7, snapshot({ occupiedUnits: 200, rentableUnits: 400 })),
    ])

    expect(points).toHaveLength(1)
    expect(points[0].occupiedUnits).toBe(204)
    expect(points[0].rentableUnits).toBe(404)
    expect(points[0].unitOccupancyRatio).toBeCloseTo(204 / 404, 6)
    // Not 0.75.
    expect(points[0].unitOccupancyRatio).toBeLessThan(0.55)
  })

  it('weights economic occupancy by size rather than taking a plain mean', () => {
    // Same trap in a place the type system cannot catch, because the snapshot
    // stores this one as a ratio with no components beside it.
    const points = rollUpByMonth([
      filed('small', 2026, 7, snapshot({ occupiedUnits: 4, rentableUnits: 4, economic: 1 })),
      filed('large', 2026, 7, snapshot({ occupiedUnits: 200, rentableUnits: 400, economic: 0.5 })),
    ])
    // Plain mean would be 0.75; weighted by 4 and 400 units it is ~0.505.
    expect(points[0].economicOccupancyRatio).toBeCloseTo((1 * 4 + 0.5 * 400) / 404, 6)
  })

  it('sums money and moves across the facilities that filed', () => {
    const points = rollUpByMonth([
      filed('a', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10, collected: 1_000 })),
      filed('b', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10, collected: 2_500 })),
    ])
    expect(points[0].collectedCents).toBe(3_500)
    expect(points[0].moveIns).toBe(4)
    expect(points[0].netMoves).toBe(2)
  })

  it('orders months oldest first, across a year boundary', () => {
    const points = rollUpByMonth([
      filed('a', 2027, 1, snapshot({ occupiedUnits: 1, rentableUnits: 2 })),
      filed('a', 2026, 12, snapshot({ occupiedUnits: 1, rentableUnits: 2 })),
      filed('a', 2026, 2, snapshot({ occupiedUnits: 1, rentableUnits: 2 })),
    ])
    expect(points.map((p) => `${p.year}-${p.month}`)).toEqual(['2026-2', '2026-12', '2027-1'])
  })

  it('records which facilities contributed, so a dip can be told from a missing site', () => {
    const points = rollUpByMonth([
      filed('a', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10 })),
      filed('b', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10 })),
      filed('a', 2026, 8, snapshot({ occupiedUnits: 5, rentableUnits: 10 })),
    ])
    expect(points[0].facilityIds).toHaveLength(2)
    // August looks like half the portfolio's collections vanished; it is one
    // site that has not closed its books. The screen needs this to say so.
    expect(points[1].facilityIds).toHaveLength(1)
  })

  it('does not invent a zero month between two filed ones', () => {
    // A gap is a gap. Emitting a zero point would draw a collapse that never
    // happened, which is the single most dangerous thing a trend can do.
    const points = rollUpByMonth([
      filed('a', 2026, 6, snapshot({ occupiedUnits: 9, rentableUnits: 10 })),
      filed('a', 2026, 8, snapshot({ occupiedUnits: 9, rentableUnits: 10 })),
    ])
    expect(points.map((p) => p.month)).toEqual([6, 8])
  })
})

describe('monthsBack', () => {
  it('walks backwards across a year boundary and ends on the current month', () => {
    const months = monthsBack(new Date('2026-02-15T00:00:00.000Z'), 4)
    expect(months).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
  })
})

describe('delta', () => {
  it('is null with nothing to compare against', () => {
    const points = rollUpByMonth([filed('a', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10 }))])
    expect(delta(points, (p) => p.unitOccupancyRatio)).toBeNull()
  })

  it('is the signed change from the previous month', () => {
    const points = rollUpByMonth([
      filed('a', 2026, 7, snapshot({ occupiedUnits: 5, rentableUnits: 10 })),
      filed('a', 2026, 8, snapshot({ occupiedUnits: 8, rentableUnits: 10 })),
    ])
    expect(delta(points, (p) => p.unitOccupancyRatio)).toBeCloseTo(0.3, 6)
  })
})
