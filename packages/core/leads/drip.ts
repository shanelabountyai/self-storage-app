import { daysBetween } from '../jobs/schedule.ts'

// PRD 04 §3.7 US-14 (B-072). The lead drip's own shape.
//
// "Templates are per-brand with facility merge fields; operators can edit
// copy, not sequence logic, at MVP." So the STRUCTURE below — three steps,
// their delays, and the promo condition on the third — is fixed, and the only
// thing an operator's template edit can change is what each step says.

export const LEAD_DRIP_STEPS = [1, 2, 3] as const
export type LeadDripStep = (typeof LEAD_DRIP_STEPS)[number]

/// AC1: "immediate quote recap → +2 days value/reviews email → +5 days promo
/// nudge." Day 0 fires from `lead.created` directly (see the comms consumer),
/// not from the day-counted job below — a quote recap loses its point if it
/// waits for a nightly sweep.
export const LEAD_DRIP_DELAY_DAYS: Readonly<Record<LeadDripStep, number>> = {
  1: 0,
  2: 2,
  3: 5,
}

/// Same shape as `reviewRequestDue` (B-071): `>=`, not `===`, so a catch-up
/// run still raises a step whose day has already passed.
export function leadDripStepDue(
  leadCreatedBusinessDate: Date,
  step: LeadDripStep,
  businessDate: Date,
): boolean {
  return daysBetween(leadCreatedBusinessDate, businessDate) >= LEAD_DRIP_DELAY_DAYS[step]
}

export type LeadDripState = {
  status: 'new' | 'contacted' | 'reserved' | 'converted' | 'lost'
  /// Whether this lead has ANY quoted size — "quote recap" is meaningless
  /// without one, and a callback-only inquiry is already served by B-097's
  /// follow-up task.
  hasUnitType: boolean
}

export type LeadDripExitReason = 'converted' | 'lost' | 'no_unit_type'

/// AC1: "Exits on reservation, status `lost`, or unsubscribe." `reserved` and
/// `converted` both mean the prospect is no longer a prospect — a "value" or
/// "promo nudge" email to somebody who already has a reservation reads as
/// spam about their own purchase. Unsubscribe is not checked here: it is a
/// consent fact, not a lead fact, and the comms engine's own suppression path
/// already covers it for every marketing send uniformly.
export function leadDripExitReason(state: LeadDripState): LeadDripExitReason | null {
  if (!state.hasUnitType) return 'no_unit_type'
  if (state.status === 'lost') return 'lost'
  if (state.status === 'reserved' || state.status === 'converted') return 'converted'
  return null
}
