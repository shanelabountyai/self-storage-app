import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  accountDetail,
  accountLateness,
  accountsFor,
  attachLease,
  createAccount,
  portalAccountsFor,
} from '../apps/web/lib/billing/accounts'
import { navPayFor } from '../apps/web/lib/portal/dashboard'
import { payableAccount } from '../apps/web/lib/portal/payment'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-315. No two controls on a payer's path show two different figures for the
// same account, and the staff list reads lateness the way the detail does.
//
// The fixture is the one the defect needed: a credit on one unit and arrears on
// two others, so the sum of positive balances ($55) and the account's net
// balance ($37.50) differ, and a nav that quoted the first is caught.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let unitTypeId = ''
let staffId = ''
let accountId = ''
const tenantIds: string[] = []
let invoiceCounter = 0

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['billing_accounts:manage', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeTenant(handle: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { email: `afg-${handle}-${suffix}@example.com`, firstName: handle, lastName: 'Renter' },
  })
  tenantIds.push(tenant.id)
  return tenant.id
}

async function makeLease(tenantId: string, unitNumber: string): Promise<string> {
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: unitNumber } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-07-01'),
      billingDay: 1,
      monthlyRateCents: 20_000,
    },
  })
  return lease.id
}

async function openRent(leaseId: string, totalCents: number, due: string): Promise<void> {
  invoiceCounter += 1
  const dueDate = d(due)
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `AFG${String(invoiceCounter).padStart(5, '0')}-${suffix}`,
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
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: totalCents,
      description: 'Rent',
      occurredAt: dueDate,
      invoiceId: invoice.id,
    },
  })
}

describeDb('account figures agree across screens (B-315)', () => {
  let payerId = ''

  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Account Figures ${suffix}`,
        slug: `afg-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    staffId = (
      await prisma.staffUser.create({
        data: { email: `afg-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      })
    ).id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id

    // The payer holds no unit on the account.
    payerId = await makeTenant('payer')
    const credited = await makeLease(await makeTenant('a'), `AFG-1-${suffix}`)
    const behind = await makeLease(await makeTenant('b'), `AFG-2-${suffix}`)
    const further = await makeLease(await makeTenant('c'), `AFG-3-${suffix}`)

    accountId = (
      await createAccount(manager(), {
        facilityId,
        name: `Acme Figures ${suffix}`,
        payerEmail: `afg-payer-${suffix}@example.com`,
      })
    ).id
    for (const n of [1, 2, 3]) {
      await attachLease(manager(), { accountId, unitNumber: `AFG-${n}-${suffix}` })
    }

    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: credited,
        type: 'credit',
        amountCents: -1_750,
        description: 'Goodwill credit',
        occurredAt: d('2026-08-15'),
      },
    })
    await openRent(behind, 2_000, '2026-09-01')
    await openRent(further, 3_500, '2026-08-20')

    const timeline = await prisma.delinquencyTimeline.create({
      data: { facilityId, version: 1, label: 'Test', steps: [] },
    })
    await prisma.delinquencyStepRun.create({
      data: {
        leaseId: further,
        facilityId,
        timelineId: timeline.id,
        businessDate: new Date(),
        dayOffset: 15,
        label: 'Pre-lien notice',
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await prisma.$disconnect()
  })

  it('quotes the account’s net balance on the nav, the card and the pay screen alike', async () => {
    const nav = await navPayFor(payerId)
    const [card] = await portalAccountsFor(payerId)
    const payScreen = await payableAccount(payerId, accountId)

    expect(nav).toEqual({ href: `/portal/pay?account=${accountId}`, amountCents: 3_750 })
    expect(card.balanceCents).toBe(3_750)
    expect(payScreen?.balanceCents).toBe(3_750)
  })

  it('tells the payer the oldest due date, by the same reckoning staff see', async () => {
    const [card] = await portalAccountsFor(payerId)
    const detail = await accountDetail(manager(), accountId)

    expect(card.oldestDueDate).toEqual(d('2026-08-20'))
    expect(card.daysPastDue).toBe(detail?.daysPastDue)
  })

  it('gives the staff list the detail screen’s days past due and stage', async () => {
    const row = (await accountsFor(manager(), facilityId)).find((a) => a.id === accountId)
    const detail = await accountDetail(manager(), accountId)

    expect(row?.stage).toBe('Pre-lien notice')
    expect(row).toMatchObject({ daysPastDue: detail?.daysPastDue, stage: detail?.stage })
  })

  it('quotes no figure when owing units span more than one thing to pay', async () => {
    const own = await makeLease(payerId, `AFG-4-${suffix}`)
    await openRent(own, 600, '2026-09-10')

    expect(await navPayFor(payerId)).toEqual({ href: '/portal', amountCents: null })
  })
})

describe('accountLateness', () => {
  const rent = (due: string, totalCents: number, amountPaidCents = 0) => ({
    dueDate: d(due),
    totalCents,
    amountPaidCents,
    status: 'open',
  })

  it('counts from the oldest unpaid rent across every unit, ignoring settled ones', () => {
    const leases = [
      { invoices: [rent('2026-07-01', 100, 100), rent('2026-09-01', 100)] },
      { invoices: [rent('2026-08-20', 100, 40)] },
    ]
    expect(accountLateness(leases, d('2026-09-09'))).toEqual({
      daysPastDue: 20,
      oldestDueDate: d('2026-08-20'),
    })
  })

  it('is current with no date when nothing is unpaid', () => {
    expect(accountLateness([{ invoices: [rent('2026-08-01', 100, 100)] }], d('2026-09-09'))).toEqual({
      daysPastDue: 0,
      oldestDueDate: null,
    })
  })
})
