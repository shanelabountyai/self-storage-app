import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { loadStaffActor, type Actor } from '../apps/web/lib/rbac/actor'
import { rateSuggestionsForFacility } from '../apps/web/lib/pricing/rate-suggestions'

// PRD 02 US-12 (B-088 part 1). The rule itself is tested against plain values
// in street-rate-suggestion.test.ts; this is about the wiring — that occupancy
// comes from the metrics module's definitions, that the current rate comes from
// the effective-dated history, and that a queued change is seen.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = `rate-sug-${Date.now()}`
let facilityId = ''
let staffId = ''
let roleId = ''
const typeIds: Record<string, string> = {}

const DAY = 86_400_000

async function makeType(name: string, units: { status: 'available' | 'occupied' | 'maintenance' | 'unrentable' }[]) {
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `${suffix}-${name}`, widthFt: 10, lengthFt: 10, climateControlled: false },
  })
  typeIds[name] = unitType.id
  await prisma.unit.createMany({
    data: units.map((unit, i) => ({
      facilityId,
      unitTypeId: unitType.id,
      number: `${name}-${i}`,
      status: unit.status,
    })),
  })
  return unitType.id
}

async function setRate(unitTypeId: string, streetCents: number, webCents: number, daysAgo: number) {
  await prisma.unitTypeRate.create({
    data: {
      facilityId,
      unitTypeId,
      streetRateCents: streetCents,
      webRateCents: webCents,
      effectiveFrom: new Date(Date.now() - daysAgo * DAY),
    },
  })
}

beforeAll(async () => {
  if (!hasDatabase) return

  const facility = await prisma.facility.create({
    data: {
      name: 'Rate Suggestions',
      slug: suffix,
      addressLine1: '1 Rate St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
      status: 'inactive' as const,
    },
  })
  facilityId = facility.id

  // This suite's own role, never a seeded one — same three shared-state hazards
  // impersonation-session-db.test.ts documents.
  const role = await prisma.role.create({
    data: {
      key: `${suffix}-pricer`,
      name: 'Rate suggestion test role',
      description: 'Fixture only.',
      rank: 50,
      isStaffRole: false,
      permissions: { create: [{ permissionKey: 'rates:street:propose' }] },
    },
  })
  roleId = role.id

  const staff = await prisma.staffUser.create({
    data: { email: `${suffix}@example.com`, firstName: 'Rae', lastName: 'Pricer' },
  })
  staffId = staff.id
  await prisma.staffFacilityAssignment.create({
    data: { staffUserId: staffId, roleId, facilityId },
  })

  // Tight: 19 of 20 occupied = 95%, rate held 200 days.
  const tight = await makeType('tight', [
    ...Array.from({ length: 19 }, () => ({ status: 'occupied' as const })),
    { status: 'available' as const },
  ])
  await setRate(tight, 10_000, 9_000, 200)

  // Soft: 10 of 20 occupied.
  const soft = await makeType('soft', [
    ...Array.from({ length: 10 }, () => ({ status: 'occupied' as const })),
    ...Array.from({ length: 10 }, () => ({ status: 'available' as const })),
  ])
  await setRate(soft, 10_000, 9_000, 200)

  // Tight but changed recently.
  const recent = await makeType('recent', [
    ...Array.from({ length: 19 }, () => ({ status: 'occupied' as const })),
    { status: 'available' as const },
  ])
  await setRate(recent, 10_000, 9_000, 5)

  // Tight, old rate, but a change already queued for next week.
  const queued = await makeType('queued', [
    ...Array.from({ length: 19 }, () => ({ status: 'occupied' as const })),
    { status: 'available' as const },
  ])
  await setRate(queued, 10_000, 9_000, 200)
  await prisma.unitTypeRate.create({
    data: {
      facilityId,
      unitTypeId: queued,
      streetRateCents: 11_000,
      webRateCents: 10_000,
      effectiveFrom: new Date(Date.now() + 7 * DAY),
    },
  })

  // Every unit occupied, but one is unrentable and one in maintenance — the
  // metrics module's two judgement calls, exercised through this screen.
  const mixed = await makeType('mixed', [
    ...Array.from({ length: 9 }, () => ({ status: 'occupied' as const })),
    { status: 'maintenance' as const },
    { status: 'unrentable' as const },
  ])
  await setRate(mixed, 10_000, 9_000, 200)
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
  await prisma.unit.deleteMany({ where: { facilityId } })
  await prisma.unitType.deleteMany({ where: { facilityId } })
  await prisma.staffFacilityAssignment.deleteMany({ where: { staffUserId: staffId } })
  await prisma.rolePermission.deleteMany({ where: { roleId } })
  await prisma.role.deleteMany({ where: { id: roleId } })
  await prisma.$disconnect()
})

async function report() {
  const actor = (await loadStaffActor(staffId)) as Actor
  return rateSuggestionsForFacility(actor, facilityId)
}

describe.skipIf(!hasDatabase)('rateSuggestionsForFacility', () => {
  it('suggests a raise on a tight type whose rate has held', async () => {
    const { rows } = await report()
    const row = rows.find((r) => r.unitTypeId === typeIds.tight)!
    expect(row.occupancyRatio).toBeCloseTo(0.95, 5)
    expect(row.suggestion.reason).toBe('raise')
    expect(row.suggestion.suggestedStreetRateCents).toBe(10_800)
  })

  it('stays quiet on a soft type', async () => {
    const { rows } = await report()
    expect(rows.find((r) => r.unitTypeId === typeIds.soft)!.suggestion.reason).toBe('demand_is_soft')
  })

  it('reads the effective date off the rate history, not the row’s creation', async () => {
    const { rows } = await report()
    const row = rows.find((r) => r.unitTypeId === typeIds.recent)!
    expect(row.daysSinceRateChange).toBe(5)
    expect(row.suggestion.reason).toBe('cooling_off')
  })

  it('sees a change already queued for a future date', async () => {
    const { rows } = await report()
    const row = rows.find((r) => r.unitTypeId === typeIds.queued)!
    // The CURRENT rate is still the old one — `currentRatesForFacility` resolves
    // as-of now, so a future row must not be mistaken for today's price.
    expect(row.streetRateCents).toBe(10_000)
    expect(row.suggestion.reason).toBe('change_scheduled')
  })

  it('counts rentable the way the metrics module does, not its own way', async () => {
    // 11 units: 9 occupied, 1 maintenance, 1 unrentable.
    // Rentable excludes `unrentable` and INCLUDES `maintenance` → 10.
    // A screen that computed this inline would almost certainly have dropped
    // maintenance and reported 100%, which is exactly the disagreement D-25
    // exists to prevent.
    const { rows } = await report()
    const row = rows.find((r) => r.unitTypeId === typeIds.mixed)!
    expect(row.rentableCount).toBe(10)
    expect(row.occupiedCount).toBe(9)
    expect(row.occupancyRatio).toBeCloseTo(0.9, 5)
  })

  it('projects uplift from occupied units only', async () => {
    const { rows, upliftCents } = await report()
    const tight = rows.find((r) => r.unitTypeId === typeIds.tight)!
    // Only `tight` and `mixed` can raise; mixed is at 90%, below the 92% band,
    // so the total is tight's 19 occupied × $8.
    expect(tight.occupiedCount).toBe(19)
    expect(upliftCents).toBe(19 * 800)
  })

  it('refuses an actor without the pricing permission', async () => {
    await expect(
      rateSuggestionsForFacility({ kind: 'tenant', tenantId: 'nobody' }, facilityId),
    ).rejects.toThrow()
  })
})
