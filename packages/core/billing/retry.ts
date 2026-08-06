import { daysBetween } from '../jobs/schedule.ts'

// PRD 02 US-20 (B-046). When a failed payment may be tried again.
//
// ── The rule that shapes this ────────────────────────────────────────────────
//
// Every offset is measured from the invoice's **original due date**, never from
// the last attempt. That is the same anchoring rule `daysPastDue` is built on
// (§4.11, D-25), and it is the same failure it prevents: offsets measured from
// the previous try slide the whole schedule forward every time a card declines,
// so a card that fails four times stretches a 5-day schedule into a 9-day one,
// and a tenant drifts further past due on every retry rather than converging.
//
// Attempt 1 is the charge on the due date itself. The schedule lists the RETRY
// offsets after it, so a default of [1, 3, 5] means four attempts in total —
// US-20's "retry on day +1, +3, +5; max 3 retries".

export const DEFAULT_RETRY_DAYS = [1, 3, 5] as const

/// Stripe decline codes that mean retrying is pointless.
///
/// US-20 names the card-expired case specifically: retrying a card that has
/// expired three more times just tells the tenant three more times that
/// something they cannot fix from their side went wrong. The others are the
/// same shape — a decline no amount of waiting changes.
export const TERMINAL_DECLINE_CODES = new Set([
  'expired_card',
  'incorrect_number',
  'invalid_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'card_not_supported',
  'stolen_card',
  'lost_card',
  'pickup_card',
])

export function isTerminalDecline(code: string | null | undefined): boolean {
  return Boolean(code && TERMINAL_DECLINE_CODES.has(code))
}

export type RetryDecision =
  | { attempt: true; attemptNumber: number }
  | { attempt: false; reason: 'not_due_yet' | 'retries_exhausted' | 'terminal_decline' }

export type RetryInput = {
  /// The invoice's ORIGINAL due date. Not a retry date, not a reissue date.
  dueDate: Date
  /// The business date the run is executing for.
  businessDate: Date
  /// How many charge attempts have already failed for this invoice.
  failedAttempts: number
  /// Retry offsets in days from the due date, per facility policy.
  retryDays?: readonly number[]
  /// The decline code from the most recent failure, if there was one.
  lastDeclineCode?: string | null
}

/// Whether to charge this invoice tonight, and if not, why not.
///
/// Returns the attempt number on success so the caller can record which try
/// this was — the failed-payment task and the retry notice both say it, and
/// "we tried again" reads very differently from "this was the last try".
export function retryDecision(input: RetryInput): RetryDecision {
  const retryDays = input.retryDays ?? DEFAULT_RETRY_DAYS
  const { failedAttempts } = input

  // A terminal decline stops the schedule wherever it is. Checked before
  // exhaustion so the reason reported is the useful one — "the card has
  // expired" is actionable, "we ran out of retries" is not.
  if (isTerminalDecline(input.lastDeclineCode)) {
    return { attempt: false, reason: 'terminal_decline' }
  }

  if (failedAttempts > retryDays.length) {
    return { attempt: false, reason: 'retries_exhausted' }
  }

  // Attempt 1 is the due date itself (offset 0); attempt N+1 uses the Nth
  // retry offset.
  const offset = failedAttempts === 0 ? 0 : retryDays[failedAttempts - 1]
  const elapsed = daysBetween(startOfUtcDay(input.dueDate), startOfUtcDay(input.businessDate))

  // `>=`, not `===`: a run catching up after an outage must still make the
  // attempts that came due while it was down, rather than skipping past them
  // because their exact day has gone by.
  if (elapsed < offset) return { attempt: false, reason: 'not_due_yet' }

  return { attempt: true, attemptNumber: failedAttempts + 1 }
}

/// The calendar date the next attempt becomes due, or null when the schedule
/// is finished. Used to tell a person when we will try again.
export function nextAttemptDate(
  dueDate: Date,
  failedAttempts: number,
  retryDays: readonly number[] = DEFAULT_RETRY_DAYS,
): Date | null {
  if (failedAttempts > retryDays.length) return null
  const offset = failedAttempts === 0 ? 0 : retryDays[failedAttempts - 1]
  const start = startOfUtcDay(dueDate)
  return new Date(start.getTime() + offset * 86_400_000)
}

/// True when this failure was the last one the schedule allows — the moment a
/// failed payment stops being "we'll try again" and becomes a person's problem.
export function isFinalAttempt(
  failedAttempts: number,
  retryDays: readonly number[] = DEFAULT_RETRY_DAYS,
): boolean {
  return failedAttempts > retryDays.length
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
