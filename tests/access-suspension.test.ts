import { describe, expect, it } from 'vitest'
import {
  describeRestore,
  describeSuspension,
  gateDecision,
  restoreShortfallCents,
  wouldRestoreAccess,
} from '../packages/core/access'

// PRD 02 §4.6 US-45, decided as D-16 (B-098). The decision that locks a paying
// customer out of their own property, or lets them back in.

function decide(overrides: Partial<Parameters<typeof gateDecision>[0]> = {}) {
  return gateDecision({
    state: 'active',
    daysPastDue: 10,
    balanceCents: 12_900,
    suspendAtDays: 6,
    restoreAtOrBelowCents: 0,
    onHold: false,
    ...overrides,
  })
}

describe('suspending', () => {
  it('suspends once the threshold is reached', () => {
    expect(decide({ daysPastDue: 6 })).toEqual({ action: 'suspend', daysPastDue: 6 })
  })

  it('does not suspend a day early', () => {
    expect(decide({ daysPastDue: 5 })).toMatchObject({
      action: 'none',
      reason: 'not_past_due_enough',
    })
  })

  it('needs an outstanding balance as well as the day count', () => {
    // A day count with a zero balance is a rounding artefact or a credit.
    // Locking someone out over it is the version of this that ends up in a
    // complaint rather than a payment.
    expect(decide({ daysPastDue: 40, balanceCents: 0 })).toMatchObject({
      action: 'none',
      reason: 'already_active',
    })
  })

  it('is disabled outright by a threshold of zero', () => {
    // A real operator choice — some sites never suspend.
    expect(decide({ suspendAtDays: 0, daysPastDue: 90 })).toMatchObject({
      action: 'none',
      reason: 'rule_disabled',
    })
  })

  it('never touches a grant that is pending or revoked', () => {
    // A revoked grant is final (PRD 03's state machine), and a pending one was
    // never issued.
    for (const state of ['pending', 'revoked']) {
      expect(decide({ state, daysPastDue: 90 })).toMatchObject({
        action: 'none',
        reason: 'not_suspendable',
      })
    }
  })
})

describe('the hold block', () => {
  it('blocks suspension outright, whatever the numbers say', () => {
    // US-42/US-45: an active hold declaring `halt_access_suspension` blocks
    // this rule. Checked first so no later branch can be reached past it.
    expect(decide({ onHold: true, daysPastDue: 400 })).toEqual({
      action: 'none',
      reason: 'on_hold',
    })
  })

  it('also holds a suspended grant where it is, rather than restoring it', () => {
    // Deliberate: a hold is not a payment. Lifting the suspension because a
    // hold appeared would let a hold act as a free pass, and the restore path
    // is the one that means "they paid".
    expect(decide({ state: 'suspended', onHold: true, balanceCents: 0 })).toEqual({
      action: 'none',
      reason: 'on_hold',
    })
  })
})

describe('restoring', () => {
  it('restores once the balance reaches zero', () => {
    expect(decide({ state: 'suspended', balanceCents: 0 })).toEqual({ action: 'restore' })
  })

  it('restores even though the day count has not moved', () => {
    // The day count is a historical fact about when they fell behind and does
    // not decrease when they settle — so a tenant who has paid in full must
    // come back in regardless of it.
    expect(decide({ state: 'suspended', daysPastDue: 90, balanceCents: 0 })).toEqual({
      action: 'restore',
    })
  })

  it('does not restore on a partial payment', () => {
    // D-16's rationale: any partial rule teaches a tenant to pay the minimum
    // that reopens the gate, every month.
    expect(decide({ state: 'suspended', balanceCents: 100 })).toMatchObject({
      action: 'none',
      reason: 'balance_outstanding',
    })
  })

  it('honours a facility that has relaxed the threshold', () => {
    // The setting exists so it CAN be relaxed without a migration (D-16).
    expect(
      decide({ state: 'suspended', balanceCents: 500, restoreAtOrBelowCents: 500 }),
    ).toEqual({ action: 'restore' })
  })

  it('restores a credit balance rather than treating it as outstanding', () => {
    expect(decide({ state: 'suspended', balanceCents: -2_000 })).toEqual({ action: 'restore' })
  })
})

describe('the sentence a person reads', () => {
  it('is US-45’s own wording', () => {
    expect(describeSuspension(12, new Date('2026-07-18T00:00:00.000Z'))).toBe(
      'Access suspended, 12 days past due, 2026-07-18',
    )
  })

  it('says "day" rather than "days" when there is one', () => {
    expect(describeSuspension(1, new Date('2026-07-18T00:00:00.000Z'))).toContain('1 day past due')
  })

  it('says what made it stop', () => {
    expect(describeRestore(new Date('2026-07-20T00:00:00.000Z'))).toBe(
      'Access restored, balance paid, 2026-07-20',
    )
  })
})

// B-232 / D-16. The number the portal, the dashboard banner and the suspension
// notice all say. Three places used to restate the DEFAULT threshold of zero as
// though it were the rule, on ONE lease's balance.
describe('restoreShortfallCents', () => {
  it('is the whole balance where the threshold is D-16\'s default of zero', () => {
    expect(
      restoreShortfallCents({ facilityBalanceCents: 48_750, restoreAtOrBelowCents: 0 }),
    ).toBe(48_750)
  })

  it('is what a relaxed threshold actually asks for, not the balance', () => {
    // The defect in one line: a site that set $50 was demanding $487.50 for
    // what $437.50 buys.
    expect(
      restoreShortfallCents({ facilityBalanceCents: 48_750, restoreAtOrBelowCents: 5_000 }),
    ).toBe(43_750)
  })

  it('is never negative — at or below the threshold there is nothing left to pay', () => {
    expect(
      restoreShortfallCents({ facilityBalanceCents: 2_000, restoreAtOrBelowCents: 5_000 }),
    ).toBe(0)
    expect(
      restoreShortfallCents({ facilityBalanceCents: -1_000, restoreAtOrBelowCents: 0 }),
    ).toBe(0)
  })

  it('agrees with gateDecision at the boundary, in both directions', () => {
    // The two must never disagree: this is the figure a tenant is TOLD will
    // reopen the gate, and `gateDecision` is what actually reopens it.
    const restoreAtOrBelowCents = 5_000
    for (const facilityBalanceCents of [4_999, 5_000, 5_001]) {
      const shortfall = restoreShortfallCents({ facilityBalanceCents, restoreAtOrBelowCents })
      const after = facilityBalanceCents - shortfall
      expect(
        gateDecision({
          state: 'suspended',
          daysPastDue: 20,
          balanceCents: after,
          suspendAtDays: 6,
          restoreAtOrBelowCents,
          onHold: false,
        }),
      ).toEqual({ action: 'restore' })
    }
  })
})

describe('wouldRestoreAccess', () => {
  it('says no to the partial payment that leaves the gate shut', () => {
    // The wasted trip, and the angriest call the office takes.
    expect(
      wouldRestoreAccess({
        facilityBalanceCents: 48_750,
        restoreAtOrBelowCents: 5_000,
        payingCents: 10_000,
      }),
    ).toBe(false)
  })

  it('says yes at exactly the shortfall, not only above it', () => {
    expect(
      wouldRestoreAccess({
        facilityBalanceCents: 48_750,
        restoreAtOrBelowCents: 5_000,
        payingCents: 43_750,
      }),
    ).toBe(true)
  })
})
