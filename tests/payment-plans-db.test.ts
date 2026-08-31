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
  paymentPlansForLease,
} from '../apps/web/lib/admin/payment-plans'
import { evaluatePaymentPlanBreaches } from '../apps/web/lib/delinquency/payment-plan-breach'
import { hasAnyPaymentPlan, paymentPlansForTenant } from '../apps/web/lib/portal/payment-plan'
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
        // D-98 (B-190). A plan defers the whole arrears, so a manager needs
        // real plan authority to agree one at all — $2,000, matching the
        // seeded `manager` role. Counter staff keep zero of everything, which
        // is what makes the forbidden case below still a permission failure
        // rather than an amount one.
        limits: {
          maxFeeWaiverCents: 0,
          maxRefundCents: 0,
          maxCreditCents: 0,
          maxPlanDeferralCents: rank >= 20 ? 200_000 : 0,
        },
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

/// Pushes a plan's agreement a day back from its cancellation, so the rolling
/// year counts it. B-209 excludes a plan cancelled the same facility-local day
/// it was created with nothing collected — a correction, not an arrangement —
/// and both timestamps land in the same second when a test agrees and cancels
/// in a row.
async function backdateCancel(planId: string): Promise<void> {
  const plan = await prisma.paymentPlan.findUniqueOrThrow({
    where: { id: planId },
    select: { createdAt: true },
  })
  await prisma.paymentPlan.update({
    where: { id: planId },
    data: { createdAt: new Date(plan.createdAt.getTime() - 86_400_000) },
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
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
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

  // ── D-98 (B-190). What a plan may commit to, and how many a lease may have ──
  describe('what a plan may commit to', () => {
    it('refuses a deferral larger than the actor may commit to, and names who can', async () => {
      // A manager's plan-deferral limit is $2,000. The defect this closes is
      // that there was NO amount check at all — `delinquency:execute_step` and
      // nothing else, so a manager could defer any balance over any schedule.
      const leaseId = await newLease(300_000)
      const result = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 300_000 }],
      })
      expect(result).toMatchObject({ ok: false, reason: 'over_limit', limitCents: 200_000 })
      // Named from the role table rather than hardcoded — the seeded
      // `regional` carries $10,000 and the permission.
      if (result.ok || result.reason !== 'over_limit') throw new Error('unreachable')
      expect(result.escalateTo).toBe('Regional Manager')
    })

    it('refuses a plan whose last installment is past the facility ceiling', async () => {
      const leaseId = await newLease()
      const far = new Date(Date.now() + 200 * 86_400_000)
      const result = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: far, amountCents: 5000 }],
      })
      expect(result).toMatchObject({ ok: false, reason: 'invalid_schedule' })
      if (result.ok || result.reason !== 'invalid_schedule') throw new Error('unreachable')
      expect(result.problems[0].problem).toContain('90 days')
    })

    it('sends the SECOND plan in a rolling year a rank up, and refuses the third', async () => {
      // The chain is what the whole row is about: a plan broken last night was
      // replaceable this morning, indefinitely, each replacement re-halting
      // dunning, late fees and access suspension while the lien clock never
      // ran. Cancelled plans count — the count is of plans AGREED.
      const leaseId = await newLease()
      const first = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!first.ok) throw new Error('setup failed')
      expect(
        await cancelPaymentPlan(actor(managerId, 20), first.planId, 'tenant changed their mind'),
      ).toMatchObject({ ok: true })
      // Backdated so it is not a same-day CORRECTION, which B-209 excludes
      // from the count deliberately. A plan agreed one day and cancelled the
      // next is an arrangement that was made and then unmade; that is the
      // chain this row is about.
      await backdateCancel(first.planId)

      // Manager is the LOWEST rank that may agree one at all, so the second is
      // not theirs to agree.
      const second = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-02'), amountCents: 5000 }],
      })
      expect(second).toMatchObject({ ok: false, reason: 'needs_escalation', priorCount: 1 })

      // A regional agrees it, and then the facility's limit of two is reached.
      const asRegional = actor(managerId, 30)
      const agreed = await createPaymentPlan(asRegional, leaseId, {
        installments: [{ dueDate: d('2026-09-02'), amountCents: 5000 }],
      })
      expect(agreed).toMatchObject({ ok: true })
      if (!agreed.ok) throw new Error('unreachable')
      expect(
        await cancelPaymentPlan(asRegional, agreed.planId, 'broke it again'),
      ).toMatchObject({ ok: true })
      await backdateCancel(agreed.planId)

      const third = await createPaymentPlan(asRegional, leaseId, {
        installments: [{ dueDate: d('2026-09-03'), amountCents: 5000 }],
      })
      expect(third).toMatchObject({ ok: false, reason: 'too_many_plans', priorCount: 2, limit: 2 })
    })

    it('does not spend a plan on a same-day correction, and does spend one once money moves (B-209)', async () => {
      // The Saturday case: a manager mistypes an installment date, spots it,
      // cancels and re-enters. There is no amend path anywhere in the
      // product, so without this the lease has spent one of its two plans for
      // the year and the second must be agreed a rank up.
      const leaseId = await newLease()
      const mistyped = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!mistyped.ok) throw new Error('setup failed')
      expect(
        await cancelPaymentPlan(actor(managerId, 20), mistyped.planId, 'mistyped the date'),
      ).toMatchObject({ ok: true })

      // Re-entered by the SAME manager: not escalated, because as far as the
      // count is concerned this is still the lease's first plan.
      const corrected = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-02'), amountCents: 5000 }],
      })
      expect(corrected).toMatchObject({ ok: true })
      if (!corrected.ok) throw new Error('unreachable')

      // And it is ungameable: once money has moved under a plan, cancelling it
      // the same day no longer buys a free one.
      await pay(leaseId, 1000)
      expect(
        await cancelPaymentPlan(actor(managerId, 20), corrected.planId, 'renegotiated'),
      ).toMatchObject({ ok: true })
      expect(
        await createPaymentPlan(actor(managerId, 20), leaseId, {
          installments: [{ dueDate: d('2026-09-03'), amountCents: 4000 }],
        }),
      ).toMatchObject({ ok: false, reason: 'needs_escalation', priorCount: 1 })
    })

    it('reads a chain of plans as a chain, with what each one collected', async () => {
      // `paymentPlanForLease` was a `findFirst` ordered `createdAt desc`, so a
      // lease on its second plan read on every screen as a lease on one.
      const leaseId = await newLease()
      const first = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!first.ok) throw new Error('setup failed')
      await pay(leaseId, 2000)
      expect(
        await cancelPaymentPlan(actor(managerId, 20), first.planId, 'renegotiated'),
      ).toMatchObject({ ok: true })

      const second = await createPaymentPlan(actor(managerId, 30), leaseId, {
        installments: [{ dueDate: d('2026-09-15'), amountCents: 3000 }],
      })
      expect(second).toMatchObject({ ok: true })

      const chain = await paymentPlansForLease(leaseId)
      expect(chain).toHaveLength(2)
      // Newest first, and the money the FIRST one collected is still readable
      // beside the second — the second is agreed over what was left, so its
      // own progress correctly restarts at zero.
      expect(chain[0].totalCents).toBe(3000)
      expect(chain[0].collectedCents).toBe(0)
      expect(chain[1].totalCents).toBe(5000)
      expect(chain[1].collectedCents).toBe(2000)

      // B-193. The tenant sees the same chain. Filtered to this lease because
      // every test in this file shares one tenant — what is being asserted is
      // that the portal reads ALL of a lease's plans, not just the live one.
      const portal = await paymentPlansForTenant(tenantId)
      expect(portal.filter((plan) => plan.leaseId === leaseId).map((plan) => plan.totalCents)).toEqual([
        3000, 5000,
      ])
      expect(await hasAnyPaymentPlan(tenantId)).toBe(true)
    })
  })

  describe('the nightly breach check', () => {
    it('leaves a plan standing inside D-98\u2019s grace window, and breaks it after', async () => {
      // A plan that breaks at 00:01 over money that arrives at 2pm is
      // technically right and commercially wrong. This is a MANUAL-pay plan,
      // which is the case that broke the same night the date passed — the
      // auto-collect path already had B-189's retry ladder holding it open.
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
        autoCollect: false,
      })
      if (!created.ok) throw new Error('setup failed')

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-03'), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('active')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(true)

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-05'), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('broken')
    })

    it('breaks a plan whose installment passed unpaid, lifts the hold, and raises a task', async () => {
      const leaseId = await newLease()
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-09-01'), amountCents: 5000 }],
      })
      if (!created.ok) throw new Error('setup failed')

      // D-98 (B-190). Four days after the due date, not one: the facility's
      // three days of grace have to have run out before a plan is broken.
      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-05'), recordItem)

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

    // --------------------------------------------------- B-208 / D-107 ----

    /// The facility's first late-fee step — the day it decided rent is
    /// genuinely late, which D-107 makes the day a plan stops covering for
    /// unpaid rent. Created per test rather than in `beforeAll`, because every
    /// other test in this file is written against a facility that has none.
    async function lateFeeAtDay(daysPastDue: number): Promise<void> {
      await prisma.lateFeeRule.create({
        data: {
          facilityId,
          step: 1,
          daysPastDue,
          amountCents: 2000,
          effectiveFrom: d('2026-01-01'),
        },
      })
    }

    it('breaks a plan when rent it never deferred goes unpaid past the first late-fee day', async () => {
      // B-208. The hole: `halt_late_fees` and `halt_dunning` are evaluated per
      // LEASE, so a tenant could keep every installment, pay no rent at all,
      // and take no fee, no notice, no suspension and no lien clock for the
      // life of the plan.
      await lateFeeAtDay(5)
      const leaseId = await newLease(5000)
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-10-01'), amountCents: 5000 }],
        autoCollect: false,
      })
      if (!created.ok) throw new Error('setup failed')

      // Rent charged AFTER the plan was agreed, so it is not in `invoiceIds`.
      await invoice(leaseId, 12_900, { dueDate: d('2026-09-01') })

      // Four days past due: inside this facility's own idea of late, and the
      // frozen arrears are still unpaid — which must NOT break the plan, since
      // deferring exactly those is what the plan is.
      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-04'), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('active')

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-06'), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('broken')
      expect(await leaseHasEffect(leaseId, 'halt_late_fees')).toBe(false)
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(false)
      expect(collected.some((c) => c.message?.includes('rent outside the plan'))).toBe(true)

      // A different fact gets a different message: this tenant kept every
      // installment, and `payment_plan_broken` opens by telling them they did
      // not.
      const event = await prisma.domainEvent.findFirst({
        where: { name: 'payment_plan.broken_unpaid_rent', entityId: leaseId },
      })
      expect(event).not.toBeNull()

      await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    })

    it('leaves the plan standing when that rent is paid', async () => {
      // The dangerous direction. Breaking the plan of somebody who paid
      // everything asked of them is worse than the hole this closes.
      await lateFeeAtDay(5)
      const leaseId = await newLease(5000)
      const created = await createPaymentPlan(actor(managerId, 20), leaseId, {
        installments: [{ dueDate: d('2026-10-01'), amountCents: 5000 }],
        autoCollect: false,
      })
      if (!created.ok) throw new Error('setup failed')

      const rent = await invoice(leaseId, 12_900, { dueDate: d('2026-09-01') })
      // Named explicitly: unnamed, it would settle the older frozen arrears.
      await pay(leaseId, 12_900, { invoiceId: rent })

      await evaluatePaymentPlanBreaches(facilityId, d('2026-09-06'), recordItem)
      expect((await paymentPlanForLease(leaseId))?.status).toBe('active')
      expect(await leaseHasEffect(leaseId, 'halt_dunning')).toBe(true)

      await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
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
      // Past D-98's three days of grace — the view above is `missed` at +2,
      // and the BREAK is a separate window.
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 5 * day), recordItem)
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

      // Past D-98's three days of grace — the view above is `missed` at +2,
      // and the BREAK is a separate window.
      await evaluatePaymentPlanBreaches(facilityId, new Date(now.getTime() + 5 * day), recordItem)
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
