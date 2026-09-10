import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { reconcile } from '@storage/core/billing'
import { recordCounterPayment } from '../apps/web/lib/admin/pos'
import {
  leaseLedger,
  ledgerExceptions,
  ledgerExceptionsFor,
  raiseLedgerExceptionTasks,
  reconciliationInputs,
} from '../apps/web/lib/admin/ledger'
import { claimForLease } from '../apps/web/lib/notices/service'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-292 and B-277, against rows written by the real payment path.
//
// B-292 is why the first two cases exist: a payment's ledger entry names no
// invoice, so `reconcile` was handed that money twice — once by the invoice
// reading paid, once as uninvoiced — and every lease that had paid an invoice
// reported a discrepancy the size of the payment. Measured before the fix: all
// 25 such leases in `storage_test` failed, none passed. A fixture that wrote the
// payment entry WITH an invoice id (as `reports-financial-db` does) hid it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let unitTypeId = ''
let counter = 0
const tenantIds: string[] = []

function staff(permissions: PermissionKey[] = ['payments:take', 'tenants:view', 'reports:financial']): Actor {
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

/// A lease with a tenant of its own — a counter payment spreads across every
/// lease its tenant holds here, so sharing a tenant would couple the cases.
async function makeLease(label: string, tenantId?: string) {
  if (!tenantId) {
    const tenant = await prisma.tenant.create({
      data: { email: `lx-${label}-${suffix}@example.com`, firstName: 'Lex', lastName: label },
    })
    tenantIds.push(tenant.id)
    tenantId = tenant.id
  }
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `${label}-${suffix}` },
  })
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
  return { leaseId: lease.id, tenantId, unitNumber: unit.number }
}

