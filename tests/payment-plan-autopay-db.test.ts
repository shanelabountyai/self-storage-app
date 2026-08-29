import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { applyPayment } from '../apps/web/lib/billing/allocation'

// B-189 / PRD 02 §4.6 US-25, §4.5 US-20 (CN-6). Autopay and a payment plan,
// in both directions.
//
// The defect this file exists to keep fixed had two halves and one shape.
// Autopay did not know a plan existed, so it charged the FULL arrears the same
// night the plan was agreed — the exact outcome the plan is for. And nothing
// ever charged an installment, so a tenant with a saved card had to remember
// to pay by hand or the hour-4 breach job broke their plan for them.
//
// `createChargeIntent` is mocked at the module the run imports, the same way
// B-045's own suite does it, so what is under test is the run's selection: WHICH
// invoices it defers, WHICH installment it collects, for how much, and what it
// does when the card says no. A real off-session charge is the wall every
// Stripe-touching suite in this repo hits — there is no key outside production.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

type Charge = {
  reference: string
  amountCents: number
  invoiceId?: string
  paymentPlanId?: string
  paymentPlanInstallmentId?: string
}

const charges: Charge[] = []
let nextChargeBehaviour: 'succeed' | 'decline' = 'succeed'
let nextDeclineCode = 'card_declined'

vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(async (input: Charge & { tenantId: string; facilityId: string }) => {
    charges.push({
      reference: input.reference,
      amountCents: input.amountCents,
      invoiceId: input.invoiceId,
      paymentPlanId: input.paymentPlanId,
      paymentPlanInstallmentId: input.paymentPlanInstallmentId,
    })

    // The real function writes its Payment row BEFORE calling Stripe and marks
    // it failed on a decline. The mock has to leave the same evidence — the
    // installment's retry ladder and the breach job both count those rows, so
    // a mock that skipped them would be testing a fiction.
    const payment = await prisma.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        amountCents: input.amountCents,
        method: 'card',
        status: nextChargeBehaviour === 'decline' ? 'failed' : 'pending',
        paymentPlanInstallmentId: input.paymentPlanInstallmentId ?? null,
        ...(nextChargeBehaviour === 'decline'
          ? { failureReason: 'Your card was declined.', failureCode: nextDeclineCode }
          : { stripePaymentIntentId: `pi_${randomUUID().slice(0, 12)}` }),
      },
    })
    if (input.invoiceId) {
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: input.invoiceId, amountCents: input.amountCents },
      })
    }
    if (nextChargeBehaviour === 'decline') {
      throw Object.assign(new Error('Your card was declined.'), { code: nextDeclineCode })
    }
    return {
      paymentId: payment.id,
      paymentIntentId: payment.stripePaymentIntentId!,
      clientSecret: 'cs_test',
      deduplicated: false,
    }
  }),
}))

vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, stripeClient: () => ({}) as never }
})

const { runAutopay } = await import('../apps/web/lib/billing/autopay')
const { evaluatePaymentPlanBreaches } = await import(
  '../apps/web/lib/delinquency/payment-plan-breach'
)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let tenantId = ''
let unitTypeId = ''
let staffId = ''
let counter = 0

const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

async function newLease(): Promise<string> {
  counter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `PPA-${counter}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-06-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      autopayEnabled: true,
    },
  })
  return lease.id
}

/// A lease under its OWN tenant.
///
/// `claimsFor` allocates across everything a TENANT owes at the facility, and
/// this file's leases all hang off one shared tenant that nothing cleans up
/// between tests. Any test that allocates without naming or narrowing invoices
/// would otherwise land its money on an earlier test's open invoice — which is
/// the shared-state trap, not a defect in the code under test.
async function newLeaseUnderOwnTenant(): Promise<{ leaseId: string; tenantId: string }> {
  counter += 1
  const tenant = await prisma.tenant.create({
    data: {
      email: `plan-alloc-${counter}-${suffix}@example.com`,
      firstName: 'Dana',
      lastName: 'Payer',
      stripeCustomerId: `cus_alloc_${counter}_${suffix}`,
    },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `PPB-${counter}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-06-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      autopayEnabled: true,
    },
  })
  return { leaseId: lease.id, tenantId: tenant.id }
}

