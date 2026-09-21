import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import { emitEvent } from '@storage/core/events'

// B-332. A receipt the tenant walked out holding is not a letter to post.
//
// A no-email tenant's `payment_receipt` for a payment taken at the desk — cash,
// check or money order with a counter receipt number, or a card on the
// counter's Payment Element — still writes its `failed` Message, but raises no
// `no_reachable_channel` task. Everything else a no-email tenant is sent keeps
// the task (D-111, B-318), including a receipt for a card nobody handed over.

vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, paymentsEnabled: () => true, stripeClient: () => ({}) as never }
})

const { recordCounterPayment } = await import('../apps/web/lib/admin/pos')
const { applyStripeEvent } = await import('../apps/web/lib/payments/reconcile')
const { processCommsEvent } = await import('../apps/web/lib/comms/service')

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffUserId = ''
let unitTypeId = ''

function counterActor(): Actor {
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

/// A tenant with no email and one rented unit.
async function noEmailRenter(handle: string) {
  const tenant = await prisma.tenant.create({ data: { firstName: handle, lastName: 'Cash' } })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `${handle}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate: new Date(),
      monthlyRateCents: 9_900,
      billingDay: 1,
    },
  })
  return { tenantId: tenant.id, leaseId: lease.id }
}

const tasksFor = (tenantId: string) =>
  prisma.task.findMany({ where: { facilityId, type: 'no_reachable_channel', entityId: tenantId } })

async function receiptEvent(paymentId: string) {
  return prisma.domainEvent.findFirstOrThrow({
    where: { name: 'payment.succeeded', entityType: 'Payment', entityId: paymentId },
  })
}

/// A card payment settled by the webhook, raised under `reference`.
async function cardPayment(tenantId: string, leaseId: string, reference: string) {
  const intentId = `pi_b332_${randomUUID().slice(0, 12)}`
  const payment = await prisma.payment.create({
    data: {
      facilityId,
      tenantId,
      amountCents: 2_000,
      method: 'card',
      status: 'pending',
      stripePaymentIntentId: intentId,
    },
  })
  await applyStripeEvent({
    id: `evt_b332_${randomUUID().slice(0, 12)}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: intentId,
        created: Math.floor(Date.now() / 1000),
        metadata: { leaseId, tenantId, facilityId, reference },
      },
    },
  } as unknown as Stripe.Event)
  return payment.id
}

describeDb('a counter receipt for a tenant with no email (B-332)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `No Email Receipt ${suffix}`,
        slug: `no-email-receipt-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0132',
      },
    })
    facilityId = facility.id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id
    staffUserId = (
      await prisma.staffUser.create({
        data: { email: `b332-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Counter' },
      })
    ).id
  })

  afterAll(async () => {
    // The facility, staff user and payments stay: the cash payment writes an
    // `audit_log` row, which RESTRICTs them and refuses its own DELETE (B-185).
    await prisma.$disconnect()
  })

  it('records the cash receipt as failed and opens no task — and the same day’s dunning letter still opens one', async () => {
    const { tenantId, leaseId } = await noEmailRenter('Cash')
    const result = await recordCounterPayment(counterActor(), {
      facilityId,
      tenantId,
      leaseId,
      method: 'cash',
      amountCents: 1_000,
      tenderedCents: 1_000,
    })
    if (!result.ok) throw new Error(result.problem)

    const receipt = await receiptEvent(result.paymentId)
    await expect(processCommsEvent(receipt)).resolves.toMatchObject({ failed: 1 })
    const message = await prisma.message.findFirstOrThrow({ where: { eventId: receipt.id } })
    expect(message.status).toBe('failed')
    // Still the letter, should anyone want a copy.
    expect(message.bodySnapshot).not.toBe('')
    expect(await tasksFor(tenantId)).toHaveLength(0)

    // `createTask` keys on (type, tenant, business day). Before B-332 the
    // receipt's task held that slot, so this letter — which genuinely did not
    // arrive — found it taken and opened nothing of its own.
    const dunning = await emitEvent({
      name: 'delinquency.day_reached',
      facilityId,
      entityType: 'Lease',
      entityId: leaseId,
      payload: { invoiceId: `inv-${suffix}`, day: 5, position: 1, totalSteps: 4 },
    })
    await expect(processCommsEvent(dunning)).resolves.toMatchObject({ failed: 1 })
    const [task] = await tasksFor(tenantId)
    expect(task).toMatchObject({ status: 'open', priority: 'high' })
    expect(task.detail).toMatch(/^No email address on file/)
  })

  it('opens no task for a card taken on the counter’s card screen', async () => {
    const { tenantId, leaseId } = await noEmailRenter('Desk')
    const paymentId = await cardPayment(tenantId, leaseId, `counter:${leaseId}:2000:9900`)

    const receipt = await receiptEvent(paymentId)
    expect(receipt.payload).toMatchObject({ counter: true })
    await expect(processCommsEvent(receipt)).resolves.toMatchObject({ failed: 1 })
    expect(await tasksFor(tenantId)).toHaveLength(0)
  })

  it('still opens the task for an autopay charge, and for a card on file — nobody was handed a receipt', async () => {
    for (const [handle, reference] of [
      ['Auto', `autopay:inv-${suffix}:2026-09-21`],
      ['Phone', `counter-cof:lease:2000:9900`],
    ] as const) {
      const { tenantId, leaseId } = await noEmailRenter(handle)
      const paymentId = await cardPayment(tenantId, leaseId, reference)

      const receipt = await receiptEvent(paymentId)
      expect(receipt.payload).not.toHaveProperty('counter')
      await expect(processCommsEvent(receipt)).resolves.toMatchObject({ failed: 1 })
      expect(await tasksFor(tenantId)).toHaveLength(1)
    }
  })
})
