import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyStripeEvent, isHandled, unreconciledEvents } from '../apps/web/lib/payments/reconcile'
import { idempotencyKey, paymentsEnabled } from '../apps/web/lib/payments/stripe'

// B-019 / PRD 01 §7.3.
//
// No network and no Stripe account. Signature verification is pure crypto and
// Stripe ships a helper to sign a payload, so the security-critical half is
// exercised for real; the reconciler is driven with event objects shaped the
// way Stripe sends them.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_checks'
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''

/// Builds a signed request exactly as Stripe would, so `constructEvent` is
/// tested against a real signature rather than a stub.
function signedRequest(event: object, secret = WEBHOOK_SECRET, timestamp?: number) {
  const payload = JSON.stringify(event)
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    ...(timestamp ? { timestamp } : {}),
  })
  return { payload, header }
}

describe('stripe configuration', () => {
  it('reports payments unavailable until both secrets are set', () => {
    // The UI keys off this to decide between a payment step and "call us",
    // which is the honest answer when we cannot actually take a card.
    const before = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET }
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    expect(paymentsEnabled()).toBe(false)

    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    expect(paymentsEnabled(), 'a key with no webhook secret is not enough').toBe(false)

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x'
    expect(paymentsEnabled()).toBe(true)

    if (before.key === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = before.key
    if (before.hook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = before.hook
  })

  it('derives idempotency keys from what the money is for', () => {
    // Never from a timestamp or a random value: a fresh key on retry is the
    // double-charge that idempotency exists to prevent.
    expect(idempotencyKey('charge', 'invoice-42')).toBe('charge:invoice-42')
    expect(idempotencyKey('charge', 'invoice-42')).toBe(idempotencyKey('charge', 'invoice-42'))
  })
})

describe('webhook signature verification', () => {
  const event = { id: 'evt_test', type: 'payment_intent.succeeded', data: { object: {} } }

  it('accepts a genuine Stripe signature', () => {
    const { payload, header } = signedRequest(event)
    const verified = Stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET)
    expect(verified.id).toBe('evt_test')
  })

  it('rejects a payload that was tampered with after signing', () => {
    // The whole point: this endpoint is public and unauthenticated, so without
    // verification anyone could post "payment succeeded".
    const { header } = signedRequest(event)
    const tampered = JSON.stringify({ ...event, data: { object: { amount: 999_999 } } })
    expect(() => Stripe.webhooks.constructEvent(tampered, header, WEBHOOK_SECRET)).toThrow()
  })

  it('rejects a signature made with a different secret', () => {
    const { payload, header } = signedRequest(event, 'whsec_someone_elses_secret')
    expect(() => Stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET)).toThrow()
  })

  it('rejects a replayed capture of a genuine old delivery', () => {
    // Signed correctly, but hours ago. Stripe's tolerance check is what stops
    // someone re-posting a captured success later.
    const hoursAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 6
    const { payload, header } = signedRequest(event, WEBHOOK_SECRET, hoursAgo)
    expect(() => Stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET)).toThrow()
  })
})

describe('handled event set', () => {
  it('knows what it acts on', () => {
    expect(isHandled('payment_intent.succeeded')).toBe(true)
    expect(isHandled('charge.refunded')).toBe(true)
    // Not an error — recorded and acknowledged, because a non-2xx would make
    // Stripe retry something we were never going to process.
    expect(isHandled('customer.subscription.created')).toBe(false)
  })
})

