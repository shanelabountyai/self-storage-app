import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyPayment } from '../apps/web/lib/billing/allocation'
import { returnPayment } from '../apps/web/lib/billing/reversals'
import { leaseHasEffect } from '../apps/web/lib/admin/holds'
import {
  cancelPaymentPlan,
  createPaymentPlan,
  paymentPlanForLease,
} from '../apps/web/lib/admin/payment-plans'
import { evaluatePaymentPlanBreaches } from '../apps/web/lib/delinquency/payment-plan-breach'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). The schedule against real
// rows: creating a plan halts the pipeline through the same hold B-096 built,
// missing an installment breaks it, and finishing one closes it out.
//
// **B-188 / D-96 rewrote what "paid" means here, and the fixtures with it.**
// Plan progress is no longer a sum of `type: 'payment'` ledger entries since
// the plan started — it is the frozen arrears less what is STILL outstanding
// on the invoices the plan covers. So a test lease now needs a real overdue
// invoice for a plan to exist at all, and a test payment has to settle one
// through `applyPayment` rather than post a bare ledger row.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let unitTypeId = ''
let managerId = ''
let counterId = ''

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

/// Rank 20 is manager, 10 is counter — matching the seeded roles. Only
/// `manager` carries `delinquency:execute_step`, the gate this whole file
/// exercises.
function actor(staffUserId: string, rank: number): Actor {
  const permissions: PermissionKey[] =
    rank >= 20
      ? ['tenants:view', 'tenants:edit', 'delinquency:execute_step', 'refunds:approve']
      : ['tenants:view', 'tenants:edit']
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

let invoiceCounter = 0

/// One invoice, `open` and already due unless told otherwise. `dueDate` is
/// what decides whether a plan can be agreed over it (`arrearsForLease` takes
/// everything due at or before now) and `periodStart` keeps the partial unique
/// index on `(leaseId, periodStart) where kind = 'rent'` happy when a lease
/// needs more than one.
async function invoice(
  leaseId: string,
  amountCents: number,
  options: { dueDate?: Date; kind?: 'rent' | 'fee' } = {},
): Promise<string> {
  invoiceCounter += 1
  const dueDate = options.dueDate ?? d('2026-07-01')
  const row = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `PP${String(invoiceCounter).padStart(5, '0')}-${suffix}`,
      kind: options.kind ?? 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: amountCents,
      totalCents: amountCents,
      lineItems: {
        create: [
          {
            type: options.kind === 'fee' ? 'fee' : 'rent',
            description: 'Test charge',
            quantity: 1,
            unitAmountCents: amountCents,
            amountCents,
          },
        ],
      },
    },
  })
  return row.id
}

