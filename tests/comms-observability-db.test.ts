import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { Consumer } from '../packages/core/events'
import { staleDeliveryCount } from '../packages/core/events'
import { alertOwner } from '../apps/web/lib/comms/alerts'
import {
  detectConsumerLag,
  detectDailyFailureRate,
  detectSilentDunning,
} from '../apps/web/lib/comms/detectors'
import { commsDashboard } from '../apps/web/lib/admin/comms-dashboard'
import * as provider from '../apps/web/lib/comms/provider'

// B-075 / PRD 05 CN-19, FR-19, against real rows and the real seeded roles.
//
// The properties worth a database: the dashboard's rates agree with what the
// rows actually say, each detector alerts on exactly the condition FR-19
// names and stays quiet otherwise, and an alert already sent today does not
// send twice — the whole point of keying on `sendDirectEmail`'s own
// idempotency rather than a second dedup mechanism.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `obs-${suffix}`

let facilityId = ''
let ownerEmail = ''

const emailSends: { to: string; subject: string }[] = []

function fakeEmailProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      emailSends.push({ to: email.to, subject: email.subject ?? '' })
      return { ok: true, providerMessageId: `test_${emailSends.length}` }
    },
  }
}

async function createMessages(
  rows: { templateKey: string; channel: 'email' | 'sms'; status: string; createdAt: Date }[],
) {
  await prisma.message.createMany({
    data: rows.map((row) => ({
      idempotencyKey: `obs-${suffix}-${randomUUID()}`,
      eventId: `evt-${randomUUID()}`,
      ruleId: 'rule-1',
      templateKey: row.templateKey,
      templateVersion: 1,
      classification: 'transactional' as const,
      channel: row.channel,
      facilityId,
      toAddress: 'tenant@example.com',
      bodySnapshot: 'body',
      status: row.status as never,
      createdAt: row.createdAt,
    })),
  })
}

