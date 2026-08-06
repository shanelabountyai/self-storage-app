import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { applyStripeEvent } from '../apps/web/lib/payments/reconcile'

// B-045 / PRD 02 US-19. The autopay run and the settlement it depends on.
//
// Two halves, tested differently:
//
//   * Settlement (allocation written, invoice moved to paid) is pure database
//     work driven through `applyStripeEvent` with event objects shaped the way
//     Stripe sends them — the same approach B-019's own suite takes. No network,
//     no account, and it is the half the "never double-charge" guarantee rests
//     on, so it is tested for real.
//   * The run's selection and skip logic is exercised with `createChargeIntent`
//     mocked. What is NOT covered here is a real off-session charge against
//     Stripe: this project has no key outside production, the same wall
//     B-035/B-036 and B-043's card scan hit.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const charges: { reference: string; amountCents: number; invoiceId?: string }[] = []
let nextChargeBehaviour: 'succeed' | 'decline' | 'deduplicate' = 'succeed'

// Mocked at the module the run imports, so the run's own logic — which invoice
// it picks, what it skips, how it reacts to a decline — is what is under test.
vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(async (input: { reference: string; amountCents: number; invoiceId?: string; tenantId: string; facilityId: string }) => {
    charges.push({ reference: input.reference, amountCents: input.amountCents, invoiceId: input.invoiceId })
    if (nextChargeBehaviour === 'decline') {
      // Shaped like a Stripe card error: a `code` the retry schedule reads.
      const error = Object.assign(new Error('Your card was declined.'), { code: 'card_declined' })
      // The real function marks its own row failed before rethrowing, and the
      // run finds that row through the allocation — so the mock has to leave
      // the same evidence behind or it would be testing a fiction.
      const payment = await prisma.payment.create({
        data: {
          facilityId: input.facilityId,
          tenantId: input.tenantId,
          amountCents: input.amountCents,
          method: 'card',
          status: 'failed',
          failureReason: 'Your card was declined.',
        },
      })
      if (input.invoiceId) {
        await prisma.paymentAllocation.create({
          data: { paymentId: payment.id, invoiceId: input.invoiceId, amountCents: input.amountCents },
        })
      }
      throw error
    }

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
    if (input.invoiceId) {
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: input.invoiceId, amountCents: input.amountCents },
      })
    }
    return {
      paymentId: payment.id,
      paymentIntentId: payment.stripePaymentIntentId!,
      clientSecret: 'cs_test',
      deduplicated: nextChargeBehaviour === 'deduplicate',
    }
  }),
}))

// Stripe must read as configured or the run is an honest no-op.
vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, stripeClient: () => ({}) as never }
})

const { runAutopay } = await import('../apps/web/lib/billing/autopay')

let facilityId = ''
let tenantId = ''
let unitTypeId = ''
let unitCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

