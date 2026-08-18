import { describe, expect, it } from 'vitest'
import {
  canClosePeriod,
  driftSummary,
  periodDrift,
  type PeriodDerivedFigures,
} from '../packages/core/accounting'
import { monthBounds } from '../packages/core/billing'

// PRD 02 §8, US-40 (B-084 part 1). The close rules, pure.

function derived(overrides: Partial<PeriodDerivedFigures> = {}): PeriodDerivedFigures {
  return {
    billedCents: 100_000,
    collectedCents: 90_000,
    discountsCents: 5_000,
    referralRewardsCents: 0,
    writeOffsCents: 0,
    refundsCents: 0,
    unappliedCents: 0,
    economicOccupancyRatio: 0.82,
    grossPotentialCents: 110_000,
    moveIns: 4,
    moveOuts: 2,
    netMoves: 2,
    ...overrides,
  }
}

describe('whether a month may be closed', () => {
  const july = monthBounds(2026, 7, 'America/Chicago')

  it('allows it once the month has ended in the facility’s own timezone', () => {
    expect(
      canClosePeriod({ periodEnd: july.end, now: new Date('2026-08-01T06:00:00Z'), alreadyClosed: false }),
    ).toEqual({ allowed: true })
  })

  it('refuses a month that has not finished', () => {
    // Freezing half of August under a name that claims all of it makes every
    // figure wrong in the same direction, which is worse than not filing —
    // because it looks like a record.
    const verdict = canClosePeriod({
      periodEnd: july.end,
      now: new Date('2026-07-15T12:00:00Z'),
      alreadyClosed: false,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('has not finished')
  })

  it('uses the facility’s midnight, not UTC’s', () => {
    // 2026-08-01T04:00Z is 11pm on 31 July in Chicago. The month is NOT over
    // there, and a UTC boundary would have said it was — the same mistake the
    // deposits report shipped with.
    const verdict = canClosePeriod({
      periodEnd: july.end,
      now: new Date('2026-08-01T04:00:00Z'),
      alreadyClosed: false,
    })
    expect(verdict.allowed).toBe(false)
  })

  it('refuses a month that is already closed, and says to reopen it', () => {
    const verdict = canClosePeriod({
      periodEnd: july.end,
      now: new Date('2026-09-01T00:00:00Z'),
      alreadyClosed: true,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('Reopen it first')
  })
})

describe('drift against what was filed', () => {
  it('finds nothing when the figures still match', () => {
    expect(periodDrift(derived(), derived())).toEqual([])
  })

  it('reports a voided invoice as billed money disappearing, signed', () => {
    const rows = periodDrift(derived(), derived({ billedCents: 88_000 }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'billedCents',
      filedValue: 100_000,
      currentValue: 88_000,
      // Negative: the direction is the information. Money appearing after a
      // close is a different problem from money vanishing.
      deltaValue: -12_000,
      kind: 'cents',
    })
  })

  it('reports every changed figure, not just the first', () => {
    const rows = periodDrift(derived(), derived({ billedCents: 1, moveOuts: 9, netMoves: -5 }))
    expect(rows.map((row) => row.key).sort()).toEqual(['billedCents', 'moveOuts', 'netMoves'])
  })

  it('does not fire on floating-point noise in a ratio', () => {
    // Recomputing 0.82 can differ in the last bits without anything in the
    // world having changed, and a drift report that cries wolf is one nobody
    // reads.
    const rows = periodDrift(derived(), derived({ economicOccupancyRatio: 0.82 + 1e-15 }))
    expect(rows).toEqual([])
  })

  it('does fire on a ratio change big enough to mean something', () => {
    const rows = periodDrift(derived(), derived({ economicOccupancyRatio: 0.79 }))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('ratio')
  })

  it('compares ONLY period-derived figures — occupancy and AR are not in it', () => {
    // The load-bearing rule. Unit occupancy reads current unit status and AR
    // aging takes no date, so recomputing either answers a different question
    // with the same name — comparing them would flag every closed month
    // forever, about changes that have nothing to do with that month.
    const keys = periodDrift(
      derived(),
      derived({ billedCents: 0, collectedCents: 0, moveIns: 0, moveOuts: 0, netMoves: 0 }),
    ).map((row) => row.key)
    expect(keys).not.toContain('unitOccupancyRatio')
    expect(keys).not.toContain('arTotalCents')
    // And the type system agrees: `periodDrift` takes PeriodDerivedFigures, so
    // a point-in-time field cannot be passed to it at all.
  })
})

describe('the drift summary sentence', () => {
  it('says nothing changed rather than printing a zero', () => {
    expect(driftSummary([])).toContain('still matches what was filed')
  })

  it('names the usual causes, so the reader knows what to go and look for', () => {
    const summary = driftSummary(periodDrift(derived(), derived({ billedCents: 1 })))
    expect(summary).toContain('1 figure no longer matches')
    expect(summary).toContain('voided invoice')
  })

  it('pluralises', () => {
    const summary = driftSummary(periodDrift(derived(), derived({ billedCents: 1, moveIns: 0 })))
    expect(summary).toContain('2 figures no longer match')
  })
})