describeDb('comms observability (FR-19/CN-19)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeEmailProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Observability ${suffix}`,
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } })
    ownerEmail = `owner-${suffix}@example.com`
    const owner = await prisma.staffUser.create({
      data: { email: ownerEmail, firstName: 'Own', lastName: 'Er' },
    })
    await prisma.staffFacilityAssignment.create({
      data: { staffUserId: owner.id, roleId: ownerRole.id, facilityId: null },
    })
  })

  afterEach(async () => {
    emailSends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.eventDelivery.deleteMany({ where: { event: { facilityId } } })
    await prisma.task.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.eventDelivery.deleteMany({ where: { event: { facilityId } } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.staffFacilityAssignment.deleteMany({ where: { staffUser: { email: ownerEmail } } })
    await prisma.staffUser.deleteMany({ where: { email: ownerEmail } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  describe('alertOwner', () => {
    it('emails the owner and records the send', async () => {
      const result = await alertOwner(`test:${randomUUID()}`, 'Subject line', 'Body text')
      expect(result.sent).toBe(true)
      expect(emailSends).toHaveLength(1)
      expect(emailSends[0].to).toBe(ownerEmail)
    })

    it('never sends the same alert twice — the idempotency key is the whole dedup', async () => {
      const key = `test:${randomUUID()}`
      await alertOwner(key, 'Subject', 'Body')
      const second = await alertOwner(key, 'Subject', 'Body')
      expect(second.sent).toBe(true) // "already sent" still reports true
      expect(emailSends).toHaveLength(1) // but only one email actually went
    })
  })

  describe('the dashboard (CN-19)', () => {
    it('computes delivery, bounce and SMS-failure rates from real rows', async () => {
      const from = new Date('2026-07-01T00:00:00Z')
      const to = new Date('2026-07-02T00:00:00Z')
      await createMessages([
        { templateKey: 'invoice_due_soon', channel: 'email', status: 'sent', createdAt: new Date('2026-07-01T12:00:00Z') },
        { templateKey: 'invoice_due_soon', channel: 'email', status: 'bounced', createdAt: new Date('2026-07-01T13:00:00Z') },
        { templateKey: 'access_suspended', channel: 'sms', status: 'sent', createdAt: new Date('2026-07-01T14:00:00Z') },
        { templateKey: 'access_suspended', channel: 'sms', status: 'failed', createdAt: new Date('2026-07-01T15:00:00Z') },
        // Outside the range — must not be counted.
        { templateKey: 'invoice_due_soon', channel: 'email', status: 'sent', createdAt: new Date('2026-06-30T12:00:00Z') },
      ])

      const owner = { kind: 'staff' as const, staffUserId: 'x', assignments: [
        { facilityId, roleKey: 'owner', rank: 100, permissions: new Set(['reports:operational'] as never), limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null } },
      ] }
      const report = await commsDashboard(owner, { from, to })

      expect(report.overall.counts).toMatchObject({ sent: 2, bounced: 1, failed: 1 })
      expect(report.overall.deliveryRate).toBeCloseTo(0.5)

      const emailRow = report.templates.find((t) => t.templateKey === 'invoice_due_soon' && t.channel === 'email')
      expect(emailRow?.bounceRate).toBeCloseTo(0.5)

      const smsRow = report.templates.find((t) => t.templateKey === 'access_suspended' && t.channel === 'sms')
      expect(smsRow?.smsFailureRate).toBeCloseTo(0.5)

      expect(report.daily).toHaveLength(1)
      expect(report.daily[0].day).toBe('2026-07-01')
    })

    it('counts open no_reachable_channel tasks as the failure queue', async () => {
      await prisma.task.create({
        data: {
          facilityId,
          type: 'no_reachable_channel',
          entityType: 'Tenant',
          entityId: `tenant-${suffix}`,
          businessDate: new Date('2026-07-01T00:00:00Z'),
          priority: 'high',
        },
      })
      const owner = { kind: 'staff' as const, staffUserId: 'x', assignments: [
        { facilityId, roleKey: 'owner', rank: 100, permissions: new Set(['reports:operational'] as never), limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null } },
      ] }
      const report = await commsDashboard(owner, {
        from: new Date('2026-01-01'),
        to: new Date('2027-01-01'),
      })
      expect(report.failureQueueCount).toBe(1)
    })
  })

  describe('detectDailyFailureRate', () => {
    const businessDate = new Date('2026-07-05T00:00:00Z')

    it('alerts when the day\'s failure rate exceeds 2%', async () => {
      await createMessages([
        { templateKey: 'invoice_due_soon', channel: 'email', status: 'sent', createdAt: new Date('2026-07-05T10:00:00Z') },
        { templateKey: 'invoice_due_soon', channel: 'email', status: 'bounced', createdAt: new Date('2026-07-05T11:00:00Z') },
      ])
      const result = await detectDailyFailureRate(facilityId, businessDate)
      expect(result.alerted).toBe(true)
      expect(emailSends).toHaveLength(1)
    })

    it('stays quiet within the threshold', async () => {
      // 1 of 51 (≈1.96%) — under the 2% line.
      await createMessages(
        Array.from({ length: 51 }, (_, i) => ({
          templateKey: 'invoice_due_soon',
          channel: 'email' as const,
          status: i === 0 ? 'bounced' : 'sent',
          createdAt: new Date('2026-07-05T10:00:00Z'),
        })),
      )
      const result = await detectDailyFailureRate(facilityId, businessDate)
      expect(result.alerted).toBe(false)
      expect(emailSends).toEqual([])
    })

    it('stays quiet with nothing sent that day', async () => {
      const result = await detectDailyFailureRate(facilityId, businessDate)
      expect(result.checked).toBe(true)
      expect(result.alerted).toBe(false)
    })
  })

  describe('detectSilentDunning', () => {
    const businessDate = new Date('2026-07-06T00:00:00Z')

    it('alerts when leases were eligible and nothing emitted', async () => {
      const result = await detectSilentDunning(facilityId, businessDate, { emitted: 0, halted: 0, eligible: 3 })
      expect(result.alerted).toBe(true)
      expect(emailSends).toHaveLength(1)
    })

    it('stays quiet when something emitted', async () => {
      const result = await detectSilentDunning(facilityId, businessDate, { emitted: 2, halted: 0, eligible: 3 })
      expect(result.alerted).toBe(false)
    })

    it('stays quiet when nothing was eligible — a quiet day, not a silent failure', async () => {
      const result = await detectSilentDunning(facilityId, businessDate, { emitted: 0, halted: 0, eligible: 0 })
      expect(result.alerted).toBe(false)
    })
  })

  describe('detectConsumerLag', () => {
    it('alerts when a consumer has events older than 15 minutes still unsettled', async () => {
      const event = await prisma.domainEvent.create({
        data: {
          name: 'lease.moved_in',
          entityType: 'Lease',
          entityId: `lease-${suffix}`,
          facilityId,
          payload: {},
          occurredAt: new Date(Date.now() - 30 * 60_000),
        },
      })
      const consumer: Consumer = { name: `lag-consumer-${suffix}`, events: ['lease.moved_in'], handle: async () => {} }

      const stale = await staleDeliveryCount(consumer, 15 * 60_000)
      expect(stale).toBeGreaterThanOrEqual(1)

      const [result] = await detectConsumerLag([consumer])
      expect(result.alerted).toBe(true)
      await prisma.domainEvent.delete({ where: { id: event.id } })
    })

    it('stays quiet for a consumer with nothing stale', async () => {
      const consumer: Consumer = { name: `quiet-consumer-${suffix}`, events: ['lease.moved_in'], handle: async () => {} }
      const [result] = await detectConsumerLag([consumer])
      expect(result.alerted).toBe(false)
      expect(result.stale).toBe(0)
    })

    it('does not count an event a delivery already settled', async () => {
      const event = await prisma.domainEvent.create({
        data: {
          name: 'lease.moved_in',
          entityType: 'Lease',
          entityId: `lease-settled-${suffix}`,
          facilityId,
          payload: {},
          occurredAt: new Date(Date.now() - 30 * 60_000),
        },
      })
      const consumerName = `settled-consumer-${suffix}`
      await prisma.eventDelivery.create({
        data: { eventId: event.id, consumer: consumerName, status: 'succeeded', attempts: 1, completedAt: new Date() },
      })
      const consumer: Consumer = { name: consumerName, events: ['lease.moved_in'], handle: async () => {} }
      const stale = await staleDeliveryCount(consumer, 15 * 60_000)
      expect(stale).toBe(0)
    })
  })
})
