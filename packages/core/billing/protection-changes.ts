import { billingPeriodFor, nextBillingPeriod, type BillingPolicy } from './periods.ts'

// PRD 01 US-705 (B-104): "insurance/protection selection visible with option to
// change tier (takes effect next billing cycle) or submit proof of own
// insurance."
//
// The parenthetical is the whole design. A protection premium is a flat monthly
// charge on the invoice, not a metered one, so changing it mid-period would
// mean prorating a premium — and a prorated premium is a coverage question, not
// an arithmetic one: was the tenant covered to $2,000 or $5,000 on the 14th?
// Nobody wants to answer that after a fire. So a change is SCHEDULED to the
// start of the next period and the current period is left exactly as billed.
//
// The same rule protects the operator in the other direction: a tenant cannot
// upgrade to $5,000 of cover the morning after a break-in and have it apply to
// the month just gone.

export type ProtectionSelection =
  | { kind: 'plan'; tier: string; planName: string; premiumCents: number }
  /// The tenant carries their own cover. Premium is zero; the evidence lives in
  /// `ProtectionWaiver` and is what D-17's lapse scan reads.
  | { kind: 'waiver' }

/// When a change requested now takes effect.
///
/// Always the start of the NEXT billing period, never today — even when today
/// happens to be the first day of a period. A change requested at 9am on the
/// 1st, after that morning's invoice has already been raised, must not silently
/// alter a bill the tenant has been sent.
export function effectiveDateFor(input: {
  policy: BillingPolicy
  billingDay: number
  requestedAt: Date
}): Date {
  const current = billingPeriodFor(input.policy, input.billingDay, input.requestedAt)
  return nextBillingPeriod(current).start
}

export type ChangeProblem =
  | 'no_change'
  | 'unknown_tier'
  | 'lease_not_active'
  /// A waiver needs evidence of the tenant's own cover before it can replace a
  /// paid plan. Dropping protection on an unverified claim is the exposure
  /// US-44 exists to close.
  | 'waiver_needs_proof'

/// Whether a requested change can be scheduled at all.
///
/// Pure, so every refusal is stated once and testable. `currentPremiumCents`
/// and `currentPlanName` describe what the lease bills today; `hasCurrentProof`
/// is whether a live, unexpired waiver record exists.
export function changeProblem(input: {
  selection: ProtectionSelection
  availableTiers: readonly string[]
  currentPlanName: string | null
  currentPremiumCents: number
  leaseIsActive: boolean
  hasCurrentProof: boolean
}): ChangeProblem | null {
  if (!input.leaseIsActive) return 'lease_not_active'

  if (input.selection.kind === 'plan') {
    if (!input.availableTiers.includes(input.selection.tier)) return 'unknown_tier'
    // Same plan AND same price is a no-op. Same name at a different price is
    // not — an operator may have repriced the tier, and re-selecting it is a
    // legitimate way for a tenant to accept the new premium.
    if (
      input.currentPlanName === input.selection.planName &&
      input.currentPremiumCents === input.selection.premiumCents
    ) {
      return 'no_change'
    }
    return null
  }

  // Waiver.
  if (input.currentPremiumCents === 0 && input.currentPlanName === null) return 'no_change'
  if (!input.hasCurrentProof) return 'waiver_needs_proof'
  return null
}

export const CHANGE_PROBLEM_MESSAGES: Record<ChangeProblem, string> = {
  no_change: 'That is the cover you already have.',
  unknown_tier: 'Choose one of the plans listed.',
  lease_not_active: 'This unit is not currently rented.',
  waiver_needs_proof:
    'Tell us about your own policy first — we need the insurer, the policy number and when it runs out before we can switch off your protection plan.',
}

/// What the tenant is told once a change is scheduled.
///
/// Names the date rather than saying "next month", because "next month" is
/// ambiguous on the 30th and wrong for a lease that bills on the 12th.
export function scheduledNotice(input: {
  selection: ProtectionSelection
  effectiveFrom: Date
  formatDate: (date: Date) => string
}): string {
  const when = input.formatDate(input.effectiveFrom)
  if (input.selection.kind === 'waiver') {
    return `Your protection plan will stop on ${when}, and you will not be charged for it after that. Your cover until then is unchanged.`
  }
  return `Your cover changes to ${input.selection.planName} on ${when}. This month's charge is unchanged.`
}
