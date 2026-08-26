import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { paymentPlanForLease, type PaymentPlanView } from '@/lib/admin/payment-plans'

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
    leases.map(async (lease) => {
      const plan = await paymentPlanForLease(lease.id)
      return plan
        ? { ...plan, leaseId: lease.id, facilityName: lease.facility.name, unitNumber: lease.unit.number }
        : null
    }),
  )

  return plans.filter((plan): plan is PortalPaymentPlan => plan !== null)
}
