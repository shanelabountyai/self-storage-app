import { describe, expect, it } from 'vitest'
import {
  arAging,
  arBucketFor,
  daysPastDue,
  economicOccupancy,
  isOccupied,
  isRentable,
  MOVE_CHANNELS,
  MOVE_SOURCES,
  moveCounts,
  normalizeChannel,
  normalizeSource,
  occupancy,
  rateVariance,
  reservationConversion,
  sumArAging,
  sumEconomicOccupancy,
  sumMoveCounts,
  sumOccupancy,
  wholeMonthsBetween,
  type MoveEvent,
  type UnitForOccupancy,
} from '../packages/core/metrics'
import { MARKETING_CHANNELS } from '../packages/core/marketing'

// B-042 / PRD 02 US-39, §8. The definitions themselves — pure, no database.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const unit = (status: UnitForOccupancy['status'], squareFeet = 100): UnitForOccupancy => ({
  status,
  squareFeet,
})

describe('rentable and occupied', () => {
  it('counts maintenance as rentable and unrentable as not — the stated rule', () => {
    // §4.11's AC names this explicitly rather than leaving it to be inferred.
    expect(isRentable('maintenance')).toBe(true)
    expect(isRentable('unrentable')).toBe(false)
    expect(isRentable('available')).toBe(true)
    expect(isRentable('occupied')).toBe(true)
    expect(isRentable('reserved')).toBe(true)
    expect(isRentable('overlocked')).toBe(true)
  })

  it('counts an overlocked unit as occupied', () => {
    // The trap this guards: nothing sets `overlocked` until B-057, and an
    // occupancy that forgot it would *drop* as tenants go delinquent — which
    // reads as units emptying when nobody moved out.
    expect(isOccupied('overlocked')).toBe(true)
    expect(isOccupied('occupied')).toBe(true)
    expect(isOccupied('reserved'), 'a hold is not a lease').toBe(false)
    expect(isOccupied('available')).toBe(false)
    expect(isOccupied('maintenance')).toBe(false)
  })
})

describe('occupancy', () => {
  it('is occupied ÷ rentable', () => {
    const result = occupancy([unit('occupied'), unit('occupied'), unit('available'), unit('available')])
    expect(result.occupiedCount).toBe(2)
    expect(result.rentableCount).toBe(4)
    expect(result.ratio).toBe(0.5)
  })

  it('keeps maintenance in the denominator and unrentable out of it entirely', () => {
    const result = occupancy([unit('occupied'), unit('maintenance'), unit('unrentable')])
    expect(result.rentableCount, 'maintenance counts, unrentable does not').toBe(2)
    expect(result.ratio).toBe(0.5)
  })

  it('counts an overlocked unit in the numerator', () => {
    const result = occupancy([unit('overlocked'), unit('available')])
    expect(result.occupiedCount).toBe(1)
    expect(result.ratio).toBe(0.5)
  })

  it('measures square feet separately from unit count', () => {
    // One big occupied unit and three small empty ones: 25% by unit, 62.5%
    // by square foot. Both are true and they are reported separately because
    // they answer different questions.
    const result = occupancy([unit('occupied', 500), unit('available', 100), unit('available', 100), unit('available', 100)])
    expect(result.ratio).toBe(0.25)
    expect(result.squareFootRatio).toBe(500 / 800)
  })

  it('is 0%, not undefined, when nothing is rentable', () => {
    expect(occupancy([unit('unrentable')]).ratio).toBe(0)
    expect(occupancy([]).ratio).toBe(0)
  })
})

