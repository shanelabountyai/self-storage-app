import { localParts } from '../jobs/schedule.ts'

// PRD 05 FR-MSG-5 (B-072). "No marketing sends 9pm–8am recipient local time
// (facility timezone as proxy); max 1 marketing email/day/contact across
// sequences."
//
// Both checks apply to EVERY `marketing`-classified send, enforced centrally
// in the comms engine rather than as an opt-in skip condition a new rule could
// forget to list — the same reasoning the postal footer already uses ("an
// edited template cannot drop a CAN-SPAM requirement"). That also means this
// retroactively covers B-071's `review_request`, which predates this file:
// a real gap closed by construction rather than a second copy of the rule.

/// True during the hours a marketing email must NOT go out.
export function isMarketingQuietHours(instant: Date, timezone: string): boolean {
  const hour = localParts(instant, timezone).hour
  return hour >= 21 || hour < 8
}
