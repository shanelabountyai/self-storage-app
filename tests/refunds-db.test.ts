import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyPayment } from '../apps/web/lib/billing/allocation'
import { refundPayment, refundablePayments } from '../apps/web/lib/billing/refunds'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-048 / PRD 02 US-22, US-23. Allocation and refunds against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let staffId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function actorWith(options: { permissions?: string[]; maxRefundCents?: number | null } = {}): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(options.permissions ?? ['refunds:approve']),
        limits: {
          maxFeeWaiverCents: 0,
          maxRefundCents: options.maxRefundCents === undefined ? 50_000 : options.maxRefundCents,
          maxCreditCents: 0,
        },
      },
    ],
  }
}

async function invoice(options: {
  kind?: 'rent' | 'fee'
  dueDate: Date
  lines: { type: 'rent' | 'tax' | 'fee' | 'protection'; amountCents: number }[]
}): Promise<string> {
  invoiceCounter += 1
  const total = options.lines.reduce((sum, line) => sum + line.amountCents, 0)
  const row = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `RF${String(invoiceCounter).padStart(5, '0')}`,
      kind: options.kind ?? 'rent',
      status: 'open',
      issueDate: options.dueDate,
      dueDate: options.dueDate,
      periodStart: options.dueDate,
      periodEnd: new Date(options.dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: total,
      totalCents: total,
      lineItems: {
        create: options.lines.map((line) => ({
          type: line.type,
          description: line.type,
          quantity: 1,
          unitAmountCents: line.amountCents,
          amountCents: line.amountCents,
        })),
      },
    },
  })
  return row.id
}

async function succeededPayment(amountCents: number): Promise<string> {
  const payment = await prisma.payment.create({
    data: { facilityId, tenantId, amountCents, method: 'card', status: 'succeeded' },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'payment',
      amountCents: -amountCents,
      description: 'Payment',
      paymentId: payment.id,
    },
  })
  await prisma.$transaction(async (tx) => {
    await applyPayment(tx, { id: payment.id, tenantId, facilityId, amountCents })
  })
  return payment.id
}