describeDb('reconciliation into the ledger', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Stripe Test',
        slug: `stripe-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: {
        email: `stripe-${suffix}@example.com`,
        firstName: 'Pat',
        lastName: 'Payer',
      },
    })
    tenantId = tenant.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_${suffix}` } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_${suffix}` } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function pendingPayment(intentId: string, amountCents = 15_400) {
    return prisma.payment.create({
      data: {
        facilityId,
        tenantId,
        amountCents,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: intentId,
      },
    })
  }

  const succeededEvent = (intentId: string) =>
    ({
      id: `evt_${suffix}_ok`,
      type: 'payment_intent.succeeded',
      data: { object: { id: intentId, created: Math.floor(Date.now() / 1000) } },
    }) as unknown as Stripe.Event

  it('marks a pending payment succeeded', async () => {
    const intentId = `pi_${suffix}_1`
    const payment = await pendingPayment(intentId)

    await applyStripeEvent(succeededEvent(intentId))

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(updated.status).toBe('succeeded')
  })

  it('is a no-op when the same event is applied twice', async () => {
    // Stripe delivers at-least-once and retries for days. Applying the same
    // success twice must not post the payment to the ledger twice.
    const intentId = `pi_${suffix}_2`
    const payment = await pendingPayment(intentId)

    await applyStripeEvent(succeededEvent(intentId))
    await applyStripeEvent(succeededEvent(intentId))

    // Scoped to this payment rather than the facility: a facility-wide count
    // silently folds in every other test's events and passes for the wrong
    // reason.
    const events = await prisma.domainEvent.findMany({
      where: { entityId: payment.id, name: 'payment.succeeded' },
    })
    expect(events).toHaveLength(1)
  })

  it('records a payment with no lease rather than inventing one', async () => {
    // Ledger entries require a lease and nothing creates one until B-021. A
    // payment we cannot post is left visible, not attached to a lease it does
    // not have.
    const intentId = `pi_${suffix}_3`
    const payment = await pendingPayment(intentId)

    await applyStripeEvent(succeededEvent(intentId))

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe('succeeded')
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0)
  })

  it('posts a payment to the ledger as a negative amount when a lease exists', async () => {
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `S-${suffix}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })

    const intentId = `pi_${suffix}_4`
    const payment = await pendingPayment(intentId, 15_400)
    await applyStripeEvent(succeededEvent(intentId))

    const entries = await prisma.ledgerEntry.findMany({ where: { paymentId: payment.id } })
    expect(entries).toHaveLength(1)
    // A payment reduces what is owed, so it is stored negative (see the enum).
    expect(entries[0].amountCents).toBe(-15_400)
    expect(entries[0].leaseId).toBe(lease.id)

    // And a redelivery must not credit them twice.
    await applyStripeEvent(succeededEvent(intentId))
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1)

    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { id: lease.id } })
  })

  it('records a decline with the reason a manager will need', async () => {
    const intentId = `pi_${suffix}_5`
    const payment = await pendingPayment(intentId)

    await applyStripeEvent({
      id: `evt_${suffix}_fail`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: intentId,
          last_payment_error: { message: 'Your card was declined.', code: 'card_declined' },
        },
      },
    } as unknown as Stripe.Event)

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(updated.status).toBe('failed')
    expect(updated.failureReason).toBe('Your card was declined.')
  })

  it('never downgrades a succeeded payment to failed', async () => {
    // Events can arrive out of order. A late failure for a payment we have
    // already seen succeed must not un-pay it.
    const intentId = `pi_${suffix}_6`
    const payment = await pendingPayment(intentId)
    await applyStripeEvent(succeededEvent(intentId))

    await applyStripeEvent({
      id: `evt_${suffix}_late`,
      type: 'payment_intent.payment_failed',
      data: { object: { id: intentId, last_payment_error: { message: 'late' } } },
    } as unknown as Stripe.Event)

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe('succeeded')
  })

  it('distinguishes a partial refund from a full one', async () => {
    const intentId = `pi_${suffix}_7`
    const payment = await pendingPayment(intentId, 10_000)

    await applyStripeEvent({
      id: `evt_${suffix}_refund_part`,
      type: 'charge.refunded',
      data: { object: { payment_intent: intentId, amount: 10_000, amount_refunded: 2_500 } },
    } as unknown as Stripe.Event)
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe('partially_refunded')

    // Stripe reports the running total, so the second refund carries the sum.
    await applyStripeEvent({
      id: `evt_${suffix}_refund_full`,
      type: 'charge.refunded',
      data: { object: { payment_intent: intentId, amount: 10_000, amount_refunded: 10_000 } },
    } as unknown as Stripe.Event)
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe('refunded')
  })

  it('saves the default payment method from a setup intent', async () => {
    await applyStripeEvent({
      id: `evt_${suffix}_setup`,
      type: 'setup_intent.succeeded',
      data: { object: { payment_method: 'pm_test_123', metadata: { tenantId } } },
    } as unknown as Stripe.Event)

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    expect(tenant.stripeDefaultPaymentMethodId).toBe('pm_test_123')
  })

  it('ignores a payment intent it has no record of', async () => {
    // A replay, or another environment sharing the Stripe account. Not a crash.
    await expect(applyStripeEvent(succeededEvent(`pi_${suffix}_unknown`))).resolves.toBeUndefined()
  })

  it('surfaces accepted-but-unprocessed events as the reconciliation gap', async () => {
    await prisma.stripeEvent.create({
      data: { id: `evt_${suffix}_stuck`, type: 'payment_intent.succeeded', payload: {} },
    })
    const gap = await unreconciledEvents()
    expect(gap.map((e) => e.id)).toContain(`evt_${suffix}_stuck`)
  })
})

