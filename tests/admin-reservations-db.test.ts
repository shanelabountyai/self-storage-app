import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  cancelReservationByStaff,
  countArrivingToday,
  listHeldReservations,
  startMoveInFromReservation,
} from '../apps/web/lib/admin/reservations'
import { TRANSFER_HOLD_SOURCE } from '../packages/core/inventory'
import { ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-434 / PRD 02 US-14 "AC (the counter can see who is coming)".

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const DAY_MS = 24 * 60 * 60 * 1000
const HELD_RATE = 12_000

let facilityId = ''
let unitTypeId = ''
let staffId = ''

function actorAs(roleKey: string, atFacilityId = facilityId): Actor {
  const role = ROLES.find((r) => r.key === roleKey)!
  const assignment: Assignment = {
    facilityId: atFacilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set<PermissionKey>(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
  return { kind: 'staff', staffUserId: staffId, assignments: [assignment] }
}

/// A held reservation on its own reserved unit, written straight to the table.
/// `moveInDays` 0 is "now", which is inside today's local day at any hour.
async function hold(lastName: string, moveInDays: number, source = 'web') {
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `R-${randomUUID().slice(0, 6)}`, status: 'reserved' },
  })
  return prisma.reservation.create({
    data: {
      facilityId,
      unitTypeId,
      unitId: unit.id,
      firstName: 'Ada',
      lastName,
      email: `${lastName.toLowerCase()}-${suffix}@example.com`,
      phone: '512-555-0142',
      quotedRateCents: HELD_RATE,
      moveInDate: new Date(Date.now() + moveInDays * DAY_MS),
      expiresAt: new Date(Date.now() + 10 * DAY_MS),
      tokenHash: randomUUID(),
      source,
    },
  })
}

describeDb('staff reservations (B-434)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Reservations Test',
        slug: `admin-reservations-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
    const staff = await prisma.staffUser.create({
      data: { email: `reservations-${suffix}@example.com`, firstName: 'Casey', lastName: 'Counter' },
    })
    staffId = staff.id
  })

  afterAll(async () => {
    // The facility and the staff row stay: the audit row RESTRICTs both (B-185).
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it("lists held reservations with today's arrival first, and leaves a transfer's hold out", async () => {
    // Created in the wrong order on purpose.
    const later = await hold('Later', 3)
    const today = await hold('Today', 0)
    await hold('Transfer', 0, TRANSFER_HOLD_SOURCE)

    const rows = await listHeldReservations(actorAs('counter'), facilityId)
    expect(rows.map((row) => row.id)).toEqual([today.id, later.id])
    expect(rows[0]).toMatchObject({
      name: 'Ada Today',
      phone: '512-555-0142',
      quotedRateCents: HELD_RATE,
      source: 'web',
      arrivingToday: true,
    })
    expect(rows[1].arrivingToday).toBe(false)
    expect(await countArrivingToday(facilityId, 'America/Chicago')).toBe(1)

    // The walk-in search: every word must match a name, the phone or the email.
    expect((await listHeldReservations(actorAs('counter'), facilityId, 'ada later')).map((r) => r.id)).toEqual([
      later.id,
    ])
    expect(await listHeldReservations(actorAs('counter'), facilityId, 'nobody')).toEqual([])
  })

  it('refuses a reader with no assignment at the facility', async () => {
    await expect(listHeldReservations(actorAs('counter', 'another-facility'), facilityId)).rejects.toThrow(
      ForbiddenError,
    )
  })

  it("starts a counter checkout on the reservation's own unit at its held rate", async () => {
    const reservation = await hold('Mover', 0)
    const started = await startMoveInFromReservation(actorAs('counter'), reservation.id)
    if (!started.ok) throw new Error(`refused: ${started.reason}`)

    const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: started.sessionId } })
    // The held rate, not today's street (14,900) or web (12,900) rate.
    expect(session.quotedRateCents).toBe(HELD_RATE)
    expect(session.reservationId).toBe(reservation.id)
    expect(session.unitId).toBe(reservation.unitId)
    expect(session.data).toMatchObject({ acquisitionSource: 'walk_in' })

    await expect(startMoveInFromReservation(actorAs('bookkeeper'), reservation.id)).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('cancels a hold once: the unit goes back on sale and one audit row is written', async () => {
    const reservation = await hold('Canceller', 1)
    await expect(cancelReservationByStaff(actorAs('bookkeeper'), reservation.id)).rejects.toThrow(ForbiddenError)

    expect(await cancelReservationByStaff(actorAs('counter'), reservation.id)).toEqual({ ok: true })
    expect(await cancelReservationByStaff(actorAs('counter'), reservation.id)).toEqual({
      ok: false,
      reason: 'not_held',
    })

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
    expect(after.status).toBe('cancelled')
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: reservation.unitId! } })
    expect(unit.status).toBe('available')

    const audit = await prisma.auditLog.findMany({
      where: { action: 'reservation.cancelled', entityId: reservation.id },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorStaffId: staffId, facilityId, entityType: 'Reservation' })
  })
})
