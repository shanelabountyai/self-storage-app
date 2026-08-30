import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { retryDecision } from '@storage/core/billing'
import { planProgressCents } from '@/lib/admin/payment-plans'
import { daysBetween } from '@storage/core/jobs'
import { createTask } from '@/lib/admin/tasks'
import { effectsByLease } from '@/lib/admin/holds'
import { createChargeIntent } from '@/lib/payments/intents'
import { stripeClient } from '@/lib/payments/stripe'

// PRD 02 US-19 (B-045) and US-20's retry schedule (B-046). The nightly autopay
// run.
//
// ── Why this cannot double-charge ────────────────────────────────────────────
//
// Four independent guards, deliberately layered, because the failure this
// prevents is charging a real person's card twice and the cost of one extra
// check is nothing next to that:
//
//   1. `runJob` (B-006) is unique on (jobName, facilityId, businessDate), so
//      two runs for the same facility on the same day cannot execute
//      concurrently. That is what makes the read-then-charge below safe from
//      itself rather than merely unlikely.
//   2. The query only selects invoices that are unpaid AND have no payment
//      attempt outstanding — a `pending` charge from an earlier tonight, or a
//      succeeded one, both take the invoice out of scope.
//   3. Stripe's idempotency key is derived from the invoice and the business
//      date, so a forced admin re-run within 24 hours returns the original
//      intent instead of making a second charge.
//   4. `createChargeIntent` recognises that deduplicated intent and discards
//      its own duplicate row rather than colliding on `stripePaymentIntentId`.
//
// Guard 2 is only durable because the webhook writes a `PaymentAllocation` and
// moves the invoice to `paid` (see `settleNamedInvoice`). Without that the
// invoice would read open forever and guard 2 would pass every night.
//
// ── And why it does not retry every night either ─────────────────────────────
//
// B-045 collected any unpaid invoice on every run, which is a retry schedule of
// "forever, nightly". US-20 wants +1/+3/+5 and then a person. `retryDecision`
// (packages/core/billing) is what gates it, counting the failed attempts on the
// invoice and measuring offsets from the invoice's ORIGINAL due date — never
// from the last attempt, which would stretch the schedule further on every
// decline instead of converging.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

/// How many declines put an invoice in front of the site manager.
///
/// Two, not four: waiting for the whole +1/+3/+5 schedule to finish means
/// nobody looks at it for six days, by which time the tenant is most of the way
/// to a late fee over something a phone call fixes. The schedule keeps running
/// after the flag — a person and a retry are not alternatives.
const MANAGER_FLAG_AFTER_DECLINES = 2

/// The tenant-facing reminder cadence after a card first declines: one message
/// a day for three days.
///
/// Deliberately NOT tied to the retry attempts. Retries land on +1/+3/+5, so
/// attempt-driven messages would arrive on days 1, 3 and 5 with silence in
/// between, and the day the tenant is most likely to act — the day after they
/// first hear — would say nothing. One a day for three days is a cadence a
/// person can act on, and it stops whether or not the retries have.
const REMINDER_DAYS = 3

export type AutopayResult = {
  charged: number
  failed: number
  skipped: number
}

/// Why an invoice was not charged. Named rather than counted, because US-19's
/// AC is "succeeded / failed / skipped **with reasons**" on the Billing Runs
/// screen, and "skipped: 41" tells an operator nothing.
type SkipReason =
  | 'autopay_off'
  | 'no_saved_card'
  | 'attempt_in_flight'
  | 'nothing_outstanding'
  | 'not_due_yet'
  | 'retries_exhausted'
  | 'terminal_decline'
  | 'lease_on_hold'
  | 'on_payment_plan'

const SKIP_MESSAGE: Record<SkipReason, string> = {
  autopay_off: 'autopay is off for this lease',
  no_saved_card: 'no saved card on file',
  attempt_in_flight: 'a charge for this invoice is already in flight',
  nothing_outstanding: 'nothing outstanding',
  not_due_yet: 'the next retry is not due yet',
  retries_exhausted: 'the retry schedule is finished — staff task raised',
  terminal_decline: 'the card cannot be retried — staff task raised',
  lease_on_hold: 'the lease is on hold',
  on_payment_plan: 'deferred under an agreed payment plan',
}