async function makeLeaseWithInvoice(options: {
  autopayEnabled?: boolean
  savedCard?: boolean
  dueDate?: Date
  totalCents?: number
  amountPaidCents?: number
  status?: 'open' | 'partially_paid' | 'paid'
  leaseStatus?: 'active' | 'ended'
}): Promise<{ leaseId: string; invoiceId: string }> {
  unitCounter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `AP-${unitCounter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: options.leaseStatus ?? 'active',
      startDate: d('2026-08-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      autopayEnabled: options.autopayEnabled ?? true,
    },
  })
  const total = options.totalCents ?? 12_900
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId: lease.id,
      number: `AP${String(unitCounter).padStart(5, '0')}`,
      status: options.status ?? 'open',
      issueDate: d('2026-08-26'),
      dueDate: options.dueDate ?? d('2026-09-01'),
      periodStart: d('2026-09-01'),
      periodEnd: d('2026-10-01'),
      subtotalCents: total,
      totalCents: total,
      amountPaidCents: options.amountPaidCents ?? 0,
    },
  })

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      stripeCustomerId: `cus_${suffix}`,
      stripeDefaultPaymentMethodId: options.savedCard === false ? null : `pm_${suffix}`,
    },
  })

  return { leaseId: lease.id, invoiceId: invoice.id }
}

/// A `payment_intent.succeeded` event shaped the way Stripe sends it.
function succeededEvent(intentId: string, metadata: Record<string, string>) {
  return {
    id: `evt_${randomUUID().slice(0, 12)}`,
    type: 'payment_intent.succeeded' as const,
    data: { object: { id: intentId, created: Math.floor(d('2026-09-01').getTime() / 1000), metadata } },
  } as never
}

describeDb('autopay', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Autopay Test ${suffix}`,
        slug: `autopay-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `autopay-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(async () => {
    collected.length = 0
    charges.length = 0
    nextChargeBehaviour = 'succeed'
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('charges an invoice due today for the outstanding amount', async () => {
    const { invoiceId } = await makeLeaseWithInvoice({})

    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)

    expect(result).toMatchObject({ charged: 1, failed: 0, skipped: 0 })
    expect(charges).toHaveLength(1)
    expect(charges[0].invoiceId).toBe(invoiceId)
    expect(charges[0].amountCents).toBe(12_900)
  })

  it('charges only what is still outstanding on a part-paid invoice', async () => {
    await makeLeaseWithInvoice({ amountPaidCents: 4_000, status: 'partially_paid' })
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(charges[0].amountCents).toBe(8_900)
  })

  it('collects an invoice whose due date passed while nothing ran', async () => {
    // An outage must not turn into a delinquency the tenant did not earn.
    await makeLeaseWithInvoice({ dueDate: d('2026-08-20') })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result.charged).toBe(1)
  })

  it('does not touch an invoice that is not due yet', async () => {
    await makeLeaseWithInvoice({ dueDate: d('2026-10-01') })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result).toMatchObject({ charged: 0, skipped: 0 })
    expect(charges).toEqual([])
  })

  it('never charges the same invoice twice across two runs', async () => {
    // The guarantee US-19's AC is written around. The first run leaves a pending
    // allocation; the second sees an attempt in flight and skips.
    await makeLeaseWithInvoice({})

    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    await runAutopay(facilityId, d('2026-09-02'), recordItem)

    expect(charges).toHaveLength(1)
    expect(collected.some((item) => item.message?.includes('already in flight'))).toBe(true)
  })

  it('reports a deduplicated charge as skipped rather than counting it twice', async () => {
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'deduplicate'

    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)

    expect(result).toMatchObject({ charged: 0, skipped: 1 })
    expect(collected[0].message).toContain('already charged on this date')
  })

  it('skips a lease with autopay off, and says so', async () => {
    await makeLeaseWithInvoice({ autopayEnabled: false })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result.skipped).toBe(1)
    expect(collected[0].message).toContain('autopay is off')
    expect(charges).toEqual([])
  })

  it('skips a tenant with no saved card, and says so', async () => {
    await makeLeaseWithInvoice({ savedCard: false })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result.skipped).toBe(1)
    expect(collected[0].message).toContain('no saved card')
  })

  it('skips an invoice with nothing outstanding', async () => {
    await makeLeaseWithInvoice({ amountPaidCents: 12_900, status: 'partially_paid' })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result.skipped).toBe(1)
    expect(collected[0].message).toContain('nothing outstanding')
  })

  it('leaves an ended lease alone', async () => {
    await makeLeaseWithInvoice({ leaseStatus: 'ended' })
    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(result).toMatchObject({ charged: 0, skipped: 0 })
  })

  it('records a decline as failed and emits payment.failed with the code', async () => {
    // An off-session charge declines synchronously — there is no webhook coming,
    // so the run itself has to be what makes the failure visible.
    const { invoiceId, leaseId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'

    const result = await runAutopay(facilityId, d('2026-09-01'), recordItem)

    expect(result).toMatchObject({ charged: 0, failed: 1 })
    expect(collected[0].ok).toBe(false)
    expect(collected[0].message).toContain('declined')

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { facilityId, name: 'payment.failed' },
    })
    const payload = event.payload as { invoiceId: string; leaseId: string; code: string; source: string }
    expect(payload).toMatchObject({
      invoiceId,
      leaseId,
      code: 'card_declined',
      source: 'autopay',
    })
  })

  it('leaves a declined invoice collectable rather than blocking it forever', async () => {
    // The failed attempt's allocation must NOT read as in flight — otherwise one
    // decline would permanently exempt the invoice from every future run, and
    // B-046's retries would have nothing to retry.
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    nextChargeBehaviour = 'succeed'
    const second = await runAutopay(facilityId, d('2026-09-02'), recordItem)

    expect(second.charged).toBe(1)
  })

  it('one card failing does not stop the next tenant being charged', async () => {
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    // Second lease, healthy card, same facility.
    nextChargeBehaviour = 'succeed'
    await makeLeaseWithInvoice({})
    const result = await runAutopay(facilityId, d('2026-09-02'), recordItem)
    expect(result.charged).toBeGreaterThanOrEqual(1)
  })

  describe('settlement on the webhook', () => {
    it('writes the allocation, moves the invoice to paid and posts the ledger', async () => {
      const { invoiceId } = await makeLeaseWithInvoice({})
      await runAutopay(facilityId, d('2026-09-01'), recordItem)

      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId } })
      await applyStripeEvent(
        succeededEvent(payment.stripePaymentIntentId!, { invoiceId, tenantId }),
      )

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      expect(invoice.amountPaidCents).toBe(12_900)
      expect(invoice.status).toBe('paid')

      const ledger = await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: payment.id } })
      // Signed: a payment reduces what is owed.
      expect(ledger.amountCents).toBe(-12_900)
    })

    it('is idempotent when Stripe redelivers the same event', async () => {
      const { invoiceId } = await makeLeaseWithInvoice({})
      await runAutopay(facilityId, d('2026-09-01'), recordItem)
      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId } })
      const event = succeededEvent(payment.stripePaymentIntentId!, { invoiceId, tenantId })

      await applyStripeEvent(event)
      await applyStripeEvent(event)

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      // The paid total is recomputed from allocations, never incremented — an
      // increment applied twice is precisely what redelivery would break.
      expect(invoice.amountPaidCents).toBe(12_900)
      expect(await prisma.paymentAllocation.count({ where: { invoiceId } })).toBe(1)
      expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(1)
    })

    it('marks an invoice partially paid when the charge covers only part of it', async () => {
      const { invoiceId } = await makeLeaseWithInvoice({ totalCents: 20_000 })
      await runAutopay(facilityId, d('2026-09-01'), recordItem)
      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId } })
      // The charge was for the full outstanding amount; shrink it to model a
      // provider-side partial capture.
      await prisma.payment.update({ where: { id: payment.id }, data: { amountCents: 5_000 } })
      await prisma.paymentAllocation.updateMany({ where: { invoiceId }, data: { amountCents: 5_000 } })

      await applyStripeEvent(succeededEvent(payment.stripePaymentIntentId!, { invoiceId, tenantId }))

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      expect(invoice.amountPaidCents).toBe(5_000)
      expect(invoice.status).toBe('partially_paid')
    })

    it('refuses to settle an invoice that is not this payer’s', async () => {
      // The invoice id arrives through Stripe metadata. Money must not settle an
      // invoice on the strength of a round trip through a third party.
      const { invoiceId } = await makeLeaseWithInvoice({})
      await runAutopay(facilityId, d('2026-09-01'), recordItem)
      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId } })

      const stranger = await prisma.tenant.create({
        data: { email: `stranger-${suffix}@example.com`, firstName: 'Mal', lastName: 'Other' },
      })
      await prisma.payment.update({ where: { id: payment.id }, data: { tenantId: stranger.id } })

      await applyStripeEvent(succeededEvent(payment.stripePaymentIntentId!, { invoiceId }))

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
      expect(invoice.status).toBe('open')
      expect(invoice.amountPaidCents).toBe(0)

      await prisma.paymentAllocation.deleteMany({ where: { paymentId: payment.id } })
      await prisma.ledgerEntry.deleteMany({ where: { paymentId: payment.id } })
      await prisma.payment.delete({ where: { id: payment.id } })
      await prisma.tenant.delete({ where: { id: stranger.id } })
    })
  })
})
