import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { businessDateFor } from '@storage/core/jobs'
import { emitEvent } from '@storage/core/events'
import {
  installmentViews,
  isAutoCollecting,
  validateSchedule,
  type InstallmentView,
  type PlanProblem,
  type PlannedInstallment,
} from '@storage/core/payment-plans'
import {
  actorRank,
  assertFacilityAccess,
  can,
  checkMonetaryAuthority,
  ForbiddenError,
  lowestRankWith,
  nextApproverRole,
} from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { liftHold, placeHold } from './holds'

// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). Creating, viewing and
// cancelling a delinquency payment plan.
//
// Gated on `delinquency:execute_step` — manager and above — rather than the
// `tenants:edit` a hold placement alone needs: agreeing a schedule is a
// financial commitment the business is making, the same tier as executing a
// queued lien step, not a counter conversation. Breaking one is the system's
// own job (`lib/delinquency/payment-plan-breach.ts`), not this file's.

export type CreatePaymentPlanInput = {
  installments: PlannedInstallment[]
  note?: string | null
  /// D-97. Whether the installments are charged from the tenant's saved card
  /// on their due dates. Defaults to true where the caller says nothing —
  /// auto-collection is the default the owner chose, and a plan agreed by a
  /// caller that predates this field should behave the way the policy says.
  autoCollect?: boolean
}

export type CreatePaymentPlanResult =
  | { ok: true; planId: string }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'already_active' }
  | { ok: false; reason: 'invalid_schedule'; problems: PlanProblem[] }
  /// D-98. The deferral is larger than this actor may commit to. Same shape
  /// and same posture as a fee waiver over limit: it names who can carry it
  /// rather than simply refusing, and there is no approval queue behind it —
  /// that is still `waiveFeeInvoice`'s open gap and this does not invent a
  /// second one.
  | { ok: false; reason: 'over_limit'; limitCents: number; escalateTo: string | null }
  /// D-98. The lease has already had `limit` plans inside a rolling year.
  | { ok: false; reason: 'too_many_plans'; priorCount: number; limit: number }
  /// D-98. A repeat plan inside the rolling year, attempted by somebody at the
  /// lowest rank that may agree one at all. The second gets seen a level up.
  | { ok: false; reason: 'needs_escalation'; priorCount: number; escalateTo: string | null }

