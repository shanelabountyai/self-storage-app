import { describe, expect, it } from 'vitest'
import {
  auctionReadiness,
  missingBuyerFields,
  type ReadinessInput,
  type StepEvidence,
} from '../packages/core/auctions/readiness'
import {
  canRecordDisposition,
  surplusHoldUntil,
  surplusObligation,
} from '../packages/core/auctions/surplus'

// B-062 / PRD 02 §4.6 US-28. "The system hard-blocks scheduling if any required
// step lacks proof."

function step(overrides: Partial<StepEvidence> = {}): StepEvidence {
  return {
    dayOffset: 30,
    label: 'Lien notice',
    staffTaskLabel: 'Mail it',
    requiredProofFields: ['tracking_number'],
    executed: true,
    task: { status: 'completed', proof: { tracking_number: '9400 1234' } },
    ...overrides,
  }
}

function ready(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    timelineConfigured: true,
    steps: [step()],
    containsVehicle: false,
    lienNoticeServed: true,
    approved: true,
    outstandingCents: 60_000,
    status: 'eligible',
    ...overrides,
  }
}

describe('auctionReadiness — the happy path', () => {
  it('is ready when every rule is satisfied', () => {
    expect(auctionReadiness(ready())).toEqual({ ready: true, blockers: [] })
  })
})

describe('auctionReadiness — the hard blocks', () => {
  it('blocks a unit containing a vehicle, and says why it cannot be worked around', () => {
    // "Running one silently through this pipeline is a wrongful sale by
    // construction." No override exists anywhere in the codebase.
    const result = auctionReadiness(ready({ containsVehicle: true }))
    expect(result.ready).toBe(false)
    const blocker = result.blockers.find((one) => one.kind === 'contains_vehicle')!
    expect(blocker.message).toContain('separate')
    expect(blocker.message.toLowerCase()).toContain('vehicle lien process')
  })

  it('blocks a step that never ran', () => {
    const result = auctionReadiness(ready({ steps: [step({ executed: false })] }))
    expect(result.blockers.map((one) => one.kind)).toContain('step_not_executed')
  })

  it('blocks a staff step with no completed task', () => {
    const result = auctionReadiness(ready({ steps: [step({ task: null })] }))
    expect(result.blockers.map((one) => one.kind)).toContain('step_lacks_proof')
  })

  it('blocks a step whose task is still open', () => {
    const result = auctionReadiness(
      ready({ steps: [step({ task: { status: 'open', proof: null } })] }),
    )
    expect(result.blockers.map((one) => one.kind)).toContain('step_lacks_proof')
  })

  it('blocks a completed task that is MISSING its required proof', () => {
    // The AC's exact wording: "hard-blocks scheduling if any required step
    // lacks proof". Completed is not the same as evidenced.
    const result = auctionReadiness(
      ready({ steps: [step({ task: { status: 'completed', proof: { note: 'did it' } } })] }),
    )
    const blocker = result.blockers.find((one) => one.kind === 'step_lacks_proof')!
    expect(blocker.message).toContain('tracking_number')
  })

  it('treats blank proof as missing', () => {
    const result = auctionReadiness(
      ready({ steps: [step({ task: { status: 'completed', proof: { tracking_number: '  ' } } })] }),
    )
    expect(result.blockers.map((one) => one.kind)).toContain('step_lacks_proof')
  })

  it('does not demand proof from a step that never asked for a person', () => {
    // An automated step's evidence is the step run itself.
    const automated = step({ staffTaskLabel: null, requiredProofFields: [], task: null })
    expect(auctionReadiness(ready({ steps: [automated] })).ready).toBe(true)
  })

  it('blocks when no lien notice was served', () => {
    const result = auctionReadiness(ready({ lienNoticeServed: false }))
    expect(result.blockers.map((one) => one.kind)).toContain('no_lien_notice_served')
  })

  it('blocks without regional or owner approval', () => {
    const result = auctionReadiness(ready({ approved: false }))
    expect(result.blockers.map((one) => one.kind)).toContain('not_approved')
  })

  it('blocks a lease that owes nothing — a tenant who paid is not auctionable', () => {
    const result = auctionReadiness(ready({ outstandingCents: 0 }))
    expect(result.blockers.map((one) => one.kind)).toContain('balance_settled')
  })

  it('blocks when the facility never configured a timeline', () => {
    // Selling somebody's belongings on a schedule nobody configured.
    const result = auctionReadiness(ready({ timelineConfigured: false }))
    expect(result.blockers.map((one) => one.kind)).toContain('no_timeline')
  })

  it('blocks a case already sold or cancelled', () => {
    expect(auctionReadiness(ready({ status: 'sold' })).blockers.map((one) => one.kind)).toContain(
      'already_sold',
    )
    expect(auctionReadiness(ready({ status: 'cancelled' })).blockers.map((one) => one.kind)).toContain(
      'cancelled',
    )
  })

  it('reports EVERY blocker at once, not the first', () => {
    // A manager fixing one blocker per round, discovering the next each time,
    // is how a deadline gets missed and a corner gets cut.
    const result = auctionReadiness(
      ready({
        containsVehicle: true,
        approved: false,
        lienNoticeServed: false,
        steps: [step({ executed: false }), step({ dayOffset: 45, label: 'Second', executed: false })],
      }),
    )
    expect(result.blockers.length).toBeGreaterThanOrEqual(5)
    expect(new Set(result.blockers.map((one) => one.kind)).size).toBeGreaterThanOrEqual(4)
  })

  it('names the step so a manager can go and fix it', () => {
    const result = auctionReadiness(
      ready({ steps: [step({ dayOffset: 15, label: 'Pre-lien notice', executed: false })] }),
    )
    const blocker = result.blockers.find((one) => one.kind === 'step_not_executed')!
    expect(blocker.dayOffset).toBe(15)
    expect(blocker.label).toBe('Pre-lien notice')
  })
})

