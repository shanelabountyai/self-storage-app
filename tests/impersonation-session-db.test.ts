import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { findAuditEntries, recordAudit } from '../packages/core/audit'
import { loadStaffActor } from '../apps/web/lib/rbac/actor'
import {
  endImpersonation,
  IMPERSONATION_RATE_LIMIT,
  IMPERSONATION_TTL_MINUTES,
  loadSubject,
  startImpersonation,
  validateImpersonationSession,
} from '../apps/web/lib/impersonation/service'

// PRD 09 §5.1/§6.1 and SR-6. The guard's own rules are unit-tested against
// plain values in impersonation-guard.test.ts; this file is about the parts
// only a database can answer — that a session cannot exist unlogged, that
// expiry and authority changes end it server-side, and that an entry written
// during a session names both parties.
//
// Nothing here is cleaned up and it cannot be: audit rows are append-only and
// reference the session, the staff users and the facility with onDelete:
// Restrict. That is the retention rule working (D-13c), not an oversight.
const hasDatabase = Boolean(process.env.DATABASE_URL)

let facilityAId = ''
let facilityBId = ''
let ownerId = ''
let managerId = ''
let tenantId = ''
let impersonatorRoleId = ''
let managerRoleId = ''

const suffix = `imp-${Date.now()}`

beforeAll(async () => {
  if (!hasDatabase) return

  const [facilityA, facilityB] = await Promise.all([
    prisma.facility.create({
      data: {
        name: 'Impersonation A',
        slug: `${suffix}-a`,
        addressLine1: '1 A St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
    prisma.facility.create({
      data: {
        name: 'Impersonation B',
        slug: `${suffix}-b`,
        addressLine1: '1 B St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
  ])
  facilityAId = facilityA.id
  facilityBId = facilityB.id

  const owner = await prisma.role.findUnique({ where: { key: 'owner' } })
  const manager = await prisma.role.findUnique({ where: { key: 'manager' } })
  if (!owner || !manager) throw new Error('RBAC seed has not been run — try `npm run db:seed`')
  managerRoleId = manager.id

  // A role of this suite's own, rather than an assignment to the seeded
  // `owner`. Three shared-state hazards, all of them real and one of them
  // already observed:
  //
  //  * `alertOwner` picks its recipient with
  //    `findFirst({ assignments: { some: { role: { key: 'owner' } } } })`, so a
  //    second owner anywhere in `storage_test` makes which address it chooses
  //    arbitrary — and `comms-observability-db.test.ts` asserts the alert
  //    reached the owner IT created. That suite failed on the first full run
  //    against this one, and would have kept failing: the staff row here can
  //    never be deleted, because audit entries reference it.
  //  * `isStaffRole: false` keeps it out of `nextApproverRole`, which walks
  //    every staff role above a rank and would otherwise start proposing this
  //    one as a monetary approver in whatever suite happens to run alongside.
  //  * It is not in the `ROLES` catalog, so `rbac-db.test.ts`'s catalog
  //    comparison never looks at it — which is why the impersonation
  //    permissions are granted HERE rather than added to the seeded `manager`
  //    role for the duration of a test.
  const impersonatorRole = await prisma.role.create({
    data: {
      key: `${suffix}-impersonator`,
      name: 'Impersonation test role',
      description: 'Fixture only.',
      rank: owner.rank,
      isStaffRole: false,
      permissions: {
        create: [
          { permissionKey: 'impersonation:tenant' },
          { permissionKey: 'impersonation:staff' },
          { permissionKey: 'tenants:view' },
        ],
      },
    },
  })
  impersonatorRoleId = impersonatorRole.id

  const [ownerUser, managerUser, tenant] = await Promise.all([
    prisma.staffUser.create({
      data: { email: `${suffix}-owner@example.com`, firstName: 'Sam', lastName: 'Owner' },
    }),
    prisma.staffUser.create({
      data: { email: `${suffix}-manager@example.com`, firstName: 'Dana', lastName: 'Manager' },
    }),
    prisma.tenant.create({
      data: {
        email: `${suffix}-tenant@example.com`,
        firstName: 'Marcus',
        lastName: 'Tenant',
        phone: '512-555-0101',
      },
    }),
  ])
  ownerId = ownerUser.id
  managerId = managerUser.id
  tenantId = tenant.id

  await prisma.staffFacilityAssignment.createMany({
    data: [
      { staffUserId: ownerId, roleId: impersonatorRoleId, facilityId: null },
      { staffUserId: managerId, roleId: managerRoleId, facilityId: facilityAId },
    ],
  })
})

afterAll(async () => {
  if (!hasDatabase) return
  // The staff users, the tenant, the facilities and the sessions all stay:
  // audit rows reference them with onDelete: Restrict and cannot be deleted.
  // The fixture ROLE and its assignments can be, and are — a role left behind
  // is one every rank-walking query in the repo has to step over forever.
  await prisma.staffFacilityAssignment.deleteMany({
    where: { staffUserId: { in: [ownerId, managerId] } },
  })
  await prisma.rolePermission.deleteMany({ where: { roleId: impersonatorRoleId } })
  await prisma.role.deleteMany({ where: { id: impersonatorRoleId } })
  await prisma.$disconnect()
})

async function ownerActor() {
  const actor = await loadStaffActor(ownerId)
  if (!actor) throw new Error('owner actor missing')
  return actor
}

/// A lease is what gives a tenant a facility scope, so the guard has something
/// to confine. Created per test that needs one, at the facility it names.
async function giveTenantALeaseAt(facilityId: string, number: string) {
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${number}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId: unitType.id, number },
  })
  return prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: new Date(),
      monthlyRateCents: 15_000,
      billingDay: 1,
    },
  })
}