export async function createPaymentPlan(
  actor: Actor,
  leaseId: string,
  input: CreatePaymentPlanInput,
): Promise<CreatePaymentPlanResult> {
  if (actor.kind !== 'staff') return { ok: false, reason: 'forbidden' }

  const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { facilityId: true } })
  if (!lease) return { ok: false, reason: 'not_found' }

  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'delinquency:execute_step', lease.facilityId)) {
    throw new ForbiddenError(
      'Missing permission to set up a payment plan',
      'delinquency:execute_step',
      lease.facilityId,
    )
  }

  // One ACTIVE plan per lease at a time (see the schema comment on
  // `PaymentPlan`) — a second one would leave two schedules both claiming to
  // say what "kept the plan" means.
  const existing = await prisma.paymentPlan.findFirst({
    where: { leaseId, status: 'active' },
    select: { id: true },
  })
  if (existing) return { ok: false, reason: 'already_active' }

  // **The plan is measured against what is owed, not against its own sum.**
  // Before B-188 `totalCents` was the sum of the installments and was then
  // handed to `validateSchedule` as the figure to check that sum against, so
  // the one branch that exists to catch a plan not adding up to the arrears
  // was unreachable from the only caller: a $50 plan against an $1,800 arrear
  // validated, halted the ladder and completed itself.
  const now = new Date()
  const arrears = await arrearsForLease(leaseId, now)
  const totalCents = arrears.outstandingCents

  // ── D-98. What this plan may commit to, and whether this lease may have it ──
  //
  // Order matters: the caps are checked BEFORE the schedule so that a staffer
  // told "this lease cannot have another plan this year" is not first made to
  // fix six dates on a form that was never going to be accepted.
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: lease.facilityId },
    select: { planMaxDays: true, planMaxPerRollingYear: true, timezone: true },
  })

  // Every plan on this lease in the last rolling year, whatever became of it.
  // Cancelled and broken ones COUNT — the whole defect was that a plan broken
  // last night was replaceable this morning, for ever, each replacement
  // re-halting dunning, late fees and access suspension while the lien clock
  // never ran.
  //
  // ONE exception, and it does not reopen D-98 (B-209): a plan cancelled on
  // the same facility-local day it was created, having collected nothing while
  // it stood, is a CORRECTION rather than an arrangement. A manager who
  // mistypes an installment date, spots it and re-enters the schedule had
  // otherwise spent one of the lease's two plans for the year — on a Saturday,
  // at the counter, with no amend path anywhere in the product.
  //
  // It cannot buy anybody a free plan, on two counts. A plan cancelled the day
  // it was agreed provided no forbearance to speak of: its hold is lifted with
  // it, and any plan that survives past local midnight counts however it ends.
  // And a payment landing on the covered arrears while it stood makes it count
  // regardless, which is the case a cancel-and-re-agree would be reaching for.
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000)
  const priorPlans = await prisma.paymentPlan.findMany({
    where: { leaseId, createdAt: { gte: yearAgo } },
    select: { id: true, invoiceIds: true, createdAt: true, cancelledAt: true },
  })
  const priorCount = priorPlans.length - (await correctionCount(priorPlans, facility.timezone))
  if (priorCount >= facility.planMaxPerRollingYear) {
    return { ok: false, reason: 'too_many_plans', priorCount, limit: facility.planMaxPerRollingYear }
  }
  if (priorCount > 0) {
    // The second plan is agreed a rank up. Derived from the role table rather
    // than compared against a hardcoded 'manager', so a new role between the
    // existing two slots in without a code change.
    const floor = await lowestRankWith('delinquency:execute_step')
    const rank = actorRank(actor, lease.facilityId)
    if (floor !== null && rank !== null && rank <= floor) {
      return {
        ok: false,
        reason: 'needs_escalation',
        priorCount,
        escalateTo: (await nextApproverRole('payment_plan', totalCents, rank))?.name ?? null,
      }
    }
  }

  // The amount DEFERRED, which is the whole arrears — a plan is a decision not
  // to collect it now, made by one person, on a lease already in collections.
  const authority = checkMonetaryAuthority(actor, 'payment_plan', totalCents, lease.facilityId)
  if (!authority.allowed) {
    if (authority.reason === 'forbidden') return { ok: false, reason: 'forbidden' }
    return {
      ok: false,
      reason: 'over_limit',
      limitCents: authority.limitCents,
      escalateTo:
        authority.escalateToRank === null
          ? null
          : ((await nextApproverRole('payment_plan', totalCents, authority.escalateToRank))?.name ??
            null),
    }
  }

  const problems = validateSchedule(input.installments, totalCents, now, facility.planMaxDays)
  // The refusal names the arrears figure itself — `validateSchedule` builds it
  // into the message — so there is nothing extra for the caller to render.
  if (problems.length > 0) return { ok: false, reason: 'invalid_schedule', problems }

  const planId = await prisma.$transaction(async (tx) => {
    // Places the SAME hold type staff could already place by hand — this call
    // is what gives that hold a schedule. One transaction, one audit entry
    // for the hold (`hold.placed`) and a second for the schedule itself
    // (`payment_plan.created`) — see that action's comment for why both.
    const holdResult = await placeHold(
      actor,
      leaseId,
      {
        type: 'payment_plan',
        reason: `Payment plan agreed: ${input.installments.length} installment(s) totalling ${totalCents} cents.`,
      },
      tx,
    )
    if (!holdResult.ok) throw new Error(`could not place the payment_plan hold: ${holdResult.reason}`)

    const plan = await tx.paymentPlan.create({
      data: {
        leaseId,
        holdId: holdResult.holdId,
        totalCents,
        invoiceIds: arrears.invoiceIds,
        autoCollect: input.autoCollect ?? true,
        note: input.note?.trim() || null,
        createdByStaffId: actor.staffUserId,
        installments: {
          create: input.installments.map((installment, index) => ({
            position: index + 1,
            dueDate: installment.dueDate,
            amountCents: installment.amountCents,
          })),
        },
      },
      select: { id: true },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'payment_plan.created',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId: lease.facilityId,
        context: {
          planId: plan.id,
          holdId: holdResult.holdId,
          totalCents,
          autoCollect: input.autoCollect ?? true,
          installments: input.installments.map((installment) => ({
            dueDate: installment.dueDate.toISOString(),
            amountCents: installment.amountCents,
          })),
        },
      },
      tx,
    )

    // PRD 05 CN-24 (B-191). Inside the transaction, like every other emit in
    // this codebase: a plan that exists and was never announced is the exact
    // silence this rule exists to end, and the outbox is what makes "agreed"
    // and "told" one fact rather than two.
    //
    // Entity is the LEASE — that is what the comms recipient resolver reaches
    // a tenant through — with `planId` in the payload, because a lease can
    // have a chain of plans (D-98) and the message is about this one.
    await emitEvent(
      {
        name: 'payment_plan.agreed',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId: lease.facilityId,
        payload: { planId: plan.id, totalCents },
      },
      tx,
    )

    return plan.id
  })

  return { ok: true, planId }
}

