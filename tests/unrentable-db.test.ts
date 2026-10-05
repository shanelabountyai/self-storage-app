import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { UnrentableRefusedError, setUnitOperationalStatus } from '../apps/web/lib/admin/units'
import { applyBulkOperation } from '../apps/web/lib/admin/units-bulk'
import { getUnrentableLimits, listUnrentableUnits, saveUnrentableLimits } from '../apps/web/lib/admin/unrentable'
import { rentLostCents } from '../packages/core/inventory'
import { ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 US-8 "AC (unrentable says why)" (B-433).

const hasDatabase = Boolean(process.env.DATABASE_URL)
const suffix = randomUUID().slice(0, 8)
const DAY_MS = 86_400_000

let facilityId = ''
let staffId = ''
let unitIds: string[] = []
let maxUnits = 0
let maxDays = 0

function actorAs(roleKey: string, everywhere = false): Actor {
  const role = ROLES.find((r) => r.key === roleKey)!
  const assignment: Assignment = {
    facilityId: everywhere ? null : facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set<PermissionKey>(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
  return { kind: 'staff', staffUserId: staffId, assignments: [assignment] }
}

const inDays = (days: number) => new Date(Date.now() + days * DAY_MS)
const why = (days: number | null = 7) => ({
  reason: 'damaged',
  note: 'Roof leak over the door',
  reviewAt: days === null ? null : inDays(days),
})
const mark = (actor: Actor, unitId: string, input?: ReturnType<typeof why>) =>
  setUnitOperationalStatus(actor, facilityId, unitId, 'unrentable', 'management_approval', input)

beforeAll(async () => {
  if (!hasDatabase) return
  ;({ maxUnits, maxDays } = await getUnrentableLimits())

  const facility = await prisma.facility.create({
    data: {
      name: `Unrentable ${suffix}`,
      slug: `unrentable-${suffix}`,
      addressLine1: '1 Test St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
      status: 'inactive' as const,
    },
  })
  facilityId = facility.id
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: '10x10', widthFt: 10, lengthFt: 10 },
  })
  await prisma.unitTypeRate.create({
    data: {
      facilityId,
      unitTypeId: unitType.id,
      streetRateCents: 12_999,
      webRateCents: 11_999,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    },
  })
  const staff = await prisma.staffUser.create({
    data: { email: `unrentable-${suffix}@example.com`, firstName: 'Dana', lastName: 'Manager' },
  })
  staffId = staff.id

  // One more than the limit, plus one to spare.
  await prisma.unit.createMany({
    data: Array.from({ length: maxUnits + 2 }, (_, i) => ({
      facilityId,
      unitTypeId: unitType.id,
      number: `U-${String(i).padStart(3, '0')}`,
    })),
  })
  unitIds = (await prisma.unit.findMany({ where: { facilityId }, orderBy: { number: 'asc' }, select: { id: true } })).map(
    (unit) => unit.id,
  )
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.unit.deleteMany({ where: { facilityId } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
  await prisma.unitType.deleteMany({ where: { facilityId } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('marking a unit unrentable (B-433)', () => {
  it('refuses without a reason, and without a note', async () => {
    await expect(mark(actorAs('manager'), unitIds[0])).rejects.toBeInstanceOf(UnrentableRefusedError)
    await expect(mark(actorAs('manager'), unitIds[0], { ...why(), note: '  ' })).rejects.toBeInstanceOf(
      UnrentableRefusedError,
    )
    await expect(mark(actorAs('manager'), unitIds[0], { ...why(), reason: 'because' })).rejects.toBeInstanceOf(
      UnrentableRefusedError,
    )
  })

  it('records the reason, the note, who and when', async () => {
    await mark(actorAs('manager'), unitIds[0], why())
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitIds[0] } })
    expect(unit.status).toBe('unrentable')
    expect(unit.unrentableReason).toBe('damaged')
    expect(unit.unrentableNote).toBe('Roof leak over the door')
    expect(unit.unrentableSetByStaffId).toBe(staffId)
    expect(unit.unrentableSetAt).not.toBeNull()
  })

  it('refuses a manager a review date past the days, and no date; a regional manager may', async () => {
    await expect(mark(actorAs('manager'), unitIds[1], why(maxDays + 5))).rejects.toThrow(/district manager/)
    await expect(mark(actorAs('manager'), unitIds[1], why(null))).rejects.toThrow(/district manager/)
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitIds[1] } })).operationalStatus).toBe('available')

    await mark(actorAs('regional'), unitIds[1], why(null))
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitIds[1] } })).operationalStatus).toBe('unrentable')
  })

  it('saving it again does not restart the clock, so a manager cannot push the date out', async () => {
    const setAt = new Date(Date.now() - (maxDays - 2) * DAY_MS)
    await prisma.unit.update({ where: { id: unitIds[0] }, data: { unrentableSetAt: setAt } })

    await expect(mark(actorAs('manager'), unitIds[0], why(7))).rejects.toThrow(/district manager/)
    await mark(actorAs('manager'), unitIds[0], { ...why(1), note: 'Roofer booked' })

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitIds[0] } })
    expect(unit.unrentableSetAt?.getTime()).toBe(setAt.getTime())
    expect(unit.unrentableNote).toBe('Roofer booked')
  })

  it('refuses a manager the unit past the count; a regional manager may', async () => {
    // Two are unrentable already. Fill to the limit.
    for (const unitId of unitIds.slice(2, maxUnits)) await mark(actorAs('manager'), unitId, why())
    expect(await prisma.unit.count({ where: { facilityId, operationalStatus: 'unrentable' } })).toBe(maxUnits)

    const next = unitIds[maxUnits]
    await expect(mark(actorAs('manager'), next, why())).rejects.toThrow(/district manager/)
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: next } })).operationalStatus).toBe('available')

    await mark(actorAs('regional'), next, why())
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: next } })).operationalStatus).toBe('unrentable')
  })

  it('the bulk edit will not put a unit into unrentable', async () => {
    const spare = unitIds[maxUnits + 1]
    const result = await applyBulkOperation(
      actorAs('regional'),
      facilityId,
      { status: 'available' },
      { kind: 'status', operationalStatus: 'unrentable' },
      'management_approval',
    )
    expect(result.applyCount).toBe(0)
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: spare } })).operationalStatus).toBe('available')
  })

  it('lists them longest first with rent lost at the street rate', async () => {
    const now = new Date()
    const rows = await listUnrentableUnits(actorAs('manager'), [facilityId], now)
    expect(rows).toHaveLength(maxUnits + 1)
    expect(rows[0].unitId).toBe(unitIds[0])
    expect(rows[0].days).toBe(maxDays - 2)
    expect(rows[0].rentLostCents).toBe(rentLostCents(12_999, maxDays - 2))
    expect(rows[0].setByName).toBe('Dana Manager')
    // No review date, set by the regional manager minutes ago: not overdue yet.
    expect(rows.find((row) => row.unitId === unitIds[1])?.overdue).toBe(false)
  })

  it('the limits are an owner\'s to change, and a facility manager is refused', async () => {
    await expect(saveUnrentableLimits(actorAs('manager'), { maxUnits: 1, maxDays: 1 })).rejects.toThrow()
    // Saved as the values already in force, so no other suite sees a change.
    await saveUnrentableLimits(actorAs('owner', true), { maxUnits, maxDays })
    expect(await getUnrentableLimits()).toEqual({ maxUnits, maxDays })
  })

  it('clears the reason when the unit goes back on sale', async () => {
    await setUnitOperationalStatus(actorAs('manager'), facilityId, unitIds[0], 'available', 'management_approval')
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitIds[0] } })
    expect(unit.operationalStatus).toBe('available')
    expect(unit.unrentableReason).toBeNull()
    expect(unit.unrentableSetAt).toBeNull()
    expect(unit.unrentableSetByStaffId).toBeNull()
  })
})
