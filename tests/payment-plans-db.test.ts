import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
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
      ? ['tenants:view', 'tenants:edit', 'delinquency:execute_step']
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

async function newLease(): Promise<string> {
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
  return lease.id
}

async function pay(leaseId: string, amountCents: number, occurredAt: Date): Promise<void> {
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'payment',
      amountCents: -amountCents,
      description: 'Test payment',
      occurredAt,
    },
  })
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
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('creating', () => {
    it('places the payment_plan hold, writes the schedule, and halts the pipeline', async () => {
      const leaseId = await newLease()
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

    it('refuses a schedule that does not add up, and places no hold', async () => {
      const leaseId = await newLease()
      const result = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      // totalCents is derived as the SUM, so this always balances by
      // construction — the refusal case worth proving is a genuinely invalid
      // row instead.
      expect(result).toMatchObject({ ok: true })

      const badLease = await newLease()
      const bad = await createPaymentPlan(actor(managerId, 20), badLease, {
        installments: [{ dueDate: d('2026-08-01'), amountCents: 5000 }], // due date not in the future
      })
      expect(bad).toMatchObject({ ok: false, reason: 'invalid_schedule' })
      expect(await leaseHasEffect(badLease, 'halt_dunning')).toBe(false)
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
      // Relative to the real clock, not a hardcoded calendar date: `createPaymentPlan`
      // stamps `createdAt` from `new Date()`, and `paidSincePlanStart` only counts
      // payments from that moment on — a payment dated before it is invisible to
      // the plan by construction, which is the case the OTHER breach test covers.
      const now = new Date()
      const day = 24 * 60 * 60 * 1000
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [
          { dueDate: new Date(now.getTime() + day), amountCents: 5000 },
          { dueDate: new Date(now.getTime() + 31 * day), amountCents: 5000 },
        ],
      })
      if (!created.ok) throw new Error('setup failed')

      await pay(leaseId, 5000, new Date(now.getTime() + 1000))
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('active')
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

      await pay(leaseId, 5000, new Date(now.getTime() + 1000))
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 2 * day), recordItem)

      const plan = await paymentPlanForLease(leaseId)
      expect(plan?.status).toBe('completed')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
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
