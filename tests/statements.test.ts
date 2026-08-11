import { describe, expect, it } from 'vitest'
import {
  buildStatement,
  monthBounds,
  reconciles,
  statementLabel,
  statementMonths,
  type StatementLine,
} from '../packages/core/billing'
import { zonedMidnight, zoneOffsetMinutes } from '../packages/core/jobs'
import { parseStatementPeriod, statementPeriodSegment } from '../apps/web/lib/billing/statement-period'

// B-102 / PRD 01 US-705. A statement is an assertion about money that somebody
// hands to an accountant, so the property that matters is that it RECONCILES.

const CHICAGO = 'America/Chicago'
const PERIOD = { start: new Date('2026-08-01T05:00:00Z'), end: new Date('2026-09-01T05:00:00Z') }

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  amountCents: 12_900,
  type: 'charge',
  description: 'Rent — August',
  occurredAt: new Date('2026-08-01T06:00:00Z'),
  ...over,
})

describe('buildStatement', () => {
  it('carries the opening balance through when nothing happened', () => {
    const statement = buildStatement({ period: PERIOD, openingBalanceCents: 5_000, lines: [] })
    expect(statement.openingBalanceCents).toBe(5_000)
    expect(statement.closingBalanceCents).toBe(5_000)
    expect(reconciles(statement)).toBe(true)
  })

  it('reconciles a charge and a matching payment back to the opening balance', () => {
    const statement = buildStatement({
      period: PERIOD,
      openingBalanceCents: 0,
      lines: [line(), line({ type: 'payment', amountCents: -12_900, description: 'Card payment' })],
    })
    expect(statement.closingBalanceCents).toBe(0)
    expect(statement.totals.chargedCents).toBe(12_900)
    // Reported unsigned: "you paid $129" is the sentence a person looks for.
    expect(statement.totals.paidCents).toBe(12_900)
    expect(reconciles(statement)).toBe(true)
  })

  it('computes the closing balance by ADDING movement, not by re-summing', () => {
    // Two sums that should agree are two things that can disagree. This pins
    // the definition: closing is opening plus the lines, always.
    const lines = [
      line({ amountCents: 12_900 }),
      line({ type: 'payment', amountCents: -5_000 }),
      line({ type: 'credit', amountCents: -1_000 }),
      line({ type: 'adjustment', amountCents: 250 }),
    ]
    const statement = buildStatement({ period: PERIOD, openingBalanceCents: 7_000, lines })
    expect(statement.closingBalanceCents).toBe(7_000 + 12_900 - 5_000 - 1_000 + 250)
    expect(reconciles(statement)).toBe(true)
  })

  it('reconciles with every entry type present at once', () => {
    const statement = buildStatement({
      period: PERIOD,
      openingBalanceCents: -2_500,
      lines: [
        line({ type: 'charge', amountCents: 12_900 }),
        line({ type: 'payment', amountCents: -10_000 }),
        line({ type: 'credit', amountCents: -400 }),
        line({ type: 'refund', amountCents: 1_500 }),
        line({ type: 'adjustment', amountCents: -75 }),
        line({ type: 'write_off', amountCents: -1_925 }),
      ],
    })
    expect(reconciles(statement)).toBe(true)
    expect(statement.totals).toEqual({
      chargedCents: 12_900,
      paidCents: 10_000,
      creditedCents: 400,
      refundedCents: 1_500,
      writtenOffCents: 1_925,
      adjustedCents: -75,
    })
  })

  it('starts from a CREDIT balance without flipping any sign', () => {
    // A tenant in credit has a negative balance. Getting this wrong turns
    // "we owe you $25" into "you owe us $25" on a document going to a
    // bookkeeper.
    const statement = buildStatement({
      period: PERIOD,
      openingBalanceCents: -2_500,
      lines: [line({ amountCents: 12_900 })],
    })
    expect(statement.closingBalanceCents).toBe(10_400)
  })

  it('sorts lines oldest-first regardless of the order they arrive in', () => {
    const late = line({ occurredAt: new Date('2026-08-20T12:00:00Z'), description: 'Late fee' })
    const early = line({ occurredAt: new Date('2026-08-01T12:00:00Z'), description: 'Rent' })
    const statement = buildStatement({ period: PERIOD, openingBalanceCents: 0, lines: [late, early] })
    expect(statement.lines.map((l) => l.description)).toEqual(['Rent', 'Late fee'])
  })

  it('does not mutate the caller’s array', () => {
    const lines = [line({ occurredAt: new Date('2026-08-20T12:00:00Z') }), line()]
    const before = [...lines]
    buildStatement({ period: PERIOD, openingBalanceCents: 0, lines })
    expect(lines).toEqual(before)
  })
})

describe('reconciles', () => {
  it('catches a closing balance that does not follow from the lines', () => {
    // The guard the renderer relies on: a statement that does not add up must
    // fail loudly rather than be shown to somebody's accountant.
    const statement = buildStatement({ period: PERIOD, openingBalanceCents: 0, lines: [line()] })
    expect(reconciles({ ...statement, closingBalanceCents: 999 })).toBe(false)
  })
})

