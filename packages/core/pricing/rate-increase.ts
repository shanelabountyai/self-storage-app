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

/// B-165 / D-94. The whole ECRI rule for one facility — who is picked AND how
/// far they move. It is one type rather than two because an operator sets it
/// in one sitting and because splitting it is how the step half came to be a
/// module constant nobody could reach: eligibility was configurable-shaped
/// (a parameter) while the target was a hardcoded return, so the batch raised
/// every picked tenant the entire distance to street in one letter.
export type EcriPolicy = EligibilityRule & {
  /// Hundredths of a percent, so 10% is 1000 — the same unit as tax rates and
  /// the late-fee ladder. The step is a percentage of the IN-PLACE rate, not
  /// of the gap: a tenant judges an increase against what they pay now.
  percentStepBps: number
  /// Floors and ceilings on the computed step, in cents. The floor stops a
  /// cheap unit's 10% from being a $4 letter that costs more to post than it
  /// collects; the ceiling is what actually prevents the 63% jump this row
  /// exists to stop, because a percentage alone still compounds on a big rate.
  minStepCents: number
  maxStepCents: number
  /// Whether the step is allowed to carry a tenant PAST the street rate.
  /// True by default: charging an existing tenant more than a walk-in would
  /// pay for the same unit today is indefensible in a retention call.
  capAtStreet: boolean
}

