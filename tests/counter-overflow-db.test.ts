import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { recordCounterPayment } from '../apps/web/lib/admin/pos'
import { overflowWarning } from '../apps/web/lib/admin/counter-overflow'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-339. A unit-directed counter payment larger than that unit's balance says
// so, and names the tenant's other owing unit, because the delinquency ladder
// cures per lease and a surplus parked on A does nothing for B. Choosing both
// settles both; continuing keeps B-305's restriction exactly as it was.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let unitTypeId = ''
const tenantIds: string[] = []
let counter = 0

function staff(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['payments:take', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeLease(tenantId: string, number: string) {
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: `${number}-${counter}` } })
  const leaseId = (
    await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-01-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 16_100,
      },
    })
  ).id
  counter += 1
  const start = new Date(Date.UTC(2026, counter % 12, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `CO${counter}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: new Date(start.getTime() + 30 * 86_400_000),
      subtotalCents: 16_100,
      totalCents: 16_100,
      lineItems: {
        create: { type: 'rent', description: 'Rent', unitAmountCents: 16_100, amountCents: 16_100 },
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: 16_100,
      description: 'Rent',
      occurredAt: start,
      invoiceId: invoice.id,
    },
  })
  return leaseId
}

async function twoUnitTenant(name: string) {
  const tenantId = (
    await prisma.tenant.create({
      data: { email: `co-${name}-${suffix}@example.com`, firstName: name, lastName: 'Fixture' },
    })
  ).id
  tenantIds.push(tenantId)
  return { tenantId, a: await makeLease(tenantId, 'A'), b: await makeLease(tenantId, 'B') }
}

const leaseBalance = async (leaseId: string) =>
  (await prisma.ledgerEntry.aggregate({ where: { leaseId }, _sum: { amountCents: true } }))._sum
    .amountCents ?? 0
const invoiceStatus = async (leaseId: string) =>
  (await prisma.invoice.findFirstOrThrow({ where: { leaseId }, select: { status: true } })).status

describe('counter overflow warning (B-339)', () => {
  const a = { unitNumber: 'A-1', balanceCents: 16_100 }
  const b = { unitNumber: 'B-2', balanceCents: 16_100 }

  it('names the other owing unit and its balance when the amount is over the picked unit’s', () => {
    const warning = overflowWarning(a, [b], '322')
    expect(warning).toContain('Unit B-2 also owes $161.00')
    expect(warning).toContain('stays as credit on A-1 and B-2 stays unpaid')
  })

  it('says nothing at or under the balance, with no other owing unit, or on an unparseable amount', () => {
    expect(overflowWarning(a, [b], '161.00')).toBe('')
    expect(overflowWarning(a, [b], '$161')).toBe('')
    expect(overflowWarning(a, [], '322')).toBe('')
    expect(overflowWarning(a, [b], '3,22x')).toBe('')
  })
})

describeDb('counter payment across a tenant’s units (B-339)', () => {
  beforeAll(async () => {
    facilityId = (
      await prisma.facility.create({
        data: {
          name: `Counter Overflow ${suffix}`,
          slug: `counter-overflow-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
    ).id
    staffId = (
      await prisma.staffUser.create({
        data: { email: `co-staff-${suffix}@example.com`, firstName: 'Cam', lastName: 'Counter' },
      })
    ).id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
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

  const pay = (tenantId: string, leaseId: string, alsoLeaseIds: string[] = []) =>
    recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId,
      restrictToLease: true,
      alsoLeaseIds,
      method: 'cash',
      amountCents: 32_200,
      tenderedCents: 32_200,
    })

  it('choosing both settles both', async () => {
    const { tenantId, a, b } = await twoUnitTenant('both')
    const result = await pay(tenantId, a, [b])
    expect(result.ok && result.unappliedCents).toBe(0)
    expect(await invoiceStatus(a)).toBe('paid')
    expect(await invoiceStatus(b)).toBe('paid')
    expect(await leaseBalance(a)).toBe(0)
    expect(await leaseBalance(b)).toBe(0)
  })

  it('continuing leaves B untouched and the surplus as credit on A, as before', async () => {
    const { tenantId, a, b } = await twoUnitTenant('one')
    const result = await pay(tenantId, a)
    expect(result.ok && result.unappliedCents).toBe(16_100)
    expect(await invoiceStatus(a)).toBe('paid')
    expect(await invoiceStatus(b)).toBe('open')
    expect(await leaseBalance(a)).toBe(-16_100)
    expect(await leaseBalance(b)).toBe(16_100)
  })

  it('an extra lease id that is not this tenant’s claims nothing', async () => {
    const mine = await twoUnitTenant('mine')
    const theirs = await twoUnitTenant('theirs')
    await pay(mine.tenantId, mine.a, [theirs.a])
    expect(await invoiceStatus(theirs.a)).toBe('open')
    expect(await leaseBalance(mine.a)).toBe(-16_100)
  })
})
