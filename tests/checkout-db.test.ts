import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  advance,
  canEnter,
  expireCheckoutSessions,
  extendLock,
  hashSessionToken,
  LOCK_MINUTES,
  nextStep,
  relock,
  sessionByToken,
  startCheckout,
  STEPS,
} from '../apps/web/lib/checkout/session'
import { createReservation } from '../apps/web/lib/reservations/reserve'
import { publicInventoryForFacility } from '../apps/web/lib/inventory/public-inventory'

// B-020 / PRD 01 FR-4.1.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const slug = `checkout-${suffix}`

let facilityId = ''
let unitTypeId = ''

describe('step machine', () => {
  it('runs the order FR-4.1 specifies', () => {
    expect(STEPS).toEqual([
      'details',
      'unit_assign',
      'insurance',
      'lease',
      'payment',
      'provisioned',
    ])
  })

  it('lets a renter go back but never skip forward', () => {
    // The server's step is the truth; a stepper whose position lives in the
    // browser is a stepper a renter can skip.
    expect(canEnter('lease', 'details')).toBe(true)
    expect(canEnter('lease', 'lease')).toBe(true)
    expect(canEnter('details', 'payment')).toBe(false)
  })

  it('stops at the end rather than running off it', () => {
    expect(nextStep('payment')).toBe('provisioned')
    expect(nextStep('provisioned')).toBe('provisioned')
  })
})

