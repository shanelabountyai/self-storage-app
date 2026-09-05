import { prisma } from '@storage/db'
import { monthlyRecurring, type RecurringCharge } from '@storage/core/pricing'
import { OCCUPYING_LEASE_STATUSES, TRANSFER_HOLD_SOURCE } from '@storage/core/inventory'
import { codeForLease } from '@/lib/access/provision'
import { paymentPlanForLease } from '@/lib/admin/payment-plans'
import { payableLeaseWhere } from '@/lib/billing/accounts'
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
  /// B-227. What the next invoice will actually total — rent, tax on rent, and
  /// the protection premium — from the one shared reckoning. The dashboard used
  /// to add `monthlyRateCents + protectionCents` itself and print that as "Next
  /// payment", which left the tax out and understated the figure a tenant is
  /// about to be charged.
  recurring: RecurringCharge
  balanceCents: number
  nextDueDate: Date
  autopayEnabled: boolean
  /// Autopay is on for this unit but there is no card to charge — the state
  /// that would otherwise read as "On" and quietly take nothing on the
  /// billing day. Autopay needs both halves (see Lease.autopayEnabled).
  autopayNeedsCard: boolean
  accessSuspended: boolean
  /// B-232. What this tenant owes across every occupying lease at THIS
  /// facility, and the facility's own restore threshold — the two inputs the
  /// gate rule actually uses (`gateDecision` via `tenantStates`). The banner
  /// hardcoded *"Pay your full balance of $X"*, which was one lease's balance
  /// measured against D-16's default rather than the facility's setting, and
  /// therefore wrong in both directions at once. `restoreShortfallCents` turns
  /// the pair into the number to say.
  facilityBalanceCents: number
  restoreAtOrBelowCents: number
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
  /// B-256. The business account this unit is billed to, when it is on one.
  ///
  /// Two different cards come out of it, because two different people read it.
  /// The unit's own TENANT keeps their Pay button whatever their employer
  /// usually does (B-090e: "the tenant handing over cash at the counter for
  /// their own unit must not be refused") and is simply told who else is
  /// billed, so they do not pay a bill twice by accident. The PAYER, looking at
  /// a unit they hold and also pay for through their own account, gets no
  /// second Pay button here at all — the account card below owns that money,
  /// and two buttons for one balance is how a screen shows the same debt twice
  /// under two different totals.
  billedTo: { accountName: string; youArePayer: boolean } | null
  /// B-090 part 3 / PRD 01 §9's "self-cure UX beyond banner", corrected by
  /// B-191.
  ///
  /// It used to be populated only while `status === 'active'`, and to call the
  /// first not-yet-paid installment "your next installment". Both were wrong in
  /// the same direction — towards a tenant being told less the worse things
  /// got. The card **unmounted the night the plan broke**, which is the hour
  /// the hold lifts, dunning resumes, late fees re-arm and access suspension
  /// re-arms; and a past-due uncovered installment is `missed`, not `paid`, so
  /// "your next installment" named a payment already failed on a date already
  /// gone.
  ///
  /// So: present for a `broken` plan as well as an active one, with the two
  /// facts kept apart. `completed` and `cancelled` are still null — a permanent
  /// route to the plan's history is B-193's.
  ///
  /// B-210, two further corrections in the same direction — say the true thing,
  /// not the frightening one.
  ///
  /// It is null once the lease owes nothing. `status === 'broken'` had no time
  /// bound and no balance test, so "Your payment plan has ended… the full
  /// balance above is due now" rendered forever, directly beneath a $0.00
  /// balance, for every tenant who ever broke a plan and then paid it off. The
  /// plan itself stays on `/portal/payment-plan`, which is where a record of
  /// something finished belongs.
  ///
  /// And `late` is separated from `missed`, because D-98 gives the tenant
  /// `planGraceDays` to catch an installment up and nothing outside the breach
  /// job knew it.
  paymentPlan: {
    status: 'active' | 'broken'
    /// The next installment still ahead, if any.
    next: { dueDate: Date; amountCents: number } | null
    /// The OLDEST uncovered installment whose date has passed but whose grace
    /// has NOT — the plan is still alive and there is a deadline to name.
    late: { dueDate: Date; amountCents: number; payByDate: Date } | null
    /// The OLDEST installment uncovered past its grace. Never merged with
    /// `next` or with `late`: they are different facts and one of them is an
    /// alarm.
    missed: { dueDate: Date; amountCents: number } | null
  } | null
}

