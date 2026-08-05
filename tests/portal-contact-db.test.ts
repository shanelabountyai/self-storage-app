import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  addressHistory,
  currentAddress,
  flagReturnedMail,
  recordAddressChange,
  updateContactDetails,
  validateAddress,
} from '../apps/web/lib/portal/contact'
import {
  confirmEmailChange,
  requestEmailChange,
} from '../apps/web/lib/auth/email-change'
import { mintToken } from '../apps/web/lib/auth/tokens'
import {
  portalDocument,
  portalDocuments,
} from '../apps/web/lib/portal/documents'

// B-037 / PRD 01 US-705, US-706; PRD 02 US-13.

describe('validateAddress', () => {
  const good = {
    addressLine1: '1 Storage Way',
    city: 'Austin',
    state: 'TX',
    postalCode: '78704',
  }

  it('accepts a postable address', () => {
    expect(validateAddress(good)).toEqual({})
    expect(validateAddress({ ...good, postalCode: '78704-1234' })).toEqual({})
  })

  it('refuses what cannot be posted at all', () => {
    expect(validateAddress({ ...good, addressLine1: '  ' })).toHaveProperty(
      'addressLine1',
    )
    expect(validateAddress({ ...good, city: '' })).toHaveProperty('city')
    expect(validateAddress({ ...good, state: 'Texas' })).toHaveProperty(
      'state',
    )
    expect(validateAddress({ ...good, postalCode: '787' })).toHaveProperty(
      'postalCode',
    )
  })
})

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let tenantId = ''
let otherTenantId = ''
let facilityId = ''
let leaseId = ''
let otherLeaseId = ''

