import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { paymentPlansForLease, type PaymentPlanView } from '@/lib/admin/payment-plans'

// PRD 01 §9 (B-090 part 3). "Delinquency self-cure UX beyond banner (payment
// plans)" — the full schedule, tenant-facing, read-only. Nothing here can be
// changed from the portal: the plan is a commitment staff and the tenant
// agreed to, the same reason `lib/portal/move-out.ts` only ever reads what
// `lib/admin/move-out.ts` already decided.

export type PortalPaymentPlan = PaymentPlanView & {
  leaseId: string
  facilityName: string
  unitNumber: string
}

/// B-193. Every plan the tenant has ever had on a current lease, newest first
/// within each lease — not just the live one. This was `paymentPlanForLease`,
/// so a tenant on their third plan could see one schedule and had no record of
/// what they paid under the other two. The tenant-facing half of B-190's chain.
export async function paymentPlansForTenant(tenantId: string): Promise<PortalPaymentPlan[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
    },
  })

  const plans = await Promise.all(
    leases.map(async (lease) =>
      (await paymentPlansForLease(lease.id)).map((plan) => ({
        ...plan,
        leaseId: lease.id,
        facilityName: lease.facility.name,
        unitNumber: lease.unit.number,
      })),
    ),
  )

  return plans.flat()
}

/// B-193 / SC 2.4.5 (AA). Whether the portal nav carries a Payment plan entry.
/// The dashboard card renders only while a plan is ACTIVE, so before this the
/// page had exactly one way in and it vanished the night the plan broke — the
/// hour the tenant most needs to read what they agreed to.
export async function hasAnyPaymentPlan(tenantId: string): Promise<boolean> {
  const count = await prisma.paymentPlan.count({
    where: { lease: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } } },
  })
  return count > 0
}
