import { describe, expect, it } from 'vitest'
import {
  canClosePeriod,
  driftSummary,
  largestDrift,
  periodDrift,
  PERIOD_COMPUTATION_VERSION,
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
    billedByCategory: { rent: 80_000, fee: 10_000, protection: 5_000, tax: 5_000 },
    collectedByCategory: { rent: 72_000, fee: 9_000, protection: 4_500, tax: 4_500 },
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

  it('catches a reclassification that leaves the total unchanged', () => {
    // Rent moved to fees, same total billed. A shape that compared only the
    // top-level numbers would report nothing at all, and this is exactly the
    // restatement somebody would want told about.
    const rows = periodDrift(
      derived(),
      derived({ billedByCategory: { rent: 70_000, fee: 20_000, protection: 5_000, tax: 5_000 } }),
    )
    expect(rows.map((row) => row.key).sort()).toEqual(['billed.fee', 'billed.rent'])
    expect(rows.find((row) => row.key === 'billed.rent')!.deltaValue).toBe(-10_000)
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
    const summary = driftSummary(
      periodDrift(derived(), derived({ billedCents: 1 })),
      // B-307: filed by the code running now, so the data is the only thing
      // that can have moved and the three data causes are the right answer.
      PERIOD_COMPUTATION_VERSION,
    )
    expect(summary).toContain('1 figure no longer matches')
    expect(summary).toContain('voided invoice')
  })

  it('pluralises', () => {
    const summary = driftSummary(
      periodDrift(derived(), derived({ billedCents: 1, moveIns: 0 })),
      PERIOD_COMPUTATION_VERSION,
    )
    expect(summary).toContain('2 figures no longer match')
  })

  // B-307. B-297 and B-298 moved every already-filed month at once, and the
  // sentence sent the reader looking for a voided invoice in a month nobody
  // had touched.
  it('stops offering the data causes when the calculation itself changed', () => {
    const rows = periodDrift(derived(), derived({ billedCents: 1 }))
    const summary = driftSummary(rows, PERIOD_COMPUTATION_VERSION - 1)
    expect(summary).toContain('1 figure no longer matches')
    expect(summary).toContain('The way these figures are calculated changed')
    expect(summary).not.toContain('voided invoice')
    expect(summary).not.toContain('backdated adjustment')
  })

  it('treats a snapshot with no stamp as one the calculation has moved under', () => {
    // Every month filed before B-307 shipped, which is every month filed
    // before B-297 and B-298 changed the boundary.
    const summary = driftSummary(periodDrift(derived(), derived({ billedCents: 1 })))
    expect(summary).not.toContain('voided invoice')
  })
})

describe('the one drifted figure worth naming', () => {
  it('prefers money to a moved count, whatever the sizes', () => {
    const rows = periodDrift(derived(), derived({ billedCents: 100_001, moveIns: 400 }))
    // The count moved by 396 and the money by 1 cent. The money is still the
    // thing somebody reported to an accountant.
    expect(largestDrift(rows)?.key).toBe('billedCents')
  })

  it('takes the largest money difference when several moved', () => {
    const rows = periodDrift(
      derived(),
      derived({ billedCents: 90_000, collectedCents: 89_999 }),
    )
    expect(largestDrift(rows)?.key).toBe('billedCents')
    expect(largestDrift(rows)?.deltaValue).toBe(-10_000)
  })

  it('falls back to any figure when no money moved', () => {
    expect(largestDrift(periodDrift(derived(), derived({ moveIns: 9 })))?.key).toBe('moveIns')
    expect(largestDrift([])).toBeNull()
  })
})
