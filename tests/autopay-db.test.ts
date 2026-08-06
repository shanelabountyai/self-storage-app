import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { applyStripeEvent } from '../apps/web/lib/payments/reconcile'

// B-045 / PRD 02 US-19, and B-046 / US-20's retry schedule. The autopay run,
// the settlement it depends on, and when it stops trying.
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
let nextDeclineCode = 'card_declined'

// Mocked at the module the run imports, so the run's own logic — which invoice
// it picks, what it skips, how it reacts to a decline — is what is under test.
vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(async (input: { reference: string; amountCents: number; invoiceId?: string; tenantId: string; facilityId: string }) => {
    charges.push({ reference: input.reference, amountCents: input.amountCents, invoiceId: input.invoiceId })
    if (nextChargeBehaviour === 'decline') {
      // Shaped like a Stripe card error: a `code` the retry schedule reads.
      const error = Object.assign(new Error('Your card was declined.'), { code: nextDeclineCode })
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
          failureCode: nextDeclineCode,
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

const { emitRetryReminders, runAutopay } = await import('../apps/web/lib/billing/autopay')

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

/// Runs autopay for a business date and dates the attempt it made to that same
/// day.
///
/// In production the allocation's `createdAt` IS the moment of the attempt, so
/// the reminder cadence measures from it directly. These tests drive fictional
/// business dates in September against a real clock, so without this the
/// cadence would measure from today and never fire.
async function declineOn(day: string, invoiceId?: string): Promise<void> {
  await runAutopay(facilityId, d(day), recordItem)
  await prisma.paymentAllocation.updateMany({
    where: {
      payment: { status: 'failed', facilityId },
      ...(invoiceId ? { invoiceId } : {}),
    },
    data: { createdAt: d(day) },
  })
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
    nextDeclineCode = 'card_declined'
    await prisma.task.deleteMany({ where: { facilityId } })
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

  // ── B-046: US-20's retry schedule ──────────────────────────────────────────

  it('waits for the retry day instead of charging again the next night', async () => {
    // B-045 collected any unpaid invoice on every run, which is a retry
    // schedule of "forever, nightly". US-20 wants +1/+3/+5.
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(charges).toHaveLength(1)

    // Due date +1 IS a retry day, so this one goes.
    await runAutopay(facilityId, d('2026-09-02'), recordItem)
    expect(charges).toHaveLength(2)

    // +2 is not.
    collected.length = 0
    await runAutopay(facilityId, d('2026-09-03'), recordItem)
    expect(charges).toHaveLength(2)
    expect(collected[0].message).toContain('not due yet')
  })

  it('runs the whole +1/+3/+5 schedule and then stops', async () => {
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'

    for (const day of ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-06']) {
      await runAutopay(facilityId, d(day), recordItem)
    }
    expect(charges).toHaveLength(4)

    collected.length = 0
    await runAutopay(facilityId, d('2026-09-07'), recordItem)
    expect(charges).toHaveLength(4)
    expect(collected[0].message).toContain('retry schedule is finished')
  })

  it('stops immediately on an expired card and raises a high-priority task', async () => {
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    nextDeclineCode = 'expired_card'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    collected.length = 0
    await runAutopay(facilityId, d('2026-09-02'), recordItem)

    expect(charges, 'an expired card must not be retried').toHaveLength(1)
    expect(collected[0].message).toContain('cannot be retried')

    const task = await prisma.task.findFirstOrThrow({ where: { entityId: invoiceId } })
    expect(task.type).toBe('failed_payment')
    expect(task.priority).toBe('high')
    expect(task.entityType).toBe('Invoice')
  })

  it('raises one task when the schedule finishes, and not one per night after', async () => {
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-06']) {
      await runAutopay(facilityId, d(day), recordItem)
    }

    await runAutopay(facilityId, d('2026-09-07'), recordItem)
    await runAutopay(facilityId, d('2026-09-08'), recordItem)
    await runAutopay(facilityId, d('2026-09-09'), recordItem)

    const tasks = await prisma.task.findMany({ where: { entityId: invoiceId } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].priority).toBe('high')
  })

  it('withdraws the failed-payment task once the invoice is paid', async () => {
    // Withdrawn, not completed: nobody did the work, the reason went away.
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    nextDeclineCode = 'expired_card'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    await runAutopay(facilityId, d('2026-09-02'), recordItem)
    expect(await prisma.task.count({ where: { entityId: invoiceId, status: 'open' } })).toBe(1)

    // The tenant pays at the counter — a payment that names the invoice.
    const payment = await prisma.payment.create({
      data: {
        facilityId,
        tenantId,
        amountCents: 12_900,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: `pi_paid_${suffix}`,
      },
    })
    await applyStripeEvent(succeededEvent(payment.stripePaymentIntentId!, { invoiceId, tenantId }))

    const task = await prisma.task.findFirstOrThrow({ where: { entityId: invoiceId } })
    expect(task.status).toBe('cancelled')
  })

  // ── The site-manager flag and the tenant reminder cadence ─────────────────

  it('flags the site manager on the second decline, not at the end of the schedule', async () => {
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'

    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(
      await prisma.task.count({ where: { entityId: invoiceId } }),
      'one decline is not yet a manager’s problem',
    ).toBe(0)

    await runAutopay(facilityId, d('2026-09-02'), recordItem)

    const task = await prisma.task.findFirstOrThrow({ where: { entityId: invoiceId } })
    expect(task.type).toBe('failed_payment')
    expect(task.priority).toBe('high')
  })

  it('keeps retrying after the manager is flagged', async () => {
    // A person looking at it and the schedule continuing are not alternatives.
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    await runAutopay(facilityId, d('2026-09-02'), recordItem)
    await runAutopay(facilityId, d('2026-09-04'), recordItem)

    expect(charges).toHaveLength(3)
  })

  it('texts the tenant once a day for three days from the first decline', async () => {
    const { leaseId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await declineOn('2026-09-01')

    // Day 0, 1, 2 — including day 2, which has no retry attempt of its own.
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      await emitRetryReminders(facilityId, d(day), recordItem)
    }
    // Day 3 is past the cadence.
    await emitRetryReminders(facilityId, d('2026-09-04'), recordItem)

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'payment.retry_reminder' },
      orderBy: { occurredAt: 'asc' },
    })
    expect(events).toHaveLength(3)
    expect(events.every((event) => event.entityId === leaseId)).toBe(true)
    expect(events.map((event) => (event.payload as { reminderNumber: number }).reminderNumber)).toEqual([
      1, 2, 3,
    ])
  })

  it('sends one reminder a day however many times the run is re-run', async () => {
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await declineOn('2026-09-01')

    await emitRetryReminders(facilityId, d('2026-09-01'), recordItem)
    await emitRetryReminders(facilityId, d('2026-09-01'), recordItem)
    await emitRetryReminders(facilityId, d('2026-09-01'), recordItem)

    expect(
      await prisma.domainEvent.count({ where: { facilityId, name: 'payment.retry_reminder' } }),
    ).toBe(1)
  })

  it('never sends more than three even across a long catch-up', async () => {
    // A catch-up walk over a fortnight must not send a fortnight of reminders.
    await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await declineOn('2026-09-01')

    for (let day = 1; day <= 14; day++) {
      await emitRetryReminders(facilityId, new Date(Date.UTC(2026, 8, day)), recordItem)
    }

    expect(
      await prisma.domainEvent.count({ where: { facilityId, name: 'payment.retry_reminder' } }),
    ).toBe(3)
  })

  it('stops reminding once the invoice is paid', async () => {
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await declineOn('2026-09-01')
    await emitRetryReminders(facilityId, d('2026-09-01'), recordItem)

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', amountPaidCents: 12_900 },
    })
    await emitRetryReminders(facilityId, d('2026-09-02'), recordItem)

    expect(
      await prisma.domainEvent.count({ where: { facilityId, name: 'payment.retry_reminder' } }),
    ).toBe(1)
  })

  it('says nothing to a tenant whose card has not declined', async () => {
    await makeLeaseWithInvoice({})
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    await emitRetryReminders(facilityId, d('2026-09-01'), recordItem)

    expect(
      await prisma.domainEvent.count({ where: { facilityId, name: 'payment.retry_reminder' } }),
    ).toBe(0)
  })

  it('honours a facility that does not retry at all', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { paymentRetryDays: [] } })
    const { invoiceId } = await makeLeaseWithInvoice({})
    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    await runAutopay(facilityId, d('2026-09-02'), recordItem)

    expect(charges).toHaveLength(1)
    expect(await prisma.task.count({ where: { entityId: invoiceId } })).toBe(1)
    await prisma.facility.update({ where: { id: facilityId }, data: { paymentRetryDays: [1, 3, 5] } })
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
