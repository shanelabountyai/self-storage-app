import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { categoryTotal } from '../packages/core/metrics'
import {
  billedTotal,
  collectedTotal,
  revenueReport,
  sumRevenueRows,
} from '../apps/web/lib/admin/revenue-report'
import { agingByFacility, delinquencyDetail } from '../apps/web/lib/admin/delinquency-detail'
import { delinquencyReport } from '../apps/web/lib/admin/reports'
import { moneyOwedRollup } from '../apps/web/lib/admin/rollups'
import { formatCents } from '../apps/web/lib/format'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-055 / PRD 02 US-39.4 and US-39.5, against real rows.
//
// The AC this file exists for, in US-14's own words: "an ended lease carrying a
// balance... never simply disappears from the delinquency view, and it stays
// inside the AR aging report (US-39.4)." A move-out is when a balance is least
// likely to be paid and most likely to be forgotten, and a `status: 'active'`
// filter would make it vanish silently.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const MARCH = { start: d('2026-03-01'), end: d('2026-04-01') }
const APRIL = { start: d('2026-04-01'), end: d('2026-05-01') }

let facilityId = ''
let staffId = ''
let activeLeaseId = ''
let endedLeaseId = ''
let activeTenantId = ''
let invoiceCounter = 0

function actor(permissions: string[] = ['reports:financial', 'reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeLease(options: { number: string; status: 'active' | 'ended' }) {
  const tenant = await prisma.tenant.create({
    data: {
      email: `rev-${options.number.toLowerCase()}-${suffix}@example.com`,
      firstName: 'Ada',
      lastName: `Renter ${suffix}`,
    },
  })
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${options.number} ${suffix}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId: unitType.id, number: options.number },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: options.status,
      startDate: d('2026-01-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  return { leaseId: lease.id, tenantId: tenant.id }
}

/// An invoice of $129 rent + $10.64 tax + $25 fee = $164.64.
async function makeInvoice(leaseId: string, issueDate: Date) {
  invoiceCounter += 1
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `R${suffix}${String(invoiceCounter).padStart(4, '0')}`,
      kind: 'rent',
      status: 'open',
      issueDate,
      dueDate: issueDate,
      periodStart: issueDate,
      periodEnd: new Date(issueDate.getTime() + 30 * 86_400_000),
      subtotalCents: 15_400,
      taxCents: 1_064,
      totalCents: 16_464,
      lineItems: {
        create: [
          { type: 'rent', description: 'Rent', amountCents: 12_900, unitAmountCents: 12_900 },
          { type: 'fee', description: 'Admin fee', amountCents: 2_500, unitAmountCents: 2_500 },
          { type: 'tax', description: 'Sales tax', amountCents: 1_064, unitAmountCents: 1_064 },
        ],
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      invoiceId: invoice.id,
      type: 'charge',
      amountCents: 16_464,
      description: 'Rent invoice',
      occurredAt: issueDate,
    },
  })
  return invoice
}

async function payInvoice(input: {
  invoiceId: string
  leaseId: string
  tenantId: string
  amountCents: number
  receivedAt: Date
}) {
  const payment = await prisma.payment.create({
    data: {
      facilityId,
      tenantId: input.tenantId,
      amountCents: input.amountCents,
      method: 'card',
      status: 'succeeded',
      receivedAt: input.receivedAt,
      allocations: { create: [{ invoiceId: input.invoiceId, amountCents: input.amountCents }] },
    },
  })
  await prisma.invoice.update({
    where: { id: input.invoiceId },
    data: { amountPaidCents: { increment: input.amountCents }, status: 'partially_paid' },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: input.leaseId,
      invoiceId: input.invoiceId,
      paymentId: payment.id,
      type: 'payment',
      amountCents: -input.amountCents,
      description: 'Payment',
      occurredAt: input.receivedAt,
    },
  })
  return payment
}

