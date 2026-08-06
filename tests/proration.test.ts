import { describe, expect, it } from 'vitest'
import {
  billingPeriodFor,
  buildInvoice,
  describeDayRange,
  formatInvoiceNumber,
  prorate,
  unusedRemainder,
} from '../packages/core/billing'

// PRD 02 US-18 (B-044). The proration formula and what it builds.
//
// US-18's AC calls for the math to be "deterministic and unit-tested
// (documented formula: daily rate = monthly rate / days in billing period;
// rounding half-up to cents at line level)". This is that test.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const AUGUST = billingPeriodFor('first_of_month', 1, d('2026-08-10')) // 31 days
const FEBRUARY = billingPeriodFor('first_of_month', 1, d('2026-02-10')) // 28 days

describe('prorate', () => {
  it('charges the exact monthly rate for a full period, with no rounding step', () => {
    // The guarantee that matters most: a full month must never bill a cent
    // under because the math went through a division.
    const result = prorate({ monthlyCents: 12_900, period: AUGUST, from: AUGUST.start, to: AUGUST.end })
    expect(result.amountCents).toBe(12_900)
    expect(result.days).toBe(31)
  })

  it('rounds at line level, not at daily-rate level', () => {
    // $129.00 / 31 days = 4.16129…/day. Rounding the daily rate to 4.16 first
    // and multiplying by 19 gives $79.04; the correct line-level answer is
    // $79.06. Two cents, systematically in the operator's favour, every time.
    const result = prorate({
      monthlyCents: 12_900,
      period: AUGUST,
      from: d('2026-08-01'),
      to: d('2026-08-20'),
    })
    expect(result.days).toBe(19)
    expect(result.amountCents).toBe(7_906)
  })

  it('rounds half-up on an exact half cent', () => {
    // $100.00 over 8 days of a 16-day span would be exact; this picks a case
    // that lands on .5 — 1 day of $1.29 over a 2-day slice is 64.5 cents.
    const twoDays = { start: d('2026-08-01'), end: d('2026-08-03') }
    const result = prorate({ monthlyCents: 129, period: twoDays, from: d('2026-08-01'), to: d('2026-08-02') })
    expect(result.amountCents).toBe(65)
  })

  it('charges more per day in February than in July', () => {
    // The reason the denominator is the real period length: a February day is
    // worth more than a July day, and a fixed 30 would overcharge one and
    // undercharge the other.
    const july = prorate({ monthlyCents: 12_900, period: AUGUST, from: d('2026-08-01'), to: d('2026-08-08') })
    const feb = prorate({ monthlyCents: 12_900, period: FEBRUARY, from: d('2026-02-01'), to: d('2026-02-08') })
    expect(feb.amountCents).toBeGreaterThan(july.amountCents)
    // 7 days: $129.00 × 7/28 = $32.25 in February, × 7/31 = $29.13 in August.
    expect(feb.amountCents).toBe(3_225)
    expect(july.amountCents).toBe(2_913)
  })

  it('charges nothing for a zero-day range', () => {
    const result = prorate({ monthlyCents: 12_900, period: AUGUST, from: d('2026-08-10'), to: d('2026-08-10') })
    expect(result).toMatchObject({ amountCents: 0, days: 0 })
  })

  it('clamps a range that starts before the period', () => {
    const result = prorate({ monthlyCents: 12_900, period: AUGUST, from: d('2026-07-01'), to: d('2026-08-11') })
    expect(result.days).toBe(10)
    expect(result.from.toISOString().slice(0, 10)).toBe('2026-08-01')
  })

  it('clamps a range that runs past the period end', () => {
    const result = prorate({ monthlyCents: 12_900, period: AUGUST, from: d('2026-08-21'), to: d('2026-12-01') })
    expect(result.days).toBe(11)
    expect(result.to.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('charges nothing when the range misses the period entirely', () => {
    const result = prorate({ monthlyCents: 12_900, period: AUGUST, from: d('2026-05-01'), to: d('2026-05-20') })
    expect(result.amountCents).toBe(0)
  })
})

describe('unusedRemainder', () => {
  it('reconciles to the penny with the charged part', () => {
    // The property that makes a move-out refund defensible: charged + refunded
    // is exactly the month, never a cent out from two separate roundings.
    for (let day = 1; day <= 31; day++) {
      const to = new Date(Date.UTC(2026, 7, day))
      const used = prorate({ monthlyCents: 12_900, period: AUGUST, from: AUGUST.start, to })
      const unused = unusedRemainder({ monthlyCents: 12_900, period: AUGUST, from: AUGUST.start, to })
      expect(used.amountCents + unused.amountCents).toBe(12_900)
      expect(used.days + unused.days).toBe(31)
    }
  })

  it('refunds nothing when the tenant stayed the whole period', () => {
    const unused = unusedRemainder({ monthlyCents: 12_900, period: AUGUST, from: AUGUST.start, to: AUGUST.end })
    expect(unused.amountCents).toBe(0)
  })
})

describe('describeDayRange', () => {
  it('renders the last day CHARGED, not the exclusive end', () => {
    // A tenant reads a line as the days they had the unit. Showing 1 Sep on a
    // line that stops billing on 31 Aug reads as a day they were charged for
    // and did not get.
    expect(describeDayRange(d('2026-08-20'), d('2026-09-01'))).toBe('Aug 20 – Aug 31')
  })
})

describe('buildInvoice', () => {
  const rent = { type: 'rent' as const, description: 'Rent', monthlyCents: 12_900, taxable: true }
  const protection = {
    type: 'protection' as const,
    description: 'Protection plan',
    monthlyCents: 1_400,
    taxable: false,
  }
  const TX = [{ jurisdiction: 'state', rateBasisPoints: 625 }]

  it('adds rent, protection and tax to a total', () => {
    const built = buildInvoice({ period: AUGUST, charges: [rent, protection], taxRates: TX })
    expect(built.subtotalCents).toBe(14_300)
    // Tax is on rent only — a protection plan is not rent and is not taxed the
    // same way. 6.25% of $129.00 is $8.06, not 6.25% of $143.00.
    expect(built.taxCents).toBe(806)
    expect(built.totalCents).toBe(15_106)
  })

  it('leaves a zero-amount charge off entirely rather than showing $0.00', () => {
    const built = buildInvoice({
      period: AUGUST,
      charges: [rent, { ...protection, monthlyCents: 0 }],
      taxRates: TX,
    })
    expect(built.lines.filter((line) => line.type === 'protection')).toEqual([])
  })

  it('taxes each jurisdiction separately, the way a filing reports it', () => {
    const built = buildInvoice({
      period: AUGUST,
      charges: [rent],
      taxRates: [
        { jurisdiction: 'state', rateBasisPoints: 625 },
        { jurisdiction: 'city', rateBasisPoints: 200 },
      ],
    })
    const taxLines = built.lines.filter((line) => line.type === 'tax')
    expect(taxLines.map((line) => line.amountCents)).toEqual([806, 258])
    expect(built.taxCents).toBe(1_064)
  })

  it('names the day range on a prorated line', () => {
    const built = buildInvoice({
      period: AUGUST,
      charges: [rent],
      prorateFrom: d('2026-08-20'),
      prorateTo: AUGUST.end,
    })
    expect(built.lines[0].description).toContain('Aug 20 – Aug 31')
    expect(built.lines[0].description).toContain('12 of 31 days')
    expect(built.lines[0].amountCents).toBe(4_994)
  })

  it('does not label a full period as prorated even when a range is passed', () => {
    const built = buildInvoice({
      period: AUGUST,
      charges: [rent],
      prorateFrom: AUGUST.start,
      prorateTo: AUGUST.end,
    })
    expect(built.lines[0].description).toBe('Rent')
    expect(built.lines[0].amountCents).toBe(12_900)
  })

  it('taxes the prorated base, not the full month', () => {
    const built = buildInvoice({
      period: AUGUST,
      charges: [rent],
      taxRates: TX,
      prorateFrom: d('2026-08-20'),
      prorateTo: AUGUST.end,
    })
    expect(built.taxCents).toBe(312)
    expect(built.totalCents).toBe(5_306)
  })
})

describe('formatInvoiceNumber', () => {
  it('zero-pads so the series sorts the same as a person reads it', () => {
    expect(formatInvoiceNumber(1)).toBe('000001')
    expect(['000010', '000009'].sort()).toEqual(['000009', '000010'])
  })

  it('widens rather than truncating past six digits', () => {
    expect(formatInvoiceNumber(1_234_567)).toBe('1234567')
  })
})