export type CancelPaymentPlanResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'not_active' | 'missing_reason' | 'needs_manager' }

/// Cancels an active plan early — a staff decision, unlike a break. Lifts the
/// hold through the ordinary `liftHold` (audited as `hold.lifted`, reason
/// `management_approval`, same as lifting any other hold type by hand) and
/// records the plan-specific reason on the row itself.
export async function cancelPaymentPlan(
  actor: Actor,
  planId: string,
  cancelReason: string,
): Promise<CancelPaymentPlanResult> {
  if (actor.kind !== 'staff') return { ok: false, reason: 'forbidden' }
  if (!cancelReason?.trim()) return { ok: false, reason: 'missing_reason' }

  const plan = await prisma.paymentPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      status: true,
      holdId: true,
      leaseId: true,
      lease: { select: { facilityId: true } },
    },
  })
  if (!plan) return { ok: false, reason: 'not_found' }
  if (plan.status !== 'active') return { ok: false, reason: 'not_active' }

  assertFacilityAccess(actor, plan.lease.facilityId)
  if (!can(actor, 'delinquency:execute_step', plan.lease.facilityId)) {
    throw new ForbiddenError(
      'Missing permission to cancel a payment plan',
      'delinquency:execute_step',
      plan.lease.facilityId,
    )
  }

  const lifted = await liftHold(actor, plan.holdId, cancelReason)
  if (!lifted.ok) {
    // `payment_plan` does not set `liftRequiresManager`, so this is here only
    // to propagate honestly rather than to be reachable today.
    return { ok: false, reason: lifted.reason === 'needs_manager' ? 'needs_manager' : 'forbidden' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentPlan.update({
      where: { id: planId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByStaffId: actor.staffUserId,
        cancelReason: cancelReason.trim(),
      },
    })

    // B-206. The branch B-191 missed. Cancelling restarts late fees, the
    // dunning ladder and gate suspension exactly as a break does, and the
    // tenant is holding an email that says we hold off on all three while they
    // keep to the dates — which they did. Without this their first notice is
    // the keypad.
    //
    // In the same transaction as the status change, for the reason
    // `payment_plan.agreed` is: a plan that was cancelled and never announced
    // is the silence, not a missing nicety. The hold is lifted outside it
    // because `liftHold` writes its own audit entry and takes no `tx` — a
    // lifted hold with the plan still `active` is the pre-existing window and
    // is self-healing (the nightly job re-evaluates), whereas a cancelled plan
    // with no event is silent forever.
    await emitEvent(
      {
        name: 'payment_plan.cancelled',
        entityType: 'Lease',
        entityId: plan.leaseId,
        facilityId: plan.lease.facilityId,
        payload: { planId },
      },
      tx,
    )
  })

  return { ok: true }
}

