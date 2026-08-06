import type { Consumer } from '@storage/core/events'
import { expireReservations } from '@/lib/reservations/reserve'
import { expireCheckoutSessions } from '@/lib/checkout/session'
import { drainGateCommands } from '@/lib/access/service'
import { provisionAccessForLease } from '@/lib/access/provision'
import { processCommsEvent } from '@/lib/comms/service'
import { scanExpiringCards, scanExpiringProtectionProofs } from '@/lib/billing/scans'

// Consumer and job registration. The machinery is B-006's; the things that use
// it arrive with their own backlog items: reservation expiry (B-018, below),
// Stripe reconciliation (B-019), gate command outbox (B-027), comms (B-030),
// billing scheduler (B-043).

export const CONSUMERS: readonly Consumer[] = [
  {
    // PRD 01 FR-4.5 / PRD 03 US-1: a move-in grants access.
    //
    // A consumer rather than an inline call in B-026's transaction, and that is
    // the point of the outbox: gate provisioning must not be able to fail a
    // move-in that has already been paid for. If this handler throws, the event
    // is retried and the tenant stays moved in.
    name: 'access.provision-on-move-in',
    events: ['lease.moved_in'],
    handle: async ({ event }) => {
      await provisionAccessForLease(event.entityId)
    },
  },
  {
    // PRD 05 FR-1 (B-030). The single outbound messaging service: every event
    // that any notification rule maps to routes through here. Rules are data
    // (FR-2), so this subscribes to the full set of comms-relevant events the
    // PRD specifies (§5.2) and no-ops the ones that have no rule yet — adding a
    // rule needs no code change here. Idempotent per (event, rule, recipient,
    // channel), so at-least-once redelivery never double-sends.
    name: 'comms.dispatch',
    events: [
      'lease.moved_in',
      'lease.moved_out',
      'payment.succeeded',
      'payment.failed',
      'invoice.created',
      'invoice.due_soon',
      'invoice.due_today',
      'delinquency.day_reached',
      'delinquency.stage_changed',
      'access.restored',
      // B-043's scans. Subscribed here so B-050 and the D-17 notice are a rule
      // and a template — data — rather than another edit to this list. Both
      // resolve to a recipient already (Tenant and Lease), and an event with
      // no rule yet is a no-op by design.
      'payment_method.expiring',
      'protection.proof_expiring',
      'protection.auto_enrolled',
    ],
    handle: async ({ event }) => {
      await processCommsEvent(event)
    },
  },
]

export type ScheduledJob = {
  name: string
  /// Facility-local hour this runs at, 0–23. Jobs that are not per-facility use
  /// `scope: 'global'` and run at this hour UTC.
  localHour: number
  scope: 'per_facility' | 'global'
  handler: (context: {
    facilityId: string | null
    businessDate: Date
    recordItem: (outcome: { itemId: string; ok: boolean; message?: string }) => void
  }) => Promise<void>
}

export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  {
    // B-018 / US-401: "Reservation holds expire automatically... Expiration
    // returns the unit type count to inventory."
    //
    // Per-facility and just after midnight local, because a hold runs to the
    // end of a facility-local day: running this at a single UTC hour would
    // expire a Texas hold either five hours early or nineteen hours late
    // depending on the season.
    //
    // Sweeping on a schedule is not the only guard. `expireReservations` is
    // idempotent and the availability read derives from unit status, so a
    // missed run means a unit stays held slightly too long — never that an
    // expired hold keeps blocking a sale invisibly.
    name: 'reservation.expire',
    localHour: 0,
    scope: 'per_facility',
    handler: async ({ facilityId, recordItem }) => {
      const { expired } = await expireReservations(new Date(), facilityId ?? undefined)
      recordItem({
        itemId: facilityId ?? 'global',
        ok: true,
        message: `expired ${expired} reservation${expired === 1 ? '' : 's'}`,
      })
    },
  },
  {
    // PRD 03 FR-3. Drains the gate command outbox.
    //
    // Hourly would be better and the runner is once-per-business-date (B-006),
    // so this is the floor rather than the target: the drain is also called
    // directly after provisioning, and this scheduled pass is what catches
    // commands whose retries have come due since.
    name: 'access.drain-commands',
    localHour: 1,
    scope: 'global',
    handler: async ({ recordItem }) => {
      const result = await drainGateCommands()
      recordItem({
        itemId: 'global',
        ok: result.deadLettered === 0,
        message: `sent ${result.succeeded}, retrying ${result.failed}, dead-lettered ${result.deadLettered}`,
      })
    },
  },
  {
    // B-020 / FR-4.1: the 30-minute checkout lock.
    //
    // Daily, and that is enough — the runner is once-per-business-date by
    // design (B-006), and this sweep is bookkeeping rather than the guard.
    // Availability derives from `lockExpiresAt > now`, so a lapsed lock stops
    // holding its unit the instant it lapses whether or not the sweep has run;
    // all this does is settle the row's status and free the FK. If that ever
    // stops being true, the fix is the derivation, not a faster job.
    name: 'checkout.expire',
    localHour: 0,
    scope: 'global',
    handler: async ({ recordItem }) => {
      const { expired } = await expireCheckoutSessions()
      recordItem({
        itemId: 'global',
        ok: true,
        message: `expired ${expired} checkout session${expired === 1 ? '' : 's'}`,
      })
    },
  },
  {
    // B-043 / PRD 05 CN-10a. Cards expiring within 30 days, retriggered at 7.
    //
    // Per-facility and at 2am local so it lands after the midnight sweeps and
    // well before anyone opens the office. Two separate jobs rather than one
    // "pre-emptive scans" job, because a JobRun row per scan is what makes the
    // Billing Runs screen able to say which one failed.
    name: 'billing.scan-expiring-cards',
    localHour: 2,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await scanExpiringCards(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-043 / PRD 02 US-44, D-17. Proof of insurance expiring within 30 days,
    // and enrolment into the facility's default tier once it lapses.
    name: 'billing.scan-protection-proofs',
    localHour: 2,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await scanExpiringProtectionProofs(facilityId!, businessDate, recordItem)
    },
  },
]
