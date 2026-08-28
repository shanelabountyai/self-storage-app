import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { COMMS_RULES } from '../packages/db/comms-catalog'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { createPaymentPlan, cancelPaymentPlan } from '../apps/web/lib/admin/payment-plans'
import {
  emitInstallmentReminders,
  evaluatePaymentPlanBreaches,
} from '../apps/web/lib/delinquency/payment-plan-breach'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-191 / PRD 05 CN-24. A payment plan's four messages.
//
// Before this, a plan said nothing to the tenant at any point in its life: not
// when it was agreed, not before an installment, and — the one that matters —
// not when it broke. The hour-4 job lifted the hold, dunning resumed, late fees
// re-armed and access suspension re-armed, and the tenant's first notice of any
// of it was the ladder, or the gate.
//
// Driven against the REAL seeded catalog, the same choice `comms-billing-db`
// made and for the same reason: the deliverable here is the rules and the copy,
// so a suite that seeded its own would prove the engine works (B-030 already
// does) and nothing about what a tenant actually receives.
//
// **The clock is pinned** (CN-24's own AC, and CLAUDE.md's trap). These four
// are transactional so no marketing quiet-hours gate applies to them today —
// but every date in the assertions below is derived from "now", and a suite
// whose expected strings move with the wall clock is one that goes red in
// December for reasons that have nothing to do with the code.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const NOW = new Date('2026-09-01T15:00:00.000Z')
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let tenantId = ''
let unitTypeId = ''
let staffId = ''
let counter = 0

const sends: { to: string; subject: string; body: string; html: string }[] = []
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '', html: email.html ?? '' })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

function actor(): Actor {
  const permissions: PermissionKey[] = ['tenants:view', 'tenants:edit', 'delinquency:execute_step']
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(permissions),
        limits: {
          maxFeeWaiverCents: 0,
          maxRefundCents: 0,
          maxCreditCents: 0,
          maxPlanDeferralCents: 500_000,
        },
      },
    ],
  }
}

