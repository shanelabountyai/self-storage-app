import { describe, expect, it } from 'vitest'
import {
  CHANGE_PROBLEM_MESSAGES,
  changeProblem,
  effectiveDateFor,
  scheduledNotice,
  type ProtectionSelection,
} from '../packages/core/billing'

// B-104 / PRD 01 US-705: "option to change tier (takes effect next billing
// cycle)". The parenthetical is the design, and every case below is a way of
// getting it wrong that a tenant or an operator would notice after a loss.

const PLAN: ProtectionSelection = {
  kind: 'plan',
  tier: 'standard',
  planName: 'Standard',
  premiumCents: 1_200,
}

const base = {
  selection: PLAN,
  availableTiers: ['basic', 'standard', 'premium'],
  currentPlanName: 'Basic',
  currentPremiumCents: 900,
  leaseIsActive: true,
  hasCurrentProof: false,
}

describe('effectiveDateFor', () => {
  it('is the start of the next period, not today', () => {
    // Requested mid-month on an anniversary lease billing on the 12th.
    expect(
      effectiveDateFor({
        policy: 'anniversary',
        billingDay: 12,
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      }).toISOString(),
    ).toBe('2026-09-12T00:00:00.000Z')
  })

  it('does not take effect today even when today IS the billing day', () => {
    // The invoice for this period may already have been raised this morning.
    // Applying a change to it would silently alter a bill already sent.
    expect(
      effectiveDateFor({
        policy: 'anniversary',
        billingDay: 12,
        requestedAt: new Date('2026-08-12T09:00:00Z'),
      }).toISOString(),
    ).toBe('2026-09-12T00:00:00.000Z')
  })

  it('follows the facility policy rather than the lease column', () => {
    // Under `first_of_month` the billing day is ignored, the same way
    // `billingPeriodFor` ignores it — a facility that switches policy must not
    // need every lease rewritten first.
    expect(
      effectiveDateFor({
        policy: 'first_of_month',
        billingDay: 20,
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      }).toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z')
  })

  it('rolls into the next year from December', () => {
    expect(
      effectiveDateFor({
        policy: 'first_of_month',
        billingDay: 1,
        requestedAt: new Date('2026-12-15T12:00:00Z'),
      }).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('changeProblem', () => {
  it('allows an ordinary tier change', () => {
    expect(changeProblem(base)).toBeNull()
  })

  it('refuses a tier the facility does not sell', () => {
    expect(
      changeProblem({ ...base, selection: { ...PLAN, tier: 'platinum' } }),
    ).toBe('unknown_tier')
  })

  it('refuses a no-op', () => {
    expect(
      changeProblem({ ...base, currentPlanName: 'Standard', currentPremiumCents: 1_200 }),
    ).toBe('no_change')
  })

  it('ALLOWS re-selecting the same plan at a new price', () => {
    // An operator repriced the tier. Re-selecting it is a legitimate way for a
    // tenant to accept the new premium, and calling it a no-op would leave them
    // no way to do so.
    expect(
      changeProblem({ ...base, currentPlanName: 'Standard', currentPremiumCents: 900 }),
    ).toBeNull()
  })

  it('refuses any change on a lease that has ended', () => {
    expect(changeProblem({ ...base, leaseIsActive: false })).toBe('lease_not_active')
  })

  describe('switching to the tenant’s own cover', () => {
    const waiver: ProtectionSelection = { kind: 'waiver' }

    it('refuses without current proof on file', () => {
      // Dropping a paid plan on an unverified claim is exactly the exposure
      // US-44 exists to close.
      expect(changeProblem({ ...base, selection: waiver, hasCurrentProof: false })).toBe(
        'waiver_needs_proof',
      )
    })

    it('allows it once proof is on file', () => {
      expect(
        changeProblem({ ...base, selection: waiver, hasCurrentProof: true }),
      ).toBeNull()
    })

    it('refuses when they are already on a waiver', () => {
      expect(
        changeProblem({
          ...base,
          selection: waiver,
          currentPlanName: null,
          currentPremiumCents: 0,
          hasCurrentProof: true,
        }),
      ).toBe('no_change')
    })
  })

  it('has a message for every problem it can return', () => {
    // A refusal with no sentence attached is a form that says "no" and nothing
    // else, which 3.3.3 treats as a failure.
    for (const key of Object.keys(CHANGE_PROBLEM_MESSAGES)) {
      expect(CHANGE_PROBLEM_MESSAGES[key as keyof typeof CHANGE_PROBLEM_MESSAGES]).toBeTruthy()
    }
  })
})

describe('scheduledNotice', () => {
  const formatDate = (date: Date) => date.toISOString().slice(0, 10)

  it('names the date and promises this month is unchanged', () => {
    const notice = scheduledNotice({
      selection: PLAN,
      effectiveFrom: new Date('2026-09-12T00:00:00Z'),
      formatDate,
    })
    // "Next month" is ambiguous on the 30th and wrong for a lease billing on
    // the 12th.
    expect(notice).toContain('2026-09-12')
    expect(notice).toMatch(/unchanged/i)
  })

  it('is explicit that a waiver stops the charge', () => {
    const notice = scheduledNotice({
      selection: { kind: 'waiver' },
      effectiveFrom: new Date('2026-09-01T00:00:00Z'),
      formatDate,
    })
    expect(notice).toMatch(/not be charged/i)
    expect(notice).toMatch(/unchanged/i)
  })
})
