import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { attachLease, createAccount, portalAccountsForPayer } from '../apps/web/lib/billing/accounts'
import { payableAccount, payableLease } from '../apps/web/lib/portal/payment'
import { owingLeases } from '../apps/web/lib/portal/dashboard'
import { statementsForTenant, tenantMayViewLease } from '../apps/web/lib/billing/statements'
import { applyStripeEvent } from '../apps/web/lib/payments/reconcile'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-256 / PRD 01 §12. The PORTAL half of business accounts: what a payer sees,
// what they may pay, and what they may read.
//
// Every claim here is either a money claim or an authorization claim, so each
// is asserted against the rows or against a refusal — never against a rendered
// string. The shape of the fixture is B-090e's: a payer with a unit of their
// own, a foreman whose unit the company pays for, and a stranger on nobody's
// account, so a widening that leaked would show up as the stranger appearing.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let unitTypeId = ''
let staffId = ''
let payerId = ''
let payerLeaseId = ''
let foremanId = ''
let foremanLeaseId = ''
let strangerId = ''
let strangerLeaseId = ''
let accountId = ''
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
    data: { email: `pba-${handle}-${suffix}@example.com`, firstName: handle, lastName: 'Renter' },
  })
  return tenant.id
}

async function makeLease(tenantId: string, unitNumber: string): Promise<string> {
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: unitNumber },
  })
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

/// An open rent invoice and the charge that put it on the ledger, so a balance
/// here is the same balance every other screen reads.
async function openRent(leaseId: string, totalCents: number): Promise<string> {
  invoiceCounter += 1
  const dueDate = d('2026-09-01')
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `PBA${String(invoiceCounter).padStart(5, '0')}-${suffix}`,
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
  return invoice.id
}

