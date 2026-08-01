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
