import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { DEFAULT_LATE_FEE_STEPS } from '../packages/core/billing'
import { assessLateFees, waiveFeeInvoice } from '../apps/web/lib/billing/late-fees'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-047 / PRD 02 US-21. Assessment and waiver against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let invoiceCounter = 0
let staffId = ''

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

function actorWith(options: { permissions?: PermissionKey[]; maxFeeWaiverCents?: number | null; rank?: number }): Actor {
  return {
    kind: 'staff',
    // A real row: `audit_log.actorStaffId` is a foreign key, which is the point
    // — an audit entry attributed to a user who does not exist is not evidence.
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: options.rank ?? 20,
        permissions: new Set<PermissionKey>(options.permissions ?? ['fees:waive']),
        limits: {
          maxFeeWaiverCents: options.maxFeeWaiverCents === undefined ? 5_000 : options.maxFeeWaiverCents,
          maxRefundCents: 0,
          maxCreditCents: 0,
        },
      },
    ],
  }
}

async function seedSteps(): Promise<void> {
  for (const step of DEFAULT_LATE_FEE_STEPS) {
    await prisma.lateFeeRule.create({
      data: { facilityId, ...step, effectiveFrom: d('2020-01-01') },
    })
  }
}

async function rentInvoice(options: { dueDate: Date; totalCents?: number; paidCents?: number }) {
  invoiceCounter += 1
  const total = options.totalCents ?? 12_900
  return prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `LF${String(invoiceCounter).padStart(5, '0')}`,
      kind: 'rent',
      status: options.paidCents === total ? 'paid' : 'open',
      issueDate: options.dueDate,
      dueDate: options.dueDate,
      periodStart: options.dueDate,
      periodEnd: new Date(options.dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: total,
      totalCents: total,
      amountPaidCents: options.paidCents ?? 0,
    },
  })
}