/// Charges every invoice due at this facility on or before the business date.
///
/// On or before, not exactly on: an invoice whose due date passed while the
/// scheduler was down must still be collected on the catch-up run rather than
/// silently becoming a delinquency the tenant did not earn.
export async function runAutopay(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<AutopayResult> {
  const result: AutopayResult = { charged: 0, failed: 0, skipped: 0 }

  if (!stripeClient()) {
    // A successful run that did nothing, not a failed one. See the same choice
    // in B-043's card scan: a red run every night for an unconfigured key
    // trains people to ignore the screen that exists to be noticed.
    recordItem({ itemId: facilityId, ok: true, message: 'skipped — Stripe is not configured' })
    return result
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { paymentRetryDays: true },
  })

  const invoices = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: { in: ['open', 'partially_paid'] },
      dueDate: { lte: businessDate },
      lease: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      number: true,
      dueDate: true,
      totalCents: true,
      amountPaidCents: true,
      leaseId: true,
      lease: {
        select: {
          autopayEnabled: true,
          tenantId: true,
          tenant: { select: { stripeDefaultPaymentMethodId: true } },
        },
      },
    },
  })

  const plans = await activePlansFor(facilityId)

  // US-42. A hold declaring `halt_autopay` stops us taking money at all — an
  // automatic stay under Chapter 7 makes a charge against a debtor a violation,
  // and halting the chasing while still helping ourselves to the balance would
  // be the worst of both.
  //
  // B-204. Read over BOTH populations, because they are not the same one. An
  // installment is charged off the plan, not off an invoice, so a plan lease
  // whose arrears are all frozen has nothing in `invoices` — and a set built
  // from that list alone misses exactly the leases `collectInstallments` is
  // about to charge. `bankruptcy`, `military_scra` and `deceased` all declare
  // `halt_autopay`, so that miss is a stay violation committed after somebody
  // correctly told the system not to.
  const onHold = await effectsByLease(
    [...invoices.map((invoice) => invoice.leaseId), ...plans.map((plan) => plan.leaseId)],
    'halt_autopay',
    businessDate,
  )

  // B-189. The arrears half of autopay stands down for a lease on an active
  // plan, and ONLY the arrears half.
  //
  // The `payment_plan` hold deliberately does not declare `halt_autopay`, and
  // adding it would be the wrong fix: that effect is all-or-nothing per lease,
  // so it would stop collecting current rent too and turn forbearance on what
  // is owed into a rent holiday nobody agreed to. What the plan defers is the
  // exact set of invoices it froze into `invoiceIds` at creation (D-96) — so
  // that is exactly what is skipped here, and September's rent, invoiced after
  // the plan started, is charged tonight like any other month's.
  //
  // Without this, `runAutopay` charged the FULL outstanding on every one of
  // those invoices the same night the plan was agreed: the precise outcome the
  // plan exists to prevent, executed by the system that was told about it.
  const deferredInvoiceIds = new Set(plans.flatMap((plan) => plan.invoiceIds))

  for (const invoice of invoices) {
    if (deferredInvoiceIds.has(invoice.id)) {
      result.skipped += 1
      recordItem({
        itemId: invoice.id,
        ok: true,
        message: `${invoice.number} skipped — ${SKIP_MESSAGE.on_payment_plan}`,
      })
      continue
    }

    if (onHold.has(invoice.leaseId)) {
      result.skipped += 1
      recordItem({
        itemId: invoice.id,
        ok: true,
        message: `${invoice.number} skipped — ${SKIP_MESSAGE.lease_on_hold}`,
      })
      continue
    }

    const outstanding = invoice.totalCents - invoice.amountPaidCents
    const failures = await declineHistory(invoice.id)
    const skip = await skipReasonFor(
      invoice,
      outstanding,
      businessDate,
      facility.paymentRetryDays,
      failures,
    )
    if (skip) {
      result.skipped += 1
      // Three ways an invoice lands in front of a person: the schedule ran out,
      // the card cannot be retried at all, or it has now declined enough times
      // that waiting for the schedule to finish is the wrong call. Raised here
      // rather than at the moment of the last decline because that decline may
      // have arrived on a webhook hours later, and this is the one place that
      // knows where the schedule stands.
      if (skip === 'retries_exhausted' || skip === 'terminal_decline') {
        await raiseFailedPaymentTask(facilityId, invoice)
      } else if (failures.length >= MANAGER_FLAG_AFTER_DECLINES) {
        await raiseFailedPaymentTask(facilityId, invoice)
      }
      recordItem({ itemId: invoice.id, ok: true, message: `${invoice.number} skipped — ${SKIP_MESSAGE[skip]}` })
      continue
    }

    try {
      const charge = await createChargeIntent({
        facilityId,
        tenantId: invoice.lease.tenantId,
        leaseId: invoice.leaseId,
        invoiceId: invoice.id,
        amountCents: outstanding,
        // The idempotency key. Includes the business date so B-046's retries on
        // +1/+3/+5 are genuinely new attempts rather than Stripe replaying the
        // first decline, while a re-run of the SAME night is deduplicated.
        reference: `autopay:${invoice.id}:${iso(businessDate)}`,
        description: `Autopay — invoice ${invoice.number}`,
        offSession: true,
        paymentMethodId: invoice.lease.tenant.stripeDefaultPaymentMethodId!,
      })

      if (charge.deduplicated) {
        result.skipped += 1
        recordItem({
          itemId: invoice.id,
          ok: true,
          message: `${invoice.number} skipped — already charged on this date`,
        })
        continue
      }

      result.charged += 1
      recordItem({
        itemId: invoice.id,
        ok: true,
        message: `${invoice.number} charged ${formatCents(outstanding)}`,
      })
    } catch (error) {
      // An off-session charge declines SYNCHRONOUSLY — Stripe throws rather
      // than sending a `payment_intent.payment_failed` webhook, because the
      // confirmation happened inside this request. So the failure has to be
      // recorded here; waiting for a webhook that is not coming is how a
      // decline becomes invisible and the retry schedule never starts.
      //
      // `createChargeIntent` has already marked its own Payment row failed with
      // the reason; what is left is the event B-046 and B-050 listen for.
      result.failed += 1
      const message = error instanceof Error ? error.message : String(error)

      // Found through the allocation this attempt wrote before calling Stripe,
      // not by guessing at the tenant's most recent failure — which would
      // attach the event to an unrelated decline whenever a tenant had two.
      const allocation = await prisma.paymentAllocation.findFirst({
        where: { invoiceId: invoice.id, payment: { status: 'failed' } },
        orderBy: { createdAt: 'desc' },
        select: { paymentId: true },
      })
      if (allocation) {
        await emitEvent({
          name: 'payment.failed',
          facilityId,
          entityType: 'Payment',
          entityId: allocation.paymentId,
          payload: {
            invoiceId: invoice.id,
            leaseId: invoice.leaseId,
            amountCents: outstanding,
            code: declineCode(error),
            source: 'autopay',
          },
        })
      }

      // The decline that just happened is not in `failures` yet.
      if (failures.length + 1 >= MANAGER_FLAG_AFTER_DECLINES) {
        await raiseFailedPaymentTask(facilityId, invoice)
      }

      recordItem({
        itemId: invoice.id,
        ok: false,
        message: `${invoice.number} declined — ${message.slice(0, 200)}`,
      })
    }
  }

  // The other direction of the same defect: before B-189 an installment due
  // date was a date on which nothing was charged at all, so a tenant with a
  // saved card had to remember to pay by hand or the hour-4 breach job broke
  // their plan for them.
  //
  // Run inside this job step rather than as its own so it lands between autopay
  // (hour 3) and the breach evaluation (hour 4) by construction — an
  // installment collected tonight must be visible to the job that decides
  // whether the plan survives the night, and a separate registry entry is one
  // reordering away from being wrong.
  await collectInstallments(facilityId, plans, onHold, businessDate, facility.paymentRetryDays, result, recordItem)

  return result
}

