import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES, TRANSFER_HOLD_SOURCE } from '@storage/core/inventory'
import { codeForLease } from '@/lib/access/provision'
import { SITE } from '@/lib/site-config'

// PRD 01 §4.7 US-702 / §6.5. "What do I owe, when is it due, what's my gate
// code" — read-only, from the same sources the rest of the app already
// trusts: LedgerEntry for balance (reconcile.ts's own comment calls it "the
// tenant-facing source of truth"), AccessGrant.state for suspension, and
// Lease's own frozen `monthlyRateCents`/`billingDay` rather than a fresh rate
// lookup (a rate change must never reprice an existing lease).
//
// No delinquency engine and no invoicing engine exist yet (B-057, B-044) — a
// dependency the backlog row itself calls out as acceptable to leave open
// rather than pull forward. Everything below is built only from signals that
// are already real: a positive ledger balance, and whatever AccessGrant.state
// already holds (nothing but a human or a future B-098 job sets it to
// `suspended` today, and this file doesn't care which one did).

/// Pure so the boundary-day math is unit-testable without a database. Dates
/// are date-only in intent (no time-of-day meaning), same as `moveInDate`
/// elsewhere in the checkout path.
export function nextBillingDate(billingDay: number, from: Date): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const thisMonth = new Date(Date.UTC(year, month, billingDay))
  return from.getUTCDate() <= billingDay ? thisMonth : new Date(Date.UTC(year, month + 1, billingDay))
}

export type PortalLeaseSummary = {
  leaseId: string
  facilityName: string
  facilityPhone: string
  facilityTimezone: string
  unitNumber: string
  widthFt: number
  lengthFt: number
  monthlyRateCents: number
  protectionCents: number
  balanceCents: number
  nextDueDate: Date
  autopayEnabled: boolean
  /// Autopay is on for this unit but there is no card to charge — the state
  /// that would otherwise read as "On" and quietly take nothing on the
  /// billing day. Autopay needs both halves (see Lease.autopayEnabled).
  autopayNeedsCard: boolean
  accessSuspended: boolean
  gateCode: string | null
  /// B-103. A bank payment taken but not yet settled, in cents.
  ///
  /// Shown BESIDE the balance rather than subtracted from it. The money has not
  /// arrived, so netting it off would make the portal disagree with the ledger
  /// and with every staff screen — but a tenant who paid on the 1st and still
  /// sees the full balance on the 3rd rings the office, which is the support
  /// call this whole state exists to prevent.
  settlingCents: number
  /// B-142 / PRD 01 §4.7 US-709, US-702. A pending move-out or transfer used
  /// to be invisible here — two taps deep behind the "Manage" disclosure —
  /// when "did that go through" is the question a tenant returns to answer.
  /// `status` is still `active` either way; `moveOutDate` already on the row
  /// distinguishes "pending" from "finalized" (`lib/portal/move-out.ts`'s own
  /// comment makes the same point).
  pendingMoveOutDate: Date | null
  pendingTransfer: { toUnitNumber: string; transferDate: Date; expiresAt: Date } | null
}

export async function portalDashboardForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<PortalLeaseSummary[]> {
  const [tenant, leases] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { stripeDefaultPaymentMethodId: true } }),
    prisma.lease.findMany({
      where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        facilityId: true,
        billingDay: true,
        autopayEnabled: true,
        monthlyRateCents: true,
        protectionCents: true,
        moveOutDate: true,
        facility: { select: { name: true, phone: true, timezone: true } },
        unit: { select: { number: true, unitType: { select: { widthFt: true, lengthFt: true } } } },
      },
    }),
  ])

  return Promise.all(
    leases.map(async (lease) => {
      const [balance, grant, gateCode, settling, transferHold] = await Promise.all([
        prisma.ledgerEntry.aggregate({ where: { leaseId: lease.id }, _sum: { amountCents: true } }),
        prisma.accessGrant.findUnique({
          where: { facilityId_tenantId: { facilityId: lease.facilityId, tenantId } },
          select: { state: true },
        }),
        codeForLease(lease.id),
        // Scoped to the tenant at this facility, matching how the suppression
        // in `leasesWithSettlingPayment` decides who not to chase — so the
        // portal never says "we won't charge you a late fee" about a payment
        // the late-fee job would not in fact have spared.
        prisma.payment.aggregate({
          where: { tenantId, facilityId: lease.facilityId, status: 'processing' },
          _sum: { amountCents: true },
        }),
        // B-142. Same hold `lib/portal/transfer.ts` reads — one per tenant per
        // facility, so this is the fact "did my transfer request go through".
        prisma.reservation.findFirst({
          where: {
            tenantId,
            facilityId: lease.facilityId,
            source: TRANSFER_HOLD_SOURCE,
            status: 'held',
            expiresAt: { gt: now },
          },
          select: { moveInDate: true, expiresAt: true, unit: { select: { number: true } } },
        }),
      ])

      return {
        leaseId: lease.id,
        facilityName: lease.facility.name,
        facilityPhone: lease.facility.phone ?? SITE.phone.display,
        facilityTimezone: lease.facility.timezone,
        unitNumber: lease.unit.number,
        widthFt: lease.unit.unitType.widthFt,
        lengthFt: lease.unit.unitType.lengthFt,
        monthlyRateCents: lease.monthlyRateCents,
        protectionCents: lease.protectionCents,
        balanceCents: balance._sum.amountCents ?? 0,
        nextDueDate: nextBillingDate(lease.billingDay, now),
        autopayEnabled: lease.autopayEnabled,
        autopayNeedsCard: lease.autopayEnabled && !tenant.stripeDefaultPaymentMethodId,
        accessSuspended: grant?.state === 'suspended',
        gateCode,
        settlingCents: settling._sum.amountCents ?? 0,
        pendingMoveOutDate: lease.moveOutDate,
        pendingTransfer:
          transferHold?.unit && transferHold.moveInDate
            ? {
                toUnitNumber: transferHold.unit.number,
                transferDate: transferHold.moveInDate,
                expiresAt: transferHold.expiresAt,
              }
            : null,
      }
    }),
  )
}
