import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyDeliveryEvent } from '../apps/web/lib/comms/delivery'
import {
  addSuppression,
  removeSuppression,
  suppressionList,
} from '../apps/web/lib/admin/suppressions'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-054 / PRD 05 FR-14, FR-15, CN-20. The consequences of a bounce, against
// real rows — the suppression, the tenant flag and the task have to happen
// together or the tenant is quietly unreachable with nobody told.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let staffId = ''
const email = `bouncer-${suffix}@example.com`

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(['facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeMessage(providerMessageId: string) {
  return prisma.message.create({
    data: {
      idempotencyKey: `delivery-${suffix}-${providerMessageId}`,
      eventId: `event-${suffix}-${providerMessageId}`,
      ruleId: 'test-rule',
      templateKey: 'invoice_due_soon',
      templateVersion: 1,
      classification: 'transactional',
      channel: 'email',
      recipientTenantId: tenantId,
      facilityId,
      toAddress: email,
      subjectSnapshot: 'Rent is due',
      bodySnapshot: 'Rent is due.',
      status: 'sent',
      providerMessageId,
      sentAt: new Date(),
    },
  })
}

describeDb('bounce handling', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Delivery Test',
        slug: `delivery-${suffix}`,
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
      data: { firstName: 'Bo', lastName: 'Bounce', email },
    })
    tenantId = tenant.id
    const staff = await prisma.staffUser.create({
      data: { email: `delivery-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.suppression.deleteMany({ where: { address: { contains: suffix } } })
    await prisma.tenant.update({ where: { id: tenantId }, data: { emailUndeliverableAt: null } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // The facility, tenant and staff user are left behind on purpose: these
    // tests write audit entries, `audit_log` refuses DELETE at the database
    // level (B-009), and the FK from those entries would block the facility
    // delete anyway. Every fixture is suffixed, so the leftovers are inert.
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.suppression.deleteMany({ where: { address: { contains: suffix } } })
    await prisma.$disconnect()
  })

  describe('delivery events', () => {
    it('records a delivery', async () => {
      const message = await makeMessage(`prov-${suffix}-ok`)

      const outcome = await applyDeliveryEvent({
        type: 'email.delivered',
        providerMessageId: `prov-${suffix}-ok`,
      })

      expect(outcome).toMatchObject({ applied: true, status: 'delivered', suppressed: false })
      const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } })
      expect(after.status).toBe('delivered')
    })

    it('suppresses, flags the tenant and raises a task on a hard bounce', async () => {
      await makeMessage(`prov-${suffix}-bounce`)

      const outcome = await applyDeliveryEvent({
        type: 'email.bounced',
        providerMessageId: `prov-${suffix}-bounce`,
      })

      expect(outcome).toMatchObject({ applied: true, status: 'bounced', suppressed: true })

      const suppression = await prisma.suppression.findUnique({
        where: { channel_address: { channel: 'email', address: email } },
      })
      expect(suppression?.reason).toBe('hard_bounce')

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.emailUndeliverableAt).not.toBeNull()

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'no_reachable_channel', entityId: tenantId },
      })
      expect(task.status).toBe('open')
      expect(task.priority).toBe('high')
    })

    it('is idempotent — a redelivered bounce makes one task, not two', async () => {
      await makeMessage(`prov-${suffix}-twice`)
      const event = { type: 'email.bounced', providerMessageId: `prov-${suffix}-twice` }

      await applyDeliveryEvent(event)
      await applyDeliveryEvent(event)

      const tasks = await prisma.task.findMany({ where: { facilityId, entityId: tenantId } })
      expect(tasks).toHaveLength(1)
      const suppressions = await prisma.suppression.findMany({ where: { address: email } })
      expect(suppressions).toHaveLength(1)
    })

    it('acknowledges an event for a message it has never heard of', async () => {
      const outcome = await applyDeliveryEvent({
        type: 'email.delivered',
        providerMessageId: `prov-${suffix}-nobody`,
      })
      expect(outcome).toEqual({ applied: false, reason: 'unknown_message' })
    })
  })

  // Nested rather than a sibling describeDb: both halves share one facility,
  // tenant and staff user, and a sibling block would run after this one's
  // afterAll had already torn them down.
  describe('suppression management — CN-20', () => {
    const manual = `manual-${suffix}@example.com`

    it('adds a staff entry and lets it be lifted with a reason', async () => {
      const added = await addSuppression(actor(), facilityId, {
        channel: 'email',
        address: manual,
        note: 'Asked at the counter.',
      })
      expect(added).toEqual({ ok: true })

      const rows = await suppressionList(actor(), facilityId, suffix)
      const row = rows.find((entry) => entry.address === manual)
      expect(row?.reason).toBe('manual')
      expect(row?.removable).toBe(true)

      const removed = await removeSuppression(actor(), facilityId, {
        id: row!.id,
        reason: 'They asked to start hearing from us again.',
      })
      expect(removed).toEqual({ ok: true })
      expect(await prisma.suppression.findFirst({ where: { address: manual } })).toBeNull()
    })

    it('refuses to lift a complaint', async () => {
      const row = await prisma.suppression.create({
        data: { channel: 'email', address: `complainer-${suffix}@example.com`, reason: 'complaint' },
      })

      const result = await removeSuppression(actor(), facilityId, { id: row.id, reason: 'Asked to' })

      expect(result.ok).toBe(false)
      expect(await prisma.suppression.findUnique({ where: { id: row.id } })).not.toBeNull()
    })

    it('refuses to lift a STOP', async () => {
      const row = await prisma.suppression.create({
        data: { channel: 'sms', address: `+1512555${suffix.slice(0, 4)}`, reason: 'stop' },
      })

      const result = await removeSuppression(actor(), facilityId, { id: row.id, reason: 'Asked to' })

      expect(result.ok).toBe(false)
    })

    it('requires a reason to lift anything', async () => {
      const row = await prisma.suppression.create({
        data: { channel: 'email', address: `noreason-${suffix}@example.com`, reason: 'manual' },
      })

      const result = await removeSuppression(actor(), facilityId, { id: row.id, reason: '  ' })

      expect(result.ok).toBe(false)
      expect(await prisma.suppression.findUnique({ where: { id: row.id } })).not.toBeNull()
    })

    it('lifting a bounce clears the tenant flag it set', async () => {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { emailUndeliverableAt: new Date() },
      })
      const row = await prisma.suppression.create({
        data: { channel: 'email', address: email, reason: 'hard_bounce' },
      })

      await removeSuppression(actor(), facilityId, { id: row.id, reason: 'New address confirmed.' })

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.emailUndeliverableAt).toBeNull()
    })
  })
})