describe('statementMonths', () => {
  it('lists every month from the start to today, newest first', () => {
    const months = statementMonths({
      startDate: new Date('2026-06-15T00:00:00Z'),
      endDate: null,
      now: new Date('2026-08-10T00:00:00Z'),
    })
    expect(months).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 7 },
      { year: 2026, month: 6 },
    ])
  })

  it('stops at the move-out month for an ended lease', () => {
    const months = statementMonths({
      startDate: new Date('2026-06-15T00:00:00Z'),
      endDate: new Date('2026-07-04T00:00:00Z'),
      now: new Date('2026-12-01T00:00:00Z'),
    })
    expect(months).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 6 },
    ])
  })

  it('includes a month with no activity rather than skipping it', () => {
    // A gap in a numbered list of months reads as a missing document. "Nothing
    // happened in March" is an answer a bookkeeper may still need.
    const months = statementMonths({
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: null,
      now: new Date('2026-04-01T00:00:00Z'),
    })
    expect(months).toHaveLength(4)
  })

  it('crosses a year boundary', () => {
    const months = statementMonths({
      startDate: new Date('2025-11-20T00:00:00Z'),
      endDate: null,
      now: new Date('2026-01-05T00:00:00Z'),
    })
    expect(months).toEqual([
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
    ])
  })

  it('gives one month for a lease that starts and ends the same month', () => {
    expect(
      statementMonths({
        startDate: new Date('2026-08-03T00:00:00Z'),
        endDate: new Date('2026-08-20T00:00:00Z'),
        now: new Date('2026-08-25T00:00:00Z'),
      }),
    ).toEqual([{ year: 2026, month: 8 }])
  })

  it('gives nothing for a lease that has not started', () => {
    expect(
      statementMonths({
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: null,
        now: new Date('2026-08-10T00:00:00Z'),
      }),
    ).toEqual([])
  })
})

describe('monthBounds', () => {
  it('starts at facility-local midnight, not UTC midnight', () => {
    // The bug B-078's deposits report shipped with, in a different module: a
    // payment taken at 8pm on the 31st belongs to that month, and a UTC
    // boundary pushes it into the next one at every US facility.
    const august = monthBounds(2026, 8, CHICAGO)
    expect(august.start.toISOString()).toBe('2026-08-01T05:00:00.000Z') // CDT, UTC-5
    expect(august.end.toISOString()).toBe('2026-09-01T05:00:00.000Z')
  })

  it('rolls December into the next January', () => {
    const december = monthBounds(2026, 12, CHICAGO)
    expect(december.end.toISOString()).toBe('2027-01-01T06:00:00.000Z') // CST, UTC-6
  })

  it('is correct across the spring DST change', () => {
    // March 2026 starts in CST (-6) and ends in CDT (-5). Computing the end as
    // "start plus 31 days" would be an hour out.
    const march = monthBounds(2026, 3, CHICAGO)
    expect(march.start.toISOString()).toBe('2026-03-01T06:00:00.000Z')
    expect(march.end.toISOString()).toBe('2026-04-01T05:00:00.000Z')
  })

  it('leaves a UTC facility alone', () => {
    expect(monthBounds(2026, 8, 'UTC').start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('has no gap and no overlap between consecutive months', () => {
    // Every ledger entry has to land in exactly one statement. A gap loses one;
    // an overlap counts it twice, and both break reconciliation silently.
    for (let month = 1; month <= 11; month += 1) {
      expect(monthBounds(2026, month, CHICAGO).end.getTime()).toBe(
        monthBounds(2026, month + 1, CHICAGO).start.getTime(),
      )
    }
  })
})

describe('zonedMidnight / zoneOffsetMinutes', () => {
  it('reports the offset west of UTC as negative', () => {
    expect(zoneOffsetMinutes(new Date('2026-08-01T12:00:00Z'), CHICAGO)).toBe(-300)
    expect(zoneOffsetMinutes(new Date('2026-01-01T12:00:00Z'), CHICAGO)).toBe(-360)
  })

  it('round-trips through the DST boundary itself', () => {
    // 8 March 2026 is the spring-forward day in the US. Local midnight still
    // exists; the missing hour is 2am.
    expect(zonedMidnight(2026, 3, 8, CHICAGO).toISOString()).toBe('2026-03-08T06:00:00.000Z')
    // 1 November 2026 is fall-back; 1am happens twice, midnight only once.
    expect(zonedMidnight(2026, 11, 1, CHICAGO).toISOString()).toBe('2026-11-01T05:00:00.000Z')
  })

  it('handles a zone east of UTC', () => {
    expect(zonedMidnight(2026, 8, 1, 'Europe/Berlin').toISOString()).toBe('2026-07-31T22:00:00.000Z')
  })
})

describe('parseStatementPeriod', () => {
  it('accepts a well-formed period', () => {
    expect(parseStatementPeriod('2026-08')).toEqual({ year: 2026, month: 8 })
  })

  it.each(['2026-13', '2026-00', '1999-08', '2026-8', 'aaaa-bb', '', '2026-08-01'])(
    'refuses %j',
    (segment) => {
      // The segment comes out of a URL. A month of 13 reaching `monthBounds`
      // would produce a silently wrong window rather than a 404.
      expect(parseStatementPeriod(segment)).toBeNull()
    },
  )

  it('round-trips with the segment builder', () => {
    expect(parseStatementPeriod(statementPeriodSegment(2026, 3))).toEqual({ year: 2026, month: 3 })
  })
})

describe('statementLabel', () => {
  it('names the month in full', () => {
    expect(statementLabel(2026, 8)).toBe('August 2026')
    expect(statementLabel(2026, 12)).toBe('December 2026')
  })
})