describeDb('partial payments and refunds', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Refund Test',
        slug: `refund-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `refund-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `refund-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'R-1' } })
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
    leaseId = lease.id
  })

  afterEach(async () => {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId, refundOfPaymentId: { not: null } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { paymentAllocationOrder: ['tax', 'fee', 'protection', 'rent'] },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('allocation', () => {
    it('splits a partial payment across categories in the configured order', async () => {
      await invoice({
        dueDate: d('2026-09-01'),
        lines: [
          { type: 'rent', amountCents: 12_900 },
          { type: 'tax', amountCents: 806 },
        ],
      })

      const paymentId = await succeededPayment(2_000)

      const allocation = await prisma.paymentAllocation.findFirstOrThrow({ where: { paymentId } })
      expect(allocation.amountCents).toBe(2_000)
      const settled = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
      expect(settled.amountPaidCents).toBe(2_000)
      expect(settled.status).toBe('partially_paid')
    })

    it('clears an older invoice before a newer one', async () => {
      const older = await invoice({ dueDate: d('2026-08-01'), lines: [{ type: 'rent', amountCents: 5_000 }] })
      const newer = await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 5_000 }] })

      await succeededPayment(5_000)

      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: older } })).status).toBe('paid')
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: newer } })).status).toBe('open')
    })

    it('clears a fee invoice before rent under the default order', async () => {
      const rent = await invoice({ dueDate: d('2026-08-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const fee = await invoice({
        kind: 'fee',
        dueDate: d('2026-09-01'),
        lines: [{ type: 'fee', amountCents: 2_000 }],
      })

      await succeededPayment(2_000)

      // Fee before rent even though the rent invoice is older — the category
      // order outranks the date, which is what US-22 asks for.
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: fee } })).status).toBe('paid')
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: rent } })).status).toBe('open')
    })

    it('honours a facility that puts rent first', async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { paymentAllocationOrder: ['rent', 'fee', 'protection', 'tax'] },
      })
      const rent = await invoice({ dueDate: d('2026-08-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      await invoice({ kind: 'fee', dueDate: d('2026-09-01'), lines: [{ type: 'fee', amountCents: 2_000 }] })

      await succeededPayment(2_000)

      const rentInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: rent } })
      expect(rentInvoice.amountPaidCents).toBe(2_000)
    })

    it('is idempotent — reapplying the same payment does not double the paid total', async () => {
      await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(5_000)

      await prisma.$transaction(async (tx) => {
        await applyPayment(tx, { id: paymentId, tenantId, facilityId, amountCents: 5_000 })
      })

      const settled = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
      expect(settled.amountPaidCents).toBe(5_000)
      expect(await prisma.paymentAllocation.count({ where: { paymentId } })).toBe(1)
    })

    it('never resurrects a waived fee', async () => {
      // A voided invoice is money a manager deliberately forgave (B-047).
      const fee = await invoice({
        kind: 'fee',
        dueDate: d('2026-09-01'),
        lines: [{ type: 'fee', amountCents: 2_000 }],
      })
      await prisma.invoice.update({ where: { id: fee }, data: { status: 'void' } })

      await succeededPayment(2_000)

      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: fee } })).status).toBe('void')
    })
  })

  describe('refunds', () => {
    it('records a cash refund as a payable, not as money already gone', async () => {
      await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(12_900)

      const result = await refundPayment(actorWith(), paymentId, {
        amountCents: 5_000,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })
      expect(result).toMatchObject({ ok: true, method: 'cash' })
      if (!result.ok) throw new Error('unreachable')

      const refund = await prisma.payment.findUniqueOrThrow({ where: { id: result.refundPaymentId } })
      // Pending, because nobody has handed the cash over yet. Marking it
      // succeeded would put a refund in the books that has not happened.
      expect(refund.status).toBe('pending')
      expect(refund.refundOfPaymentId).toBe(paymentId)

      const original = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
      expect(original.status).toBe('partially_refunded')
    })

    it('posts a refund to the ledger that increases what is owed', async () => {
      await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(12_900)
      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })

      const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { leaseId, type: 'refund' } })
      // The money went back, so the tenant owes it again.
      expect(entry.amountCents).toBe(12_900)
    })

    it('unwinds the allocation so the invoice stops reading as paid', async () => {
      // The bug this prevents: an invoice left `paid` on money that went back
      // is uncollected forever and invisible to every ageing report.
      const invoiceId = await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(12_900)
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('paid')

      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      expect(after.status).toBe('open')
      expect(after.amountPaidCents).toBe(0)
    })

    it('partially unwinds a partial refund', async () => {
      const invoiceId = await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(12_900)

      await refundPayment(actorWith(), paymentId, {
        amountCents: 4_000,
        reasonCode: 'customer_goodwill',
        asMethod: 'cash',
      })

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      expect(after.amountPaidCents).toBe(8_900)
      expect(after.status).toBe('partially_paid')
    })

    it('audits the refund with its reason, and flags a changed method', async () => {
      // Refunding a card payment in cash is the shape an internal fraud takes;
      // the log says it happened rather than leaving it to be inferred.
      await invoice({ dueDate: d('2026-09-01'), lines: [{ type: 'rent', amountCents: 12_900 }] })
      const paymentId = await succeededPayment(12_900)
      await refundPayment(actorWith(), paymentId, {
        amountCents: 1_000,
        reasonCode: 'customer_goodwill',
        asMethod: 'cash',
      })

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'refund.issued', entityId: paymentId },
      })
      expect(audit.reasonCode).toBe('customer_goodwill')
      expect((audit.after as { methodChanged: boolean }).methodChanged).toBe(true)
    })

    it('refuses without a reason code', async () => {
      const paymentId = await succeededPayment(12_900)
      expect(
        await refundPayment(actorWith(), paymentId, { amountCents: 100, reasonCode: ' ', asMethod: 'cash' }),
      ).toMatchObject({ ok: false, reason: 'missing_reason' })
    })

    it('refuses a staffer without the permission', async () => {
      const paymentId = await succeededPayment(12_900)
      expect(
        await refundPayment(actorWith({ permissions: ['tenants:view'] }), paymentId, {
          amountCents: 100,
          reasonCode: 'billing_error',
          asMethod: 'cash',
        }),
      ).toMatchObject({ ok: false, reason: 'forbidden' })
    })

    it('refuses over the actor’s limit and names it', async () => {
      const paymentId = await succeededPayment(12_900)
      expect(
        await refundPayment(actorWith({ maxRefundCents: 500 }), paymentId, {
          amountCents: 10_000,
          reasonCode: 'billing_error',
          asMethod: 'cash',
        }),
      ).toMatchObject({ ok: false, reason: 'over_limit', limitCents: 500 })
    })

    it('refuses more than was paid, across several refunds', async () => {
      const paymentId = await succeededPayment(12_900)
      await refundPayment(actorWith(), paymentId, {
        amountCents: 10_000,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })
      expect(
        await refundPayment(actorWith(), paymentId, {
          amountCents: 5_000,
          reasonCode: 'billing_error',
          asMethod: 'cash',
        }),
      ).toMatchObject({ ok: false, reason: 'over_original' })
    })

    it('refuses to refund a payment that never succeeded', async () => {
      const failed = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents: 5_000, method: 'card', status: 'failed' },
      })
      expect(
        await refundPayment(actorWith(), failed.id, {
          amountCents: 100,
          reasonCode: 'billing_error',
          asMethod: 'cash',
        }),
      ).toMatchObject({ ok: false, reason: 'not_refundable' })
    })

    it('marks the original fully refunded once nothing is left', async () => {
      const paymentId = await succeededPayment(12_900)
      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('refunded')
    })

    it('lists what is still refundable, and never a refund itself', async () => {
      const paymentId = await succeededPayment(12_900)
      await refundPayment(actorWith(), paymentId, {
        amountCents: 4_000,
        reasonCode: 'billing_error',
        asMethod: 'cash',
      })

      const rows = await refundablePayments(tenantId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ paymentId, refundedCents: 4_000, refundableCents: 8_900 })
    })
  })
})
