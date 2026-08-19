import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { loadStaffActor, type Actor } from '../apps/web/lib/rbac/actor'
import { activeSessions, sessionReport } from '../apps/web/lib/impersonation/oversight'

// PRD 09 FR-18/FR-19 (B-092). The parts only a database answers: which sessions
// count as RUNNING, and what "filterable by facility" resolves to for a row
// that deliberately has no facility column.
//
// Sessions and staff rows are not cleaned up and cannot be — D-13c's retention
// and the Restrict foreign keys are the point, not an oversight. The fixture
// role and its assignments are, for the reason impersonation-session-db.test.ts
// spells out: a role left behind is one every rank-walking query steps over.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = `imp-ov-${Date.now()}`
let facilityAId = ''
let facilityBId = ''
let overseerId = ''
let regionalId = ''
let tenantAId = ''
let tenantBId = ''
let roleId = ''
let regionalRoleId = ''

async function facility(name: string, slug: string) {
  return prisma.facility.create({
    data: {
      name,
      slug,
      addressLine1: '1 Test St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
      status: 'inactive' as const,
    },
  })
}

/// Written straight through Prisma rather than through `startImpersonation`,
/// for two reasons that both matter: the timestamps have to be controlled (an
/// expired-but-unended row cannot be produced by the product on demand), and
/// SR-7's throttle caps the product path at ten an hour.
async function makeSession(input: {
  subjectType: 'tenant' | 'staff'
  subjectId: string
  startedAt: Date
  expiresAt: Date
  endedAt?: Date | null
}) {
  return prisma.impersonationSession.create({
    data: {
      impersonatorStaffId: overseerId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      facilityScopeSnapshot: { all: true },
      reason: 'oversight fixture',
      startedAt: input.startedAt,
      expiresAt: input.expiresAt,
      endedAt: input.endedAt ?? null,
      endedBy: input.endedAt ? ('self' as const) : null,
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  if (!hasDatabase) return

  const [a, b] = await Promise.all([
    facility('Oversight A', `${suffix}-a`),
    facility('Oversight B', `${suffix}-b`),
  ])
  facilityAId = a.id
  facilityBId = b.id

  const owner = await prisma.role.findUnique({ where: { key: 'owner' } })
  if (!owner) throw new Error('RBAC seed has not been run — try `npm run db:seed`')

  // This suite's own roles, never the seeded ones — see
  // impersonation-session-db.test.ts for the three shared-state hazards that
  // rule exists for, one of which was observed rather than theorised.
  const [role, regionalRole] = await Promise.all([
    prisma.role.create({
      data: {
        key: `${suffix}-overseer`,
        name: 'Oversight test role',
        description: 'Fixture only.',
        rank: owner.rank,
        isStaffRole: false,
        permissions: { create: [{ permissionKey: 'impersonation:oversee' }] },
      },
    }),
    prisma.role.create({
      data: {
        key: `${suffix}-regional`,
        name: 'Oversight regional test role',
        description: 'Fixture only.',
        rank: 40,
        isStaffRole: false,
        permissions: { create: [{ permissionKey: 'impersonation:oversee' }] },
      },
    }),
  ])
  roleId = role.id
  regionalRoleId = regionalRole.id

  const [overseer, regional, tenantA, tenantB] = await Promise.all([
    prisma.staffUser.create({
      data: { email: `${suffix}-overseer@example.com`, firstName: 'Sam', lastName: 'Overseer' },
    }),
    prisma.staffUser.create({
      data: { email: `${suffix}-regional@example.com`, firstName: 'Rae', lastName: 'Regional' },
    }),
    prisma.tenant.create({
      data: { email: `${suffix}-a@example.com`, firstName: 'Ada', lastName: 'AtSiteA', phone: '512-555-0111' },
    }),
    prisma.tenant.create({
      data: { email: `${suffix}-b@example.com`, firstName: 'Ben', lastName: 'AtSiteB', phone: '512-555-0112' },
    }),
  ])
  overseerId = overseer.id
  regionalId = regional.id
  tenantAId = tenantA.id
  tenantBId = tenantB.id

  await prisma.staffFacilityAssignment.createMany({
    data: [
      { staffUserId: overseerId, roleId, facilityId: null },
      { staffUserId: regionalId, roleId: regionalRoleId, facilityId: facilityAId },
    ],
  })

  // A lease each, which is what gives a TENANT subject its facilities.
  const units = await Promise.all([
    makeUnit(facilityAId, 'A1'),
    makeUnit(facilityBId, 'B1'),
  ])
  await Promise.all([
    makeLease(facilityAId, units[0], tenantAId),
    makeLease(facilityBId, units[1], tenantBId),
  ])
})

async function makeUnit(facilityId: string, number: string): Promise<string> {
  const unitType = await prisma.unitType.create({
    data: {
      facilityId,
      name: `${suffix}-${number}`,
      widthFt: 10,
      lengthFt: 10,
      climateControlled: false,
    },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId: unitType.id, number, status: 'occupied' },
  })
  return unit.id
}

async function makeLease(facilityId: string, unitId: string, tenantId: string): Promise<void> {
  await prisma.lease.create({
    data: {
      facilityId,
      unitId,
      tenantId,
      status: 'active',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      monthlyRateCents: 10_000,
      billingDay: 1,
    },
  })
}

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.staffFacilityAssignment.deleteMany({
    where: { staffUserId: { in: [overseerId, regionalId] } },
  })
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [roleId, regionalRoleId] } } })
  await prisma.role.deleteMany({ where: { id: { in: [roleId, regionalRoleId] } } })
  await prisma.$disconnect()
})

