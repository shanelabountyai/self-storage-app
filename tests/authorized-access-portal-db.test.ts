import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  AuthorizedAccessCapError,
  createAuthorizedPerson,
  NotYourLeaseError,
  revokeAuthorizedPerson,
} from '../apps/web/lib/access/authorized-persons'
import { authorizedAccessForTenant } from '../apps/web/lib/portal/authorized-access'
import { evaluateAccessSuspensions } from '../apps/web/lib/access/delinquency-gate'
import { ensureGrantForHolder, transitionGrant } from '../apps/web/lib/access/service'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-105 / PRD 03 US-9 AC4: "tenant self-service from the portal is Phase 2 and
// inherits the same cap."
//
// Also the home of the AC2 fix: an authorized person is "suspended together
// with the lease when the lease is suspended for delinquency". That cascade had
// existed since B-029 with no caller.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseId = ''
let otherLeaseId = ''
let staffId = ''

const tenantActor = (id = tenantId): Actor => ({ kind: 'tenant', tenantId: id })

function staffActor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['access:manage_grants'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const person = (name: string) => ({ name, phone: '512-555-0100', relationship: 'spouse' })

describeDb('tenant self-service for the access list (US-9 AC4)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `aa-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const facility = await prisma.facility.create({
      data: {
        name: `Access ${suffix}`,
        slug: `access-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        authorizedAccessCap: 2,
        accessSuspendDaysPastDue: 6,
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `aa-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const other = await prisma.tenant.create({
      data: { email: `aa-o-${suffix}@example.com`, firstName: 'Otto', lastName: 'Other' },
    })
    otherTenantId = other.id

    for (const [key, holder] of [['a', tenantId], ['b', otherTenantId]] as const) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `${key.toUpperCase()}-${suffix.slice(0, 4)}` },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: holder,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-06-01T00:00:00Z'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      if (key === 'a') leaseId = lease.id
      else otherLeaseId = lease.id
    }
  })

  beforeEach(async () => {
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    // Scoped to THIS facility. Without the facility filter this deletes every
    // authorized-person credential in the shared test schema — including one
    // `authorized-access-db.test.ts` created moments earlier in a parallel
    // worker, which then fails with "no record was found" for a row it had
    // just been handed the id of. That is what it did, intermittently, for
    // several runs.
    await prisma.accessCredential.deleteMany({
      where: { facilityId, grant: { authorizedPersonId: { not: null } } },
    })
    await prisma.accessGrant.deleteMany({ where: { facilityId, authorizedPersonId: { not: null } } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    // The tenant's own grant, back to active.
    const grant = await ensureGrantForHolder(facilityId, { tenantId }, 'system:move_in')
    await transitionGrant(grant.grantId, 'active', 'system:move_in')
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId, authorizedPersonId: { not: null } } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    // Facility and staff stay: `audit_log` RESTRICT-references the facility.
  })

  describe('a tenant managing their own list', () => {
    it('adds somebody and issues them their OWN code', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Bea Helper'))
      expect(created.code).toMatch(/^\d+$/)

      // Never a copy of the tenant's (FR-1/AC2).
      const tenantGrant = await prisma.accessGrant.findUniqueOrThrow({
        where: { facilityId_tenantId: { facilityId, tenantId } },
        include: { credentials: true },
      })
      const theirs = await prisma.accessCredential.findUniqueOrThrow({
        where: { id: created.credentialId },
      })
      expect(tenantGrant.credentials.map((c) => c.id)).not.toContain(theirs.id)
    })

    it('records the TENANT as the actor, not a staff member', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Cy Helper'))
      const row = await prisma.authorizedAccessPerson.findUniqueOrThrow({
        where: { id: created.personId },
      })
      // AC1 wants "the actor who changed it", and after a theft claim "the
      // tenant added their own brother" and "a manager did" are different facts.
      expect(row.createdByTenantId).toBe(tenantId)
      expect(row.createdByStaffId).toBeNull()
    })

    it('inherits the facility cap', async () => {
      await createAuthorizedPerson(tenantActor(), leaseId, person('One'))
      await createAuthorizedPerson(tenantActor(), leaseId, person('Two'))
      await expect(
        createAuthorizedPerson(tenantActor(), leaseId, person('Three')),
      ).rejects.toBeInstanceOf(AuthorizedAccessCapError)
    })

    it('refuses a lease that is not theirs', async () => {
      await expect(
        createAuthorizedPerson(tenantActor(), otherLeaseId, person('Nope')),
      ).rejects.toBeInstanceOf(NotYourLeaseError)
    })

    it('withdraws access without touching the tenant’s own code', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Dee Helper'))
      expect(await revokeAuthorizedPerson(tenantActor(), created.personId, 'tenant_request')).toEqual({
        ok: true,
      })

      const grant = await prisma.accessGrant.findFirstOrThrow({
        where: { authorizedPerson: { id: created.personId } },
      })
      expect(grant.state).toBe('revoked')

      const tenantGrant = await prisma.accessGrant.findUniqueOrThrow({
        where: { facilityId_tenantId: { facilityId, tenantId } },
      })
      expect(tenantGrant.state).toBe('active')
    })

    it('can withdraw somebody a MANAGER added', async () => {
      // It is the tenant's unit. Making them ring the office to withdraw
      // access is how somebody keeps access they should not have over a
      // weekend.
      const created = await createAuthorizedPerson(staffActor(), leaseId, person('Staff Added'))
      expect(await revokeAuthorizedPerson(tenantActor(), created.personId, 'tenant_request')).toEqual(
        { ok: true },
      )
    })

    it('will not let one tenant withdraw another’s person', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Eve Helper'))
      await expect(
        revokeAuthorizedPerson(tenantActor(otherTenantId), created.personId, 'tenant_request'),
      ).rejects.toBeInstanceOf(NotYourLeaseError)
    })
  })

  describe('the delinquency cascade (AC2)', () => {
    /// Puts the tenant far enough past due for D-16 to suspend them.
    async function makeDelinquent() {
      await prisma.invoice.create({
        data: {
          facilityId,
          leaseId,
          kind: 'rent',
          number: `AA-${suffix}`,
          status: 'open',
          issueDate: new Date('2026-08-01T00:00:00Z'),
          dueDate: new Date('2026-08-01T00:00:00Z'),
          periodStart: new Date('2026-08-01T00:00:00Z'),
          periodEnd: new Date('2026-09-01T00:00:00Z'),
          totalCents: 12_900,
          amountPaidCents: 0,
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: 12_900,
          description: 'Rent',
          occurredAt: new Date('2026-08-01T12:00:00Z'),
        },
      })
    }

    it('suspends an authorized person when the tenant is suspended', async () => {
      // The hole this fixes: before B-105 the cascade had no caller, so a
      // delinquent tenant locked out under D-16 could still send their brother
      // in on his own code.
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Frank Helper'))
      await makeDelinquent()

      await evaluateAccessSuspensions(facilityId, new Date('2026-08-20T12:00:00Z'), () => {})

      const tenantGrant = await prisma.accessGrant.findUniqueOrThrow({
        where: { facilityId_tenantId: { facilityId, tenantId } },
      })
      expect(tenantGrant.state).toBe('suspended')

      const theirGrant = await prisma.accessGrant.findFirstOrThrow({
        where: { authorizedPersonId: created.personId },
      })
      expect(theirGrant.state).toBe('suspended')
    })

    it('restores them when the balance clears', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Gus Helper'))
      await makeDelinquent()
      await evaluateAccessSuspensions(facilityId, new Date('2026-08-20T12:00:00Z'), () => {})

      // Paid off.
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'payment',
          amountCents: -12_900,
          description: 'Payment',
          occurredAt: new Date('2026-08-21T12:00:00Z'),
        },
      })
      await prisma.invoice.updateMany({
        where: { leaseId },
        data: { status: 'paid', amountPaidCents: 12_900 },
      })

      await evaluateAccessSuspensions(facilityId, new Date('2026-08-22T12:00:00Z'), () => {})

      // Restoring only the tenant would leave everybody they authorised locked
      // out permanently, with nothing on any screen saying why.
      const theirGrant = await prisma.accessGrant.findFirstOrThrow({
        where: { authorizedPersonId: created.personId },
      })
      expect(theirGrant.state).toBe('active')
    })

    it('starts a NEW person suspended while the tenant is suspended', async () => {
      await makeDelinquent()
      await evaluateAccessSuspensions(facilityId, new Date('2026-08-20T12:00:00Z'), () => {})

      // Otherwise a locked-out tenant adds their brother from the portal and is
      // back in the building ten minutes later on a code we issued.
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Hal Helper'))
      const theirGrant = await prisma.accessGrant.findFirstOrThrow({
        where: { authorizedPersonId: created.personId },
      })
      expect(theirGrant.state).toBe('suspended')
    })
  })

  describe('the portal view', () => {
    it('lists people with their codes and the cap', async () => {
      await createAuthorizedPerson(tenantActor(), leaseId, person('Ivy Helper'))
      const [view] = await authorizedAccessForTenant(tenantId)

      expect(view.cap).toBe(2)
      expect(view.people).toHaveLength(1)
      expect(view.people[0].name).toBe('Ivy Helper')
      expect(view.people[0].addedByTenant).toBe(true)
      expect(view.people[0].code).toMatch(/^\d+$/)
    })

    it('hides withdrawn people', async () => {
      const created = await createAuthorizedPerson(tenantActor(), leaseId, person('Jo Helper'))
      await revokeAuthorizedPerson(tenantActor(), created.personId, 'tenant_request')

      const [view] = await authorizedAccessForTenant(tenantId)
      expect(view.people).toHaveLength(0)
    })

    it('shows only the tenant’s own units', async () => {
      await createAuthorizedPerson(tenantActor(otherTenantId), otherLeaseId, person('Not Yours'))
      const views = await authorizedAccessForTenant(tenantId)
      expect(views.map((view) => view.leaseId)).toEqual([leaseId])
    })

    it('says when the tenant’s own access is off', async () => {
      const grant = await prisma.accessGrant.findUniqueOrThrow({
        where: { facilityId_tenantId: { facilityId, tenantId } },
      })
      await transitionGrant(grant.id, 'suspended', 'system:delinquency')

      const [view] = await authorizedAccessForTenant(tenantId)
      expect(view.tenantSuspended).toBe(true)
    })
  })
})