describeDb('the business account portal', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Portal Accounts ${suffix}`,
        slug: `pba-${suffix}`,
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
      data: { email: `pba-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x20 ${suffix}`, widthFt: 10, lengthFt: 20 },
    })
    unitTypeId = unitType.id

    payerId = await makeTenant('payer')
    foremanId = await makeTenant('foreman')
    strangerId = await makeTenant('stranger')

    payerLeaseId = await makeLease(payerId, `PBA-1-${suffix}`)
    foremanLeaseId = await makeLease(foremanId, `PBA-2-${suffix}`)
    strangerLeaseId = await makeLease(strangerId, `PBA-3-${suffix}`)

    const account = await createAccount(manager(), {
      facilityId,
      name: `Acme Portal ${suffix}`,
      payerEmail: `pba-payer-${suffix}@example.com`,
    })
    accountId = account.id
    await attachLease(manager(), { accountId, unitNumber: `PBA-2-${suffix}` })

    // $150 on the foreman's unit (the company's), $60 on the payer's own,
    // $999 on the stranger's — three different figures so a total that mixed
    // them up could not accidentally be right.
    await openRent(foremanLeaseId, 15_000)
    await openRent(payerLeaseId, 6_000)
    await openRent(strangerLeaseId, 99_900)
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
    await prisma.tenant.deleteMany({ where: { id: { in: [payerId, foremanId, strangerId] } } })
    await prisma.$disconnect()
  })

  it('gives the payer one card totalling the account, and gives nobody else one', async () => {
    const [account] = await portalAccountsForPayer(payerId)
    expect(account.name).toBe(`Acme Portal ${suffix}`)
    // The account's units only. The payer's OWN $60 unit is not on the
    // account, so it must not be in this total — it has its own lease card.
    expect(account.balanceCents).toBe(15_000)
    expect(account.units.map((unit) => unit.leaseId)).toEqual([foremanLeaseId])
    expect(account.units[0].tenantName).toBe('foreman Renter')

    // Being billed FOR something does not make the account yours.
    expect(await portalAccountsForPayer(foremanId)).toEqual([])
    expect(await portalAccountsForPayer(strangerId)).toEqual([])
  })

  it('offers the payer the account total to pay, and refuses somebody else the account', async () => {
    const subject = await payableAccount(payerId, accountId)
    expect(subject?.balanceCents).toBe(15_000)
    expect(subject?.account?.name).toBe(`Acme Portal ${suffix}`)
    // The anchor is one of the account's own leases, never the payer's
    // personal unit — a remainder must land inside the account it was paid to.
    expect(subject?.leaseId).toBe(foremanLeaseId)
    // The gate figure stays the VIEWER's own: $60, not the account's $150.
    // `restoreShortfallCents` reads it, and the gate rule judges a tenant on
    // what they owe rather than on what they pay for.
    expect(subject?.facilityBalanceCents).toBe(6_000)

    expect(await payableAccount(foremanId, accountId)).toBeNull()
    expect(await payableAccount(strangerId, accountId)).toBeNull()
  })

  it('lets the payer open a unit they pay for, and nobody else open it', async () => {
    const asPayer = await payableLease(payerId, foremanLeaseId)
    expect(asPayer?.balanceCents).toBe(15_000)
    // Still the payer's own facility balance, for the reason above.
    expect(asPayer?.facilityBalanceCents).toBe(6_000)

    // The widening is a union, not a swap: the payer's own unit is unchanged.
    const own = await payableLease(payerId, payerLeaseId)
    expect(own?.balanceCents).toBe(6_000)
    expect(own?.account).toBeNull()

    // And it leaks nothing. Nobody's account reaches the stranger, and being
    // billed for does not reach back.
    expect(await payableLease(payerId, strangerLeaseId)).toBeNull()
    expect(await payableLease(foremanId, payerLeaseId)).toBeNull()
  })

  it('counts the account into what the payer is offered to pay, and into their statements', async () => {
    const owing = await owingLeases(payerId)
    expect(owing.map((row) => row.leaseId).sort()).toEqual(
      [foremanLeaseId, payerLeaseId].sort(),
    )
    expect(owing.reduce((sum, row) => sum + row.balanceCents, 0)).toBe(21_000)

    // A statement is a full financial history, so who may read one is an
    // authorization claim: the payer may, and the foreman gains nothing.
    expect(await tenantMayViewLease(payerId, foremanLeaseId)).toBe(true)
    expect(await tenantMayViewLease(foremanId, payerLeaseId)).toBe(false)
    expect(await tenantMayViewLease(payerId, strangerLeaseId)).toBe(false)

    const statements = await statementsForTenant(payerId, d('2026-09-15'))
    const accountRows = statements.filter((row) => row.account?.id === accountId)
    expect(accountRows.every((row) => row.leaseId === foremanLeaseId)).toBe(true)
    expect(accountRows.length).toBeGreaterThan(0)
    // The payer's own unit is grouped as their own, not under the account.
    expect(statements.some((row) => row.leaseId === payerLeaseId && row.account === null)).toBe(true)
  })

  it('keeps an ended unit out of the Pay button and inside the statement', async () => {
    // A lease keeps its `billingAccountId` when it ends — the relation is
    // Restrict both ways and nothing detaches on move-out — so the two
    // questions need two answers. The company should not be asked to pay for a
    // unit they moved out of; the March statement for that unit is still
    // theirs, and a consolidated month that dropped it would not add up to the
    // row on the list it was reached from.
    const endedLeaseId = await makeLease(strangerId, `PBA-4-${suffix}`)
    await prisma.lease.update({
      where: { id: endedLeaseId },
      data: { billingAccountId: accountId, status: 'ended' },
    })

    const [payable] = await portalAccountsForPayer(payerId)
    expect(payable.units.map((unit) => unit.leaseId)).not.toContain(endedLeaseId)

    const [forStatement] = await portalAccountsForPayer(payerId, { includeEndedLeases: true })
    expect(forStatement.units.map((unit) => unit.leaseId)).toContain(endedLeaseId)

    // And the Pay screen is the first question, so it agrees with the first
    // answer — an ended unit is not part of what the payer is asked for.
    expect((await payableAccount(payerId, accountId))?.balanceCents).toBe(payable.balanceCents)

    await prisma.lease.update({ where: { id: endedLeaseId }, data: { billingAccountId: null } })
  })

  it('anchors a payer’s overpayment to the account unit they named', async () => {
    // The defect this fixes: `anchorLeaseFor` scoped the named lease to the
    // payer's OWN tenancy, so a payer naming one of their account's units got
    // no anchor at all — and the part of the payment no invoice claimed was
    // then written to no lease ledger. The account total the portal shows would
    // have been stale by exactly that amount.
    // $250 against $210 of claimable invoices — the foreman's $150 AND the
    // payer's own $60, because `claimsFor` is a union (B-090e). $40 is left
    // over, and that is the money the anchor decides the home of.
    const payment = await prisma.payment.create({
      data: {
        facilityId,
        tenantId: payerId,
        amountCents: 25_000,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: `pi_pba_${suffix}`,
      },
    })

    await applyStripeEvent({
      id: `evt_pba_${suffix}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_pba_${suffix}`,
          created: Math.floor(d('2026-09-10').getTime() / 1000),
          metadata: { leaseId: foremanLeaseId, tenantId: payerId, facilityId },
        },
      },
    } as unknown as Stripe.Event)

    const entries = await prisma.ledgerEntry.findMany({
      where: { paymentId: payment.id },
      select: { leaseId: true, amountCents: true },
    })
    // The foreman's $150 and the payer's own $60 were both settled, and the
    // $40 no invoice claimed anchored to the named account unit rather than
    // vanishing. Before the fix the anchor was null and that $40 reached no
    // lease ledger at all.
    const byLease = new Map(entries.map((entry) => [entry.leaseId, entry.amountCents]))
    expect(byLease.get(foremanLeaseId)).toBe(-19_000)
    expect(byLease.get(payerLeaseId)).toBe(-6_000)
    expect([...byLease.values()].reduce((sum, cents) => sum + cents, 0)).toBe(-25_000)
    expect((await portalAccountsForPayer(payerId))[0].balanceCents).toBe(-4_000)
  })
})
