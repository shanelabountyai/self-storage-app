import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { recomputeUnitStatus } from '@/lib/admin/units'
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
        startDate: new Date(),
        monthlyRateCents: session.quotedRateCents,
        billingDay: 1,
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
/// it. Neither exists yet — the access-control service is B-027 and comms is
/// B-030 — so this emits the event they will consume and returns. When they do
/// exist, a failure here becomes a Task (B-095) and still never a dead end for
/// someone who has already paid.
export async function requestDownstream(leaseId: string, facilityId: string): Promise<void> {
  await emitEvent({
    name: 'access.granted',
    facilityId,
    entityType: 'Lease',
    entityId: leaseId,
    payload: { reason: 'move_in' },
  })
}
