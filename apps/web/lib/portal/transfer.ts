import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES, TRANSFER_HOLD_SOURCE } from '@storage/core/inventory'
import { emitEvent } from '@storage/core/events'
import {
  heldRateFor,
  previewTransferFor,
  transferHoldFor,
  TRANSFER_LEASE_SELECT,
  type TransferPreview,
  type TransferProblem,
} from '@/lib/admin/transfer'
import { createTask, cancelOpenTask } from '@/lib/admin/tasks'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { holdExpiryFor, hashReservationToken, newToken } from '@/lib/reservations/reserve'

// PRD 01 §9 / PRD 02 §4.3 US-14 (B-090 part 2). The tenant's own transfer
// request: pick a unit at the same site, see what the swap settles to, ask.
//
// ── Why this asks rather than does ──────────────────────────────────────────
//
// `completeTransfer` (B-077) closes a lease, opens another, posts two prorated
// ledger entries and issues a gate credential. None of that is the hard part.
// The hard part is that a transfer moves PHYSICAL GOODS between two units, and
// the moment the old lease closes its unit reads `available` — rentable to
// somebody else while the tenant's things are still in it. Only a person on
// site can say the old unit is empty, which is exactly the argument US-707
// already settled for move-out, so this follows it: the portal records the
// ask, and B-077's wizard, unchanged, is still the only thing that commits.
//
// ── Why the target unit is held ─────────────────────────────────────────────
//
// Move-out needs no scarce resource to still be there when staff get to it.
// A transfer does: the whole request is "unit 214, please", and a request for
// a unit that was rented to a walk-in an hour later is worse than no request,
// because the tenant has been told it is in hand. So the ask places the same
// `Reservation` hold the public site places — no new table, no new sweep, and
// the existing expiry job releases it if nobody ever acts.

export type PortalTransferLease = {
  leaseId: string
  facilityId: string
  facilityName: string
  facilityPhone: string
  unitNumber: string
  unitTypeName: string
  monthlyRateCents: number
  /// Set when this lease already has a live, uncompleted request.
  pending: { unitNumber: string; transferDate: Date; quotedRateCents: number } | null
  /// False for a lien-pipeline lease (D-85). Listed rather than hidden: a
  /// tenant with one unit would otherwise be told we see no unit on their
  /// account, which is both false and a dead end.
  transferable: boolean
}

export type PortalTransferOption = {
  unitId: string
  unitNumber: string
  unitTypeName: string
  widthFt: number
  lengthFt: number
  rateCents: number
  /// Signed: positive is more per month than they pay now, negative is less.
  monthlyDifferenceCents: number
}

/// The lease statuses a tenant may start a transfer from, which is every
/// occupying one EXCEPT the lien pipeline (B-137, D-85).
///
/// `pending_auction` means a lien notice naming a unit has been served and the
/// goods in it are being prepared for sale. Scoping this screen on
/// `OCCUPYING_LEASE_STATUSES` let the tenant move those goods into a different
/// unit, unattended, by clicking twice — self-serving out of the pipeline and
/// leaving a served notice pointing at a unit they no longer occupied.
///
/// D-85 settled the staff side the other way: staff MAY transfer a lien-pipeline
/// lease, with manager-and-above approval, a reason code and an unreset lien
/// clock. That is why the refusal lives here and not in `previewTransferFor` —
/// the admin wizard is meant to reach it, a self-service screen is not.
export const PORTAL_TRANSFERABLE_STATUSES = OCCUPYING_LEASE_STATUSES.filter(
  (status) => status !== 'pending_auction',
)

export function isPortalTransferable(status: string): boolean {
  return PORTAL_TRANSFERABLE_STATUSES.includes(status as never)
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/// The tenant's own occupying leases. Scoped to `tenantId` from the session —
/// never a parameter a request could override.
export async function tenantTransferLeases(tenantId: string): Promise<PortalTransferLease[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    orderBy: { startDate: 'asc' },
    select: {
      id: true,
      facilityId: true,
      status: true,
      monthlyRateCents: true,
      facility: { select: { name: true, phone: true } },
      unit: { select: { number: true, unitType: { select: { name: true } } } },
    },
  })
  if (leases.length === 0) return []

  // One hold per tenant per facility (see `requestTransfer`), so this resolves
  // every lease's pending request in one query rather than one per lease.
  const holds = await prisma.reservation.findMany({
    where: {
      tenantId,
      source: TRANSFER_HOLD_SOURCE,
      status: 'held',
      expiresAt: { gt: new Date() },
      facilityId: { in: leases.map((lease) => lease.facilityId) },
    },
    select: {
      facilityId: true,
      moveInDate: true,
      quotedRateCents: true,
      unit: { select: { number: true } },
    },
  })
  const holdByFacility = new Map(holds.map((hold) => [hold.facilityId, hold]))

  return leases.map((lease) => {
    const hold = holdByFacility.get(lease.facilityId)
    return {
      leaseId: lease.id,
      facilityId: lease.facilityId,
      facilityName: lease.facility.name,
      facilityPhone: lease.facility.phone ?? '',
      unitNumber: lease.unit.number,
      unitTypeName: lease.unit.unitType.name,
      monthlyRateCents: lease.monthlyRateCents,
      transferable: isPortalTransferable(lease.status),
      pending:
        hold?.unit && hold.moveInDate
          ? {
              unitNumber: hold.unit.number,
              transferDate: hold.moveInDate,
              quotedRateCents: hold.quotedRateCents,
            }
          : null,
    }
  })
}

