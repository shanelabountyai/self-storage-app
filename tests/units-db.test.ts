import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  UnitStatusChangeBlockedError,
  createUnit,
  listUnits,
  recomputeUnitStatus,
  setUnitOperationalStatus,
  unitGroupings,
  updateUnit,
} from '../apps/web/lib/admin/units'
import { ROLES } from '../packages/db/rbac-catalog'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
let facilityAId = ''
let facilityBId = ''
let unitTypeAId = ''
let unitTypeBId = ''
let staffId = ''
let counterStaffId = ''
let tenantId = ''

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
}

const ownerAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [assignmentFor('owner', facilityId)],
})
const counterAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: counterStaffId,
  assignments: [assignmentFor('counter', facilityId)],
})

const unitInput = (number: string, overrides: Partial<Parameters<typeof createUnit>[2]> = {}) => ({
  unitTypeId: unitTypeAId,
  number,
  building: null,
  floor: 1,
  doorType: null,
  notes: null,
  ...overrides,
})

beforeAll(async () => {
  if (!hasDatabase) return
  const [a, b] = await Promise.all([
    prisma.facility.create({
      data: {
        name: 'Units A',
        slug: `units-a-${suffix}`,
        addressLine1: '1 Test St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
    prisma.facility.create({
      data: {
        name: 'Units B',
        slug: `units-b-${suffix}`,
        addressLine1: '2 Test St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
  ])
  facilityAId = a.id
  facilityBId = b.id

  const [typeA, typeB] = await Promise.all([
    prisma.unitType.create({
      data: {
        facilityId: facilityAId,
        name: '10x10',
        widthFt: 10,
        lengthFt: 10
      },
    }),
    prisma.unitType.create({
      data: {
        facilityId: facilityBId,
        name: '10x10',
        widthFt: 10,
        lengthFt: 10
      },
    }),
  ])
  unitTypeAId = typeA.id
  unitTypeBId = typeB.id

  const [owner, counter, tenant] = await Promise.all([
    prisma.staffUser.create({
      data: { email: `units-owner-${suffix}@example.com`, firstName: 'Owner', lastName: 'T' },
    }),
    prisma.staffUser.create({
      data: { email: `units-counter-${suffix}@example.com`, firstName: 'Counter', lastName: 'T' },
    }),
    prisma.tenant.create({
      data: { email: `units-tenant-${suffix}@example.com`, firstName: 'Pat', lastName: 'Renter' },
    }),
  ])
  staffId = owner.id
  counterStaffId = counter.id
  tenantId = tenant.id
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.lease.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.reservation.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.unit.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.unitType.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('createUnit / updateUnit', () => {
  it('creates a vacant unit with matching status and intent', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-100'))
    expect(unit.status).toBe('available')
    expect(unit.operationalStatus).toBe('available')

    const entries = await prisma.auditLog.findMany({
      where: { entityId: unit.id, action: 'unit.created' },
    })
    expect(entries).toHaveLength(1)
  })

  it('refuses a role without units:edit', async () => {
    await expect(
      createUnit(counterAt(facilityAId), facilityAId, unitInput('A-DENIED')),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a unit type from another facility', async () => {
    await expect(
      createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-XFAC', { unitTypeId: unitTypeBId })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('enforces unique unit numbers per facility', async () => {
    await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-DUP'))
    await expect(
      createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-DUP')),
    ).rejects.toThrow()
  })

  it('refuses to edit a unit belonging to another facility', async () => {
    const unit = await createUnit(ownerAt(facilityBId), facilityBId, {
      ...unitInput('B-100'),
      unitTypeId: unitTypeBId,
    })
    await expect(
      updateUnit(ownerAt(facilityAId), facilityAId, unit.id, unitInput('B-100')),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe.skipIf(!hasDatabase)('setUnitOperationalStatus — the US-8 guard', () => {
  it('allows a manual status on a vacant unit and records the reason', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-200'))

    const status = await setUnitOperationalStatus(
      ownerAt(facilityAId),
      facilityAId,
      unit.id,
      'maintenance',
      'management_approval',
    )
    expect(status).toBe('maintenance')

    const entries = await prisma.auditLog.findMany({
      where: { entityId: unit.id, action: 'unit.status_overridden' },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].reasonCode).toBe('management_approval')
  })

  it.each(['occupied', 'reserved', 'overlocked'])('refuses to set derived status %s', async (target) => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput(`A-D-${target}`))
    await expect(
      setUnitOperationalStatus(ownerAt(facilityAId), facilityAId, unit.id, target, 'management_approval'),
    ).rejects.toBeInstanceOf(UnitStatusChangeBlockedError)
  })

  it('refuses to mark a leased unit available, naming the lease', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-300'))
    const lease = await prisma.lease.create({
      data: {
        facilityId: facilityAId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_000,
        billingDay: 1,
      },
    })

    // The exact scenario US-8's AC calls out: occupied -> available must be
    // refused with the blocking record named.
    try {
      await setUnitOperationalStatus(ownerAt(facilityAId), facilityAId, unit.id, 'available', 'management_approval')
      expect.unreachable('should have been blocked')
    } catch (error) {
      expect(error).toBeInstanceOf(UnitStatusChangeBlockedError)
      const blocked = error as UnitStatusChangeBlockedError
      expect(blocked.blocking).toEqual({ type: 'lease', id: lease.id })
      expect(blocked.message).toContain(lease.id)
    }
  })

  it('refuses while a reservation holds the unit', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-400'))
    const reservation = await prisma.reservation.create({
      data: {
        facilityId: facilityAId,
        unitTypeId: unitTypeAId,
        unitId: unit.id,
        status: 'held',
        firstName: 'Pat',
        lastName: 'Renter',
        email: `hold-${suffix}@example.com`,
        quotedRateCents: 12_000,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: `hash-${randomUUID()}`,
      },
    })

    const error = await setUnitOperationalStatus(
      ownerAt(facilityAId),
      facilityAId,
      unit.id,
      'maintenance',
      'management_approval',
    ).catch((e) => e)

    expect(error).toBeInstanceOf(UnitStatusChangeBlockedError)
    expect((error as UnitStatusChangeBlockedError).blocking).toEqual({
      type: 'reservation',
      id: reservation.id,
    })
  })

  it('refuses a role without units:edit', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-500'))
    await expect(
      setUnitOperationalStatus(counterAt(facilityAId), facilityAId, unit.id, 'maintenance', 'x'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe.skipIf(!hasDatabase)('recomputeUnitStatus', () => {
  it('reflects a lease appearing and ending, preserving operator intent', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-600'))

    // Operator takes it offline while vacant.
    await setUnitOperationalStatus(ownerAt(facilityAId), facilityAId, unit.id, 'maintenance', 'management_approval')
    expect(await recomputeUnitStatus(unit.id)).toBe('maintenance')

    const lease = await prisma.lease.create({
      data: {
        facilityId: facilityAId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_000,
        billingDay: 1,
      },
    })
    expect(await recomputeUnitStatus(unit.id)).toBe('occupied')

    await prisma.lease.update({ where: { id: lease.id }, data: { status: 'ended' } })

    // The whole reason operationalStatus is a separate column: this must come
    // back as maintenance, not available.
    expect(await recomputeUnitStatus(unit.id)).toBe('maintenance')
  })

  it('is idempotent', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-700'))
    expect(await recomputeUnitStatus(unit.id)).toBe('available')
    expect(await recomputeUnitStatus(unit.id)).toBe('available')
  })

  it('ignores an expired reservation', async () => {
    const unit = await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-800'))
    await prisma.reservation.create({
      data: {
        facilityId: facilityAId,
        unitTypeId: unitTypeAId,
        unitId: unit.id,
        status: 'held',
        firstName: 'Pat',
        lastName: 'Renter',
        email: `expired-${suffix}@example.com`,
        quotedRateCents: 12_000,
        // A hold taken two days ago that ran out yesterday. B-018 added a CHECK
        // (expiresAt > createdAt), which this fixture used to violate by
        // leaving createdAt at "now" — a hold that expired before it was made
        // cannot happen, and the constraint was right to reject it.
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
        tokenHash: `hash-${randomUUID()}`,
      },
    })
    expect(await recomputeUnitStatus(unit.id)).toBe('available')
  })
})

describe.skipIf(!hasDatabase)('listUnits', () => {
  it('is facility-scoped and refuses a facility the actor cannot see', async () => {
    const units = await listUnits(ownerAt(facilityAId), facilityAId)
    expect(units.every((u) => u.facilityId === facilityAId)).toBe(true)

    await expect(listUnits(ownerAt(facilityAId), facilityBId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('filters by status and unit number search', async () => {
    const byStatus = await listUnits(ownerAt(facilityAId), facilityAId, { status: 'maintenance' })
    expect(byStatus.every((u) => u.status === 'maintenance')).toBe(true)

    const bySearch = await listUnits(ownerAt(facilityAId), facilityAId, { search: 'a-2' })
    expect(bySearch.every((u) => u.number.toLowerCase().includes('a-2'))).toBe(true)
    expect(bySearch.length).toBeGreaterThan(0)
  })

  it('reports distinct buildings and floors for filters', async () => {
    await createUnit(ownerAt(facilityAId), facilityAId, unitInput('A-900', { building: 'Building A', floor: 2 }))
    const groupings = await unitGroupings(facilityAId)
    expect(groupings.buildings).toContain('Building A')
    expect(groupings.floors).toEqual([...groupings.floors].sort((a, b) => a - b))
    expect(groupings.floors).toContain(2)
  })
})
