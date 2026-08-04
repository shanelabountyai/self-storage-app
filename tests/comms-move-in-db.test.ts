import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainEvent } from '@storage/db'
import { prisma } from '../packages/db'
import { processCommsEvent, sendDirectEmail, suppress } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { ensureGrant, issueCredential, transitionGrant } from '../apps/web/lib/access/service'

// B-031 / PRD 05 CN-7, FR-2. The real, seeded org-default content (comms-catalog
// / seed.mts) exercised end to end: the move-in welcome and the reservation
// reminder, against the actual recipient resolvers and context extenders they
// depend on. Complements comms-db.test.ts, which covers the pipeline's own
// generic machinery against synthetic events and templates.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let tenantEmail = ''
let leaseId = ''
let unitId = ''

let sends: { to: string; text: string }[] = []
function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, text: email.text })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

describeDb('comms: real seeded content', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Move-in Comms Test',
        slug: `comms-movein-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `comms-movein-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    tenantEmail = tenant.email

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'B-12' } })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id
    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'charge', amountCents: 15_000, description: 'Move-in charges' },
    })
  })

  beforeEach(() => {
    sends = []
    vi.spyOn(provider, 'selectProvider').mockReturnValue(fakeProvider())
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
    delete process.env.ACCESS_CODE_ENCRYPTION_KEY
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function moveInEvent(): Promise<DomainEvent> {
    return prisma.domainEvent.create({
      data: { name: 'lease.moved_in', entityType: 'Lease', entityId: leaseId, facilityId, payload: {} },
    })
  }

  it('welcomes a moved-in tenant with a real gate code and the first charge, via the seeded template', async () => {
    process.env.ACCESS_CODE_ENCRYPTION_KEY = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await transitionGrant(grant.grantId, 'active', 'system:move_in')
    const issued = await issueCredential(grant.grantId, leaseId)

    const result = await processCommsEvent(await moveInEvent())
    expect(result).toMatchObject({ sent: 1 })

    const message = await prisma.message.findFirstOrThrow({
      where: { facilityId, templateKey: 'lease_moved_in_welcome' },
    })
    expect(message.status).toBe('sent')
    expect(message.bodySnapshot).toContain(`Your gate code is ${issued.code}.`)
    expect(message.bodySnapshot).toContain('You were charged $150.00 today')
    expect(message.bodySnapshot).toContain('unit is B-12')
  })

  it('falls back to the honest "texted within 15 minutes" line with no credential issued', async () => {
    const result = await processCommsEvent(await moveInEvent())
    expect(result).toMatchObject({ sent: 1 })

    const message = await prisma.message.findFirstOrThrow({
      where: { facilityId, templateKey: 'lease_moved_in_welcome' },
    })
    expect(message.bodySnapshot).toContain('Your gate code will be texted to you within 15 minutes.')
  })

  it('skips the welcome for a lease that already ended by the time the event is processed', async () => {
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

    const result = await processCommsEvent(await moveInEvent())
    expect(result).toMatchObject({ cancelled: 1, sent: 0 })
    expect(sends).toHaveLength(0)
  })

  describe('the reservation reminder', () => {
    let reservationId = ''

    afterEach(async () => {
      if (reservationId) await prisma.reservation.deleteMany({ where: { id: reservationId } })
    })

    it('reminds a real reservation through the seeded template', async () => {
      const expiresAt = new Date(Date.now() + 12 * 60 * 60_000)
      const reservation = await prisma.reservation.create({
        data: {
          facilityId,
          unitTypeId: (await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })).unitTypeId,
          status: 'held',
          firstName: 'Beau',
          lastName: 'Prospect',
          email: `reminder-${suffix}@example.com`,
          quotedRateCents: 11_900,
          expiresAt,
          tokenHash: `movein-reminder-${suffix}`,
        },
      })
      reservationId = reservation.id

      const event = await prisma.domainEvent.create({
        data: { name: 'reservation.expiring_soon', entityType: 'Reservation', entityId: reservation.id, facilityId, payload: {} },
      })
      const result = await processCommsEvent(event)
      expect(result).toMatchObject({ sent: 1 })

      const message = await prisma.message.findFirstOrThrow({
        where: { facilityId, templateKey: 'reservation_expiring_soon' },
      })
      expect(message.toAddress).toBe(`reminder-${suffix}@example.com`)
      expect(message.bodySnapshot).toContain('Move-in Comms Test')
      expect(message.bodySnapshot).toContain('10x10')
      expect(message.bodySnapshot).toContain('512-555-0100')
    })
  })
})

describeDb('sendDirectEmail (B-031)', () => {
  const address = `direct-${suffix}@example.com`

  beforeEach(() => {
    sends = []
    vi.spyOn(provider, 'selectProvider').mockReturnValue(fakeProvider())
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { toAddress: address } })
    await prisma.suppression.deleteMany({ where: { address } })
  })

  it('sends once per idempotency key regardless of how many times it is called', async () => {
    const key = `direct-test:${randomUUID()}`
    const input = {
      idempotencyKey: key,
      eventId: 'x',
      templateKey: 'direct_test',
      classification: 'transactional' as const,
      to: address,
      fromName: 'Test',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
    }

    const first = await sendDirectEmail(input)
    const second = await sendDirectEmail(input)

    expect(first).toEqual({ sent: true })
    expect(second).toEqual({ sent: true })
    expect(sends).toHaveLength(1)
    expect(await prisma.message.count({ where: { idempotencyKey: key } })).toBe(1)
  })

  it('withholds from a suppressed address without calling the provider', async () => {
    await suppress({ channel: 'email', address, reason: 'hard_bounce' })

    const result = await sendDirectEmail({
      idempotencyKey: `direct-suppressed:${randomUUID()}`,
      eventId: 'x',
      templateKey: 'direct_test',
      classification: 'transactional',
      to: address,
      fromName: 'Test',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
    })

    expect(result).toEqual({ sent: false, suppressed: 'hard_bounce' })
    expect(sends).toHaveLength(0)
  })
})
