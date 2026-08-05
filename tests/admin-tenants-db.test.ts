import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  addTenantNote,
  logTenantDocument,
  searchTenants,
  setTenantNotePinned,
  tenantProfile,
  updateTenantAddress,
  updateTenantContact,
} from '../apps/web/lib/admin/tenants'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'

// B-038 / PRD 02 §4.4 US-13, US-16.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityAId = ''
let facilityBId = ''
let tenantId = ''
let leaseAId = ''
let staffId = ''

function managerAt(facilityId: string): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(['tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 5_000, maxRefundCents: 0, maxCreditCents: 5_000 },
      },
    ],
  }
}

function bookkeeperAt(facilityId: string): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'bookkeeper',
        rank: 10,
        // View only — no tenants:edit, matching the real seeded role exactly.
        permissions: new Set(['tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const ownerAllFacilities: Actor = {
  kind: 'staff',
  staffUserId: '',
  assignments: [
    {
      facilityId: null,
      roleKey: 'owner',
      rank: 40,
      permissions: new Set(['tenants:view', 'tenants:edit']),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    },
  ],
}

describeDb('admin tenant profile', () => {
  beforeAll(async () => {
    const [facilityA, facilityB] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `Facility A ${suffix}`,
          slug: `admin-tenants-a-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: `Facility B ${suffix}`,
          slug: `admin-tenants-b-${suffix}`,
          addressLine1: '2 Storage Way',
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
      data: { email: `admin-tenants-staff-${suffix}@example.com`, firstName: 'Sam', lastName: 'Staffer' },
    })
    staffId = staff.id
    ownerAllFacilities.staffUserId = staffId

    const tenant = await prisma.tenant.create({
      data: {
        email: `admin-tenants-${suffix}@example.com`,
        firstName: 'Ada',
        lastName: 'Renter',
        phone: '512-555-0177',
      },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId: facilityAId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId: facilityAId, unitTypeId: unitType.id, number: 'A-9' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId: facilityAId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseAId = lease.id

    await prisma.ledgerEntry.create({
      data: { facilityId: facilityAId, leaseId: leaseAId, type: 'charge', amountCents: 12_900, description: 'Rent' },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.document.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
    await prisma.tenantNote.deleteMany({ where: { tenantId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
    await prisma.tenantAddress.deleteMany({ where: { tenantId } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
    await prisma.unit.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
    await prisma.unitType.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // staffId and both facilities now own audit history — same wall
    // access-service-db.test.ts and facility-settings-db.test.ts already hit.
    await prisma.$disconnect()
  })

  describe('searchTenants', () => {
    it('matches by name, email, phone, and unit number', async () => {
      const owner = ownerAllFacilities
      expect((await searchTenants(owner, 'Ada Renter')).map((r) => r.tenantId)).toContain(tenantId)
      expect((await searchTenants(owner, `admin-tenants-${suffix}`)).map((r) => r.tenantId)).toContain(tenantId)
      expect((await searchTenants(owner, '512-555-0177')).map((r) => r.tenantId)).toContain(tenantId)
      expect((await searchTenants(owner, 'A-9')).map((r) => r.tenantId)).toContain(tenantId)
    })

    it('never surfaces a tenant outside the searcher’s facilities', async () => {
      // The whole point of scoping search through the lease, not the tenant.
      const results = await searchTenants(managerAt(facilityBId), 'Ada Renter')
      expect(results.map((r) => r.tenantId)).not.toContain(tenantId)
    })

    it('finds the tenant for a manager actually assigned to their facility', async () => {
      const results = await searchTenants(managerAt(facilityAId), 'Ada Renter')
      expect(results.map((r) => r.tenantId)).toContain(tenantId)
    })

    it('returns nothing for an empty query rather than the whole roster', async () => {
      expect(await searchTenants(ownerAllFacilities, '   ')).toEqual([])
    })
  })

  describe('tenantProfile', () => {
    it('refuses a staffer with no lease-facility overlap with this tenant', async () => {
      await expect(tenantProfile(managerAt(facilityBId), tenantId)).rejects.toThrow(ForbiddenError)
    })

    it('loads the profile for a manager assigned to the tenant’s facility', async () => {
      const profile = await tenantProfile(managerAt(facilityAId), tenantId)
      expect(profile.email).toContain('admin-tenants')
      expect(profile.leases).toHaveLength(1)
      expect(profile.leases[0].leaseId).toBe(leaseAId)
    })

    it('sums balance across every lease, not just one', async () => {
      const unitType = await prisma.unitType.create({
        data: { facilityId: facilityBId, name: `10x10-b ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
      const unit = await prisma.unit.create({
        data: { facilityId: facilityBId, unitTypeId: unitType.id, number: 'B-1' },
      })
      const leaseB = await prisma.lease.create({
        data: {
          facilityId: facilityBId,
          tenantId,
          unitId: unit.id,
          status: 'active',
          startDate: new Date(),
          monthlyRateCents: 8_000,
          billingDay: 1,
        },
      })
      await prisma.ledgerEntry.create({
        data: { facilityId: facilityBId, leaseId: leaseB.id, type: 'charge', amountCents: 8_000, description: 'Rent B' },
      })

      const profile = await tenantProfile(ownerAllFacilities, tenantId)
      expect(profile.totalBalanceCents).toBe(12_900 + 8_000)

      await prisma.ledgerEntry.deleteMany({ where: { leaseId: leaseB.id } })
      await prisma.lease.delete({ where: { id: leaseB.id } })
      await prisma.unit.delete({ where: { id: unit.id } })
      await prisma.unitType.delete({ where: { id: unitType.id } })
    })
  })

  describe('mutations require tenants:edit, not just tenants:view', () => {
    it('refuses a contact update from a view-only bookkeeper', async () => {
      await expect(
        updateTenantContact(bookkeeperAt(facilityAId), tenantId, {
          phone: '512-555-9999',
          altContactName: null,
          altContactPhone: null,
          altContactEmail: null,
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('saves a contact update from a manager and records who did it', async () => {
      await updateTenantContact(managerAt(facilityAId), tenantId, {
        phone: '512-555-9999',
        altContactName: 'Backup Contact',
        altContactPhone: null,
        altContactEmail: null,
      })
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.phone).toBe('512-555-9999')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'Tenant', entityId: tenantId, action: 'tenant.contact_updated' },
      })
      expect(entry.actorStaffId).toBe(staffId)
    })

    it('refuses an address update from a manager with no facility overlap', async () => {
      const result = await updateTenantAddress(managerAt(facilityBId), tenantId, {
        addressLine1: '99 Nowhere',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
      }).catch((error) => error)
      expect(result).toBeInstanceOf(ForbiddenError)
    })

    it('writes an address as a counter-sourced history row', async () => {
      const result = await updateTenantAddress(managerAt(facilityAId), tenantId, {
        addressLine1: '42 Evidence Lane',
        city: 'Austin',
        state: 'tx',
        postalCode: '78704',
      })
      expect(result).toEqual({ ok: true })

      const row = await prisma.tenantAddress.findFirstOrThrow({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })
      expect(row.source).toBe('counter')
      expect(row.actorStaffId).toBe(staffId)
      expect(row.actorTenantId).toBeNull()
    })

    it('rejects an address that fails validation before writing anything', async () => {
      const before = await prisma.tenantAddress.count({ where: { tenantId } })
      const result = await updateTenantAddress(managerAt(facilityAId), tenantId, {
        addressLine1: '',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
      })
      expect(result).toMatchObject({ ok: false })
      expect(await prisma.tenantAddress.count({ where: { tenantId } })).toBe(before)
    })
  })

  describe('notes', () => {
    it('adds a note attributed to the author, and audits it', async () => {
      const problems = await addTenantNote(managerAt(facilityAId), tenantId, 'Called about a late payment.')
      expect(problems).toEqual({})

      const note = await prisma.tenantNote.findFirstOrThrow({ where: { tenantId } })
      expect(note.body).toBe('Called about a late payment.')
      expect(note.staffUserId).toBe(staffId)
      expect(note.pinned).toBe(false)

      const audited = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'TenantNote', entityId: note.id, action: 'tenant.note_added' },
      })
      expect(audited.actorStaffId).toBe(staffId)
    })

    it('refuses an empty note', async () => {
      expect(await addTenantNote(managerAt(facilityAId), tenantId, '   ')).toHaveProperty('body')
    })

    it('pins and unpins without touching the note’s content', async () => {
      const note = await prisma.tenantNote.findFirstOrThrow({ where: { tenantId } })
      await setTenantNotePinned(managerAt(facilityAId), tenantId, note.id, true)
      const pinned = await prisma.tenantNote.findUniqueOrThrow({ where: { id: note.id } })
      expect(pinned.pinned).toBe(true)
      expect(pinned.body).toBe(note.body)

      await setTenantNotePinned(managerAt(facilityAId), tenantId, note.id, false)
      expect((await prisma.tenantNote.findUniqueOrThrow({ where: { id: note.id } })).pinned).toBe(false)
    })

    it('sorts pinned notes first regardless of age', async () => {
      const older = await prisma.tenantNote.create({
        data: { tenantId, facilityId: facilityAId, staffUserId: staffId, body: 'Older note', pinned: false },
      })
      await setTenantNotePinned(managerAt(facilityAId), tenantId, older.id, true)

      const profile = await tenantProfile(managerAt(facilityAId), tenantId)
      expect(profile.notes[0].id).toBe(older.id)
      expect(profile.notes[0].pinned).toBe(true)
    })

    it('refuses to pin a note that belongs to a different tenant', async () => {
      const otherTenant = await prisma.tenant.create({
        data: { email: `admin-tenants-other-${suffix}@example.com`, firstName: 'Bo', lastName: 'Other' },
      })
      const foreignNote = await prisma.tenantNote.create({
        data: { tenantId: otherTenant.id, facilityId: facilityAId, staffUserId: staffId, body: 'Not yours' },
      })

      await expect(
        setTenantNotePinned(managerAt(facilityAId), tenantId, foreignNote.id, true),
      ).rejects.toThrow(ForbiddenError)

      await prisma.tenantNote.delete({ where: { id: foreignNote.id } })
      await prisma.tenant.delete({ where: { id: otherTenant.id } })
    })
  })

  describe('logTenantDocument', () => {
    it('records a document with no bytes, typed exactly as entered, and audits it', async () => {
      const problems = await logTenantDocument(managerAt(facilityAId), tenantId, {
        type: 'id_copy',
        title: 'Driver license on file',
        note: 'Verified in person at the counter, TX DL ending 4821.',
      })
      expect(problems).toEqual({})

      const document = await prisma.document.findFirstOrThrow({
        where: { subjectType: 'Tenant', subjectId: tenantId, type: 'id_copy' },
      })
      expect(document.content).toBe('Verified in person at the counter, TX DL ending 4821.')
      expect(document.storageRef).toBeNull()
      expect(document.mimeType).toContain('text/plain')

      const audited = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'Document', entityId: document.id, action: 'document.logged' },
      })
      expect(audited.actorStaffId).toBe(staffId)
    })

    it('refuses a document with no title', async () => {
      expect(
        await logTenantDocument(managerAt(facilityAId), tenantId, { type: 'other', title: '  ', note: '' }),
      ).toHaveProperty('title')
    })

    it('shows up on the profile alongside the tenant’s lease documents', async () => {
      await prisma.document.create({
        data: {
          facilityId: facilityAId,
          type: 'lease',
          subjectType: 'Lease',
          subjectId: leaseAId,
          title: 'Storage agreement',
          content: '<p>Lease</p>',
          mimeType: 'text/html',
          contentHash: 'hash-lease',
        },
      })

      const profile = await tenantProfile(managerAt(facilityAId), tenantId)
      const types = profile.documents.map((d) => d.type)
      expect(types).toContain('id_copy')
      expect(types).toContain('lease')
    })
  })
})
