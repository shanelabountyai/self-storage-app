import { describe, expect, it } from 'vitest'
import { currentStage, evaluate } from '../packages/core/delinquency/engine'
import type { TimelineStep } from '../packages/core/delinquency'

// B-057 / PRD 02 FR-5. Whether a lease advances tonight.

const step = (dayOffset: number, label: string): TimelineStep => ({
  dayOffset,
  label,
  automatedActions: [],
  noticeTemplateKey: null,
  deliveryMethods: [],
  staffTaskLabel: null,
  requiredProofFields: [],
})

const STEPS = [step(1, 'Late'), step(15, 'Pre-lien'), step(30, 'Lien'), step(60, 'Auction')]

const base = {
  steps: STEPS,
  daysPastDue: 20,
  qualifyingOutstandingCents: 12_900,
  leaseEnded: false,
  onHold: false,
  executedDays: [] as number[],
  executedToday: false,
  reversalGrace: false,
}

describe('evaluate — the halts, in order', () => {
  it('does nothing at all without a timeline', () => {
    // B-056's rule: a system not told what this state requires runs no lien
    // pipeline. Reported as a distinct reason, not as "nothing due".
    expect(evaluate({ ...base, steps: [] })).toEqual({ act: false, halt: 'no_timeline' })
  })

  it('stops on a hold before anything else is considered', () => {
    // Checked first so no later branch can be reached past it. A servicemember
    // under SCRA, or a debtor under an automatic stay, must not advance a step.
    expect(evaluate({ ...base, onHold: true, daysPastDue: 90 })).toEqual({
      act: false,
      halt: 'on_hold',
    })
  })

  it('treats a paid balance as cured, even on a lease that has ended', () => {
    // Cure is checked before move-out on purpose: somebody who paid on their
    // way out has cured, and recording that as a move-out loses that they
    // settled.
    expect(
      evaluate({ ...base, qualifyingOutstandingCents: 0, leaseEnded: true }),
    ).toEqual({ act: false, halt: 'cured' })
  })

  it('stops on a lease that ended still owing', () => {
    expect(evaluate({ ...base, leaseEnded: true })).toEqual({ act: false, halt: 'moved_out' })
  })

  it('holds the ladder while a returned payment is still being settled', () => {
    // B-161 / D-92. The invoice is re-opened at its ORIGINAL due date (D-25),
    // so a chargeback on a 90-day arrear arrives here at full age. Without the
    // gate this is the night four dunning letters go in the same post.
    expect(evaluate({ ...base, daysPastDue: 90, reversalGrace: true })).toEqual({
      act: false,
      halt: 'reversal_grace',
    })
  })

  it('still lets a tenant cure during the reversal grace window', () => {
    // The gate stops the ladder ADVANCING, not the episode closing. Somebody
    // who replaces the bounced cheque inside the window has cured.
    expect(
      evaluate({ ...base, qualifyingOutstandingCents: 0, reversalGrace: true }),
    ).toEqual({ act: false, halt: 'cured' })
  })
})

describe('evaluate — which steps fire', () => {
  it('fires the OLDEST step due, and only that one', () => {
    // B-161 reversed what this used to assert. Three steps were arithmetically
    // due here and all three fired in one pass, which is how one returned ACH
    // put four notices in the same post, cut the gate and opened an auction
    // case overnight. A ladder served all at once is not a ladder.
    const decision = evaluate({ ...base, daysPastDue: 30 })
    expect(decision.act).toBe(true)
    if (decision.act) {
      expect(decision.steps.map((one) => one.dayOffset)).toEqual([1])
    }
  })

  it('catches up a missed week one step a night, not all of it at once', () => {
    // The nightly job is still re-runnable and still catches up (FR-4) — it
    // now takes a night per step. B-161's deliberate cost: the alternative is
    // a lien file whose ninety days of notices all bear one date.
    const decision = evaluate({ ...base, daysPastDue: 40, executedDays: [1] })
    expect(decision.act && decision.steps.map((one) => one.dayOffset)).toEqual([15])
    const next = evaluate({ ...base, daysPastDue: 40, executedDays: [1, 15] })
    expect(next.act && next.steps.map((one) => one.dayOffset)).toEqual([30])
  })

  it('does nothing when a step has already run tonight', () => {
    // The other half of one-step-per-run. Steps 15 and 30 are both due, but
    // step 1 went out this evening — running the job twice must not put two
    // notices on one date.
    expect(evaluate({ ...base, daysPastDue: 40, executedDays: [1], executedToday: true })).toEqual({
      act: false,
      halt: null,
    })
  })

  it('never re-fires a step already executed', () => {
    expect(evaluate({ ...base, daysPastDue: 30, executedDays: [1, 15, 30] })).toEqual({
      act: false,
      halt: null,
    })
  })

  it('does nothing between steps, and calls it nothing rather than a halt', () => {
    // Past due but not yet at the next step. Not a halt — the pipeline is
    // running, it simply has nothing to do tonight.
    expect(evaluate({ ...base, daysPastDue: 5, executedDays: [1] })).toEqual({
      act: false,
      halt: null,
    })
  })

  it('fires nothing on a lease that is current', () => {
    expect(evaluate({ ...base, daysPastDue: 0, qualifyingOutstandingCents: 0 })).toEqual({
      act: false,
      halt: 'cured',
    })
  })
})

describe('currentStage', () => {
  it('is the furthest step passed, not the most recent one run', () => {
    // Catch-up runs them out of order in one pass; the stage is still the
    // furthest along.
    expect(currentStage(STEPS, [1, 30, 15])?.label).toBe('Lien')
  })

  it('is null before the first step', () => {
    expect(currentStage(STEPS, [])).toBeNull()
  })
})
