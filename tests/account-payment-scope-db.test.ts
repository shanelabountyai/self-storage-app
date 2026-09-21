import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-330. A payment made against a business ACCOUNT settles the account's units
// and never the payer's own. `claimsFor` is the payer's leases OR the account's
// (D-118), so before this Acme's check paid the foreman's older personal 5×5
// and left an Acme unit open. Each case gets a fresh payer, personal unit and
// account, so the three payment paths cannot see each other's allocations.
// Stripe is mocked at the same wall `counter-card-account-db.test.ts` hits; the
// webhook half runs for real, with the metadata the intent was raised with.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type RecordedCharge = {
  reference: string
  amountCents: number
  facilityId: string
  tenantId: string
  leaseId?: string
  accountId?: string | null
}

const charges: RecordedCharge[] = []

vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(async (input: RecordedCharge) => {
    charges.push(input)
    const payment = await prisma.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        amountCents: input.amountCents,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: `pi_${randomUUID().slice(0, 12)}`,
      },
    })
    return {
      paymentId: payment.id,
      paymentIntentId: payment.stripePaymentIntentId!,
      clientSecret: 'cs_test',
      deduplicated: false,
    }
  }),
  createCustomerSession: vi.fn(async () => 'cuss_test'),
}))

vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, paymentsEnabled: () => true, stripeClient: () => ({}) as never }
})

const {
  chargeableAccount,
  chargeCardOnFile,
  counterReceipt,
  recordCounterPayment,
  startCounterCardPayment,
} = await import('../apps/web/lib/admin/pos')
const { generateInvoices } = await import('../apps/web/lib/billing/invoices')
const { payableAccount, startPortalPayment } = await import('../apps/web/lib/portal/payment')
const { applyStripeEvent } = await import('../apps/web/lib/payments/reconcile')

let facilityId = ''
let unitTypeId = ''
let staffUserId = ''
let n = 0

type Fixture = {
  payerId: string
  accountId: string
  personalLeaseId: string
  personalInvoiceId: string
  accountLeaseId: string
  accountInvoiceId: string
}
let f: Fixture

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view', 'payments:take']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

/// A unit with one open $100 rent invoice and the ledger charge behind it.
async function owingUnit(
  tenantId: string,
  billingAccountId: string | null,
  dueDate: Date,
): Promise<{ leaseId: string; invoiceId: string }> {
  const number = `S${++n}-${suffix}`
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      billingAccountId,
      status: 'active',
      startDate: d('2026-05-01'),
      billingDay: 1,
      monthlyRateCents: 10_000,
    },
  })
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId: lease.id,
      number: `APS-${number}`,
      kind: 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: 10_000,
      totalCents: 10_000,
      lineItems: {
        create: { type: 'rent', description: 'Rent', unitAmountCents: 10_000, amountCents: 10_000 },
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: lease.id,
      type: 'charge',
      amountCents: 10_000,
      description: 'Rent',
      occurredAt: dueDate,
      invoiceId: invoice.id,
    },
  })
  return { leaseId: lease.id, invoiceId: invoice.id }
}

/// The foreman pays for Acme and also rents a personal unit here, whose
/// invoice is OLDER than the account's — so oldest-first would pick it.
async function fixture(): Promise<Fixture> {
  const payer = await prisma.tenant.create({
    data: { email: `aps-${++n}-${suffix}@example.com`, firstName: 'Foreman', lastName: 'Renter' },
  })
  const account = await prisma.billingAccount.create({
    data: { facilityId, name: `Acme ${n} ${suffix}`, payerTenantId: payer.id },
  })
  const personal = await owingUnit(payer.id, null, d('2026-07-01'))
  const onAccount = await owingUnit(payer.id, account.id, d('2026-09-01'))
  return {
    payerId: payer.id,
    accountId: account.id,
    personalLeaseId: personal.leaseId,
    personalInvoiceId: personal.invoiceId,
    accountLeaseId: onAccount.leaseId,
    accountInvoiceId: onAccount.invoiceId,
  }
}