/// Every active plan at this facility, with what it needs to be collected.
///
/// Read once per run and shared by both halves — the stand-down above and the
/// collection below — so the two can never disagree about which invoices are
/// deferred and which plan deferred them.
async function activePlansFor(facilityId: string) {
  return prisma.paymentPlan.findMany({
    where: { status: 'active', lease: { facilityId } },
    select: {
      id: true,
      leaseId: true,
      totalCents: true,
      invoiceIds: true,
      autoCollect: true,
      installments: {
        orderBy: { dueDate: 'asc' },
        select: { id: true, dueDate: true, amountCents: true },
      },
      lease: {
        select: {
          autopayEnabled: true,
          tenantId: true,
          tenant: { select: { stripeDefaultPaymentMethodId: true } },
        },
      },
    },
  })
}

type ActivePlan = Awaited<ReturnType<typeof activePlansFor>>[number]

/// Charges tonight's installment on every plan that is auto-collected (D-97).
///
/// One installment at a time, and one charge for it — never one charge per
/// covered invoice. Two card charges for one agreed payment is how a tenant
/// who is already in collections reads their statement as a mistake, and a
/// disputed charge is the exact outcome B-147 had to build handling for.
///
/// The charge names no invoice. It carries the PLAN, and `applyPayment`
/// narrows the allocation to the invoices the plan froze — so the money lands
/// on the arrears in the facility's own allocation order and can never drift
/// onto rent the plan never deferred.
async function collectInstallments(
  facilityId: string,
  plans: readonly ActivePlan[],
  onHold: ReadonlySet<string>,
  businessDate: Date,
  retryDays: readonly number[],
  result: AutopayResult,
  recordItem: RecordItem,
): Promise<void> {
  for (const plan of plans) {
    // B-204. Before any of the manual-pay reasons, because this one is not a
    // preference: `halt_autopay` is what a bankruptcy stay, an SCRA hold or a
    // death is expressed as, and a plan agreed before the hold landed does not
    // survive it. Recorded rather than skipped silently so the run names the
    // lease it stood down on.
    if (onHold.has(plan.leaseId)) {
      result.skipped += 1
      recordItem({ itemId: plan.id, ok: true, message: `installment skipped — ${SKIP_MESSAGE.lease_on_hold}` })
      continue
    }

    // Three separate ways to be manual-pay, and they are different facts.
    // D-97's per-plan opt-out is the tenant choosing it at agreement; autopay
    // being off on the lease is the tenant having chosen it earlier and more
    // broadly; no saved method is nothing to charge. None of them is a
    // failure, and none of them breaks the plan — B-191's reminder is what
    // reaches a manual-pay tenant.
    if (!plan.autoCollect || !plan.lease.autopayEnabled) continue
    const paymentMethodId = plan.lease.tenant.stripeDefaultPaymentMethodId
    if (!paymentMethodId) continue

    const due = await installmentDueNow(plan, businessDate)
    if (!due) continue

    // A charge already raised for this installment and not yet resolved —
    // the same window B-045's `attempt_in_flight` guard covers, and the same
    // reason: a catch-up run walking several business dates in one tick passes
    // through it deliberately.
    const inFlight = await prisma.payment.findFirst({
      where: { paymentPlanInstallmentId: due.installment.id, status: { in: ['pending', 'succeeded'] } },
      select: { id: true },
    })
    if (inFlight) {
      result.skipped += 1
      recordItem({ itemId: plan.id, ok: true, message: `installment skipped — ${SKIP_MESSAGE.attempt_in_flight}` })
      continue
    }

    // US-20's ladder, anchored on the INSTALLMENT's due date rather than on
    // any invoice's. That is the date the tenant agreed to, and it is the date
    // the breach job measures against, so the two must not drift apart.
    const failures = await installmentDeclines(due.installment.id)
    const decision = retryDecision({
      dueDate: due.installment.dueDate,
      businessDate,
      failedAttempts: failures.length,
      retryDays,
      lastDeclineCode: failures[0]?.failureCode ?? null,
    })
    if (!decision.attempt) {
      result.skipped += 1
      recordItem({ itemId: plan.id, ok: true, message: `installment skipped — ${SKIP_MESSAGE[decision.reason]}` })
      continue
    }

    try {
      const charge = await createChargeIntent({
        facilityId,
        tenantId: plan.lease.tenantId,
        leaseId: plan.leaseId,
        amountCents: due.amountCents,
        paymentPlanId: plan.id,
        paymentPlanInstallmentId: due.installment.id,
        reference: `plan-installment:${due.installment.id}:${iso(businessDate)}`,
        description: `Payment plan installment ${due.position} — ${formatCents(due.amountCents)}`,
        offSession: true,
        paymentMethodId,
      })

      if (charge.deduplicated) {
        result.skipped += 1
        recordItem({ itemId: plan.id, ok: true, message: 'installment skipped — already charged on this date' })
        continue
      }

      result.charged += 1
      recordItem({
        itemId: plan.id,
        ok: true,
        message: `installment ${due.position} charged ${formatCents(due.amountCents)}`,
      })
    } catch (error) {
      // Same synchronous-decline shape as the invoice loop above: an
      // off-session charge throws rather than sending a webhook, so the
      // failure has to be recorded here. `createChargeIntent` has already
      // marked its own Payment row failed with the code, which is what the
      // ladder and the breach job both read.
      //
      // **No task is raised and the plan is NOT broken here.** A decline and a
      // decision not to pay are different facts (CN-6): the ladder keeps
      // running, and only when it is exhausted does the breach job treat the
      // installment as missed — at which point `payment_plan_broken` is the
      // task that reaches a person.
      result.failed += 1
      const message = error instanceof Error ? error.message : String(error)
      recordItem({
        itemId: plan.id,
        ok: false,
        message: `installment ${due.position} declined — ${message.slice(0, 200)}`,
      })
    }
  }
}

