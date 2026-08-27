import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { DEFAULT_RETRY_DAYS, isTerminalDecline } from '@storage/core/billing'
import { daysBetween } from '@storage/core/jobs'
import { installmentViews, isAutoCollecting, isFullyPaid } from '@storage/core/payment-plans'
import { systemLiftHold } from '@/lib/admin/holds'
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

    if (await isBroken(plan, paidSinceCents, breachDate, businessDate, facility.paymentRetryDays)) {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: 'broken', brokenAt: businessDate },
      })
      await systemLiftHold(plan.holdId, 'delinquency:payment-plan-breach', 'payment_plan_broken')
      // PRD 05 CN-24 (B-191). The same beat that lifts the hold. This job runs
      // at hour 4, the dunning ladder at 5 and the timeline at 6 — so the
      // tenant hears it from us before they hear it from the ladder, or from
      // the keypad.
      await emitEvent({
        name: 'payment_plan.broken',
        entityType: 'Lease',
        entityId: plan.leaseId,
        facilityId,
        payload: { planId: plan.id },
      })
      await createTask({
        facilityId,
        type: 'payment_plan_broken',
        entityType: 'Lease',
        entityId: plan.leaseId,
        at: businessDate,
        priority: 'high',
      })
      recordItem({ itemId: plan.leaseId, ok: true, message: 'payment plan broken — collections resume' })
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


/// Whether a plan is broken tonight — an uncovered installment whose date has
/// passed AND whose collection has genuinely finished failing.
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
async function isBroken(
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
): Promise<boolean> {
  const missed = installmentViews(plan.installments, paidSinceCents, breachDate).filter(
    (view) => view.status === 'missed',
  )
  if (missed.length === 0) return false

  const autoCollected = isAutoCollecting({
    autoCollect: plan.autoCollect,
    autopayEnabled: plan.lease.autopayEnabled,
    hasSavedCard: Boolean(plan.lease.tenant.stripeDefaultPaymentMethodId),
  })
  if (!autoCollected) return true

  // `installmentViews` re-derives `position` from date order, which is the same
  // order the rows were selected in — so position N is row N-1 and the id is
  // recoverable without threading it through core's view type.
  for (const view of missed) {
    const installment = plan.installments[view.position - 1]
    if (!installment) return true
    if (!(await ladderStillRunning(installment, businessDate, retryDays))) return true
  }
  return false
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
