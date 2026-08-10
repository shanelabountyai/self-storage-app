import type { Consumer } from '@storage/core/events'
import { expireReservations } from '@/lib/reservations/reserve'
import { expireCheckoutSessions } from '@/lib/checkout/session'
import { drainGateCommands } from '@/lib/access/service'
import { provisionAccessForLease } from '@/lib/access/provision'
import { processCommsEvent } from '@/lib/comms/service'
import { scanExpiringCards, scanExpiringProtectionProofs } from '@/lib/billing/scans'
import { emitDueReminders, generateInvoices } from '@/lib/billing/invoices'
import { emitRetryReminders, runAutopay } from '@/lib/billing/autopay'
import { assessLateFees } from '@/lib/billing/late-fees'
import { evaluateAccessSuspensions } from '@/lib/access/delinquency-gate'
import { prisma } from '@storage/db'
import { runDunning } from '@/lib/billing/dunning'
import { createTask } from '@/lib/admin/tasks'
import { raiseLeadFollowUps } from '@/lib/admin/lead-follow-up'
import { runDelinquencyTimeline } from '@/lib/delinquency/engine'
import { raiseDailyWalkthrough } from '@/lib/field-ops/walkthrough'

// Consumer and job registration. The machinery is B-006's; the things that use
// it arrive with their own backlog items: reservation expiry (B-018, below),
// Stripe reconciliation (B-019), gate command outbox (B-027), comms (B-030),
// billing scheduler (B-043).

