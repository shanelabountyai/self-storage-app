import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-320. A business account's payer at the counter with a company card.
//
// The card is charged to the PAYER (the Stripe customer and `Payment.tenantId`),
// so the existing webhook allocates it by `claimsFor(payer)` exactly as the
// account's check is — and its printed receipt is the cash receipt's rows, read
// from the same `paymentCredits`. The Stripe call is mocked, the same wall
// `counter-card-db.test.ts` hits; the webhook half runs for real.

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
  surface?: string
  saveMethod?: boolean
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
  counterReceipt,
  PAYMENT_STATUS_LABEL,
  receiptRows,
  recordCounterPayment,
  startCounterCardPayment,
} = await import('../apps/web/lib/admin/pos')
const { PaymentStatus } = await import('@prisma/client')
const { applyStripeEvent } = await import('../apps/web/lib/payments/reconcile')

let facilityId = ''
let staffUserId = ''
let payerId = ''
let accountId = ''
let olderLeaseId = ''

function actorAt(facility: string): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId: facility,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view', 'payments:take']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function tenant(handle: string): Promise<string> {
  const row = await prisma.tenant.create({
    data: { email: `cca-${handle}-${suffix}@example.com`, firstName: handle, lastName: 'Renter' },
  })
  return row.id
}

/// An account unit with one open rent invoice, and the ledger charge behind it.
async function accountUnit(
  unitTypeId: string,
  tenantId: string,
  number: string,
  startDate: Date,
  dueDate: Date,
): Promise<string> {
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      billingAccountId: accountId,
      status: 'active',
      startDate,
      billingDay: 1,
      monthlyRateCents: 10_000,
    },
  })
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId: lease.id,
      number: `CCA-${number}`,
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
  return lease.id
}

describeDb('a business account pays by card at the counter', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Counter Card Account ${suffix}`,
        slug: `counter-card-account-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const staff = await prisma.staffUser.create({
      data: { email: `cca-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Counter' },
    })
    staffUserId = staff.id

    // The payer holds no unit: the ordinary shape, and the one that proves the
    // money follows the account rather than the payer's own tenancy.
    payerId = await tenant('payer')
    const account = await prisma.billingAccount.create({
      data: { facilityId, name: `Acme Moving ${suffix}`, payerTenantId: payerId },
    })
    accountId = account.id
    olderLeaseId = await accountUnit(
      unitType.id,
      await tenant('foreman'),
      `A-${suffix}`,
      d('2026-06-01'),
      d('2026-08-01'),
    )
    await accountUnit(
      unitType.id,
      await tenant('driver'),
      `B-${suffix}`,
      d('2026-07-01'),
      d('2026-09-01'),
    )
  })

  afterEach(() => {
    charges.length = 0
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // The facility, staff user and payments stay: the cash payment writes an
    // `audit_log` row, which RESTRICTs them and refuses its own DELETE (B-185).
    await prisma.$disconnect()
  })

  it('charges the PAYER, anchored to an open unit, against the whole account balance', async () => {
    const charge = await chargeableAccount(actorAt(facilityId), accountId)
    expect(charge).toMatchObject({
      tenantId: payerId,
      facilityId,
      accountId,
      leaseId: olderLeaseId,
      balanceCents: 20_000,
      tenantName: 'payer Renter',
    })
    expect(charge?.subject).toBe(`Acme Moving ${suffix} (units A-${suffix}, B-${suffix})`)
  })

  it('refuses a staffer with no reach into the account’s facility', async () => {
    await expect(chargeableAccount(actorAt('some-other-facility'), accountId)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('raises the intent for the payer, keyed by the account, at the counter surface', async () => {
    const charge = (await chargeableAccount(actorAt(facilityId), accountId))!
    await startCounterCardPayment(actorAt(facilityId), charge, 5_000)
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({
      tenantId: payerId,
      leaseId: olderLeaseId,
      reference: `counter:account:${accountId}:5000:20000`,
      surface: 'counter',
      saveMethod: false,
    })
  })

  it('settles through the webhook once, and prints the cash receipt’s rows for the same credits', async () => {
    const actor = actorAt(facilityId)
    const charge = (await chargeableAccount(actor, accountId))!
    const setup = await startCounterCardPayment(actor, charge, 5_000)
    if (!setup.available) throw new Error('card setup unavailable')
    const intentId = (await prisma.payment.findUniqueOrThrow({ where: { id: setup.paymentId } }))
      .stripePaymentIntentId!

    const event = {
      id: `evt_cca_${suffix}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: intentId,
          created: Math.floor(Date.now() / 1000),
          metadata: { leaseId: charge.leaseId, tenantId: payerId, facilityId },
        },
      },
    } as unknown as Stripe.Event
    await applyStripeEvent(event)
    // A redelivery is a no-op, so the receipt email goes out once.
    await applyStripeEvent(event)
    expect(
      await prisma.domainEvent.count({
        where: { name: 'payment.succeeded', entityId: setup.paymentId },
      }),
    ).toBe(1)

    const card = (await counterReceipt(actor, setup.paymentId))!
    expect(card).toMatchObject({ method: 'card', receiptNumber: null, tenantId: payerId })
    // The oldest invoice on the account, which is the foreman's unit.
    expect(card.credits).toEqual([
      { leaseId: olderLeaseId, unitNumber: `A-${suffix}`, amountCents: 5_000 },
    ])

    // The same $50 by cash, for the whole account, lands on the same unit —
    // the other half of that invoice. Same credits, so the same unit rows.
    const cash = await recordCounterPayment(actor, {
      facilityId,
      tenantId: payerId,
      leaseId: '',
      accountId,
      restrictToLease: false,
      method: 'cash',
      amountCents: 5_000,
      tenderedCents: 5_000,
      checkNumber: '',
    })
    if (!cash.ok) throw new Error(cash.problem)
    const cashReceipt = (await counterReceipt(actor, cash.paymentId))!
    expect(cashReceipt.credits).toEqual(card.credits)

    const shared = (rows: ReturnType<typeof receiptRows>) =>
      rows.filter((row) => row.label.startsWith('Unit ') || row.label === 'Amount paid')
    expect(shared(receiptRows(card))).toEqual(shared(receiptRows(cashReceipt)))
    expect(receiptRows(card).find((row) => row.label === 'Paid by')?.value).toBe('Card')

    // B-323. The payer's name alone is not filable against the company.
    expect(receiptRows(cashReceipt)[0]).toEqual({ label: 'Account', value: `Acme Moving ${suffix}` })
    expect(receiptRows(cashReceipt)[1].label).toBe('Received from')
  })

  // B-323 / D-15. Every status the enum can hold has a label, and none of them
  // is a snake_case identifier. Fails when a status is added without one.
  it('labels every payment status in words', () => {
    expect(Object.keys(PAYMENT_STATUS_LABEL).sort()).toEqual(Object.values(PaymentStatus).sort())
    for (const label of Object.values(PAYMENT_STATUS_LABEL)) expect(label).not.toMatch(/_/)
  })

  it('still receipts no cash payment the counter did not number', async () => {
    const stray = await prisma.payment.create({
      data: { facilityId, tenantId: payerId, amountCents: 100, method: 'cash', status: 'succeeded' },
    })
    expect(await counterReceipt(actorAt(facilityId), stray.id)).toBeNull()
  })
})
