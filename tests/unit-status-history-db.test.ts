import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  combineProvenance,
  occupancyForFacility,
  unitOccupancyNote,
  type UnitOccupancyProvenance,
} from '../apps/web/lib/admin/reports'

// B-131 / PRD 02 US-39.1. Unit occupancy is historical, and says so when it
// cannot be.
//
// The thing under test is mostly a database trigger, so most of this suite has
// to touch the database to mean anything — a mocked write would assert that the
// mock works. `unitStatusHistory` rows are BACKDATED by hand here rather than
// waiting for time to pass: the trigger stamps `now()`, which is correct in
// production and useless for asserting what July looked like.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let unitTypeId = ''
let unitAId = ''
let unitBId = ''

async function backdate(unitId: string, status: string, at: Date) {
  const row = await prisma.unitStatusHistory.findFirst({
    where: { unitId, status: status as never },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!row) throw new Error(`no history row for ${unitId} at ${status} — the trigger did not fire`)
  await prisma.unitStatusHistory.update({ where: { id: row.id }, data: { effectiveFrom: at } })
}

describeDb('unit status history', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `History ${suffix}`,
        slug: `history-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 20_000,
        webRateCents: 18_000,
        effectiveFrom: d('2020-01-01'),
      },
    })

    const [a, b] = await Promise.all([
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'H-1' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId, number: 'H-2' } }),
    ])
    unitAId = a.id
    unitBId = b.id

    // Both units existed and were empty from 1 May.
    await backdate(unitAId, 'available', d('2026-05-01'))
    await backdate(unitBId, 'available', d('2026-05-01'))

    // A rented on 15 June; B not until today. So June's occupancy is 1 of 2 and
    // today's is 2 of 2 — which is the whole point: reading `Unit.status` gives
    // the second answer to the first question.
    await prisma.unit.update({ where: { id: unitAId }, data: { status: 'occupied' } })
    await backdate(unitAId, 'occupied', d('2026-06-15'))
    await prisma.unit.update({ where: { id: unitBId }, data: { status: 'occupied' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  describe('the trigger', () => {
    it('records a row when a unit is created, without the application asking', async () => {
      // Nothing in `prisma.unit.create` mentions history. If this ever fails,
      // the guarantee the table rests on is gone — every writer is covered
      // because none of them has to remember.
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `H-T1-${suffix}` },
      })
      const rows = await prisma.unitStatusHistory.findMany({ where: { unitId: unit.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('available')
      expect(rows[0]!.facilityId).toBe(facilityId)
    })

    it('records a row on every status change and none on a same-value write', async () => {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `H-T2-${suffix}` },
      })
      await prisma.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } })
      // `AFTER UPDATE OF status` fires for a write that sets the same value, so
      // the function checks. Without that, every unrelated edit that happened to
      // include the column would log a change that did not happen — and a
      // history that logs non-changes is one you cannot read backwards.
      await prisma.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } })
      await prisma.unit.update({ where: { id: unit.id }, data: { notes: 'unrelated edit' } })

      const rows = await prisma.unitStatusHistory.findMany({
        where: { unitId: unit.id },
        orderBy: { effectiveFrom: 'asc' },
      })
      expect(rows.map((row) => row.status)).toEqual(['available', 'occupied'])
    })
  })

  describe('occupancyForFacility', () => {
    it('answers for the period asked for, not for today', async () => {
      const june = await occupancyForFacility(facilityId, 'History', d('2026-06-01'), d('2026-07-01'))
      expect(june.unitOccupancy.followsPeriod).toBe(true)
      expect(june.unitOccupancy.reason).toBe('as-at-period-end')
      expect(june.unitOccupancy.asAt).toEqual(d('2026-07-01'))
      // A is occupied by 15 June, B is not yet — even though B is occupied now.
      expect(june.occupancy.occupiedCount).toBe(1)
      expect(june.occupancy.rentableCount).toBe(2)
    })

    it('gives a different answer for a different month, from the same rows', async () => {
      const may = await occupancyForFacility(facilityId, 'History', d('2026-05-01'), d('2026-06-01'))
      expect(may.unitOccupancy.followsPeriod).toBe(true)
      expect(may.occupancy.occupiedCount).toBe(0)
      expect(may.occupancy.rentableCount).toBe(2)
    })

    it('leaves out units that did not exist yet rather than counting them empty', async () => {
      // Both fixture units start on 1 May; a unit built later must not inflate
      // April's denominator, which is what a current-status read does.
      const april = await occupancyForFacility(facilityId, 'History', d('2026-04-01'), d('2026-05-01'))
      expect(april.unitOccupancy.reason).toBe('before-history')
      expect(april.occupancy.rentableCount).toBeGreaterThan(0)
    })

    it('refuses to pretend about a period older than the history, and names the date', async () => {
      const old = await occupancyForFacility(facilityId, 'History', d('2026-01-01'), d('2026-02-01'))
      expect(old.unitOccupancy.followsPeriod).toBe(false)
      expect(old.unitOccupancy.reason).toBe('before-history')
      expect(old.unitOccupancy.historyBegins).toEqual(d('2026-05-01'))
      // The figures shown are today's, which is the honest fallback — and the
      // note says exactly that.
      expect(unitOccupancyNote(old.unitOccupancy, 'January 2026')).toContain('as of today')
      expect(unitOccupancyNote(old.unitOccupancy, 'January 2026')).toContain('May 1, 2026')
    })

    it('says so when the period has not finished', async () => {
      const future = await occupancyForFacility(facilityId, 'History', d('2099-01-01'), d('2099-02-01'))
      expect(future.unitOccupancy.followsPeriod).toBe(false)
      expect(future.unitOccupancy.reason).toBe('period-not-ended')
    })

    it('measures economic occupancy over the same unit set as unit occupancy', async () => {
      // The metrics module exists to stop two figures on one page disagreeing
      // about which units count; an as-at read that changed one and not the
      // other would reintroduce exactly that.
      const june = await occupancyForFacility(facilityId, 'History', d('2026-06-01'), d('2026-07-01'))
      expect(june.economic.grossPotentialCents).toBe(2 * 20_000)
    })
  })
})

describe('combineProvenance', () => {
  const at = new Date('2026-07-01T00:00:00.000Z')
  const historical: UnitOccupancyProvenance = {
    asAt: at,
    followsPeriod: true,
    reason: 'as-at-period-end',
    historyBegins: new Date('2026-05-01T00:00:00.000Z'),
  }

  it('is only as strong as the weakest row', () => {
    const combined = combineProvenance([
      historical,
      { ...historical, followsPeriod: false, reason: 'before-history' },
    ])
    expect(combined.followsPeriod).toBe(false)
    expect(combined.reason).toBe('before-history')
  })

  it('takes the latest start, because the portfolio can only answer from then', () => {
    const combined = combineProvenance([
      historical,
      { ...historical, historyBegins: new Date('2026-06-20T00:00:00.000Z') },
    ])
    expect(combined.historyBegins).toEqual(new Date('2026-06-20T00:00:00.000Z'))
  })

  it('ignores facilities with no units instead of letting them drag it down', () => {
    // An empty site has nothing to say about whether July is answerable, and
    // letting it vote false would put a caveat on every portfolio total forever.
    const combined = combineProvenance([
      historical,
      { asAt: at, followsPeriod: false, reason: 'no-units', historyBegins: null },
    ])
    expect(combined.followsPeriod).toBe(true)
    expect(combined.reason).toBe('as-at-period-end')
  })

  it('reports no history at all when nothing has any', () => {
    expect(combineProvenance([]).reason).toBe('no-units')
  })
})
