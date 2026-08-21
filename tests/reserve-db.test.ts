import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  cancelReservation,
  createReservation,
  expireReservations,
  hashReservationToken,
  holdExpiryFor,
  holdWindowSentence,
  reservationByToken,
  sendExpiringSoonReminders,
  MAX_MOVE_IN_DAYS_AHEAD,
} from '../apps/web/lib/reservations/reserve'
import { publicInventoryForFacility } from '../apps/web/lib/inventory/public-inventory'
import { TRANSFER_HOLD_SOURCE } from '../packages/core/inventory'

// B-018 / PRD 01 US-401, FR-3.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const slug = `reserve-${suffix}`

let facilityId = ''
let unitTypeId = ''
let unitIds: string[] = []

const tomorrow = () => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date
}

describe('holdExpiryFor', () => {
  it('runs to the end of the day AFTER the move-in date, facility-local', () => {
    // Moving in on 8 Aug in Chicago (UTC-5 in summer) keeps the unit through
    // the 9th, so the hold ends at 23:59:59.999 local = 04:59:59.999 UTC on
    // the 10th.
    const expiry = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago')
    expect(expiry.toISOString()).toBe('2026-08-10T04:59:59.999Z')
  })

  it('uses the facility zone, not the server zone', () => {
    // Same instant, two facilities: an Anchorage site's day ends later in UTC
    // than a Chicago one's.
    const instant = new Date('2026-08-08T15:00:00Z')
    const chicago = holdExpiryFor(instant, 'America/Chicago')
    const anchorage = holdExpiryFor(instant, 'America/Anchorage')
    expect(anchorage.getTime()).toBeGreaterThan(chicago.getTime())
  })

  it('rolls over a month boundary', () => {
    const expiry = holdExpiryFor(new Date('2026-08-31T15:00:00Z'), 'America/Chicago')
    expect(expiry.toISOString().slice(0, 10)).toBe('2026-09-02')
  })

  it('lands on local midnight across a DST change', () => {
    // US clocks go back on 1 Nov 2026. A hold for 31 Oct runs through 1 Nov,
    // a 25-hour local day — the offset must be read at the target instant
    // (CST, UTC-6), not at the move-in date (CDT, UTC-5).
    const expiry = holdExpiryFor(new Date('2026-10-31T15:00:00Z'), 'America/Chicago')
    expect(expiry.toISOString()).toBe('2026-11-02T05:59:59.999Z')
  })

  // ── B-126 / D-50: the grace is configurable ─────────────────────────────
  //
  // US-401 has said "configurable" since B-018 and it was a hardcoded `+ 1`.
  // Every test above passes the default implicitly, which is the property
  // that matters most here: making it configurable changed nothing for
  // anybody who does not configure it.

  it('defaults to one day of grace, matching US-401 and every existing facility', () => {
    const withDefault = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago')
    const explicitOne = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago', 1)
    expect(withDefault.toISOString()).toBe(explicitOne.toISOString())
    expect(withDefault.toISOString()).toBe('2026-08-10T04:59:59.999Z')
  })

  it('a grace of 0 expires at the end of the move-in day itself', () => {
    // A real operator choice, not a misconfiguration: the unit comes back the
    // moment somebody fails to turn up.
    const expiry = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago', 0)
    expect(expiry.toISOString()).toBe('2026-08-09T04:59:59.999Z')
  })

  it('a longer grace still rolls over a month boundary correctly', () => {
    // `Date.UTC` normalises this, so 31 Aug + 3 is 3 Sep without any calendar
    // arithmetic in the function.
    const expiry = holdExpiryFor(new Date('2026-08-31T15:00:00Z'), 'America/Chicago', 3)
    expect(expiry.toISOString().slice(0, 10)).toBe('2026-09-04')
  })

  it('clamps a negative grace rather than expiring the hold before the move-in date', () => {
    // The settings form's `min: 0` refuses this, so the clamp is the backstop
    // for anything reaching the function another way. A hold that expires
    // before the date the renter reserved it for is never a deliberate
    // configuration, and it is the exact failure D-7's booking-anchored window
    // would have produced for a 14-day-out move-in.
    const clamped = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago', -5)
    const zero = holdExpiryFor(new Date('2026-08-08T15:00:00Z'), 'America/Chicago', 0)
    expect(clamped.toISOString()).toBe(zero.toISOString())
  })
})

describe('holdWindowSentence — B-126', () => {
  // The reserve page's trust line is GENERATED from the setting now, so the
  // wording cannot go stale when an operator changes it. B-118 shipped it as
  // fixed prose precisely because there was nothing to read.
  it('says the day after, at the default', () => {
    expect(holdWindowSentence(1)).toContain('day after your move-in date')
  })

  it('says the move-in day itself at zero, not "0 days"', () => {
    expect(holdWindowSentence(0)).toContain('end of your move-in date')
    expect(holdWindowSentence(0)).not.toContain('0 days')
  })

  it('counts plainly above one', () => {
    expect(holdWindowSentence(3)).toContain('3 days after your move-in date')
  })
})

