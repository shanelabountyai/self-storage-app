import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { DEFAULT_LATE_FEE_STEPS } from '../packages/core/billing'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import {
  applyCreditByStaff,
  applyCreditToInvoice,
  creditCentsFor,
} from '../apps/web/lib/billing/credit'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-225 / PRD 02 US-22, US-24. Money paid ahead, against real rows.
//
// The defect this file exists for, in one sentence: a tenant hands the counter
// $600 in December for six months, $150 settles the open invoice, and the other
// $450 was visible to the revenue report and to nothing that decides what a
// tenant owes.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

function actorWith(permissions: PermissionKey[]): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function rentInvoice(options: { dueDate: Date; totalCents: number }) {
  invoiceCounter += 1
  return prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `CR${String(invoiceCounter).padStart(5, '0')}`,
      kind: 'rent',
      status: 'open',
      issueDate: options.dueDate,
      dueDate: options.dueDate,
      periodStart: options.dueDate,
      periodEnd: new Date(options.dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: options.totalCents,
      totalCents: options.totalCents,
      amountPaidCents: 0,
    },
  })
}

/// A counter payment that settled nothing — the $600 in the scenario, before
/// any invoice claims it.
async function counterPayment(amountCents: number) {
  return prisma.payment.create({
    data: { facilityId, tenantId, amountCents, method: 'cash', status: 'succeeded' },
  })
}

describeDb('credit on account', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Credit Test',
        slug: `credit-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `credit-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `credit-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'C-1' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-08-01'),
        billingDay: 1,
        monthlyRateCents: 15_000,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    await prisma.invoiceCounter.deleteMany({ where: { facilityId } })
  })

  it('reports money the tenant handed over that no invoice has claimed', async () => {
    await counterPayment(60_000)
    expect(await creditCentsFor(tenantId, facilityId)).toBe(60_000)
  })

  it('spends credit on an invoice, up to what that invoice owes', async () => {
    await counterPayment(60_000)
    const invoice = await rentInvoice({ dueDate: d('2027-01-01'), totalCents: 15_000 })

    const applied = await prisma.$transaction((tx) =>
      applyCreditToInvoice(tx, { tenantId, facilityId, invoiceId: invoice.id }),
    )

    // Capped by the invoice, not by the credit: $450 stays on account for the
    // months after this one, which is the whole point of paying six up front.
    expect(applied).toBe(15_000)
    const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(settled.amountPaidCents).toBe(15_000)
    expect(await creditCentsFor(tenantId, facilityId)).toBe(45_000)
  })

  it('is idempotent — a second sweep of a settled invoice takes nothing more', async () => {
    // The nightly jobs are re-runnable and catch-up-safe by design, and this is
    // reached from two of them. A second pass must not consume the remaining
    // credit against an invoice that is already paid.
    await counterPayment(60_000)
    const invoice = await rentInvoice({ dueDate: d('2027-01-01'), totalCents: 15_000 })
    const run = () =>
      prisma.$transaction((tx) =>
        applyCreditToInvoice(tx, { tenantId, facilityId, invoiceId: invoice.id }),
      )

    expect(await run()).toBe(15_000)
    expect(await run()).toBe(0)
    expect(await creditCentsFor(tenantId, facilityId)).toBe(45_000)
  })

  it('does not charge a late fee on rent the tenant has already covered', async () => {
    // THE defect. Before this row: invoice issued at full value, credit
    // invisible, ladder fires, card charged again — a chargeback produced by
    // the tenant's own money.
    for (const step of DEFAULT_LATE_FEE_STEPS) {
      await prisma.lateFeeRule.create({
        data: { facilityId, ...step, effectiveFrom: d('2020-01-01') },
      })
    }
    await counterPayment(60_000)
    await rentInvoice({ dueDate: d('2027-01-01'), totalCents: 15_000 })

    await assessLateFees(facilityId, d('2027-01-20'), recordItem)

    expect(await prisma.invoice.count({ where: { facilityId, kind: 'fee' } })).toBe(0)
    expect(collected.map((one) => one.message)).toContain(
      'late fee skipped — credit on account covers what is overdue',
    )
  })

  it('sizes a fee on what credit does NOT cover', async () => {
    // The half a "skip when fully covered" guard would miss: a percentage step
    // charged on the gross bills a tenant for rent they have already handed
    // over.
    //
    // A PERCENTAGE ladder on purpose, not `DEFAULT_LATE_FEE_STEPS`. The default
    // step is `basis: 'greater'` of a $20 flat and 10% — so on a $150 invoice
    // the flat wins at $20 whether credit is netted or not, and the first
    // version of this test asserted a number that could not move. It passed
    // with the fix reverted, which is the only reason it was caught.
    await prisma.lateFeeRule.create({
      data: {
        facilityId,
        step: 1,
        daysPastDue: 5,
        amountCents: 0,
        percentBasisPoints: 1_000,
        basis: 'percent',
        capCents: 50_000,
        effectiveFrom: d('2020-01-01'),
      },
    })
    await counterPayment(10_000)
    await rentInvoice({ dueDate: d('2027-01-01'), totalCents: 15_000 })

    await assessLateFees(facilityId, d('2027-01-20'), recordItem)

    const fees = await prisma.invoice.findMany({ where: { facilityId, kind: 'fee' } })
    // 10% of the $50 still owed, not 10% of the $150 invoiced.
    expect(fees.reduce((sum, fee) => sum + fee.totalCents, 0)).toBe(500)
  })

  it('lets a counter staffer direct credit at a named invoice', async () => {
    await counterPayment(60_000)
    const invoice = await rentInvoice({ dueDate: d('2027-02-01'), totalCents: 15_000 })

    const result = await applyCreditByStaff(actorWith(['payments:take']), {
      invoiceId: invoice.id,
    })

    expect(result).toEqual({ ok: true, appliedCents: 15_000 })
    const audit = await prisma.auditLog.findFirst({
      where: { facilityId, action: 'credit.applied', entityId: invoice.id },
    })
    // Audited even though no money moved: what changed is which debt the
    // tenant's money settled, and that is what somebody reconstructs at a
    // counter six months later.
    expect(audit).not.toBeNull()
  })

  it('refuses a staffer without permission to take payments', async () => {
    await counterPayment(60_000)
    const invoice = await rentInvoice({ dueDate: d('2027-02-01'), totalCents: 15_000 })

    expect(await applyCreditByStaff(actorWith(['tenants:view']), { invoiceId: invoice.id })).toEqual(
      { ok: false, reason: 'forbidden' },
    )
    const untouched = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(untouched.amountPaidCents).toBe(0)
  })
})
