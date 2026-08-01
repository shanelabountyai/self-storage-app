import { describe, expect, it } from 'vitest'
import {
  defaultTier,
  premiumFor,
  validateChoice,
  type PlanOption,
} from '../apps/web/lib/protection/plans'

// B-022 / PRD 02 US-44, PRD 01 US-501 step 3.

const PLANS: PlanOption[] = [
  { id: '1', tier: 'basic', name: '$2,000 cover', coverageCents: 200_000, premiumCents: 900 },
  { id: '2', tier: 'standard', name: '$3,000 cover', coverageCents: 300_000, premiumCents: 1_400 },
  { id: '3', tier: 'premium', name: '$5,000 cover', coverageCents: 500_000, premiumCents: 2_200 },
]

describe('defaultTier', () => {
  it('preselects the middle of what is actually on sale', () => {
    // US-501: "default selection is the mid-tier plan, changeable in one tap."
    expect(defaultTier(PLANS)).toBe('standard')
  })

  it('copes with an operator who sells two tiers, or four, or one', () => {
    // Not a hardcoded tier name — an operator is free to sell any number.
    expect(defaultTier(PLANS.slice(0, 1))).toBe('basic')
    expect(defaultTier(PLANS.slice(0, 2))).toBe('basic')
    expect(defaultTier([...PLANS, { ...PLANS[0], tier: 'max', premiumCents: 3_000 }])).toBe(
      'standard',
    )
  })

  it('returns null when the facility sells nothing', () => {
    expect(defaultTier([])).toBeNull()
  })
})

describe('validateChoice', () => {
  const validWaiver = {
    kind: 'waiver' as const,
    carrier: 'State Farm',
    policyNumber: 'SF-123456',
    expiresAt: '2027-01-01',
    attested: true,
  }

  it('will not let the step be skipped silently', () => {
    // US-501: the step cannot be skipped. An unanswered choice is an error with
    // a message, never a disabled button.
    expect(validateChoice({}, PLANS).protection).toBeDefined()
  })

  it('accepts a listed plan and rejects one that is not on sale', () => {
    expect(validateChoice({ kind: 'plan', tier: 'standard' }, PLANS)).toEqual({})
    expect(validateChoice({ kind: 'plan', tier: 'gold' }, PLANS).protection).toBeDefined()
  })

  it('requires a real record to waive, not just a tick', () => {
    // The whole point of US-44: without carrier, policy number and an expiry
    // there is nothing for the lapse scan to read and nothing to show in a
    // coverage argument.
    const errors = validateChoice({ kind: 'waiver', attested: true }, PLANS)
    expect(errors.carrier).toBeDefined()
    expect(errors.policyNumber).toBeDefined()
    expect(errors.expiresAt).toBeDefined()
  })

  it('refuses cover that has already run out', () => {
    const errors = validateChoice({ ...validWaiver, expiresAt: '2020-01-01' }, PLANS)
    expect(errors.expiresAt).toMatch(/already run out/)
  })

  it('requires the attestation, as an error rather than a disabled button', () => {
    // 3.3.1: a control that cannot be pressed, with no message, is invisible to
    // someone who cannot see why.
    const errors = validateChoice({ ...validWaiver, attested: false }, PLANS)
    expect(errors.attested).toBeDefined()
  })

  it('accepts a complete waiver', () => {
    expect(validateChoice(validWaiver, PLANS)).toEqual({})
  })

  it('gives every message a suggestion', () => {
    const errors = validateChoice({ kind: 'waiver' }, PLANS)
    expect(errors.carrier).toMatch(/for example/)
    expect(errors.policyNumber).toMatch(/declaration page/)
    expect(errors.expiresAt).toMatch(/yyyy-mm-dd/)
  })
})

describe('premiumFor', () => {
  it('bills the chosen tier monthly', () => {
    expect(premiumFor({ kind: 'plan', tier: 'premium' }, PLANS)).toBe(2_200)
  })

  it('bills nothing for a waiver', () => {
    expect(
      premiumFor(
        { kind: 'waiver', carrier: 'X', policyNumber: 'Y', expiresAt: '2027-01-01', attested: true },
        PLANS,
      ),
    ).toBe(0)
  })

  it('bills nothing for a tier that is no longer on sale', () => {
    // Rather than throwing mid-checkout. The choice is re-validated before it
    // reaches here, so this is the belt to that braces.
    expect(premiumFor({ kind: 'plan', tier: 'gone' }, PLANS)).toBe(0)
  })
})
