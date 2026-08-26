import type { Consumer } from '@storage/core/events'
import { expireReservations } from '@/lib/reservations/reserve'
import { expireCheckoutSessions } from '@/lib/checkout/session'
import { drainGateCommands } from '@/lib/access/service'
import { reconcileFacility } from '@/lib/access/reconciliation'
import { pruneRetiredSecrets } from '@/lib/access/webhook-secrets'
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
import { evaluatePaymentPlanBreaches } from '@/lib/delinquency/payment-plan-breach'
import { releaseStuckOverlocks } from '@/lib/delinquency/overlock'
import { raiseDailyWalkthrough } from '@/lib/field-ops/walkthrough'
import { raiseReviewRequests } from '@/lib/reviews/request-job'
import { raiseLeadDripSteps } from '@/lib/leads/drip-job'
import { detectDailyFailureRate, detectSilentDunning } from '@/lib/comms/detectors'
import { applyDueRateIncreases, sendDueRateIncreaseNotices } from '@/lib/pricing/tenant-rate-increases'
import { applyDueProtectionChanges } from '@/lib/protection/changes'
import { sendDueReports } from '@/lib/admin/report-subscriptions'
import { submitUrls, SUBMIT_LIMIT } from '@/lib/marketing/indexnow'
import { siteOrigin, hasCanonicalDomain } from '@/lib/marketing/origin'
import { pageKind, absoluteUrl } from '@storage/core/marketing'
import { runStructuredDataMonitor } from '@/lib/marketing/structured-data-monitor'
import { alertOwner } from '@/lib/comms/alerts'
import sitemap from '@/app/sitemap'

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
      // B-063 / PRD 05 CN-11, CN-12. Two catalog names B-057 reserved
      // (`overlock.required`/`overlock.cleared`) with nothing emitting them
      // until now, plus the pre-lien/lien courtesy supplement.
      'overlock.required',
      'overlock.cleared',
      'notice.generated',
      // PRD 04 US-7 (B-071). The review-request ask.
      'review.requested',
      // PRD 04 US-14 (B-072). The lead drip.
      'lead.drip_step',
      // PRD 02 US-11 / PRD 05 CN-9 (B-076). The rate-increase notice.
      'lease.rate_increase_scheduled',
      // PRD 02 US-14 (B-077). The transfer confirmation.
      'lease.transferred',
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
    // PRD 03 FR-9 (B-080). The nightly expected-vs-actual gate reconciliation.
    //
    // Per facility and at 3am local, which is the one hour of the day a gate is
    // least likely to be in use: the snapshot is a read of the whole controller
    // and a site that is busy while it runs can produce a finding for a code
    // that was legitimately mid-change.
    //
    // A facility whose adapter cannot enumerate — the manual one, and a vendor
    // whose API has no list endpoint — still gets a row, recorded as NOT
    // verifiable. Skipping it would let a site quietly go six months without
    // anybody noticing it was never being checked.
    name: 'access.reconcile',
    localHour: 3,
    scope: 'per_facility',
    handler: async ({ facilityId, recordItem }) => {
      if (!facilityId) return
      const result = await reconcileFacility(facilityId)
      recordItem({
        itemId: facilityId,
        // Drift is a finding, not a job failure — the job did exactly what it
        // was asked to. Marking it failed would put a red mark on the runner
        // every night at a site with one known ghost code, and a runner that is
        // always red is a runner nobody reads.
        ok: true,
        message: result.verifiable
          ? `checked ${result.credentialsChecked}, ${result.drifts.length} drift${result.drifts.length === 1 ? '' : 's'}${result.permissiveCount > 0 ? ` (${result.permissiveCount} gate-too-permissive)` : ''}`
          : `not verifiable: ${result.reason ?? 'adapter cannot enumerate'}`,
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
      // SR-4 (B-080). A secret whose grace window has closed is a key that can
      // still be leaked for no remaining benefit — the whole point of the
      // window is that it ends. Swept here rather than in its own job because
      // it is two rows a week at most.
      const pruned = await pruneRetiredSecrets()
      recordItem({
        itemId: 'global',
        ok: result.deadLettered === 0,
        message: `sent ${result.succeeded}, retrying ${result.failed}, dead-lettered ${result.deadLettered}${pruned > 0 ? `, pruned ${pruned} retired webhook secret${pruned === 1 ? '' : 's'}` : ''}`,
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
    // B-076 / PRD 02 US-11. "The new rate applies automatically to the first
    // invoice on/after the effective date."
    //
    // At hour 0, and the ordering is the whole mechanism: this runs BEFORE
    // `billing.generate-invoices` at hour 1, so an increase effective today
    // has already moved `Lease.monthlyRateCents` by the time tonight's
    // invoice reads it. Doing it the other way round would mean every
    // increase landed one billing period late, silently.
    name: 'pricing.apply-rate-increases',
    localHour: 0,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await applyDueRateIncreases(facilityId!, businessDate, recordItem)
    },
  },
  {
    // PRD 01 US-705 (B-104). A protection change "takes effect next billing
    // cycle", so it has to land on `Lease.protectionCents` BEFORE
    // `billing.generate-invoices` at hour 1 reads it — the same ordering
    // constraint, and for the same reason, as the rate increases above. The
    // other way round and every change a tenant made would arrive one whole
    // month after the date they were promised.
    name: 'protection.apply-changes',
    localHour: 0,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await applyDueProtectionChanges(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-076 / PRD 05 CN-9. "Send the tenant notice on the configured
    // advance-notice date."
    //
    // At 10am local rather than overnight, and for the same reason B-071's
    // review request is mid-morning: this is a letter telling somebody their
    // rent is going up, and one that arrives at 3am reads worse than one
    // that arrives during business hours — when they can ring the office
    // about it and somebody is there.
    name: 'pricing.send-rate-increase-notices',
    localHour: 10,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await sendDueRateIncreaseNotices(facilityId!, businessDate, recordItem)
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
    // B-169. Locks left on units whose lease has ended.
    //
    // **Its own step, deliberately, and that is the whole fix.** B-151 put this
    // inside `delinquency.timeline` above, which returns early for any facility
    // with no configured timeline — so the sites most likely to have stuck
    // locks were the only ones the backstop could never reach, and the units it
    // was built to free were exactly the units it could not.
    //
    // Runs at the same hour, after the timeline: a lease that ENDS tonight
    // releases its own lock in its own transaction, and this is what catches
    // the ones that did not.
    name: 'delinquency.stuck-overlocks',
    localHour: 6,
    scope: 'per_facility',
    handler: async ({ facilityId, recordItem }) => {
      await releaseStuckOverlocks(facilityId!, recordItem)
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
      const result = await runDunning(facilityId!, businessDate, recordItem)
      // PRD 05 FR-19 (B-075). The silent-failure detector for this exact
      // job — checked with the result already in hand, not a second query
      // re-deriving "delinquent" by a different definition.
      await detectSilentDunning(facilityId!, businessDate, result)
    },
  },
  {
    // PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). Payment plans that missed
    // their own schedule.
    //
    // At 4am local — after autopay at 3am, so tonight's payments have already
    // settled onto the ledger this reads, and BEFORE the dunning ladder at
    // 5am and the delinquency timeline at 6am, both of which read `onHold`:
    // a plan broken here resumes collections the same night rather than one
    // run late.
    name: 'delinquency.payment-plan-breach',
    localHour: 4,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await evaluatePaymentPlanBreaches(facilityId!, businessDate, recordItem)
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
    // B-071 / PRD 04 US-7. The review-request ask, N days after move-in.
    //
    // At 9am local — after the leads sweep at 8am, and deliberately mid-
    // morning rather than overnight: this reaches a happy tenant's inbox, and
    // an ask that lands at 3am reads as a robot rather than a facility that
    // noticed they settled in well.
    name: 'reviews.raise-requests',
    localHour: 9,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await raiseReviewRequests(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-072 / PRD 04 US-14. The lead drip's day-counted steps (+2, +5). Step 1
    // fires immediately from capture, not from this job — see drip-job.ts.
    //
    // At 11am local, after the review-request job at 9am: this is outreach to
    // a stranger who has not rented yet, lower priority than anything touching
    // an existing tenant, and still comfortably inside FR-MSG-5's 8am–9pm
    // window with room for the dispatcher to catch up behind it.
    name: 'leads.raise-drip-steps',
    localHour: 11,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      await raiseLeadDripSteps(facilityId!, businessDate, recordItem)
    },
  },
  {
    // B-084 part 3 / PRD 02 US-40. Scheduled report emails.
    //
    // 6am local: before the working day, and AFTER the overnight billing and
    // delinquency sweeps at 2am and 3am — so an operator opening the email at
    // 8am is reading figures that already include last night's invoices and
    // late fees. Running it earlier would email a picture those jobs were about
    // to change.
    //
    // One job for every cadence rather than three. `runJob` already dedupes per
    // facility per business date, and each subscription decides for itself
    // whether today is its day (`sendsOn`) — so a weekly and a monthly on the
    // same facility cannot race, and there is one place to look when an email
    // did not arrive.
    name: 'reports.email',
    localHour: 6,
    scope: 'per_facility',
    handler: async ({ facilityId, recordItem }) => {
      if (!facilityId) return
      const facility = await prisma.facility.findUnique({
        where: { id: facilityId },
        select: { id: true, name: true, timezone: true },
      })
      if (!facility) return
      const summary = await sendDueReports(facility, new Date())
      recordItem({
        itemId: facilityId,
        ok: true,
        message: `sent ${summary.sent}, skipped ${summary.skipped}`,
      })
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
  {
    // PRD 05 FR-19 (B-075). "Alert to owner if >2% of a day's sends fail."
    // Last in the night, at 23 local — after every job whose comms this
    // reads has had all day to run, so the day it checks is a settled one
    // rather than one still in flight.
    name: 'comms.detect-daily-failure-rate',
    localHour: 23,
    scope: 'per_facility',
    handler: async ({ facilityId, businessDate, recordItem }) => {
      const result = await detectDailyFailureRate(facilityId!, businessDate)
      recordItem({
        itemId: facilityId!,
        ok: !result.alerted,
        message: result.alerted ? 'failure rate exceeded 2% — owner alerted' : 'within threshold',
      })
    },
  },
  {
    // PRD 04 §7 Phase 3 (B-087 part 1). "IndexNow/sitemap ping automation."
    //
    // Global and at 05 UTC, after every per-facility job that can change what a
    // page says has run for the day: `pricing.apply-rate-increases` at hour 0
    // and the billing chain behind it all move facility state, and submitting
    // before them would announce yesterday's page.
    //
    // **Which URLs.** Those the sitemap advertises whose `lastModified` falls
    // on or after this business date — IndexNow is explicitly for URLs that
    // CHANGED, and a daily resubmission of everything is the shape that gets a
    // host throttled. `static` pages are excluded because their `lastModified`
    // is the request time (see `sitemap.ts`), so they would qualify every
    // single day while never having changed.
    //
    // ponytail: `lastModified` for a facility is `Facility.updatedAt`, which
    // does NOT move when a rate on one of its unit types changes — so a
    // price-only change is not submitted. That is the sitemap's existing
    // limitation rather than one introduced here, and the fix belongs with the
    // sitemap; the upgrade is a derived last-changed date per facility that
    // takes the newest of the facility row and its rate records.
    name: 'marketing.indexnow-submit',
    localHour: 5,
    scope: 'global',
    handler: async ({ businessDate, recordItem }) => {
      // A preview or a not-yet-domained production deployment must never
      // announce its URLs — the same reasoning `hasCanonicalDomain` already
      // carries for the canonical tag, and here the consequence is asking four
      // search engines to index the twin of the real site.
      if (!hasCanonicalDomain()) {
        recordItem({ itemId: 'global', ok: true, message: 'skipped: no canonical domain configured' })
        return
      }

      const entries = await sitemap()
      const changed = entries
        .filter((entry) => pageKind(new URL(entry.url).pathname) !== 'static')
        .filter((entry) => {
          const modified = entry.lastModified ? new Date(entry.lastModified) : null
          return modified !== null && modified.getTime() >= businessDate.getTime()
        })
        .map((entry) => entry.url)

      const result = await submitUrls(siteOrigin(), changed)
      recordItem({
        itemId: 'global',
        // A search engine being unreachable is not this job failing at what it
        // was asked to do, but it IS the only signal that submissions have
        // stopped — an unconfigured key would otherwise be silent forever.
        ok: result.ok,
        message: result.ok
          ? `submitted ${result.submitted} changed URL${result.submitted === 1 ? '' : 's'}${result.truncated ? ` (capped at ${SUBMIT_LIMIT})` : ''}`
          : (result.problem ?? 'submission failed'),
      })
    },
  },
  {
    // PRD 04 §7 Phase 3 (B-087 part 1). "Structured-data monitoring alerts."
    //
    // Global and at 06 UTC, an hour after the submission above: the pages this
    // fetches are the pages that were just announced, and finding out that the
    // markup on one of them is broken is more useful straight after telling
    // four crawlers to come and look at it.
    //
    // The alert is `alertOwner` rather than a `Task`, and that is forced rather
    // than chosen: `Task` requires a `facilityId`, and a guide page and a city
    // page belong to no facility. Splitting the findings so the facility ones
    // become tasks and the rest become an email would mean two channels for one
    // problem, and the half nobody watches is always the one that matters.
    name: 'marketing.structured-data-monitor',
    localHour: 6,
    scope: 'global',
    handler: async ({ businessDate, recordItem }) => {
      if (!hasCanonicalDomain()) {
        recordItem({ itemId: 'global', ok: true, message: 'skipped: no canonical domain configured' })
        return
      }

      const run = await runStructuredDataMonitor()
      const failing = run.broken.length + run.unreachable.length

      if (failing > 0) {
        const lines = [...run.unreachable, ...run.broken].slice(0, 10).map((check) =>
          check.fetchProblem
            ? `${check.url} — ${check.fetchProblem}`
            : `${check.url} — ${check.findings.map((finding) => finding.problem).join(' ')}`,
        )
        await alertOwner(
          // Keyed on the business date, so a break that persists alerts once a
          // day rather than once per catch-up run, and a NEW day's identical
          // break still gets through. Same contract as the comms detectors.
          `structured_data:${businessDate.toISOString().slice(0, 10)}`,
          `Structured data: ${failing} page${failing === 1 ? '' : 's'} need attention`,
          [
            `${failing} of ${run.checked} monitored pages have a structured-data problem.`,
            '',
            ...lines,
            failing > lines.length ? `…and ${failing - lines.length} more.` : '',
            '',
            `Full report: ${absoluteUrl(run.origin, '/admin/reports/structured-data')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }

      recordItem({
        itemId: 'global',
        // A broken page is a finding, not a failed job — the same reasoning
        // `access.reconcile` uses for gate drift. A runner that is red every
        // night at a site with one known problem is a runner nobody reads.
        ok: true,
        message: `checked ${run.checked}, ${run.intact} intact, ${failing} needing attention`,
      })
    },
  },
]