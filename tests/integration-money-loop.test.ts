import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { requireStripe } from '../apps/web/lib/payments/stripe'
import { ensureStripeCustomer } from '../apps/web/lib/payments/customers'
import { generateInvoices } from '../apps/web/lib/billing/invoices'
import { runAutopay } from '../apps/web/lib/billing/autopay'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import { evaluateAccessSuspensions } from '../apps/web/lib/access/delinquency-gate'
import { runDunning } from '../apps/web/lib/billing/dunning'
import { DEFAULT_LATE_FEE_STEPS } from '../packages/core/billing'

// The integration pass: one lease driven through the whole money loop against
// REAL Stripe test mode, with real webhooks arriving over `stripe listen`.
//
// Every component below is already unit-tested in isolation. What has never
// been exercised is the chain — nine nightly jobs in sequence, a real
// off-session charge, a real decline, and the webhook that turns each of them
// into a settled ledger. Every defect found this session lived at a seam like
// these, so this is the test shaped like the bugs.
//
// ── Opt-in, deliberately ─────────────────────────────────────────────────────
//
// Skipped unless RUN_LIVE_INTEGRATION=1. It makes real Stripe API calls, needs
// the dev server on :3000 AND `stripe listen --forward-to
// localhost:3000/api/stripe/webhook` running, and takes ~35s. None of that
// belongs in the suite a person runs after changing a line — a test that needs
// two background processes is one that fails for reasons unrelated to the
// change, and a red suite nobody trusts is worse than no suite.
//
// Run it with:
//   npm run test:integration
//
// Setup it assumes:
//   npm run dev
//   STRIPE_API_KEY=$(grep ^STRIPE_SECRET_KEY= .env.local | cut -d= -f2-) \
//     stripe listen --forward-to localhost:3000/api/stripe/webhook
// The listener issues a NEW whsec_ each start — put it on STRIPE_WEBHOOK_SECRET
// or every webhook fails signature verification and nothing settles.

const ready =
  process.env.RUN_LIVE_INTEGRATION === '1' &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.STRIPE_SECRET_KEY) &&
  Boolean(process.env.STRIPE_WEBHOOK_SECRET)
const describeLive = ready ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const noop = () => {}
const log: string[] = []
const record = (o: { itemId: string; ok: boolean; message?: string }) => {
  if (o.message) log.push(o.message)
}

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let grantId = ''
let staffId = ''

/// Waits for the webhook to land. The charge returns as soon as Stripe accepts
/// it; the ledger only moves when the event comes back over `stripe listen`,
/// which is the whole point of running this against a live listener.
async function awaitPaymentStatus(
  paymentId: string,
  status: string,
  timeoutMs = 45_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    last = payment.status
    if (payment.status === status) return status
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return `TIMED OUT (last seen: ${last})`
}

async function attachCard(token: string): Promise<void> {
  const stripe = requireStripe()
  const customerId = await ensureStripeCustomer(tenantId)
  const method = await stripe.paymentMethods.attach(token, { customer: customerId })
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: method.id },
  })
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeDefaultPaymentMethodId: method.id },
  })
}

