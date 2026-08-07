import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { dispatchEvents } from '../packages/core/events'

// GOLDEN PATH 2 — the demo checkpoint the backlog places after B-055:
//
//   "nightly run invoices a seeded lease → due-soon reminder → simulated
//    failed payment → dunning step 1 → magic-link payment halts the ladder"
//
// Written as a test rather than a script that gets run once and forgotten. A
// demo that only ever passed on the afternoon it was written proves the flow
// worked that afternoon; this one fails a pull request the day somebody breaks
// the chain between two of its links.
//
// It drives the REAL registry — `SCHEDULED_JOBS` handlers in their real
// facility-local hour order, with `dispatchEvents(CONSUMERS)` between days, so
// what runs here is what production runs. Only two things are substituted:
// Stripe (no key outside production, the same wall every other billing suite
// hits) and the clock, which is passed in as a business date because that is
// how the runner takes it anyway.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let nextChargeBehaviour: 'succeed' | 'decline' = 'decline'

// Same shape as the autopay suite's mock, and for the same reason: the real
// `createChargeIntent` marks its own row failed before rethrowing, and the run
// finds that row through the allocation. A mock that skipped the row would be
// testing a fiction.
vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(
    async (input: {
      reference: string
      amountCents: number
      invoiceId?: string
      tenantId: string
      facilityId: string
    }) => {
      if (nextChargeBehaviour === 'decline') {
        const payment = await prisma.payment.create({
          data: {
            facilityId: input.facilityId,
            tenantId: input.tenantId,
            amountCents: input.amountCents,
            method: 'card',
            status: 'failed',
            failureReason: 'Your card was declined.',
            failureCode: 'card_declined',
          },
        })
        if (input.invoiceId) {
          await prisma.paymentAllocation.create({
            data: {
              paymentId: payment.id,
              invoiceId: input.invoiceId,
              amountCents: input.amountCents,
            },
          })
        }
        throw Object.assign(new Error('Your card was declined.'), { code: 'card_declined' })
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
        deduplicated: false,
      }
    },
  ),
}))

vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, stripeClient: () => ({}) as never }
})

const { CONSUMERS, SCHEDULED_JOBS } = await import('../apps/web/lib/jobs/registry')
const { applyPayment } = await import('../apps/web/lib/billing/allocation')
const { checkPayLink, mintPayLink, attributePayment } = await import(
  '../apps/web/lib/portal/pay-links'
)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
// The autopay tenant: the one whose card declines and who ends up being chased.
let tenantId = ''
let leaseId = ''
// A second lease at the same facility, NOT on autopay. It exists because of
// something the first run of this demo surfaced: FR-18's premise check
// deliberately cancels the due-soon reminder for an autopay tenant with
// `autopay_covers_it` — telling somebody to go and pay a bill the system is
// about to collect itself is exactly the noise that rule exists to stop. The
// golden path asks for a due-soon reminder AND a failed autopay, so it needs
// both kinds of tenant. That is the facility's night, not one tenant's.
let manualTenantId = ''
let manualLeaseId = ''

/// The narrative the demo checkpoint is actually for. Printed at the end so a
/// run of this suite reads as a story rather than as ten green ticks.
const story: string[] = []
const note = (line: string) => story.push(line)

/// One facility-local night: every per-facility job in `localHour` order, then
/// the event outbox drained the way the cron tick drains it.
///
/// Ordering by `localHour` rather than by array position is the point — the
/// registry's comments argue at length about which job runs at which hour
/// (invoices 1am, fees 2am, autopay 3am, access 4am, dunning 5am), and a demo
/// that ran them in declaration order would prove nothing about the real night.
async function runNight(businessDate: Date): Promise<void> {
  const jobs = [...SCHEDULED_JOBS]
    .filter((job) => job.scope === 'per_facility')
    .sort((a, b) => a.localHour - b.localHour)

  for (const job of jobs) {
    await job.handler({ facilityId, businessDate, recordItem: () => {} })
  }
  // Narrowed to this facility. The outbox is global by design and vitest runs
  // files in parallel, so an unscoped drain here would claim events another
  // suite emitted a moment earlier — and process them through THIS file's
  // mocks. `dispatchEvents` grew the option for exactly this reason; its own
  // doc comment says so.
  await dispatchEvents(CONSUMERS, { facilityId })
}

async function balanceCents(): Promise<number> {
  const sum = await prisma.ledgerEntry.aggregate({
    where: { leaseId },
    _sum: { amountCents: true },
  })
  return sum._sum.amountCents ?? 0
}

async function messagesFor(templateKey: string, recipient: string = tenantId) {
  return prisma.message.findMany({
    where: { recipientTenantId: recipient, templateKey },
    orderBy: { createdAt: 'asc' },
  })
}