async function openRent(leaseId: string, cents: number): Promise<string> {
  counter += 1
  // A distinct month per invoice: `invoice_one_rent_per_period` allows one rent
  // invoice per (lease, periodStart).
  const start = new Date(Date.UTC(2026, counter % 12, 1))
  const end = new Date(Date.UTC(2026, (counter % 12) + 1, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `LX${String(counter).padStart(4, '0')}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: end,
      subtotalCents: cents,
      totalCents: cents,
      lineItems: {
        create: { type: 'rent', description: 'Rent', unitAmountCents: cents, amountCents: cents },
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: cents,
      description: 'Rent',
      occurredAt: start,
      invoiceId: invoice.id,
    },
  })
  return invoice.id
}

async function payAtCounter(leaseId: string, tenantId: string, cents: number) {
  const result = await recordCounterPayment(staff(), {
    facilityId,
    tenantId,
    leaseId,
    method: 'cash',
    amountCents: cents,
    tenderedCents: cents,
  })
  expect(result.ok).toBe(true)
}

/// One month of rent, paid in full at the counter.
async function paidLease(label: string) {
  const lease = await makeLease(label)
  await openRent(lease.leaseId, 12_900)
  await payAtCounter(lease.leaseId, lease.tenantId, 12_900)
  return lease
}

/// Invoice marked paid with no payment behind it: the ledger still says $129
/// owed and the invoices say nothing is — US-27's own example.
async function skewedLease(label: string) {
  const lease = await makeLease(label)
  const invoiceId = await openRent(lease.leaseId, 12_900)
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidCents: 12_900, status: 'paid' },
  })
  return lease
}

describeDb('ledger reconciliation against the real payment path (B-292, B-277)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Ledger Exceptions ${suffix}`,
        slug: `ledger-exceptions-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staffUser = await prisma.staffUser.create({
      data: { email: `lx-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staffUser.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await prisma.$disconnect()
  })

  it('reconciles a lease whose invoice was paid at the counter', async () => {
    const { leaseId } = await paidLease('PAID')

    // Before B-292: +$129.00, "something was charged to the ledger without an
    // invoice behind it", on a lease that owes nothing.
    const ledger = await leaseLedger(staff(), leaseId)
    expect(ledger!.totals.balanceCents).toBe(0)
    expect(ledger!.reconciliation).toMatchObject({ reconciles: true, differenceCents: 0 })
  })

  it('does not refuse a lien notice for a month owed because an earlier month was paid', async () => {
    const { leaseId } = await paidLease('OWES')
    await openRent(leaseId, 12_900)

    // Before B-292 this was `ledger_does_not_reconcile` — the gate refused
    // every tenant who had ever paid an invoice through the product.
    const claim = await claimForLease(leaseId)
    expect(claim.ok).toBe(true)
    if (!claim.ok) throw new Error('unreachable')
    expect(claim.claim.totalCents).toBe(12_900)
  })

  it('still refuses the notice when the invoice was marked paid with nothing behind it', async () => {
    const { leaseId } = await skewedLease('GATE')
    await openRent(leaseId, 12_900)

    const claim = await claimForLease(leaseId)
    expect(claim.ok).toBe(false)
    if (claim.ok) throw new Error('unreachable')
    expect(claim.problem.kind).toBe('ledger_does_not_reconcile')
  })

  it('shows money that settled another lease’s invoice as that lease’s gap', async () => {
    // The shape every multi-unit payment left before B-257: both invoices
    // paid, the whole amount posted to one lease's ledger.
    const p = await makeLease('PRE-P')
    const q = await makeLease('PRE-Q', p.tenantId)
    const invoiceP = await openRent(p.leaseId, 10_000)
    const invoiceQ = await openRent(q.leaseId, 10_000)
    const payment = await prisma.payment.create({
      data: { facilityId, tenantId: p.tenantId, amountCents: 20_000, method: 'cash', status: 'succeeded' },
    })
    await prisma.paymentAllocation.createMany({
      data: [
        { paymentId: payment.id, invoiceId: invoiceP, amountCents: 10_000 },
        { paymentId: payment.id, invoiceId: invoiceQ, amountCents: 10_000 },
      ],
    })
    await prisma.invoice.updateMany({
      where: { id: { in: [invoiceP, invoiceQ] } },
      data: { amountPaidCents: 10_000, status: 'paid' },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: p.leaseId,
        type: 'payment',
        amountCents: -20_000,
        description: 'Payment',
        paymentId: payment.id,
      },
    })

    // Adding back every allocation of the payment, not just the ones on this
    // lease's invoices, would read Q as reconciled and P as −$100.
    const inputs = await reconciliationInputs({ leaseIds: [p.leaseId, q.leaseId] })
    expect(reconcile(inputs.get(q.leaseId)!)).toMatchObject({
      reconciles: false,
      differenceCents: 10_000,
    })
  })

  it('lists a skewed lease with its signed difference, and not a reconciled one', async () => {
    const paid = await paidLease('LIST-OK')
    const skewed = await skewedLease('LIST-SKEW')

    const exceptions = await ledgerExceptionsFor(staff())
    expect(exceptions.find((row) => row.leaseId === skewed.leaseId)).toMatchObject({
      facilityId,
      unitNumber: skewed.unitNumber,
      ledgerBalanceCents: 12_900,
      invoiceOutstandingCents: 0,
      reconciliation: { reconciles: false, differenceCents: 12_900 },
    })
    expect(exceptions.some((row) => row.leaseId === paid.leaseId)).toBe(false)
  })

  it('is scoped to the facilities the staffer holds reports:financial at', async () => {
    await skewedLease('SCOPE')
    const exceptions = await ledgerExceptionsFor(staff(['tenants:view']))
    expect(exceptions.some((row) => row.facilityId === facilityId)).toBe(false)
  })

  it('counts every exception in the hourly sweep and raises one task a day per facility', async () => {
    const paid = await paidLease('CRON-OK')
    await skewedLease('CRON-SKEW')
    const now = new Date()

    const listed = await ledgerExceptions([facilityId])
    expect(listed.some((row) => row.leaseId === paid.leaseId)).toBe(false)
    expect(await raiseLedgerExceptionTasks(now, [facilityId])).toBe(listed.length)
    await raiseLedgerExceptionTasks(now, [facilityId])

    const tasks = await prisma.task.findMany({
      where: { facilityId, type: 'ledger_does_not_reconcile' },
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ entityType: 'Facility', entityId: facilityId, priority: 'high' })
    expect(tasks[0].detail).toContain(`${listed.length} leases`)
  })
})