export type PaymentPlanView = {
  id: string
  status: 'active' | 'completed' | 'broken' | 'cancelled'
  totalCents: number
  note: string | null
  createdAt: Date
  /// D-97. Whether installments are charged automatically. Reported alongside
  /// the schedule because "what happens on the 15th" is a different answer for
  /// the two kinds of plan, and a staffer reading the schedule to a tenant on
  /// the phone needs to know which one they are looking at.
  autoCollect: boolean
  /// Whether auto-collection can actually happen — the plan says yes AND the
  /// lease has autopay on AND the tenant has a saved card. A plan agreed as
  /// auto-collect against a tenant who later removed their card is manual-pay
  /// in fact, and a screen that says otherwise is telling a staffer a payment
  /// is taken care of when nothing will take it.
  autoCollectEffective: boolean
  /// D-98 (B-190). What this plan actually retired of the arrears it was
  /// agreed over. Exposed so that a CHAIN of plans reads as a chain: a
  /// replacement plan's own total is the arrears that were left, so its
  /// progress correctly restarts at zero, and without this figure beside it
  /// the money the previous plan collected is invisible on every screen.
  collectedCents: number
  installments: InstallmentView[]
}

/// The lease's current or most recent plan, with per-installment status
/// derived live against the ledger — never a stored flag (see the schema
/// comment on `PaymentPlanInstallment`).
/// Every plan this lease has ever had, newest first.
///
/// D-98 (B-190). This was a `findFirst` ordered `createdAt desc`, so a lease on
/// its fifth plan read on every screen as a lease on one plan and the pattern
/// — a broken plan replaced the next morning, indefinitely — was visible from
/// nothing. The cap in `createPaymentPlan` is what stops the chain; this is
/// what makes an existing one legible.
export async function paymentPlansForLease(
  leaseId: string,
  asOf: Date = new Date(),
): Promise<PaymentPlanView[]> {
  const plans = await prisma.paymentPlan.findMany({
    where: { leaseId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      totalCents: true,
      invoiceIds: true,
      autoCollect: true,
      note: true,
      createdAt: true,
      installments: { orderBy: { dueDate: 'asc' }, select: { dueDate: true, amountCents: true } },
      lease: {
        select: {
          autopayEnabled: true,
          // B-210. D-98's grace window, so every screen built off this view
          // reads a plan inside grace as `late` rather than as broken.
          facility: { select: { planGraceDays: true } },
          tenant: { select: { stripeDefaultPaymentMethodId: true } },
        },
      },
    },
  })

  // One progress query for the whole chain rather than one per plan — a lease
  // on its fifth plan (D-98) renders five rows on the tenant profile.
  const progress = await planProgressByPlan(plans)

  return Promise.all(
    plans.map(async (plan) => {
      const paidSinceCents = progress.get(plan.id)?.progressCents ?? 0
      return {
        id: plan.id,
        status: plan.status,
        totalCents: plan.totalCents,
        note: plan.note,
        createdAt: plan.createdAt,
        autoCollect: plan.autoCollect,
        autoCollectEffective: isAutoCollecting({
          autoCollect: plan.autoCollect,
          autopayEnabled: plan.lease.autopayEnabled,
          hasSavedCard: Boolean(plan.lease.tenant.stripeDefaultPaymentMethodId),
        }),
        collectedCents: paidSinceCents,
        installments: installmentViews(
          plan.installments,
          paidSinceCents,
          asOf,
          plan.lease.facility.planGraceDays,
        ),
      }
    }),
  )
}