describe('roll-up equals the sum of the facilities', () => {
  // §4.11's AC in as many words: "roll-up equals the sum of the facility
  // reports with no double counting — asserted in a test, not stated in a
  // document." This is that test.
  const facilityA = [unit('occupied', 100), unit('available', 100)]
  const facilityB = [
    unit('occupied', 200),
    unit('occupied', 200),
    unit('available', 200),
    unit('unrentable', 999),
  ]

  it('sums counts and square feet exactly', () => {
    const rolled = sumOccupancy([occupancy(facilityA), occupancy(facilityB)])
    const combined = occupancy([...facilityA, ...facilityB])

    expect(rolled.occupiedCount).toBe(combined.occupiedCount)
    expect(rolled.rentableCount).toBe(combined.rentableCount)
    expect(rolled.occupiedSquareFeet).toBe(combined.occupiedSquareFeet)
    expect(rolled.rentableSquareFeet).toBe(combined.rentableSquareFeet)
    expect(rolled.ratio).toBe(combined.ratio)
    expect(rolled.squareFootRatio).toBe(combined.squareFootRatio)
  })

  it('recomputes the ratio rather than averaging ratios', () => {
    // The classic error: a fully-occupied tiny site and a half-empty large
    // one average to 75% and roll up to ~50.5%. The second is the truth.
    const tiny = occupancy([unit('occupied'), unit('occupied')])
    const large = occupancy(Array.from({ length: 400 }, (_, i) => unit(i < 200 ? 'occupied' : 'available')))
    const rolled = sumOccupancy([tiny, large])

    const naiveAverage = (tiny.ratio + large.ratio) / 2
    expect(naiveAverage).toBe(0.75)
    expect(rolled.ratio).toBeCloseTo(202 / 402, 10)
    expect(rolled.ratio).not.toBeCloseTo(naiveAverage, 3)
  })

  it('rolls AR aging and move counts up by summation too', () => {
    const a = arAging([{ daysPastDue: 5, outstandingCents: 1_000 }])
    const b = arAging([{ daysPastDue: 45, outstandingCents: 2_000 }])
    const rolled = sumArAging([a, b])
    expect(rolled.d0to10).toBe(1_000)
    expect(rolled.d31to60).toBe(2_000)
    expect(rolled.totalCents).toBe(3_000)

    const moves = sumMoveCounts([
      moveCounts([{ source: 'web', channel: 'organic' }], 1),
      moveCounts([{ source: 'phone', channel: 'phone' }, { source: 'web', channel: 'aggregator' }], 0),
    ])
    expect(moves.moveIns).toBe(3)
    expect(moves.moveOuts).toBe(1)
    expect(moves.net).toBe(2)
    expect(moves.bySource.web).toBe(2)
    expect(moves.bySource.phone).toBe(1)
  })
})

describe('economicOccupancy', () => {
  it('is collected ÷ gross potential at street', () => {
    const result = economicOccupancy(75_000, [
      { rentable: true, streetRateCents: 50_000 },
      { rentable: true, streetRateCents: 50_000 },
    ])
    expect(result.grossPotentialCents).toBe(100_000)
    expect(result.ratio).toBe(0.75)
  })

  it('measures against every rentable unit, not just the occupied ones', () => {
    // The whole point: vacancy and non-payment both show up here.
    const result = economicOccupancy(50_000, [
      { rentable: true, streetRateCents: 50_000 },
      { rentable: true, streetRateCents: 50_000 },
    ])
    expect(result.ratio, 'one unit empty is 50%, not 100%').toBe(0.5)
  })

  it('leaves unrentable units out of the potential', () => {
    const result = economicOccupancy(50_000, [
      { rentable: true, streetRateCents: 50_000 },
      { rentable: false, streetRateCents: 99_000 },
    ])
    expect(result.grossPotentialCents).toBe(50_000)
    expect(result.ratio).toBe(1)
  })

  it('does not clamp a catch-up month above 100%', () => {
    const result = economicOccupancy(120_000, [{ rentable: true, streetRateCents: 100_000 }])
    expect(result.ratio).toBe(1.2)
  })

  it('rolls up by summing both sides', () => {
    const a = economicOccupancy(50_000, [{ rentable: true, streetRateCents: 100_000 }])
    const b = economicOccupancy(90_000, [{ rentable: true, streetRateCents: 100_000 }])
    const rolled = sumEconomicOccupancy([a, b])
    expect(rolled.collectedCents).toBe(140_000)
    expect(rolled.grossPotentialCents).toBe(200_000)
    expect(rolled.ratio).toBe(0.7)
  })
})

describe('rateVariance', () => {
  it('sorts the biggest gap first — the rate-increase worklist', () => {
    const sorted = rateVariance([
      { unitNumber: 'A', unitTypeName: '10x10', inPlaceRateCents: 9_000, streetRateCents: 10_000, gapCents: 1_000, monthsSinceLastChange: 3 },
      { unitNumber: 'B', unitTypeName: '10x10', inPlaceRateCents: 5_000, streetRateCents: 10_000, gapCents: 5_000, monthsSinceLastChange: 24 },
    ])
    expect(sorted.map((r) => r.unitNumber)).toEqual(['B', 'A'])
  })

  it('breaks a tie on the longer-untouched lease', () => {
    const sorted = rateVariance([
      { unitNumber: 'A', unitTypeName: '10x10', inPlaceRateCents: 9_000, streetRateCents: 10_000, gapCents: 1_000, monthsSinceLastChange: 3 },
      { unitNumber: 'B', unitTypeName: '10x10', inPlaceRateCents: 9_000, streetRateCents: 10_000, gapCents: 1_000, monthsSinceLastChange: 18 },
    ])
    expect(sorted.map((r) => r.unitNumber)).toEqual(['B', 'A'])
  })

  it('does not mutate its input', () => {
    const rows = [
      { unitNumber: 'A', unitTypeName: '10x10', inPlaceRateCents: 9_000, streetRateCents: 10_000, gapCents: 1_000, monthsSinceLastChange: 3 },
      { unitNumber: 'B', unitTypeName: '10x10', inPlaceRateCents: 5_000, streetRateCents: 10_000, gapCents: 5_000, monthsSinceLastChange: 24 },
    ]
    rateVariance(rows)
    expect(rows.map((r) => r.unitNumber)).toEqual(['A', 'B'])
  })
})