export async function portalDashboardForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<PortalLeaseSummary[]> {
  const [tenant, leases] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { stripeDefaultPaymentMethodId: true } }),
    // B-256. Still `{ tenantId }` alone, and that is load-bearing rather than
    // an oversight. This function decrypts a GATE CODE, reads an access grant
    // and reads a transfer hold, all of which belong to the lease's own tenant;
    // widening it to what the viewer merely PAYS for would hand a payer a
    // credential for somebody else's unit, which PRD 03 SR-2 makes a separately
    // audited permission even for staff. A business account's units are their
    // own read model (`portalAccountsFor`), and it carries money only.
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
        billingAccount: { select: { name: true, payerTenantId: true } },
        facility: {
          select: {
            name: true,
            phone: true,
            timezone: true,
            accessRestoreAtOrBelowCents: true,
            // B-227. Rent is taxable; the figure is wrong without these.
            taxComponents: { select: { jurisdiction: true, rateBasisPoints: true } },
          },
        },
        unit: { select: { number: true, unitType: { select: { widthFt: true, lengthFt: true } } } },
      },
    }),
  ])

  // B-232. One grouped read for the facility-wide figure the gate rule uses,
  // rather than a second aggregate per lease inside the map — a tenant with two
  // units at one site needs the SUM, and the banner was showing one unit's.
  const facilityBalances = new Map<string, number>()
  if (leases.length > 0) {
    const totals = await prisma.ledgerEntry.groupBy({
      by: ['facilityId'],
      where: { leaseId: { in: leases.map((lease) => lease.id) } },
      _sum: { amountCents: true },
    })
    for (const row of totals) facilityBalances.set(row.facilityId, row._sum.amountCents ?? 0)
  }

  return Promise.all(
    leases.map(async (lease) => {
      const [balance, grant, gateCode, settling, transferHold, plan] = await Promise.all([
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
        paymentPlanForLease(lease.id, now),
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
        recurring: monthlyRecurring({
          monthlyRateCents: lease.monthlyRateCents,
          protectionCents: lease.protectionCents,
          taxRates: lease.facility.taxComponents,
        }),
        balanceCents: balance._sum.amountCents ?? 0,
        nextDueDate: nextBillingDate(lease.billingDay, now),
        autopayEnabled: lease.autopayEnabled,
        autopayNeedsCard: lease.autopayEnabled && !tenant.stripeDefaultPaymentMethodId,
        accessSuspended: grant?.state === 'suspended',
        facilityBalanceCents: facilityBalances.get(lease.facilityId) ?? 0,
        restoreAtOrBelowCents: lease.facility.accessRestoreAtOrBelowCents,
        gateCode,
        settlingCents: settling._sum.amountCents ?? 0,
        pendingMoveOutDate: lease.moveOutDate,
        billedTo: lease.billingAccount
          ? {
              accountName: lease.billingAccount.name,
              youArePayer: lease.billingAccount.payerTenantId === tenantId,
            }
          : null,
        pendingTransfer:
          transferHold?.unit && transferHold.moveInDate
            ? {
                toUnitNumber: transferHold.unit.number,
                transferDate: transferHold.moveInDate,
                expiresAt: transferHold.expiresAt,
              }
            : null,
        paymentPlan:
          plan &&
          (plan.status === 'active' || plan.status === 'broken') &&
          (balance._sum.amountCents ?? 0) > 0
            ? {
                status: plan.status,
                next: installmentFact(plan.installments, 'upcoming'),
                late: installmentFact(plan.installments, 'late'),
                missed: installmentFact(plan.installments, 'missed'),
              }
            : null,
      }
    }),
  )
}

