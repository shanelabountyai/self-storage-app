import { describe, expect, it } from 'vitest'
import {
  compareFeeSchedule,
  compareLateFeeLadder,
  compareTimeline,
  sameTimelineJson,
} from '../packages/core/org'

// B-079 / PRD 02 US-4. The "overrides flagged visibly" half, proved without
// fixtures. Every one of these is a false flag waiting to happen — an owner who
// is told nine sites are overridden when they are not stops reading the flag.

const fee = (feeType: string, amountCents: number) => ({ feeType, amountCents })

const rung = (step: number, overrides: Partial<Record<string, unknown>> = {}) => ({
  step,
  daysPastDue: 10 * step,
  amountCents: 2_000,
  percentBasisPoints: 0,
  basis: 'flat',
  capCents: null,
  ...overrides,
})

describe('compareFeeSchedule', () => {
  it('matches when every default fee is charged at the default amount', () => {
    const defaults = [fee('admin', 2_500), fee('nsf', 3_000)]
    expect(compareFeeSchedule(defaults, [fee('nsf', 3_000), fee('admin', 2_500)])).toEqual({
      matches: true,
      differences: [],
      missing: [],
    })
  })

  it('names the fee that diverges, not just that one does', () => {
    const report = compareFeeSchedule([fee('admin', 2_500), fee('nsf', 3_000)], [
      fee('admin', 2_500),
      fee('nsf', 3_500),
    ])
    expect(report.matches).toBe(false)
    expect(report.differences).toEqual(['nsf'])
  })

  it('separates "never pushed here" from "changed here"', () => {
    // Different fixes: one is a push, the other is a conversation.
    const report = compareFeeSchedule([fee('admin', 2_500), fee('lien', 5_000)], [fee('admin', 9_900)])
    expect(report.differences).toEqual(['admin'])
    expect(report.missing).toEqual(['lien'])
  })

  it('ignores a local fee the default says nothing about', () => {
    // The default is a floor of agreed values, not an exhaustive list. Flagging
    // every local fee would make the flag loudest at the sites that need it
    // least.
    expect(compareFeeSchedule([fee('admin', 2_500)], [fee('admin', 2_500), fee('damage', 7_500)]))
      .toEqual({ matches: true, differences: [], missing: [] })
  })
})

describe('compareLateFeeLadder', () => {
  it('matches an identical ladder', () => {
    expect(compareLateFeeLadder([rung(1), rung(2)], [rung(2), rung(1)]).matches).toBe(true)
  })

  it.each([
    ['daysPastDue', { daysPastDue: 5 }],
    ['amountCents', { amountCents: 9_900 }],
    ['percentBasisPoints', { percentBasisPoints: 1_000 }],
    ['basis', { basis: 'percent' }],
    ['capCents', { capCents: 5_000 }],
  ])('notices a changed %s', (_field, override) => {
    const report = compareLateFeeLadder([rung(1)], [rung(1, override)])
    expect(report.matches).toBe(false)
    expect(report.differences).toEqual(['step 1'])
  })

  it('treats a null cap and an absent cap as the same', () => {
    const withUndefined = { ...rung(1), capCents: undefined as unknown as null }
    expect(compareLateFeeLadder([rung(1)], [withUndefined]).matches).toBe(true)
  })

  it('reports an EXTRA rung the org never agreed to', () => {
    // Unlike a spare fee type, an extra ladder step is money a tenant actually
    // gets charged — the job walks the ladder to the end.
    const report = compareLateFeeLadder([rung(1)], [rung(1), rung(2)])
    expect(report.matches).toBe(false)
    expect(report.differences).toEqual(['step 2 (extra)'])
  })

  it('reports a rung that was never pushed', () => {
    expect(compareLateFeeLadder([rung(1), rung(2)], [rung(1)]).missing).toEqual(['step 2'])
  })
})

describe('compareTimeline', () => {
  const steps = [
    { dayOffset: 5, label: 'Late fee', automatedActions: ['assess_late_fee'] },
    { dayOffset: 30, label: 'Pre-lien notice', automatedActions: ['send_notice'] },
  ]
  const defaults = { qualifyingAmount: 'full_balance', steps }

  it('matches an identical timeline', () => {
    expect(compareTimeline(defaults, { qualifyingAmount: 'full_balance', steps }).matches).toBe(true)
  })

  it('reports a facility with no timeline as never pushed, not overridden', () => {
    expect(compareTimeline(defaults, null)).toEqual({
      matches: false,
      differences: [],
      missing: ['timeline'],
    })
  })

  it('notices a different qualifying amount', () => {
    const report = compareTimeline(defaults, { qualifyingAmount: 'rent_only', steps })
    expect(report.differences).toEqual(['qualifying amount'])
  })

  it('says how the step COUNT differs when it does', () => {
    const report = compareTimeline(defaults, {
      qualifyingAmount: 'full_balance',
      steps: [steps[0]],
    })
    expect(report.differences).toEqual(['step count (1 vs 2)'])
  })

  it('says "step configuration" when the count is the same but the content is not', () => {
    const report = compareTimeline(defaults, {
      qualifyingAmount: 'full_balance',
      steps: [{ ...steps[0], dayOffset: 7 }, steps[1]],
    })
    expect(report.differences).toEqual(['step configuration'])
  })
})

describe('sameTimelineJson', () => {
  it('does not care what order the keys were written in', () => {
    // A timeline saved by a form and one saved by a seed script serialise
    // differently. `JSON.stringify` equality would call them divergent and put
    // a false "overridden" flag on every facility.
    expect(sameTimelineJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('treats an absent key and an undefined one as the same', () => {
    expect(sameTimelineJson({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('DOES care about array order', () => {
    // Timeline steps are a sequence; day 5 before day 30 is not the same
    // timeline as day 30 before day 5.
    expect(sameTimelineJson([1, 2], [2, 1])).toBe(false)
  })

  it('distinguishes null from a missing value', () => {
    expect(sameTimelineJson({ a: null }, {})).toBe(false)
  })

  it('compares nested structures', () => {
    expect(sameTimelineJson({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } })).toBe(true)
    expect(sameTimelineJson({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 3 }] } })).toBe(false)
  })
})
