// The domain-event catalog. Names come from PRD 02 FR-7 plus the events other
// modules are specified to emit or consume; adding one here is how a new event
// becomes legal, so this doubles as the contract between modules.
//
// Naming is `entity.past_tense` — events describe something that already
// happened, never a command to do something.

export const EVENT_NAMES = [
  // Inventory
  'unit.status_changed',

  // Leases (PRD 02 FR-7 emits)
  'lease.moved_in',
  'lease.moved_out',
  'lease.transferred',

  // Reservations (PRD 01 FR-3.3)
  'reservation.created',
  'reservation.expired',
  'reservation.cancelled',

  // Billing (PRD 02 US-17/US-18, drives the comms ladder in PRD 05)
  'invoice.created',
  'invoice.due_soon',
  'invoice.due_today',
  'payment.succeeded',
  'payment.failed',
  /// Emitted from the Stripe reconciler for full and partial refunds alike —
  /// the payload says which (B-019). Refund *authorisation* is B-048.
  'payment.refunded',

  // Delinquency (PRD 02 FR-5). The dunning ladder is driven by these, never by
  // a comms-side calendar (PRD 05 CN-3).
  'delinquency.day_reached',
  'delinquency.stage_changed',

  // Access control (PRD 03 FR-1)
  'access.granted',
  'access.suspended',
  'access.restored',
  'access.revoked',
  'overlock.required',
  'overlock.cleared',

  // Pricing and demand
  'rates.updated',
  'lead.created',

  // Documents
  'esign.completed',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

const KNOWN = new Set<string>(EVENT_NAMES)

export function isKnownEvent(name: string): name is EventName {
  return KNOWN.has(name)
}
