import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { emitDueReminders, generateInvoices } from '../apps/web/lib/billing/invoices'

// B-044 / PRD 02 US-17, US-18. The nightly recurring invoice run.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let unitTypeId = ''
let unitCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const isoOf = (date: Date) => date.toISOString().slice(0, 10)

const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

async function makeLease(options: {
  startDate: Date
  billingDay: number
  monthlyRateCents?: number
  protectionCents?: number
  status?: 'active' | 'ended'
  moveOutDate?: Date
}): Promise<string> {
  unitCounter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `I-${unitCounter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: options.status ?? 'active',
      startDate: options.startDate,
      billingDay: options.billingDay,
      monthlyRateCents: options.monthlyRateCents ?? 12_900,
      protectionCents: options.protectionCents ?? 0,
      protectionPlanName: options.protectionCents ? 'Standard cover' : null,
      moveOutDate: options.moveOutDate,
    },
  })
  return lease.id
}

async function setPolicy(patch: {
  billingPolicy?: 'anniversary' | 'first_of_month'
  invoiceLeadDays?: number
  prorateOnMoveOut?: boolean
}): Promise<void> {
  await prisma.facility.update({ where: { id: facilityId }, data: patch })
}

describeDb('recurring invoice generation', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Invoice Test ${suffix}`,
        slug: `invoice-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `invoice-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.taxComponent.deleteMany({ where: { facilityId } })
    await prisma.invoiceCounter.deleteMany({ where: { facilityId } })
    await setPolicy({ billingPolicy: 'anniversary', invoiceLeadDays: 5, prorateOnMoveOut: false })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('never bills the period the move-in payment already covered', async () => {
    // The double-charge this whole design exists to prevent: checkout charges
    // a full month on the 20th, so the period starting the 20th is paid.
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-08-21'), recordItem)

    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(0)
  })

  it('generates the next period once it enters the lead-time window', async () => {
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    // Five days before 20 Sep, with the default lead of 5.
    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
    expect(isoOf(invoice.periodStart)).toBe('2026-09-20')
    expect(isoOf(invoice.periodEnd)).toBe('2026-10-20')
    expect(isoOf(invoice.dueDate)).toBe('2026-09-20')
    expect(invoice.status).toBe('open')
    expect(invoice.totalCents).toBe(12_900)
  })

  it('does not generate before the lead-time window opens', async () => {
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
    await generateInvoices(facilityId, d('2026-09-14'), recordItem)
    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(0)
  })

  it('is idempotent — a re-run generates nothing new', async () => {
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)
    await generateInvoices(facilityId, d('2026-09-16'), recordItem)
    await generateInvoices(facilityId, d('2026-09-17'), recordItem)

    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(1)
  })

  it('catches up every period missed while nothing ran', async () => {
    // The scheduler was down for three months. Each missed period gets its own
    // invoice rather than one merged catch-all.
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-12-01'), recordItem)

    const invoices = await prisma.invoice.findMany({
      where: { leaseId },
      orderBy: { periodStart: 'asc' },
    })
    expect(invoices.map((i) => isoOf(i.periodStart))).toEqual([
      '2026-09-20',
      '2026-10-20',
      '2026-11-20',
    ])
  })

  it('writes line items and a ledger charge that agree with the invoice total', async () => {
    await prisma.taxComponent.create({
      data: { facilityId, jurisdiction: 'state', rateBasisPoints: 625, effectiveFrom: d('2020-01-01') },
    })
    const leaseId = await makeLease({
      startDate: d('2026-08-20'),
      billingDay: 20,
      protectionCents: 1_400,
    })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { leaseId },
      include: { lineItems: true },
    })
    // Rent 12900 + protection 1400 = 14300 subtotal; tax is on rent only.
    expect(invoice.subtotalCents).toBe(14_300)
    expect(invoice.taxCents).toBe(806)
    expect(invoice.totalCents).toBe(15_106)
    expect(invoice.lineItems.reduce((sum, line) => sum + line.amountCents, 0)).toBe(15_106)

    const ledger = await prisma.ledgerEntry.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    expect(ledger.type).toBe('charge')
    expect(ledger.amountCents).toBe(15_106)
  })

  it('uses the tax rate effective on the business date being run, not today', async () => {
    // A catch-up run for a date before a rate change must bill the old rate.
    await prisma.taxComponent.createMany({
      data: [
        { facilityId, jurisdiction: 'state', rateBasisPoints: 625, effectiveFrom: d('2020-01-01') },
        { facilityId, jurisdiction: 'state', rateBasisPoints: 825, effectiveFrom: d('2026-10-01') },
      ],
    })
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
    expect(invoice.taxCents).toBe(806)
  })

  it('issues gapless sequential numbers per facility', async () => {
    await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
    await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
    await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const numbers = (
      await prisma.invoice.findMany({ where: { facilityId }, orderBy: { number: 'asc' } })
    ).map((i) => i.number)
    expect(numbers).toEqual(['000001', '000002', '000003'])
  })

  it('emits invoice.created with the number and total', async () => {
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { facilityId, name: 'invoice.created' },
    })
    const payload = event.payload as { leaseId: string; number: string; totalCents: number }
    expect(payload.leaseId).toBe(leaseId)
    expect(payload.number).toBe('000001')
    expect(payload.totalCents).toBe(12_900)
  })

  it('bills every lease on the 1st under first-of-month policy', async () => {
    await setPolicy({ billingPolicy: 'first_of_month' })
    // Lease billingDay says 20; the POLICY is the authority.
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })

    await generateInvoices(facilityId, d('2026-08-28'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
    expect(isoOf(invoice.periodStart)).toBe('2026-09-01')
    expect(invoice.totalCents).toBe(12_900)
  })

  it('skips a period the tenant has already moved out before', async () => {
    const leaseId = await makeLease({
      startDate: d('2026-08-20'),
      billingDay: 20,
      moveOutDate: d('2026-09-10'),
    })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(0)
  })

  it('prorates the final period when the facility prorates on move-out', async () => {
    await setPolicy({ prorateOnMoveOut: true })
    const leaseId = await makeLease({
      startDate: d('2026-08-20'),
      billingDay: 20,
      moveOutDate: d('2026-09-30'),
    })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { leaseId },
      include: { lineItems: true },
    })
    // 20 Sep – 30 Sep is 10 days of a 30-day period: $129.00 × 10/30 = $43.00.
    expect(invoice.totalCents).toBe(4_300)
    expect(invoice.lineItems[0].description).toContain('Sep 20 – Sep 29')
  })

  it('bills the whole period when the facility does not prorate on move-out', async () => {
    await setPolicy({ prorateOnMoveOut: false })
    const leaseId = await makeLease({
      startDate: d('2026-08-20'),
      billingDay: 20,
      moveOutDate: d('2026-09-30'),
    })

    await generateInvoices(facilityId, d('2026-09-15'), recordItem)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { leaseId } })
    expect(invoice.totalCents).toBe(12_900)
  })

  it('leaves an ended lease alone', async () => {
    const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20, status: 'ended' })
    await generateInvoices(facilityId, d('2026-09-15'), recordItem)
    expect(await prisma.invoice.count({ where: { leaseId } })).toBe(0)
  })

  // PRD 05 CN-1/CN-2, emitted from the invoice's own due date rather than a
  // comms-side calendar (CN-3). Nested here so they share the per-test cleanup.
  describe('due reminders', () => {
    it('emits due_soon at the lead time and due_today on the day', async () => {
      await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
      await generateInvoices(facilityId, d('2026-09-15'), recordItem)

      await emitDueReminders(facilityId, d('2026-09-15'), recordItem)
      await emitDueReminders(facilityId, d('2026-09-20'), recordItem)

      const names = (
        await prisma.domainEvent.findMany({
          where: { facilityId, entityType: 'Invoice' },
          orderBy: { occurredAt: 'asc' },
        })
      ).map((event) => event.name)
      expect(names).toContain('invoice.due_soon')
      expect(names).toContain('invoice.due_today')
    })

    it('does not chase an invoice that is already paid', async () => {
      const leaseId = await makeLease({ startDate: d('2026-08-20'), billingDay: 20 })
      await generateInvoices(facilityId, d('2026-09-15'), recordItem)
      await prisma.invoice.updateMany({
        where: { leaseId },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })
      await prisma.domainEvent.deleteMany({ where: { facilityId } })

      await emitDueReminders(facilityId, d('2026-09-20'), recordItem)

      expect(await prisma.domainEvent.count({ where: { facilityId } })).toBe(0)
    })
  })
})