describeDb('golden path 2 — the billing engine chases and gets paid', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Golden Path ${suffix}`,
        slug: `golden-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        // Defaults, stated rather than assumed — the whole demo is an argument
        // about which day each thing happens on.
        invoiceLeadDays: 5,
        dunningDays: [1, 5, 10, 30],
        accessSuspendDaysPastDue: 6,
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: {
        email: `golden-${suffix}@example.com`,
        firstName: 'Ada',
        lastName: `Renter ${suffix}`,
        stripeCustomerId: `cus_${suffix}`,
        stripeDefaultPaymentMethodId: `pm_${suffix}`,
      },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `G-${suffix.slice(0, 4)}` },
    })

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-05-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
        autopayEnabled: true,
      },
    })
    leaseId = lease.id

    const manualTenant = await prisma.tenant.create({
      data: {
        email: `golden-manual-${suffix}@example.com`,
        firstName: 'Bo',
        lastName: `Payer ${suffix}`,
      },
    })
    manualTenantId = manualTenant.id
    const manualUnit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `M-${suffix.slice(0, 4)}` },
    })
    const manualLease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: manualTenantId,
        unitId: manualUnit.id,
        status: 'active',
        startDate: d('2026-05-01'),
        billingDay: 1,
        monthlyRateCents: 9_900,
        autopayEnabled: false,
      },
    })
    manualLeaseId = manualLease.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // eslint-disable-next-line no-console
    console.log(['', 'GOLDEN PATH 2', ...story.map((line) => `  ${line}`), ''].join('\n'))
    await prisma.$disconnect()
  })

  it('1 — the nightly run invoices the lease five days ahead', async () => {
    // Nothing on the 26th: the period starting 1 June is still six days out and
    // `invoiceLeadDays` is 5.
    await runNight(d('2026-05-26'))
    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(0)

    await runNight(d('2026-05-27'))

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
    expect(await prisma.invoice.count({ where: { leaseId: manualLeaseId } })).toBe(1)
    expect(invoice.periodStart.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(invoice.dueDate.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(invoice.totalCents).toBe(12_900)
    expect(await balanceCents()).toBe(12_900)

    note(`27 May · invoices raised for June — ${invoice.number} $129.00 due 1 June (+ 1 more)`)
  })

  it('2 — the tenant who pays by hand is told before it is due, not after', async () => {
    const reminders = await messagesFor('invoice_due_soon', manualTenantId)
    expect(reminders).toHaveLength(1)
    expect(reminders[0].status).toBe('sent')
    // CN-3 wants the reminder driven by the billing run, and the run that
    // generated the invoice is the one that sent it — not a second job whose
    // order relative to the first would be luck.
    expect(reminders[0].bodySnapshot).toContain('$99.00')

    note(`27 May · due-soon reminder sent — "${reminders[0].subjectSnapshot}"`)
  })

  it('2b — and the autopay tenant is deliberately NOT told', async () => {
    // FR-18's premise check. Telling somebody to go and pay a bill the system
    // is about to collect itself is the noise that rule exists to stop, and the
    // cancelled row is the evidence it was considered rather than forgotten.
    const [suppressed] = await messagesFor('invoice_due_soon')
    expect(suppressed.status).toBe('cancelled')
    expect(suppressed.error).toBe('skipped: autopay_covers_it')

    note('27 May · no reminder to the autopay tenant — FR-18: autopay covers it')
  })

  it('3 — autopay tries on the due date and the card declines', async () => {
    nextChargeBehaviour = 'decline'
    await runNight(d('2026-06-01'))

    const failed = await prisma.payment.findMany({
      where: { tenantId, status: 'failed' },
      orderBy: { receivedAt: 'asc' },
    })
    expect(failed).toHaveLength(1)
    expect(failed[0].failureCode).toBe('card_declined')

    // The money is still owed. A failed charge that quietly reduced the balance
    // is the failure mode this assertion exists for.
    expect(await balanceCents()).toBe(12_900)

    const told = await messagesFor('payment_failed')
    expect(told.length).toBeGreaterThanOrEqual(1)

    note('1 Jun · autopay declined (card_declined) — tenant told, balance still $129.00')
  })

  it('4 — day one past due, the ladder sends its first step', async () => {
    await runNight(d('2026-06-02'))

    const chases = await messagesFor('dunning_step')
    expect(chases).toHaveLength(1)
    expect(chases[0].bodySnapshot).toContain('$129.00')

    const events = await prisma.domainEvent.findMany({
      where: { entityId: leaseId, name: 'delinquency.day_reached' },
    })
    expect(events).toHaveLength(1)

    note('2 Jun · one day past due — dunning step 1 sent')
  })

  it('5 — the retry runs on its own schedule, not every night', async () => {
    // US-20's +1/+3/+5 from the first failure on 1 June: attempts on the 2nd,
    // 4th and 6th. The 2nd already ran as part of step 4's night, so two
    // declines are on the board.
    expect(await prisma.payment.count({ where: { tenantId, status: 'failed' } })).toBe(2)

    // The 3rd is deliberately quiet. This assertion is the one that catches
    // "retry forever, nightly" — the bug B-046 shipped and B-045 fixed — and it
    // is why the demo runs a night that is supposed to do nothing.
    await runNight(d('2026-06-03'))
    expect(await prisma.payment.count({ where: { tenantId, status: 'failed' } })).toBe(2)

    await runNight(d('2026-06-04'))
    expect(await prisma.payment.count({ where: { tenantId, status: 'failed' } })).toBe(3)

    note('2 Jun · retry one declined; 3 Jun · nothing scheduled, card untouched')
    note('4 Jun · retry two declined')
  })

  it('6 — the clock runs from the original due date, never from a retry', async () => {
    // D-25, and the reason it is a decision rather than an implementation
    // detail: three retries have moved *an* attempt date to 4 June. If the day
    // count followed that, this lease would report as two days past due instead
    // of five, would never reach the day-5 chase, and would never reach the
    // suspension threshold at all — it would simply stop being visible to the
    // system meant to escalate it.
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { leaseId, kind: 'rent' },
      select: { dueDate: true },
    })
    expect(invoice.dueDate.toISOString().slice(0, 10)).toBe('2026-06-01')

    // 6 June: ladder day 5, and retry three.
    await runNight(d('2026-06-06'))

    // Two chases, not five — the ladder fires on its own days (1 and 5), not
    // every night it finds a balance.
    expect(await messagesFor('dunning_step')).toHaveLength(2)
    expect(await prisma.payment.count({ where: { tenantId, status: 'failed' } })).toBe(4)

    // Somebody is told. The task hangs off the INVOICE, not the lease — a
    // tenant with two unpaid invoices has two problems, and one task covering
    // both is one that gets closed with half the money still owed.
    const invoiceRow = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'rent' } })
    const tasks = await prisma.task.findMany({
      where: { facilityId, type: 'failed_payment', entityId: invoiceRow.id },
    })
    // Exactly one, after four declines across five nights: the open-task check
    // is what stops a fresh row appearing every night until somebody acts.
    expect(tasks).toHaveLength(1)
    expect(tasks[0].priority).toBe('high')

    note('6 Jun · five days past due — dunning step 2, retry three declined')
    note('6 Jun · retries exhausted — a failed_payment task is raised for staff')
  })

  it('7 — the tenant pays through the magic link and the balance clears', async () => {
    const minted = await mintPayLink({ tenantId, leaseId })
    expect(minted).not.toBeNull()

    const checked = await checkPayLink(minted!.token)
    expect(checked.ok).toBe(true)

    const owed = await balanceCents()
    expect(owed).toBe(12_900)

    // The portal's own path: a payment row, then `applyPayment` allocating it
    // across what is owed in the facility's order.
    const payment = await prisma.payment.create({
      data: {
        facilityId,
        tenantId,
        amountCents: owed,
        method: 'card',
        status: 'succeeded',
        receivedAt: d('2026-06-07'),
      },
    })
    await prisma.$transaction(async (tx) => {
      await applyPayment(tx, {
        id: payment.id,
        tenantId,
        facilityId,
        amountCents: owed,
      })
      await tx.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          paymentId: payment.id,
          type: 'payment',
          amountCents: -owed,
          description: 'Payment by link',
          occurredAt: d('2026-06-07'),
        },
      })
    })
    if (checked.ok) await attributePayment(checked.payLinkId, payment.id)

    expect(await balanceCents()).toBe(0)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'rent' } })
    expect(invoice.status).toBe('paid')

    note('7 Jun · paid $129.00 through the emailed link — balance $0.00, invoice settled')
  })

  it('8 — the ladder stops the same night, and stays stopped', async () => {
    const before = (await messagesFor('dunning_step')).length

    // Day 10 of the ladder falls on 11 June and would otherwise fire.
    await runNight(d('2026-06-08'))
    await runNight(d('2026-06-11'))
    await runNight(d('2026-06-12'))

    expect((await messagesFor('dunning_step')).length).toBe(before)

    // And nothing was charged again — the settled invoice is not re-collected.
    const charged = await prisma.payment.count({ where: { tenantId, status: { not: 'failed' } } })
    expect(charged).toBe(1)

    note('8–12 Jun · ladder silent, card untouched — a paid tenant is left alone')
  })

  it('9 — access was never suspended, because the threshold was never reached', async () => {
    // Six days past due is the Texas default (D-16). The tenant paid on day 6,
    // so the 4am rule on 7 June is the last one that could have fired — and by
    // then the balance was zero.
    const suspensions = await prisma.domainEvent.findMany({
      where: { entityId: leaseId, name: 'access.suspended' },
    })
    expect(suspensions).toHaveLength(0)

    note('— access never suspended: paid on day 6, threshold is 6 (D-16)')
  })
})
