import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { DEFAULT_RETRY_DAYS, isTerminalDecline } from '@storage/core/billing'
import { daysBetween } from '@storage/core/jobs'
import { installmentViews, isAutoCollecting, isFullyPaid } from '@storage/core/payment-plans'
import { systemLiftHold } from '@/lib/admin/holds'
import { lateFeeStepsFor } from '@/lib/billing/late-fees'
import { activeTimeline } from '@/lib/admin/delinquency-timeline'
import { createTask } from '@/lib/admin/tasks'
import { planProgressCents } from '@/lib/admin/payment-plans'
import type { RecordItem } from '@/lib/delinquency/engine'

// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). The nightly check a payment
// plan never had: has an installment's due date passed without enough paid
// against the lease since the plan started?
//
// Its own job step rather than folded into `delinquency.timeline` or
// `billing.dunning` (B-057's own comment on both stands down for a lease on
// hold — this is what decides whether it STAYS on hold). Registered at hour
// 4 in `lib/jobs/registry.ts`, after autopay (3am) settles the night's
// payments and before the dunning ladder (5am) and the timeline (6am) read
// `onHold` — so a plan broken tonight resumes collections THE SAME NIGHT
// rather than one run late.

export async function evaluatePaymentPlanBreaches(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const plans = await prisma.paymentPlan.findMany({
    where: { status: 'active', lease: { facilityId } },
    select: {
      id: true,
      leaseId: true,
      holdId: true,
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
          tenant: { select: { stripeDefaultPaymentMethodId: true } },
        },
      },
    },
  })
  if (plans.length === 0) return

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { paymentRetryDays: true, planGraceDays: true },
  })

  // D-107 (B-208). The day this facility considers rent genuinely late.
  const rentLateDay = await currentRentLateDay(facilityId, businessDate)

  // D-98 (B-190). An installment is not missed for BREACH purposes until its
  // grace has run out. Applied by moving the clock back rather than by
  // filtering the result, so it lands identically on every path below —
  // manual-pay plans included, which is where it matters most: those broke the
  // same night the date passed, over money that arrived that afternoon.
  //
  // Deliberately NOT applied to `isFullyPaid`, which asks a different question
  // (has everything been collected) and has no date in it at all.
  const breachDate = new Date(businessDate.getTime() - facility.planGraceDays * 86_400_000)

  for (const plan of plans) {
    // Recomputed from the covered invoices every night, not accumulated — so
    // a plan whose progress goes BACKWARDS (an ACH returned, a chargeback, a
    // refund; B-188) is re-evaluated tonight rather than at the next
    // installment date, and an installment that was covered by money the bank
    // has since taken back goes back to `missed`.
    const paidSinceCents = await planProgressCents(plan.totalCents, plan.invoiceIds)

    const missed = await brokenOn(plan, paidSinceCents, breachDate, businessDate, facility.paymentRetryDays)
    // D-107 (B-208). Only asked when the schedule itself is being kept —
    // an installment breach names the installment and needs no second reason.
    const overdueRent = missed ? null : await overdueRentOutsidePlan(plan, rentLateDay, businessDate)

    const breach = missed
      ? {
          // B-206. `installmentId` so the notice can name WHICH payment was
          // missed: a tenant who believes they paid has nothing to check
          // against without it. The decision of which installment broke the
          // plan is made here, against the grace window and the retry ladder,
          // and the send path must not re-derive it.
          event: 'payment_plan.broken' as const,
          payload: { planId: plan.id, installmentId: missed.id },
          reasonCode: 'payment_plan_broken',
          message: 'payment plan broken — collections resume',
        }
      : overdueRent
        ? {
            // D-107 (B-208). A different fact and a different message: this
            // tenant kept every installment. `invoiceId` for the same reason
            // `installmentId` is carried above — the send path must not
            // re-derive which unpaid rent ended the plan.
            event: 'payment_plan.broken_unpaid_rent' as const,
            payload: { planId: plan.id, invoiceId: overdueRent.id },
            reasonCode: 'payment_plan_broken_unpaid_rent',
            message: 'payment plan broken — rent outside the plan went unpaid',
          }
        : null

    if (breach) {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: 'broken', brokenAt: businessDate },
      })
      await systemLiftHold(plan.holdId, 'delinquency:payment-plan-breach', breach.reasonCode)
      // PRD 05 CN-24 (B-191). The same beat that lifts the hold. This job runs
      // at hour 4, the dunning ladder at 5 and the timeline at 6 — so the
      // tenant hears it from us before they hear it from the ladder, or from
      // the keypad.
      await emitEvent({
        name: breach.event,
        entityType: 'Lease',
        entityId: plan.leaseId,
        facilityId,
        payload: breach.payload,
      })
      await createTask({
        facilityId,
        type: 'payment_plan_broken',
        entityType: 'Lease',
        entityId: plan.leaseId,
        at: businessDate,
        priority: 'high',
      })
      recordItem({ itemId: plan.leaseId, ok: true, message: breach.message })
    } else if (isFullyPaid(plan.installments, paidSinceCents)) {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: 'completed', completedAt: businessDate },
      })
      await systemLiftHold(plan.holdId, 'delinquency:payment-plan-breach', 'payment_plan_completed')
      await emitEvent({
        name: 'payment_plan.completed',
        entityType: 'Lease',
        entityId: plan.leaseId,
        facilityId,
        payload: { planId: plan.id },
      })
      recordItem({ itemId: plan.leaseId, ok: true, message: 'payment plan completed' })
    }
  }
}


