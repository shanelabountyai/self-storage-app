import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  rateIncreaseOutcomeReport,
  windowCell,
} from '../apps/web/lib/admin/rate-increase-outcome-report'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-400. The adapter against real rows: an increase is read by effective date,
// a retention save on the same lease is an outcome and never a row of its own,
// a move-out counts only once the lease has ended, and a window not yet
// elapsed says "not yet".

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let unitTypeId = ''
let counter = 0

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: 'outcome-test',
    assignments: [
      {
        facilityId,
        roleKey: 'regional',
        rank: 30,
        permissions: new Set<PermissionKey>(['reports:financial'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

async function increasedLease(opts: {
  inPlace: number
  raisedTo: number
  batchId: string | null
  effective: string
  ended?: { on: string; cause: 'price_or_rate_increase' | 'moved_away' }
  cutTo?: { rate: number; on: string }
}) {
  counter += 1
  const tenant = await prisma.tenant.create({
    data: { email: `rio-${suffix}-${counter}@example.com`, firstName: 'Outcome', lastName: `T${counter}` },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `O-${suffix.slice(0, 4)}-${counter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: opts.ended ? 'ended' : 'active',
      startDate: day('2024-01-01'),
      billingDay: 1,
      monthlyRateCents: opts.cutTo?.rate ?? opts.raisedTo,
      moveOutDate: opts.ended ? day(opts.ended.on) : null,
      moveOutCause: opts.ended?.cause ?? null,
    },
  })
  const row = (current: number, next: number, effective: string, batchId: string | null) => ({
    facilityId,
    leaseId: lease.id,
    currentRateCents: current,
    newRateCents: next,
    effectiveDate: day(effective),
    noticeDate: day(effective),
    noticeDays: 30,
    status: 'applied' as const,
    batchId,
    appliedAt: day(effective),
  })
  await prisma.tenantRateIncrease.create({ data: row(opts.inPlace, opts.raisedTo, opts.effective, opts.batchId) })
  if (opts.cutTo) {
    await prisma.tenantRateIncrease.create({ data: row(opts.raisedTo, opts.cutTo.rate, opts.cutTo.on, null) })
  }
}

describeDb('rate increase outcome report (B-400)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Outcome ${suffix}`,
        slug: `outcome-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        // Inactive so no public read (the marketplace feed, search) lists it
        // while it exists and then loses it when `afterAll` deletes it —
        // `marketplace-db` failed exactly that way in a parallel run. The
        // report reads by the actor's facilities, not by status.
        status: 'inactive',
      },
    })
    facilityId = facility.id
    unitTypeId = (
      await prisma.unitType.create({ data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 } })
    ).id

    const batch = `batch-${suffix}`
    await increasedLease({
      inPlace: 10_000,
      raisedTo: 11_000,
      batchId: batch,
      effective: '2026-06-01',
      ended: { on: '2026-07-16', cause: 'price_or_rate_increase' },
    })
    await increasedLease({
      inPlace: 8_000,
      raisedTo: 9_000,
      batchId: batch,
      effective: '2026-06-01',
      cutTo: { rate: 8_400, on: '2026-06-21' },
    })
    await increasedLease({ inPlace: 12_000, raisedTo: 13_500, batchId: batch, effective: '2026-06-01' })
    // A one-off in the same range, 40 days old on the report date.
    await increasedLease({ inPlace: 5_000, raisedTo: 5_500, batchId: null, effective: '2026-06-22' })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { startsWith: `rio-${suffix}-` } } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.delete({ where: { id: facilityId } })
  })

  it('groups by batch, keeps the retention save out of the rows, and measures only elapsed windows', async () => {
    // Chicago noon on 1 August: the batch is 61 days in, the one-off 40.
    const report = await rateIncreaseOutcomeReport(
      actor(),
      new Date('2026-06-01T05:00:00Z'),
      new Date('2026-07-01T05:00:00Z'),
      new Date('2026-08-01T17:00:00Z'),
    )
    const facility = report.facilities.find((row) => row.facilityId === facilityId)!
    expect(facility.outcome.count).toBe(4)
    expect(facility.batches.map((batch) => batch.outcome.count)).toEqual([3, 1])

    const [batch, oneOff] = facility.batches
    expect(batch.batchId).toBe(`batch-${suffix}`)
    expect(oneOff.batchId).toBeNull()
    expect(windowCell(batch.outcome, 60)).toBe('1 (1 for price)')
    expect(windowCell(batch.outcome, 90)).toBe('not yet')
    expect(windowCell(oneOff.outcome, 60)).toBe('not yet')
    // The facility has reached 60 days for three of its four increases.
    expect(windowCell(facility.outcome, 60)).toBe('1 of 3 (1 for price)')
  })

  it('reports the retention cut and net once day 90 has passed', async () => {
    const report = await rateIncreaseOutcomeReport(
      actor(),
      new Date('2026-06-01T05:00:00Z'),
      new Date('2026-07-01T05:00:00Z'),
      new Date('2026-10-01T17:00:00Z'),
    )
    const facility = report.facilities.find((row) => row.facilityId === facilityId)!
    expect(facility.outcome.retentionCutLeases).toBe(1)
    expect(facility.outcome.retentionCutCents).toBe(600)
    // kept: (9000 − 8000 − 600) + 1500 + 500 = 2400; lost: 10000.
    expect(facility.outcome.netMonthlyCents).toBe(-7_600)
  })
})
