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
  /// PRD 01 US-707: a tenant scheduled their own move-out from the portal.
  /// Distinct from `lease.moved_out` — the lease is still `active`, nothing
  /// is final, and this only drives the request confirmation (CN-8 covers
  /// the finalized one). Cancelling a request has no event: it is a direct,
  /// synchronous call from the same action that clears the lease fields, not
  /// something anything else needs to react to asynchronously.
  'lease.move_out_requested',

  // Reservations (PRD 01 FR-3.3)
  'reservation.created',
  'reservation.expired',
  'reservation.cancelled',
  /// PRD 01 US-801: a reminder 24h before the hold expires. Emitted once per
  /// reservation (B-031's sweep stamps `expiryReminderSentAt`), never re-fired
  /// on a later tick — the event outbox's own idempotency only dedupes per
  /// event id, not per reservation, so the producer has to guarantee "once".
  'reservation.expiring_soon',

  // Billing (PRD 02 US-17/US-18, drives the comms ladder in PRD 05)
  'invoice.created',
  'invoice.due_soon',
  'invoice.due_today',
  'payment.succeeded',
  /// B-103. A bank debit has been submitted and is settling — money taken but
  /// not arrived. Only ACH ever emits it; a card is approved or declined in
  /// seconds. Deliberately its own name rather than a flavour of
  /// `payment.succeeded`, because nothing that reacts to a successful payment
  /// (posting to the ledger, settling an invoice, restoring gate access) may
  /// react to this one.
  'payment.processing',
  'payment.failed',
  /// Emitted from the Stripe reconciler for full and partial refunds alike —
  /// the payload says which (B-019). Refund *authorisation* is B-048.
  'payment.refunded',
  /// B-046. A card declined and the tenant has not fixed it yet — one a day
  /// for three days from the FIRST decline, not one per retry attempt.
  ///
  /// Distinct from `payment.failed`, which fires on each actual decline
  /// (+1/+3/+5, so days 1, 3 and 5 with silence in between). This is the
  /// cadence a person can act on, and it carries how many days are left before
  /// the retries stop so the message can say so.
  'payment.retry_reminder',
  /// PRD 05 CN-10a (B-043's scan, B-050's notice). The tenant's default card
  /// runs out soon. Fired at 30 days and again at 7 — the payload's `stage`
  /// says which, and the payment-method id in the payload is what makes
  /// "suppressed on replacement" free: a new card is a new id, and a new id
  /// that is not expiring is never scanned into a notice at all.
  'payment_method.expiring',

  // Referrals (PRD 10 §6.3, B-100)
  //
  // Both audiences of `referral.qualified` are people with an existing
  // relationship with this business — the referrer is a tenant, the referee has
  // just moved in. §6.3 is explicit that nothing here ever messages the
  // PROSPECT: the invite reaches them from their friend's own phone, and this
  // system is never the sender (§5.2).
  // ONE event per RECIPIENT, not one per referral (B-101).
  //
  // A qualifying referral has two things to say to two different people — "your
  // friend moved in" and "a credit is coming" — and `processCommsEvent`
  // resolves ONE recipient per event, then runs every matching rule against it.
  // Two rules on a single `referral.qualified` would both address the same
  // person, which is how the referee's message reaches the referrer.
  //
  // Splitting by recipient fits the architecture instead of fighting it: each
  // event names a Tenant, the existing Tenant resolver reaches them, and each
  // has exactly one rule. They are also genuinely different facts, which is why
  // this reads as a better model rather than a workaround.
  /// To the REFERRER: their friend moved in and the credit is owed.
  'referral.qualified',
  /// To the REFEREE: a credit is coming off their first invoice. Its own event
  /// rather than a second rule on the one above, per the note.
  'referral.reward_granted',
  /// To the REFERRER. The payload carries the refusal KEY, which is what lets
  /// the message say WHICH rule in plain language rather than "not eligible" —
  /// the same 3.3.3 standard the portal and the staff record are held to.
  'referral.refused',

  // Protection / proof of insurance (PRD 02 US-44, D-17)
  /// A recorded proof-of-insurance waiver runs out within 30 days.
  'protection.proof_expiring',
  /// D-17: the proof lapsed without replacement and the lease was enrolled
  /// into the facility's default tier. The payload carries the plan and the
  /// premium, because the tenant must be told what they are now paying.
  'protection.auto_enrolled',

  // Delinquency (PRD 02 FR-5). The dunning ladder is driven by these, never by
  // a comms-side calendar (PRD 05 CN-3).
  'delinquency.day_reached',
  'delinquency.stage_changed',

  // Access control (PRD 03 FR-1)
  'access.granted',
  'access.suspended',
  'access.restored',
  'access.revoked',
  /// A gate command gave up after retrying (PRD 03 FR-3). The tenant is already
  /// moved in and expecting a code, so this is a staff alert — somebody has to
  /// key it in by hand — never a customer-facing failure.
  'access.sync_failed',
  'overlock.required',
  'overlock.cleared',

  // Pricing and demand
  'rates.updated',
  /// PRD 02 US-11 / PRD 05 CN-9 (B-076). Raised on the NOTICE date of an
  /// approved tenant rate increase, not when it was scheduled — CN-9's own
  /// wording is "send the tenant notice on the configured advance-notice
  /// date", and the whole point of the notice period is that the tenant
  /// hears about it then rather than at whatever moment an operator queued
  /// the batch.
  'lease.rate_increase_scheduled',
  'lead.created',

  // Documents
  'esign.completed',

  /// PRD 02 US-27 / PRD 05 CN-12 (B-061/B-063). A pre-lien or lien notice was
  /// generated and stored. Drives the courtesy email — never the statutory
  /// notice itself, which is the mailed, hashed document this event points at.
  'notice.generated',

  /// PRD 04 US-7 AC1 (B-071). A tenant has cleared their facility's
  /// review-request delay after move-in. Raised once per tenancy — the
  /// producer stamps `Lease.reviewRequestSentAt` in the same beat, since the
  /// outbox only dedupes an event that already exists.
  'review.requested',

  /// PRD 04 US-14 (B-072). One lead-drip step is due. `payload.step` (1–3)
  /// picks the template — one event, three comms rules, the same device
  /// `notice.generated` uses for pre-lien vs lien.
  'lead.drip_step',

  /// PRD 04 US-9 / FR-LEAD-4 (B-073). One abandoned-checkout follow-up step is
  /// due. `payload.step` (1–3) picks the template, same device as
  /// `lead.drip_step`. Entity is the TENANT (a real Tenant row exists from
  /// checkout step 1 onward), with `payload.checkoutSessionId` carrying which
  /// session — a tenant can only ever have one live checkout at a time, but
  /// the event should not assume that stays true.
  'checkout.abandonment_step',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

const KNOWN = new Set<string>(EVENT_NAMES)

export function isKnownEvent(name: string): name is EventName {
  return KNOWN.has(name)
}
