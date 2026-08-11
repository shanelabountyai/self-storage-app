import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { applyStripeEvent, isHandled } from '../apps/web/lib/payments/reconcile'
import { leasesWithSettlingPayment } from '../apps/web/lib/billing/allocation'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import { portalDashboardForTenant } from '../apps/web/lib/portal/dashboard'

// B-103 / PRD 01 §3. A bank debit is accepted now and can fail four business
// days later, which is the whole reason `processing` exists.
//
// The properties worth a database: an unsettled debit does NOT move the ledger
// or settle an invoice, it DOES buy the tenant silence from late fees and
// dunning, a late bounce raises a task, and none of it disturbs the card path.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitId = ''

const RENT_CENTS = 12_900

function processingEvent(intentId: string, method = 'us_bank_account') {
  return {
    id: `evt_${suffix}_${intentId}_proc`,
    type: 'payment_intent.processing',
    data: { object: { id: intentId, payment_method_types: [method] } },
  } as unknown as Stripe.Event
}

function failedEvent(intentId: string) {
  return {
    id: `evt_${suffix}_${intentId}_fail`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: intentId,
        payment_method_types: ['us_bank_account'],
        last_payment_error: { message: 'Insufficient funds.', code: 'insufficient_funds' },
      },
    },
  } as unknown as Stripe.Event
}

function succeededEvent(intentId: string) {
  return {
    id: `evt_${suffix}_${intentId}_ok`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: intentId,
        created: Math.floor(Date.UTC(2026, 7, 5) / 1000),
        payment_method_types: ['us_bank_account'],
        metadata: { leaseId },
      },
    },
  } as unknown as Stripe.Event
}