/// The first installment in a given state, as the two figures the card states.
/// Ordered by date already (`paymentPlanForLease` sorts them), so "first" is
/// the soonest upcoming one and the oldest missed one.
function installmentFact(
  installments: readonly {
    dueDate: Date
    amountCents: number
    status: string
    graceEndsOn: Date
  }[],
  status: 'upcoming' | 'late' | 'missed',
): { dueDate: Date; amountCents: number; payByDate: Date } | null {
  const found = installments.find((installment) => installment.status === status)
  return found
    ? { dueDate: found.dueDate, amountCents: found.amountCents, payByDate: found.graceEndsOn }
    : null
}

/// B-239. What the nav's Pay link needs, and nothing else.
///
/// `portalDashboardForTenant` answers the same question, but it decrypts a gate
/// code, reads a payment plan and aggregates a settling total PER LEASE — far
/// too much work for a link that renders on every route under `/portal`. Two
/// queries: the occupying leases, and one grouped sum over their ledger.
///
/// Only leases that actually owe come back, so an empty array is "nothing to
/// pay" and the caller does not have to re-test the sign.
export async function owingLeases(
  tenantId: string,
): Promise<{ leaseId: string; balanceCents: number }[]> {
  const leases = await prisma.lease.findMany({
    // B-256. Everything this tenant may pay, which since B-090e includes the
    // units on any business account they are the payer of. Scoped to their own
    // leases, the nav offered a payer "Pay $200" for their personal 5x5 while
    // eleven company units went unmentioned, and offered a payer who holds no
    // lease of their own no Pay link at all.
    where: { ...payableLeaseWhere(tenantId), status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: { id: true },
  })
  if (leases.length === 0) return []

  const totals = await prisma.ledgerEntry.groupBy({
    by: ['leaseId'],
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    _sum: { amountCents: true },
  })
  return totals
    .map((row) => ({ leaseId: row.leaseId, balanceCents: row._sum.amountCents ?? 0 }))
    .filter((row) => row.balanceCents > 0)
}

/// B-239 / US-601. The next charge, for the move-in confirmation screen.
///
/// US-601 has always asked the confirmation to restate the autopay state, the
/// next charge date and the next charge amount, and it showed none of the
/// three — the welcome EMAIL carried them (`billing.first_charge_line`) and the
/// screen the renter is actually looking at did not, so the one fact everybody
/// wants after paying depended on an inbox.
///
/// The same three fields `portalDashboardForTenant` computes per lease, from
/// the same two shared reckonings — `monthlyRecurring` so the tax is in the
/// figure (B-227's defect), and `nextBillingDate` so the day matches the
/// anniversary the invoice will carry. Null when the lease has gone, which on
/// this path means provisioning has not landed yet.
export async function nextChargeForLease(
  leaseId: string,
  now: Date = new Date(),
): Promise<{ totalCents: number; dueDate: Date; autopayEnabled: boolean } | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      billingDay: true,
      autopayEnabled: true,
      monthlyRateCents: true,
      protectionCents: true,
      facility: { select: { taxComponents: { select: { jurisdiction: true, rateBasisPoints: true } } } },
    },
  })
  if (!lease) return null
  return {
    totalCents: monthlyRecurring({
      monthlyRateCents: lease.monthlyRateCents,
      protectionCents: lease.protectionCents,
      taxRates: lease.facility.taxComponents,
    }).totalCents,
    dueDate: nextBillingDate(lease.billingDay, now),
    autopayEnabled: lease.autopayEnabled,
  }
}
