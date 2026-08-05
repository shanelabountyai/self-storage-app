import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { provisionMoveIn } from '../apps/web/lib/checkout/provision'
import { startCheckout, advance } from '../apps/web/lib/checkout/session'
import { createReservation } from '../apps/web/lib/reservations/reserve'
import { publicInventoryForFacility } from '../apps/web/lib/inventory/public-inventory'

// B-026 / PRD 01 FR-4.5, FR-4.6.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `prov-${suffix}`

let facilityId = ''
let unitTypeId = ''
let tenantId = ''

describeDb('move-in provisioning', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Provision Test',
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
    await prisma.feeSchedule.create({
      data: {
        facilityId,
        feeType: 'admin',
        amountCents: 2_500,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `prov-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-1', status: 'available' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function paidSession(reservationId?: string) {
    const started = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      ...(reservationId ? { reservationId } : {}),
    })
    if (!started.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { tenantId, data: { protection: 'standard', protectionPremiumCents: 1_400 } },
    })
    return started
  }

  it('creates an active lease and makes the unit occupied', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })
    expect(lease.status).toBe('active')
    expect(lease.monthlyRateCents).toBe(12_900)
    expect(lease.protectionCents).toBe(1_400)

    // Derived, not set: the lease is what makes the unit occupied.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: started.unitId } })
    expect(unit.status).toBe('occupied')

    // And it is gone from what the public site can sell.
    const inventory = await publicInventoryForFacility(slug)
    expect(inventory?.unitTypes[0]?.availableCount ?? 0).toBe(0)
  })

  it('carries the renter’s autopay choice from checkout onto the lease', async () => {
    // B-036. This choice was written to the checkout session by step 5 and
    // then dropped: nothing read it at provisioning, so a renter's own
    // decision never reached the lease in either direction.
    const optedOut = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!optedOut.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: optedOut.sessionId },
      data: { tenantId, data: { protection: 'waiver', autopay: false } },
    })
    const off = await provisionMoveIn(optedOut.sessionId)
    if (!off.ok) throw new Error('unreachable')
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: off.leaseId } })).autopayEnabled,
    ).toBe(false)
  })

  it('enrols in autopay by default when the renter left it alone', async () => {
    // §4.6/D-11a: default-on at checkout, so anything short of an explicit
    // opt-out enrols.
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })).autopayEnabled,
    ).toBe(true)
  })

  it('starts the rate-increase clock at move-in', async () => {
    // US-11: this cannot be backfilled. A lease created without it is a tenant
    // permanently ineligible for a rules-based increase.
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const changes = await prisma.leaseRateChange.findMany({ where: { leaseId: result.leaseId } })
    expect(changes).toHaveLength(1)
    expect(changes[0].reason).toBe('move_in')
    expect(changes[0].newRateCents).toBe(12_900)
    expect(changes[0].previousRateCents).toBeNull()
  })

  it('opens the ledger with what was owed', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: result.leaseId } })
    expect(entries).toHaveLength(1)
    // A charge increases what is owed, so it is positive.
    expect(entries[0].type).toBe('charge')
    expect(entries[0].amountCents).toBeGreaterThan(0)
  })

  it('is idempotent — a redelivered webhook does not create a second lease', async () => {
    // Stripe delivers at-least-once, and a renter refreshing the confirmation
    // page is the same problem.
    const started = await paidSession()
    const first = await provisionMoveIn(started.sessionId)
    const second = await provisionMoveIn(started.sessionId)

    expect(first).toMatchObject({ ok: true, alreadyProvisioned: false })
    expect(second).toMatchObject({ ok: true, alreadyProvisioned: true })
    expect(await prisma.lease.count({ where: { facilityId } })).toBe(1)
    expect(await prisma.leaseRateChange.count({ where: { lease: { facilityId } } })).toBe(1)
  })

  it('marks a reservation converted rather than leaving it to expire', async () => {
    // The difference the reservation→move-in conversion report is built on.
    const moveIn = new Date()
    moveIn.setDate(moveIn.getDate() + 1)
    const reservation = await createReservation({
      facilityId,
      unitTypeId,
      firstName: 'Ada',
      lastName: 'Renter',
      email: `conv-${suffix}@example.com`,
      moveInDate: moveIn,
      quotedRateCents: 12_900,
    })
    if (!reservation.ok) throw new Error('unreachable')

    const started = await paidSession(reservation.reservationId)
    await provisionMoveIn(started.sessionId)

    const after = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.reservationId },
    })
    expect(after.status).toBe('converted')
  })

  it('moves the signed lease document onto the lease', async () => {
    const started = await paidSession()
    await prisma.document.create({
      data: {
        facilityId,
        type: 'lease',
        subjectType: 'CheckoutSession',
        subjectId: started.sessionId,
        title: 'Storage rental agreement',
        content: '<p>lease</p>',
        mimeType: 'text/html; charset=utf-8',
        contentHash: 'x'.repeat(64),
      },
    })

    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    // The evidence chain points at the lease, not a transient session id.
    const document = await prisma.document.findFirstOrThrow({ where: { facilityId, type: 'lease' } })
    expect(document.subjectType).toBe('Lease')
    expect(document.subjectId).toBe(result.leaseId)
  })

  it('completes the checkout session', async () => {
    const started = await paidSession()
    await provisionMoveIn(started.sessionId)
    const session = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: started.sessionId },
    })
    expect(session.status).toBe('completed')
    expect(session.step).toBe('provisioned')
  })

  it('refuses cleanly when the session never captured a tenant', async () => {
    const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!started.ok) throw new Error('unreachable')
    expect(await provisionMoveIn(started.sessionId)).toMatchObject({ ok: false, reason: 'no_tenant' })
  })

  it('emits lease.moved_in for the downstream modules', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, entityId: result.leaseId, name: 'lease.moved_in' },
    })
    expect(events).toHaveLength(1)
  })
})