async function status(invoiceId: string): Promise<string> {
  return (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status
}

async function expectAccountSettledOnly(): Promise<void> {
  expect(await status(f.accountInvoiceId)).toBe('paid')
  expect(await status(f.personalInvoiceId)).toBe('open')
  const personalLedger = await prisma.ledgerEntry.aggregate({
    where: { leaseId: f.personalLeaseId },
    _sum: { amountCents: true },
  })
  expect(personalLedger._sum.amountCents).toBe(10_000)
}

/// Delivers `payment_intent.succeeded` with the metadata the intent carried.
async function succeed(paymentId: string, charge: RecordedCharge): Promise<void> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
  await applyStripeEvent({
    id: `evt_aps_${randomUUID().slice(0, 8)}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: payment.stripePaymentIntentId,
        created: Math.floor(Date.now() / 1000),
        metadata: {
          facilityId,
          tenantId: charge.tenantId,
          reference: charge.reference,
          ...(charge.leaseId ? { leaseId: charge.leaseId } : {}),
          ...(charge.accountId ? { accountId: charge.accountId } : {}),
        },
      },
    },
  } as unknown as Stripe.Event)
}

describeDb('an account payment settles the account, not the payer’s own units (B-330)', () => {
  beforeEach(async () => {
    charges.length = 0
    if (!facilityId) {
      const facility = await prisma.facility.create({
        data: {
          name: `Account Scope ${suffix}`,
          slug: `account-scope-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
      facilityId = facility.id
      unitTypeId = (
        await prisma.unitType.create({
          data: { facilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 },
        })
      ).id
      staffUserId = (
        await prisma.staffUser.create({
          data: { email: `aps-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Counter' },
        })
      ).id
    }
    f = await fixture()
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // Everything stays: counter payments write `audit_log` rows, which RESTRICT
    // the facility and staff user and refuse their own DELETE (B-185).
    await prisma.$disconnect()
  })

  it('cash at the counter for the account', async () => {
    const result = await recordCounterPayment(actor(), {
      facilityId,
      tenantId: f.payerId,
      leaseId: '',
      accountId: f.accountId,
      restrictToLease: false,
      method: 'cash',
      amountCents: 10_000,
      tenderedCents: 10_000,
      checkNumber: '',
    })
    if (!result.ok) throw new Error(result.problem)
    await expectAccountSettledOnly()
    const receipt = (await counterReceipt(actor(), result.paymentId))!
    expect(receipt.credits.map((credit) => credit.leaseId)).toEqual([f.accountLeaseId])
  })

  it('a card at the counter for the account, applied through the webhook', async () => {
    const charge = (await chargeableAccount(actor(), f.accountId))!
    const setup = await startCounterCardPayment(actor(), charge, 10_000)
    if (!setup.available) throw new Error('card setup unavailable')
    expect(charges[0].accountId).toBe(f.accountId)
    await succeed(setup.paymentId, charges[0])
    await expectAccountSettledOnly()
    const receipt = (await counterReceipt(actor(), setup.paymentId))!
    expect(receipt.credits.map((credit) => credit.leaseId)).toEqual([f.accountLeaseId])
  })

  it('the portal’s /portal/pay?account= payment, applied through the webhook', async () => {
    const payable = await payableAccount(f.payerId, f.accountId)
    if (!payable) throw new Error('account not payable')
    const setup = await startPortalPayment(f.payerId, payable, 10_000)
    if (!setup.available) throw new Error('portal setup unavailable')
    expect(charges[0].accountId).toBe(f.accountId)
    await succeed(setup.paymentId, charges[0])
    await expectAccountSettledOnly()
  })

  // B-350. A surplus on an account used to be booked as credit that every
  // credit-spending job then looked up by the payer, so it paid the payer's
  // personal unit at the next billing run. Now it is never created.
  async function expectNothingWritten(): Promise<void> {
    expect(await prisma.payment.count({ where: { tenantId: f.payerId } })).toBe(0)
    expect(await status(f.accountInvoiceId)).toBe('open')
    expect(await status(f.personalInvoiceId)).toBe('open')
    const ledger = await prisma.ledgerEntry.aggregate({
      where: { leaseId: { in: [f.accountLeaseId, f.personalLeaseId] } },
      _sum: { amountCents: true },
    })
    expect(ledger._sum.amountCents).toBe(20_000)
  }

  it('cash over the account’s balance is refused and writes nothing (B-350)', async () => {
    const result = await recordCounterPayment(actor(), {
      facilityId,
      tenantId: f.payerId,
      leaseId: '',
      accountId: f.accountId,
      restrictToLease: false,
      method: 'cash',
      amountCents: 15_000,
      tenderedCents: 15_000,
      checkNumber: '',
    })
    expect(result).toEqual({ ok: false, problem: 'account_above_balance' })
    await expectNothingWritten()
  })

  it('a counter card over the account’s balance raises no intent (B-350)', async () => {
    const charge = (await chargeableAccount(actor(), f.accountId))!
    const setup = await startCounterCardPayment(actor(), charge, 15_000)
    expect(setup).toEqual({ available: false, accountAboveBalance: true })
    expect(charges).toHaveLength(0)
    await expectNothingWritten()
  })

  it('card on file over the account’s balance is refused before the card (B-350)', async () => {
    const charge = (await chargeableAccount(actor(), f.accountId))!
    const result = await chargeCardOnFile(actor(), charge, 15_000)
    expect(result).toEqual({ ok: false, problem: 'account_above_balance' })
    expect(charges).toHaveLength(0)
    await expectNothingWritten()
  })

  it('a payment in the payer’s own name still reaches their own unit', async () => {
    const result = await recordCounterPayment(actor(), {
      facilityId,
      tenantId: f.payerId,
      leaseId: f.personalLeaseId,
      restrictToLease: true,
      method: 'cash',
      amountCents: 10_000,
      tenderedCents: 10_000,
      checkNumber: '',
    })
    if (!result.ok) throw new Error(result.problem)
    expect(await status(f.personalInvoiceId)).toBe('paid')
    expect(await status(f.accountInvoiceId)).toBe('open')
  })

  it('the next billing run spends none of an account payment outside the account (B-350)', async () => {
    const result = await recordCounterPayment(actor(), {
      facilityId,
      tenantId: f.payerId,
      leaseId: '',
      accountId: f.accountId,
      restrictToLease: false,
      method: 'cash',
      amountCents: 10_000,
      tenderedCents: 10_000,
      checkNumber: '',
    })
    if (!result.ok) throw new Error(result.problem)
    await generateInvoices(facilityId, d('2026-09-28'), () => {})
    const allocations = await prisma.paymentAllocation.findMany({
      where: { paymentId: result.paymentId },
      select: { invoice: { select: { leaseId: true } } },
    })
    expect(allocations.map((a) => a.invoice.leaseId)).toEqual([f.accountLeaseId])
  })
})
