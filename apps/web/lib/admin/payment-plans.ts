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

  const totalCents = input.installments.reduce((sum, installment) => sum + installment.amountCents, 0)
  const now = new Date()
  const problems = validateSchedule(input.installments, totalCents, now)
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
      note: true,
      createdAt: true,
      installments: { select: { dueDate: true, amountCents: true } },
    },
  })
  if (!plan) return null

  const paidSinceCents = await paidSincePlanStart(leaseId, plan.createdAt)

  return {
    id: plan.id,
    status: plan.status,
    totalCents: plan.totalCents,
    note: plan.note,
    createdAt: plan.createdAt,
    installments: installmentViews(plan.installments, paidSinceCents, asOf),
  }
}

/// Total paid against the lease since a plan started. Reads `LedgerEntry`
/// directly rather than `Payment`, matching how the delinquency engine and
/// the portal dashboard both read balance — one source of "what has this
/// lease paid," not a second definition living in this file.
export async function paidSincePlanStart(leaseId: string, since: Date): Promise<number> {
  const paid = await prisma.ledgerEntry.aggregate({
    where: { leaseId, type: 'payment', occurredAt: { gte: since } },
    _sum: { amountCents: true },
  })
  // Payments are negative in the signed ledger (they decrease the balance).
  return -(paid._sum.amountCents ?? 0)
}
