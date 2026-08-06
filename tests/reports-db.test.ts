import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { delinquencyReport, movesReport, occupancyReport, rentRoll } from '../apps/web/lib/admin/reports'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'

// B-042 / PRD 02 US-39. The adapter between real rows and the metrics module.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let staffId = ''
let unitTypeId = ''

function actorFor(facilityIds: (string | null)[]): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: facilityIds.map((id) => ({
      facilityId: id,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set(['tenants:view', 'reports:operational', 'reports:financial']),
      limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
    })),
  }
}

describeDb('reports', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `Reports A ${suffix}`,
          slug: `reports-a-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: `Reports B ${suffix}`,
          slug: `reports-b-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      }),
    ])
    facilityId = facility.id
    otherFacilityId = other.id

    const staff = await prisma.staffUser.create({
      data: { email: `reports-${suffix}@example.com`, firstName: 'Rae', lastName: 'Reporter' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `reports-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: { facilityId, unitTypeId, streetRateCents: 20_000, webRateCents: 18_000, effectiveFrom: d('2020-01-01') },
    })

    // Four units: one occupied, one available, one maintenance, one unrentable.
    const [occupied, , ,] = await Promise.all([
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-1' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-2' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-3', operationalStatus: 'maintenance', status: 'maintenance' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-4', operationalStatus: 'unrentable', status: 'unrentable' } }),
    ])

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: occupied.id,
        status: 'active',
        startDate: d('2026-08-10'),
        monthlyRateCents: 15_000,
        billingDay: 1,
      },
    })
    await prisma.unit.update({ where: { id: occupied.id }, data: { status: 'occupied' } })

    // A charge and a partial payment inside August.
    await prisma.ledgerEntry.createMany({
      data: [
        { facilityId, leaseId: lease.id, type: 'charge', amountCents: 15_000, description: 'Rent', occurredAt: d('2026-08-10') },
        { facilityId, leaseId: lease.id, type: 'payment', amountCents: -10_000, description: 'Payment', occurredAt: d('2026-08-12') },
      ],
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    const ids = [facilityId, otherFacilityId]
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unit.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unitType.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: { in: ids } } })
    await prisma.$disconnect()
  })

  describe('occupancyReport', () => {
    it('counts maintenance as rentable and leaves unrentable out entirely', async () => {
      const report = await occupancyReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!

      expect(row.occupancy.occupiedCount).toBe(1)
      // A-1 occupied, A-2 available, A-3 maintenance = 3 rentable. A-4 is not.
      expect(row.occupancy.rentableCount).toBe(3)
      expect(row.occupancy.ratio).toBeCloseTo(1 / 3, 10)
    })

    it('reads collected revenue off the ledger as a positive amount', async () => {
      const report = await occupancyReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      // Payments are stored negative; collected is the magnitude.
      expect(row.economic.collectedCents).toBe(10_000)
      // Gross potential: 3 rentable units at the 20,000 street rate.
      expect(row.economic.grossPotentialCents).toBe(60_000)
      expect(row.economic.ratio).toBeCloseTo(10_000 / 60_000, 10)
    })

    it('excludes payments outside the period', async () => {
      const report = await occupancyReport(actorFor([facilityId]), d('2026-09-01'), d('2026-10-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.economic.collectedCents).toBe(0)
    })

    it('rolls up to exactly the sum of its rows', async () => {
      const report = await occupancyReport(actorFor([facilityId, otherFacilityId]), d('2026-08-01'), d('2026-09-01'))
      const summedOccupied = report.rows.reduce((t, r) => t + r.occupancy.occupiedCount, 0)
      const summedRentable = report.rows.reduce((t, r) => t + r.occupancy.rentableCount, 0)
      const summedCollected = report.rows.reduce((t, r) => t + r.economic.collectedCents, 0)

      expect(report.total.occupancy.occupiedCount).toBe(summedOccupied)
      expect(report.total.occupancy.rentableCount).toBe(summedRentable)
      expect(report.total.economic.collectedCents).toBe(summedCollected)
    })

    it('never includes a facility the actor cannot see', async () => {
      const report = await occupancyReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      expect(report.rows.map((r) => r.facilityId)).not.toContain(otherFacilityId)
    })
  })

  describe('rentRoll', () => {
    it('lists occupied units with the gap against the current street rate', async () => {
      const rows = await rentRoll(actorFor([facilityId]), facilityId)
      expect(rows).toHaveLength(1)
      expect(rows[0].unitNumber).toBe('A-1')
      expect(rows[0].inPlaceRateCents).toBe(15_000)
      expect(rows[0].streetRateCents).toBe(20_000)
      expect(rows[0].gapCents).toBe(5_000)
      expect(rows[0].balanceCents).toBe(5_000)
    })

    it('refuses a facility the actor is not assigned to', async () => {
      await expect(rentRoll(actorFor([otherFacilityId]), facilityId)).rejects.toThrow(ForbiddenError)
    })
  })

  describe('movesReport', () => {
    it('counts a move-in inside the period and not outside it', async () => {
      const inAugust = await movesReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      expect(inAugust.rows.find((r) => r.facilityId === facilityId)!.moves.moveIns).toBe(1)

      const inSeptember = await movesReport(actorFor([facilityId]), d('2026-09-01'), d('2026-10-01'))
      expect(inSeptember.rows.find((r) => r.facilityId === facilityId)!.moves.moveIns).toBe(0)
    })

    it('attributes every move-in to `unknown` while nothing records a source', async () => {
      // Honest rather than crediting `web` — see the note in reports.ts.
      const report = await movesReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.moves.bySource.unknown).toBe(1)
      expect(row.moves.bySource.web).toBe(0)
    })
  })

  describe('delinquencyReport', () => {
    it('totals the real outstanding balance', async () => {
      const report = await delinquencyReport(actorFor([facilityId]))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.aging.totalCents).toBe(5_000)
    })

    it('puts everything in the first bucket while no invoices exist', async () => {
      // Documented, not a bug: `daysPastDue` needs invoice due dates and
      // nothing creates invoices until B-044, so every lease is 0 days past
      // due. The screen says so rather than showing buckets that look aged.
      const report = await delinquencyReport(actorFor([facilityId]))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.aging.d0to10).toBe(5_000)
      expect(row.aging.over90).toBe(0)
    })

    it('rolls up to the sum of its rows', async () => {
      const report = await delinquencyReport(actorFor([facilityId, otherFacilityId]))
      const summed = report.rows.reduce((t, r) => t + r.aging.totalCents, 0)
      expect(report.total.totalCents).toBe(summed)
    })
  })
})
