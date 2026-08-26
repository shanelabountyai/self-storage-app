import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  installmentViews,
  validateSchedule,
  type InstallmentView,
  type PlanProblem,
  type PlannedInstallment,
} from '@storage/core/payment-plans'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
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
}

export type CreatePaymentPlanResult =
  | { ok: true; planId: string }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'already_active' }
  | { ok: false; reason: 'invalid_schedule'; problems: PlanProblem[] }

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
  const problems = validateSchedule(input.installments, totalCents, now)
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
          installments: input.installments.map((installment) => ({
            dueDate: installment.dueDate.toISOString(),
            amountCents: installment.amountCents,
          })),
        },
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
    select: { id: true, status: true, holdId: true, lease: { select: { facilityId: true } } },
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

  await prisma.paymentPlan.update({
    where: { id: planId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByStaffId: actor.staffUserId,
      cancelReason: cancelReason.trim(),
    },
  })

  return { ok: true }
}

export type PaymentPlanView = {
  id: string
  status: 'active' | 'completed' | 'broken' | 'cancelled'
  totalCents: number
  note: string | null
  createdAt: Date
  installments: InstallmentView[]
}

/// The lease's current or most recent plan, with per-installment status
/// derived live against the ledger — never a stored flag (see the schema
/// comment on `PaymentPlanInstallment`).
export async function paymentPlanForLease(leaseId: string, asOf: Date = new Date()): Promise<PaymentPlanView | null> {
  const plan = await prisma.paymentPlan.findFirst({
    where: { leaseId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      totalCents: true,
      invoiceIds: true,
      note: true,
      createdAt: true,
      installments: { select: { dueDate: true, amountCents: true } },
    },
  })
  if (!plan) return null

  const paidSinceCents = await planProgressCents(plan.totalCents, plan.invoiceIds)

  return {
    id: plan.id,
    status: plan.status,
    totalCents: plan.totalCents,
    note: plan.note,
    createdAt: plan.createdAt,
    installments: installmentViews(plan.installments, paidSinceCents, asOf),
  }
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
  if (invoiceIds.length === 0) return 0
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, status: { not: 'void' } },
    select: { totalCents: true, amountPaidCents: true },
  })
  const outstandingCents = invoices.reduce(
    (sum, invoice) => sum + Math.max(0, invoice.totalCents - invoice.amountPaidCents),
    0,
  )
  return Math.max(0, totalCents - outstandingCents)
}
