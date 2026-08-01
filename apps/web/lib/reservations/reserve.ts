import { createHash, randomBytes } from 'node:crypto'
import { Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { recomputeUnitStatus } from '@/lib/admin/units'

// PRD 01 §4.4 US-401 / FR-3. A free, no-card hold on a unit.
//
// D-7 settled that reservations take no payment and no account: the renter
// gives a name, an email, a phone and a move-in date, and we hold a real unit
// at a locked rate until it expires.

/// US-401: "max N days out — default 14, configurable per admin settings."
/// There is no per-facility setting yet, so the default is the value and the
/// place to change it later is here.
// ponytail: constant, not a facility setting, until an operator asks for a
// different window at one site.
export const MAX_MOVE_IN_DAYS_AHEAD = 14

/// The UTC offset a zone is at for a given instant, in milliseconds. Derived by
/// rendering the same instant twice and differencing, which is the only way to
/// get it out of Intl without shipping a timezone database.
function offsetMsAt(instant: Date, timeZone: string): number {
  const asZone = new Date(instant.toLocaleString('en-US', { timeZone }))
  const asUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }))
  return asUtc.getTime() - asZone.getTime()
}

/// US-401: holds expire "end of day after scheduled move-in date". A renter who
/// says they are moving in on the 8th keeps the unit through the 9th.
///
/// "End of day" means end of day where the unit physically is (CLAUDE.md: UTC
/// in the database, facility-local for anything a human reasons about), so this
/// resolves the facility-local calendar date first and only then converts back
/// to an instant. The offset is re-read at the *target* instant rather than at
/// the move-in date, so a hold spanning a DST change still lands on local
/// midnight rather than an hour either side of it.
export function holdExpiryFor(moveInDate: Date, timezone: string): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(moveInDate)
    .split('-')
    .map(Number)

  // Date.UTC normalises the roll-over, so "the 31st + 1" is the 1st of the next
  // month without any calendar arithmetic here.
  const guess = Date.UTC(year, month - 1, day + 1, 23, 59, 59, 999)
  return new Date(guess + offsetMsAt(new Date(guess), timezone))
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/// Only the hash is stored, so a database leak does not hand over working
/// cancel links — same rule as the auth tokens in B-003. The raw token exists
/// once, in the email we send.
export function hashReservationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type ReserveInput = {
  facilityId: string
  unitTypeId: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  moveInDate: Date
  quotedRateCents: number
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null }
}

export type ReserveResult =
  | {
      ok: true
      reservationId: string
      /// Null when an existing hold was updated rather than created. The
      /// renter's original link still works, and minting a replacement would
      /// invalidate the email they may be looking at right now.
      token: string | null
      expiresAt: Date
      unitId: string
      updated: boolean
    }
  /// Nothing of that type is available. Distinct from an error: the renter did
  /// nothing wrong and the page has to offer them something else.
  | { ok: false; reason: 'sold_out' }
  | { ok: false; reason: 'move_in_too_far_out'; maxDays: number }

/// Claims one available unit of a type, inside the caller's transaction.
///
/// `FOR UPDATE SKIP LOCKED` is the whole concurrency story. Two requests racing
/// for the last two units lock different rows and both succeed; two racing for
/// the *last* unit see one winner and one `sold_out`, with no retry loop and no
/// advisory lock. Without SKIP LOCKED the loser would block until the winner
/// committed and then claim a unit that was no longer available.
///
/// Ordered by id purely so the choice is deterministic in tests; which physical
/// unit a renter gets is not meaningful before move-in (US-201: listings never
/// name a unit number).
async function claimUnit(
  tx: Prisma.TransactionClient,
  facilityId: string,
  unitTypeId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "unit"
    WHERE "facilityId" = ${facilityId}
      AND "unitTypeId" = ${unitTypeId}
      AND "status" = 'available'
    ORDER BY "id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

export async function createReservation(input: ReserveInput): Promise<ReserveResult> {
  const maxMoveIn = new Date()
  maxMoveIn.setDate(maxMoveIn.getDate() + MAX_MOVE_IN_DAYS_AHEAD)
  maxMoveIn.setHours(23, 59, 59, 999)
  if (input.moveInDate.getTime() > maxMoveIn.getTime()) {
    return { ok: false, reason: 'move_in_too_far_out', maxDays: MAX_MOVE_IN_DAYS_AHEAD }
  }

  const email = input.email.trim().toLowerCase()
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { timezone: true },
  })
  const expiresAt = holdExpiryFor(input.moveInDate, facility.timezone)
  const token = newToken()

  const result = await prisma.$transaction(async (tx) => {
    // US-401's duplicate guard: the same person asking for the same thing again
    // is one person changing their mind about a date, not two reservations.
    // Updating in place keeps their existing link working and avoids holding a
    // second unit they were never going to take.
    const existing = await tx.reservation.findFirst({
      where: {
        email,
        facilityId: input.facilityId,
        unitTypeId: input.unitTypeId,
        status: 'held',
        expiresAt: { gt: new Date() },
      },
    })

    if (existing) {
      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? existing.phone,
          moveInDate: input.moveInDate,
          expiresAt,
          quotedRateCents: input.quotedRateCents,
        },
      })
      return {
        ok: true as const,
        reservationId: updated.id,
        // Deliberately NOT a fresh token: the renter may already be looking at
        // the first email, and invalidating that link to hand them an identical
        // one is a worse experience than reusing it.
        token: null,
        expiresAt,
        unitId: updated.unitId!,
        updated: true,
      }
    }

    const unitId = await claimUnit(tx, input.facilityId, input.unitTypeId)
    if (!unitId) return { ok: false as const, reason: 'sold_out' as const }

    const reservation = await tx.reservation.create({
      data: {
        facilityId: input.facilityId,
        unitTypeId: input.unitTypeId,
        unitId,
        status: 'held',
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone ?? null,
        quotedRateCents: input.quotedRateCents,
        moveInDate: input.moveInDate,
        expiresAt,
        tokenHash: hashReservationToken(token),
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
      },
    })

    // The availability "decrement" (FR-3.1) is this: the unit's derived status
    // becomes `reserved`, which is exactly what publicInventoryForFacility
    // counts. There is no separate counter to drift out of step with reality.
    await recomputeUnitStatus(unitId, tx)

    await emitEvent(
      {
        name: 'reservation.created',
        facilityId: input.facilityId,
        entityType: 'Reservation',
        entityId: reservation.id,
        payload: { unitTypeId: input.unitTypeId, unitId, expiresAt: expiresAt.toISOString() },
      },
      tx,
    )

    return {
      ok: true as const,
      reservationId: reservation.id,
      token,
      expiresAt,
      unitId,
      updated: false,
    }
  })

  return result
}