describeDb('financial reports', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Revenue Test ${suffix}`,
        slug: `revenue-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `rev-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const active = await makeLease({ number: `A-${suffix.slice(0, 3)}`, status: 'active' })
    activeLeaseId = active.leaseId
    activeTenantId = active.tenantId
    const ended = await makeLease({ number: `Z-${suffix.slice(0, 3)}`, status: 'ended' })
    endedLeaseId = ended.leaseId

    // March: one invoice each, one partial payment on the active lease.
    const marchActive = await makeInvoice(activeLeaseId, d('2026-03-01'))
    await makeInvoice(endedLeaseId, d('2026-03-01'))
    // $30 — enough to clear $10.64 tax and $19.36 of the $25 fee under the
    // default order (tax → fee → protection → rent).
    await payInvoice({
      invoiceId: marchActive.id,
      leaseId: activeLeaseId,
      tenantId: activeTenantId,
      amountCents: 3_000,
      receivedAt: d('2026-03-15'),
    })
    // April: the rest of the same invoice, so the report has to split by the
    // running total rather than by the payment alone.
    await payInvoice({
      invoiceId: marchActive.id,
      leaseId: activeLeaseId,
      tenantId: activeTenantId,
      amountCents: 5_000,
      receivedAt: d('2026-04-10'),
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.$disconnect()
  })

  describe('revenue — US-39.5', () => {
    it('bills by category on the invoice issue date', async () => {
      const report = await revenueReport(actor(), MARCH.start, MARCH.end)
      const row = report.rows.find((one) => one.facilityId === facilityId)!

      // Two invoices issued in March, $164.64 each.
      expect(row.billed).toEqual({ rent: 25_800, fee: 5_000, tax: 2_128, protection: 0 })
      expect(billedTotal(row)).toBe(32_928)
    })

    it('bills nothing in a range with no invoices in it', async () => {
      const report = await revenueReport(actor(), APRIL.start, APRIL.end)
      const row = report.rows.find((one) => one.facilityId === facilityId)!
      expect(billedTotal(row)).toBe(0)
    })

    it('collects in the facility order, not proportionally', async () => {
      const report = await revenueReport(actor(), MARCH.start, MARCH.end)
      const row = report.rows.find((one) => one.facilityId === facilityId)!

      // $30 against $10.64 tax + $25 fee + $129 rent settles the tax whole and
      // $19.36 of the fee. A proportional split would report rent in March,
      // which the tenant's own ledger would contradict.
      expect(row.collected).toEqual({ tax: 1_064, fee: 1_936, rent: 0, protection: 0 })
      expect(categoryTotal(row.collected)).toBe(3_000)
    })

    it('picks up the running total when an invoice is paid across two periods', async () => {
      const report = await revenueReport(actor(), APRIL.start, APRIL.end)
      const row = report.rows.find((one) => one.facilityId === facilityId)!

      // April's $50 continues where March's $30 stopped: $5.64 finishes the
      // fee, the remaining $44.36 lands on rent.
      expect(row.collected).toEqual({ tax: 0, fee: 564, rent: 4_436, protection: 0 })
      expect(categoryTotal(row.collected)).toBe(5_000)
    })

    it('roll-up equals the sum of the facility rows', async () => {
      const report = await revenueReport(actor(), MARCH.start, MARCH.end)
      expect(report.total).toEqual(sumRevenueRows(report.rows))
      expect(billedTotal(report.total)).toBe(
        report.rows.reduce((sum, row) => sum + billedTotal(row), 0),
      )
      expect(collectedTotal(report.total)).toBe(
        report.rows.reduce((sum, row) => sum + collectedTotal(row), 0),
      )
    })

    it('shows nothing to a staffer with only the operational report key', async () => {
      // The catalog's own words: `reports:financial` is "Revenue, AR, and
      // delinquency aging". A counter agent holding only the operational key
      // has no business reading the portfolio's receivables.
      const report = await revenueReport(actor(['reports:operational']), MARCH.start, MARCH.end)
      expect(report.rows.find((one) => one.facilityId === facilityId)).toBeUndefined()
    })
  })

  describe('delinquency aging — US-39.4', () => {
    it('keeps an ended lease that still owes money', async () => {
      const report = await delinquencyDetail(actor(), d('2026-04-20'))
      const ended = report.rows.find((row) => row.leaseId === endedLeaseId)

      expect(ended).toBeDefined()
      expect(ended!.leaseStatus).toBe('ended')
      expect(ended!.outstandingCents).toBe(16_464)
      expect(report.endedLeaseExposureCents).toBeGreaterThanOrEqual(16_464)
    })

    it('ages from the original due date, so a partly-paid lease still ages', async () => {
      const report = await delinquencyDetail(actor(), d('2026-04-20'))
      const active = report.rows.find((row) => row.leaseId === activeLeaseId)!

      // Due 2026-03-01, asked on 2026-04-20 — 50 days, whatever was paid since.
      expect(active.daysPastDue).toBe(50)
      expect(active.bucket).toBe('d31to60')
      expect(active.outstandingCents).toBe(16_464 - 8_000)
    })

    it('buckets sum to the total exposure, with nothing dropped', async () => {
      const report = await delinquencyDetail(actor(), d('2026-04-20'))
      const bucketSum =
        report.aging.d0to10 +
        report.aging.d11to30 +
        report.aging.d31to60 +
        report.aging.d61to90 +
        report.aging.over90
      expect(bucketSum).toBe(report.aging.totalCents)
      expect(report.totalExposureCents).toBe(report.aging.totalCents)
    })

    it('per-facility aging rolls up to the same total', async () => {
      const report = await delinquencyDetail(actor(), d('2026-04-20'))
      const byFacility = agingByFacility(report.rows)
      expect(byFacility.reduce((sum, row) => sum + row.aging.totalCents, 0)).toBe(
        report.aging.totalCents,
      )
    })

    it('counts every lease with a balance in the step distribution', async () => {
      const report = await delinquencyDetail(actor(), d('2026-04-20'))
      expect(report.stepCounts.reduce((sum, step) => sum + step.leases, 0)).toBe(report.rows.length)
      expect(report.stepCounts.reduce((sum, step) => sum + step.outstandingCents, 0)).toBe(
        report.totalExposureCents,
      )
    })

    it('shows nothing to a staffer with only the operational report key', async () => {
      const report = await delinquencyDetail(actor(['reports:operational']), d('2026-04-20'))
      expect(report.rows.find((row) => row.facilityId === facilityId)).toBeUndefined()
    })
  })

  describe('the dashboard tile and the report behind it (B-113)', () => {
    // The tile used to count `Lease.status = 'delinquent'`, and nothing writes
    // that status until B-057 — so the one screen an owner opens to find out
    // whether anybody is paying showed 0 next to real receivables. It now reads
    // `delinquencyReport`, the same call the Delinquency report renders, which
    // is D-25's rule: the metrics module owns every figure and no tile computes
    // one inline. These pin that they cannot drift apart again.

    it('reports money owed, in dollars, matching the AR aging report', async () => {
      const report = await delinquencyReport(actor())
      const row = report.rows.find((one) => one.facilityId === facilityId)

      expect(row).toBeDefined()
      // Real receivables exist in this fixture — and not one lease carries
      // `status: 'delinquent'`, which is exactly the condition under which the
      // old tile read zero beside them.
      expect(row!.aging.totalCents).toBeGreaterThan(0)
      expect(
        await prisma.lease.count({ where: { facilityId, status: 'delinquent' } }),
      ).toBe(0)

      // Buckets sum to the total, so the tile's hint ("$X over 30 days") is a
      // subset of the figure above it rather than a second calculation.
      const { d0to10, d11to30, d31to60, d61to90, over90, totalCents } = row!.aging
      expect(d0to10 + d11to30 + d31to60 + d61to90 + over90).toBe(totalCents)
    })

    it('renders the roll-up from the same rows, not from a second query', async () => {
      const [report, rollup] = await Promise.all([
        delinquencyReport(actor()),
        moneyOwedRollup(actor()),
      ])
      expect(rollup.map((row) => row.facilityId)).toEqual(report.rows.map((row) => row.facilityId))
      for (const row of report.rows) {
        const rolled = rollup.find((one) => one.facilityId === row.facilityId)!
        expect(rolled.summary).toBe(formatCents(row.aging.totalCents))
      }
    })

    it('shows a role without financial reporting nothing rather than a zero', async () => {
      // A zero is a claim. A manager who cannot see AR must not be told there
      // is none — the dashboard omits the tile instead.
      const rollup = await moneyOwedRollup(actor(['reports:operational']))
      expect(rollup).toEqual([])
    })
  })

})
