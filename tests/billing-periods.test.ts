import { describe, expect, it } from 'vitest'
import {
  billingDayFor,
  billingPeriodFor,
  daysInPeriod,
  nextBillingPeriod,
  periodStartsBetween,
} from '../packages/core/billing'

// PRD 02 US-17 (B-044). Billing periods, before anything tries to invoice one.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)
const range = (period: { start: Date; end: Date }) => [iso(period.start), iso(period.end)]

describe('billingDayFor', () => {
  it('uses the move-in day under anniversary billing', () => {
    expect(billingDayFor('anniversary', d('2026-08-20'))).toBe(20)
  })

  it('clamps to 28 so the billing day exists in February', () => {
    // The database constrains billingDay to 1–28 for the same reason: a lease
    // billing on the 31st has no billing day in four months of the year.
    expect(billingDayFor('anniversary', d('2026-08-31'))).toBe(28)
    expect(billingDayFor('anniversary', d('2026-08-29'))).toBe(28)
  })

  it('is always the 1st under first-of-month billing', () => {
    expect(billingDayFor('first_of_month', d('2026-08-20'))).toBe(1)
  })
})

describe('billingPeriodFor', () => {
  it('runs from the billing day to the same day next month', () => {
    expect(range(billingPeriodFor('anniversary', 20, d('2026-08-25')))).toEqual([
      '2026-08-20',
      '2026-09-20',
    ])
  })

  it('places a date before the billing day in the period that started last month', () => {
    expect(range(billingPeriodFor('anniversary', 20, d('2026-08-19')))).toEqual([
      '2026-07-20',
      '2026-08-20',
    ])
  })

  it('treats the billing day itself as the first day of the new period', () => {
    // The boundary that decides whether a payment on the 20th pays for the
    // month starting or the month ending.
    expect(range(billingPeriodFor('anniversary', 20, d('2026-08-20')))).toEqual([
      '2026-08-20',
      '2026-09-20',
    ])
  })

  it('crosses a year boundary', () => {
    expect(range(billingPeriodFor('anniversary', 20, d('2026-12-25')))).toEqual([
      '2026-12-20',
      '2027-01-20',
    ])
  })

  it('ignores the lease billing day under first-of-month policy', () => {
    // The policy is the authority, not the column — a facility that switches
    // policy must not need every lease rewritten before the run is correct.
    expect(range(billingPeriodFor('first_of_month', 20, d('2026-08-25')))).toEqual([
      '2026-08-01',
      '2026-09-01',
    ])
  })
})

describe('daysInPeriod', () => {
  it('is the real length of the month, not 30', () => {
    expect(daysInPeriod(billingPeriodFor('first_of_month', 1, d('2026-02-10')))).toBe(28)
    expect(daysInPeriod(billingPeriodFor('first_of_month', 1, d('2026-07-10')))).toBe(31)
    expect(daysInPeriod(billingPeriodFor('first_of_month', 1, d('2026-04-10')))).toBe(30)
  })

  it('counts a leap February as 29 days', () => {
    expect(daysInPeriod(billingPeriodFor('first_of_month', 1, d('2028-02-10')))).toBe(29)
  })

  it('spans a DST transition without gaining or losing a day', () => {
    // US DST ends 2026-11-01. Periods are calendar dates with no offset, so
    // the count is unaffected — the bug this guards against is a period built
    // from local timestamps silently becoming 30.96 days.
    expect(daysInPeriod(billingPeriodFor('first_of_month', 1, d('2026-10-15')))).toBe(31)
  })
})

describe('consecutive periods tile the calendar', () => {
  it('hands the next period the previous one’s end as its start', () => {
    const first = billingPeriodFor('anniversary', 20, d('2026-08-25'))
    const second = nextBillingPeriod(first)
    expect(iso(second.start)).toBe(iso(first.end))
    expect(range(second)).toEqual(['2026-09-20', '2026-10-20'])
  })

  it('covers a whole year with no day counted twice and none missed', () => {
    let period = billingPeriodFor('anniversary', 15, d('2026-01-20'))
    const days: string[] = []
    for (let i = 0; i < 12; i++) {
      for (let t = period.start.getTime(); t < period.end.getTime(); t += 86_400_000) {
        days.push(iso(new Date(t)))
      }
      period = nextBillingPeriod(period)
    }
    expect(new Set(days).size).toBe(days.length)
    expect(days).toHaveLength(365)
  })
})

describe('periodStartsBetween', () => {
  const start = d('2026-08-20')

  it('never returns the period the lease started in', () => {
    // The move-in payment already covered a full period beginning that day.
    // Re-billing it is the double-charge this exclusion exists to prevent.
    const periods = periodStartsBetween('anniversary', 20, start, d('2026-08-25'))
    expect(periods).toEqual([])
  })

  it('returns the next period once it falls inside the look-ahead window', () => {
    const periods = periodStartsBetween('anniversary', 20, start, d('2026-09-20'))
    expect(periods.map(range)).toEqual([['2026-09-20', '2026-10-20']])
  })

  it('returns every period missed while nothing ran', () => {
    const periods = periodStartsBetween('anniversary', 20, start, d('2026-11-20'))
    expect(periods.map((p) => iso(p.start))).toEqual(['2026-09-20', '2026-10-20', '2026-11-20'])
  })

  it('caps how far a single call can run away', () => {
    const periods = periodStartsBetween('anniversary', 20, start, d('2030-01-01'))
    expect(periods).toHaveLength(12)
  })

  it('returns nothing when the window ends before the lease started', () => {
    expect(periodStartsBetween('anniversary', 20, start, d('2026-08-01'))).toEqual([])
  })

  it('skips the move-in period under first-of-month too', () => {
    // Move-in on 20 Aug, billing on the 1st: the period containing the move-in
    // started 1 Aug, before the lease, so the first billed period is 1 Sep.
    const periods = periodStartsBetween('first_of_month', 1, start, d('2026-09-05'))
    expect(periods.map(range)).toEqual([['2026-09-01', '2026-10-01']])
  })
})