describe('missingBuyerFields — US-28’s buyer record', () => {
  const complete = {
    name: 'Ida Buyer',
    addressLine1: '10 Market Street',
    city: 'Austin',
    state: 'TX',
    postalCode: '78704',
    governmentIdReference: 'TX DL ****1234',
    paymentMethod: 'cash',
    cleanoutDeadline: new Date('2026-09-01'),
  }

  it('accepts a complete record', () => {
    expect(missingBuyerFields(complete)).toEqual([])
  })

  it.each(['name', 'addressLine1', 'city', 'state', 'postalCode', 'governmentIdReference', 'paymentMethod'])(
    'requires %s',
    (field) => {
      expect(missingBuyerFields({ ...complete, [field]: '' })).toContain(field)
    },
  )

  it('requires the cleanout deadline and its forfeit terms date', () => {
    expect(missingBuyerFields({ ...complete, cleanoutDeadline: null })).toContain('cleanoutDeadline')
  })

  it('does not ask for a resale certificate from a buyer paying tax', () => {
    expect(missingBuyerFields({ ...complete, taxExempt: false })).toEqual([])
  })

  it('REQUIRES the resale certificate from a buyer claiming exemption', () => {
    // "A sales-tax return on auction proceeds cannot be filed without it" —
    // and the facility carries the liability if it cannot be produced.
    expect(missingBuyerFields({ ...complete, taxExempt: true })).toEqual(['resaleCertificateReference'])
    expect(
      missingBuyerFields({ ...complete, taxExempt: true, resaleCertificateReference: 'RC-99' }),
    ).toEqual([])
  })
})

describe('surplus — a liability with a statutory life', () => {
  const soldAt = new Date('2026-08-01T00:00:00Z')

  it('computes the hold deadline from the facility’s configured period', () => {
    expect(surplusHoldUntil(soldAt, 90)).toEqual(new Date('2026-10-30T00:00:00Z'))
  })

  it('reports nothing outstanding when there was no surplus', () => {
    const obligation = surplusObligation(
      { surplusCents: 0, disposition: 'no_surplus', holdUntil: null, notifiedAt: null },
      soldAt,
    )
    expect(obligation.outstanding).toBe(false)
  })

  it('wants the former tenant notified first', () => {
    const obligation = surplusObligation(
      {
        surplusCents: 25_000,
        disposition: 'held',
        holdUntil: surplusHoldUntil(soldAt, 365),
        notifiedAt: null,
      },
      soldAt,
    )
    expect(obligation.outstanding).toBe(true)
    expect(obligation.outstandingActions[0]).toContain('Notify')
    expect(obligation.overdue).toBe(false)
  })

  it('goes overdue when the holding period runs out with no disposition', () => {
    // The state that becomes a class action.
    const obligation = surplusObligation(
      {
        surplusCents: 25_000,
        disposition: 'held',
        holdUntil: surplusHoldUntil(soldAt, 30),
        notifiedAt: soldAt,
      },
      new Date('2026-10-01T00:00:00Z'),
    )
    expect(obligation.overdue).toBe(true)
    expect(obligation.outstandingActions.join(' ')).toContain('remitted to the state')
  })

  it('is settled once claimed or remitted', () => {
    for (const disposition of ['claimed', 'remitted'] as const) {
      const obligation = surplusObligation(
        { surplusCents: 25_000, disposition, holdUntil: soldAt, notifiedAt: soldAt },
        new Date('2027-01-01T00:00:00Z'),
      )
      expect(obligation.outstanding).toBe(false)
      expect(obligation.overdue).toBe(false)
    }
  })

  it('refuses to declare a real surplus "no surplus"', () => {
    // Otherwise a real surplus could be closed out by declaring it never
    // existed.
    const verdict = canRecordDisposition(25_000, 'no_surplus')
    expect(verdict.allowed).toBe(false)
  })

  it('refuses "held" as a disposition — it is the starting state', () => {
    expect(canRecordDisposition(25_000, 'held').allowed).toBe(false)
  })

  it('refuses any disposition when no surplus arose', () => {
    expect(canRecordDisposition(0, 'claimed').allowed).toBe(false)
  })

  it('allows claimed and remitted against a real surplus', () => {
    expect(canRecordDisposition(25_000, 'claimed')).toEqual({ allowed: true })
    expect(canRecordDisposition(25_000, 'remitted')).toEqual({ allowed: true })
  })
})
