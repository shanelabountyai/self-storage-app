import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LATE_FEE_STEPS,
  lateFeeAmount,
  stepsDue,
  type LateFeeStep,
} from '../packages/core/billing'

// PRD 02 US-21 (B-047). "$X or Y% (greater/lesser) at N days late; second fee
// at M days", respecting configurable caps.

function step(overrides: Partial<LateFeeStep> = {}): LateFeeStep {
  return {
    step: 1,
    daysPastDue: 5,
    amountCents: 2_000,
    percentBasisPoints: 1_000,
    basis: 'greater',
    capCents: null,
    ...overrides,
  }
}

describe('lateFeeAmount', () => {
  it('charges a flat amount', () => {
    expect(lateFeeAmount(step({ basis: 'flat' }), 100_000)).toBe(2_000)
  })

  it('charges a percentage of what is overdue', () => {
    // 10% of $129.00.
    expect(lateFeeAmount(step({ basis: 'percent' }), 12_900)).toBe(1_290)
  })

  it('takes the greater of the two', () => {
    // 10% of $129 is $12.90, so the $20 flat wins.
    expect(lateFeeAmount(step({ basis: 'greater' }), 12_900)).toBe(2_000)
    // 10% of $500 is $50, so the percentage wins.
    expect(lateFeeAmount(step({ basis: 'greater' }), 50_000)).toBe(5_000)
  })

  it('takes the lesser of the two', () => {
    expect(lateFeeAmount(step({ basis: 'lesser' }), 12_900)).toBe(1_290)
    expect(lateFeeAmount(step({ basis: 'lesser' }), 50_000)).toBe(2_000)
  })

  it('applies the cap AFTER the greater/lesser choice, not before', () => {
    // "The greater of $20 or 10%, capped at $50" on a $900 balance is $50.
    // Capping each side first would make the percentage $50, still greater than
    // $20, so this particular case agrees — the one below is the one that does
    // not.
    expect(lateFeeAmount(step({ basis: 'greater', capCents: 5_000 }), 90_000)).toBe(5_000)

    // "The greater of $20 or 10%, capped at $15" on a $900 balance. Capping
    // first gives max($20, $15) = $20, which BREACHES the cap. Capping last
    // gives $15, which is what the operator configured.
    expect(lateFeeAmount(step({ basis: 'greater', capCents: 1_500 }), 90_000)).toBe(1_500)
  })

  it('never charges more than is owed', () => {
    // A $20 fee on a $4 residual balance is a complaint, not a payment.
    expect(lateFeeAmount(step({ basis: 'flat' }), 400)).toBe(400)
  })

  it('charges nothing when nothing is overdue', () => {
    expect(lateFeeAmount(step(), 0)).toBe(0)
    // A credit balance must never produce a negative fee — that would pay a
    // tenant for being overdue.
    expect(lateFeeAmount(step(), -5_000)).toBe(0)
  })

  it('rounds a percentage half-up to whole cents', () => {
    // 7.5% of $1.00 is 7.5c.
    expect(lateFeeAmount(step({ basis: 'percent', percentBasisPoints: 750 }), 100)).toBe(8)
  })

  it('treats a negative configured amount as zero rather than a discount', () => {
    expect(lateFeeAmount(step({ basis: 'flat', amountCents: -500 }), 50_000)).toBe(0)
  })
})

describe('stepsDue', () => {
  const steps = [...DEFAULT_LATE_FEE_STEPS]

  it('charges nothing before the first threshold', () => {
    expect(stepsDue(4, steps)).toEqual([])
  })

  it('charges the first step on the day it is reached', () => {
    expect(stepsDue(5, steps).map((s) => s.step)).toEqual([1])
  })

  it('does not charge the same step twice', () => {
    expect(stepsDue(10, steps, [1])).toEqual([])
  })

  it('charges the second step once its own threshold arrives', () => {
    expect(stepsDue(30, steps, [1]).map((s) => s.step)).toEqual([2])
  })

  it('charges both in order when a lease aged past both while nothing ran', () => {
    // The catch-up case: the ledger should read first fee then second fee, in
    // the order it would have happened.
    expect(stepsDue(45, steps).map((s) => s.step)).toEqual([1, 2])
  })

  it('is unaffected by the order the rules come back in', () => {
    expect(stepsDue(45, [steps[1], steps[0]]).map((s) => s.step)).toEqual([1, 2])
  })
})

describe('the shipped defaults', () => {
  it('are Texas practice as a starting point, and capped', () => {
    // Configuration, not law (D-10) — but an uncapped percentage is the one
    // shape that can run away, so the default must not be one.
    for (const shipped of DEFAULT_LATE_FEE_STEPS) {
      expect(shipped.capCents, `step ${shipped.step} is uncapped`).not.toBeNull()
    }
    expect(DEFAULT_LATE_FEE_STEPS.map((s) => s.daysPastDue)).toEqual([5, 30])
  })
})