/// A lease with `arrearsCents` already past due — which is now the precondition
/// for a plan existing at all, since the installments must add up to exactly
/// what is owed.
async function newLease(arrearsCents = 5000): Promise<string> {
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `PP-${randomUUID().slice(0, 6)}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-08-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  if (arrearsCents > 0) await invoice(lease.id, arrearsCents)
  return lease.id
}

/// A payment that actually settles something — the real `applyPayment`, in the
/// facility's own allocation order, writing the `PaymentAllocation` rows and
/// recomputing the invoices. Progress is read from those invoices now, so a
/// bare ledger entry (which is what this used to be) moves nothing.
///
/// **Named to this lease's oldest unpaid invoice unless told otherwise.**
/// Allocation claims run per tenant × FACILITY, and every lease in this file
/// belongs to one tenant at one facility — so an unnamed payment settles
/// whichever test's arrears happen to be oldest, and every assertion here
/// becomes an assertion about test ordering.
async function pay(
  leaseId: string,
  amountCents: number,
  options: { invoiceId?: string } = {},
): Promise<string> {
  const target =
    options.invoiceId ??
    (
      await prisma.invoice.findFirstOrThrow({
        where: { leaseId, status: { in: ['open', 'partially_paid'] } },
        orderBy: { dueDate: 'asc' },
        select: { id: true },
      })
    ).id
  const payment = await prisma.payment.create({
    data: { facilityId, tenantId, amountCents, method: 'card', status: 'succeeded' },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'payment',
      amountCents: -amountCents,
      description: 'Test payment',
      paymentId: payment.id,
    },
  })
  await prisma.$transaction(async (tx) => {
    await applyPayment(
      tx,
      { id: payment.id, tenantId, facilityId, amountCents },
      { explicitInvoiceId: target },
    )
  })
  return payment.id
}

describeDb('payment plans', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Payment Plan Test',
        slug: `payment-plan-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `pp-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const [manager, counter] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `pp-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      }),
      prisma.staffUser.create({
        data: { email: `pp-ctr-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
    ])
    managerId = manager.id
    counterId = counter.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(async () => {
    collected.length = 0
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.paymentPlan.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('creating', () => {
    it('places the payment_plan hold, writes the schedule, and halts the pipeline', async () => {
      const leaseId = await newLease(10_000)
      const result = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [
          { dueDate: d('2026-09-01'), amountCents: 5000 },
          { dueDate: d('2026-10-01'), amountCents: 5000 },
        ],
      })
      expect(result).toMatchObject({ ok: true })

      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(true)
      expect(await leaseHasEffect(leaseId, 'halt_late_fees')).toBe(true)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('active')
      expect(plan?.totalCents).toBe(10000)
      expect(plan?.installments.map((i) => i.status)).toEqual(['upcoming', 'upcoming'])

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'payment_plan.created', entityId: leaseId },
      })
      expect((audit.after as { totalCents?: number } | null)?.totalCents).toBe(10000)
    })

    it('refuses a plan that does not cover the arrears, naming the shortfall', async () => {
      // B-188 defect (3). This is the case that used to be unreachable: the
      // total was the SUM of the installments, so a $50 plan against an
      // $1,800 arrear balanced by construction, validated, halted the ladder
      // and completed itself.
      const leaseId = await newLease(180_000)
      const short = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      expect(short).toMatchObject({ ok: false, reason: 'invalid_schedule' })
      if (short.ok || short.reason !== 'invalid_schedule') throw new Error('expected a refusal')
      expect(short.problems[0].problem).toContain('$50.00')
      expect(short.problems[0].problem).toContain('$1800.00')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
      expect(await prisma.paymentPlan.count({ where: { leaseId } })).toBe(0)

      // And the same lease succeeds the moment the installments add up.
      const exact = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [
          { dueDate: d('2026-09-01'), amountCents: 90_000 },
          { dueDate: d('2026-10-01'), amountCents: 90_000 },
        ],
      })
      expect(exact).toMatchObject({ ok: true })
    })

    it('refuses a plan on a lease with nothing past due', async () => {
      const leaseId = await newLease(0)
      const result = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      expect(result).toMatchObject({ ok: false, reason: 'invalid_schedule' })
      if (result.ok || result.reason !== 'invalid_schedule') throw new Error('expected a refusal')
      expect(result.problems).toEqual([
        { index: null, problem: 'There is nothing past due on this lease to put on a plan.' },
      ])
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
    })

    it('refuses an invalid row, and places no hold', async () => {
      const badLease = await newLease()
      const bad = await createPaymentPlan(actor(managerId, 20), badLease, {
        installments: [{ dueDate: d('2026-08-01'), amountCents: 5000 }], // due date not in the future
      })
      expect(bad).toMatchObject({ ok: false, reason: 'invalid_schedule' })
      expect(await leaseHasEffect(badLease, 'halt_dunning')).toBe(false)
    })

    it('freezes the invoices it covers, so later rent cannot satisfy an installment', async () => {
      const leaseId = await newLease(5000)
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      const arrearsInvoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
      const plan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: created.planId } })
      expect(plan.invoiceIds).toEqual([arrearsInvoice.id])
      expect(plan.totalCents).toBe(5000)
    })

    it('refuses counter staff — this is a manager-tier decision', async () => {
      const leaseId = await newLease()
      await expect(
        createPaymentPlan(actor(counterId, 10), leaseId, {
          installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
        }),
      ).rejects.toThrow()
    })

    it('refuses a second active plan on the same lease', async () => {
      const leaseId = await newLease()
      await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      const second = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-15'), amountCents: 5000 }],
      })
      expect(second).toMatchObject({ ok: false, reason: 'already_active' })
    })
  })

  describe('cancelling', () => {
    it('lifts the hold and resumes collections', async () => {
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      const cancelled = await cancelPaymentPlan(actor(managerId, 20), created.planId, 'Tenant paid in full at the counter.')
      expect(cancelled).toMatchObject({ ok: true })
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('cancelled')
    })

    it('refuses without a reason', async () => {
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      expect(await cancelPaymentPlan(actor(managerId, 20), created.planId, '  ')).toMatchObject({
        ok: false,
        reason: 'missing_reason',
      })
    })
  })

  describe('the nightly breach check', () => {
    it('breaks a plan whose installment passed unpaid, lifts the hold, and raises a task', async () => {
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-02'), recordItem)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('broken')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
      expect(collected.some((c) => c.message?.includes('broken'))).toBe(true)

      const task = await prisma.task.findFirst({ where: { type: 'payment_plan_broken', entityId: leaseId } })
      expect(task).not.toBeNull()
      expect(task?.priority).toBe('high')
    })

    it('does not break a plan kept up to date', async () => {
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease(10_000)
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [
          { dueDate: new Date(now.getTime() + day), amountCents: 5000 },
          { dueDate: new Date(now.getTime() + 31 * day), amountCents: 5000 },
        ],
      })
      if (!created.ok) throw new Error('setup failed')

      await pay(leaseId, 5000)
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('active')
      expect(plan?.installments.map((i) => i.status)).toEqual(['paid', 'upcoming'])
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(true)
    })

    it('completes a plan once cumulative payments cover every installment, and lifts the hold', async () => {
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: new Date(now.getTime() + day), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      await pay(leaseId, 5000)
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('completed')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
    })

    // ------------------------------------------------- B-188 / D-96 ----

    it('does not count next month\'s rent towards an installment', async () => {
      // Defect (2). A tenant on a plan for $1,800 of arrears who pays only
      // next month's $150 rent had installment 1 marked `paid`, and dunning,
      // late fees and access suspension all stayed halted while the plan
      // collected nothing and reported progress.
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease(180_000)
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [
          { dueDate: new Date(now.getTime() + day), amountCents: 90_000 },
          { dueDate: new Date(now.getTime() + 31 * day), amountCents: 90_000 },
        ],
      })
      if (!created.ok) throw new Error('setup failed')

      // Rent for the coming month, raised AFTER the plan and not yet due, then
      // paid in full. It settles its own invoice and nothing else.
      const nextRent = await invoice(leaseId, 15_000, {
        dueDate: new Date(now.getTime() + 10 * day),
        kind: 'fee',
      })
      await pay(leaseId, 15_000, { invoiceId: nextRent })

      const plan = await paymentPlanForLease(leaseId, new Date(now.getTime() + 2 * day))
      expect(plan?.installments.map((i) => i.status)).toEqual(['missed', 'upcoming'])

      // ...and the nightly job breaks it, rather than leaving the ladder
      // halted on a payment that never touched the arrears.
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('broken')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
    })

    it('takes its progress back when the payment is returned, and breaks that night', async () => {
      // Defect (1). `returnPayment` posts a positive `adjustment` and
      // deliberately leaves the original `payment` row standing, so summing
      // `type: 'payment'` left every installment it had covered reading
      // `paid` — a plan could complete itself and lift its own hold on money
      // the bank had taken back.
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: new Date(now.getTime() + day), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      const paymentId = await pay(leaseId, 5000)
      expect((await paymentPlanForLease(leaseId))?.installments[0].status).toBe('paid')

      const returned = await returnPayment(actor(managerId, 20), paymentId, {
        reasonCode: 'insufficient funds',
        waiveFee: true,
      })
      expect(returned).toMatchObject({ ok: true })

      const plan = await paymentPlanForLease(leaseId, new Date(now.getTime() + 2 * day))
      expect(plan?.status).toBe('active')
      expect(plan?.installments[0].status).toBe('missed')

      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('broken')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
    })

    it('does not complete a plan on money that came back before the nightly run', async () => {
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: new Date(now.getTime() + 31 * day), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      const paymentId = await pay(leaseId, 5000)
      await returnPayment(actor(managerId, 20), paymentId, {
        reasonCode: 'account closed',
        waiveFee: true,
      })

      // Nothing is due yet, so this is not a breach — but it must not be a
      // completion either, and the hold must stay on.
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + day), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('active')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(true)
    })

    it('is idempotent — re-running after a plan already broke does nothing further', async () => {
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-02'), recordItem)
      const firstCount = await prisma.task.count({ where: { type: 'payment_plan_broken', entityId: leaseId } })

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-03'), recordItem)
      const secondCount = await prisma.task.count({ where: { type: 'payment_plan_broken', entityId: leaseId } })

      expect(secondCount).toBe(firstCount)
    })
  })
})
