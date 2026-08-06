import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { COMMS_RULES, COMMS_TEMPLATES } from '../packages/db/comms-catalog'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'

// B-050 / PRD 05 §3.1 CN-1, CN-2, CN-6, CN-10a, and the D-17 and D-29 notices.
//
// Driven against the REAL seeded catalog rather than test-local rules: the
// deliverable here is the rules and templates themselves, so a test that seeded
// its own would prove the engine works — which B-030 already proves — and
// nothing about what a tenant actually receives.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let holdStaffId = ''
let unitCounter = 0

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

async function emit(name: string, entityType: string, entityId: string, payload: object = {}) {
  const event = await prisma.domainEvent.create({
    data: { name, entityType, entityId, facilityId, payload: payload as never },
  })
  await processCommsEvent(event)
  return event
}

async function makeInvoice(options: { paid?: boolean; dueDate?: Date } = {}): Promise<string> {
  unitCounter += 1
  const total = 12_900
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `CB${String(unitCounter).padStart(5, '0')}`,
      status: options.paid ? 'paid' : 'open',
      issueDate: new Date('2026-08-27T00:00:00.000Z'),
      dueDate: options.dueDate ?? new Date('2026-09-01T00:00:00.000Z'),
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      subtotalCents: total,
      totalCents: total,
      amountPaidCents: options.paid ? total : 0,
    },
  })
  return invoice.id
}

async function setAutopay(on: boolean): Promise<void> {
  await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: on } })
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeDefaultPaymentMethodId: on ? `pm_${suffix}` : null },
  })
}