/// PRD 04 US-8 AC2 / FR-LEAD-3 (B-068): a web lead "notifies the facility
/// manager (email + dashboard inbox) in real time."
///
/// The dashboard inbox is `Task` — §4.9 US-41 is explicit that every queue
/// reads the one entity, and a separate lead inbox would be the eighth screen
/// that item exists to prevent. Raised immediately rather than by B-097's
/// morning sweep, because the two cases are genuinely different: a phone caller
/// has just spoken to somebody, while a web submitter is a stranger sitting on
/// a page waiting to hear back.
///
/// The email half is NOT here — see the note in the consumer.
export const LEAD_CONSUMER: Consumer = {
  name: 'leads.notify-on-created',
  events: ['lead.created'],
  handle: async ({ event }) => {
    const lead = await prisma.lead.findUnique({
      where: { id: event.entityId },
      select: { facilityId: true, source: true },
    })
    // Counter leads are excluded: the staffer who took the call IS the person
    // this would notify, and B-097's window sweep covers them if nobody acts.
    if (!lead?.facilityId || lead.source !== 'web') return

    await createTask({
      facilityId: lead.facilityId,
      type: 'lead_follow_up',
      entityType: 'Lead',
      entityId: event.entityId,
      sourceEventId: event.id,
      // Higher than a counter lead's follow-up, deliberately: nobody has spoken
      // to this person at all.
      priority: 'high',
    })
  },
}

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
      'access.suspended',
      // B-043's scans and B-046's retry reminder. Subscribed here so B-050's
      // notices are a rule and a template — data — rather than another edit to
      // this list. All of them resolve to a recipient already (Tenant or
      // Lease), and an event with no rule yet is a no-op by design.
      'payment.retry_reminder',
      'payment_method.expiring',
      'protection.proof_expiring',
      'protection.auto_enrolled',
    ],
    handle: async ({ event }) => {
      await processCommsEvent(event)
    },
  },
  LEAD_CONSUMER,
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
    // B-044 / PRD 02 US-17. Recurring invoices.
    //
    // Runs at 1am local, BEFORE the expiry scans at 2am and after the midnight
    // sweeps: an invoice generated tonight is what the due-soon reminder and
    // the autopay run both read, so it goes first in the night.
    //
    // Re-runnable and catch-up-safe by construction — idempotency is the
    // unique constraint on (leaseId, periodStart), so a caught-up date for
    // last Tuesday generates exactly what Tuesday would have.
    name: 'billing.generate-invoices',
    localHour: 1,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await generateInvoices(facilityId!, businessDate, recordItem)
      // Same job, deliberately: a reminder for an invoice generated moments
      // ago in a separate job would depend on the order two JobRuns happened
      // to execute in. PRD 05 CN-3 wants these driven by billing, and this is
      // the billing run.
      await emitDueReminders(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-047 / PRD 02 US-21. Late fees.
    //
    // At 2am local: after invoices are generated at 1am, and before autopay at
    // 3am, so a fee raised tonight is collected tonight rather than sitting
    // uncharged for a day. US-21 assigns this to the delinquency engine, which
    // is B-057 in Phase 2 — this is the MVP path, and B-057 drives the same
    // functions from a timeline stage rather than reimplementing them.
    name: 'billing.assess-late-fees',
    localHour: 2,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await assessLateFees(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-057 / PRD 02 FR-5. The delinquency timeline engine.
    //
    // At 6am local, AFTER the dunning ladder at 5am and the access rule at 4am,
    // and last in the night for the same reason each of those gave: the day
    // count and the balance it reads must be tonight's settled figures. A
    // tenant whose autopay succeeded at 3am must not be advanced a lien step
    // at 6.
    //
    // A facility with no configured timeline does nothing here at all (B-056),
    // and the dunning ladder above stands down for any facility that HAS one —
    // otherwise both chase on day 1.
    name: 'delinquency.timeline',
    localHour: 6,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await runDelinquencyTimeline(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-052 / PRD 05 CN-3. The past-due dunning ladder.
    //
    // At 5am local, last in the night and after the access rule at 4am: the day
    // count and the balance it reads must be tonight's settled figures, and a
    // tenant whose autopay succeeded at 3am must not be chased at 5.
    //
    // Emits events only. Comms react through the ordinary rule pipeline, which
    // is CN-3's requirement that the ladder be driven by billing rather than by
    // a calendar of its own.
    name: 'billing.dunning',
    localHour: 5,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await runDunning(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-098 / PRD 02 US-45, decided as D-16. The single access threshold.
    //
    // At 4am local, LAST in the night: after invoices (1am), late fees (2am)
    // and autopay (3am), so the balance it reads is tonight's settled figure
    // rather than one that changes an hour later. A tenant whose autopay just
    // succeeded must not be suspended for a balance that no longer exists.
    //
    // This is the safety net, not the restore mechanism — US-45's ~2-minute
    // restore is called inline from the payment paths (see
    // lib/access/delinquency-gate.ts).
    name: 'access.evaluate-suspensions',
    localHour: 4,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await evaluateAccessSuspensions(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-045 / PRD 02 US-19. The nightly autopay run.
    //
    // At 3am local, AFTER invoice generation at 1am: on a catch-up tick that
    // walks several business dates, an invoice generated for a past due date
    // must be collectable on the same pass rather than waiting another night.
    //
    // The (jobName, facilityId, businessDate) uniqueness on `JobRun` is load-
    // bearing here in a way it is not for the read-only scans — it is what
    // makes the run's read-then-charge safe from a second concurrent run of
    // itself. See the four guards documented in lib/billing/autopay.ts.
    name: 'billing.autopay',
    localHour: 3,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await runAutopay(facilityId!, businessDate, recordItem)
      // Same job: the reminder cadence is driven by the declines this run
      // records, and splitting it into a second JobRun would make "did the
      // tenant get told today" depend on which of two jobs ran first.
      await emitRetryReminders(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-060 / PRD 02 US-35. Raises the day's "did anyone walk the property"
    // task.
    //
    // At 7am local, an hour before the leads sweep: this is a task for the
    // person opening the facility, and it should be waiting before the office
    // does rather than landing mid-morning.
    name: 'field-ops.raise-walkthrough',
    localHour: 7,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await raiseDailyWalkthrough(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-097 / PRD 02 US-43. Leads nobody has called back.
    //
    // At 8am local rather than overnight: this raises work for a person, and a
    // task created at 2am is one that sat there for six hours before anyone
    // could act on it. The window itself is per-facility and measured from when
    // the lead was taken, so an 8am sweep catches yesterday afternoon's calls
    // on the morning somebody can do something about them.
    name: 'leads.follow-up',
    localHour: 8,
    scope: 'per_facility',
    handler: async ({ facilityId, recordItem }) => {
      await raiseLeadFollowUps(facilityId!, new Date(), recordItem)
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