async function invoice(
  leaseId: string,
  amountCents: number,
  dueDate: Date,
  /// B-203's cases need real categories: the allocation order ranks by
  /// category first, so an invoice with no line items behaves as pure rent and
  /// cannot show what tax-before-rent does to a plan.
  lines: { type: 'rent' | 'tax' | 'protection' | 'fee'; amountCents: number }[] = [],
): Promise<string> {
  counter += 1
  const row = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `PPA${String(counter).padStart(5, '0')}-${suffix}`,
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: amountCents,
      totalCents: amountCents,
      lineItems: {
        create: lines.map((line) => ({
          type: line.type,
          description: line.type,
          unitAmountCents: line.amountCents,
          amountCents: line.amountCents,
        })),
      },
    },
  })
  return row.id
}

/// A plan built from rows rather than through `createPaymentPlan`, so the
/// fixture can say exactly what autopay is meant to read — the covered set,
/// the schedule and the auto-collect flag — without also exercising the
/// permission gate `payment-plans-db.test.ts` already covers.
async function plan(options: {
  leaseId: string
  invoiceIds: string[]
  totalCents: number
  installments: { dueDate: Date; amountCents: number }[]
  autoCollect?: boolean
}): Promise<string> {
  const hold = await prisma.leaseHold.create({
    data: {
      leaseId: options.leaseId,
      type: 'payment_plan',
      reason: 'Plan agreed',
      effectiveFrom: d('2026-08-01'),
      placedByStaffId: staffId,
    },
  })
  const row = await prisma.paymentPlan.create({
    data: {
      leaseId: options.leaseId,
      holdId: hold.id,
      totalCents: options.totalCents,
      invoiceIds: options.invoiceIds,
      autoCollect: options.autoCollect ?? true,
      createdByStaffId: staffId,
      createdAt: d('2026-08-01'),
      installments: {
        create: options.installments.map((installment, index) => ({
          position: index + 1,
          dueDate: installment.dueDate,
          amountCents: installment.amountCents,
        })),
      },
    },
  })
  return row.id
}

const installmentCharges = () => charges.filter((charge) => charge.paymentPlanInstallmentId)

/// A hold that declares `halt_autopay` — bankruptcy, SCRA and deceased all do.
async function bankruptcyHold(leaseId: string): Promise<void> {
  await prisma.leaseHold.create({
    data: {
      leaseId,
      type: 'bankruptcy',
      reason: 'Chapter 7 filed',
      effectiveFrom: d('2026-08-15'),
      placedByStaffId: staffId,
    },
  })
}