/// The lease's current or most recent plan. Kept for the callers that only
/// ever want the live one — the portal dashboard card and the breach job's
/// siblings — so that adding the history did not turn every read into a list.
export async function paymentPlanForLease(
  leaseId: string,
  asOf: Date = new Date(),
): Promise<PaymentPlanView | null> {
  return (await paymentPlansForLease(leaseId, asOf))[0] ?? null
}

/// The lease's arrears: every invoice already due, net of what has settled it.
/// This is both what a plan may be agreed over and the set its progress is
/// measured against for the rest of its life — see `PaymentPlan.invoiceIds`.
///
/// `void` is excluded rather than counted at zero: a waived fee is a charge a
/// manager deliberately forgave, and a plan should neither promise to collect
/// it nor be held short by it.
export async function arrearsForLease(
  leaseId: string,
  asOf: Date,
): Promise<{ invoiceIds: string[]; outstandingCents: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { leaseId, status: { not: 'void' }, dueDate: { lte: asOf } },
    select: { id: true, totalCents: true, amountPaidCents: true },
  })
  const unsettled = invoices.filter((invoice) => invoice.totalCents > invoice.amountPaidCents)
  return {
    invoiceIds: unsettled.map((invoice) => invoice.id),
    outstandingCents: unsettled.reduce(
      (sum, invoice) => sum + (invoice.totalCents - invoice.amountPaidCents),
      0,
    ),
  }
}

/// How many of these plans are same-day corrections rather than arrangements
/// (B-209) — see the note in `createPaymentPlan`, which is the only caller.
///
/// The money test reads ALLOCATIONS inside the plan's own few minutes, not its
/// progress: progress is a live figure off the invoices, so the successor
/// plan's payments — or next spring's — would silently un-correct a mistype
/// somebody fixed in March, and a rule about what happened on one Saturday
/// must not change its mind afterwards.
async function correctionCount(
  plans: readonly { id: string; invoiceIds: string[]; createdAt: Date; cancelledAt: Date | null }[],
  timezone: string,
): Promise<number> {
  const sameDay = plans.filter(
    (plan) =>
      plan.cancelledAt !== null &&
      businessDateFor(plan.cancelledAt, timezone).getTime() ===
        businessDateFor(plan.createdAt, timezone).getTime(),
  )
  if (sameDay.length === 0) return 0

  const invoiceIds = [...new Set(sameDay.flatMap((plan) => plan.invoiceIds))]
  const allocations =
    invoiceIds.length === 0
      ? []
      : await prisma.paymentAllocation.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { invoiceId: true, createdAt: true },
        })

  return sameDay.filter(
    (plan) =>
      !allocations.some(
        (allocation) =>
          plan.invoiceIds.includes(allocation.invoiceId) &&
          allocation.createdAt >= plan.createdAt &&
          allocation.createdAt <= plan.cancelledAt!,
      ),
  ).length
}

/// What a plan's covered arrears have done since it was agreed, split three
/// ways (B-209).
///
/// `progressCents` is the figure the SCHEDULE is measured against — the debt
/// came down, and `installmentViews` is right not to care how. The other two
/// say how, and an owner deciding whether plans work at all needs the
/// difference: waive $600 of fees to make four plans agreeable and the debt
/// falls $600 with nobody having collected a cent.
export type PlanProgress = {
  /// `collectedCents + waivedCents`. What D-96 has always meant by progress.
  progressCents: number
  /// The part somebody actually paid — the frozen total less what is still
  /// outstanding on the covered invoices, counting a VOIDED one's unpaid
  /// remainder as still outstanding, because forgiving it collected nothing.
  collectedCents: number
  /// The part a manager forgave by voiding a covered invoice.
  waivedCents: number
}