export type ReservationView = {
  id: string
  status: string
  firstName: string
  lastName: string
  email: string
  moveInDate: Date | null
  expiresAt: Date
  quotedRateCents: number
  facility: { name: string; slug: string; city: string; state: string; phone: string | null; timezone: string }
  unitType: { name: string; widthFt: number; lengthFt: number }
}

/// Looks a reservation up by its raw token. Returns null for an unknown token
/// and for one whose reservation is no longer live — the caller renders the
/// same "this link is no longer good" page either way, so a guesser learns
/// nothing from the difference.
export async function reservationByToken(token: string): Promise<ReservationView | null> {
  if (!token) return null
  const reservation = await prisma.reservation.findUnique({
    where: { tokenHash: hashReservationToken(token) },
    include: {
      facility: { select: { name: true, slug: true, city: true, state: true, phone: true, timezone: true } },
      unitType: { select: { name: true, widthFt: true, lengthFt: true } },
    },
  })
  if (!reservation) return null
  return reservation as unknown as ReservationView
}

export type CancelResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_held' }

/// Cancels a hold and returns the unit to inventory.
///
/// Deliberately takes an explicit action rather than happening on link click:
/// the cancel link in an email is a GET, and 3.3.4 requires a confirmation step
/// before an irreversible action. A mail client prefetching the link must not
/// release someone's unit.
export async function cancelReservation(token: string): Promise<CancelResult> {
  const tokenHash = hashReservationToken(token)

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { tokenHash } })
    if (!reservation) return { ok: false as const, reason: 'not_found' as const }
    // Idempotent from the renter's point of view — clicking cancel twice is not
    // an error worth showing them — but the caller can tell the difference.
    if (reservation.status !== 'held') return { ok: false as const, reason: 'not_held' as const }

    await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'cancelled' } })
    if (reservation.unitId) await recomputeUnitStatus(reservation.unitId, tx)

    await emitEvent(
      {
        name: 'reservation.cancelled',
        facilityId: reservation.facilityId,
        entityType: 'Reservation',
        entityId: reservation.id,
        payload: { unitId: reservation.unitId, cancelledBy: 'renter' },
      },
      tx,
    )
    return { ok: true as const }
  })
}

/// Expires every hold whose time is up and returns its unit to inventory.
/// Run by the scheduled job; safe to run repeatedly, since it only ever acts on
/// rows that are still `held` and already past `expiresAt`.
export async function expireReservations(
  now: Date = new Date(),
  facilityId?: string,
): Promise<{ expired: number }> {
  const due = await prisma.reservation.findMany({
    where: { status: 'held', expiresAt: { lte: now }, ...(facilityId ? { facilityId } : {}) },
    select: { id: true, unitId: true, facilityId: true },
  })

  let expired = 0
  for (const reservation of due) {
    // One transaction per reservation rather than one for the batch: a single
    // bad row must not roll back everyone else's expiry, and the job runner
    // records per-item outcomes (B-006).
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.reservation.findUnique({
        where: { id: reservation.id },
        select: { status: true },
      })
      // Someone may have completed or cancelled it between the read and here.
      if (fresh?.status !== 'held') return

      await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'expired' } })
      if (reservation.unitId) await recomputeUnitStatus(reservation.unitId, tx)
      await emitEvent(
        {
          name: 'reservation.expired',
          facilityId: reservation.facilityId,
          entityType: 'Reservation',
          entityId: reservation.id,
          payload: { unitId: reservation.unitId },
        },
        tx,
      )
      expired += 1
    })
  }

  return { expired }
}
