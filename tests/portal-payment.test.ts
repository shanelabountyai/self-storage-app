import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyStripeEvent } from '../apps/web/lib/payments/reconcile'
import {
  MIN_PAYMENT_CENTS,
  payableLease,
  paymentReceipt,
  validatePaymentAmount,
} from '../apps/web/lib/portal/payment'

// B-035 / PRD 01 §4.7 US-703.

describe('validatePaymentAmount', () => {
  const BALANCE = 16_100 // $161.00

  it('accepts the full balance', () => {
    expect(validatePaymentAmount('161', BALANCE)).toEqual({ ok: true, amountCents: 16_100 })
    expect(validatePaymentAmount('161.00', BALANCE)).toEqual({ ok: true, amountCents: 16_100 })
  })

  it('accepts a part payment', () => {
    expect(validatePaymentAmount('50', BALANCE)).toEqual({ ok: true, amountCents: 5_000 })
    expect(validatePaymentAmount('50.25', BALANCE)).toEqual({ ok: true, amountCents: 5_025 })
  })

  it('accepts what a human actually types', () => {
    expect(validatePaymentAmount('  $50.25 ', BALANCE)).toEqual({ ok: true, amountCents: 5_025 })
    expect(validatePaymentAmount('$1,610.50', 200_000)).toEqual({ ok: true, amountCents: 161_050 })
  })

  it('converts cents without floating point', () => {
    // Math.round(parseFloat('16.10') * 100) is the classic way this goes wrong.
    // Every one of these must land on an exact integer number of cents.
    expect(validatePaymentAmount('16.10', BALANCE)).toEqual({ ok: true, amountCents: 1_610 })
    expect(validatePaymentAmount('0.07', BALANCE).ok).toBe(false) // below minimum, not a rounding fault
    expect(validatePaymentAmount('19.99', BALANCE)).toEqual({ ok: true, amountCents: 1_999 })
    expect(validatePaymentAmount('1.1', BALANCE)).toEqual({ ok: true, amountCents: 110 })
  })

  it('refuses more than is owed', () => {
    // The fat-finger case: $1,610.00 typed for $16.10. Refusing is the cheap
    // direction to be wrong in, and a credit balance has nothing to spend it
    // on until invoicing exists.
    expect(validatePaymentAmount('1610', BALANCE)).toEqual({ ok: false, problem: 'above_balance' })
    expect(validatePaymentAmount('161.01', BALANCE)).toEqual({ ok: false, problem: 'above_balance' })
  })

  it('refuses less than the minimum', () => {
    expect(validatePaymentAmount('0.99', BALANCE)).toEqual({ ok: false, problem: 'below_minimum' })
    expect(validatePaymentAmount('0', BALANCE)).toEqual({ ok: false, problem: 'below_minimum' })
    expect(validatePaymentAmount(String(MIN_PAYMENT_CENTS / 100), BALANCE).ok).toBe(true)
  })

  it('refuses anything that is not a plain amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1.2.3', '1e3', '  ', 'NaN', 'Infinity']) {
      expect(validatePaymentAmount(bad, BALANCE), `accepted ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        problem: 'not_a_number',
      })
    }
  })

  it('refuses any payment when nothing is owed, whatever the input', () => {
    expect(validatePaymentAmount('50', 0)).toEqual({ ok: false, problem: 'nothing_owed' })
    expect(validatePaymentAmount('50', -500)).toEqual({ ok: false, problem: 'nothing_owed' })
  })
})

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseAId = ''
let leaseBId = ''

describeDb('portal payment against real records', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Pay Portal Test',
        slug: `pay-portal-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const [tenant, other] = await Promise.all([
      prisma.tenant.create({
        data: { email: `pay-portal-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
      }),
      prisma.tenant.create({
        data: { email: `pay-other-${suffix}@example.com`, firstName: 'Bo', lastName: 'Other' },
      }),
    ])
    tenantId = tenant.id
    otherTenantId = other.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const [unitA, unitB] = await Promise.all([
      prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'A-1' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'B-2' } }),
    ])

    // Two units, one tenant, one facility — the case that made guessing the
    // lease from (tenant, facility) a way to credit the wrong unit.
    const [a, b] = await Promise.all([
      prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unitA.id,
          status: 'active',
          startDate: new Date('2026-01-01T00:00:00Z'),
          monthlyRateCents: 12_900,
          billingDay: 1,
        },
      }),
      prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unitB.id,
          status: 'active',
          // Deliberately the LATER start date, so it is the one the fallback
          // ("most recent") would pick.
          startDate: new Date('2026-06-01T00:00:00Z'),
          monthlyRateCents: 15_900,
          billingDay: 1,
        },
      }),
    ])
    leaseAId = a.id
    leaseBId = b.id

    await prisma.ledgerEntry.createMany({
      data: [
        { facilityId, leaseId: leaseAId, type: 'charge', amountCents: 12_900, description: 'Rent A' },
        { facilityId, leaseId: leaseBId, type: 'charge', amountCents: 15_900, description: 'Rent B' },
      ],
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  describe('payableLease', () => {
    it('returns the lease and its balance for the tenant who holds it', async () => {
      const lease = await payableLease(tenantId, leaseAId)
      expect(lease).toMatchObject({ leaseId: leaseAId, unitNumber: 'A-1', balanceCents: 12_900 })
    })

    it('refuses a lease belonging to someone else', async () => {
      // The whole authorization story for this flow: the lease id is in the
      // URL, so the only thing stopping one tenant paying against another
      // tenant's lease is this check.
      expect(await payableLease(otherTenantId, leaseAId)).toBeNull()
    })

    it('refuses a lease that does not exist', async () => {
      expect(await payableLease(tenantId, 'nope-not-a-lease')).toBeNull()
    })

    it('refuses an ended lease', async () => {
      const unitType = await prisma.unitType.findFirstOrThrow({ where: { facilityId } })
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `E-${suffix.slice(0, 3)}` },
      })
      const ended = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'ended',
          startDate: new Date('2025-01-01T00:00:00Z'),
          endDate: new Date('2025-06-01T00:00:00Z'),
          monthlyRateCents: 9_900,
          billingDay: 1,
        },
      })
      expect(await payableLease(tenantId, ended.id)).toBeNull()
      await prisma.lease.delete({ where: { id: ended.id } })
      await prisma.unit.delete({ where: { id: unit.id } })
    })
  })

  describe('ledger attribution', () => {
    const succeeded = (intentId: string, metadata: Record<string, string>) =>
      ({
        id: `evt_${suffix}_${intentId}`,
        type: 'payment_intent.succeeded',
        data: {
          object: { id: intentId, created: Math.floor(Date.now() / 1000), metadata },
        },
      }) as unknown as Stripe.Event

    async function pending(intentId: string, amountCents: number) {
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

    it('credits the lease the payer actually chose, not the most recent one', async () => {
      // The bug this fix exists for: without an explicit lease, a payment for
      // unit A-1 would have been credited to B-2 purely because B-2 started
      // later.
      const intentId = `pi_${suffix}_explicit`
      const payment = await pending(intentId, 5_000)

      await applyStripeEvent(succeeded(intentId, { leaseId: leaseAId }))

      const entry = await prisma.ledgerEntry.findFirstOrThrow({
        where: { paymentId: payment.id },
      })
      expect(entry.leaseId).toBe(leaseAId)
      expect(entry.amountCents, 'a payment reduces the balance').toBe(-5_000)
    })

    it('posts nothing when the stated lease belongs to a different tenant', async () => {
      // The metadata came back through Stripe. A lease id that does not
      // belong to this payment's tenant is not something to move money on.
      const otherUnitType = await prisma.unitType.findFirstOrThrow({ where: { facilityId } })
      const otherUnit = await prisma.unit.create({
        data: { facilityId, unitTypeId: otherUnitType.id, number: `X-${suffix.slice(0, 3)}` },
      })
      const foreign = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: otherTenantId,
          unitId: otherUnit.id,
          status: 'active',
          startDate: new Date('2026-01-01T00:00:00Z'),
          monthlyRateCents: 10_000,
          billingDay: 1,
        },
      })

      const intentId = `pi_${suffix}_foreign`
      const payment = await pending(intentId, 5_000)
      await applyStripeEvent(succeeded(intentId, { leaseId: foreign.id }))

      expect(
        await prisma.ledgerEntry.count({ where: { paymentId: payment.id } }),
        'money moved onto a lease the payer does not hold',
      ).toBe(0)
      // Still recorded as received — an unposted payment is visible in
      // reconciliation, which is the point.
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'succeeded',
      )

      await prisma.lease.delete({ where: { id: foreign.id } })
      await prisma.unit.delete({ where: { id: otherUnit.id } })
    })

    it('still falls back to the occupying lease when no lease is stated', async () => {
      // Move-in (B-025) charges before its lease exists and states none, so
      // the fallback has to keep working exactly as it did.
      const intentId = `pi_${suffix}_fallback`
      const payment = await pending(intentId, 2_500)

      await applyStripeEvent(succeeded(intentId, {}))

      const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: payment.id } })
      expect(entry.leaseId, 'the most recently started occupying lease').toBe(leaseBId)
    })

    it('does not double-credit when Stripe redelivers the same success', async () => {
      const intentId = `pi_${suffix}_replay`
      const payment = await pending(intentId, 1_000)

      await applyStripeEvent(succeeded(intentId, { leaseId: leaseAId }))
      await applyStripeEvent(succeeded(intentId, { leaseId: leaseAId }))

      expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1)
    })
  })

  describe('paymentReceipt', () => {
    it('reports a payment the webhook has not confirmed yet as pending, not paid', async () => {
      const payment = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 5_000,
          method: 'card',
          status: 'pending',
          stripePaymentIntentId: `pi_${suffix}_receipt_pending`,
        },
      })
      const receipt = await paymentReceipt(tenantId, payment.id)
      expect(receipt).toMatchObject({ status: 'pending', amountCents: 5_000 })
    })

    it('refuses to show one tenant another tenant’s receipt', async () => {
      const payment = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 5_000,
          method: 'card',
          status: 'succeeded',
          stripePaymentIntentId: `pi_${suffix}_receipt_scoped`,
        },
      })
      expect(await paymentReceipt(otherTenantId, payment.id)).toBeNull()
    })
  })
})
