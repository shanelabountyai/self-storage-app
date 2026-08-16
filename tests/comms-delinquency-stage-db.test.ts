import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { requestOverlock, confirmOverlockApplied, releaseOverlock, confirmOverlockRemoved } from '../apps/web/lib/delinquency/overlock'
import { generateNotice } from '../apps/web/lib/notices/service'
import { saveNoticeTemplate, exampleNoticeTemplate } from '../apps/web/lib/admin/notice-templates'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-063 / PRD 05 CN-11, CN-12, against real rows and the real seeded catalog.
//
// The properties worth a database: the overlock stage notices actually fire
// from the real B-058 functions (which had never emitted an event before this
// item), the pre-lien/lien split routes to exactly one template per notice,
// and FR-18 staleness genuinely skips a send whose premise is already gone.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''

const sends: { to: string; subject: string; body: string }[] = []

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '' })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['delinquency:execute_step', 'tenants:view', 'facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function processLatestEvent(name: string): Promise<void> {
  const event = await prisma.domainEvent.findFirstOrThrow({
    where: { name, facilityId },
    orderBy: { occurredAt: 'desc' },
  })
  await processCommsEvent(event)
}

describeDb('delinquency-stage courtesy notices', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Stage Notices ${suffix}`,
        slug: `stage-${suffix}`,
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
      data: { email: `stage-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `stage-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    await prisma.tenantAddress.create({
      data: {
        tenantId,
        addressLine1: '400 Elm Street',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        source: 'counter',
      },
    })

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `S-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id

    for (const type of ['pre_lien', 'lien'] as const) {
      const example = exampleNoticeTemplate(type)
      await saveNoticeTemplate(actor(), facilityId, { type, ...example })
    }
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.tenantAddress.deleteMany({ where: { tenantId } })
    await prisma.$disconnect()
  })

  describe('overlock stage notices — CN-11', () => {
    it('emits overlock.required the moment staff confirm the lock is fitted, not on the request', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      expect(await prisma.domainEvent.count({ where: { name: 'overlock.required', facilityId } })).toBe(0)

      await confirmOverlockApplied(actor(), requested!.overlockId)
      expect(await prisma.domainEvent.count({ where: { name: 'overlock.required', facilityId } })).toBe(1)
    })

    it('sends the lock-added email with the amount and a working pay link', async () => {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 25_800,
          description: 'Two months past due',
          occurredAt: new Date('2026-07-01T00:00:00Z'),
        },
      })
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await processLatestEvent('overlock.required')

      expect(sends).toHaveLength(1)
      expect(sends[0].to).toBe(`stage-${suffix}@example.com`)
      expect(sends[0].subject).toContain('lock')
      expect(sends[0].body).toContain('$258.00')
      expect(sends[0].body).toMatch(/pay\/|portal\/pay/)
    })

    it('sends the lock-removed email once staff confirm it came off', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await releaseOverlock({ leaseId, facilityId })
      await confirmOverlockRemoved(actor(), leaseId)
      await processLatestEvent('overlock.cleared')

      expect(sends).toHaveLength(1)
      expect(sends[0].subject.toLowerCase()).toContain('removed')
    })

    it('skips a stale send — the lock came off before dispatch caught up', async () => {
      // FR-18: the tenant paid and staff already removed the lock between the
      // event and the send. "We've added a lock" would be false by then.
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await releaseOverlock({ leaseId, facilityId })
      await confirmOverlockRemoved(actor(), leaseId)

      // The ORIGINAL overlock.required event is processed only now, after the
      // lock has already come off.
      await processLatestEvent('overlock.cleared')
      sends.length = 0
      await processLatestEvent('overlock.required')

      expect(sends).toHaveLength(0)
    })

    it('sends nothing for a tenant who has already moved out', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      await processLatestEvent('overlock.required')
      expect(sends).toHaveLength(0)
    })
  })

  describe('pre-lien/lien courtesy supplements — CN-12', () => {
    it('sends the pre-lien supplement, quoting the notice’s own snapshot', async () => {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 38_700,
          description: 'Three months past due',
          occurredAt: new Date('2026-06-01T00:00:00Z'),
        },
      })
      const result = await generateNotice(actor(), leaseId, 'pre_lien', { deadlineDays: 14 })
      expect(result.ok).toBe(true)
      await processLatestEvent('notice.generated')

      expect(sends).toHaveLength(1)
      expect(sends[0].subject.toLowerCase()).toContain('formal notice')
      expect(sends[0].body.toLowerCase()).toContain('courtesy')
      expect(sends[0].body.toLowerCase()).toContain('not the formal notice')
      expect(sends[0].body).toContain('$387.00')
    })

    it('sends exactly the LIEN supplement for a lien notice, never the pre-lien one', async () => {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 38_700,
          description: 'Past due',
          occurredAt: new Date('2026-06-01T00:00:00Z'),
        },
      })
      await generateNotice(actor(), leaseId, 'lien', { deadlineDays: 10 })
      await processLatestEvent('notice.generated')

      expect(sends).toHaveLength(1)
      expect(sends[0].subject.toLowerCase()).toContain('lien')
      expect(sends[0].body.toLowerCase()).toContain('sold')
    })

    it('sends the correction’s own supplement, with the corrected figures', async () => {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 12_900,
          description: 'One month',
          occurredAt: new Date('2026-06-01T00:00:00Z'),
        },
      })
      const first = await generateNotice(actor(), leaseId, 'pre_lien', { deadlineDays: 14 })
      await processLatestEvent('notice.generated')
      sends.length = 0

      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 12_900,
          description: 'A second late fee found after the fact',
          occurredAt: new Date('2026-07-01T00:00:00Z'),
        },
      })
      await generateNotice(actor(), leaseId, 'pre_lien', {
        deadlineDays: 14,
        correctsNoticeId: (first as { noticeId: string }).noticeId,
      })
      await processLatestEvent('notice.generated')

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('$258.00')
    })
  })
})
