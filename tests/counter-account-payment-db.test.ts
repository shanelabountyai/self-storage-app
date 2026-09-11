import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { counterPayableAccounts, recordCounterPayment } from '../apps/web/lib/admin/pos'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-280. A business account's check taken at the counter.
//
// The defect: `recordCounterPayment` looked the lease up as the SELECTED
// tenant's, so a payer holding no lease of their own — the ordinary shape of an
// account — was refused outright, and the workaround (key the check against one
// employee's unit) made the employee the payer and banked the rest as
// prepayment on that one unit.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let staffId = ''
let payerId = ''
let edId = ''
let fayId = ''
let leaseE = ''
let leaseF = ''
let accountId = ''
let otherAccountId = ''
let counter = 0

function staff(permissions: PermissionKey[] = ['payments:take', 'tenants:view']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function balance(leaseId: string): Promise<number> {
  const sum = await prisma.ledgerEntry.aggregate({ where: { leaseId }, _sum: { amountCents: true } })
  return sum._sum.amountCents ?? 0
}

/// Each call is a month later than the last, so the FIRST invoice opened is the
/// oldest debt.
async function openRent(leaseId: string, cents: number): Promise<string> {
  counter += 1
  const start = new Date(Date.UTC(2026, counter, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `CA${counter}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: new Date(Date.UTC(2026, counter + 1, 1)),
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

async function makeFacility(slug: string) {
  return prisma.facility.create({
    data: {
      name: `Counter Account ${slug} ${suffix}`,
      slug: `counter-account-${slug}-${suffix}`,
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
  })
}

describeDb('a business account paying at the counter', () => {
  beforeAll(async () => {
    facilityId = (await makeFacility('a')).id
    otherFacilityId = (await makeFacility('b')).id
    staffId = (
      await prisma.staffUser.create({
        data: { email: `ca-staff-${suffix}@example.com`, firstName: 'Cam', lastName: 'Counter' },
      })
    ).id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    async function tenant(name: string) {
      return (
        await prisma.tenant.create({
          data: { email: `ca-${name}-${suffix}@example.com`, firstName: name, lastName: 'Fixture' },
        })
      ).id
    }
    payerId = await tenant('payer')
    edId = await tenant('ed')
    fayId = await tenant('fay')

    async function lease(tenantId: string, number: string) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `${number}-${suffix}` },
      })
      return (
        await prisma.lease.create({
          data: {
            facilityId,
            tenantId,
            unitId: unit.id,
            status: 'active',
            startDate: new Date('2026-01-01T00:00:00Z'),
            billingDay: 1,
            monthlyRateCents: 10_000,
          },
        })
      ).id
    }
    leaseE = await lease(edId, 'CA-E')
    leaseF = await lease(fayId, 'CA-F')

    // The payer holds NO lease — the shape the counter used to refuse.
    accountId = (
      await prisma.billingAccount.create({
        data: { facilityId, name: `Acme Crews ${suffix}`, payerTenantId: payerId },
      })
    ).id
    await prisma.lease.updateMany({
      where: { id: { in: [leaseE, leaseF] } },
      data: { billingAccountId: accountId },
    })
    otherAccountId = (
      await prisma.billingAccount.create({
        data: { facilityId: otherFacilityId, name: `Elsewhere ${suffix}`, payerTenantId: payerId },
      })
    ).id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    await prisma.billingAccount.deleteMany({ where: { id: { in: [accountId, otherAccountId] } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [payerId, edId, fayId] } } })
    await prisma.$disconnect()
  })

  it('posts one check as the payer, oldest invoice first across the account’s units', async () => {
    const older = await openRent(leaseF, 10_000)
    const newer = await openRent(leaseE, 10_000)

    // `payments:take` alone: taking the money needs nothing D-110 did not give it.
    const result = await recordCounterPayment(staff(['payments:take']), {
      facilityId,
      tenantId: edId,
      leaseId: '',
      accountId,
      method: 'check',
      checkNumber: '1042',
      amountCents: 15_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unappliedCents).toBe(0)

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: result.paymentId },
      select: { tenantId: true, allocations: { select: { invoiceId: true, amountCents: true } } },
    })
    expect(payment.tenantId).toBe(payerId)
    expect(new Map(payment.allocations.map((a) => [a.invoiceId, a.amountCents]))).toEqual(
      new Map([
        [older, 10_000],
        [newer, 5_000],
      ]),
    )
    expect(await balance(leaseF)).toBe(0)
    expect(await balance(leaseE)).toBe(5_000)
  })

  it('refuses the account’s check keyed against one employee’s unit, rather than banking the rest there', async () => {
    // Ed's unit owes $50 after the first test. A $4,400 check against it used
    // to post as Ed and leave $4,350 as prepayment on that one unit.
    const before = await prisma.payment.count({ where: { facilityId } })
    const refused = await recordCounterPayment(staff(), {
      facilityId,
      tenantId: edId,
      leaseId: leaseE,
      method: 'check',
      checkNumber: '1044',
      amountCents: 440_000,
    })
    expect(refused).toEqual({ ok: false, problem: 'account_remainder' })
    expect(await prisma.payment.count({ where: { facilityId } })).toBe(before)
    expect(await balance(leaseE)).toBe(5_000)

    // What Ed actually owes still posts to Ed, as it always has (D-137).
    const own = await recordCounterPayment(staff(), {
      facilityId,
      tenantId: edId,
      leaseId: leaseE,
      method: 'cash',
      amountCents: 2_000,
      tenderedCents: 2_000,
    })
    expect(own.ok).toBe(true)
    if (!own.ok) return
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: own.paymentId },
      select: { tenantId: true },
    })
    expect(payment.tenantId).toBe(edId)
    expect(await balance(leaseE)).toBe(3_000)
  })

  it('refuses an account from another facility, and a bogus one', async () => {
    for (const id of [otherAccountId, 'not-an-account']) {
      const result = await recordCounterPayment(staff(), {
        facilityId,
        tenantId: payerId,
        leaseId: '',
        accountId: id,
        method: 'check',
        checkNumber: '1043',
        amountCents: 1_000,
      })
      expect(result).toEqual({ ok: false, problem: 'lease_not_found' })
    }
  })

  it('shows the whole account to the counter from the payer, an employee, or its name', async () => {
    for (const match of [{ tenantId: payerId }, { tenantId: fayId }, { name: `acme crews ${suffix}` }]) {
      const accounts = await counterPayableAccounts(staff(), facilityId, match)
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toMatchObject({
        accountId,
        payerTenantId: payerId,
        payerName: 'payer Fixture',
        unitNumbers: [`CA-E-${suffix}`, `CA-F-${suffix}`],
        balanceCents: 3_000,
      })
      expect(accounts[0].daysPastDue).toBeGreaterThan(0)
    }
    expect(await counterPayableAccounts(staff(), facilityId, { name: '  ' })).toEqual([])
  })

  it('keeps the balance behind tenants:view, as D-110 settled for the unit picker', async () => {
    await expect(
      counterPayableAccounts(staff(['payments:take']), facilityId, { tenantId: payerId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
