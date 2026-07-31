import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import { createUnit } from '../apps/web/lib/admin/units'
import { applyBulkOperation, previewBulkOperation } from '../apps/web/lib/admin/units-bulk'
import { ROLES } from '../packages/db/rbac-catalog'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
let facilityId = ''
let otherFacilityId = ''
let unitTypeId = ''
let otherTypeId = ''
let foreignTypeId = ''
let staffId = ''
let counterStaffId = ''
let tenantId = ''

function assignmentFor(roleKey: string, fid: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId: fid,
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
const owner = (): Actor => ({ kind: 'staff', staffUserId: staffId, assignments: [assignmentFor('owner', facilityId)] })
const counter = (): Actor => ({ kind: 'staff', staffUserId: counterStaffId, assignments: [assignmentFor('counter', facilityId)] })

beforeAll(async () => {
  if (!hasDatabase) return
  const [f, other] = await Promise.all([
    prisma.facility.create({
      data: { name: 'Bulk A', slug: `bulk-a-${suffix}`, addressLine1: '1 St', city: 'Austin', state: 'TX', postalCode: '78701', timezone: 'America/Chicago', status: 'inactive' as const },
    }),
    prisma.facility.create({
      data: { name: 'Bulk B', slug: `bulk-b-${suffix}`, addressLine1: '2 St', city: 'Dallas', state: 'TX', postalCode: '75201', timezone: 'America/Chicago', status: 'inactive' as const },
    }),
  ])
  facilityId = f.id
  otherFacilityId = other.id

  const [t1, t2, foreign] = await Promise.all([
    prisma.unitType.create({ data: { facilityId, name: '10x10', widthFt: 10, lengthFt: 10,  } }),
    prisma.unitType.create({ data: { facilityId, name: '5x5', widthFt: 5, lengthFt: 5,  } }),
    prisma.unitType.create({ data: { facilityId: otherFacilityId, name: '10x10', widthFt: 10, lengthFt: 10,  } }),
  ])
  unitTypeId = t1.id
  otherTypeId = t2.id
  foreignTypeId = foreign.id

  const [o, c, tenant] = await Promise.all([
    prisma.staffUser.create({ data: { email: `bulk-owner-${suffix}@example.com`, firstName: 'O', lastName: 'T' } }),
    prisma.staffUser.create({ data: { email: `bulk-counter-${suffix}@example.com`, firstName: 'C', lastName: 'T' } }),
    prisma.tenant.create({ data: { email: `bulk-tenant-${suffix}@example.com`, firstName: 'Pat', lastName: 'R' } }),
  ])
  staffId = o.id
  counterStaffId = c.id
  tenantId = tenant.id

  // Six units; two of them occupied by an active lease.
  for (const n of ['U-1', 'U-2', 'U-3', 'U-4', 'U-5', 'U-6']) {
    await createUnit(owner(), facilityId, {
      unitTypeId,
      number: n,
      building: 'A',
      floor: 1,
      doorType: null,
      notes: null,
    })
  }
  const leased = await prisma.unit.findMany({ where: { facilityId, number: { in: ['U-5', 'U-6'] } } })
  for (const unit of leased) {
    await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_000,
        billingDay: 1,
      },
    })
    await prisma.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } })
  }
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.lease.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
  await prisma.unit.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
  await prisma.unitType.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('previewBulkOperation', () => {
  it('reports which units would change and which are blocked', async () => {
    const preview = await previewBulkOperation(owner(), facilityId, {}, {
      kind: 'status',
      operationalStatus: 'maintenance',
    })

    expect(preview.rows).toHaveLength(6)
    expect(preview.applyCount).toBe(4)
    expect(preview.skipCount).toBe(2)

    const blocked = preview.rows.filter((r) => r.outcome === 'skip')
    expect(blocked.map((r) => r.number).sort()).toEqual(['U-5', 'U-6'])
    // US-8 AC: the reason names the blocking record.
    expect(blocked[0].skipReason).toMatch(/lease/i)
  })

  it('writes nothing', async () => {
    await previewBulkOperation(owner(), facilityId, {}, { kind: 'status', operationalStatus: 'unrentable' })
    const untouched = await prisma.unit.findMany({ where: { facilityId, operationalStatus: 'unrentable' } })
    expect(untouched).toHaveLength(0)
  })

  it('honours the filter it was given', async () => {
    const preview = await previewBulkOperation(owner(), facilityId, { search: 'U-1' }, {
      kind: 'status',
      operationalStatus: 'maintenance',
    })
    expect(preview.rows.map((r) => r.number)).toEqual(['U-1'])
  })

  it('refuses a role without units:edit', async () => {
    await expect(
      previewBulkOperation(counter(), facilityId, {}, { kind: 'status', operationalStatus: 'maintenance' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a unit type from another facility', async () => {
    await expect(
      previewBulkOperation(owner(), facilityId, {}, { kind: 'unitType', unitTypeId: foreignTypeId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe.skipIf(!hasDatabase)('applyBulkOperation', () => {
  it('applies the allowed rows, skips the blocked ones, and leaves one audit entry', async () => {
    const result = await applyBulkOperation(
      owner(),
      facilityId,
      {},
      { kind: 'status', operationalStatus: 'maintenance' },
      'management_approval',
    )

    expect(result.applyCount).toBe(4)
    expect(result.skipCount).toBe(2)

    const units = await prisma.unit.findMany({ where: { facilityId }, orderBy: { number: 'asc' } })
    const byNumber = Object.fromEntries(units.map((u) => [u.number, u]))

    // Vacant ones moved.
    expect(byNumber['U-1'].operationalStatus).toBe('maintenance')
    expect(byNumber['U-1'].status).toBe('maintenance')
    // Occupied ones are untouched — including their intent, not just status.
    expect(byNumber['U-5'].status).toBe('occupied')
    expect(byNumber['U-5'].operationalStatus).toBe('available')

    // US-7 AC: ONE grouped entry, with per-unit detail inside it.
    const entries = await prisma.auditLog.findMany({
      where: { facilityId, action: 'unit.bulk_edited' },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(result.auditEntryId)
    const context = entries[0].after as Record<string, unknown>
    expect((context.applied as unknown[]).length).toBe(4)
    expect((context.skipped as unknown[]).length).toBe(2)
  })

  it('refuses to write without a reason code', async () => {
    await expect(
      applyBulkOperation(owner(), facilityId, { search: 'U-1' }, { kind: 'status', operationalStatus: 'available' }, '   '),
    ).rejects.toThrow(/reason/i)
  })

  it('changes unit type on occupied units but warns and leaves the rate alone', async () => {
    const leaseBefore = await prisma.lease.findFirstOrThrow({ where: { facilityId, status: 'active' } })

    const result = await applyBulkOperation(
      owner(),
      facilityId,
      { search: 'U-5' },
      { kind: 'unitType', unitTypeId: otherTypeId },
      'management_approval',
    )

    // US-6 AC: warn, don't block.
    expect(result.applyCount).toBe(1)
    expect(result.rows[0].warning).toMatch(/rate/i)

    const unit = await prisma.unit.findFirstOrThrow({ where: { facilityId, number: 'U-5' } })
    expect(unit.unitTypeId).toBe(otherTypeId)

    const leaseAfter = await prisma.lease.findUniqueOrThrow({ where: { id: leaseBefore.id } })
    expect(leaseAfter.monthlyRateCents).toBe(leaseBefore.monthlyRateCents)
  })

  it('applies attribute changes and skips rows already matching', async () => {
    const first = await applyBulkOperation(
      owner(),
      facilityId,
      { search: 'U-2' },
      { kind: 'attributes', building: 'B', floor: 2 },
      'management_approval',
    )
    expect(first.applyCount).toBe(1)

    const unit = await prisma.unit.findFirstOrThrow({ where: { facilityId, number: 'U-2' } })
    expect(unit.building).toBe('B')
    expect(unit.floor).toBe(2)

    // Re-running the same operation is a no-op rather than a spurious write.
    const second = await applyBulkOperation(
      owner(),
      facilityId,
      { search: 'U-2' },
      { kind: 'attributes', building: 'B', floor: 2 },
      'management_approval',
    )
    expect(second.applyCount).toBe(0)
    expect(second.skipCount).toBe(1)
  })

  it('cannot reach a facility the actor is not assigned to', async () => {
    await expect(
      applyBulkOperation(owner(), otherFacilityId, {}, { kind: 'status', operationalStatus: 'maintenance' }, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
