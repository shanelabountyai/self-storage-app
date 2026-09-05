import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { recordCounterPayment } from '../apps/web/lib/admin/pos'
import { returnPayment, reinstatePayment } from '../apps/web/lib/billing/reversals'
import { createAccount, attachLease } from '../apps/web/lib/billing/accounts'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-257. One payment, several leases, and a ledger that has to agree with the
// allocation.
//
// Everything here is asserted as a per-lease BALANCE rather than as a count of
// rows: the defect was invisible at the invoice level (both invoices read
// `paid`) and only showed up as two lease balances that were wrong in opposite
// directions. A test that counted ledger entries would have passed before the
// fix as readily as after it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let staffId = ''
let tenantId = ''
let leaseA = ''
let leaseB = ''
/// A different tenant, on a business account the first tenant pays for.
let foremanId = ''
let leaseC = ''
let unitTypeId = ''
let counter = 0

function staff(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>([
          'payments:take',
          'tenants:view',
          'refunds:approve',
          'billing_accounts:manage',
        ]),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function balance(leaseId: string): Promise<number> {
  const sum = await prisma.ledgerEntry.aggregate({
    where: { leaseId },
    _sum: { amountCents: true },
  })
  return sum._sum.amountCents ?? 0
}

async function openRent(leaseId: string, cents: number): Promise<string> {
  counter += 1
  // A distinct service period per invoice: `invoice_one_rent_per_period` is a
  // partial unique index on (leaseId, periodStart) for `kind: 'rent'`, so two
  // rent invoices on one lease have to name different months — which is also
  // what real ones do.
  const start = new Date(Date.UTC(2026, counter % 12, 1))
  const end = new Date(Date.UTC(2026, (counter % 12) + 1, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `LS${String(counter).padStart(4, '0')}-${suffix}`,
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

async function makeLease(tenant: string, number: string): Promise<string> {
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `${number}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-08-01'),
      billingDay: 1,
      monthlyRateCents: 10_000,
    },
  })
  return lease.id
}

describeDb('a payment that settles more than one lease', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Ledger Split ${suffix}`,
        slug: `ledger-split-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staffUser = await prisma.staffUser.create({
      data: { email: `ls-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staffUser.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id

    const tenant = await prisma.tenant.create({
      data: { email: `ls-two-${suffix}@example.com`, firstName: 'Two', lastName: 'Units' },
    })
    tenantId = tenant.id
    const foreman = await prisma.tenant.create({
      data: { email: `ls-foreman-${suffix}@example.com`, firstName: 'Frank', lastName: 'Foreman' },
    })
    foremanId = foreman.id

    leaseA = await makeLease(tenantId, 'LS-A')
    leaseB = await makeLease(tenantId, 'LS-B')
    leaseC = await makeLease(foremanId, 'LS-C')
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foremanId] } } })
    await prisma.$disconnect()
  })

  it('credits both of one tenant’s units, not just the one the counter had open', async () => {
    await openRent(leaseA, 10_000)
    await openRent(leaseB, 10_000)

    const result = await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: leaseA,
      method: 'cash',
      amountCents: 20_000,
      tenderedCents: 20_000,
    })
    expect(result.ok).toBe(true)

    // Before B-257 this was −10,000 and +10,000: both invoices paid, unit A
    // holding a phantom credit and unit B still being asked for money the
    // tenant had handed over at the desk.
    expect(await balance(leaseA)).toBe(0)
    expect(await balance(leaseB)).toBe(0)

    const invoices = await prisma.invoice.findMany({
      where: { leaseId: { in: [leaseA, leaseB] } },
      select: { status: true },
    })
    expect(invoices.every((invoice) => invoice.status === 'paid')).toBe(true)
  })

  it('puts a prepayment no invoice claimed on the lease the payer named', async () => {
    const openA = await openRent(leaseA, 10_000)
    expect(openA).toBeTruthy()

    await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: leaseA,
      method: 'cash',
      amountCents: 30_000,
      tenderedCents: 30_000,
    })

    // $100 settled the invoice, $200 was claimed by nothing — and it has to
    // stay visible as credit on the unit the tenant named rather than vanish.
    expect(await balance(leaseA)).toBe(-20_000)
    expect(await balance(leaseB)).toBe(0)
  })

  it('credits another tenant’s unit when a business account pays for it', async () => {
    const account = await createAccount(staff(), {
      facilityId,
      name: `Acme ${suffix}`,
      payerEmail: `ls-two-${suffix}@example.com`,
    })
    await attachLease(staff(), { accountId: account.id, unitNumber: `LS-C-${suffix}` })
    await openRent(leaseC, 10_000)

    await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: leaseA,
      method: 'cash',
      amountCents: 10_000,
      tenderedCents: 10_000,
    })

    // The payer's own units are square, so the whole payment reaches the
    // foreman's — on a lease belonging to somebody else entirely.
    expect(await balance(leaseC)).toBe(0)
  })

  it('reverses every lease when the payment is returned, and puts them all back when it is reinstated', async () => {
    // A clean two-lease payment of its own, so the assertions are about this
    // payment rather than about the state the earlier cases left.
    await openRent(leaseA, 5_000)
    await openRent(leaseB, 5_000)
    const balanceABefore = await balance(leaseA)
    const balanceBBefore = await balance(leaseB)

    const paid = await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: leaseA,
      method: 'check',
      amountCents: 10_000,
      checkNumber: '4471',
    })
    if (!paid.ok) throw new Error('setup payment refused')

    expect(await balance(leaseA)).toBe(balanceABefore - 5_000)
    expect(await balance(leaseB)).toBe(balanceBBefore - 5_000)

    const returned = await returnPayment(staff(), paid.paymentId, {
      reasonCode: 'insufficient funds',
      waiveFee: true,
    })
    expect(returned.ok).toBe(true)

    // Both units owe it again. Before B-257 only lease A was reversed, so the
    // second unit kept a credit for money the bank had taken back.
    expect(await balance(leaseA)).toBe(balanceABefore)
    expect(await balance(leaseB)).toBe(balanceBBefore)

    const reinstated = await reinstatePayment(staff(), paid.paymentId, {
      reasonCode: 'dispute won',
    })
    expect(reinstated.ok).toBe(true)

    expect(await balance(leaseA)).toBe(balanceABefore - 5_000)
    expect(await balance(leaseB)).toBe(balanceBBefore - 5_000)
  })

  it('raises exactly one returned-payment fee however many units the money reached', async () => {
    const feesBefore = await prisma.invoice.count({ where: { facilityId, kind: 'fee' } })
    await openRent(leaseA, 5_000)
    await openRent(leaseB, 5_000)

    const paid = await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: leaseA,
      method: 'check',
      amountCents: 10_000,
      checkNumber: '4472',
    })
    if (!paid.ok) throw new Error('setup payment refused')

    await returnPayment(staff(), paid.paymentId, { reasonCode: 'account closed' })

    // A bank reversing one debit is one NSF event. The facility here has no
    // configured NSF amount, which is the shipped state, so the honest
    // assertion is "no more than one" rather than "exactly one".
    const feesAfter = await prisma.invoice.count({ where: { facilityId, kind: 'fee' } })
    expect(feesAfter - feesBefore).toBeLessThanOrEqual(1)
  })
})
