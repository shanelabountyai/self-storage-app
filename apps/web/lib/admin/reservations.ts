import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { TRANSFER_HOLD_SOURCE } from '@storage/core/inventory'
import { localDayBounds } from '@storage/core/jobs'
import { startCheckout, type StartResult } from '@/lib/checkout/session'
import { offerFor } from '@/lib/promotions/service'
import { cancelHeldReservation, type CancelResult } from '@/lib/reservations/reserve'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 02 US-14 "AC (the counter can see who is coming)" (B-434).

/// A hold a renter is coming in on. A transfer's hold is a reservation row too
/// (B-137), and it is nobody's arrival.
export function arrivalsWhere(facilityId: string): Prisma.ReservationWhereInput {
  return { facilityId, status: 'held', source: { not: TRANSFER_HOLD_SOURCE } }
}

export type HeldReservationRow = {
  id: string
  name: string
  phone: string | null
  email: string
  sizeName: string
  quotedRateCents: number
  moveInDate: Date | null
  expiresAt: Date
  source: string
  arrivingToday: boolean
}

/// Held reservations at one facility, today's arrivals first, then by move-in
/// date. `q` narrows by name, phone or email: every word must match one of
/// them, the rule `searchTenants` uses.
export async function listHeldReservations(
  actor: Actor,
  facilityId: string,
  q = '',
  now: Date = new Date(),
): Promise<HeldReservationRow[]> {
  requirePermission(actor, 'tenants:view', facilityId)
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true },
  })
  const { start, end } = localDayBounds(now, facility.timezone)

  const rows = await prisma.reservation.findMany({
    where: {
      ...arrivalsWhere(facilityId),
      AND: q
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
            { email: { contains: word, mode: 'insensitive' as const } },
            { phone: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      quotedRateCents: true,
      moveInDate: true,
      expiresAt: true,
      source: true,
      unitType: { select: { name: true } },
    },
    orderBy: [{ moveInDate: { sort: 'asc', nulls: 'last' } }, { expiresAt: 'asc' }],
  })

  return rows
    .map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      phone: row.phone,
      email: row.email,
      sizeName: row.unitType.name,
      quotedRateCents: row.quotedRateCents,
      moveInDate: row.moveInDate,
      expiresAt: row.expiresAt,
      source: row.source,
      arrivingToday: !!row.moveInDate && row.moveInDate >= start && row.moveInDate < end,
    }))
    // Stable, so the database's order holds inside each half.
    .sort((a, b) => Number(b.arrivingToday) - Number(a.arrivingToday))
}

/// The dashboard tile's count; the same rows `arrivingToday` marks above.
export async function countArrivingToday(facilityId: string, timezone: string, now: Date = new Date()) {
  const { start, end } = localDayBounds(now, timezone)
  return prisma.reservation.count({
    where: { ...arrivalsWhere(facilityId), moveInDate: { gte: start, lt: end } },
  })
}

/// Starts a checkout on the reservation's own unit at its held rate. Shared by
/// the renter's "complete move-in" link and the counter's row action.
///
/// The offer is evaluated at conversion rather than carried on the hold:
/// `Reservation` has no promotion columns, and a free hold can sit for days,
/// so the honest answer is the offer that is live when they come back to
/// finish. Server-side, never a value the browser sent.
export async function startCheckoutFromReservation(
  reservation: { id: string; facilityId: string; unitTypeId: string; quotedRateCents: number },
  acquisitionSource?: 'walk_in',
): Promise<StartResult> {
  const { offer } = await offerFor({
    facilityId: reservation.facilityId,
    unitTypeId: reservation.unitTypeId,
    monthlyRateCents: reservation.quotedRateCents,
    isNewTenant: true,
  })
  return startCheckout({
    facilityId: reservation.facilityId,
    unitTypeId: reservation.unitTypeId,
    quotedRateCents: reservation.quotedRateCents,
    reservationId: reservation.id,
    acquisitionSource,
    promo: offer
      ? {
          promotionId: offer.promotionId,
          promoCodeId: offer.promoCodeId,
          terms: offer.terms,
          firstPeriodCents: offer.firstPeriodCents,
          schedule: offer.schedule,
        }
      : null,
  })
}

/// The counter's "Start move-in" on a held reservation. `walk_in` makes it a
/// counter session (email optional, staff see a rental stop, B-415); the
/// reservation's own source still wins in `provisionMoveIn`, so a web hold
/// finished at the desk still reports as web.
export async function startMoveInFromReservation(
  actor: Actor,
  reservationId: string,
): Promise<StartResult | { ok: false; reason: 'not_held' }> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, facilityId: true, unitTypeId: true, quotedRateCents: true, status: true },
  })
  if (!reservation) return { ok: false, reason: 'not_held' }
  requirePermission(actor, 'leases:move_in', reservation.facilityId)
  if (reservation.status !== 'held') return { ok: false, reason: 'not_held' }
  return startCheckoutFromReservation(reservation, 'walk_in')
}

/// Releases a hold from the counter: the unit goes back on sale and one
/// `reservation.cancelled` audit row names who did it.
export async function cancelReservationByStaff(
  actor: Actor,
  reservationId: string,
): Promise<CancelResult> {
  const found = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { facilityId: true },
  })
  if (!found) return { ok: false, reason: 'not_found' }
  requirePermission(actor, 'leases:move_in', found.facilityId)

  return cancelHeldReservation({ id: reservationId }, 'staff', (reservation, tx) =>
    recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'reservation.cancelled',
        entityType: 'Reservation',
        entityId: reservation.id,
        facilityId: reservation.facilityId,
        before: { status: 'held' },
        after: { status: 'cancelled' },
      },
      tx,
    ).then(() => undefined),
  )
}