async function newLease(): Promise<string> {
  counter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `PPC-${counter}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-06-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      autopayEnabled: true,
    },
  })
  return lease.id
}

/// One open invoice, already due — the arrears a plan is agreed over.
async function arrears(leaseId: string, amountCents: number): Promise<void> {
  counter += 1
  await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `PPC${String(counter).padStart(5, '0')}-${suffix}`,
      status: 'open',
      issueDate: d('2026-08-01'),
      dueDate: d('2026-08-01'),
      periodStart: d('2026-08-01'),
      periodEnd: d('2026-09-01'),
      subtotalCents: amountCents,
      totalCents: amountCents,
    },
  })
  // The ledger is what the break notice quotes (FR-18, read at send time), and
  // it is a different source from the invoice — so the fixture has to write
  // both or the balance reads zero on a lease that owes $1,800.
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      description: 'August rent',
      amountCents,
      occurredAt: d('2026-08-01'),
    },
  })
}

/// Runs the comms pipeline over every event raised for this facility since the
/// last drain, oldest first — the dispatcher's own order.
async function drainEvents(): Promise<void> {
  const events = await prisma.domainEvent.findMany({
    where: { facilityId, name: { startsWith: 'payment_plan.' } },
    orderBy: { occurredAt: 'asc' },
  })
  for (const event of events) await processCommsEvent(event)
  await prisma.domainEvent.deleteMany({ where: { facilityId, name: { startsWith: 'payment_plan.' } } })
}

async function agreePlan(
  leaseId: string,
  installments: { dueDate: Date; amountCents: number }[],
  autoCollect = true,
): Promise<string> {
  const result = await createPaymentPlan(actor(), leaseId, { installments, autoCollect })
  if (!result.ok) throw new Error(`plan refused: ${result.reason}`)
  return result.planId
}

describeDb('payment plan notifications (CN-24)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Plan Comms ${suffix}`,
        slug: `plan-comms-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        // The lead time CN-24's reminder uses. Three days ahead of the 15th is
        // the 12th, which is what the sweep below is run on.
        invoiceLeadDays: 3,
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: {
        email: `plan-comms-${suffix}@example.com`,
        firstName: 'Ada',
        lastName: 'Renter',
        stripeCustomerId: `cus_${suffix}`,
        stripeDefaultPaymentMethodId: `pm_${suffix}`,
      },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `plan-comms-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(async () => {
    sends.length = 0
    collected.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    // Both sweeps under test are FACILITY-wide, so a plan left behind by one
    // test is picked up by the next one's run — which is a real property of
    // the job, not a fixture quirk, and the reason each test here starts from
    // a facility with no live plan on it.
    await prisma.payLink.deleteMany({ where: { lease: { facilityId } } })
    await prisma.paymentPlan.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: `pm_${suffix}` },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.useRealTimers()
    vi.restoreAllMocks()
    await prisma.$disconnect()
  })

  describe('the catalog', () => {
    it('wires a rule to each of the four events', () => {
      const events = COMMS_RULES.map((rule) => rule.event)
      expect(events).toContain('payment_plan.agreed')
      expect(events).toContain('payment_plan.installment_due_soon')
      expect(events).toContain('payment_plan.broken')
      expect(events).toContain('payment_plan.completed')
    })

    it('does not skip the installment reminder when autopay would cover it', () => {
      // The opposite of CN-1's rule for an ordinary invoice, and deliberate: a
      // tenant who believes a payment is automatic and is wrong loses the plan
      // over a misunderstanding.
      const rule = COMMS_RULES.find((one) => one.event === 'payment_plan.installment_due_soon')!
      expect(rule.skipConditions ?? []).not.toContain('autopay_covers_it')
      expect(rule.skipConditions ?? []).toContain('payment_plan_not_active')
    })
  })

  describe('plan agreed', () => {
    it('states every installment, the total, and that the card will be charged', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 180_000)
      await agreePlan(leaseId, [
        { dueDate: d('2026-09-15'), amountCents: 60_000 },
        { dueDate: d('2026-10-15'), amountCents: 60_000 },
        { dueDate: d('2026-11-15'), amountCents: 60_000 },
      ])
      await drainEvents()

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('payment plan')
      expect(sends[0].body).toContain('$1,800.00')
      expect(sends[0].body).toContain('1. September 15, 2026 — $600.00')
      expect(sends[0].body).toContain('2. October 15, 2026 — $600.00')
      expect(sends[0].body).toContain('3. November 15, 2026 — $600.00')
      expect(sends[0].body).toContain('from your card on file')
      // D-15: what the tenant loses if a payment is missed, in their words.
      expect(sends[0].body).toContain('the plan ends')
      expect(sends[0].body).not.toMatch(/installment status|hold lifted|dunning|delinquen/i)

      // CN-24 / B-198: the same schedule as a real table in the HTML part —
      // one caption, column headers, and the installment number as the row
      // header. The list above and this come from the one array, so a table
      // that goes stale is a test failure rather than a message nobody reads.
      expect(sends[0].html).toContain('<caption')
      expect(sends[0].html).toContain('Your payment plan</caption>')
      expect(sends[0].html).toContain('<th scope="col" align="left">Amount</th>')
      expect(sends[0].html).toContain('<th scope="row" align="left">2</th>')
      expect(sends[0].html).toContain('<td align="right">October 15, 2026</td>')
      // A <table> inside a <p> is invalid markup, and it is what the schedule
      // would land in if it stopped owning its own paragraph.
      expect(sends[0].html).not.toContain('<p><table')
    })

    it('says the payments are NOT automatic when the card is gone, whatever was agreed', async () => {
      // D-97's three separate facts. The plan is agreed auto-collect; the card
      // is removed before the message goes out; the message must state what is
      // EFFECTIVELY true, because "we'll take care of it" is how somebody ends
      // up in collections believing they kept to the plan.
      const leaseId = await newLease()
      await arrears(leaseId, 60_000)
      await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 60_000 }], true)
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeDefaultPaymentMethodId: null },
      })
      await drainEvents()

      expect(sends[0].body).toContain('not taken automatically')
      expect(sends[0].body).not.toContain('from your card on file')
    })
  })

  describe('installment due soon', () => {
    it('raises and sends one reminder on the lead day, whether or not autopay will take it', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 120_000)
      await agreePlan(leaseId, [
        { dueDate: d('2026-09-15'), amountCents: 60_000 },
        { dueDate: d('2026-10-15'), amountCents: 60_000 },
      ])
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      await emitInstallmentReminders(facilityId, d('2026-09-12'), recordItem)
      await drainEvents()

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('September 15')
      expect(sends[0].body).toContain('$600.00')
      expect(sends[0].body).toContain('Tuesday, September 15')
      // Autopay is on and a card is saved, and it still goes.
      expect(sends[0].body).toContain('from your card on file')
    })

    it('raises nothing on a day no installment is the lead days away', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 60_000)
      await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 60_000 }])
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      await emitInstallmentReminders(facilityId, d('2026-09-11'), recordItem)
      await emitInstallmentReminders(facilityId, d('2026-09-13'), recordItem)

      expect(
        await prisma.domainEvent.count({
          where: { facilityId, name: 'payment_plan.installment_due_soon' },
        }),
      ).toBe(0)
    })

    it('cancels the reminder at send time when the plan is no longer active', async () => {
      // FR-18 staleness: the plan was cancelled between the nightly job raising
      // this and the dispatcher reaching it. "Your next payment is due" about a
      // plan that no longer exists is worse than silence.
      const leaseId = await newLease()
      await arrears(leaseId, 60_000)
      const planId = await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 60_000 }])
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      await emitInstallmentReminders(facilityId, d('2026-09-12'), recordItem)
      await cancelPaymentPlan(actor(), planId, 'Tenant paid the whole arrears at the counter.')
      await drainEvents()

      expect(sends).toHaveLength(0)
      const message = await prisma.message.findFirst({
        where: { facilityId, templateKey: 'payment_plan_installment_due_soon' },
        select: { status: true },
      })
      expect(message?.status).toBe('cancelled')
    })
  })

  describe('plan broken', () => {
    it('is sent the same night the hold lifts, and quotes what is owed now', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 180_000)
      await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 180_000 }], false)
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      // Manual-pay, so no retry ladder holds it open; past the facility's
      // grace, so the installment genuinely reads missed.
      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-30'), recordItem)
      await drainEvents()

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('has ended')
      expect(sends[0].body).toContain('$1,800.00')
      expect(sends[0].body).toContain('Late fees start again')
      expect(sends[0].body).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/)
      // D-15 again: no internal vocabulary in a message about somebody's money.
      expect(sends[0].body).not.toMatch(/hold lifted|dunning|delinquen|installment status/i)
    })

    it('quotes the balance as it is at SEND time, not as it was when the plan broke', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 180_000)
      await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 180_000 }], false)
      await prisma.domainEvent.deleteMany({ where: { facilityId } })
      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-30'), recordItem)

      // A counter payment lands between the job and the dispatcher.
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'payment',
          description: 'Counter payment',
          amountCents: -80_000,
          occurredAt: d('2026-09-30'),
        },
      })
      await drainEvents()

      expect(sends[0].body).toContain('$1,000.00')
      expect(sends[0].body).not.toContain('$1,800.00')
    })
  })

  describe('plan kept', () => {
    it('says thank you, and is the only one of the four that is good news', async () => {
      const leaseId = await newLease()
      await arrears(leaseId, 60_000)
      await agreePlan(leaseId, [{ dueDate: d('2026-09-15'), amountCents: 60_000 }])
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      // The plan's own covered invoice, settled in full — which is what
      // `planProgressCents` measures completion against.
      await prisma.invoice.updateMany({
        where: { leaseId },
        data: { amountPaidCents: 60_000, status: 'paid' },
      })
      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-16'), recordItem)
      await drainEvents()

      expect(sends).toHaveLength(1)
      expect(sends[0].subject).toContain('paid off')
      expect(sends[0].body).toContain('$600.00')
    })
  })
})
