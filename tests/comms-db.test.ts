import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainEvent } from '@storage/db'
import { prisma } from '../packages/db'
import { processCommsEvent, suppress } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'

// B-030 / PRD 05 FR-1, FR-16, FR-18, FR-20. The pipeline end to end against a
// real database: rules and templates as data, idempotent sends, suppression,
// staleness, the kill switch and the sandbox redirect.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let tenantEmail = ''
let leaseId = ''
let unitTypeId = ''

// A capturing provider so tests can assert exactly how many real sends happened
// and to what address — the hard idempotency and sandbox-redirect invariants.
let sends: { to: string }[] = []
function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

async function seedTemplate(input: {
  key: string
  classification?: 'transactional' | 'operational' | 'marketing'
  facilityId?: string | null
  version?: number
  bodyText: string
  requiredMergeFields?: string[]
}) {
  return prisma.messageTemplate.create({
    data: {
      key: input.key,
      channel: 'email',
      classification: input.classification ?? 'transactional',
      facilityId: input.facilityId ?? null,
      version: input.version ?? 1,
      subject: 'Hello {{tenant.first_name}}',
      bodyText: input.bodyText,
      requiredMergeFields: input.requiredMergeFields ?? [],
    },
  })
}

async function seedRule(input: {
  event: string
  templateKey: string
  classification?: 'transactional' | 'operational' | 'marketing'
  facilityId?: string | null
  skipConditions?: string[]
}) {
  return prisma.notificationRule.create({
    data: {
      event: input.event,
      templateKey: input.templateKey,
      channel: 'email',
      classification: input.classification ?? 'transactional',
      facilityId: input.facilityId ?? null,
      skipConditions: input.skipConditions ?? [],
    },
  })
}

async function moveInEvent(): Promise<DomainEvent> {
  return prisma.domainEvent.create({
    data: { name: 'test.lease_event', entityType: 'Lease', entityId: leaseId, facilityId, payload: {} },
  })
}

