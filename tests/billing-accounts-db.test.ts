import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { claimsFor, applyPayment } from '../apps/web/lib/billing/allocation'
import { accountDetail, attachLease, createAccount, detachLease } from '../apps/web/lib/billing/accounts'
import { restoreAccessIfSettled } from '../apps/web/lib/access/delinquency-gate'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 01 §9 Phase 3 (B-090 part 5). One payer, several tenants' units.
//
// The claims here are money claims, so each one is asserted against the rows
// rather than against a return value: whose invoice moved, whose did not, and
// whose gate came back on.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let otherFacilityId = ''
let staffId = ''
/// The company's own contact: the payer, and a tenant with a unit of their own.
let payerId = ''
let payerLeaseId = ''
/// The site foreman: a different tenant, whose unit the company pays for.
let foremanId = ''
let foremanLeaseId = ''
let foremanGrantId = ''
/// A neighbour on nobody's account, to prove the widening does not leak.
let strangerId = ''
let strangerLeaseId = ''

let accountId = ''
let invoiceCounter = 0

function manager(facility = facilityId): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId: facility,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['billing_accounts:manage', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function openRent(leaseId: string, totalCents: number, dueDate = d('2026-09-01')) {
  invoiceCounter += 1
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: { facilityId: true },
  })
  const invoice = await prisma.invoice.create({
    data: {
      facilityId: lease.facilityId,
      leaseId,
      number: `BA${String(invoiceCounter).padStart(5, '0')}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: totalCents,
      totalCents,
      lineItems: {
        create: { type: 'rent', description: 'Rent', unitAmountCents: totalCents, amountCents: totalCents },
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId: lease.facilityId,
      leaseId,
      type: 'charge',
      amountCents: totalCents,
      description: 'Rent',
      occurredAt: dueDate,
      invoiceId: invoice.id,
    },
  })
  return invoice.id
}

async function makeTenant(handle: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: {
      email: `ba-${handle}-${suffix}@example.com`,
      firstName: handle,
      lastName: 'Renter',
    },
  })
  return tenant.id
}

async function makeLease(
  tenantId: string,
  unitNumber: string,
  facility: string,
  unitTypeId: string,
): Promise<string> {
  const unit = await prisma.unit.create({
    data: { facilityId: facility, unitTypeId, number: unitNumber },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId: facility,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-08-01'),
      billingDay: 1,
      monthlyRateCents: 20_000,
    },
  })
  return lease.id
}

describeDb('business accounts', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Accounts Test ${suffix}`,
        slug: `ba-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        accessSuspendDaysPastDue: 6,
        accessRestoreAtOrBelowCents: 0,
      },
    })
    facilityId = facility.id

    const other = await prisma.facility.create({
      data: {
        name: `Accounts Test Other ${suffix}`,
        slug: `ba-other-${suffix}`,
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    otherFacilityId = other.id

    const staff = await prisma.staffUser.create({
      data: { email: `ba-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x20 ${suffix}`, widthFt: 10, lengthFt: 20 },
    })
    const otherUnitType = await prisma.unitType.create({
      data: { facilityId: otherFacilityId, name: `10x20 ${suffix}`, widthFt: 10, lengthFt: 20 },
    })

    payerId = await makeTenant('payer')
    foremanId = await makeTenant('foreman')
    strangerId = await makeTenant('stranger')

    payerLeaseId = await makeLease(payerId, `BA-1-${suffix}`, facilityId, unitType.id)
    foremanLeaseId = await makeLease(foremanId, `BA-2-${suffix}`, facilityId, unitType.id)
    strangerLeaseId = await makeLease(strangerId, `BA-3-${suffix}`, facilityId, unitType.id)
    // Same company, different site — the case the composite key refuses.
    await makeLease(payerId, `BA-4-${suffix}`, otherFacilityId, otherUnitType.id)

    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId: foremanId, state: 'suspended', stateCause: 'system:delinquency' },
    })
    foremanGrantId = grant.id

    const account = await createAccount(manager(), {
      facilityId,
      name: `Acme Contracting ${suffix}`,
      payerEmail: `ba-payer-${suffix}@example.com`,
    })
    accountId = account.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: { in: [facilityId, otherFacilityId] } } } })
    await prisma.invoice.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({
      where: { facilityId: { in: [facilityId, otherFacilityId] } },
      data: { billingAccountId: null },
    })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.unit.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.unitType.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [payerId, foremanId, strangerId] } } })
    await prisma.$disconnect()
  })

  it('claims nothing of another tenant’s until the unit is on the account', async () => {
    await openRent(foremanLeaseId, 20_000)

    const before = await claimsFor(payerId, facilityId)
    expect(before.map((claim) => claim.invoiceId)).toEqual([])

    await attachLease(manager(), { accountId, unitNumber: `BA-2-${suffix}` })

    const after = await claimsFor(payerId, facilityId)
    expect(after.reduce((sum, claim) => sum + claim.outstandingCents, 0)).toBe(20_000)
  })

  it('settles the foreman’s invoice out of the payer’s one payment', async () => {
    const payerInvoice = await openRent(payerLeaseId, 15_000)
    const foremanInvoice = (await prisma.invoice.findFirstOrThrow({
      where: { leaseId: foremanLeaseId, status: { in: ['open', 'partially_paid'] } },
      select: { id: true },
    })).id

    const payment = await prisma.payment.create({
      data: { facilityId, tenantId: payerId, amountCents: 35_000, method: 'card', status: 'succeeded' },
    })
    const applied = await prisma.$transaction((tx) =>
      applyPayment(tx, {
        id: payment.id,
        tenantId: payerId,
        facilityId,
        amountCents: 35_000,
      }),
    )

    expect(applied.unappliedCents).toBe(0)
    const settled = Object.fromEntries(
      applied.lines.map((line) => [line.invoiceId, line.amountCents]),
    )
    expect(settled[payerInvoice]).toBe(15_000)
    expect(settled[foremanInvoice]).toBe(20_000)
    // The neighbour is at the same facility and past due; nothing of theirs
    // may be touched by a payer they have never heard of.
    expect(applied.lines.some((line) => line.invoiceId === strangerLeaseId)).toBe(false)
  })

  it('turns the foreman’s gate code back on, not just the payer’s', async () => {
    await prisma.accessGrant.update({
      where: { id: foremanGrantId },
      data: { state: 'suspended', stateCause: 'system:delinquency' },
    })
    await prisma.invoice.updateMany({
      where: { leaseId: foremanLeaseId },
      data: { status: 'paid', amountPaidCents: 20_000 },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: foremanLeaseId,
        type: 'payment',
        amountCents: -20_000,
        description: 'Paid by Acme Contracting',
      },
    })

    // Called with the PAYER, which is what every payment path passes.
    expect(await restoreAccessIfSettled(payerId, facilityId, d('2026-09-10'))).toBe(true)
    const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: foremanGrantId } })
    expect(grant.state).toBe('active')
  })

  it('adds the units up as one balance on the account', async () => {
    const detail = await accountDetail(manager(), accountId)
    expect(detail?.leaseCount).toBe(1)
    expect(detail?.leases[0].tenantName).toBe('foreman Renter')
    expect(detail?.balanceCents).toBe(0)
  })

  it('refuses a unit that is already on another account', async () => {
    const second = await createAccount(manager(), {
      facilityId,
      name: `Beta Builders ${suffix}`,
      payerEmail: `ba-stranger-${suffix}@example.com`,
    })
    await expect(
      attachLease(manager(), { accountId: second.id, unitNumber: `BA-2-${suffix}` }),
    ).rejects.toThrow(/Acme Contracting/)
    await prisma.billingAccount.delete({ where: { id: second.id } })
  })

  it('refuses a payer who is not a tenant here', async () => {
    await expect(
      createAccount(manager(), {
        facilityId,
        name: `Nobody Ltd ${suffix}`,
        payerEmail: `ba-nobody-${suffix}@example.com`,
      }),
    ).rejects.toThrow(/No tenant here/)
  })

  it('refuses a manager without the permission', async () => {
    const clerk: Actor = {
      kind: 'staff',
      staffUserId: staffId,
      assignments: [
        {
          facilityId,
          roleKey: 'clerk',
          rank: 10,
          permissions: new Set<PermissionKey>(['tenants:view']),
          limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
        },
      ],
    }
    await expect(
      attachLease(clerk, { accountId, unitNumber: `BA-3-${suffix}` }),
    ).rejects.toThrow()
  })

  /// The invariant the composite foreign key exists for. Asserted with raw SQL
  /// on purpose: the service never builds this row, so a check inside the
  /// service would only prove the service. A payment carries one facilityId,
  /// so a lease paid from another site's account would settle out of the wrong
  /// drawer, deposit slip and accounting period.
  it('cannot attach a lease at another facility, at the database', async () => {
    const elsewhere = await prisma.lease.findFirstOrThrow({
      where: { facilityId: otherFacilityId },
      select: { id: true },
    })
    await expect(
      prisma.$executeRaw`UPDATE "lease" SET "billingAccountId" = ${accountId} WHERE "id" = ${elsewhere.id}`,
    ).rejects.toThrow()
  })

  it('gives the unit back to its own tenant when it is taken off', async () => {
    await detachLease(manager(), { accountId, leaseId: foremanLeaseId })
    await openRent(foremanLeaseId, 20_000, d('2026-10-01'))

    const claims = await claimsFor(payerId, facilityId)
    expect(claims.map((claim) => claim.invoiceId)).toEqual([])
  })
})