describeDb('checkout session', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Checkout Test',
        slug,
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
  })

  beforeEach(async () => {
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    for (const number of ['A-1', 'A-2']) {
      await prisma.unit.create({ data: { facilityId, unitTypeId, number, status: 'available' } })
    }
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  const start = () => startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })

  it('takes a unit off the market for the length of the lock', async () => {
    const before = await publicInventoryForFacility(slug)
    expect(before?.unitTypes[0].availableCount).toBe(2)

    const result = await start()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    // The lock is what makes the unit unavailable — same derived status a
    // reservation produces, so the public read needs no special case.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: result.unitId } })
    expect(unit.status).toBe('reserved')

    const after = await publicInventoryForFacility(slug)
    expect(after?.unitTypes[0].availableCount).toBe(1)

    const minutes = (result.lockExpiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(LOCK_MINUTES - 1)
    expect(minutes).toBeLessThanOrEqual(LOCK_MINUTES)
  })

  it('never gives two simultaneous checkouts the same unit', async () => {
    const [first, second] = await Promise.all([start(), start()])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(first.unitId).not.toBe(second.unitId)
  })

  it('lets exactly one of two racing checkouts take the last unit', async () => {
    await prisma.unit.deleteMany({ where: { facilityId, number: 'A-2' } })
    const results = await Promise.all([start(), start()])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
  })

  it('reuses the unit a reservation already holds instead of taking a second', async () => {
    const moveIn = new Date()
    moveIn.setDate(moveIn.getDate() + 1)
    const reservation = await createReservation({
      facilityId,
      unitTypeId,
      firstName: 'Ada',
      lastName: 'Prospect',
      email: `conv-${suffix}@example.com`,
      moveInDate: moveIn,
      quotedRateCents: 12_900,
    })
    if (!reservation.ok) throw new Error('unreachable')

    const result = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      reservationId: reservation.reservationId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    // They were already promised that unit; claiming another would hold two.
    expect(result.unitId).toBe(reservation.unitId)
    expect(await prisma.unit.count({ where: { facilityId, status: 'available' } })).toBe(1)
  })

  it('claims a fresh unit when the reservation has already lapsed', async () => {
    const result = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      reservationId: 'res-that-does-not-exist',
    })
    expect(result.ok).toBe(true)
  })

  it('resumes at the step the renter left', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    await advance(started.token, 'details', { email: `resume-${suffix}@example.com` })
    const resumed = await sessionByToken(started.token)

    expect(resumed?.step).toBe('unit_assign')
    // Captured at step 1 so the resume email can be sent before a Tenant exists.
    expect(resumed?.email).toBe(`resume-${suffix}@example.com`)
    expect(await sessionByToken('not-a-real-token')).toBeNull()
  })

  it('stores only the token hash', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: started.sessionId } })
    expect(row.tokenHash).toBe(hashSessionToken(started.token))
    expect(row.tokenHash).not.toBe(started.token)
  })

  it('refuses a step posted out of order', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    // A stale tab, or a forged post. The server's step wins.
    expect(await advance(started.token, 'payment', {})).toMatchObject({
      ok: false,
      reason: 'out_of_order',
    })
  })

  it('merges data across steps rather than replacing it', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    await advance(started.token, 'details', { firstName: 'Ada' })
    await advance(started.token, 'unit_assign', { protection: 'standard' })

    const session = await sessionByToken(started.token)
    expect(session?.data).toMatchObject({ firstName: 'Ada', protection: 'standard' })
  })

  it('renews the lock as the renter works', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { lockExpiresAt: new Date(Date.now() + 60_000) },
    })

    const result = await advance(started.token, 'details', {})
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // Advancing is activity, so a renter working through the steps never meets
    // the warning.
    expect(result.session.lockExpiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000)
  })

  it('refuses to advance once the lock has lapsed', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { lockExpiresAt: new Date(Date.now() - 1000) },
    })

    // The unit may already belong to someone else. Carrying on to a payment
    // step for a unit we cannot give them is the failure this exists to stop.
    expect(await advance(started.token, 'details', {})).toMatchObject({
      ok: false,
      reason: 'lock_lapsed',
    })
    expect(await extendLock(started.token)).toMatchObject({ ok: false, reason: 'lock_lapsed' })
  })

  it('extends the lock on request', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { lockExpiresAt: new Date(Date.now() + 60_000) },
    })

    const result = await extendLock(started.token)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.session.lockExpiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000)
  })

  it('offers another unit of the same type after a lock is lost', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')
    const lostUnitId = started.unitId

    await expireCheckoutSessions(new Date(Date.now() + LOCK_MINUTES * 60_000 + 1000), facilityId)
    expect(
      (await prisma.unit.findUniqueOrThrow({ where: { id: lostUnitId } })).status,
    ).toBe('available')

    const again = await relock(started.sessionId)
    expect(again.ok).toBe(true)
    if (!again.ok) throw new Error('unreachable')
    // Progress is kept; only the unit changes.
    expect(again.session.step).toBe('details')
    expect(again.session.lockLapsed).toBe(false)
  })

  it('says so honestly when the fallback has nothing left to offer', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')
    await expireCheckoutSessions(new Date(Date.now() + LOCK_MINUTES * 60_000 + 1000), facilityId)
    await prisma.unit.updateMany({ where: { facilityId }, data: { status: 'occupied' } })

    expect(await relock(started.sessionId)).toMatchObject({ ok: false, reason: 'sold_out' })
  })

  it('expires lapsed sessions idempotently and returns their units', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    expect(await expireCheckoutSessions(new Date(), facilityId)).toEqual({ expired: 0 })

    const after = new Date(Date.now() + LOCK_MINUTES * 60_000 + 1000)
    expect(await expireCheckoutSessions(after, facilityId)).toEqual({ expired: 1 })
    expect(await expireCheckoutSessions(after, facilityId)).toEqual({ expired: 0 })

    expect(
      (await prisma.unit.findUniqueOrThrow({ where: { id: started.unitId } })).status,
    ).toBe('available')
    // The session is kept — it is the record of what the renter had chosen, and
    // B-073's abandonment follow-up reads it.
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: started.sessionId } })
    expect(row.status).toBe('expired')
  })

  it('refuses to let two live sessions hold one unit even if the claim is bypassed', async () => {
    const started = await start()
    if (!started.ok) throw new Error('unreachable')

    await expect(
      prisma.checkoutSession.create({
        data: {
          facilityId,
          unitTypeId,
          unitId: started.unitId,
          quotedRateCents: 12_900,
          tokenHash: `bypass-${suffix}`,
          lockExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow()
  })
})