async function actorFor(staffUserId: string): Promise<Actor> {
  const actor = await loadStaffActor(staffUserId)
  if (!actor) throw new Error('fixture actor missing')
  return actor
}

describe.skipIf(!hasDatabase)('activeSessions (FR-18)', () => {
  it('excludes a session that is unended on paper but expired in fact', async () => {
    // THE rule B-091 part 1 wrote down and told this item not to drop. Expiry is
    // enforced lazily — `endedAt` is stamped the first time anybody touches the
    // row — so an impersonator who closed their laptop leaves a row that is
    // `endedAt IS NULL` and long past `expiresAt`. Filtering on `endedAt` alone
    // lists it as running and offers a force-end button that ends nothing.
    const stale = await makeSession({
      subjectType: 'tenant',
      subjectId: tenantAId,
      startedAt: new Date(Date.now() - 90 * 60_000),
      expiresAt: new Date(Date.now() - 60 * 60_000),
    })

    const rows = await activeSessions(await actorFor(overseerId))
    expect(rows.map((r) => r.id)).not.toContain(stale.id)
  })

  it('includes one that is genuinely running, and names both parties', async () => {
    const live = await makeSession({
      subjectType: 'tenant',
      subjectId: tenantAId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    })

    const rows = await activeSessions(await actorFor(overseerId))
    const found = rows.find((r) => r.id === live.id)
    expect(found).toBeDefined()
    expect(found!.impersonatorName).toBe('Sam Overseer')
    expect(found!.subjectName).toBe('Ada AtSiteA')

    // Left ended so it cannot leak into the other assertions in this file.
    await prisma.impersonationSession.update({
      where: { id: live.id },
      data: { endedAt: new Date(), endedBy: 'self' },
    })
  })

  it('excludes one that has already ended', async () => {
    const ended = await makeSession({
      subjectType: 'tenant',
      subjectId: tenantAId,
      startedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 20 * 60_000),
      endedAt: new Date(),
    })
    const rows = await activeSessions(await actorFor(overseerId))
    expect(rows.map((r) => r.id)).not.toContain(ended.id)
  })
})

describe.skipIf(!hasDatabase)('sessionReport (FR-19)', () => {
  const windowStart = new Date('2026-06-01T00:00:00.000Z')
  const windowEnd = new Date('2026-07-01T00:00:00.000Z')

  it('resolves a facility filter through the SUBJECT, which is the only place a facility exists', async () => {
    // `ImpersonationSession` has no `facilityId` on purpose (part 1): a subject
    // spans facilities. So the filter has to resolve through whose account was
    // opened — tenant A holds a lease at site A and nowhere else.
    const [atA, atB] = await Promise.all([
      makeSession({
        subjectType: 'tenant',
        subjectId: tenantAId,
        startedAt: new Date('2026-06-10T10:00:00.000Z'),
        expiresAt: new Date('2026-06-10T10:30:00.000Z'),
        endedAt: new Date('2026-06-10T10:20:00.000Z'),
      }),
      makeSession({
        subjectType: 'tenant',
        subjectId: tenantBId,
        startedAt: new Date('2026-06-11T10:00:00.000Z'),
        expiresAt: new Date('2026-06-11T10:30:00.000Z'),
        endedAt: new Date('2026-06-11T10:20:00.000Z'),
      }),
    ])

    const actor = await actorFor(overseerId)
    const siteA = await sessionReport(actor, {
      from: windowStart,
      to: windowEnd,
      facilityId: facilityAId,
    })
    const ids = siteA.map((r) => r.id)
    expect(ids).toContain(atA.id)
    expect(ids).not.toContain(atB.id)
  })

  it('honours the date range at both ends', async () => {
    const before = await makeSession({
      subjectType: 'tenant',
      subjectId: tenantAId,
      startedAt: new Date('2026-05-31T23:59:00.000Z'),
      expiresAt: new Date('2026-06-01T00:29:00.000Z'),
      endedAt: new Date('2026-06-01T00:10:00.000Z'),
    })
    const after = await makeSession({
      subjectType: 'tenant',
      subjectId: tenantAId,
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
      expiresAt: new Date('2026-07-01T00:30:00.000Z'),
      endedAt: new Date('2026-07-01T00:10:00.000Z'),
    })

    const rows = await sessionReport(await actorFor(overseerId), {
      from: windowStart,
      to: windowEnd,
    })
    const ids = rows.map((r) => r.id)
    // `to` is exclusive, matching `reportRange` — a session starting exactly at
    // the boundary belongs to the NEXT period, not to both.
    expect(ids).not.toContain(before.id)
    expect(ids).not.toContain(after.id)
  })

  it('matches a subject by name across both subject types', async () => {
    const rows = await sessionReport(await actorFor(overseerId), {
      from: windowStart,
      to: windowEnd,
      subjectQuery: 'atsitea',
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.subjectName.toLowerCase().includes('atsitea'))).toBe(true)
  })

  it('shows a facility-scoped overseer only the sessions that touched their sites', async () => {
    // Owner-only at seed (D-13b) makes this a no-op today. It is asserted so
    // that §4's promise holds: widening `impersonation:oversee` to a regional is
    // a SEED change, and it must not also hand them the whole portfolio.
    const rows = await sessionReport(await actorFor(regionalId), {
      from: windowStart,
      to: windowEnd,
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.facilityIds.includes(facilityAId))).toBe(true)
    expect(rows.some((r) => r.subjectId === tenantBId)).toBe(false)
  })
})