// One outer block so the fixtures outlive all three groups: an afterAll on an
// inner describe fires as soon as that group ends, which would delete the
// tenant the next group needs.
describeDb('portal contact, email and documents', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Contact Test',
        slug: `contact-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const [tenant, other] = await Promise.all([
      prisma.tenant.create({
        data: {
          email: `contact-${suffix}@example.com`,
          firstName: 'Ada',
          lastName: 'Renter',
        },
      }),
      prisma.tenant.create({
        data: {
          email: `contact-other-${suffix}@example.com`,
          firstName: 'Bo',
          lastName: 'Other',
        },
      }),
    ])
    tenantId = tenant.id
    otherTenantId = other.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const [unitA, unitB] = await Promise.all([
      prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
      }),
      prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: 'B-2' },
      }),
    ])
    const [a, b] = await Promise.all([
      prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unitA.id,
          status: 'active',
          startDate: new Date(),
          monthlyRateCents: 12_900,
          billingDay: 1,
        },
      }),
      prisma.lease.create({
        data: {
          facilityId,
          tenantId: otherTenantId,
          unitId: unitB.id,
          status: 'active',
          startDate: new Date(),
          monthlyRateCents: 12_900,
          billingDay: 1,
        },
      }),
    ])
    leaseId = a.id
    otherLeaseId = b.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.authToken.deleteMany({
      where: { subjectId: { in: [tenantId, otherTenantId] } },
    })
    await prisma.tenantAddress.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  const addr = (line1: string) => ({
    addressLine1: line1,
    city: 'Austin',
    state: 'tx',
    postalCode: '78704',
  })

  describe('address of record', () => {
    it('appends history rather than overwriting, and derives the current address', async () => {
      await recordAddressChange(tenantId, addr('1 First St'), 'portal', {
        kind: 'tenant',
        tenantId,
      })
      await recordAddressChange(tenantId, addr('2 Second Ave'), 'portal', {
        kind: 'tenant',
        tenantId,
      })

      const history = await addressHistory(tenantId)
      expect(history).toHaveLength(2)
      // Newest first, and the old one is still there — the whole point.
      expect(history[0].addressLine1).toBe('2 Second Ave')
      expect(history[1].addressLine1).toBe('1 First St')
      expect((await currentAddress(tenantId))?.addressLine1).toBe(
        '2 Second Ave',
      )
    })

    it('records who changed it and where from', async () => {
      const row = await currentAddress(tenantId)
      expect(row?.source).toBe('portal')
      expect(row?.actorTenantId).toBe(tenantId)
      expect(row?.actorStaffId).toBeNull()
    })

    it('normalises the state code so the record is comparable later', async () => {
      expect((await currentAddress(tenantId))?.state).toBe('TX')
    })

    it('keeps the tenant columns in step as a cache of the newest row', async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      })
      expect(tenant.addressLine1).toBe('2 Second Ave')
      expect(tenant.city).toBe('Austin')
    })

    it('writes nothing when the address has not actually changed', async () => {
      const before = (await addressHistory(tenantId)).length
      const result = await recordAddressChange(
        tenantId,
        addr('2 Second Ave'),
        'portal',
        {
          kind: 'tenant',
          tenantId,
        },
      )
      expect(result.changed).toBe(false)
      expect((await addressHistory(tenantId)).length).toBe(before)
    })

    it('flags returned mail on the row that came back without clearing the address', async () => {
      const row = await currentAddress(tenantId)
      await flagReturnedMail(row!.id)
      const after = await currentAddress(tenantId)
      expect(after?.returnedMailAt).toBeInstanceOf(Date)
      expect(after?.addressLine1, 'the address is known-bad, not unknown').toBe(
        '2 Second Ave',
      )
    })

    it('validates phone numbers without being precious about format', async () => {
      expect(
        await updateContactDetails(tenantId, {
          phone: '(512) 555-0100',
          altContactName: 'Sam',
          altContactPhone: null,
          altContactEmail: null,
        }),
      ).toEqual({})
      expect(
        await updateContactDetails(tenantId, {
          phone: '555',
          altContactName: null,
          altContactPhone: null,
          altContactEmail: null,
        }),
      ).toHaveProperty('phone')
    })
  })

  describe('email change', () => {
    it('does not touch the account until the link is opened', async () => {
      const target = `contact-new-${suffix}@example.com`
      expect(await requestEmailChange(tenantId, target)).toEqual({ ok: true })

      // The pending address lives on the token and nowhere else.
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      })
      expect(
        tenant.email,
        'the new address was applied before it was proved',
      ).not.toBe(target)

      const token = await prisma.authToken.findFirstOrThrow({
        where: { subjectId: tenantId, purpose: 'email_change', usedAt: null },
      })
      expect(token.email).toBe(target)
    })

    it('refuses an address already used by another account', async () => {
      const other = await prisma.tenant.findUniqueOrThrow({
        where: { id: otherTenantId },
      })
      expect(await requestEmailChange(tenantId, other.email)).toEqual({
        ok: false,
        reason: 'taken',
      })
    })

    it('refuses a change to the address already on the account', async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      })
      expect(await requestEmailChange(tenantId, tenant.email)).toEqual({
        ok: false,
        reason: 'unchanged',
      })
    })

    it('refuses something that is not an email address', async () => {
      expect(await requestEmailChange(tenantId, 'not-an-email')).toEqual({
        ok: false,
        reason: 'invalid',
      })
    })

    it('applies the change only on a valid token, and only once', async () => {
      const target = `contact-final-${suffix}@example.com`
      const { token } = await mintToken({
        purpose: 'email_change',
        audience: 'tenant',
        subjectId: tenantId,
        email: target,
      })

      expect(await confirmEmailChange(token)).toEqual({
        ok: true,
        email: target,
      })
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      })
      expect(tenant.email).toBe(target)
      // The new address has just proved it receives mail.
      expect(tenant.emailVerifiedAt).toBeInstanceOf(Date)

      // Single use: replaying the link does nothing.
      expect(await confirmEmailChange(token)).toEqual({
        ok: false,
        reason: 'invalid_token',
      })
    })

    it('rejects a token that was never issued', async () => {
      expect(await confirmEmailChange('not-a-real-token')).toEqual({
        ok: false,
        reason: 'invalid_token',
      })
    })

    it('refuses to apply a confirmed change onto an address taken since it was sent', async () => {
      // The link is good for 24 hours; someone else can register it meanwhile.
      // Without this the unique constraint surfaces as a crash on a link the
      // tenant was told to open.
      const other = await prisma.tenant.findUniqueOrThrow({
        where: { id: otherTenantId },
      })
      const { token } = await mintToken({
        purpose: 'email_change',
        audience: 'tenant',
        subjectId: tenantId,
        email: other.email,
      })
      expect(await confirmEmailChange(token)).toEqual({
        ok: false,
        reason: 'taken',
      })
    })
  })

  describe('portal documents', () => {
    it('shows the tenant their own lease document and refuses everyone else’s', async () => {
      const mine = await prisma.document.create({
        data: {
          facilityId,
          type: 'lease',
          subjectType: 'Lease',
          subjectId: leaseId,
          title: 'Storage agreement',
          content: '<p>Mine</p>',
          mimeType: 'text/html',
          contentHash: 'hash-mine',
        },
      })
      const theirs = await prisma.document.create({
        data: {
          facilityId,
          type: 'lease',
          subjectType: 'Lease',
          subjectId: otherLeaseId,
          title: 'Storage agreement',
          content: '<p>Theirs</p>',
          mimeType: 'text/html',
          contentHash: 'hash-theirs',
        },
      })

      const listed = await portalDocuments(tenantId)
      expect(listed.map((d) => d.id)).toEqual([mine.id])

      expect((await portalDocument(tenantId, mine.id))?.content).toBe(
        '<p>Mine</p>',
      )
      // A document id is not enough on its own.
      expect(await portalDocument(tenantId, theirs.id)).toBeNull()
    })

    it('does not expose the operator’s own file on the tenant’s lease', async () => {
      // The same store holds lien evidence and inspection photos against these
      // very leases. Those are the operator's record, not the tenant's copy.
      const evidence = await prisma.document.create({
        data: {
          facilityId,
          type: 'lien_evidence',
          subjectType: 'Lease',
          subjectId: leaseId,
          title: 'Lien evidence',
          content: '<p>Internal</p>',
          mimeType: 'text/html',
          contentHash: 'hash-evidence',
        },
      })

      expect((await portalDocuments(tenantId)).map((d) => d.id)).not.toContain(
        evidence.id,
      )
      expect(await portalDocument(tenantId, evidence.id)).toBeNull()
    })
  })
})