// B-147 / PRD 02 §4.5 US-46. Card disputes.
//
// `HANDLED_EVENTS` covered five Stripe events and no `charge.dispute.*`, so a
// chargeback was something the operator learned about from a bank statement:
// the money was out of the account and recorded here as collected, forever.
//
// Its own block rather than rows in the one above, because these need a lease
// and an invoice to have anything to reverse, and the block above deliberately
// tears its lease down inside the one test that makes one.
describeDb('card disputes', () => {
  const dsuffix = randomUUID().slice(0, 8)
  let dFacilityId = ''
  let dTenantId = ''
  let dLeaseId = ''
  let dUnitTypeId = ''
  let invoiceCounter = 0

  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Dispute Test',
        slug: `dispute-${dsuffix}`,
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    dFacilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: {
        email: `dispute-${dsuffix}@example.com`,
        firstName: 'Dee',
        lastName: 'Disputer',
      },
    })
    dTenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId: dFacilityId, name: `10x10 ${dsuffix}`, widthFt: 10, lengthFt: 10 },
    })
    dUnitTypeId = unitType.id
    const unit = await prisma.unit.create({
      data: { facilityId: dFacilityId, unitTypeId: unitType.id, number: `D-${dsuffix}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId: dFacilityId,
        tenantId: dTenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    dLeaseId = lease.id
  })

  // Every test here builds its own settled invoice, and `applyPayment`
  // allocates across every OPEN invoice the tenant has. Left standing, one
  // test's re-opened invoice absorbs the next test's payment and the fixture
  // assertion fails for a reason that has nothing to do with disputes.
  beforeEach(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.paymentAllocation.deleteMany({
      where: { payment: { facilityId: dFacilityId } },
    })
    await prisma.payment.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId: dFacilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: dFacilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.lease.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.unit.deleteMany({ where: { facilityId: dFacilityId } })
    await prisma.unitType.deleteMany({ where: { id: dUnitTypeId } })
    await prisma.tenant.deleteMany({ where: { id: dTenantId } })
    // The facility deliberately stays. `payment.returned` and
    // `payment.reinstated` write audit rows that reference it, and `audit_log`
    // is append-only — the database itself refuses the DELETE, so there is no
    // way to drop the parent. Same as `refunds-db.test.ts`, for the same reason.
    await prisma.$disconnect()
  })

  /// A rent invoice, paid in full by a card payment that reached `succeeded`
  /// through the ordinary webhook path — which is the only state a dispute can
  /// arrive against.
  async function settledRent(intentId: string, amountCents = 12_900) {
    invoiceCounter += 1
    // `(leaseId, periodStart)` is unique, so each test gets its own month.
    const due = new Date(Date.UTC(2026, invoiceCounter, 1))
    const invoice = await prisma.invoice.create({
      data: {
        facilityId: dFacilityId,
        leaseId: dLeaseId,
        number: `DP${dsuffix}${String(invoiceCounter).padStart(3, '0')}`,
        kind: 'rent',
        status: 'open',
        issueDate: due,
        dueDate: due,
        periodStart: due,
        periodEnd: new Date(Date.UTC(2026, invoiceCounter + 1, 0)),
        subtotalCents: amountCents,
        totalCents: amountCents,
        lineItems: {
          create: [
            {
              type: 'rent',
              description: 'Rent',
              quantity: 1,
              unitAmountCents: amountCents,
              amountCents,
            },
          ],
        },
      },
    })
    const payment = await prisma.payment.create({
      data: {
        facilityId: dFacilityId,
        tenantId: dTenantId,
        amountCents,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: intentId,
      },
    })
    await applyStripeEvent({
      id: `evt_${dsuffix}_ok_${invoiceCounter}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: intentId, created: Math.floor(Date.now() / 1000) } },
    } as unknown as Stripe.Event)

    const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(settled.status, 'fixture: the payment must have settled the invoice').toBe('paid')
    return { paymentId: payment.id, invoiceId: invoice.id, dueDate: due }
  }

  const disputeEvent = (
    id: string,
    type: 'charge.dispute.created' | 'charge.dispute.closed',
    intentId: string,
    status: string,
  ) =>
    ({
      id,
      type,
      data: {
        object: {
          id: `dp_${dsuffix}`,
          payment_intent: intentId,
          status,
          reason: 'fraudulent',
        },
      },
    }) as unknown as Stripe.Event

  it('is in the handled set', () => {
    // The whole defect in one assertion: these two were absent, so the default
    // branch recorded them and acknowledged them and nothing else happened.
    expect(isHandled('charge.dispute.created')).toBe(true)
    expect(isHandled('charge.dispute.closed')).toBe(true)
  })

  it('reverses the payment and raises the queue card when a dispute opens', async () => {
    const intentId = `pi_${dsuffix}_open`
    const { paymentId, invoiceId, dueDate } = await settledRent(intentId)

    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d1`, 'charge.dispute.created', intentId, 'needs_response'))

    // The money is gone from the account, so it must be gone from the ledger.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    expect(payment.status).toBe('returned')

    const original = await prisma.ledgerEntry.findFirstOrThrow({
      where: { paymentId, type: 'payment' },
    })
    const reversal = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { reversalOfId: original.id },
    })
    // FR-8: append-only. The original stands and the correction points at it.
    expect(original.amountCents).toBe(-12_900)
    expect(reversal.amountCents).toBe(12_900)

    // And the arrears are visible again — the invoice re-opens with its
    // ORIGINAL due date, so ageing does not restart today (D-25).
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(invoice.status).toBe('open')
    expect(invoice.amountPaidCents).toBe(0)
    expect(invoice.dueDate).toEqual(dueDate)

    const task = await prisma.task.findFirst({
      where: { entityId: paymentId, type: 'settling_payment_failed' },
    })
    expect(task?.status).toBe('open')
    expect(task?.priority).toBe('high')
  })

  it('does not reverse twice when Stripe redelivers the dispute', async () => {
    // Stripe delivers at-least-once and retries for days; the StripeEvent row
    // is the outer guard, but `applyStripeEvent` must be safe on its own.
    const intentId = `pi_${dsuffix}_twice`
    const { paymentId } = await settledRent(intentId)

    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d2a`, 'charge.dispute.created', intentId, 'needs_response'))
    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d2b`, 'charge.dispute.created', intentId, 'needs_response'))

    const entries = await prisma.ledgerEntry.findMany({
      where: { paymentId, type: 'adjustment' },
    })
    expect(entries).toHaveLength(1)
  })

  it('leaves the reversal standing when the dispute is lost', async () => {
    const intentId = `pi_${dsuffix}_lost`
    const { paymentId, invoiceId } = await settledRent(intentId)

    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d3a`, 'charge.dispute.created', intentId, 'needs_response'))
    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d3b`, 'charge.dispute.closed', intentId, 'lost'))

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status,
    ).toBe('returned')
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    ).toBe('open')
    // Still one adjustment: losing posts nothing new, because `created`
    // already told the truth.
    expect(
      await prisma.ledgerEntry.count({ where: { paymentId, type: 'adjustment' } }),
    ).toBe(1)
  })

  it('reinstates the payment when the dispute is won', async () => {
    const intentId = `pi_${dsuffix}_won`
    const { paymentId, invoiceId } = await settledRent(intentId)

    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d4a`, 'charge.dispute.created', intentId, 'needs_response'))
    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d4b`, 'charge.dispute.closed', intentId, 'won'))

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status,
    ).toBe('succeeded')
    // The invoice is settled again, by re-allocation rather than by rewriting
    // anything the reversal did.
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(invoice.status).toBe('paid')
    expect(invoice.amountPaidCents).toBe(12_900)

    // Three entries, none edited: the payment, its reversal, and the reversal
    // of the reversal. They net to exactly one payment's worth of credit, which
    // is the balance the tenant had before anyone disputed anything.
    const balance = await prisma.ledgerEntry.aggregate({
      where: { paymentId },
      _sum: { amountCents: true },
    })
    expect(balance._sum.amountCents).toBe(-12_900)
    expect(await prisma.ledgerEntry.count({ where: { paymentId } })).toBe(3)

    // Staff must not be left chasing a tenant who owes nothing.
    const task = await prisma.task.findFirst({
      where: { entityId: paymentId, type: 'settling_payment_failed' },
    })
    expect(task?.status).toBe('cancelled')

    // And a redelivered win must not post a second credit.
    await applyStripeEvent(disputeEvent(`evt_${dsuffix}_d4c`, 'charge.dispute.closed', intentId, 'won'))
    expect(await prisma.ledgerEntry.count({ where: { paymentId } })).toBe(3)
  })

  it('does not reverse an early-warning inquiry, but does raise it', async () => {
    // `warning_needs_response` is a card network inquiry, not a withdrawal —
    // the funds are still ours. Reversing would re-open the invoice and start
    // dunning a tenant over money we still hold.
    const intentId = `pi_${dsuffix}_warning`
    const { paymentId, invoiceId } = await settledRent(intentId)

    await applyStripeEvent(
      disputeEvent(`evt_${dsuffix}_d5a`, 'charge.dispute.created', intentId, 'warning_needs_response'),
    )

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status,
    ).toBe('succeeded')
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    ).toBe('paid')
    // It still needs a person: the inquiry is a real signal and nothing else in
    // the product would ever mention it.
    expect(
      (await prisma.task.findFirst({
        where: { entityId: paymentId, type: 'settling_payment_failed' },
      }))?.status,
    ).toBe('open')

    // Closing a warning reinstates nothing, because nothing was reversed.
    await applyStripeEvent(
      disputeEvent(`evt_${dsuffix}_d5b`, 'charge.dispute.closed', intentId, 'warning_closed'),
    )
    expect(await prisma.ledgerEntry.count({ where: { paymentId, type: 'adjustment' } })).toBe(0)
  })

  it('raises the queue card for a dispute on a payment with no lease', async () => {
    // A merchandise sale, or a payment posted against no lease. There is
    // nothing on a lease ledger to reverse and inventing an entry would attach
    // the money to a lease it never touched — but the money is still gone.
    const intentId = `pi_${dsuffix}_nolease`
    const payment = await prisma.payment.create({
      data: {
        facilityId: dFacilityId,
        tenantId: dTenantId,
        amountCents: 2_500,
        method: 'card',
        status: 'succeeded',
        stripePaymentIntentId: intentId,
      },
    })

    await applyStripeEvent(
      disputeEvent(`evt_${dsuffix}_d6`, 'charge.dispute.created', intentId, 'needs_response'),
    )

    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0)
    expect(
      (await prisma.task.findFirst({
        where: { entityId: payment.id, type: 'settling_payment_failed' },
      }))?.status,
    ).toBe('open')
  })

  it('ignores a dispute for a payment intent it has no record of', async () => {
    await expect(
      applyStripeEvent(
        disputeEvent(`evt_${dsuffix}_d7`, 'charge.dispute.created', `pi_${dsuffix}_ghost`, 'needs_response'),
      ),
    ).resolves.toBeUndefined()
  })
})