/// What this tenant could move into: available units at the same facility,
/// with a published rate, excluding the one they are in. Offered as a list for
/// the same reason the staff screen offers one — nobody should type a unit id.
export async function transferOptionsFor(
  tenantId: string,
  leaseId: string,
): Promise<PortalTransferOption[]> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...PORTAL_TRANSFERABLE_STATUSES] } },
    select: { facilityId: true, unitId: true, monthlyRateCents: true },
  })
  if (!lease) return []

  const held = await transferHoldFor(tenantId, lease.facilityId)
  const units = await prisma.unit.findMany({
    where: {
      facilityId: lease.facilityId,
      id: { not: lease.unitId ?? undefined },
      OR: [
        { status: 'available' as const },
        ...(held?.unitId ? [{ id: held.unitId, status: 'reserved' as const }] : []),
      ],
    },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      unitTypeId: true,
      unitType: { select: { name: true, widthFt: true, lengthFt: true } },
    },
  })
  if (units.length === 0) return []

  const rates = await prisma.unitTypeRate.findMany({
    where: { facilityId: lease.facilityId, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
    select: { unitTypeId: true, streetRateCents: true },
  })
  const rateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!rateByType.has(rate.unitTypeId)) rateByType.set(rate.unitTypeId, rate.streetRateCents)
  }

  return units.flatMap((unit) => {
    // Their own held unit keeps the rate they were quoted (D-84), so the list
    // never shows a figure the settlement will not honour.
    const rateCents = heldRateFor(held, unit.id) ?? rateByType.get(unit.unitTypeId)
    // A unit type with no published rate is not offered at all rather than
    // shown with a blank price: the staff screen can fall back to a phone
    // call, a self-service screen cannot.
    if (rateCents === undefined) return []
    return [
      {
        unitId: unit.id,
        unitNumber: unit.number,
        unitTypeName: unit.unitType.name,
        widthFt: unit.unitType.widthFt,
        lengthFt: unit.unitType.lengthFt,
        rateCents,
        monthlyDifferenceCents: rateCents - lease.monthlyRateCents,
      },
    ]
  })
}

export type PortalTransferPreviewResult =
  | { ok: true; preview: TransferPreview }
  | { ok: false; problem: TransferProblem | 'not_found' }

/// What a transfer on this date would settle to, for a tenant looking at their
/// own lease. Read-only. Deliberately the admin module's own arithmetic (see
/// `previewTransferFor`) so the figure the tenant agrees to is the figure
/// staff confirm and the ledger receives.
export async function previewTenantTransfer(
  tenantId: string,
  leaseId: string,
  toUnitId: string,
  transferDate: Date,
): Promise<PortalTransferPreviewResult> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...PORTAL_TRANSFERABLE_STATUSES] } },
    select: TRANSFER_LEASE_SELECT,
  })
  if (!lease) return { ok: false, problem: 'not_found' }
  return previewTransferFor(lease, toUnitId, transferDate)
}

export type RequestTransferResult =
  | { ok: true; preview: TransferPreview }
  | {
      ok: false
      problem: TransferProblem | 'not_found' | 'date_in_past' | 'already_requested' | 'lien_pipeline'
    }

