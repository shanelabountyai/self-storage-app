import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { attachRateReport, delinquencyReport, movesReport, occupancyReport, rentRoll } from '../apps/web/lib/admin/reports'
import { reportRange } from '../apps/web/lib/admin/report-range'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

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
let leaseId = ''

function actorFor(facilityIds: (string | null)[]): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: facilityIds.map((id) => ({
      facilityId: id,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set<PermissionKey>(['tenants:view', 'reports:operational', 'reports:financial']),
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
    leaseId = lease.id
    await prisma.unit.update({ where: { id: occupied.id }, data: { status: 'occupied' } })

    // A charge and a partial payment inside August.
    await prisma.ledgerEntry.createMany({
      data: [
        { facilityId, leaseId: lease.id, type: 'charge', amountCents: 15_000, description: 'Rent', occurredAt: d('2026-08-10') },
        { facilityId, leaseId: lease.id, type: 'payment', amountCents: -10_000, description: 'Payment', occurredAt: d('2026-08-12') },
      ],
    })

    // B-298. The boundary fixture, on facility B so it cannot move any figure
    // the tests above pin. Two rows that a single pair of bounds has to get
    // right in OPPOSITE directions, which is the whole of D-138:
    //
    //   - a lease starting 1 September, whose `startDate` is a facility-local
    //     calendar day at UTC midnight (D-139), and
    //   - a payment taken at 8pm on 31 August in Texas, which is a real
    //     instant — `2026-09-01T01:00Z`.
    //
    // Read with a September range they must land on different sides: the
    // move-in is September's, the payment is August's.
    const otherType = await prisma.unitType.create({
      data: { facilityId: otherFacilityId, name: `10x20 ${suffix}`, widthFt: 10, lengthFt: 20 },
    })
    await prisma.unitTypeRate.create({
      data: { facilityId: otherFacilityId, unitTypeId: otherType.id, streetRateCents: 30_000, webRateCents: 28_000, effectiveFrom: d('2020-01-01') },
    })
    const otherUnit = await prisma.unit.create({
      data: { facilityId: otherFacilityId, unitTypeId: otherType.id, number: 'B-1', status: 'occupied' },
    })
    const boundaryLease = await prisma.lease.create({
      data: {
        facilityId: otherFacilityId,
        tenantId,
        unitId: otherUnit.id,
        status: 'active',
        startDate: d('2026-09-01'),
        monthlyRateCents: 25_000,
        billingDay: 1,
      },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId: otherFacilityId,
        leaseId: boundaryLease.id,
        type: 'payment',
        amountCents: -7_000,
        description: 'Paid at 8pm on the 31st',
        occurredAt: new Date('2026-09-01T01:00:00.000Z'),
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    const ids = [facilityId, otherFacilityId]
    // Cascades to `paymentAllocation`; invoices are Restrict-on-delete from
    // the lease side, so they come out before the lease does.
    await prisma.payment.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.invoice.deleteMany({ where: { facilityId: { in: ids } } })
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

  // B-155. `movesReport` above already has the fixture: one lease, started
  // 2026-08-10, no protection plan, no payment. This describe extends the
  // SAME lease rather than creating its own — attach rate is about that
  // move-in's payment and plan, and a second lease would just be more
  // fixture to keep in sync with the same date window.
  describe('attachRateReport', () => {
    it('reports zero enrolled and an unassigned move-in while nothing is set', async () => {
      const report = await attachRateReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.attach.overall.moveIns).toBe(1)
      expect(row.attach.overall.enrolled).toBe(0)
      expect(row.attach.byStaff.unassigned.moveIns).toBe(1)
    })

    it('counts the move-in as enrolled once a plan is set, attributed to the staffer who took the payment', async () => {
      await prisma.lease.update({
        where: { id: leaseId },
        data: { protectionPlanName: 'Basic', protectionCents: 500 },
      })
      const invoice = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId,
          number: `RPT-${suffix}`,
          status: 'paid',
          issueDate: d('2026-08-10'),
          dueDate: d('2026-08-10'),
          periodStart: d('2026-08-10'),
          periodEnd: d('2026-09-10'),
          totalCents: 15_000,
          amountPaidCents: 15_000,
        },
      })
      const payment = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 15_000,
          method: 'cash',
          receivedAt: d('2026-08-10'),
          receivedByStaffId: staffId,
        },
      })
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amountCents: 15_000 },
      })

      const report = await attachRateReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = report.rows.find((r) => r.facilityId === facilityId)!
      expect(row.attach.overall.enrolled).toBe(1)
      expect(row.attach.byStaff[staffId]?.moveIns).toBe(1)
      expect(row.attach.byStaff[staffId]?.enrolled).toBe(1)
      expect(report.staffNames[staffId]).toBe('Rae Reporter')
      // Rolled to the portfolio total the same way `movesReport` is (D-25):
      // summed, not averaged.
      expect(report.total.overall.moveIns).toBeGreaterThanOrEqual(row.attach.overall.moveIns)
    })

    // B-404. Runs after the payment above, so the staffer attribution exists.
    it('reports autopay share over the same move-ins, off then on', async () => {
      const before = await attachRateReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const rowBefore = before.rows.find((r) => r.facilityId === facilityId)!
      expect(rowBefore.autopay.overall).toMatchObject({ moveIns: 1, enrolled: 0, rate: 0 })

      await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: true } })

      const after = await attachRateReport(actorFor([facilityId]), d('2026-08-01'), d('2026-09-01'))
      const row = after.rows.find((r) => r.facilityId === facilityId)!
      expect(row.autopay.overall).toMatchObject({ moveIns: 1, enrolled: 1, rate: 1 })
      expect(row.autopay.byStaff[staffId]?.enrolled).toBe(1)
      expect(after.autopayTotal.overall.enrolled).toBeGreaterThanOrEqual(1)
    })
  })

  // B-298 / D-139. The gap B-297 recorded and left open, and the audit of the
  // rest of `figuresFor` that came with it.
  //
  // The bounds come from `reportRange` rather than from `d()`, because that is
  // what every caller now passes and the whole question is what a query does
  // with them. `now` is fixed in October so the month is complete and the
  // default never applies.
  describe('D-138 at the month boundary', () => {
    const at = { now: new Date('2026-10-15T12:00:00.000Z'), timeZones: ['America/Chicago'] }
    const august = reportRange({ from: '2026-08-01', to: '2026-08-31' }, at)
    const september = reportRange({ from: '2026-09-01', to: '2026-09-30' }, at)
    const only = <T extends { facilityId: string }>(rows: T[]): T =>
      rows.find((row) => row.facilityId === otherFacilityId)!

    // Without the conversion the bound is `2026-09-01T05:00Z` and the lease's
    // `startDate` is `2026-09-01T00:00Z`, so a move-in on the first of the
    // month was counted in the month BEFORE it — for a portfolio that opens
    // leases on the 1st, most of them.
    it('counts a move-in on the 1st in that month, not the one before', async () => {
      const sep = await movesReport(actorFor([otherFacilityId]), september.start, september.end)
      expect(only(sep.rows).moves.moveIns).toBe(1)

      const aug = await movesReport(actorFor([otherFacilityId]), august.start, august.end)
      expect(only(aug.rows).moves.moveIns).toBe(0)
    })

    // The same lease through the other report that filters `startDate`. These
    // two are read on one screen and the attach rate's denominator is supposed
    // to BE the move-in count, so a conversion in one and not the other is two
    // figures disagreeing in front of an operator.
    it('agrees with the attach rate about which month that move-in is in', async () => {
      const sep = await attachRateReport(actorFor([otherFacilityId]), september.start, september.end)
      expect(only(sep.rows).attach.overall.moveIns).toBe(1)

      const aug = await attachRateReport(actorFor([otherFacilityId]), august.start, august.end)
      expect(only(aug.rows).attach.overall.moveIns).toBe(0)
    })

    // The audit half of B-298, pinned rather than described: every column
    // `occupancyForFacility` filters is a real instant — `occurredAt` here,
    // and `effectiveFrom` on `unit_type_rate` and `unit_status_history`, both
    // written by `new Date()` or a trigger's `now()`. So it must NOT convert,
    // and this fails if somebody makes it symmetric with the two above: an
    // 8pm payment on 31 August is August's money whatever the calendar date in
    // UTC says.
    it('leaves an 8pm payment on the 31st in that month, unconverted', async () => {
      const aug = await occupancyReport(actorFor([otherFacilityId]), august.start, august.end)
      expect(only(aug.rows).economic.collectedCents).toBe(7_000)

      const sep = await occupancyReport(actorFor([otherFacilityId]), september.start, september.end)
      expect(only(sep.rows).economic.collectedCents).toBe(0)
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