/// The seeded default for a newly created facility (D-94, 2026-08-24).
///
/// 10% capped at $30 is the conservative-but-real industry step, and it is
/// deliberately NOT the previous behaviour: a facility nobody has configured
/// must not send the letter that loses the cohort. D-10 keeps every figure
/// per-facility, so an operator who wants a different curve sets one.
export const DEFAULT_ECRI_POLICY: EcriPolicy = {
  minMonthsSinceLastChange: 9,
  minGapCents: 1_500,
  percentStepBps: 1_000,
  minStepCents: 500,
  maxStepCents: 3_000,
  capAtStreet: true,
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

/// What a rule-based batch would raise each eligible lease TO (B-165).
///
/// `min(street, inPlace × (1 + pct))`, with the step itself bounded by the
/// policy's floor and ceiling and the result rounded to whole dollars — a
/// notice quoting $98.79 invites a phone call about the 79 cents.
///
/// Order matters and is the whole correctness argument: the percentage is
/// taken first, the floor and ceiling clamp the STEP (not the rate), the
/// rounding lands on a dollar, and the street cap is applied LAST so nothing
/// downstream of it can push a tenant past what a walk-in would pay.
export function targetRateFor(candidate: CandidateLease, policy: EcriPolicy): number {
  const raw = Math.round((candidate.inPlaceRateCents * policy.percentStepBps) / 10_000)
  const step = Math.min(Math.max(raw, policy.minStepCents), policy.maxStepCents)
  // Round the RATE, not the step: $89.50 + $9 should land on a whole dollar,
  // and rounding the step would leave the half-dollar in place forever.
  const target = Math.round((candidate.inPlaceRateCents + step) / 100) * 100
  return policy.capAtStreet ? Math.min(target, candidate.streetRateCents) : target
}

/// US-11 AC: "a rate-increase review screen shows pending increases with
/// projected revenue delta". Monthly delta, in cents — the figure an approver
/// is actually deciding on.
export function projectedMonthlyDeltaCents(
  rows: readonly { currentRateCents: number; newRateCents: number }[],
): number {
  return rows.reduce((total, row) => total + (row.newRateCents - row.currentRateCents), 0)
}

export type RateIncreaseState =
  | 'pending_approval'
  | 'approved'
  | 'notice_sent'
  | 'notice_failed'
  | 'applied'
  | 'cancelled'

/// The states an increase is still in flight in — not yet applied, not yet
/// cancelled. One constant rather than the same four-element array repeated at
/// every call site: `notice_failed` (B-152) had to be added to all of them at
/// once, and a list that missed it would have let a second increase be
/// scheduled on a lease whose first one is merely blocked.
export const LIVE_RATE_INCREASE_STATUSES = [
  'pending_approval',
  'approved',
  'notice_sent',
  'notice_failed',
] as const satisfies readonly RateIncreaseState[]

/// US-11: "Increases are cancellable up to the effective date."
///
/// Everything short of already-applied and already-cancelled can be pulled
/// back — including one whose notice has gone out, which is the case that
/// matters most: an operator who changes their mind after the letter went
/// out needs to be able to stop the charge, and telling the tenant it is
/// cancelled is a phone call, not a schema constraint.
export function isCancellable(status: RateIncreaseState): boolean {
  return (LIVE_RATE_INCREASE_STATUSES as readonly string[]).includes(status)
}

/// PRD 02 §4.3 US-11 (B-153). Which direction a scheduled change goes.
///
/// Derived from the two figures rather than stored: a `direction` column
/// could disagree with the delta beside it, and there is exactly one right
/// answer already sitting in the row. `scheduleProblem` and `decreaseProblem`
/// between them make an equal pair impossible, so this is total.
export function isRateDecrease(row: { currentRateCents: number; newRateCents: number }): boolean {
  return row.newRateCents < row.currentRateCents
}

export type DecreaseProblem = 'not_a_decrease' | 'effective_in_past' | 'rate_below_zero'

/// B-153. The mirror of `scheduleProblem` for a retention save.
///
/// **The notice period is deliberately absent.** US-11's minimum notice
/// exists because a tenant is about to be charged more; nothing statutory
/// governs charging them less, and making a discount wait thirty days would
/// defeat the only thing a retention save is for — the tenant is on the phone
/// threatening to leave.
///
/// Today is allowed as an effective date, unlike an increase. A past one is
/// not: the rate that applied on a date already invoiced is a fact, and
/// moving it retroactively would make `LeaseRateChange` disagree with the
/// invoices a billing dispute reads it against.
export function decreaseProblem(input: {
  currentRateCents: number
  newRateCents: number
  effectiveDate: Date
  /// Today, facility-local.
  today: Date
}): DecreaseProblem | null {
  // A trust boundary, not a formality: negative cents here would flow into
  // `Lease.monthlyRateCents` and invoice as a credit every month forever.
  if (input.newRateCents < 0) return 'rate_below_zero'
  if (input.newRateCents >= input.currentRateCents) return 'not_a_decrease'
  if (daysBetween(input.today, input.effectiveDate) < 0) return 'effective_in_past'
  return null
}

/// The notice may go out only once an approver has signed off (US-11 AC:
/// "regional/owner approval is required before notices go out") and only on
/// or after the notice date.
///
/// B-153: never for a decrease. A retention save is `approved` from the
/// moment it is created, which is the same shape this predicate fires on, so
/// without the direction check the tenant whose rent was just lowered would
/// be emailed a rate-INCREASE notice.
export function noticeIsDue(
  row: { status: RateIncreaseState; noticeDate: Date; currentRateCents: number; newRateCents: number },
  today: Date,
): boolean {
  if (isRateDecrease(row)) return false
  return row.status === 'approved' && daysBetween(today, row.noticeDate) <= 0
}

/// The rate may move only once the notice actually went out and the effective
/// date has arrived. `notice_sent` rather than `approved` is the guard that
/// makes "no tenant is charged more without having been told" true by
/// construction rather than by the jobs happening to run in the right order.
///
/// B-153: a decrease applies from `approved` instead, because it never gets a
/// notice. The guard is the direction rather than a second predicate, so the
/// two cases cannot drift apart — and an APPROVED INCREASE still cannot apply,
/// which is the property that must survive adding decreases at all.
export function applyIsDue(
  row: { status: RateIncreaseState; effectiveDate: Date; currentRateCents: number; newRateCents: number },
  today: Date,
): boolean {
  if (daysBetween(today, row.effectiveDate) > 0) return false
  return isRateDecrease(row) ? row.status === 'approved' : row.status === 'notice_sent'
}

/// PRD 02 §4.3 US-11, D-88 (B-152). Whether the notice for an increase can be
/// shown to have gone out.
///
/// US-11 blocks an effective date that violates the minimum notice period —
/// a guarantee about DELIVERY that the workflow used to make about INTENT:
/// the status flipped to `notice_sent` the moment the event was emitted, and
/// nothing afterwards ever looked at what the provider said happened. An
/// increase whose notice hard-bounced applied thirty days later anyway, and
/// the one fact that makes an increase indefensible in a dispute is a notice
/// we can prove did not arrive.
///
/// Takes the `Message.status` of every message the notice event produced —
/// there can be more than one, because a rule may reach the tenant on more
/// than one channel, and reaching them on either is reaching them.
export type NoticeDeliveryVerdict = 'reached' | 'undeliverable' | 'no_send_record'

/// Statuses that mean the message never got to the tenant and never will.
/// `suppressed` and `cancelled` are decisions WE made before sending, which
/// is exactly D-88's "suppression hit" — an increase noticed to an address we
/// had already stopped mailing was not noticed.
const DEAD_MESSAGE_STATUSES: readonly string[] = ['bounced', 'failed', 'suppressed', 'cancelled']

export function noticeDeliveryVerdict(statuses: readonly string[]): NoticeDeliveryVerdict {
  // D-88: "no send record blocks". A skip condition firing, a rule matching
  // nothing, or a dispatcher that never ran all land here — and all three
  // mean nobody was told.
  if (statuses.length === 0) return 'no_send_record'
  // `queued`, `deferred` and `sent` all count as reached. They are not proof
  // of arrival, but they are not evidence of failure either, and blocking on
  // "the provider has not called back yet" would hold every increase whose
  // webhook is a minute late. Only a positive failure blocks.
  if (statuses.every((status) => DEAD_MESSAGE_STATUSES.includes(status))) return 'undeliverable'
  return 'reached'
}
