import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  AccountError,
  addMember,
  accountDetail,
  attachLease,
  createAccount,
  portalAccountsFor,
  removeMember,
} from '../apps/web/lib/billing/accounts'
import { payableAccount, payableLease } from '../apps/web/lib/portal/payment'
import { owingLeases } from '../apps/web/lib/portal/dashboard'
import { statementsForTenant, tenantMayViewLease } from '../apps/web/lib/billing/statements'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-258 / PRD 01 §12. Authorized users on a business account: the people
// allowed to SEE it.
//
// The whole item is one boundary — a member may look and may not pay — so every
// case here is either "the member reaches this" or "the member is refused
// this", asserted against rows and refusals rather than against rendered text.
// The fixture is B-256's, with a bookkeeper added: a payer with a unit of their
// own, a foreman whose unit the company pays for, a stranger on nobody's
// account, and a member who holds no lease at all.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const emailFor = (handle: string) => `bam-${handle}-${suffix}@example.com`

let facilityId = ''
let unitTypeId = ''
let staffId = ''
let payerId = ''
let payerLeaseId = ''
let foremanId = ''
let foremanLeaseId = ''
let strangerId = ''
let memberId = ''
let accountId = ''

function manager(permissions: PermissionKey[] = ['billing_accounts:manage', 'tenants:view']): Actor {
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

async function makeTenant(handle: string): Promise<string> {
  const tenant = await prisma.tenant.create({
    data: { email: emailFor(handle), firstName: handle, lastName: 'Person' },
  })
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
      startDate: d('2026-08-01'),
      billingDay: 1,
      monthlyRateCents: 20_000,
    },
  })
  return lease.id
}

