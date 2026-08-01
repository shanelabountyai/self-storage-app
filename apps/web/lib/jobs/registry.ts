import type { Consumer } from '@storage/core/events'
import { expireReservations } from '@/lib/reservations/reserve'
import { expireCheckoutSessions } from '@/lib/checkout/session'

// Consumer and job registration. The machinery is B-006's; the things that use
// it arrive with their own backlog items: reservation expiry (B-018, below),
// Stripe reconciliation (B-019), gate command outbox (B-027), comms (B-030),
// billing scheduler (B-043).

export const CONSUMERS: readonly Consumer[] = []

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
]