/// Records the ask and holds the unit.
///
/// The lease is not touched: the tenant keeps their unit, their access and
/// their billing exactly as they are until staff complete the transfer. What
/// changes is that the target unit is spoken for and a task exists.
export async function requestTransfer(
  tenantId: string,
  leaseId: string,
  toUnitId: string,
  transferDate: Date,
): Promise<RequestTransferResult> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: TRANSFER_LEASE_SELECT,
  })
  if (!lease) return { ok: false, problem: 'not_found' }

  // Found on the wider set on purpose, then refused by name: a lien-pipeline
  // lease that returned `not_found` would tell a tenant we cannot see a unit
  // they are standing in, and send them nowhere. This sends them to the office,
  // which is the only place D-85 allows the move to be arranged.
  if (!isPortalTransferable(lease.status)) return { ok: false, problem: 'lien_pipeline' }

  // A date before today would be asking staff to backdate money. The staff
  // screen allows it deliberately (they route around real-world timing); a
  // tenant has no reason to need it.
  if (transferDate.getTime() < startOfDayUtc(new Date()).getTime()) {
    return { ok: false, problem: 'date_in_past' }
  }

  // One live request per tenant per facility. Not a schema constraint but the
  // same judgement `reserveUnit`'s duplicate guard makes: a second ask is
  // somebody changing their mind, and honouring both would hold two units for
  // one person at a site where units are the scarce thing.
  const existing = await transferHoldFor(tenantId, lease.facilityId)
  if (existing) return { ok: false, problem: 'already_requested' }

  const previewed = await previewTenantTransfer(tenantId, leaseId, toUnitId, transferDate)
  if (!previewed.ok) return previewed
  const preview = previewed.preview

  const target = await prisma.unit.findUniqueOrThrow({
    where: { id: toUnitId },
    select: { unitTypeId: true },
  })
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: lease.facilityId },
    select: { timezone: true, reservationHoldGraceDays: true },
  })
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  })

  try {
    await prisma.$transaction(async (tx) => {
      // `tokenHash` is a required unique column because a prospect's hold is
      // reachable by a signed deep link. This one is not meant to be: the
      // token is minted, hashed and dropped on the floor, so no URL can ever
      // resolve to it and a transfer hold cannot be walked into a checkout.
      await tx.reservation.create({
        data: {
          facilityId: lease.facilityId,
          unitTypeId: target.unitTypeId,
          unitId: toUnitId,
          tenantId,
          status: 'held',
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          email: tenant.email,
          phone: tenant.phone,
          quotedRateCents: preview.newRateCents,
          moveInDate: transferDate,
          expiresAt: holdExpiryFor(transferDate, facility.timezone, facility.reservationHoldGraceDays),
          tokenHash: hashReservationToken(newToken()),
          source: TRANSFER_HOLD_SOURCE,
        },
      })
      // Derived, never set (B-010): the reservation above is what makes the
      // unit read `reserved` to everyone except the tenant it is held for.
      await recomputeUnitStatus(toUnitId, tx)

      await createTask({
        facilityId: lease.facilityId,
        type: 'transfer_request_review',
        entityType: 'Lease',
        entityId: leaseId,
        client: tx,
      })

      await emitEvent(
        {
          name: 'lease.transfer_requested',
          facilityId: lease.facilityId,
          entityType: 'Lease',
          entityId: leaseId,
          payload: {
            toUnitId,
            toUnitNumber: preview.toUnitNumber,
            fromUnitNumber: preview.fromUnitNumber,
            transferDate: transferDate.toISOString().slice(0, 10),
            newRateCents: preview.newRateCents,
            totalDueTodayCents: preview.totalDueTodayCents,
          },
        },
        tx,
      )
    })
  } catch (error) {
    // `reservation_one_held_per_unit` is a partial unique index, and it is the
    // real guarantee — the availability check above is the fast path that
    // avoids hitting it. Two tenants asking for the last unit at the same
    // instant is exactly the case it exists for, and the loser is told the
    // truth rather than shown a 500.
    if (isUniqueViolation(error)) return { ok: false, problem: 'unit_not_available' }
    throw error
  }

  return { ok: true, preview }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

export type CancelTransferResult = { ok: true } | { ok: false; reason: 'not_found' | 'nothing_to_cancel' }

/// Withdraws the ask. Releases the unit and takes the task off the queue,
/// rather than leaving staff a task about a request that no longer exists.
export async function cancelTransferRequest(
  tenantId: string,
  leaseId: string,
): Promise<CancelTransferResult> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: { facilityId: true },
  })
  if (!lease) return { ok: false, reason: 'not_found' }

  const held = await transferHoldFor(tenantId, lease.facilityId)
  if (!held) return { ok: false, reason: 'nothing_to_cancel' }

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({ where: { id: held.id }, data: { status: 'cancelled' } })
    if (held.unitId) await recomputeUnitStatus(held.unitId, tx)
    await cancelOpenTask('transfer_request_review', leaseId, tx)
  })

  return { ok: true }
}
