// PRD 02 §4.3 US-11 (B-076). Tenant rate increases: the arithmetic and the
// rules, with no database in sight.
//
// Everything here is about ONE question the AC asks in three places — is this
// increase allowed to happen yet — and it is separated out for the same
// reason the delinquency ladder and the auction readiness check are: a rule
// that decides whether a tenant's rent goes up is worth being able to test
// exhaustively without fixtures.

/// A calendar day, normalised to UTC midnight. Effective and notice dates are
/// facility-local CALENDAR days ("effective on the 1st"), not instants — the
/// same treatment `Lease.moveOutDate` and `JobRun.businessDate` already get.
export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(day: Date, days: number): Date {
  return new Date(utcDay(day).getTime() + days * 86_400_000)
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000)
}

/// US-11: "generates the notice letter/email from a template on the notice
/// date". The notice date is the effective date minus the facility's
/// configured minimum notice — the LAST day a notice can go out and still be
/// timely, not an earlier courtesy date.
export function noticeDateFor(effectiveDate: Date, noticeDays: number): Date {
  return addDays(effectiveDate, -noticeDays)
}

export type ScheduleProblem =
  | 'effective_not_in_future'
  | 'insufficient_notice'
  | 'not_an_increase'
  | 'notice_days_not_positive'

/// US-11: "blocks effective dates that violate the facility's configured
/// minimum notice period".
///
/// Returns the first problem, or null when the increase may be scheduled.
/// Deliberately ordered cheapest-and-most-obvious first, so the message an
/// operator sees names the thing they most likely got wrong.
export function scheduleProblem(input: {
  currentRateCents: number
  newRateCents: number
  effectiveDate: Date
  noticeDays: number
  /// Today, facility-local.
  today: Date
}): ScheduleProblem | null {
  // A zero-day notice period is not "no notice required" — it is a
  // misconfiguration, and this is the one setting where treating an
  // unconfigured value as permissive would put an unannounced increase on a
  // real tenant.
  if (input.noticeDays <= 0) return 'notice_days_not_positive'

  // US-11 is a rate INCREASE workflow. A decrease needs no notice period and
  // no approval, and routing one through this machinery would make it wait
  // 30 days to give somebody a discount.
  if (input.newRateCents <= input.currentRateCents) return 'not_an_increase'

  if (daysBetween(input.today, input.effectiveDate) <= 0) return 'effective_not_in_future'

  // The load-bearing check. `>=` because a notice served exactly `noticeDays`
  // ahead is timely — "30 days' notice" means the tenant gets 30 days, and
  // requiring 31 would silently make every facility's configured figure mean
  // one more than it says.
  if (daysBetween(input.today, input.effectiveDate) < input.noticeDays) return 'insufficient_notice'

  return null
}

/// The soonest effective date that satisfies the notice period, for a form
/// that would rather offer a valid default than reject the operator's first
/// attempt.
export function earliestEffectiveDate(today: Date, noticeDays: number): Date {
  return addDays(today, Math.max(1, noticeDays))
}

export type EligibilityRule = {
  /// US-11's example: "tenants ≥ 9 months since last increase".
  minMonthsSinceLastChange: number
  /// "…and ≥ $15 below street." Integer cents, like all money here.
  minGapCents: number
}

export const DEFAULT_ELIGIBILITY: EligibilityRule = {
  minMonthsSinceLastChange: 9,
  minGapCents: 1_500,
}

export type CandidateLease = {
  leaseId: string
  inPlaceRateCents: number
  streetRateCents: number
  monthsSinceLastChange: number | null
}

/// US-11's rule-based selection. Both conditions must hold — the example in
/// the AC is an "and", and either alone picks the wrong tenants: a big gap on
/// a lease raised last month is a tenant who will churn, and a long-untouched
/// lease already at street has nothing to raise.
///
/// A null `monthsSinceLastChange` (nothing known about this lease's history)
/// is NOT eligible. The move-in row exists from B-026 onward precisely so
/// this is answerable, and treating unknown as "long enough ago" would raise
/// rates on exactly the leases whose history is missing.
export function isEligibleForIncrease(candidate: CandidateLease, rule: EligibilityRule): boolean {
  if (candidate.monthsSinceLastChange === null) return false
  if (candidate.monthsSinceLastChange < rule.minMonthsSinceLastChange) return false
  return candidate.streetRateCents - candidate.inPlaceRateCents >= rule.minGapCents
}

/// What a rule-based batch would raise each eligible lease TO.
///
/// Street, capped by nothing — the point of the rule is to close the gap to
/// the rate a new tenant would pay today. An operator wanting a softer step
/// schedules one-offs instead; a percentage cap is a real feature and
/// deliberately not invented here, because the AC does not ask for one and a
/// guessed cap would quietly become the thing every batch does.
export function targetRateFor(candidate: CandidateLease): number {
  return candidate.streetRateCents
}

/// US-11 AC: "a rate-increase review screen shows pending increases with
/// projected revenue delta". Monthly delta, in cents — the figure an approver
/// is actually deciding on.
export function projectedMonthlyDeltaCents(
  rows: readonly { currentRateCents: number; newRateCents: number }[],
): number {
  return rows.reduce((total, row) => total + (row.newRateCents - row.currentRateCents), 0)
}

export type RateIncreaseState = 'pending_approval' | 'approved' | 'notice_sent' | 'applied' | 'cancelled'

/// US-11: "Increases are cancellable up to the effective date."
///
/// Everything short of already-applied and already-cancelled can be pulled
/// back — including one whose notice has gone out, which is the case that
/// matters most: an operator who changes their mind after the letter went
/// out needs to be able to stop the charge, and telling the tenant it is
/// cancelled is a phone call, not a schema constraint.
export function isCancellable(status: RateIncreaseState): boolean {
  return status === 'pending_approval' || status === 'approved' || status === 'notice_sent'
}

/// The notice may go out only once an approver has signed off (US-11 AC:
/// "regional/owner approval is required before notices go out") and only on
/// or after the notice date.
export function noticeIsDue(
  row: { status: RateIncreaseState; noticeDate: Date },
  today: Date,
): boolean {
  return row.status === 'approved' && daysBetween(today, row.noticeDate) <= 0
}

/// The rate may move only once the notice actually went out and the effective
/// date has arrived. `notice_sent` rather than `approved` is the guard that
/// makes "no tenant is charged more without having been told" true by
/// construction rather than by the jobs happening to run in the right order.
export function applyIsDue(
  row: { status: RateIncreaseState; effectiveDate: Date },
  today: Date,
): boolean {
  return row.status === 'notice_sent' && daysBetween(today, row.effectiveDate) <= 0
}