describeLive('money loop, end to end against real Stripe', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Integration ${suffix}`,
        slug: `integration-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    for (const step of DEFAULT_LATE_FEE_STEPS) {
      await prisma.lateFeeRule.create({
        data: { facilityId, ...step, effectiveFrom: d('2020-01-01') },
      })
    }

    const tenant = await prisma.tenant.create({
      data: { email: `integration-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `integration-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'INT-1' } })

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-08-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
        autopayEnabled: true,
      },
    })
    leaseId = lease.id

    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'active', stateCause: 'system:move_in' },
    })
    grantId = grant.id

    await attachCard('pm_card_visa')
  }, 120_000)

  afterAll(async () => {
    if (!ready) return
    console.info('\n--- run log ---\n' + log.join('\n'))
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    await prisma.invoiceCounter.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  }, 120_000)

  it('phase 1: generates September rent five days ahead', async () => {
    await generateInvoices(facilityId, d('2026-08-27'), record)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'rent' } })
    expect(invoice.totalCents).toBe(12_900)
    expect(invoice.dueDate.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(invoice.status).toBe('open')
  })

  it('phase 2: charges a real card off-session, and the webhook settles it', async () => {
    await runAutopay(facilityId, d('2026-09-01'), record)

    const payment = await prisma.payment.findFirstOrThrow({
      where: { facilityId, method: 'card' },
      orderBy: { createdAt: 'desc' },
    })
    // A real PaymentIntent exists at Stripe.
    expect(payment.stripePaymentIntentId).toMatch(/^pi_/)

    // The ledger only moves when the webhook comes back.
    expect(await awaitPaymentStatus(payment.id, 'succeeded')).toBe('succeeded')

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'rent' } })
    expect(invoice.status).toBe('paid')
    expect(invoice.amountPaidCents).toBe(12_900)

    const allocation = await prisma.paymentAllocation.findFirstOrThrow({
      where: { paymentId: payment.id },
    })
    expect(allocation.amountCents).toBe(12_900)

    const balance = await prisma.ledgerEntry.aggregate({
      where: { leaseId },
      _sum: { amountCents: true },
    })
    expect(balance._sum.amountCents).toBe(0)
  }, 120_000)

  it('phase 3: October declines on a real card, and the retry ladder starts', async () => {
    await generateInvoices(facilityId, d('2026-09-26'), record)
    // A card that attaches fine and fails when charged — exactly the shape the
    // retry ladder exists for.
    await attachCard('pm_card_chargeCustomerFail')

    await runAutopay(facilityId, d('2026-10-01'), record)

    const failed = await prisma.payment.findFirstOrThrow({
      where: { facilityId, status: 'failed' },
      orderBy: { createdAt: 'desc' },
    })
    // Stripe's own decline code, which is what B-046 branches on.
    expect(failed.failureCode).toBeTruthy()

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { facilityId, name: 'payment.failed' },
      orderBy: { occurredAt: 'desc' },
    })
    expect((event.payload as { source: string }).source).toBe('autopay')
  }, 120_000)

  it('phase 4: the second decline flags a manager, and retries follow +1/+3/+5', async () => {
    await runAutopay(facilityId, d('2026-10-02'), record)

    const task = await prisma.task.findFirstOrThrow({
      where: { facilityId, type: 'failed_payment' },
    })
    expect(task.priority).toBe('high')

    // Day +2 is not a retry day.
    const before = await prisma.payment.count({ where: { facilityId, status: 'failed' } })
    await runAutopay(facilityId, d('2026-10-03'), record)
    expect(await prisma.payment.count({ where: { facilityId, status: 'failed' } })).toBe(before)

    // +3 is.
    await runAutopay(facilityId, d('2026-10-04'), record)
    expect(await prisma.payment.count({ where: { facilityId, status: 'failed' } })).toBe(before + 1)
  }, 180_000)

  it('phase 5: a late fee lands on day 5, on its own invoice', async () => {
    await assessLateFees(facilityId, d('2026-10-06'), record)

    const fee = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'fee' } })
    // Greater of $20 or 10% of $129 → $20.
    expect(fee.totalCents).toBe(2_000)
  })

  it('phase 6: access is suspended on day 6, and the gate is told', async () => {
    await evaluateAccessSuspensions(facilityId, d('2026-10-07'), record)

    const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
    expect(grant.state).toBe('suspended')

    const command = await prisma.gateCommand.findFirstOrThrow({
      where: { facilityId, type: 'suspend_access' },
    })
    expect(command.id).toBeTruthy()
  })

  it('phase 7: the dunning ladder chases on 1, 5 and 10', async () => {
    await runDunning(facilityId, d('2026-10-11'), record)

    const days = (
      await prisma.domainEvent.findMany({
        where: { facilityId, name: 'delinquency.day_reached' },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((event) => Number((event.payload as { day: number }).day))
    expect(days).toEqual([1, 5, 10])
  })

  it('phase 8: a good card clears everything and access comes back', async () => {
    await attachCard('pm_card_visa')
    await runAutopay(facilityId, d('2026-10-06'), record)

    const payments = await prisma.payment.findMany({
      where: { facilityId, status: { in: ['pending', 'succeeded'] } },
      orderBy: { createdAt: 'desc' },
    })
    for (const payment of payments.slice(0, 2)) {
      await awaitPaymentStatus(payment.id, 'succeeded')
    }

    // Everything settled: rent and the late fee.
    const open = await prisma.invoice.count({
      where: { leaseId, status: { in: ['open', 'partially_paid'] } },
    })
    expect(open).toBe(0)

    const balance = await prisma.ledgerEntry.aggregate({
      where: { leaseId },
      _sum: { amountCents: true },
    })
    expect(balance._sum.amountCents).toBe(0)

    // And the gate reopens without anyone deciding to act.
    await evaluateAccessSuspensions(facilityId, d('2026-10-08'), record)
    const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
    expect(grant.state).toBe('active')
  }, 180_000)
})