describeDb('billing notices', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: 'Comms Billing Test',
        slug: `comms-billing-${suffix}`,
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
      data: { email: `comms-billing-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `comms-hold-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    holdStaffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'C-7' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.payLink.deleteMany({ where: { leaseId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await setAutopay(false)
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    // Lease before unit: the FK is RESTRICT, deliberately (a unit that has ever
    // been rented cannot be deleted out from under its lease).
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('the seeded catalog', () => {
    it('has a template for every rule it seeds', () => {
      // A rule pointing at a template that does not exist is a silent no-send.
      const keys = new Set(COMMS_TEMPLATES.map((template) => template.key))
      const orphans = COMMS_RULES.filter((rule) => !keys.has(rule.templateKey))
      expect(orphans.map((rule) => rule.templateKey)).toEqual([])
    })

    it('declares every merge field its body actually uses', () => {
      // FR-9 fails a render on an unknown field, so a body referencing one the
      // seed never declares would go out blank — or not at all.
      for (const template of COMMS_TEMPLATES) {
        const used = new Set(
          [...`${template.subject}\n${template.bodyText}`.matchAll(/{{\s*([\w.]+)\s*}}/g)].map(
            (match) => match[1],
          ),
        )
        const declared = new Set(template.requiredMergeFields)
        const undeclared = [...used].filter((field) => !declared.has(field))
        expect(undeclared, `${template.key} uses fields it does not declare`).toEqual([])
      }
    })
  })

  describe('the pay-now link (B-051)', () => {
    it('puts a real one-tap link in the reminder, not the password-gated portal', async () => {
      const invoiceId = await makeInvoice()
      await emit('invoice.due_soon', 'Invoice', invoiceId)

      expect(sends[0].body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/)
      expect(sends[0].body).not.toContain('/portal/pay')

      const link = await prisma.payLink.findFirstOrThrow({ where: { leaseId } })
      expect(link.revokedAt).toBeNull()
    })

    it('keeps the update-card link on the portal, which genuinely needs a password', async () => {
      // Changing the card autopay charges is more than this link is scoped to
      // grant, so that one deliberately still asks someone to sign in.
      const payment = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents: 12_900, method: 'card', status: 'failed' },
      })
      await emit('payment.failed', 'Payment', payment.id, {
        amountCents: 12_900,
        code: 'card_declined',
      })

      expect(sends[0].body).toContain('/portal/methods')
      expect(sends[0].body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/)
    })
  })

  describe('due-date reminders and the autopay skip', () => {
    it('reminds a tenant who pays by hand', async () => {
      const invoiceId = await makeInvoice()
      await emit('invoice.due_soon', 'Invoice', invoiceId)

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('due')
      expect(sends[0].body).toContain('$129.00')
      expect(sends[0].body).toContain('C-7')
    })

    it('says nothing when autopay will cover it', async () => {
      // The message that teaches people to ignore every other one: go and pay a
      // bill your own saved card is about to pay.
      await setAutopay(true)
      const invoiceId = await makeInvoice()
      await emit('invoice.due_soon', 'Invoice', invoiceId)

      expect(sends).toEqual([])
      const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
      expect(message.status).toBe('cancelled')
      expect(message.error).toBe('skipped: autopay_covers_it')
    })

    it('still reminds a lease enrolled in autopay with no card on file', async () => {
      // Enrolled but uncharged is exactly the tenant who needs telling — both
      // halves of autopay have to be true for the skip to be honest.
      await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: true } })
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeDefaultPaymentMethodId: null },
      })
      const invoiceId = await makeInvoice()
      await emit('invoice.due_soon', 'Invoice', invoiceId)

      expect(sends).toHaveLength(1)
    })

    it('does not chase an invoice paid between the event and the send', async () => {
      // FR-18 staleness: a counter payment this morning, an autopay run that
      // beat the dispatcher.
      const invoiceId = await makeInvoice({ paid: true })
      await emit('invoice.due_today', 'Invoice', invoiceId)

      expect(sends).toEqual([])
      const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
      expect(message.error).toBe('skipped: invoice_paid')
    })

    it('says nothing to a tenant who has already moved out', async () => {
      const invoiceId = await makeInvoice()
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      await emit('invoice.due_today', 'Invoice', invoiceId)

      expect(sends).toEqual([])
    })
  })

  describe('receipts', () => {
    it('sends a receipt carrying the amount, the date and the balance', async () => {
      const payment = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 12_900,
          method: 'card',
          status: 'succeeded',
        },
      })
      await prisma.ledgerEntry.create({
        data: { facilityId, leaseId, type: 'charge', amountCents: 12_900, description: 'Rent' },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'payment',
          amountCents: -12_900,
          description: 'Card payment',
          paymentId: payment.id,
        },
      })

      await emit('payment.succeeded', 'Payment', payment.id)

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('$129.00')
      // The balance is read from the ledger at send time, not the event.
      expect(sends[0].body).toContain('$0.00')
    })

    it('sends a receipt to an autopay tenant — the skip is for reminders only', async () => {
      await setAutopay(true)
      const payment = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents: 12_900, method: 'card', status: 'succeeded' },
      })
      await emit('payment.succeeded', 'Payment', payment.id)

      expect(sends).toHaveLength(1)
    })
  })

  describe('failures and the fix path', () => {
    it('names the cause in plain words and gives one link per action', async () => {
      const payment = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 12_900,
          method: 'card',
          status: 'failed',
          failureReason: 'Your card was declined.',
          failureCode: 'expired_card',
        },
      })
      await emit('payment.failed', 'Payment', payment.id, {
        amountCents: 12_900,
        code: 'expired_card',
      })

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('expired')
      expect(sends[0].body).toContain('/portal/methods')
      // B-051 replaced the password-gated pay URL with a one-tap link.
      expect(sends[0].body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/)
      // Never the provider's own wording — it is written for a developer.
      expect(sends[0].body).not.toContain('expired_card')
    })

    it('does not blame the tenant for an ordinary decline', async () => {
      const payment = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents: 12_900, method: 'card', status: 'failed' },
      })
      await emit('payment.failed', 'Payment', payment.id, {
        amountCents: 12_900,
        code: 'card_declined',
      })

      expect(sends[0].body).toContain('temporary')
    })

    it('escalates the wording on the last of the three daily reminders', async () => {
      await emit('payment.retry_reminder', 'Lease', leaseId, {
        outstandingCents: 12_900,
        reminderNumber: 1,
        remindersTotal: 3,
      })
      expect(sends[0].body).toContain('try the card again automatically')

      sends.length = 0
      await emit('payment.retry_reminder', 'Lease', leaseId, {
        outstandingCents: 12_900,
        reminderNumber: 3,
        remindersTotal: 3,
      })
      expect(sends[0].body).toContain('last reminder')
    })
  })

  describe('the dunning ladder (B-052)', () => {
    it('escalates its tone from the step, and never threatens a date it cannot keep', async () => {
      await emit('delinquency.day_reached', 'Lease', leaseId, {
        day: 1,
        position: 1,
        totalSteps: 4,
      })
      expect(sends[0].body).toContain('it happens, and it is quick to put right')
      expect(sends[0].subject).toContain('We missed your payment')

      sends.length = 0
      await emit('delinquency.day_reached', 'Lease', leaseId, {
        day: 10,
        position: 3,
        totalSteps: 4,
      })
      // Day 10 warns about access because B-098 genuinely suspends it.
      expect(sends[0].body).toContain('gate code will stop working')

      sends.length = 0
      await emit('delinquency.day_reached', 'Lease', leaseId, {
        day: 30,
        position: 4,
        totalSteps: 4,
      })
      // The last rung says "we would have to begin" rather than naming a date:
      // the lien pipeline is Phase 2 and promising a date we cannot keep is
      // worse than saying less.
      expect(sends[0].body).toContain('would have to begin')
      expect(sends[0].body).not.toMatch(/\bon \d{1,2} [A-Z][a-z]+\b/)
    })

    it('carries the one-tap pay link', async () => {
      await emit('delinquency.day_reached', 'Lease', leaseId, { day: 5, position: 2, totalSteps: 4 })
      expect(sends[0].body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/)
    })

    it('says nothing to a lease on a hold that halts dunning', async () => {
      // The emitter checks this too; the rule is the second guard, for an event
      // redelivered from before the hold was placed.
      await prisma.leaseHold.create({
        data: {
          leaseId,
          type: 'military_scra',
          reason: 'Deployment orders.',
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          placedByStaffId: holdStaffId,
        },
      })

      await emit('delinquency.day_reached', 'Lease', leaseId, { day: 5, position: 2, totalSteps: 4 })

      expect(sends).toEqual([])
      const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
      expect(message.error).toBe('skipped: lease_on_hold_dunning')

      await prisma.leaseHold.deleteMany({ where: { leaseId } })
    })
  })

  describe('the card-expiring heads-up', () => {
    it('reads as a heads-up, not a collections letter', async () => {
      await emit('payment_method.expiring', 'Tenant', tenantId, {
        stage: 30,
        expMonth: 11,
        expYear: 2026,
      })

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('11/2026')
      expect(sends[0].body).toContain('no payment has failed')
      expect(sends[0].body).toContain('There is no rush')
    })

    it('sharpens at the seven-day mark', async () => {
      await emit('payment_method.expiring', 'Tenant', tenantId, {
        stage: 7,
        expMonth: 11,
        expYear: 2026,
      })
      expect(sends[0].body).toContain('within the week')
    })
  })

  describe('the D-17 protection notices', () => {
    it('warns before the proof lapses, and says what happens if it does', async () => {
      await emit('protection.proof_expiring', 'Lease', leaseId, {
        stage: 30,
        expiresOn: '2026-09-15',
      })

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('September 15, 2026')
      expect(sends[0].body).toContain('may be enrolled')
    })

    it('states the plan and the cost when a lease is enrolled', async () => {
      // D-17 requires the tenant be told of the enrolment AND its cost.
      await emit('protection.auto_enrolled', 'Lease', leaseId, {
        planName: 'Standard cover',
        premiumCents: 1_400,
      })

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('$14.00')
      expect(sends[0].body).toContain('Standard cover')
      expect(sends[0].body).toContain('$14.00 per month')
    })
  })
})