describeDb('payment plans and autopay', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Plan Autopay ${suffix}`,
        slug: `plan-autopay-${suffix}`,
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
        email: `plan-autopay-${suffix}@example.com`,
        firstName: 'Ada',
        lastName: 'Renter',
        stripeCustomerId: `cus_${suffix}`,
        stripeDefaultPaymentMethodId: `pm_${suffix}`,
      },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `plan-autopay-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(() => {
    charges.length = 0
    collected.length = 0
    nextChargeBehaviour = 'succeed'
    nextDeclineCode = 'card_declined'
  })

  it('defers the arrears the plan froze and still collects rent invoiced after it', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 180_000, d('2026-07-01'))
    const septemberRent = await invoice(leaseId, 12_900, d('2026-09-01'))
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 180_000,
      installments: [
        { dueDate: d('2026-10-01'), amountCents: 90_000 },
        { dueDate: d('2026-11-01'), amountCents: 90_000 },
      ],
    })

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    // The whole point: $1,800 was NOT taken the night the plan started, and
    // September's $129 rent still was. A plan is forbearance on what is owed,
    // not a rent holiday.
    expect(charges.map((charge) => charge.invoiceId)).toEqual([septemberRent])
    expect(collected.some((item) => item.message?.includes('deferred under an agreed payment plan'))).toBe(true)
  })

  it('charges one installment on its due date, naming the plan and not an invoice', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 180_000, d('2026-07-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 180_000,
      installments: [
        { dueDate: d('2026-09-01'), amountCents: 60_000 },
        { dueDate: d('2026-10-01'), amountCents: 60_000 },
        { dueDate: d('2026-11-01'), amountCents: 60_000 },
      ],
    })

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    const installments = installmentCharges()
    expect(installments).toHaveLength(1)
    expect(installments[0].amountCents).toBe(60_000)
    expect(installments[0].paymentPlanId).toBe(planId)
    // No invoice is named: the allocation is narrowed to the covered set by
    // the plan id, so naming one would strand the remainder as unapplied.
    expect(installments[0].invoiceId).toBeUndefined()
  })

  it('charges nothing on a manual-pay plan', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      autoCollect: false,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    expect(installmentCharges()).toHaveLength(0)
    // And the arrears are still deferred rather than swept up by the ordinary
    // path — manual-pay is not "collect it the old way".
    expect(charges).toHaveLength(0)
  })

  it('charges only what is left of an installment the tenant part-paid', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    await prisma.invoice.update({
      where: { id: arrears },
      data: { amountPaidCents: 25_000, status: 'partially_paid' },
    })
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [
        { dueDate: d('2026-09-01'), amountCents: 30_000 },
        { dueDate: d('2026-10-01'), amountCents: 30_000 },
      ],
    })

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    // $250 of the first $300 is already retired, so $50 is what is owed — the
    // face value would take the same $250 twice.
    expect(installmentCharges().map((charge) => charge.amountCents)).toEqual([5_000])
  })

  it('does not charge an installment while an earlier attempt is still in flight', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })

    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(installmentCharges()).toHaveLength(1)

    charges.length = 0
    // The next night, with the first charge still `pending` — a webhook that
    // has not landed must never become a second charge on a real card.
    await runAutopay(facilityId, d('2026-09-02'), recordItem)
    expect(installmentCharges()).toHaveLength(0)
  })

  it('does not break a plan for a decline while the retry ladder is still running', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })

    nextChargeBehaviour = 'decline'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)
    expect(installmentCharges()).toHaveLength(1)

    // CN-6, on the first night the installment actually reads `missed` — the
    // due date itself is never a breach, and asserting there would pass for a
    // reason that has nothing to do with the ladder. It is uncovered and its
    // date has passed, which is all `isBreached` looked at, but the retry
    // schedule still has attempts left.
    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-02'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('active')

    // Once the schedule's last offset (+5) has passed, waiting is no longer
    // waiting for anything.
    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-08'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('broken')
  })

  it('breaks a plan on a terminal decline without waiting out the ladder', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })

    nextChargeBehaviour = 'decline'
    nextDeclineCode = 'expired_card'
    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    // There is no next attempt to wait for, so the RETRY grace would be a week
    // of silence for a card nobody is going to fix on its own. D-98's three
    // days still stand on top of it, and they are a different window for a
    // different reason: the ladder asks whether a charge is still coming, the
    // grace asks whether the TENANT still has time to pay some other way.
    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-02'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('active')

    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-05'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('broken')
  })

  it('lands an installment on the arrears the plan covers, never on later rent', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    const septemberRent = await invoice(leaseId, 12_900, d('2026-09-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 30_000 }],
    })

    const payment = await prisma.payment.create({
      data: { facilityId, tenantId, amountCents: 30_000, method: 'card', status: 'succeeded' },
    })
    await prisma.$transaction(async (tx) => {
      const plan = await tx.paymentPlan.findUniqueOrThrow({
        where: { id: planId },
        select: { invoiceIds: true },
      })
      await applyPayment(
        tx,
        { id: payment.id, tenantId, facilityId, amountCents: 30_000 },
        { restrictToInvoiceIds: plan.invoiceIds },
      )
    })

    // Every cent on the arrears. Without the narrowing the facility's ordinary
    // allocation order is free to settle September's rent instead — which
    // moves the plan's progress by nothing, so the tenant would be broken for
    // a payment they actually made.
    const [covered, rent] = await Promise.all([
      prisma.invoice.findUniqueOrThrow({ where: { id: arrears }, select: { amountPaidCents: true } }),
      prisma.invoice.findUniqueOrThrow({ where: { id: septemberRent }, select: { amountPaidCents: true } }),
    ])
    expect(covered.amountPaidCents).toBe(30_000)
    expect(rent.amountPaidCents).toBe(0)
  })

  it('lands a COUNTER payment on the plan, not on this month\'s tax (B-203)', async () => {
    // The defect this row was raised on. Only autopay's installment charge
    // carried `restrictToInvoiceIds`; a payment taken at the counter or in the
    // portal passed no options at all, so it allocated by the facility's
    // ordinary order — tax first — and every open invoice's tax share outranks
    // every arrears rent share.
    const { leaseId, tenantId: payer } = await newLeaseUnderOwnTenant()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'), [
      { type: 'rent', amountCents: 60_000 },
    ])
    const septemberRent = await invoice(leaseId, 12_900, d('2026-09-01'), [
      { type: 'rent', amountCents: 11_500 },
      { type: 'tax', amountCents: 1_400 },
    ])
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      autoCollect: false,
      installments: [
        { dueDate: d('2026-09-15'), amountCents: 30_000 },
        { dueDate: d('2026-10-15'), amountCents: 30_000 },
      ],
    })

    // Dana hands over the $300 the reminder asked for, in cash, on the day.
    const payment = await prisma.payment.create({
      data: { facilityId, tenantId: payer, amountCents: 30_000, method: 'cash', status: 'succeeded' },
    })
    await prisma.$transaction(async (tx) => {
      await applyPayment(tx, { id: payment.id, tenantId: payer, facilityId, amountCents: 30_000 })
    })

    // Every cent on the plan. Before this, $1,400 of it went to September's
    // tax, plan progress moved $28,600 of $30,000, `installmentViews` read
    // partial coverage as uncovered, and three days later the breach job ended
    // the plan and demanded the lot from a tenant who had paid on time.
    const [covered, rent] = await Promise.all([
      prisma.invoice.findUniqueOrThrow({ where: { id: arrears }, select: { amountPaidCents: true } }),
      prisma.invoice.findUniqueOrThrow({ where: { id: septemberRent }, select: { amountPaidCents: true } }),
    ])
    expect(covered.amountPaidCents).toBe(30_000)
    expect(rent.amountPaidCents).toBe(0)
  })

  it('spills what the plan does not need onto the current month (B-203)', async () => {
    // Deferred, not restricted. The amount is whatever the tenant chose to
    // hand over rather than a figure we raised, so a payment bigger than the
    // arrears must reach the rent the payer plainly also meant to cover —
    // stranding it as unapplied credit would be a second surprise.
    const { leaseId, tenantId: payer } = await newLeaseUnderOwnTenant()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'), [
      { type: 'rent', amountCents: 60_000 },
    ])
    const septemberRent = await invoice(leaseId, 12_900, d('2026-09-01'), [
      { type: 'rent', amountCents: 11_500 },
      { type: 'tax', amountCents: 1_400 },
    ])
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      autoCollect: false,
      installments: [{ dueDate: d('2026-09-15'), amountCents: 60_000 }],
    })

    const payment = await prisma.payment.create({
      data: { facilityId, tenantId: payer, amountCents: 65_000, method: 'cash', status: 'succeeded' },
    })
    const applied = await prisma.$transaction((tx) =>
      applyPayment(tx, { id: payment.id, tenantId: payer, facilityId, amountCents: 65_000 }),
    )

    const [covered, rent] = await Promise.all([
      prisma.invoice.findUniqueOrThrow({ where: { id: arrears }, select: { amountPaidCents: true } }),
      prisma.invoice.findUniqueOrThrow({ where: { id: septemberRent }, select: { amountPaidCents: true } }),
    ])
    expect(covered.amountPaidCents).toBe(60_000)
    expect(rent.amountPaidCents).toBe(5_000)
    expect(applied.unappliedCents).toBe(0)
  })

  it('charges no installment on a lease held for bankruptcy (B-204)', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })
    await bankruptcyHold(leaseId)

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    // The lease has no invoice due tonight that autopay would have selected —
    // the arrears are frozen into the plan — so the hold set derived from the
    // invoice query alone did not contain it, which is exactly how the charge
    // got through.
    expect(installmentCharges()).toHaveLength(0)
    expect(collected.some((item) => item.message === 'installment skipped — the lease is on hold')).toBe(true)
  })

  it('does not break a plan over an installment the hold stopped us collecting (B-204)', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })
    await bankruptcyHold(leaseId)

    await runAutopay(facilityId, d('2026-09-01'), recordItem)

    // Well past the retry ladder's last offset, which is what breaks an
    // uncollected auto-pay plan on any other lease.
    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-20'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('active')
  })

  it('breaks a manual-pay plan once its grace has run, with no ladder to wait for', async () => {
    const leaseId = await newLease()
    const arrears = await invoice(leaseId, 60_000, d('2026-07-01'))
    const planId = await plan({
      leaseId,
      invoiceIds: [arrears],
      totalCents: 60_000,
      autoCollect: false,
      installments: [{ dueDate: d('2026-09-01'), amountCents: 60_000 }],
    })

    // No RETRY ladder is running, because nothing was ever going to charge —
    // B-189's window does not apply here at all. D-98's does: this is exactly
    // the plan that used to break at 00:01 over money handed across the
    // counter that afternoon.
    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-02'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('active')

    await evaluatePaymentPlanBreaches(facilityId, d('2026-09-05'), recordItem)
    expect((await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe('broken')
  })
})