// PRD 05 CN-24 (B-191). The installment reminder.
//
// Same job step as the breach check above, for the reason `emitRetryReminders`
// rides with the autopay run: whether the tenant was warned and whether the
// plan survived are one night's work, and splitting them into two `JobRun`s
// would make "did we tell them" depend on which of two jobs ran first.
//
// **Once per installment comes from the JobRun, not from a stamp.** The
// scheduler holds a unique (jobName, facilityId, businessDate), so a catch-up
// tick walking five business dates emits each installment's reminder on the one
// date it is due — exactly the guarantee `emitDueReminders` relies on for
// invoices, and the reason neither needed a `reminderSentAt` column.
//
// **The lead time is the facility's own `invoiceLeadDays`.** CN-24 asks for
// "a per-facility configurable number of days ahead", and this facility
// already has a setting whose meaning is precisely that — how many days before
// money is due the tenant hears about it — with a control on `/admin/settings`
// and an operator who has already chosen a value. A second number beside it
// would be a new column configuring the same intent, which is the accumulation
// this repo's own first rule is about.
//
// **No autopay skip**, deliberately, and the opposite of CN-1's rule for an
// ordinary invoice: a tenant who believes an installment is automatic and is
// wrong loses the plan over a misunderstanding. The message says which kind of
// plan it is instead (`plan.collection_line`).
export async function emitInstallmentReminders(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { invoiceLeadDays: true },
  })
  const soon = new Date(businessDate.getTime() + facility.invoiceLeadDays * 86_400_000)

  const due = await prisma.paymentPlanInstallment.findMany({
    where: {
      dueDate: soon,
      plan: { status: 'active', lease: { facilityId } },
    },
    select: { id: true, amountCents: true, plan: { select: { id: true, leaseId: true } } },
  })

  for (const installment of due) {
    await emitEvent({
      name: 'payment_plan.installment_due_soon',
      entityType: 'Lease',
      entityId: installment.plan.leaseId,
      facilityId,
      payload: {
        planId: installment.plan.id,
        installmentId: installment.id,
        amountCents: installment.amountCents,
      },
    })
    recordItem({
      itemId: installment.plan.leaseId,
      ok: true,
      message: 'payment plan installment due soon',
    })
  }
}


/// The installment that broke the plan tonight, or null — an uncovered
/// installment whose date has passed AND whose collection has genuinely
/// finished failing.
///
/// Returns the installment rather than a boolean (B-206) because
/// `payment_plan_broken` names it to the tenant, and the alternative is the
/// send path re-running the grace window and the retry ladder to guess.
///
/// **Why this is not simply `isBreached` (B-189, CN-6).** Once an installment
/// is auto-collected, the night it falls due is also the night its card is
/// charged, and an off-session decline is recorded seconds before this job
/// runs. Breaking the plan on that would mean a tenant who agreed a schedule,
/// kept to it, and had one temporary decline loses the plan, the hold, and the
/// pause on late fees and access suspension — all before US-20's retry ladder
/// has made its second attempt. A decline and a decision not to pay are
/// different facts and this job must not treat them alike.
///
/// So an installment being collected keeps its plan alive for the length of
/// the ladder, and no longer. The window is bounded three ways, because "wait
/// for the retries" must never become "never break":
///
///   - The grace is the facility's own retry schedule, so it ends when the
///     schedule does rather than at a number invented here.
///   - A terminal decline (`expired_card` and friends) ends it immediately —
///     there is no next attempt to wait for, and B-046 already decided that.
///   - It applies ONLY where collection is genuinely in play. A manual-pay
///     plan (D-97's opt-out), a lease with autopay off, or a tenant with no
///     saved card has no ladder running, so a missed installment breaks the
///     plan the same night it always did.
async function brokenOn(
  plan: {
    autoCollect: boolean
    installments: readonly { id: string; dueDate: Date; amountCents: number }[]
    lease: { autopayEnabled: boolean; tenant: { stripeDefaultPaymentMethodId: string | null } }
  },
  paidSinceCents: number,
  /// D-98's grace window, already subtracted. What counts as missed.
  breachDate: Date,
  /// Tonight. What the retry ladder is measured against — grace and the
  /// ladder are two separate windows and must not be netted against one
  /// another, or a facility running both would get their sum.
  businessDate: Date,
  retryDays: readonly number[],
): Promise<{ id: string; dueDate: Date; amountCents: number } | null> {
  const missed = installmentViews(plan.installments, paidSinceCents, breachDate).filter(
    (view) => view.status === 'missed',
  )
  if (missed.length === 0) return null

  // `installmentViews` re-derives `position` from date order over the very
  // array passed in, so position N is row N-1 and every view has a row. Mapped
  // back once, here, rather than threading the id through core's view type.
  const missedRows = missed.map((view) => plan.installments[view.position - 1])

  const autoCollected = isAutoCollecting({
    autoCollect: plan.autoCollect,
    autopayEnabled: plan.lease.autopayEnabled,
    hasSavedCard: Boolean(plan.lease.tenant.stripeDefaultPaymentMethodId),
  })
  // Date order, so the earliest uncovered installment is both what broke the
  // plan and what the tenant will recognise: the first payment they were
  // expected to make and did not.
  if (!autoCollected) return missedRows[0]

  for (const installment of missedRows) {
    if (!(await ladderStillRunning(installment, businessDate, retryDays))) return installment
  }
  return null
}

