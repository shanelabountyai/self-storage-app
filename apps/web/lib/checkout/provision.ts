import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { billingDayFor } from '@storage/core/billing'
import { businessDateFor } from '@storage/core/jobs'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { provisionAccessForLease } from '@/lib/access/provision'
import { createTask } from '@/lib/admin/tasks'
import { amountDueToday } from './payment'
import { sessionById } from './session'

// PRD 01 FR-4.5 / FR-4.6. Turning a paid checkout into a moved-in tenant.
//
// ── The rule that shapes everything here ─────────────────────────────────────
//
// FR-4.6: "if payment succeeds but any downstream step fails permanently, the
// tenant is still moved in from the customer's point of view; failures create
// admin tasks, never customer-facing dead ends."
//
// So this splits in two. The part that MUST be atomic with the payment — the
// lease, the unit, the ledger — happens in one transaction and either all
// commits or none does. Everything after it (gate code, emails) is best-effort
// and cannot un-move-in someone who has paid. A renter standing at the gate
// with a receipt is moved in whether or not our hardware queue is healthy.

export type ProvisionResult =
  | { ok: true; leaseId: string; alreadyProvisioned: boolean }
  | { ok: false; reason: 'session_not_found' | 'no_tenant' | 'no_unit' }

/// Provisions a move-in for a paid checkout session.
///
/// Idempotent by the session's own state: a webhook redelivery, a retry, or a
/// renter refreshing the confirmation page must not create a second lease.
export async function provisionMoveIn(sessionId: string): Promise<ProvisionResult> {
  const session = await sessionById(sessionId)
  if (!session) return { ok: false, reason: 'session_not_found' }

  const row = await prisma.checkoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { tenantId: true, unitId: true, reservationId: true },
  })
  if (!row.tenantId) return { ok: false, reason: 'no_tenant' }
  if (!row.unitId) return { ok: false, reason: 'no_unit' }

  const existing = await prisma.lease.findFirst({
    where: { unitId: row.unitId, tenantId: row.tenantId, status: { not: 'ended' } },
    select: { id: true },
  })
  if (existing) return { ok: true, leaseId: existing.id, alreadyProvisioned: true }

  const due = await amountDueToday(session)
  const data = session.data as Record<string, unknown>
  const premiumCents = typeof data.protectionPremiumCents === 'number' ? data.protectionPremiumCents : 0
  const protectionTier = typeof data.protection === 'string' ? data.protection : 'waiver'
  // §4.6/D-11a: autopay is default-on at checkout step 5 with the disclosure
  // beside it, so anything other than an explicit opt-out enrols. Read here
  // because until B-036 this choice was written to the checkout session and
  // then dropped on the floor — the renter's own decision never reached the
  // lease, and nothing downstream could act on it either way.
  const autopayEnabled = data.autopay !== false

  // B-044. The billing day comes from the facility's policy, not a constant.
  // Under `anniversary` (the default, D-27) it is the move-in day, which is
  // what makes the full month charged at checkout buy a whole period starting
  // today — with a hardcoded 1 the tenant paid for a month from the 20th and
  // the nightly run would have invoiced them again on the 1st.
  //
  // The day comes from the FACILITY-LOCAL calendar date, not the UTC one. At
  // 10pm in Texas the UTC date is already tomorrow, so a `new Date()` read
  // would give that renter an anniversary one day after the day they actually
  // moved in — and every invoice for the life of the lease would carry it.
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session.facilityId },
    select: { billingPolicy: true, timezone: true },
  })
  const startDate = new Date()
  const localToday = businessDateFor(startDate, facility.timezone)

  const leaseId = await prisma.$transaction(async (tx) => {
    const lease = await tx.lease.create({
      data: {
        facilityId: session.facilityId,
        tenantId: row.tenantId!,
        unitId: row.unitId!,
        // `active` rather than `pending`: the money is in and the renter can
        // open the gate. A pending lease here would leave the unit reading as
        // occupied while nothing bills it.
        status: 'active',
        startDate,
        monthlyRateCents: session.quotedRateCents,
        billingDay: billingDayFor(facility.billingPolicy, localToday),
        autopayEnabled,
        protectionPlanName: protectionTier === 'waiver' ? null : protectionTier,
        protectionCents: premiumCents,
        protectionWaivedAt: protectionTier === 'waiver' ? new Date() : null,
      },
    })

    // US-11's clock, started at the only moment it can be. See the model's own
    // comment: a lease created without this row is a tenant permanently
    // ineligible for a rules-based rate increase, and it cannot be backfilled.
    await tx.leaseRateChange.create({
      data: {
        leaseId: lease.id,
        previousRateCents: null,
        newRateCents: session.quotedRateCents,
        effectiveFrom: lease.startDate,
        reason: 'move_in',
      },
    })

    // The waiver, if there was one, now belongs to the lease rather than to a
    // checkout session that is about to be completed.
    await tx.protectionWaiver.updateMany({
      where: { checkoutSessionId: session.id },
      data: { leaseId: lease.id, tenantId: row.tenantId },
    })

    // The signed lease document moves with it, so the evidence chain points at
    // the lease and not at a transient session id.
    await tx.document.updateMany({
      where: { subjectType: 'CheckoutSession', subjectId: session.id, type: 'lease' },
      data: { subjectType: 'Lease', subjectId: lease.id },
    })

    await openingLedger(tx, {
      facilityId: session.facilityId,
      leaseId: lease.id,
      dueTodayCents: due.totalDueTodayCents,
    })

    // A reservation that led here converted rather than expiring — the
    // difference the conversion report is built on.
    if (row.reservationId) {
      await tx.reservation.updateMany({
        where: { id: row.reservationId, status: 'held' },
        data: { status: 'converted' },
      })
    }

    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { step: 'provisioned', status: 'completed' },
    })

    // Derived, not set: the lease is what makes the unit occupied (B-010).
    await recomputeUnitStatus(row.unitId!, tx)

    await emitEvent(
      {
        name: 'lease.moved_in',
        facilityId: session.facilityId,
        entityType: 'Lease',
        entityId: lease.id,
        payload: {
          unitId: row.unitId,
          tenantId: row.tenantId,
          monthlyRateCents: session.quotedRateCents,
          fromReservation: Boolean(row.reservationId),
        },
      },
      tx,
    )

    return lease.id
  })

  return { ok: true, leaseId, alreadyProvisioned: false }
}