describe.skipIf(!hasDatabase)('starting a session', () => {
  it('refuses without a reason, before reading anything (FR-2)', async () => {
    const result = await startImpersonation(await ownerActor(), {
      subjectType: 'tenant',
      subjectId: tenantId,
      reason: '   ',
    })
    expect(result).toMatchObject({ ok: false, refusal: 'no_reason' })
  })

  it('writes the row and its audit entry together, or neither (SR-6)', async () => {
    await giveTenantALeaseAt(facilityAId, `${suffix}-A1`)
    const result = await startImpersonation(await ownerActor(), {
      subjectType: 'tenant',
      subjectId: tenantId,
      reason: 'Tenant reports the pay button does nothing',
      ticketRef: 'ZD-4021',
      ipAddress: '203.0.113.7',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const session = await prisma.impersonationSession.findUniqueOrThrow({
      where: { id: result.sessionId },
    })
    expect(session.mode).toBe('read_only')
    expect(session.subjectType).toBe('tenant')
    expect(session.ticketRef).toBe('ZD-4021')
    expect(session.endedAt).toBeNull()
    // FR-3, server-side.
    expect(session.expiresAt.getTime() - session.startedAt.getTime()).toBeCloseTo(
      IMPERSONATION_TTL_MINUTES * 60_000,
      -3,
    )
    // The scope of the impersonator AT THE TIME, not a re-derivation later.
    expect(session.facilityScopeSnapshot).toEqual({ all: true })

    const entries = await findAuditEntries({ entityType: 'ImpersonationSession', entityId: result.sessionId })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'impersonation.started',
      // Starting is something the staff member did as themselves.
      actorType: 'staff',
      actorStaffId: ownerId,
      reasonCode: 'Tenant reports the pay button does nothing',
    })
  })

  it('refuses a subject the guard refuses, and writes nothing', async () => {
    const manager = await loadStaffActor(managerId)
    const before = await prisma.impersonationSession.count({ where: { impersonatorStaffId: managerId } })
    const result = await startImpersonation(manager!, {
      subjectType: 'staff',
      subjectId: ownerId,
      reason: 'trying it on',
    })
    expect(result).toMatchObject({ ok: false })
    expect(await prisma.impersonationSession.count({ where: { impersonatorStaffId: managerId } })).toBe(before)
  })

  it('refuses an unknown subject', async () => {
    const result = await startImpersonation(await ownerActor(), {
      subjectType: 'tenant',
      subjectId: 'no-such-tenant',
      reason: 'why',
    })
    expect(result).toMatchObject({ ok: false, refusal: 'no_subject' })
  })

  it('throttles a burst from one impersonator (SR-7)', async () => {
    const actor = await ownerActor()
    const now = new Date()
    let throttled: Awaited<ReturnType<typeof startImpersonation>> | null = null
    // One more than the limit, counting whatever this suite already started.
    for (let i = 0; i <= IMPERSONATION_RATE_LIMIT.max; i++) {
      const result = await startImpersonation(actor, {
        subjectType: 'tenant',
        subjectId: tenantId,
        reason: `burst ${i}`,
        now,
      })
      if (!result.ok && result.refusal === 'throttled') {
        throttled = result
        break
      }
    }
    expect(throttled).toMatchObject({ ok: false, refusal: 'throttled' })
  })
})

