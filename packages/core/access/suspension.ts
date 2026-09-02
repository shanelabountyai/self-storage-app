// PRD 02 §4.6 US-45, decided as D-16 (B-098). Whether a tenant's gate access
// should be suspended for non-payment, or restored.
//
// One threshold and two transitions — deliberately NOT a timeline engine. D-1
// keeps the configurable timeline, notices, lien and auction pipeline in
// Phase 2; this is the single rule moved forward, because the rest of MVP has
// emails and late fees and no leverage. A tenant twelve days past due who can
// still open his unit with a working code has no reason to pay this week.
//
// Pure, because it is the function that decides whether a paying customer can
// reach their own property. Every boundary is testable without a database, a
// gate controller, or a clock.

export type GateDecision =
  | { action: 'suspend'; daysPastDue: number }
  | { action: 'restore' }
  | { action: 'none'; reason: GateNoActionReason }

export type GateNoActionReason =
  /// A hold declaring `halt_access_suspension` is in force (US-42/US-45's own
  /// AC). Checked FIRST, so it can never be reached past.
  | 'on_hold'
  | 'rule_disabled'
  | 'not_past_due_enough'
  | 'already_suspended'
  | 'already_active'
  | 'balance_outstanding'
  /// Nothing to do to a grant that was never granted, or was revoked at
  /// move-out. A revoked grant is final (PRD 03's state machine).
  | 'not_suspendable'

export type GateInput = {
  /// The grant's current state.
  state: string
  /// Highest days-past-due across this tenant's leases at this facility.
  daysPastDue: number
  /// Everything this tenant owes at this facility, across every lease.
  balanceCents: number
  /// Per-facility threshold. Zero or less disables the rule.
  suspendAtDays: number
  /// Restore once the balance is at or below this. Zero is D-16's decision.
  restoreAtOrBelowCents: number
  /// Whether any active hold on any of the tenant's leases here declares
  /// `halt_access_suspension`.
  onHold: boolean
}

/// What should happen to this tenant's gate access right now.
///
/// The order of the checks is the specification:
///
///   1. A hold blocks everything. It is first so that no later branch can be
///      reached past it, and so a hold placed mid-cycle takes effect on the
///      very next evaluation rather than after the next payment.
///   2. Restore is evaluated before suspend. A tenant who has paid in full but
///      whose day count has not moved must come back in — the day count is a
///      historical fact about when they fell behind, and it does not decrease
///      when they settle.
///   3. Suspension needs BOTH the day count and an outstanding balance. A
///      lease showing days-past-due with a zero balance is a rounding artefact
///      or a credit, and locking someone out over it is the version of this
///      feature that ends up in a complaint.
export function gateDecision(input: GateInput): GateDecision {
  if (input.onHold) return { action: 'none', reason: 'on_hold' }

  // `revoked` is terminal and `pending` has never been issued — neither is
  // something a delinquency rule should move.
  if (input.state !== 'active' && input.state !== 'suspended') {
    return { action: 'none', reason: 'not_suspendable' }
  }

  const settled = input.balanceCents <= input.restoreAtOrBelowCents

  if (input.state === 'suspended') {
    return settled ? { action: 'restore' } : { action: 'none', reason: 'balance_outstanding' }
  }

  // state === 'active' from here.
  if (input.suspendAtDays <= 0) return { action: 'none', reason: 'rule_disabled' }
  if (settled) return { action: 'none', reason: 'already_active' }
  if (input.daysPastDue < input.suspendAtDays) {
    return { action: 'none', reason: 'not_past_due_enough' }
  }

  return { action: 'suspend', daysPastDue: input.daysPastDue }
}

/// What still has to be paid, at this facility, before the gate reopens.
///
/// B-232. The portal hardcoded *"Pay your full balance of $487.50 and your gate
/// code starts working again"* — restating D-16's DEFAULT as though it were the
/// rule. The rule is `balanceCents <= restoreAtOrBelowCents`, per facility, and
/// D-16 stores the threshold precisely so it can be relaxed: a site that sets
/// $50 was demanding $487.50 for what $437.50 would buy.
///
/// **The balance here is the tenant's balance at the FACILITY, not one lease's.**
/// `gateDecision` sums across every occupying lease (`tenantStates`), because a
/// grant cannot be partially suspended — so a two-unit tenant told that paying
/// unit A's balance reopens their gate drives over, finds it shut, and is right
/// to be angry. One function, so the screen, the banner and the suspension
/// notice cannot each answer this differently.
///
/// Never negative: at or below the threshold there is nothing left to pay, and
/// a negative "amount due" is not a refund offer.
export function restoreShortfallCents(input: {
  facilityBalanceCents: number
  restoreAtOrBelowCents: number
}): number {
  return Math.max(0, input.facilityBalanceCents - input.restoreAtOrBelowCents)
}

/// Whether paying `payingCents` now would reopen the gate.
///
/// B-232. `/portal/pay`'s "Pay a different amount" said NOTHING about a partial
/// payment leaving the gate shut, which is the wasted trip and the angriest call
/// the office takes.
export function wouldRestoreAccess(input: {
  facilityBalanceCents: number
  restoreAtOrBelowCents: number
  payingCents: number
}): boolean {
  return input.payingCents >= restoreShortfallCents(input)
}

/// The sentence a tenant and a staffer both read, per US-45's own AC:
/// "Access suspended, 12 days past due, 2026-07-18".
///
/// Written here rather than in a component because the notice, the tenant
/// profile and the audit context all say the same thing, and three
/// near-identical strings is how they end up disagreeing.
export function describeSuspension(daysPastDue: number, on: Date): string {
  return `Access suspended, ${daysPastDue} ${daysPastDue === 1 ? 'day' : 'days'} past due, ${on
    .toISOString()
    .slice(0, 10)}`
}

export function describeRestore(on: Date): string {
  return `Access restored, balance paid, ${on.toISOString().slice(0, 10)}`
}