describe('wholeMonthsBetween', () => {
  it('counts only complete months', () => {
    expect(wholeMonthsBetween(d('2026-01-15'), d('2026-02-14'))).toBe(0)
    expect(wholeMonthsBetween(d('2026-01-15'), d('2026-02-15'))).toBe(1)
    expect(wholeMonthsBetween(d('2026-01-15'), d('2027-01-15'))).toBe(12)
  })

  it('never goes negative', () => {
    expect(wholeMonthsBetween(d('2026-06-01'), d('2026-01-01'))).toBe(0)
  })
})

describe('daysPastDue', () => {
  it('measures from the ORIGINAL due date', () => {
    expect(
      daysPastDue([{ dueDate: d('2026-08-01'), totalCents: 10_000, amountPaidCents: 0 }], d('2026-08-15')),
    ).toBe(14)
  })

  it('anchors to the OLDEST unpaid invoice, not the newest', () => {
    // A tenant three months behind who pays this month's bill is still three
    // months behind. Anchoring to the newest unpaid would reset them.
    const days = daysPastDue(
      [
        { dueDate: d('2026-06-01'), totalCents: 10_000, amountPaidCents: 0 },
        { dueDate: d('2026-08-01'), totalCents: 10_000, amountPaidCents: 0 },
      ],
      d('2026-08-15'),
    )
    expect(days).toBe(75)
  })

  it('ignores fully-paid invoices', () => {
    const days = daysPastDue(
      [
        { dueDate: d('2026-06-01'), totalCents: 10_000, amountPaidCents: 10_000 },
        { dueDate: d('2026-08-01'), totalCents: 10_000, amountPaidCents: 0 },
      ],
      d('2026-08-15'),
    )
    expect(days).toBe(14)
  })

  it('still counts a partially-paid invoice as unpaid', () => {
    const days = daysPastDue(
      [{ dueDate: d('2026-08-01'), totalCents: 10_000, amountPaidCents: 9_999 }],
      d('2026-08-15'),
    )
    expect(days).toBe(14)
  })

  it('is 0 when nothing is outstanding, and never negative before the due date', () => {
    expect(daysPastDue([], d('2026-08-15'))).toBe(0)
    expect(
      daysPastDue([{ dueDate: d('2026-09-01'), totalCents: 10_000, amountPaidCents: 0 }], d('2026-08-15')),
    ).toBe(0)
  })
})

describe('arBucketFor', () => {
  it('places every boundary day in exactly one bucket', () => {
    expect(arBucketFor(0)).toBe('d0to10')
    expect(arBucketFor(10)).toBe('d0to10')
    expect(arBucketFor(11)).toBe('d11to30')
    expect(arBucketFor(30)).toBe('d11to30')
    expect(arBucketFor(31)).toBe('d31to60')
    expect(arBucketFor(60)).toBe('d31to60')
    expect(arBucketFor(61)).toBe('d61to90')
    expect(arBucketFor(90), 'exactly 90 is not yet "90+"').toBe('d61to90')
    expect(arBucketFor(91)).toBe('over90')
  })
})

describe('arAging', () => {
  it('sums to the total with nothing dropped', () => {
    const aging = arAging([
      { daysPastDue: 3, outstandingCents: 1_000 },
      { daysPastDue: 20, outstandingCents: 2_000 },
      { daysPastDue: 95, outstandingCents: 3_000 },
    ])
    expect(aging.d0to10 + aging.d11to30 + aging.d31to60 + aging.d61to90 + aging.over90).toBe(
      aging.totalCents,
    )
    expect(aging.totalCents).toBe(6_000)
  })

  it('ignores zero and credit balances', () => {
    const aging = arAging([
      { daysPastDue: 3, outstandingCents: 0 },
      { daysPastDue: 3, outstandingCents: -500 },
    ])
    expect(aging.totalCents).toBe(0)
  })
})

