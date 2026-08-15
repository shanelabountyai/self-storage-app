import { describe, expect, it } from 'vitest'
import {
  cappedRewardCents,
  evaluateReferral,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REFUSALS,
  REFERRAL_REFUSAL_MESSAGES,
  type EligibilityFacts,
} from '../packages/core/referrals'

// B-100 / PRD 10 §5.1, §5.4, §5.5. The rules, as pure functions.

/// Everything passing. Each test breaks exactly one thing, so a failure names
/// the rule rather than the fixture.
function facts(overrides: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return {
    programEnabled: true,
    isSelfReferral: false,
    refereeHasPriorLease: false,
    refereeAlreadyReferred: false,
    referrerQualifiedLast12Months: 0,
    annualCap: 10,
    inviteExpired: false,
    inviteAlreadyRedeemed: false,
    sameFacility: true,
    crossFacilityAllowed: false,
    ...overrides,
  }
}

describe('the referral code alphabet — FR-REF-1', () => {
  it('excludes every character that is ambiguous read aloud', () => {
    // The PRD names 0/O and 1/I/l. U is excluded too, because "V" dictated
    // over a phone is heard as "U" — the same failure the PRD's own
    // exclusions exist to prevent.
    for (const char of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(REFERRAL_CODE_ALPHABET, `${char} should not be in the alphabet`).not.toContain(char)
    }
  })

  it('is uppercase only, so case cannot be lost in transit', () => {
    // A code is dictated, written on a napkin and typed back.
    expect(REFERRAL_CODE_ALPHABET).toBe(REFERRAL_CODE_ALPHABET.toUpperCase())
  })

  it('is eight characters, per the AC', () => {
    expect(REFERRAL_CODE_LENGTH).toBe(8)
  })

  it('leaves enough space that guessing a live code is not a strategy', () => {
    // 30^8 ≈ 6.6e11. Worth asserting because shrinking the alphabet for
    // readability is exactly the change somebody makes without doing this
    // arithmetic, and a referral code is worth $50.
    expect(REFERRAL_CODE_ALPHABET.length ** REFERRAL_CODE_LENGTH).toBeGreaterThan(1e11)
  })
})

describe('evaluateReferral — FR-REF-4', () => {
  it('qualifies when every rule passes', () => {
    expect(evaluateReferral(facts())).toEqual({ qualifies: true })
  })

  // Each rule, one at a time. The message assertions matter as much as the
  // refusal keys: the backlog row makes "says what would have qualified" an
  // acceptance criterion, not a nicety.
  const cases: [keyof EligibilityFacts | string, Partial<EligibilityFacts>, string][] = [
    ['program off', { programEnabled: false }, 'program_disabled'],
    ['self referral', { isSelfReferral: true }, 'self_referral'],
    ['returning tenant', { refereeHasPriorLease: true }, 'existing_tenant'],
    ['already referred', { refereeAlreadyReferred: true }, 'already_referred'],
    ['invite spent', { inviteAlreadyRedeemed: true }, 'invite_already_used'],
    ['invite expired', { inviteExpired: true }, 'invite_expired'],
    ['other facility', { sameFacility: false }, 'different_facility'],
    ['at the cap', { referrerQualifiedLast12Months: 10, annualCap: 10 }, 'annual_cap_reached'],
  ]

  for (const [label, override, expected] of cases) {
    it(`refuses ${label} with the reason "${expected}"`, () => {
      const result = evaluateReferral(facts(override))
      expect(result.qualifies).toBe(false)
      if (result.qualifies) throw new Error('unreachable')
      expect(result.refusal).toBe(expected)
      expect(result.message).toBe(REFERRAL_REFUSAL_MESSAGES[result.refusal])
    })
  }

  it('allows a cross-facility referral when the operator opted in', () => {
    expect(evaluateReferral(facts({ sameFacility: false, crossFacilityAllowed: true }))).toEqual({
      qualifies: true,
    })
  })

  it('counts the cap as a ceiling reached, not exceeded', () => {
    // Off-by-one on a money rule: 9 of 10 still pays, 10 of 10 does not.
    expect(evaluateReferral(facts({ referrerQualifiedLast12Months: 9, annualCap: 10 })).qualifies).toBe(true)
    expect(evaluateReferral(facts({ referrerQualifiedLast12Months: 10, annualCap: 10 })).qualifies).toBe(false)
  })

  it('reports the first failing rule when several fail at once', () => {
    // One conversation, not three. A referral that breaks every rule is still
    // answered with the one the tenant can act on first.
    const result = evaluateReferral(
      facts({ programEnabled: false, isSelfReferral: true, inviteExpired: true }),
    )
    expect(result.qualifies).toBe(false)
    if (result.qualifies) throw new Error('unreachable')
    expect(result.refusal).toBe('program_disabled')
  })
})

describe('every refusal is explainable — the 3.3.3 acceptance criterion', () => {
  it('has a message for every refusal in the closed set', () => {
    for (const refusal of REFERRAL_REFUSALS) {
      expect(REFERRAL_REFUSAL_MESSAGES[refusal], refusal).toBeTruthy()
    }
  })

  it('never ships a message that only says "not eligible"', () => {
    // The row forbids this in as many words: "stated as an acceptance
    // criterion, not softened at build time into a generic 'not eligible'".
    // A refusal that does not say what would have qualified is a support call.
    for (const [refusal, message] of Object.entries(REFERRAL_REFUSAL_MESSAGES)) {
      expect(message.toLowerCase(), refusal).not.toContain('not eligible')
      // Long enough to carry a reason. Every real message here names the rule;
      // a terse one would be the regression this catches.
      expect(message.length, refusal).toBeGreaterThan(40)
      expect(message.trim().endsWith('.'), `${refusal} should be a sentence`).toBe(true)
    }
  })
})

describe('cappedRewardCents — FR-REF-5', () => {
  const RENT = 12_900

  it('pays the full reward when the rent covers it', () => {
    expect(cappedRewardCents(5_000, RENT, 0)).toBe(5_000)
  })

  it('stacks with a promotion rather than refusing to', () => {
    // The argument the PRD makes: a promotion is a price the business
    // advertises; a referral reward is payment for work a tenant did.
    expect(cappedRewardCents(5_000, RENT, 3_000)).toBe(5_000)
  })

  it('never takes the invoice below zero', () => {
    // "The floor is zero, never a credit."
    expect(cappedRewardCents(5_000, RENT, 10_000)).toBe(2_900)
    expect(cappedRewardCents(5_000, RENT, RENT)).toBe(0)
    expect(cappedRewardCents(5_000, RENT, 99_999)).toBe(0)
  })

  it('never returns a negative reward', () => {
    expect(cappedRewardCents(-100, RENT, 0)).toBe(0)
  })
})
