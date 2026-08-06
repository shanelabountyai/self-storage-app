import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DUNNING_DAYS,
  dunningStepsDue,
  ladderDecision,
  stepsFrom,
} from '../packages/core/billing'

// PRD 05 CN-3 / CN-5 (B-052). The ladder.

const steps = stepsFrom(DEFAULT_DUNNING_DAYS)

function decide(overrides: Partial<Parameters<typeof ladderDecision>[0]> = {}) {
  return ladderDecision({
    daysPastDue: 10,
    outstandingCents: 12_900,
    leaseEnded: false,
    onHold: false,
    steps,
    alreadySent: [],
    ...overrides,
  })
}

describe('the default ladder', () => {
  it('is CN-3’s day 1, 5, 10, 30', () => {
    expect(steps.map((step) => step.day)).toEqual([1, 5, 10, 30])
    expect(steps.map((step) => step.position)).toEqual([1, 2, 3, 4])
  })

  it('sorts and discards nonsense rather than trusting the order given', () => {
    expect(stepsFrom([30, 1, 0, -5, 10]).map((step) => step.day)).toEqual([1, 10, 30])
  })
})

describe('dunningStepsDue', () => {
  it('sends nothing before the first day', () => {
    expect(dunningStepsDue(0, steps)).toEqual([])
  })

  it('sends a step on the day it is reached', () => {
    expect(dunningStepsDue(1, steps).map((s) => s.day)).toEqual([1])
  })

  it('never repeats a step already sent', () => {
    // CN-3's "at most once per invoice per step".
    expect(dunningStepsDue(5, steps, [1, 5])).toEqual([])
  })

  it('sends every step missed while nothing ran, in order', () => {
    // A lease that aged past three steps during an outage is chased in
    // sequence rather than handed the day-30 letter with no warning before it.
    expect(dunningStepsDue(30, steps).map((s) => s.day)).toEqual([1, 5, 10, 30])
  })

  it('keys on the day, so inserting a step does not re-fire the sent ones', () => {
    const withExtra = stepsFrom([1, 3, 5, 10, 30])
    expect(dunningStepsDue(10, withExtra, [1, 5, 10]).map((s) => s.day)).toEqual([3])
  })
})

describe('the halts — CN-5', () => {
  it('halts on a settled balance, whatever the day count says', () => {
    // "A payment at 11:58pm must suppress the midnight step." The day count is
    // a historical fact that does not decrease when someone pays.
    expect(decide({ outstandingCents: 0, daysPastDue: 90 })).toEqual({
      send: false,
      halt: 'settled',
    })
  })

  it('halts on a credit balance too', () => {
    expect(decide({ outstandingCents: -500 })).toMatchObject({ halt: 'settled' })
  })

  it('halts on move-out', () => {
    expect(decide({ leaseEnded: true })).toEqual({ send: false, halt: 'moved_out' })
  })

  it('halts on a hold, evaluated by effect rather than by type', () => {
    expect(decide({ onHold: true, daysPastDue: 400 })).toEqual({ send: false, halt: 'on_hold' })
  })

  it('checks move-out and the hold before the money', () => {
    // A lease that has ended is not chased even with a balance outstanding.
    expect(decide({ leaseEnded: true, outstandingCents: 50_000 })).toMatchObject({
      halt: 'moved_out',
    })
  })

  it('reports no halt when there is simply nothing due yet', () => {
    // Distinct from a halt: nothing has stopped, the ladder just has not
    // reached a rung. The run should not log it as a halt.
    expect(decide({ daysPastDue: 0 })).toEqual({ send: false, halt: null })
  })
})

describe('sending', () => {
  it('returns the steps to send, in ladder order', () => {
    const decision = decide({ daysPastDue: 10 })
    expect(decision.send).toBe(true)
    if (!decision.send) throw new Error('unreachable')
    expect(decision.steps.map((s) => s.day)).toEqual([1, 5, 10])
  })

  it('sends only what is left after earlier steps', () => {
    const decision = decide({ daysPastDue: 10, alreadySent: [1, 5] })
    if (!decision.send) throw new Error('unreachable')
    expect(decision.steps.map((s) => s.day)).toEqual([10])
  })

  it('sends nothing when the facility configured no ladder', () => {
    expect(decide({ steps: [], daysPastDue: 90 })).toEqual({ send: false, halt: null })
  })
})