describe('move counts and conversion', () => {
  it('reports a negative net when more left than arrived', () => {
    const counts = moveCounts([{ source: 'web', channel: 'organic' }], 4)
    expect(counts.net).toBe(-3)
  })

  it('attributes move-ins by source and leaves move-outs unattributed', () => {
    const counts = moveCounts([{ source: 'web', channel: 'aggregator' }, { source: 'walk_in', channel: 'walk_in' }], 1)
    expect(counts.bySource.web).toBe(1)
    expect(counts.bySource.walk_in).toBe(1)
    expect(counts.moveOuts).toBe(1)
  })

  // B-082 part 1. THE bug: a marketplace rental and an organic one are both
  // `web` on the source axis, so before `byChannel` existed the only channel
  // that charges per completed move-in was invisible in the report an owner
  // uses to decide what to keep paying for.
  it('separates a marketplace move-in from an organic one that looks identical', () => {
    const counts = moveCounts(
      [
        { source: 'web', channel: 'aggregator' },
        { source: 'web', channel: 'organic' },
      ],
      0,
    )
    expect(counts.bySource.web).toBe(2)
    expect(counts.byChannel.aggregator).toBe(1)
    expect(counts.byChannel.organic).toBe(1)
  })

  it('splits the same move-ins both ways, so the two totals cannot disagree', () => {
    const moves: MoveEvent[] = [
      { source: 'web', channel: 'aggregator' },
      { source: 'phone', channel: 'phone' },
      { source: 'walk_in', channel: 'direct' },
      { source: 'web', channel: 'unknown' },
    ]
    const counts = moveCounts(moves, 2)
    const sourceTotal = MOVE_SOURCES.reduce((sum, key) => sum + counts.bySource[key], 0)
    const channelTotal = MOVE_CHANNELS.reduce((sum, key) => sum + counts.byChannel[key], 0)
    expect(sourceTotal).toBe(counts.moveIns)
    expect(channelTotal).toBe(counts.moveIns)

    // And through a roll-up, which is where a second accumulator usually drifts.
    const rolled = sumMoveCounts([counts, moveCounts([{ source: 'web', channel: 'aggregator' }], 0)])
    expect(MOVE_CHANNELS.reduce((sum, key) => sum + rolled.byChannel[key], 0)).toBe(rolled.moveIns)
    expect(rolled.byChannel.aggregator).toBe(2)
  })

  it('files an unrecognised channel as unknown rather than inventing one', () => {
    // A lease from before capture, and a channel from a vocabulary that has
    // since changed, must both land in `unknown` — never in a real channel,
    // which would credit history to whatever is being evaluated today.
    expect(normalizeChannel(null)).toBe('unknown')
    expect(normalizeChannel('')).toBe('unknown')
    expect(normalizeChannel('some_future_channel')).toBe('unknown')
    expect(normalizeChannel('aggregator')).toBe('aggregator')
  })

  it('covers every marketing channel the attribution layer can produce', () => {
    // `moves.ts` restates the vocabulary rather than importing it, to keep
    // metrics dependency-free. That is only safe if the two lists agree, so
    // this is the assertion that makes the duplication legitimate: a channel
    // added to MARKETING_CHANNELS and not here would silently report as
    // `unknown` for every move-in it produced.
    for (const channel of MARKETING_CHANNELS) {
      expect(MOVE_CHANNELS as readonly string[]).toContain(channel)
    }
  })

  it('folds an unrecognised or missing source into `unknown` rather than a real channel', () => {
    expect(normalizeSource(null)).toBe('unknown')
    expect(normalizeSource('')).toBe('unknown')
    expect(normalizeSource('carrier_pigeon')).toBe('unknown')
    expect(normalizeSource('web')).toBe('web')
  })

  it('computes conversion and average days to move-in over converted holds only', () => {
    const result = reservationConversion([
      { createdAt: d('2026-08-01'), convertedAt: d('2026-08-03') },
      { createdAt: d('2026-08-01'), convertedAt: d('2026-08-05') },
      { createdAt: d('2026-08-01'), convertedAt: null },
    ])
    expect(result.reservations).toBe(3)
    expect(result.converted).toBe(2)
    expect(result.conversionRatio).toBeCloseTo(2 / 3, 10)
    expect(result.averageDaysToMoveIn).toBe(3)
  })

  it('reports null, not zero, when nothing converted', () => {
    // 0.0 days would read as "they move in the same day".
    const result = reservationConversion([{ createdAt: d('2026-08-01'), convertedAt: null }])
    expect(result.averageDaysToMoveIn).toBeNull()
    expect(result.conversionRatio).toBe(0)
  })
})