/// The installment to collect tonight, and what is actually left on it.
///
/// The amount is the CUMULATIVE schedule through that installment less what
/// the plan has retired, not the installment's face value: a tenant who paid
/// half of it at the counter must be charged the half that remains, and
/// `installmentViews` deliberately reports partial coverage as uncovered
/// rather than as a part-payment, so the face value would take the same money
/// twice.
async function installmentDueNow(
  plan: ActivePlan,
  businessDate: Date,
): Promise<{ installment: ActivePlan['installments'][number]; position: number; amountCents: number } | null> {
  if (plan.installments.length === 0) return null
  const progress = await planProgressCents(plan.totalCents, plan.invoiceIds)

  let cumulative = 0
  for (const [index, installment] of plan.installments.entries()) {
    cumulative += installment.amountCents
    if (cumulative <= progress) continue
    // The earliest installment the money has not reached. Anything after it is
    // a later date's problem, and if this one is not due yet nothing is.
    if (installment.dueDate.getTime() > businessDate.getTime()) return null
    return { installment, position: index + 1, amountCents: cumulative - progress }
  }
  return null
}

/// Failed charges against one installment, newest first — the count the retry
/// ladder branches on, and the code that decides whether there is a next try.
async function installmentDeclines(
  installmentId: string,
): Promise<{ failureCode: string | null }[]> {
  return prisma.payment.findMany({
    where: { paymentPlanInstallmentId: installmentId, status: 'failed' },
    orderBy: { createdAt: 'desc' },
    select: { failureCode: true },
  })
}

