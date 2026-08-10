import { describe, expect, it } from 'vitest'
import {
  AUTOMATED_ACTIONS,
  EXAMPLE_TIMELINE_LABEL,
  EXAMPLE_TIMELINE_STEPS,
  isOverlockStep,
  orderedSteps,
  stepsDue,
  TIMELINE_DISCLAIMER,
  validateTimeline,
  type TimelineStep,
} from '../packages/core/delinquency/timeline'

// B-056 / PRD 02 §4.6 US-25, US-29.

function step(overrides: Partial<TimelineStep> = {}): TimelineStep {
  return {
    dayOffset: 10,
    label: 'Overlock',
    automatedActions: [],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: null,
    requiredProofFields: [],
    ...overrides,
  }
}

describe('validateTimeline — US-25', () => {
  it('accepts a plain automatic step', () => {
    expect(validateTimeline([step({ automatedActions: ['assess_late_fee'] })])).toEqual([])
  })

  it('refuses an empty timeline', () => {
    expect(validateTimeline([])).toHaveLength(1)
  })

  it('refuses two steps on the same day', () => {
    // The order between them would decide whether a fee lands before or after a
    // notice that quotes the balance.
    const problems = validateTimeline([step({ dayOffset: 15 }), step({ dayOffset: 15, label: 'Other' })])
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toContain('already has a step')
  })

  it('refuses a step that sends a notice with no template', () => {
    const problems = validateTimeline([step({ automatedActions: ['send_notice'] })])
    expect(problems.some((one) => one.problem.includes('no template'))).toBe(true)
  })

  it('refuses a notice with no way to deliver it', () => {
    // Generated, filed, and never reaching the tenant — the exact failure a
    // lien file cannot survive, and it looks like success on every screen.
    const problems = validateTimeline([
      step({ automatedActions: ['send_notice'], noticeTemplateKey: 'pre_lien_notice' }),
    ])
    expect(problems.some((one) => one.problem.includes('delivered'))).toBe(true)
  })

  it('refuses a staff task with no proof', () => {
    const problems = validateTimeline([step({ staffTaskLabel: 'Apply the overlock' })])
    expect(problems.some((one) => one.problem.includes('proof'))).toBe(true)
  })

  it('refuses a template that does not exist', () => {
    // The whole reason the known-key list is threaded through: a typed key that
    // resolves to nothing is a step which reads as "sends a notice" on every
    // screen and sends none.
    const problems = validateTimeline(
      [step({ automatedActions: ['send_notice'], noticeTemplateKey: 'made_up', deliveryMethods: ['email'] })],
      ['dunning_step', 'access_suspended'],
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toContain('no message template called')
  })

  it('accepts a template that does exist', () => {
    expect(
      validateTimeline(
        [step({ automatedActions: ['send_notice'], noticeTemplateKey: 'dunning_step', deliveryMethods: ['email'] })],
        ['dunning_step'],
      ),
    ).toEqual([])
  })

  it('does not check template keys when no list is supplied', () => {
    // The pure rules stay usable without a database; the service always passes
    // the list, so the check is not optional in practice.
    expect(
      validateTimeline([
        step({ automatedActions: ['send_notice'], noticeTemplateKey: 'anything', deliveryMethods: ['email'] }),
      ]),
    ).toEqual([])
  })

  it('refuses proof nobody is asked to produce', () => {
    const problems = validateTimeline([step({ requiredProofFields: ['tracking_number'] })])
    expect(problems.some((one) => one.problem.includes('no staff task'))).toBe(true)
  })

  it('refuses a negative or fractional day', () => {
    expect(validateTimeline([step({ dayOffset: -1 })])).not.toEqual([])
    expect(validateTimeline([step({ dayOffset: 1.5 })])).not.toEqual([])
  })

  it('refuses a nameless step', () => {
    expect(validateTimeline([step({ label: '  ' })])).not.toEqual([])
  })

  it('reports the index so a person can find the row', () => {
    const problems = validateTimeline([step(), step({ dayOffset: 20, label: '' })])
    expect(problems[0].index).toBe(1)
  })
})

describe('ordering and firing', () => {
  const steps = [
    step({ dayOffset: 30, label: 'Lien' }),
    step({ dayOffset: 1, label: 'Late' }),
    step({ dayOffset: 15, label: 'Pre-lien' }),
  ]

  it('sorts by day rather than trusting the list order', () => {
    // US-25 makes steps re-orderable, so firing must not depend on the order
    // somebody happened to drag them into.
    expect(orderedSteps(steps).map((one) => one.label)).toEqual(['Late', 'Pre-lien', 'Lien'])
  })

  it('reports which steps a lease has passed and what is next', () => {
    const result = stepsDue(steps, 20)
    expect(result.due.map((one) => one.label)).toEqual(['Late', 'Pre-lien'])
    expect(result.next?.label).toBe('Lien')
  })

  it('does not re-fire a step already executed', () => {
    const result = stepsDue(steps, 20, [1])
    expect(result.due.map((one) => one.label)).toEqual(['Pre-lien'])
  })

  it('has no next step past the end of the timeline', () => {
    expect(stepsDue(steps, 90).next).toBeNull()
  })

  it('fires nothing for a lease that is current', () => {
    expect(stepsDue(steps, 0).due).toEqual([])
  })
})

describe('US-29 — the guardrails', () => {
  it('labels the default as an example, in its own name', () => {
    // "No default timeline is presented as legally compliant; defaults are
    // labeled 'example configuration'."
    expect(EXAMPLE_TIMELINE_LABEL.toLowerCase()).toContain('example')
    expect(EXAMPLE_TIMELINE_LABEL.toLowerCase()).toContain('not legal advice')
  })

  it('says plainly that nothing here is compliant with any state', () => {
    const text = TIMELINE_DISCLAIMER.toLowerCase()
    // The three things it has to say: this is not advice, a lawyer has to look,
    // and which state matters. Asserted by substance rather than by exact
    // wording — the prose can improve, the claims cannot weaken.
    expect(text).toContain('legal advice')
    expect(text).toContain('attorney')
    expect(text).toContain('state')
    expect(text).toContain('reviewed')
  })

  it('ships an example that would actually pass its own validation', () => {
    // A default that could not be saved would send an operator hunting for a
    // problem in a file they cannot edit. Checked against the templates that
    // really are seeded, so the example cannot drift into naming one that is
    // not.
    const SEEDED = ['dunning_step', 'access_suspended', 'invoice_due_soon', 'payment_failed']
    expect(validateTimeline(EXAMPLE_TIMELINE_STEPS, SEEDED)).toEqual([])
  })

  it('never routes a statutory notice through the email pipeline', () => {
    // `noticeTemplateKey` names a MESSAGE template, and `send_notice` emails
    // it. Since B-061 the statutory pre-lien and lien notices are DOCUMENTS
    // with their own templates, served by mail, hashed, and evidenced with the
    // address they rendered to — and US-13 makes notice-by-email its own
    // consent type precisely so they cannot be emailed without permission.
    //
    // Naming a key here would route the statutory notice through a path with
    // no consent check and no delivery proof. So these stay staff tasks that
    // point at the notices screen.
    const lienSteps = EXAMPLE_TIMELINE_STEPS.filter((one) => /lien/i.test(one.label))
    expect(lienSteps.length).toBeGreaterThan(0)
    for (const lien of lienSteps) {
      expect(lien.noticeTemplateKey).toBeNull()
      expect(lien.automatedActions).not.toContain('send_notice')
      // Still happens — by hand, with proof recorded.
      expect(lien.staffTaskLabel).toBeTruthy()
      expect(lien.requiredProofFields).toContain('tracking_number')
    }
  })

  it('has an overlock step the engine will actually recognise', () => {
    // B-058 routes overlock steps to a typed task that creates the record
    // making a unit read as `overlocked`, and it identifies them by label.
    // Rename the example's step and it silently degrades to a generic task
    // with no record behind it — this fails first.
    const overlock = EXAMPLE_TIMELINE_STEPS.filter(isOverlockStep)
    expect(overlock).toHaveLength(1)
    expect(overlock[0].staffTaskLabel).toBeTruthy()
  })

  it('does not mistake a lien notice for an overlock', () => {
    const lien = EXAMPLE_TIMELINE_STEPS.filter((one) => /lien/i.test(one.label))
    for (const step of lien) expect(isOverlockStep(step)).toBe(false)
  })

  it('names only actions the engine can perform', () => {
    // A timeline naming an action nothing implements is a configuration screen
    // that silently does nothing on day 30.
    for (const example of EXAMPLE_TIMELINE_STEPS) {
      for (const action of example.automatedActions) {
        expect(AUTOMATED_ACTIONS).toContain(action)
      }
    }
  })

  it('reaches auction eligibility behind a staff approval, never automatically', () => {
    const auction = EXAMPLE_TIMELINE_STEPS.find((one) =>
      one.automatedActions.includes('flag_auction_eligible'),
    )!
    expect(auction.staffTaskLabel).toBeTruthy()
    expect(auction.requiredProofFields.length).toBeGreaterThan(0)
  })
})