describeDb('comms pipeline', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: 'Comms Test',
          slug: `comms-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
          phone: '512-555-0100',
        },
      }),
      prisma.facility.create({
        data: {
          name: 'Comms Other',
          slug: `comms-other-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      }),
    ])
    facilityId = facility.id
    otherFacilityId = other.id

    const tenant = await prisma.tenant.create({
      data: { email: `comms-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    tenantEmail = tenant.email

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'B-12' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id
  })

  beforeEach(() => {
    sends = []
    vi.spyOn(provider, 'selectProvider').mockReturnValue(fakeProvider())
    delete process.env.COMMS_KILL_SWITCH
    delete process.env.COMMS_SANDBOX_INBOX
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.notificationRule.deleteMany({ where: { OR: [{ facilityId }, { templateKey: { contains: suffix } }] } })
    await prisma.messageTemplate.deleteMany({ where: { OR: [{ facilityId }, { facilityId: null }], key: { contains: suffix } } })
    await prisma.suppression.deleteMany({ where: { address: tenantEmail.toLowerCase() } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.message.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.notificationRule.deleteMany({ where: { OR: [{ facilityId }, { facilityId: otherFacilityId }] } })
    await prisma.messageTemplate.deleteMany({ where: { key: { contains: suffix } } })
    await prisma.suppression.deleteMany({ where: { address: tenantEmail.toLowerCase() } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: { in: [facilityId, otherFacilityId] } } })
    await prisma.$disconnect()
  })

  it('renders and sends a message when a rule maps the event', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}, unit {{unit.number}} is yours.', requiredMergeFields: ['tenant.first_name', 'unit.number'] })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })

    const result = await processCommsEvent(await moveInEvent())
    expect(result).toMatchObject({ sent: 1, paused: false })
    expect(sends).toHaveLength(1)

    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.status).toBe('sent')
    expect(message.bodySnapshot).toBe('Hi Ada, unit B-12 is yours.')
    expect(message.providerMessageId).toBe('test_1')
  })

  it('never sends twice for the same event — the hard invariant', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })
    const event = await moveInEvent()

    await processCommsEvent(event)
    const second = await processCommsEvent(event) // a redelivery

    expect(second.skipped).toBe(1)
    expect(sends).toHaveLength(1)
    expect(await prisma.message.count({ where: { eventId: event.id } })).toBe(1)
  })

  it('does nothing for an event no rule maps', async () => {
    const result = await processCommsEvent(await moveInEvent())
    expect(result).toMatchObject({ sent: 0, suppressed: 0, cancelled: 0, failed: 0, skipped: 0 })
    expect(sends).toHaveLength(0)
    expect(await prisma.message.count({ where: { facilityId } })).toBe(0)
  })

  it('withholds to a hard-bounced address and records why', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })
    await suppress({ channel: 'email', address: tenantEmail, reason: 'hard_bounce' })

    const result = await processCommsEvent(await moveInEvent())
    expect(result.suppressed).toBe(1)
    expect(sends).toHaveLength(0)
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.status).toBe('suppressed')
    expect(message.suppressionReason).toBe('hard_bounce')
  })

  it('still delivers transactional mail to an unsubscribed address, but not marketing', async () => {
    // CAN-SPAM's transactional carve-out: unsubscribe blocks marketing only.
    await suppress({ channel: 'email', address: tenantEmail, reason: 'unsubscribe' })
    await seedTemplate({ key: `txn_${suffix}`, classification: 'transactional', bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `txn_${suffix}`, classification: 'transactional' })

    const txn = await processCommsEvent(await moveInEvent())
    expect(txn.sent).toBe(1)

    // Now a marketing rule on the same address is withheld. Clear the
    // transactional rule/template first so only the marketing one applies.
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.notificationRule.deleteMany({ where: { templateKey: { contains: suffix } } })
    await prisma.messageTemplate.deleteMany({ where: { key: { contains: suffix } } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    sends = []
    await seedTemplate({ key: `mkt_${suffix}`, classification: 'marketing', bodyText: 'Deal {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `mkt_${suffix}`, classification: 'marketing' })
    const mkt = await processCommsEvent(await moveInEvent())
    expect(mkt.suppressed).toBe(1)
    expect(sends).toHaveLength(0)
  })

  it('sends nothing while the kill switch is on', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })
    process.env.COMMS_KILL_SWITCH = 'on'

    const result = await processCommsEvent(await moveInEvent())
    expect(result.paused).toBe(true)
    expect(sends).toHaveLength(0)
    expect(await prisma.message.count({ where: { facilityId } })).toBe(0)
  })

  it('redirects every recipient to the sandbox inbox outside production', async () => {
    process.env.COMMS_SANDBOX_INBOX = 'catch-all@sandbox.test'
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })

    await processCommsEvent(await moveInEvent())
    expect(sends[0].to).toBe('catch-all@sandbox.test')
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.toAddress).toBe('catch-all@sandbox.test')
    expect(message.toAddress).not.toBe(tenantEmail)
  })

  it('blocks a send loudly when a required merge field has no value', async () => {
    // A billing template referencing a field that does not exist yet must not
    // mail a blank — it records a failure instead (FR-9).
    await seedTemplate({ key: `bill_${suffix}`, bodyText: 'You owe {{balance.total}}', requiredMergeFields: ['balance.total'] })
    await seedRule({ event: 'test.lease_event', templateKey: `bill_${suffix}` })

    const result = await processCommsEvent(await moveInEvent())
    expect(result.failed).toBe(1)
    expect(sends).toHaveLength(0)
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.status).toBe('failed')
    expect(message.error).toContain('balance.total')
  })

  it('cancels a message whose premise has gone stale', async () => {
    // FR-18: the lease ended between the event and the send — don't welcome a
    // tenant who has already moved out.
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}`, skipConditions: ['tenant_moved_out'] })

    const result = await processCommsEvent(await moveInEvent())
    expect(result.cancelled).toBe(1)
    expect(sends).toHaveLength(0)
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.status).toBe('cancelled')

    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
  })

  it('prefers a per-facility template override over the org default', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, facilityId: null, bodyText: 'ORG {{tenant.first_name}}' })
    await seedTemplate({ key: `welcome_${suffix}`, facilityId, bodyText: 'FACILITY {{tenant.first_name}}' })
    await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}` })

    await processCommsEvent(await moveInEvent())
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.bodySnapshot).toBe('FACILITY Ada')
  })

  it('prefers a per-facility rule over the org default for the same template key', async () => {
    await seedTemplate({ key: `welcome_${suffix}`, bodyText: 'Hi {{tenant.first_name}}' })
    const orgRule = await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}`, facilityId: null })
    const facilityRule = await seedRule({ event: 'test.lease_event', templateKey: `welcome_${suffix}`, facilityId })

    const result = await processCommsEvent(await moveInEvent())
    expect(result.sent).toBe(1) // one message, not two — the override, not a duplicate
    const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
    expect(message.ruleId).toBe(facilityRule.id)
    expect(message.ruleId).not.toBe(orgRule.id)
  })
})