/// How much of the arrears a plan has actually retired (D-96, B-188).
///
/// The frozen total less what is still outstanding on the invoices the plan
/// covers — NOT a sum of `type: 'payment'` ledger entries since the plan
/// started, which is what this replaced and which was wrong in two directions
/// at once. It counted money that came straight back out (a returned ACH, a
/// chargeback and a refund each leave the original `payment` row standing by
/// design, so every installment they had covered kept reading `paid` and a
/// plan could complete itself and lift its own hold on money the bank had
/// taken), and it counted money that was never meant for the arrears at all
/// (a tenant on a plan for $1,800 who paid only next month's $150 rent had
/// installment 1 marked paid while the plan collected nothing).
///
/// Reading the invoices fixes both without knowing about either: a reversal or
/// a refund unwinds its allocations and `recomputeInvoices` re-opens the
/// invoice, and a rent invoice raised after the plan started is not in the
/// covered set at all.
///
/// Clamped at both ends. Below zero because outstanding CAN exceed the frozen
/// total — a payment that had part-settled one of these invoices before the
/// plan was agreed can bounce afterwards — and a negative progress figure
/// would read as a credit in `installmentViews`. Above `totalCents` it cannot
/// go, since outstanding never falls below zero.
export async function planProgressCents(totalCents: number, invoiceIds: string[]): Promise<number> {
  const byPlan = await planProgressByPlan([{ id: 'one', totalCents, invoiceIds }])
  return byPlan.get('one')?.progressCents ?? 0
}

/// The same figure for many plans in one query (B-195).
///
/// A portfolio report reads every plan at every facility, and `planProgressCents`
/// per plan is one round trip each. The arithmetic lives here, once, and the
/// single-plan helper above calls this rather than keeping a second copy —
/// §4.11's "no screen, tile, or export computes any of these inline" is only
/// true while there is one implementation to point at.
export async function planProgressByPlan(
  plans: readonly { id: string; totalCents: number; invoiceIds: string[] }[],
): Promise<Map<string, PlanProgress>> {
  const allInvoiceIds = [...new Set(plans.flatMap((plan) => plan.invoiceIds))]
  const invoices =
    allInvoiceIds.length === 0
      ? []
      : await prisma.invoice.findMany({
          where: { id: { in: allInvoiceIds } },
          select: { id: true, status: true, totalCents: true, amountPaidCents: true },
        })
  // Voided invoices come back too now, flagged rather than filtered out: they
  // are the whole difference between the two figures below, and the query that
  // excluded them could not tell "paid" from "forgiven" at all.
  const byInvoice = new Map(
    invoices.map((invoice) => [
      invoice.id,
      {
        voided: invoice.status === 'void',
        outstandingCents: Math.max(0, invoice.totalCents - invoice.amountPaidCents),
      },
    ]),
  )

  return new Map(
    plans.map((plan) => {
      if (plan.invoiceIds.length === 0) {
        return [plan.id, { progressCents: 0, collectedCents: 0, waivedCents: 0 }]
      }
      // Two outstanding sums off the same rows. `outstandingAll` keeps a
      // voided invoice's unpaid remainder in, so the money that came in is
      // what is left when it is subtracted from the frozen total.
      let outstandingAll = 0
      let outstandingLive = 0
      for (const invoiceId of plan.invoiceIds) {
        const invoice = byInvoice.get(invoiceId)
        if (!invoice) continue
        outstandingAll += invoice.outstandingCents
        if (!invoice.voided) outstandingLive += invoice.outstandingCents
      }
      const progressCents = Math.max(0, plan.totalCents - outstandingLive)
      const collectedCents = Math.max(0, plan.totalCents - outstandingAll)
      // The remainder by construction, never a third subtraction — so the two
      // always add back up to the progress the schedule is measured against,
      // including where a bounce has clamped `collectedCents` at zero.
      return [plan.id, { progressCents, collectedCents, waivedCents: progressCents - collectedCents }]
    }),
  )
}