/// The opening ledger: what was owed today, and the payment that cleared it.
///
/// Both entries, not just the payment. A ledger that records only the money
/// received cannot answer "what was this for", and the charge is what a
/// statement and a dispute both read.
async function openingLedger(
  tx: Prisma.TransactionClient,
  input: { facilityId: string; leaseId: string; dueTodayCents: number },
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      facilityId: input.facilityId,
      leaseId: input.leaseId,
      type: 'charge',
      // Signed: a charge increases what is owed.
      amountCents: input.dueTodayCents,
      description: 'Move-in charges',
    },
  })
}

/// FR-4.5's downstream work: the gate code, the emails.
///
/// Deliberately separate from `provisionMoveIn` and deliberately unable to fail
/// it. Called directly rather than only through the `lease.moved_in` consumer
/// (registry.ts) that `provisionMoveIn` also queues: `dispatchEvents` only
/// runs off the cron tick (api/cron/route.ts), and US-501 wants the code
/// issued immediately, not on the next scheduled pass. `provisionAccessForLease`
/// is idempotent by the credential it would create, so that consumer
/// redelivering this is a safety net, not a second code.
///
/// FR-4.6, in these words: "failures create admin tasks, never customer-facing
/// dead ends." A failure here is recorded (B-095) so a human sees it now
/// rather than only when Stripe's own webhook retries eventually exhaust —
/// then re-thrown, so the at-least-once redelivery this project already
/// relies on everywhere else still gets its own chance to self-heal. Both are
/// idempotent, so whichever resolves it first is fine; a task left open after
/// a redelivery quietly fixed things is a spurious "go check" a human closes
/// in one click, which costs far less than a failure no one saw for three days.
export async function requestDownstream(leaseId: string): Promise<void> {
  try {
    await provisionAccessForLease(leaseId)
  } catch (error) {
    const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { facilityId: true } })
    if (lease) {
      await createTask({
        facilityId: lease.facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: leaseId,
      })
    }
    throw error
  }
}

/// The lease a now-provisioned session became. The confirmation page's own
/// lookup — provisioning itself never needs this, since the transaction above
/// already has `lease.id` in hand.
export async function leaseIdForSession(sessionId: string): Promise<string | null> {
  const row = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: { tenantId: true, unitId: true },
  })
  if (!row?.tenantId || !row.unitId) return null

  const lease = await prisma.lease.findFirst({
    where: { unitId: row.unitId, tenantId: row.tenantId, status: { not: 'ended' } },
    select: { id: true },
  })
  return lease?.id ?? null
}
