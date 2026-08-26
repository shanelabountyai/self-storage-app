import { prisma } from '@storage/db'
import { isBreached, isFullyPaid } from '@storage/core/payment-plans'
import { systemLiftHold } from '@/lib/admin/holds'
import { createTask } from '@/lib/admin/tasks'
import { paidSincePlanStart } from '@/lib/admin/payment-plans'
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
      createdAt: true,
      installments: { select: { dueDate: true, amountCents: true } },
    },
  })
  if (plans.length === 0) return

  for (const plan of plans) {
    const paidSinceCents = await paidSincePlanStart(plan.leaseId, plan.createdAt)

    if (isBreached(plan.installments, paidSinceCents, businessDate)) {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: 'broken', brokenAt: businessDate },
      })
      await systemLiftHold(plan.holdId, 'delinquency:payment-plan-breach', 'payment_plan_broken')
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
      recordItem({ itemId: plan.leaseId, ok: true, message: 'payment plan completed' })
    }
  }
}