/// Every failed charge on an invoice, newest first. One query, read by the
/// retry decision (how many, and what the last code was) and by the
/// manager-flag threshold, so the two can never disagree about the count.
async function declineHistory(
  invoiceId: string,
): Promise<{ createdAt: Date; failureCode: string | null }[]> {
  const rows = await prisma.paymentAllocation.findMany({
    where: { invoiceId, payment: { status: 'failed' } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, payment: { select: { failureCode: true } } },
  })
  return rows.map((row) => ({ createdAt: row.createdAt, failureCode: row.payment.failureCode }))
}

async function skipReasonFor(
  invoice: {
    id: string
    dueDate: Date
    lease: { autopayEnabled: boolean; tenant: { stripeDefaultPaymentMethodId: string | null } }
  },
  outstanding: number,
  businessDate: Date,
  retryDays: readonly number[],
  failures: { failureCode: string | null }[],
): Promise<SkipReason | null> {
  if (outstanding <= 0) return 'nothing_outstanding'
  if (!invoice.lease.autopayEnabled) return 'autopay_off'
  // Both halves are needed and they live in two places on purpose (B-036): the
  // lease says whether this unit charges itself, the tenant says which card.
  // Either missing means nothing can be charged automatically.
  if (!invoice.lease.tenant.stripeDefaultPaymentMethodId) return 'no_saved_card'

  // A charge already raised for this invoice and not yet resolved. Covers the
  // window between "Stripe took the card" and "the webhook told us", which is
  // seconds — but a catch-up run walking several business dates in one tick
  // passes through that window on purpose.
  const inFlight = await prisma.paymentAllocation.findFirst({
    where: { invoiceId: invoice.id, payment: { status: { in: ['pending', 'succeeded'] } } },
    select: { id: true },
  })
  if (inFlight) return 'attempt_in_flight'

  // US-20's schedule: the count decides which retry is next, and the newest
  // decline's code decides whether there should be a next at all.
  const decision = retryDecision({
    dueDate: invoice.dueDate,
    businessDate,
    failedAttempts: failures.length,
    retryDays,
    lastDeclineCode: failures[0]?.failureCode ?? null,
  })

  return decision.attempt ? null : decision.reason
}