describeDb('reservation service', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Reserve Test',
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
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
  })

  beforeEach(async () => {
    // A clean pool of exactly two units before every test, so the "last unit"
    // cases are unambiguous.
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    unitIds = []
    for (const number of ['A-1', 'A-2']) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number, status: 'available' },
      })
      unitIds.push(unit.id)
    }
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  const input = (email: string) => ({
    facilityId,
    unitTypeId,
    firstName: 'Ada',
    lastName: 'Prospect',
    email,
    phone: '512-555-0199',
    moveInDate: tomorrow(),
    quotedRateCents: 12_900,
  })

  it('holds a real unit and takes it out of public availability', async () => {
    const before = await publicInventoryForFacility(slug)
    expect(before?.unitTypes[0].availableCount).toBe(2)

    const result = await createReservation(input(`a-${suffix}@example.com`))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: result.unitId } })
    expect(unit.status).toBe('reserved')

    // FR-3.1's "decrements availability" is this: the derived status changes,
    // and the public read counts it. There is no separate counter to drift.
    const after = await publicInventoryForFacility(slug)
    expect(after?.unitTypes[0].availableCount).toBe(1)
  })

  it('honours the facility’s own hold grace, not a hardcoded day (B-126)', async () => {
    // The wiring, not the arithmetic — `holdExpiryFor`'s own tests cover the
    // maths. What this proves is that `createReservation` READS the column:
    // the setting existed but was ignored, which is the exact shape of the
    // defect D-7 vs US-401 turned out to be.
    await prisma.facility.update({
      where: { id: facilityId },
      data: { reservationHoldGraceDays: 0 },
    })
    try {
      const result = await createReservation(input(`grace0-${suffix}@example.com`))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      // Grace 0 means end of the move-in day itself, facility-local.
      const expected = holdExpiryFor(input(`x@example.com`).moveInDate, 'America/Chicago', 0)
      expect(result.expiresAt.toISOString()).toBe(expected.toISOString())

      // And it is genuinely shorter than the default would have been — a test
      // that passed at both values would be proving nothing.
      const atDefault = holdExpiryFor(input(`x@example.com`).moveInDate, 'America/Chicago')
      expect(result.expiresAt.getTime()).toBeLessThan(atDefault.getTime())
    } finally {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { reservationHoldGraceDays: 1 },
      })
    }
  })

  it('never hands the same unit to two simultaneous reservations', async () => {
    // The whole reason claimUnit uses FOR UPDATE SKIP LOCKED. Two requests,
    // two units: both must succeed, and on DIFFERENT units.
    const [first, second] = await Promise.all([
      createReservation(input(`race1-${suffix}@example.com`)),
      createReservation(input(`race2-${suffix}@example.com`)),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(first.unitId).not.toBe(second.unitId)

    const held = await prisma.unit.count({ where: { facilityId, status: 'reserved' } })
    expect(held).toBe(2)
  })

  it('lets exactly one of two racing renters take the last unit', async () => {
    // Leave one unit available.
    await prisma.unit.delete({ where: { id: unitIds[1] } })

    const results = await Promise.all([
      createReservation(input(`last1-${suffix}@example.com`)),
      createReservation(input(`last2-${suffix}@example.com`)),
    ])

    const won = results.filter((r) => r.ok)
    const lost = results.filter((r) => !r.ok)
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(lost[0]).toMatchObject({ ok: false, reason: 'sold_out' })
  })

  it('reports sold out rather than throwing when nothing is available', async () => {
    await prisma.unit.updateMany({ where: { facilityId }, data: { status: 'occupied' } })
    const result = await createReservation(input(`none-${suffix}@example.com`))
    expect(result).toMatchObject({ ok: false, reason: 'sold_out' })
  })

  it('updates an existing hold instead of taking a second unit', async () => {
    const email = `dupe-${suffix}@example.com`
    const first = await createReservation(input(email))
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('unreachable')

    const laterDate = new Date()
    laterDate.setDate(laterDate.getDate() + 3)
    const second = await createReservation({ ...input(email), moveInDate: laterDate })

    expect(second).toMatchObject({ ok: true, updated: true, reservationId: first.reservationId })
    if (!second.ok) throw new Error('unreachable')
    // The original link must keep working, so no new token is minted.
    expect(second.token).toBeNull()

    // One reservation, one unit held — not two.
    expect(await prisma.reservation.count({ where: { facilityId, status: 'held' } })).toBe(1)
    expect(await prisma.unit.count({ where: { facilityId, status: 'reserved' } })).toBe(1)
  })

  it('matches the duplicate guard case-insensitively on email', async () => {
    await createReservation(input(`Mixed-${suffix}@Example.com`))
    const second = await createReservation(input(`mixed-${suffix}@example.com`))
    expect(second).toMatchObject({ ok: true, updated: true })
  })

  it('refuses a move-in date beyond the configured window', async () => {
    const tooFar = new Date()
    tooFar.setDate(tooFar.getDate() + MAX_MOVE_IN_DAYS_AHEAD + 1)
    const result = await createReservation({ ...input(`far-${suffix}@example.com`), moveInDate: tooFar })
    expect(result).toMatchObject({ ok: false, reason: 'move_in_too_far_out' })
  })

  it('stores only the token hash', async () => {
    const result = await createReservation(input(`token-${suffix}@example.com`))
    if (!result.ok || !result.token) throw new Error('unreachable')

    const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: result.reservationId } })
    expect(stored.tokenHash).not.toBe(result.token)
    expect(stored.tokenHash).toBe(hashReservationToken(result.token))

    const found = await reservationByToken(result.token)
    expect(found?.id).toBe(result.reservationId)
    expect(await reservationByToken('not-a-real-token')).toBeNull()
  })

  it('returns the unit to inventory when cancelled', async () => {
    const result = await createReservation(input(`cancel-${suffix}@example.com`))
    if (!result.ok || !result.token) throw new Error('unreachable')

    expect(await cancelReservation(result.token)).toEqual({ ok: true })

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: result.unitId } })
    expect(unit.status).toBe('available')

    // Cancelling twice is not an error worth showing a renter, but the caller
    // can tell the difference.
    expect(await cancelReservation(result.token)).toMatchObject({ ok: false, reason: 'not_held' })
  })

  it('expires a hold that is past its time and frees the unit', async () => {
    const result = await createReservation(input(`expire-${suffix}@example.com`))
    if (!result.ok) throw new Error('unreachable')

    // Nothing is due yet.
    expect(await expireReservations(new Date(), facilityId)).toEqual({ expired: 0 })

    const afterExpiry = new Date(result.expiresAt.getTime() + 1000)
    expect(await expireReservations(afterExpiry, facilityId)).toEqual({ expired: 1 })

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: result.unitId } })
    expect(unit.status).toBe('available')

    // Idempotent: a second sweep finds nothing left to do.
    expect(await expireReservations(afterExpiry, facilityId)).toEqual({ expired: 0 })
  })

  it('leaves a cancelled reservation alone when sweeping', async () => {
    const result = await createReservation(input(`swept-${suffix}@example.com`))
    if (!result.ok || !result.token) throw new Error('unreachable')
    await cancelReservation(result.token)

    const afterExpiry = new Date(result.expiresAt.getTime() + 1000)
    expect(await expireReservations(afterExpiry, facilityId)).toEqual({ expired: 0 })
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: result.reservationId } })
    expect(reservation.status).toBe('cancelled')
  })

  it('emits the events the admin follow-up workflows subscribe to (FR-3.3)', async () => {
    const result = await createReservation(input(`events-${suffix}@example.com`))
    if (!result.ok || !result.token) throw new Error('unreachable')
    await cancelReservation(result.token)

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, entityId: result.reservationId },
      select: { name: true },
    })
    expect(events.map((e) => e.name).sort()).toEqual(['reservation.cancelled', 'reservation.created'])
  })

  it('B-031: sends a confirmation email with a working link for a genuinely new hold', async () => {
    const result = await createReservation(input(`confirm-${suffix}@example.com`))
    if (!result.ok || !result.token) throw new Error('unreachable')

    const message = await prisma.message.findUniqueOrThrow({
      where: { idempotencyKey: `reservation-confirmation:${result.reservationId}` },
    })
    expect(message.status).toBe('sent')
    expect(message.toAddress).toBe(`confirm-${suffix}@example.com`)
    // The raw token — which is never persisted anywhere else — has to travel
    // from creation straight into the email body, in this one call.
    expect(message.bodySnapshot).toContain(result.token)
  })

  it('B-031: does not resend a confirmation when an existing hold is only updated', async () => {
    const email = `no-resend-${suffix}@example.com`
    const first = await createReservation(input(email))
    if (!first.ok) throw new Error('unreachable')

    const laterDate = new Date()
    laterDate.setDate(laterDate.getDate() + 3)
    const second = await createReservation({ ...input(email), moveInDate: laterDate })
    expect(second).toMatchObject({ ok: true, updated: true })

    expect(
      await prisma.message.count({ where: { templateKey: 'reservation_confirmation', toAddress: email } }),
    ).toBe(1)
  })

  it('refuses to double-hold a unit even if the claim is bypassed', async () => {
    // The database invariant behind the service. If a future code path skips
    // claimUnit, the write is rejected rather than quietly double-booking.
    const result = await createReservation(input(`invariant-${suffix}@example.com`))
    if (!result.ok) throw new Error('unreachable')

    await expect(
      prisma.reservation.create({
        data: {
          facilityId,
          unitTypeId,
          unitId: result.unitId,
          status: 'held',
          firstName: 'Second',
          lastName: 'Holder',
          email: `sneaky-${suffix}@example.com`,
          quotedRateCents: 12_900,
          expiresAt: new Date(Date.now() + 86_400_000),
          tokenHash: `sneaky-${suffix}`,
        },
      }),
    ).rejects.toThrow()
  })

  describe('sendExpiringSoonReminders (B-031 / PRD 01 US-801)', () => {
    async function heldReservation(expiresAt: Date, email: string, source?: string) {
      const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: `R-${randomUUID().slice(0, 6)}` } })
      return prisma.reservation.create({
        data: {
          facilityId,
          unitTypeId,
          unitId: unit.id,
          status: 'held',
          firstName: 'Ada',
          lastName: 'Prospect',
          email,
          quotedRateCents: 12_900,
          expiresAt,
          tokenHash: `reminder-${randomUUID()}`,
          ...(source ? { source } : {}),
        },
      })
    }

    it('reminds a hold expiring inside the window, exactly once', async () => {
      const now = new Date()
      const reservation = await heldReservation(new Date(now.getTime() + 12 * 60 * 60_000), `remind-${suffix}@example.com`)

      const first = await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)
      expect(first).toEqual({ reminded: 1 })

      const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })
      expect(stored.expiryReminderSentAt).not.toBeNull()

      const events = await prisma.domainEvent.findMany({
        where: { entityId: reservation.id, name: 'reservation.expiring_soon' },
      })
      expect(events).toHaveLength(1)

      // Re-running the sweep (the next hourly tick) must not remind again —
      // expiryReminderSentAt is the guard, not the event outbox.
      const second = await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)
      expect(second).toEqual({ reminded: 0 })
      expect(
        await prisma.domainEvent.count({ where: { entityId: reservation.id, name: 'reservation.expiring_soon' } }),
      ).toBe(1)
    })

    it('does not remind a hold that is not yet inside the window', async () => {
      const now = new Date()
      await heldReservation(new Date(now.getTime() + 3 * 24 * 60 * 60_000), `too-early-${suffix}@example.com`)

      expect(await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)).toEqual({ reminded: 0 })
    })

    it('does not remind a hold that has already expired', async () => {
      const now = new Date()
      // expiresAt must be after createdAt (a DB invariant) — so this creates a
      // hold that is valid now but expired by the time the sweep looks at it,
      // rather than an already-invalid row.
      await heldReservation(new Date(now.getTime() + 1000), `already-gone-${suffix}@example.com`)
      const later = new Date(now.getTime() + 2000)

      expect(await sendExpiringSoonReminders(later, 24 * 60 * 60_000, facilityId)).toEqual({ reminded: 0 })
    })

    it('does not remind a cancelled hold', async () => {
      const now = new Date()
      const reservation = await heldReservation(new Date(now.getTime() + 60_000), `cancelled-${suffix}@example.com`)
      await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'cancelled' } })

      expect(await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)).toEqual({ reminded: 0 })
    })

    // CN-23 / B-140. Before the fix this reservation got `reservation.expiring_soon`
    // — copy pointing at a move-in link D-82 ensures never exists for a transfer.
    it('sends a transfer hold the transfer-specific event, never the web one', async () => {
      const now = new Date()
      const reservation = await heldReservation(
        new Date(now.getTime() + 12 * 60 * 60_000),
        `transfer-${suffix}@example.com`,
        TRANSFER_HOLD_SOURCE,
      )

      expect(await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)).toEqual({ reminded: 1 })

      const events = await prisma.domainEvent.findMany({ where: { entityId: reservation.id } })
      expect(events.map((e) => e.name)).toEqual(['reservation.transfer_hold_expiring_soon'])
    })

    it('still sends a web hold only the web event', async () => {
      const now = new Date()
      const reservation = await heldReservation(new Date(now.getTime() + 12 * 60 * 60_000), `web-${suffix}@example.com`)

      expect(await sendExpiringSoonReminders(now, 24 * 60 * 60_000, facilityId)).toEqual({ reminded: 1 })

      const events = await prisma.domainEvent.findMany({ where: { entityId: reservation.id } })
      expect(events.map((e) => e.name)).toEqual(['reservation.expiring_soon'])
    })
  })
})