describeDb('late fees', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Late Fee Test',
        slug: `latefee-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `latefee-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `latefee-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'F-1' } })
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
    collected.length = 0
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    // B-138's case opens a second lease pointing at this one, under RESTRICT —
    // after the invoices, which reference it under RESTRICT too.
    await prisma.lease.deleteMany({ where: { facilityId, transferredFromLeaseId: { not: null } } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { status: 'active' } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    await prisma.invoiceCounter.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // StaffUser stays: append-only audit_log rows reference it under RESTRICT,
    // which is what an audit trail is for.
    await prisma.$disconnect()
  })

  describe('assessment', () => {
    it('charges nothing before the threshold', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-04'), recordItem)
      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(0)
    })

    it('raises a fee invoice on the fifth day, greater of $20 or 10%', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })

      await assessLateFees(facilityId, d('2026-09-06'), recordItem)

      const fee = await prisma.invoice.findFirstOrThrow({
        where: { leaseId, kind: 'fee' },
        include: { lineItems: true },
      })
      // 10% of $129 is $12.90, so the $20 flat wins.
      expect(fee.totalCents).toBe(2_000)
      expect(fee.status).toBe('open')
      expect(fee.lineItems[0].description).toContain('step 1')
      // Due the day it is raised — a grace period on a late fee is a second
      // schedule nobody configured.
      expect(fee.dueDate.toISOString().slice(0, 10)).toBe('2026-09-06')
    })

    it('posts a ledger charge that agrees with the fee invoice', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)

      const ledger = await prisma.ledgerEntry.findFirstOrThrow({
        where: { leaseId, description: { contains: 'Late fee' } },
      })
      expect(ledger.type).toBe('charge')
      expect(ledger.amountCents).toBe(2_000)
    })

    it('does not charge the same step twice on later nights', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })

      await assessLateFees(facilityId, d('2026-09-06'), recordItem)
      await assessLateFees(facilityId, d('2026-09-07'), recordItem)
      await assessLateFees(facilityId, d('2026-09-08'), recordItem)

      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(1)
    })

    // B-138 / D-86. The arrears move onto the lease a transfer opens, so the
    // tenant arrives with the full age. A PAID fee invoice does not move — it is
    // settled history and belongs where it was raised — so without reading the
    // ladder's position along the chain, step 1 is charged all over again.
    it('does not re-charge a step already charged before a transfer', async () => {
      await seedSteps()
      const rent = await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)
      const first = await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })
      expect(first).toHaveLength(1)
      // Settled at the counter, so it stays on the old lease when the tenant
      // moves — which is the whole trap.
      await prisma.invoice.update({
        where: { id: first[0].id },
        data: { amountPaidCents: first[0].totalCents, status: 'paid' },
      })

      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `LF2-${suffix.slice(0, 4)}` },
      })
      const moved = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'delinquent',
          startDate: d('2026-09-07'),
          billingDay: 1,
          monthlyRateCents: 12_900,
          transferredFromLeaseId: leaseId,
        },
      })
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      await prisma.invoice.update({ where: { id: rent.id }, data: { leaseId: moved.id } })

      await assessLateFees(facilityId, d('2026-09-08'), recordItem)

      // Nothing new: step 1 was already charged, on the lease they came from.
      expect(await prisma.invoice.count({ where: { leaseId: moved.id, kind: 'fee' } })).toBe(0)
    })

    // B-161. A returned ACH or a chargeback re-opens the rent invoice at its
    // ORIGINAL due date (D-25), so the lease is instantly back at full age. The
    // fee invoices it already paid are NOT voided by a reversal, and the ladder
    // reads its position from them — so the steps already billed stay billed.
    it('does not re-charge a step after a payment is returned', async () => {
      await seedSteps()
      const rent = await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)
      const fees = await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })
      expect(fees).toHaveLength(1)

      // Paid at the counter, then the bank takes it back: `recomputeInvoices`
      // puts the rent invoice back to open at the same due date.
      await prisma.invoice.update({
        where: { id: fees[0].id },
        data: { amountPaidCents: fees[0].totalCents, status: 'paid' },
      })
      await prisma.invoice.update({
        where: { id: rent.id },
        data: { amountPaidCents: 0, status: 'open' },
      })

      await assessLateFees(facilityId, d('2026-09-20'), recordItem)

      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(1)
    })

    it('is idempotent on a re-run of the same night', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })

      await assessLateFees(facilityId, d('2026-09-06'), recordItem)
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)

      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(1)
    })

    it('charges both steps on one invoice when a lease aged past both while nothing ran', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })

      await assessLateFees(facilityId, d('2026-10-16'), recordItem)

      const fee = await prisma.invoice.findFirstOrThrow({
        where: { leaseId, kind: 'fee' },
        include: { lineItems: true },
      })
      expect(fee.lineItems).toHaveLength(2)
      // First fee then second, in the order it would have happened.
      expect(fee.lineItems.map((line) => line.description)).toEqual([
        expect.stringContaining('step 1'),
        expect.stringContaining('step 2'),
      ])
      expect(fee.totalCents).toBe(4_000)
    })

    it('never charges a fee on a fee', async () => {
      // The compounding guard. A fee invoice left unpaid must not itself age
      // and earn more fees.
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)

      // Settle the RENT invoice; the fee invoice stays open and ages.
      await prisma.invoice.updateMany({
        where: { leaseId, kind: 'rent' },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })
      await assessLateFees(facilityId, d('2026-11-01'), recordItem)

      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(1)
    })

    it('charges nothing once the rent is paid', async () => {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01'), paidCents: 12_900 })
      await assessLateFees(facilityId, d('2026-09-30'), recordItem)
      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(0)
    })

    it('charges nothing when the facility has configured no ladder', async () => {
      // No rules is a real operator choice, not a reason to fall back to a
      // default nobody agreed to.
      await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-30'), recordItem)
      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(0)
    })

    it('uses the rule in force on the business date being run', async () => {
      // A catch-up run for last month must charge last month's fee (FR-9).
      await prisma.lateFeeRule.create({
        data: {
          facilityId,
          step: 1,
          daysPastDue: 5,
          amountCents: 1_000,
          percentBasisPoints: 0,
          basis: 'flat',
          capCents: null,
          effectiveFrom: d('2020-01-01'),
        },
      })
      await prisma.lateFeeRule.create({
        data: {
          facilityId,
          step: 1,
          daysPastDue: 5,
          amountCents: 3_000,
          percentBasisPoints: 0,
          basis: 'flat',
          capCents: null,
          effectiveFrom: d('2026-10-01'),
        },
      })
      await rentInvoice({ dueDate: d('2026-09-01') })

      await assessLateFees(facilityId, d('2026-09-06'), recordItem)

      const fee = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'fee' } })
      expect(fee.totalCents).toBe(1_000)
    })
  })

  describe('waiving', () => {
    async function raiseFee(): Promise<string> {
      await seedSteps()
      await rentInvoice({ dueDate: d('2026-09-01') })
      await assessLateFees(facilityId, d('2026-09-06'), recordItem)
      const fee = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'fee' } })
      return fee.id
    }

    it('voids the invoice and posts a credit, leaving both visible', async () => {
      const feeId = await raiseFee()

      const result = await waiveFeeInvoice(actorWith({}), feeId, {
        reasonCode: 'customer_goodwill',
        note: 'Long-standing tenant, first miss.',
      })
      expect(result).toEqual({ ok: true, amountCents: 2_000 })

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: feeId } })
      // `void`, not `paid` — nobody paid it, and the revenue report has to be
      // able to tell forgiven money from collected money.
      expect(invoice.status).toBe('void')

      const credit = await prisma.ledgerEntry.findFirstOrThrow({
        where: { invoiceId: feeId, type: 'credit' },
      })
      expect(credit.amountCents).toBe(-2_000)

      // The charge is still there next to it.
      expect(await prisma.ledgerEntry.count({ where: { invoiceId: feeId } })).toBe(2)
    })

    it('audits the waiver with its reason code', async () => {
      const feeId = await raiseFee()
      await waiveFeeInvoice(actorWith({}), feeId, { reasonCode: 'billing_error' })

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'fee.waived', entityId: feeId },
      })
      expect(audit.reasonCode).toBe('billing_error')
      expect(audit.actorType).toBe('staff')
    })

    it('refuses without a reason code', async () => {
      const feeId = await raiseFee()
      const result = await waiveFeeInvoice(actorWith({}), feeId, { reasonCode: '  ' })
      expect(result).toMatchObject({ ok: false, reason: 'missing_reason' })

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: feeId } })
      expect(invoice.status).toBe('open')
    })

    it('refuses a staffer without the waive permission', async () => {
      const feeId = await raiseFee()
      const result = await waiveFeeInvoice(
        actorWith({ permissions: ['tenants:view'] }),
        feeId,
        { reasonCode: 'customer_goodwill' },
      )
      expect(result).toMatchObject({ ok: false, reason: 'forbidden' })
    })

    it('refuses an amount over the actor’s limit, and says who can approve it', async () => {
      // RBAC-2: over-limit routes to the next role up rather than simply
      // failing.
      const feeId = await raiseFee()
      const result = await waiveFeeInvoice(
        actorWith({ maxFeeWaiverCents: 500 }),
        feeId,
        { reasonCode: 'customer_goodwill' },
      )
      expect(result).toMatchObject({ ok: false, reason: 'over_limit', limitCents: 500 })

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: feeId } })
      expect(invoice.status).toBe('open')
    })

    it('allows an unlimited actor', async () => {
      const feeId = await raiseFee()
      const result = await waiveFeeInvoice(
        actorWith({ maxFeeWaiverCents: null }),
        feeId,
        { reasonCode: 'management_approval' },
      )
      expect(result).toMatchObject({ ok: true })
    })

    it('refuses to waive a fee that has already been waived', async () => {
      const feeId = await raiseFee()
      await waiveFeeInvoice(actorWith({}), feeId, { reasonCode: 'customer_goodwill' })
      const second = await waiveFeeInvoice(actorWith({}), feeId, { reasonCode: 'customer_goodwill' })
      expect(second).toMatchObject({ ok: false, reason: 'already_settled' })
    })

    it('refuses to waive a rent invoice — that is a credit, not a fee waiver', async () => {
      await seedSteps()
      const rent = await rentInvoice({ dueDate: d('2026-09-01') })
      const result = await waiveFeeInvoice(actorWith({}), rent.id, { reasonCode: 'customer_goodwill' })
      expect(result).toMatchObject({ ok: false, reason: 'not_found' })
    })
  })
})