/// An open rent charge on the ledger, so a balance here is the same balance
/// every screen reads.
async function openRent(leaseId: string, totalCents: number, n: number): Promise<void> {
  const dueDate = d('2026-09-01')
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `BAM${String(n).padStart(5, '0')}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: totalCents,
      totalCents,
      lineItems: {
        create: {
          type: 'rent',
          description: 'Rent',
          unitAmountCents: totalCents,
          amountCents: totalCents,
        },
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

describeDb('authorized users on a business account', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Account Members ${suffix}`,
        slug: `bam-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        accessRestoreAtOrBelowCents: 0,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: emailFor('staff'), firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x20 ${suffix}`, widthFt: 10, lengthFt: 20 },
    })
    unitTypeId = unitType.id

    payerId = await makeTenant('payer')
    foremanId = await makeTenant('foreman')
    strangerId = await makeTenant('stranger')
    // Holds no lease, which is the shape the row is about: the office manager
    // who neither rents a unit nor signs the cheques.
    memberId = await makeTenant('bookkeeper')

    payerLeaseId = await makeLease(payerId, `BAM-1-${suffix}`)
    foremanLeaseId = await makeLease(foremanId, `BAM-2-${suffix}`)
    await makeLease(strangerId, `BAM-3-${suffix}`)

    const account = await createAccount(manager(), {
      facilityId,
      name: `Acme Members ${suffix}`,
      payerEmail: emailFor('payer'),
    })
    accountId = account.id
    await attachLease(manager(), { accountId, unitNumber: `BAM-2-${suffix}` })

    // $150 on the company's unit, $60 on the payer's own — two figures so a
    // total that mixed them up could not accidentally be right.
    await openRent(foremanLeaseId, 15_000, 1)
    await openRent(payerLeaseId, 6_000, 2)

    await addMember(manager(), { accountId, email: emailFor('bookkeeper') })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    // Memberships cascade with the account, which is the schema's own claim —
    // this teardown would fail on a foreign key if it did not.
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({
      where: { id: { in: [payerId, foremanId, strangerId, memberId] } },
    })
    await prisma.$disconnect()
  })

  it('gives a member the account card with its real total, and marks it unpayable', async () => {
    const [account] = await portalAccountsFor(memberId)
    expect(account.id).toBe(accountId)
    expect(account.payable).toBe(false)
    // The same money the payer sees. Sight of the account is the entire point;
    // a member shown a different total would be worse than one shown none.
    expect(account.balanceCents).toBe(15_000)
    expect(account.units.map((unit) => unit.leaseId)).toEqual([foremanLeaseId])
    // The renters' names are the payer's, not a member's.
    expect(account.units[0].tenantName).toBe('')
    // Named so a member who cannot pay is not left wondering who does.
    expect(account.payerName).toBe('payer Person')
  })

  it('leaves the payer’s own card exactly as B-256 built it', async () => {
    const [account] = await portalAccountsFor(payerId)
    expect(account.payable).toBe(true)
    expect(account.balanceCents).toBe(15_000)
    expect(account.units[0].tenantName).toBe('foreman Person')
    // The widening reaches nobody it should not: the tenant BILLED to the
    // account still gets no card, and neither does a stranger.
    expect(await portalAccountsFor(foremanId)).toEqual([])
    expect(await portalAccountsFor(strangerId)).toEqual([])
  })

  it('refuses a member every path that moves money', async () => {
    // The account's own URL.
    expect(await payableAccount(memberId, accountId)).toBeNull()
    // A unit on the account, by lease id.
    expect(await payableLease(memberId, foremanLeaseId)).toBeNull()
    // The nav's Pay link, which is the third way in.
    expect(await owingLeases(memberId)).toEqual([])
    // And the payer still can, so this is a boundary rather than a breakage.
    expect((await payableAccount(payerId, accountId))?.balanceCents).toBe(15_000)
  })

  it('refuses a member the account’s statements and the units’ own documents', async () => {
    expect(await statementsForTenant(memberId)).toEqual([])
    expect(await tenantMayViewLease(memberId, foremanLeaseId)).toBe(false)
    expect(await tenantMayViewLease(memberId, payerLeaseId)).toBe(false)
    // Unchanged for the payer, whose bookkeeping record these are.
    expect(await tenantMayViewLease(payerId, foremanLeaseId)).toBe(true)
  })

  it('refuses a member who is not already a tenant, the payer, and a duplicate', async () => {
    await expect(
      addMember(manager(), { accountId, email: `nobody-${suffix}@example.com` }),
    ).rejects.toThrow(AccountError)
    // The payer already sees the account, and rather more of it.
    await expect(
      addMember(manager(), { accountId, email: emailFor('payer') }),
    ).rejects.toThrow(/is the payer/)
    await expect(
      addMember(manager(), { accountId, email: emailFor('bookkeeper') }),
    ).rejects.toThrow(/already see/)
    // One row, whatever was attempted.
    expect(await prisma.billingAccountMember.count({ where: { accountId } })).toBe(1)
  })

  it('refuses a staffer without billing_accounts:manage', async () => {
    await expect(
      addMember(manager(['tenants:view']), { accountId, email: emailFor('stranger') }),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      removeMember(manager(['tenants:view']), { accountId, tenantId: memberId }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('lists members on the staff screen and takes the card away when one is removed', async () => {
    const before = await accountDetail(manager(), accountId)
    expect(before?.members.map((member) => member.email)).toEqual([emailFor('bookkeeper')])

    await removeMember(manager(), { accountId, tenantId: memberId })
    expect(await portalAccountsFor(memberId)).toEqual([])

    const after = await accountDetail(manager(), accountId)
    expect(after?.members).toEqual([])

    // Both halves are audited against the ACCOUNT, scoped to this account's id
    // because `audit_log` is append-only and shared across the suite.
    const actions = await prisma.auditLog.findMany({
      where: { entityType: 'BillingAccount', entityId: accountId },
      orderBy: { occurredAt: 'asc' },
      select: { action: true },
    })
    expect(actions.map((row) => row.action)).toContain('billing_account.member_added')
    expect(actions.map((row) => row.action)).toContain('billing_account.member_removed')

    // Put it back, so this file can run twice against the same database.
    await addMember(manager(), { accountId, email: emailFor('bookkeeper') })
  })
})