describe.skipIf(!hasDatabase)('ending and re-validating', () => {
  async function freshSession() {
    const result = await startImpersonation(await ownerActor(), {
      subjectType: 'tenant',
      subjectId: tenantId,
      reason: 'support call',
      // Sidestep this suite's own throttle burst above.
      now: new Date(Date.now() + IMPERSONATION_RATE_LIMIT.windowMinutes * 60_000),
    })
    if (!result.ok) throw new Error(`could not start a session: ${result.message}`)
    return result
  }

  it('ends once, and a second end changes nothing', async () => {
    const { sessionId } = await freshSession()
    expect(await endImpersonation(sessionId, 'self')).toBe(true)
    const first = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: sessionId } })

    // A forced end racing an expiry must not rewrite why it stopped.
    expect(await endImpersonation(sessionId, 'forced', { endedByStaffId: ownerId })).toBe(false)
    const after = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(after.endedBy).toBe('self')
    expect(after.endedAt).toEqual(first.endedAt)

    const ended = (
      await findAuditEntries({ entityType: 'ImpersonationSession', entityId: sessionId })
    ).filter((entry) => entry.action === 'impersonation.ended')
    expect(ended).toHaveLength(1)
    // FR-25's "(recording endedBy)".
    expect(ended[0].reasonCode).toBe('self')
  })

  it('validates a live session', async () => {
    const { sessionId } = await freshSession()
    const result = await validateImpersonationSession(sessionId)
    expect(result.ok).toBe(true)
  })

  it('ends an expired session server-side rather than trusting a client timer (FR-3)', async () => {
    const { sessionId, expiresAt } = await freshSession()
    // One minute past the row's OWN expiry, not past a wall clock this suite
    // has already shifted to get around its own throttle test.
    const later = new Date(expiresAt.getTime() + 60_000)
    const result = await validateImpersonationSession(sessionId, { now: later })
    expect(result).toMatchObject({ ok: false, reason: 'expiry' })

    const row = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(row.endedBy).toBe('expiry')
  })

  it('refuses a session that has already ended', async () => {
    const { sessionId } = await freshSession()
    await endImpersonation(sessionId, 'forced', { endedByStaffId: ownerId })
    expect(await validateImpersonationSession(sessionId)).toMatchObject({ ok: false, reason: 'forced' })
  })

  it('refuses an unknown session id', async () => {
    expect(await validateImpersonationSession('no-such-session')).toMatchObject({
      ok: false,
      reason: 'unknown',
    })
  })

  it('ends the session when the subject gains a lease outside the impersonator’s scope (FR-9)', async () => {
    // The mid-session promotion case, in the form a tenant can take it: the
    // guard stops agreeing, so the session stops — it does not quietly widen.
    // Scoped to facility A only, through this suite's own role — never by
    // granting the seeded `manager` role a permission it does not have, which
    // would change what every other suite sees while it ran.
    const scoped = await prisma.staffUser.create({
      data: { email: `${suffix}-scoped@example.com`, firstName: 'Ravi', lastName: 'Scoped' },
    })
    await prisma.staffFacilityAssignment.create({
      data: { staffUserId: scoped.id, roleId: impersonatorRoleId, facilityId: facilityAId },
    })
    const scopedManager = await loadStaffActor(scoped.id)

    const started = await startImpersonation(scopedManager!, {
      subjectType: 'tenant',
      subjectId: tenantId,
      reason: 'scoped support call',
    })
    expect(started.ok, started.ok ? '' : started.message).toBe(true)
    if (!started.ok) return

    const lease = await giveTenantALeaseAt(facilityBId, `${suffix}-B1`)
    try {
      const result = await validateImpersonationSession(started.sessionId)
      expect(result).toMatchObject({ ok: false, reason: 'authority_changed' })
      const row = await prisma.impersonationSession.findUniqueOrThrow({ where: { id: started.sessionId } })
      expect(row.endedBy).toBe('authority_changed')
    } finally {
      await prisma.lease.delete({ where: { id: lease.id } })
      await prisma.staffFacilityAssignment.deleteMany({ where: { staffUserId: scoped.id } })
    }
  })
})

describe.skipIf(!hasDatabase)('dual attribution (FR-24)', () => {
  it('records the subject as the actor and the impersonator alongside', async () => {
    const started = await startImpersonation(await ownerActor(), {
      subjectType: 'tenant',
      subjectId: tenantId,
      reason: 'attribution check',
      now: new Date(Date.now() + 2 * IMPERSONATION_RATE_LIMIT.windowMinutes * 60_000),
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const entry = await recordAudit({
      actor: { type: 'tenant', tenantId },
      action: 'tenant.contact_updated',
      entityType: 'Tenant',
      entityId: tenantId,
      after: { phone: '512-555-0199' },
      impersonation: { impersonatorStaffId: ownerId, sessionId: started.sessionId },
    })

    // Both questions answerable from one table.
    expect(entry.actorType).toBe('tenant')
    expect(entry.impersonatorStaffId).toBe(ownerId)
    expect(entry.impersonationSessionId).toBe(started.sessionId)

    const bySession = await findAuditEntries({ impersonationSessionId: started.sessionId })
    expect(bySession.map((e) => e.id)).toContain(entry.id)

    const byImpersonator = await findAuditEntries({
      impersonatorStaffId: ownerId,
      entityType: 'Tenant',
      entityId: tenantId,
    })
    expect(byImpersonator.map((e) => e.id)).toContain(entry.id)

    // And the subject's own log still shows it happened to them.
    const byActor = await findAuditEntries({ entityType: 'Tenant', entityId: tenantId })
    expect(byActor.map((e) => e.id)).toContain(entry.id)
  })
})

describe.skipIf(!hasDatabase)('loadSubject', () => {
  it('gives a tenant the facilities they hold a lease at, and rank 0', async () => {
    const subject = await loadSubject('tenant', tenantId)
    expect(subject).toMatchObject({ type: 'tenant', active: true, ranks: [] })
    expect(subject!.scope).toMatchObject({ all: false })
  })

  it('gives an all-facilities staff user an all-facilities scope', async () => {
    const subject = await loadSubject('staff', ownerId)
    expect(subject).toMatchObject({ type: 'staff', active: true, scope: { all: true } })
  })

  it('returns null for an id that does not exist', async () => {
    expect(await loadSubject('staff', 'nope')).toBeNull()
  })
})