/// Whether US-20's retry schedule still has an attempt to make for this
/// installment. Bounded by the last offset in the facility's own schedule, so
/// a charge that never happens at all cannot hold a plan open indefinitely.
async function ladderStillRunning(
  installment: { id: string; dueDate: Date },
  businessDate: Date,
  retryDays: readonly number[],
): Promise<boolean> {
  const schedule = retryDays.length > 0 ? retryDays : DEFAULT_RETRY_DAYS
  const lastOffset = Math.max(...schedule)
  if (daysBetween(installment.dueDate, businessDate) > lastOffset) return false

  const lastFailure = await prisma.payment.findFirst({
    where: { paymentPlanInstallmentId: installment.id, status: 'failed' },
    orderBy: { createdAt: 'desc' },
    select: { failureCode: true },
  })
  return !isTerminalDecline(lastFailure?.failureCode)
}


/// D-107 (B-208). The day this facility considers rent genuinely late — the
/// `daysPastDue` of its own first late-fee step.
///
/// Not a new setting. "When is rent late here" is a question this facility has
/// already answered, effective-dated, with a control an operator has already
/// used; a second column beside it configuring the same intent is exactly the
/// accumulation this repo's first rule is about. A lenient ladder therefore
/// buys a lenient plan rule automatically, which is the right coupling.
///
/// Falls back to the delinquency timeline's first step for a facility that
/// charges no late fees but does run a lien clock, and returns null when there
/// is neither — a facility that acts on late rent in no way at all hides
/// nothing behind a plan, so there is nothing for this to protect.
async function currentRentLateDay(facilityId: string, asOf: Date): Promise<number | null> {
  const steps = await lateFeeStepsFor(facilityId, asOf)
  if (steps.length > 0) return steps[0].daysPastDue
  const timeline = await activeTimeline(facilityId)
  return timeline?.steps[0]?.dayOffset ?? null
}

/// The rent the plan never deferred and the tenant has stopped paying, or null.
///
/// **The hole this closes (B-208).** `halt_late_fees` and `halt_dunning` are
/// evaluated per LEASE, not per invoice, so a plan's hold stands every
/// collections mechanism down on the whole lease — including rent invoiced
/// after the plan was agreed, which the plan never promised anything about.
/// B-189 narrowed autopay to the frozen `invoiceIds` so a card keeps paying
/// current rent; nothing did the equivalent for the fee ladder or the
/// timeline. A manual-pay tenant could therefore keep every installment, pay
/// no rent at all, and for up to ninety days take no late fee, no notice, no
/// access suspension and no lien clock — twice a year at
/// `planMaxPerRollingYear`. D-96 says current rent stays due on its own date;
/// this is what makes that sentence true of a tenant who does not pay it.
///
/// Rent only. A fee invoice raised after the plan started should not exist —
/// the hold is stopping the ladder that would raise it — and ending somebody's
/// forbearance over one is not what "current rent stays due" means.
///
/// `void` is excluded and nothing else is, matching `arrearsForLease`: the set
/// this asks about is the same set a plan would have been agreed over.
async function overdueRentOutsidePlan(
  plan: { leaseId: string; invoiceIds: string[] },
  rentLateDay: number | null,
  businessDate: Date,
): Promise<{ id: string } | null> {
  if (rentLateDay === null) return null
  const cutoff = new Date(businessDate.getTime() - rentLateDay * 86_400_000)

  const invoices = await prisma.invoice.findMany({
    where: {
      leaseId: plan.leaseId,
      kind: 'rent',
      status: { not: 'void' },
      dueDate: { lte: cutoff },
      id: { notIn: plan.invoiceIds },
    },
    orderBy: { dueDate: 'asc' },
    select: { id: true, totalCents: true, amountPaidCents: true },
  })
  // Oldest first, so what ends the plan is the first bill they let go past —
  // the one they will recognise, and the one the message names.
  return invoices.find((invoice) => invoice.totalCents > invoice.amountPaidCents) ?? null
}
