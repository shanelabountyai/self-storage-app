import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { loadStaffActor } from '../apps/web/lib/rbac/actor'
import { can, facilityAccess, nextApproverRole } from '../apps/web/lib/rbac/authorize'
import { PERMISSIONS, ROLES } from '../packages/db/rbac-catalog'

// Proves the seeded catalog and the runtime checks agree, and that the
// all-facilities uniqueness rule is enforced by the database rather than by
// convention. Requires the RBAC seed to have run.
const hasDatabase = Boolean(process.env.DATABASE_URL)

let facilityAId = ''
let facilityBId = ''
let staffId = ''
let managerRoleId = ''

beforeAll(async () => {
  if (!hasDatabase) return

  const [facilityA, facilityB] = await Promise.all([
    prisma.facility.create({
      data: {
        name: 'RBAC A',
        slug: 'rbac-test-a',
        addressLine1: '1 A St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
      },
    }),
    prisma.facility.create({
      data: {
        name: 'RBAC B',
        slug: 'rbac-test-b',
        addressLine1: '1 B St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
      },
    }),
  ])
  facilityAId = facilityA.id
  facilityBId = facilityB.id

  const staff = await prisma.staffUser.create({
    data: { email: 'rbac-test@example.com', firstName: 'Dana', lastName: 'Manager' },
  })
  staffId = staff.id

  const manager = await prisma.role.findUnique({ where: { key: 'manager' } })
  if (!manager) throw new Error('RBAC seed has not been run — try `npm run db:seed`')
  managerRoleId = manager.id
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.staffFacilityAssignment.deleteMany({ where: { staffUserId: staffId } })
  await prisma.staffUser.deleteMany({ where: { id: staffId } })
  await prisma.facility.deleteMany({ where: { id: { in: [facilityAId, facilityBId] } } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('seeded catalog', () => {
  it('has every role the permission matrix relies on', async () => {
    const keys = (await prisma.role.findMany({ select: { key: true } })).map((r) => r.key)
    expect(keys).toEqual(
      expect.arrayContaining(['tenant', 'counter', 'bookkeeper', 'manager', 'regional', 'owner', 'system']),
    )
  })

  it('matches the catalog the application checks against', async () => {
    // The seed and the in-code catalog drifting apart would silently grant or
    // revoke authority, so they are compared directly.
    const stored = (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key)
    expect(stored.sort()).toEqual(PERMISSIONS.map((p) => p.key).sort())

    for (const role of ROLES) {
      const grants = await prisma.rolePermission.findMany({
        where: { role: { key: role.key } },
        select: { permissionKey: true },
      })
      expect(grants.map((g) => g.permissionKey).sort(), `role ${role.key}`).toEqual(
        [...role.permissions].sort(),
      )
    }
  })
})

describe.skipIf(!hasDatabase)('staff actor resolution', () => {
  it('resolves permissions and scope from the database', async () => {
    await prisma.staffFacilityAssignment.create({
      data: { staffUserId: staffId, roleId: managerRoleId, facilityId: facilityAId },
    })

    const actor = await loadStaffActor(staffId)
    expect(actor).not.toBeNull()
    expect(facilityAccess(actor!)).toEqual({ all: false, facilityIds: [facilityAId] })
    expect(can(actor!, 'units:edit', facilityAId)).toBe(true)
    expect(can(actor!, 'units:edit', facilityBId)).toBe(false)
    expect(can(actor!, 'users:manage', facilityAId)).toBe(false)
  })

  it('strips all authority from a suspended staff user', async () => {
    await prisma.staffUser.update({ where: { id: staffId }, data: { status: 'suspended' } })
    expect(await loadStaffActor(staffId)).toBeNull()
    await prisma.staffUser.update({ where: { id: staffId }, data: { status: 'active' } })
  })

  it('strips all authority from a soft-deleted staff user', async () => {
    await prisma.staffUser.update({ where: { id: staffId }, data: { deletedAt: new Date() } })
    expect(await loadStaffActor(staffId)).toBeNull()
    await prisma.staffUser.update({ where: { id: staffId }, data: { deletedAt: null } })
  })

  it('refuses a second role at the same facility', async () => {
    const counter = await prisma.role.findUniqueOrThrow({ where: { key: 'counter' } })
    await expect(
      prisma.staffFacilityAssignment.create({
        data: { staffUserId: staffId, roleId: counter.id, facilityId: facilityAId },
      }),
    ).rejects.toThrow()
  })

  it('refuses a second all-facilities role', async () => {
    const owner = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } })
    const regional = await prisma.role.findUniqueOrThrow({ where: { key: 'regional' } })

    await prisma.staffFacilityAssignment.create({
      data: { staffUserId: staffId, roleId: owner.id, facilityId: null },
    })
    // Postgres treats NULLs as distinct, so this is caught by the partial
    // unique index in the migration, not by @@unique.
    await expect(
      prisma.staffFacilityAssignment.create({
        data: { staffUserId: staffId, roleId: regional.id, facilityId: null },
      }),
    ).rejects.toThrow()

    await prisma.staffFacilityAssignment.deleteMany({
      where: { staffUserId: staffId, facilityId: null },
    })
  })
})

describe.skipIf(!hasDatabase)('escalation chain', () => {
  it('routes an over-limit waiver to the next role that can approve it', async () => {
    const manager = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } })
    const approver = await nextApproverRole('fee_waiver', 10_000, manager.rank)
    expect(approver?.key).toBe('regional')
  })

  it('skips past roles whose limit is still too low', async () => {
    const manager = await prisma.role.findUniqueOrThrow({ where: { key: 'manager' } })
    // Above the regional limit, so it has to reach the owner's unlimited authority.
    const approver = await nextApproverRole('fee_waiver', 1_000_000, manager.rank)
    expect(approver?.key).toBe('owner')
  })

  it('returns null when nobody can approve', async () => {
    const owner = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } })
    expect(await nextApproverRole('refund', 500, owner.rank)).toBeNull()
  })
})
