import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  AuthorizedAccessCapError,
  cascadeAuthorizedAccess,
  createAuthorizedPerson,
  revokeAuthorizedPerson,
} from '../apps/web/lib/access/authorized-persons'

// B-029 / PRD 03 US-9. The authorized-access list: staff add named people to
// a lease and each gets an individually-revocable credential of their own.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''
let counterId = ''

const managerActor = (): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [
    {
      facilityId,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set(['access:manage_grants']),
      limits: { maxFeeWaiverCents: 5_000, maxRefundCents: 0, maxCreditCents: 5_000 },
    },
  ],
})

// Counter, but scoped away from `access:manage_grants` — the negative case.
const underprivilegedActor = (): Actor => ({
  kind: 'staff',
  staffUserId: counterId,
  assignments: [
    {
      facilityId,
      roleKey: 'counter',
      rank: 10,
      permissions: new Set(),
      limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
    },
  ],
})

const inputFor = (n: number) => ({
  name: `Backup Holder ${n}`,
  phone: `555-010${n}`,
  relationship: 'roommate',
})

describeDb('authorized access list', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Authorized Access Test',
        slug: `auth-access-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        authorizedAccessCap: 2,
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `auth-access-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id

    const [manager, counter] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `auth-access-mgr-${suffix}@example.com`, firstName: 'Mgr', lastName: 'Test' },
      }),
      prisma.staffUser.create({
        data: { email: `auth-access-ctr-${suffix}@example.com`, firstName: 'Ctr', lastName: 'Test' },
      }),
    ])
    staffId = manager.id
    counterId = counter.id
  })

  beforeEach(async () => {
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // Not the facility: audit entries from this file hold a Restrict FK to it.
    await prisma.$disconnect()
  })

  it('issues a credential immediately, distinct from the tenant\'s own', async () => {
    const created = await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
    expect(created.code).toMatch(/^\d{6}$/)

    const credential = await prisma.accessCredential.findUniqueOrThrow({
      where: { id: created.credentialId },
    })
    expect(credential.leaseId).toBe(leaseId)

    const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: credential.grantId } })
    expect(grant.authorizedPersonId).toBe(created.personId)
    expect(grant.tenantId).toBeNull()
    expect(grant.state).toBe('active')
  })

  it('refuses without access:manage_grants', async () => {
    await expect(createAuthorizedPerson(underprivilegedActor(), leaseId, inputFor(1))).rejects.toThrow(
      ForbiddenError,
    )
  })

  // Each case below issues two or three real credentials end to end (grant,
  // transition, uniqueness-checked code, a hardware-command drain) against a
  // real Neon connection — individually well within budget, but the default
  // 5s test timeout is too tight for several in one test.
  it(
    'enforces the facility cap (2, for this fixture) rather than an unbounded list',
    async () => {
      await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
      await createAuthorizedPerson(managerActor(), leaseId, inputFor(2))

      await expect(createAuthorizedPerson(managerActor(), leaseId, inputFor(3))).rejects.toThrow(
        AuthorizedAccessCapError,
      )
      expect(await prisma.authorizedAccessPerson.count({ where: { leaseId, active: true } })).toBe(2)
    },
    15_000,
  )

  it(
    'revokes one person without touching another on the same lease',
    async () => {
      const a = await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
      const b = await createAuthorizedPerson(managerActor(), leaseId, inputFor(2))

      const result = await revokeAuthorizedPerson(managerActor(), a.personId, 'other')
      expect(result).toEqual({ ok: true })

      const personA = await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: a.personId } })
      expect(personA.active).toBe(false)
      expect(personA.revokedByStaffId).toBe(staffId)

      const grantA = await prisma.accessGrant.findFirstOrThrow({ where: { authorizedPersonId: a.personId } })
      expect(grantA.state).toBe('revoked')

      // B's grant is untouched — revocation is per person, not per lease.
      const personB = await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: b.personId } })
      expect(personB.active).toBe(true)
      const grantB = await prisma.accessGrant.findFirstOrThrow({ where: { authorizedPersonId: b.personId } })
      expect(grantB.state).toBe('active')
    },
    15_000,
  )

  it(
    'frees a cap slot once a person is revoked',
    async () => {
      const a = await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
      await createAuthorizedPerson(managerActor(), leaseId, inputFor(2))
      await revokeAuthorizedPerson(managerActor(), a.personId, 'other')

      await expect(createAuthorizedPerson(managerActor(), leaseId, inputFor(3))).resolves.toMatchObject({
        personId: expect.any(String),
      })
    },
    15_000,
  )

  it('reports revoking twice rather than throwing', async () => {
    const a = await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
    await revokeAuthorizedPerson(managerActor(), a.personId, 'other')
    expect(await revokeAuthorizedPerson(managerActor(), a.personId, 'other')).toEqual({
      ok: false,
      reason: 'already_revoked',
    })
  })

  it(
    'cascades a lease-level suspension to every active authorized person on it',
    async () => {
      const a = await createAuthorizedPerson(managerActor(), leaseId, inputFor(1))
      const b = await createAuthorizedPerson(managerActor(), leaseId, inputFor(2))

      await cascadeAuthorizedAccess(leaseId, 'suspended', 'system:delinquency')

      const grantA = await prisma.accessGrant.findFirstOrThrow({ where: { authorizedPersonId: a.personId } })
      const grantB = await prisma.accessGrant.findFirstOrThrow({ where: { authorizedPersonId: b.personId } })
      expect(grantA.state).toBe('suspended')
      expect(grantB.state).toBe('suspended')
    },
    15_000,
  )
})