/// Puts an invoice autopay has given up on in front of a person (US-20's
/// "failed payments queue", US-41's one task list).
///
/// Idempotent twice over: `createTask` dedupes on (type, entityId, business
/// day), and the open-task check stops a fresh row appearing every night for as
/// long as the invoice stays unpaid — which, once the schedule is finished, is
/// every night until someone acts.
async function raiseFailedPaymentTask(
  facilityId: string,
  invoice: { id: string; number: string },
): Promise<void> {
  const open = await prisma.task.findFirst({
    where: { type: 'failed_payment', entityId: invoice.id, status: 'open' },
    select: { id: true },
  })
  if (open) return

  await createTask({
    facilityId,
    type: 'failed_payment',
    entityType: 'Invoice',
    entityId: invoice.id,
    // High regardless of which trigger raised it. By the time this exists the
    // automatic path has either stopped or is two declines in, and both are
    // "somebody should call this tenant today".
    priority: 'high',
  })
}

/// Stripe's own decline code, which is what tells B-046 whether to retry at all
/// — `expired_card` short-circuits the schedule (US-20) because retrying a card
/// that has expired three times just annoys the tenant three times.
function declineCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return null
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/// The tenant-facing reminder after a declined card: one a day for three days.
///
/// Anchored to the FIRST decline on an invoice, not to the retry attempts.
/// Retries land on +1/+3/+5, so an attempt-driven message would reach the
/// tenant on days 1, 3 and 5 with silence in between — and the day they are
/// most likely to act, the day after they first hear, would say nothing.
///
/// Runs as its own pass rather than inside the charge loop because day 2 has no
/// retry attempt at all, so there is no charge for the message to hang off.
///
/// Idempotency is the event log, the same record B-043's scans use: at most one
/// reminder per invoice per business date, and never more than three in total.
/// Two guards rather than one because they fail differently — the per-date key
/// stops a re-run of tonight sending twice, and the count stops a catch-up walk
/// across a long outage sending eight.
///
/// **This sends email today.** MVP comms is email-only (PRD 05 FR-4); the SMS
/// channel, its quiet hours and STOP/HELP handling are B-074. Because the
/// message is an event and the channel is a rule, this becomes a text when that
/// item configures one, with no change here.
export async function emitRetryReminders(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: { in: ['open', 'partially_paid'] },
      lease: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
      // Only invoices a charge has actually failed on. A tenant who has simply
      // not been charged yet has nothing to be reminded about.
      allocations: { some: { payment: { status: 'failed' } } },
    },
    select: { id: true, number: true, leaseId: true, totalCents: true, amountPaidCents: true },
  })
  if (invoices.length === 0) return

  const sent = await prisma.domainEvent.findMany({
    where: { name: 'payment.retry_reminder', entityId: { in: invoices.map((i) => i.leaseId) } },
    select: { entityId: true, payload: true },
  })

  const byLease = new Map<string, { dates: Set<string>; count: number }>()
  for (const event of sent) {
    const payload = (event.payload ?? {}) as { invoiceId?: unknown; businessDate?: unknown }
    const bucket = byLease.get(event.entityId) ?? { dates: new Set<string>(), count: 0 }
    bucket.dates.add(`${String(payload.invoiceId)}:${String(payload.businessDate)}`)
    bucket.count += 1
    byLease.set(event.entityId, bucket)
  }

  for (const invoice of invoices) {
    if (invoice.totalCents - invoice.amountPaidCents <= 0) continue

    const failures = await declineHistory(invoice.id)
    if (failures.length === 0) continue

    // The oldest decline is the anchor — `declineHistory` returns newest first.
    const firstDecline = failures[failures.length - 1].createdAt
    const day = daysBetween(startOfUtcDay(firstDecline), businessDate)
    if (day < 0 || day >= REMINDER_DAYS) continue

    const history = byLease.get(invoice.leaseId)
    if (history && history.count >= REMINDER_DAYS) continue
    if (history?.dates.has(`${invoice.id}:${iso(businessDate)}`)) continue

    await emitEvent({
      name: 'payment.retry_reminder',
      // Against the Lease, not the Invoice: the comms service resolves a
      // recipient from a lease already, and the tenant identifies with the unit
      // rather than an invoice number.
      entityType: 'Lease',
      entityId: invoice.leaseId,
      facilityId,
      payload: {
        invoiceId: invoice.id,
        number: invoice.number,
        businessDate: iso(businessDate),
        outstandingCents: invoice.totalCents - invoice.amountPaidCents,
        // Which of the three this is, so the message can escalate its wording
        // rather than repeating itself verbatim for three days.
        reminderNumber: (history?.count ?? 0) + 1,
        remindersTotal: REMINDER_DAYS,
      },
    })
    recordItem({
      itemId: invoice.id,
      ok: true,
      message: `${invoice.number} reminder ${(history?.count ?? 0) + 1} of ${REMINDER_DAYS} sent`,
    })
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