async function pendingPayment(intentId: string, amountCents = RENT_CENTS) {
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

describeDb('bank debit settlement (US-703 / §3)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `ACH ${suffix}`,
        slug: `ach-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `ach-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `A-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: RENT_CENTS,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.stripeEvent.deleteMany({ where: { id: { contains: suffix } } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    // Facility stays: `audit_log` RESTRICT-references it.
  })

  it('handles the processing event at all', () => {
    expect(isHandled('payment_intent.processing')).toBe(true)
  })

  it('moves a pending payment to processing and records it as ACH', async () => {
    const payment = await pendingPayment(`pi_${suffix}_1`)
    await applyStripeEvent(processingEvent(`pi_${suffix}_1`))

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(updated.status).toBe('processing')
    // `createChargeIntent` writes every row as `card` because it cannot know
    // what the payer will choose. This is the first moment the truth exists,
    // and the receipt, the deposits report and the tenant's history all read it.
    expect(updated.method).toBe('ach')
  })

  it('posts NOTHING to the ledger while the money is in transit', async () => {
    await pendingPayment(`pi_${suffix}_2`)
    await applyStripeEvent(processingEvent(`pi_${suffix}_2`))

    // An invoice that reads paid on an unsettled debit is a lie the moment the
    // bank reverses it.
    expect(await prisma.ledgerEntry.count({ where: { facilityId } })).toBe(0)
  })

  it('posts to the ledger once it settles', async () => {
    const payment = await pendingPayment(`pi_${suffix}_3`)
    await applyStripeEvent(processingEvent(`pi_${suffix}_3`))
    await applyStripeEvent(succeededEvent(`pi_${suffix}_3`))

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(updated.status).toBe('succeeded')
    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amountCents).toBe(-RENT_CENTS)
  })

  it('does not walk a settled payment back to processing', async () => {
    // Stripe retries for days; `processing` arriving after `succeeded` is an
    // ordinary out-of-order delivery, not a problem.
    await pendingPayment(`pi_${suffix}_4`)
    await applyStripeEvent(succeededEvent(`pi_${suffix}_4`))
    await applyStripeEvent(processingEvent(`pi_${suffix}_4`))

    const updated = await prisma.payment.findFirstOrThrow({
      where: { stripePaymentIntentId: `pi_${suffix}_4` },
    })
    expect(updated.status).toBe('succeeded')
  })

  it('leaves the card path untouched', async () => {
    // The whole feature has to be invisible to a card payment.
    const payment = await pendingPayment(`pi_${suffix}_5`)
    await applyStripeEvent(succeededEvent(`pi_${suffix}_5`))

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(updated.status).toBe('succeeded')
    expect(await prisma.ledgerEntry.count({ where: { leaseId } })).toBe(1)
  })

  describe('a debit that bounces days later', () => {
    it('marks it failed and raises a task', async () => {
      await pendingPayment(`pi_${suffix}_6`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_6`))
      await applyStripeEvent(failedEvent(`pi_${suffix}_6`))

      const updated = await prisma.payment.findFirstOrThrow({
        where: { stripePaymentIntentId: `pi_${suffix}_6` },
      })
      expect(updated.status).toBe('failed')
      expect(updated.failureCode).toBe('insufficient_funds')

      // The tenant has a receipt, may have been let through a gate on it, and
      // is about to start getting dunning letters. That needs a person.
      const task = await prisma.task.findFirst({
        where: { facilityId, type: 'settling_payment_failed' },
      })
      expect(task).not.toBeNull()
      expect(task?.priority).toBe('high')
    })

    it('raises NO task for an ordinary card decline', async () => {
      // A card decline is `failed_payment` (B-046): nobody was ever told the
      // money arrived. Conflating the two would bury the one that matters.
      await pendingPayment(`pi_${suffix}_7`)
      await applyStripeEvent(failedEvent(`pi_${suffix}_7`))

      expect(
        await prisma.task.count({ where: { facilityId, type: 'settling_payment_failed' } }),
      ).toBe(0)
    })

    it('leaves the ledger alone, because nothing was ever posted', async () => {
      await pendingPayment(`pi_${suffix}_8`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_8`))
      await applyStripeEvent(failedEvent(`pi_${suffix}_8`))

      // No reversing entry is needed precisely because `processing` never
      // posted one. That is most of why the state does not post.
      expect(await prisma.ledgerEntry.count({ where: { facilityId } })).toBe(0)
    })
  })

  describe('what a settling payment buys the tenant', () => {
    it('is reported against every lease the tenant holds at that facility', async () => {
      await pendingPayment(`pi_${suffix}_9`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_9`))

      const settling = await leasesWithSettlingPayment(facilityId)
      expect(settling.has(leaseId)).toBe(true)
    })

    it('reports nothing once the debit settles', async () => {
      await pendingPayment(`pi_${suffix}_10`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_10`))
      await applyStripeEvent(succeededEvent(`pi_${suffix}_10`))

      expect((await leasesWithSettlingPayment(facilityId)).size).toBe(0)
    })

    it('stops a late fee being charged while it is in transit', async () => {
      // The money has left their account and nothing they can do makes it
      // arrive faster. A fee for those four days is the most avoidable way to
      // make somebody who paid on time feel cheated.
      await prisma.lateFeeRule.create({
        data: {
          facilityId,
          step: 1,
          daysPastDue: 5,
          amountCents: 2_000,
          basis: 'flat',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      })
      await prisma.invoice.create({
        data: {
          facilityId,
          leaseId,
          kind: 'rent',
          number: `ACH-${suffix}-1`,
          status: 'open',
          issueDate: new Date('2026-08-01T00:00:00Z'),
          dueDate: new Date('2026-08-01T00:00:00Z'),
          periodStart: new Date('2026-08-01T00:00:00Z'),
          periodEnd: new Date('2026-09-01T00:00:00Z'),
          totalCents: RENT_CENTS,
          amountPaidCents: 0,
        },
      })

      const messages: string[] = []
      const record = (outcome: { itemId: string; ok: boolean; message?: string }) => {
        if (outcome.message) messages.push(outcome.message)
      }

      await pendingPayment(`pi_${suffix}_11`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_11`))

      const result = await assessLateFees(facilityId, new Date('2026-08-10T12:00:00Z'), record)
      expect(result.charged).toBe(0)
      expect(messages.some((message) => message.includes('still settling'))).toBe(true)

      await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    })

    it('shows the tenant their money is on its way, beside the balance', async () => {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: RENT_CENTS,
          description: 'Rent',
          occurredAt: new Date('2026-08-01T12:00:00Z'),
        },
      })
      await pendingPayment(`pi_${suffix}_12`)
      await applyStripeEvent(processingEvent(`pi_${suffix}_12`))

      const [summary] = await portalDashboardForTenant(tenantId, new Date('2026-08-10T12:00:00Z'))
      expect(summary.settlingCents).toBe(RENT_CENTS)
      // Beside, not netted off: the money has not arrived, and subtracting it
      // would make the portal disagree with the ledger and every staff screen.
      expect(summary.balanceCents).toBe(RENT_CENTS)
    })
  })
})
