// PRD 10 §5.1/§5.4 (B-100). The referral program's rules, as pure functions.
//
// Everything here is decided without a database so the same logic answers a
// portal render, a qualification run and a test. The service layer gathers the
// facts; this file judges them.

/// PRD 10 §5.1: "8 characters from an alphabet excluding `0/O` and `1/I/l`, so
/// it survives being read aloud over a phone."
///
/// Also excludes `U` — not in the PRD, and added here because a code read over
/// a phone as "V" and heard as "U" is the same failure the PRD's own exclusions
/// exist to prevent. Uppercase only for the same reason: a code is dictated,
/// written on a napkin and typed back, and case is lost at every step.
export const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const REFERRAL_CODE_LENGTH = 8

/// PRD 10 §5.4. Every way a referral can fail to pay, as a closed set.
///
/// A closed set rather than free text because §5.7 requires staff to answer
/// "why didn't I get my $50" at the counter from the referral record, and a
/// reason somebody typed once cannot be reported on, filtered, or counted.
export const REFERRAL_REFUSALS = [
  'self_referral',
  'existing_tenant',
  'already_referred',
  'annual_cap_reached',
  'invite_expired',
  'invite_already_used',
  'different_facility',
  'program_disabled',
] as const

export type ReferralRefusal = (typeof REFERRAL_REFUSALS)[number]

/// PRD 10 §5.4 AC, and the backlog row states it as an acceptance criterion
/// rather than a nicety: "a refusal that does not say what would have qualified
/// is a 3.3.3 failure and a support call."
///
/// So each message says the RULE, not the outcome. "Not eligible" is the
/// version this codebase is explicitly forbidden from shipping — it tells the
/// tenant nothing they can act on and tells the staffer nothing they can
/// explain. Written for the referrer, because they are the one who asks.
export const REFERRAL_REFUSAL_MESSAGES: Record<ReferralRefusal, string> = {
  self_referral:
    'This referral was to your own account — the same email, phone number or card. A referral has to bring in someone new.',
  existing_tenant:
    'Your friend has rented with us before. The reward is for new customers only, so a returning tenant does not qualify.',
  already_referred:
    'Your friend was already referred by someone else. A person can be referred once, and the first referral is the one that counts.',
  annual_cap_reached:
    'You have reached the most referrals we can reward in a 12-month period. This one does not earn a credit, and the count resets as your earlier referrals pass their anniversary.',
  invite_expired:
    'That invite had expired by the time your friend moved in. Invites last a limited time — share a fresh one and it will count.',
  invite_already_used:
    'That invite had already been used by another friend. Each invite works once; your other invites are unaffected.',
  different_facility:
    'Your friend rented at a different location. The reward applies when you both rent at the same place.',
  program_disabled: 'The referral program is not running at this location right now.',
}

export type EligibilityFacts = {
  /// PRD 10 §6.1: `referralEnabled` defaults false, so the program is off
  /// until an operator turns it on.
  programEnabled: boolean
  /// Matched on email, phone last-10, or payment fingerprint (§5.4).
  isSelfReferral: boolean
  /// "A referee who has ever held a lease at this org is not a new tenant."
  refereeHasPriorLease: boolean
  /// "One qualifying referral per referee, ever."
  refereeAlreadyReferred: boolean
  /// Qualifying referrals this referrer has had in the rolling 12 months.
  referrerQualifiedLast12Months: number
  annualCap: number
  inviteExpired: boolean
  inviteAlreadyRedeemed: boolean
  /// "Both parties must be at the same facility unless the operator opts into
  /// cross-facility."
  sameFacility: boolean
  crossFacilityAllowed: boolean
}

export type Eligibility =
  | { qualifies: true }
  | { qualifies: false; refusal: ReferralRefusal; message: string }

/// Judged in the order a person would explain it, which is also roughly
/// cheapest-first: whether the program runs at all, then whether this is a real
/// referral, then whether this particular invite still works.
///
/// FIRST failing rule wins and is the one reported. A referral that breaks
/// three rules is still one conversation, and listing all three would bury the
/// one the tenant can do something about.
export function evaluateReferral(facts: EligibilityFacts): Eligibility {
  const refuse = (refusal: ReferralRefusal): Eligibility => ({
    qualifies: false,
    refusal,
    message: REFERRAL_REFUSAL_MESSAGES[refusal],
  })

  if (!facts.programEnabled) return refuse('program_disabled')
  // Before everything else about the invite: self-referral is the one that is
  // an attempt rather than a mistake, and it should read that way in reporting.
  if (facts.isSelfReferral) return refuse('self_referral')
  if (facts.refereeHasPriorLease) return refuse('existing_tenant')
  if (facts.refereeAlreadyReferred) return refuse('already_referred')
  if (facts.inviteAlreadyRedeemed) return refuse('invite_already_used')
  if (facts.inviteExpired) return refuse('invite_expired')
  if (!facts.sameFacility && !facts.crossFacilityAllowed) return refuse('different_facility')
  // Last, because it is the only refusal that is about the referrer's own
  // history rather than about this referral — and the only one that will pass
  // again later without anybody changing anything.
  if (facts.referrerQualifiedLast12Months >= facts.annualCap) return refuse('annual_cap_reached')

  return { qualifies: true }
}

/// PRD 10 §5.5. "Stacked discounts can never exceed the rent for the period.
/// The floor is zero, never a credit."
///
/// A referral reward stacks with a promotion deliberately — a promotion is a
/// price the business advertises, a referral reward is payment for work a
/// tenant did, and refusing to stack them means a friend referred during a
/// "first month free" campaign earns nothing.
export function cappedRewardCents(
  rewardCents: number,
  rentCents: number,
  otherDiscountsCents: number,
): number {
  const remaining = Math.max(0, rentCents - otherDiscountsCents)
  return Math.max(0, Math.min(rewardCents, remaining))
}
