import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import { SHARED_ACCESS_PRESETS } from '../packages/core/access'
import {
  expireNonTenantCodes,
  issueNonTenantCode,
  nonTenantCodes,
  revokeNonTenantCode,
} from '../apps/web/lib/access/non-tenant'
import { evaluateKeypadEntry } from '../apps/web/lib/access/simulator'
import { accessEventLog } from '../apps/web/lib/access/event-log'
import { deactivateStaffUser } from '../apps/web/lib/admin/staff-security'
import { cancelAuction, issueAuctionBuyerCode } from '../apps/web/lib/auctions/service'

// B-436 / PRD 03 US-10. Gate codes for staff, vendors and dated visitors,
// through the tenant's grant, credential and outbox path on the simulated
// adapter.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let ownerId = ''
let tenantId = ''
let leaseId = ''
let unitId = ''

const limits = { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 }

/// Org-wide, because `users:manage` is asked with a null facility.
const owner = (): Actor => ({
  kind: 'staff',
  staffUserId: ownerId,
  assignments: [
    {
      facilityId: null,
      roleKey: 'owner',
      rank: 40,
      permissions: new Set<PermissionKey>([
        'access:manage_grants',
        'access:events',
        'users:manage',
        'auctions:approve',
      ]),
      limits,
    },
  ],
})

const counter = (): Actor => ({
  kind: 'staff',
  staffUserId: ownerId,
  assignments: [
    { facilityId, roleKey: 'counter', rank: 10, permissions: new Set<PermissionKey>(), limits },
  ],
})

/// `YYYY-MM-DD`, N days from now in the facility's timezone.
const dayOffset = (days: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

// 10:00 in Chicago, inside the 06:00 to 22:00 gate hours.
const WEDNESDAY = new Date('2026-07-15T15:00:00Z')
const SATURDAY = new Date('2026-07-18T15:00:00Z')

const makeStaff = (label: string) =>
  prisma.staffUser.create({
    data: { email: `b436-${label}-${suffix}@example.com`, firstName: 'Sam', lastName: `Keyholder ${label}` },
  })

describeDb('non-tenant gate codes', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Non-Tenant Codes Test',
        slug: `non-tenant-codes-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        gateHours: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
            (day) => [day, { closed: false, open: '06:00', close: '22:00' }],
          ),
        ),
      },
    })
    facilityId = facility.id
    ownerId = (await makeStaff('owner')).id

    const tenant = await prisma.tenant.create({
      data: { email: `b436-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
    })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'pending_auction',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id
  })

  const wipe = async () => {
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.auctionCase.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  }

  beforeEach(wipe)

  afterAll(async () => {
    if (!hasDatabase) return
    await wipe()
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // Not the facility or the staff users: audit entries from this file hold a
    // Restrict FK to both (B-185).
    await prisma.$disconnect()
  })

  const vendor = (input: Partial<Parameters<typeof issueNonTenantCode>[1]> = {}) =>
    issueNonTenantCode(owner(), {
      facilityId,
      holderType: 'vendor',
      holderName: 'Lone Star Pest Control',
      ...input,
    })

  it('deactivating a staff user revokes their code on the keypad (AC2)', async () => {
    const staff = await makeStaff(`leaver-${randomUUID().slice(0, 6)}`)
    const issued = await issueNonTenantCode(owner(), {
      facilityId,
      holderType: 'staff',
      staffUserId: staff.id,
    })
    if (!issued.ok) throw new Error(issued.reason)
    expect((await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).result).toBe('granted')

    const result = await deactivateStaffUser(owner(), {
      staffUserId: staff.id,
      reasonCode: 'left the company',
    })
    expect(result).toEqual({ ok: true, gateCodesRevoked: 1 })

    const after = await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)
    expect(after).toMatchObject({ result: 'denied', reason: 'inactive' })
    const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: issued.grantId } })
    expect(grant).toMatchObject({ state: 'revoked', stateCause: 'system:staff_deactivated' })
    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe(
      'suspended',
    )
    expect(
      await prisma.auditLog.count({ where: { action: 'user.deactivated', entityId: staff.id } }),
    ).toBe(1)
  })

  it('refuses to deactivate your own account, and a second code for one staff member', async () => {
    expect(
      await deactivateStaffUser(owner(), { staffUserId: ownerId, reasonCode: 'x' }),
    ).toEqual({ ok: false, reason: 'self' })

    const first = await issueNonTenantCode(owner(), { facilityId, holderType: 'staff', staffUserId: ownerId })
    expect(first.ok).toBe(true)
    expect(
      await issueNonTenantCode(owner(), { facilityId, holderType: 'staff', staffUserId: ownerId }),
    ).toEqual({ ok: false, reason: 'staff_has_code' })
  })

  it('the nightly sweep revokes the code of a staff user suspended in the database', async () => {
    const staff = await makeStaff(`db-${randomUUID().slice(0, 6)}`)
    const issued = await issueNonTenantCode(owner(), { facilityId, holderType: 'staff', staffUserId: staff.id })
    if (!issued.ok) throw new Error(issued.reason)
    await prisma.staffUser.update({ where: { id: staff.id }, data: { status: 'suspended' } })

    expect(await expireNonTenantCodes(new Date(), facilityId)).toEqual({ expired: 1 })
    expect((await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).result).toBe('denied')
  })

  it('denies a vendor code outside its window, and the log names the holder (AC4)', async () => {
    const issued = await vendor({ accessHours: SHARED_ACCESS_PRESETS.weekdays.schedule })
    if (!issued.ok) throw new Error(issued.reason)

    expect(await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).toMatchObject({
      result: 'granted',
    })
    expect(await evaluateKeypadEntry(facilityId, issued.code, SATURDAY)).toMatchObject({
      result: 'denied',
      reason: 'outside_hours',
    })

    const log = await accessEventLog(owner(), { facilityId })
    expect(log).toHaveLength(2)
    for (const row of log) {
      expect(row).toMatchObject({
        holderName: 'Lone Star Pest Control',
        holderKind: 'vendor',
        tenantId: null,
      })
    }
    expect(log.find((row) => row.result === 'denied')?.flags).toContain('after_hours_attempt')
  })

  it('a temporary code needs a last day, works through it, and is revoked after it', async () => {
    expect(
      await issueNonTenantCode(owner(), { facilityId, holderType: 'temporary', holderName: 'Roof inspector' }),
    ).toEqual({ ok: false, reason: 'expiry_required' })
    expect(
      await issueNonTenantCode(owner(), {
        facilityId,
        holderType: 'temporary',
        holderName: 'Roof inspector',
        expiresOn: dayOffset(-1),
      }),
    ).toEqual({ ok: false, reason: 'expiry_in_past' })

    const issued = await issueNonTenantCode(owner(), {
      facilityId,
      holderType: 'temporary',
      holderName: 'Roof inspector',
      expiresOn: dayOffset(0),
    })
    if (!issued.ok) throw new Error(issued.reason)

    // Still today: nothing is due.
    expect(await expireNonTenantCodes(new Date(), facilityId)).toEqual({ expired: 0 })
    expect(await nonTenantCodes(owner(), facilityId)).toHaveLength(1)

    // Two days on, the sweep revokes it at the controller.
    const later = new Date(Date.now() + 2 * 86_400_000)
    expect(await expireNonTenantCodes(later, facilityId)).toEqual({ expired: 1 })
    expect(await expireNonTenantCodes(later, facilityId)).toEqual({ expired: 0 })
    const controller = await prisma.simulatedGateCode.findUniqueOrThrow({
      where: { credentialId: issued.credentialId },
    })
    expect(controller.active).toBe(false)
    expect(await nonTenantCodes(owner(), facilityId)).toHaveLength(0)
  })

  it('a person can revoke a code, once', async () => {
    const issued = await vendor()
    if (!issued.ok) throw new Error(issued.reason)
    expect(await revokeNonTenantCode(owner(), issued.grantId, 'staff_revoked')).toEqual({ ok: true })
    expect(await revokeNonTenantCode(owner(), issued.grantId, 'staff_revoked')).toEqual({
      ok: false,
      reason: 'already_revoked',
    })
    expect((await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).result).toBe('denied')
  })

  it('an auction buyer code is issued from the case and ends with it (AC3)', async () => {
    const auction = await prisma.auctionCase.create({
      data: {
        facilityId,
        leaseId,
        unitId,
        status: 'eligible',
      },
    })
    expect((await issueAuctionBuyerCode(owner(), auction.id, 'Bea Buyer')).ok).toBe(false)

    await prisma.auctionCase.update({
      where: { id: auction.id },
      data: { status: 'scheduled', scheduledSaleDate: new Date(`${dayOffset(3)}T00:00:00Z`) },
    })
    const issued = await issueAuctionBuyerCode(owner(), auction.id, 'Bea Buyer')
    if (!issued.ok) throw new Error(issued.reason)
    expect(issued.expiresOn).toBe(dayOffset(3))

    const [row] = await nonTenantCodes(owner(), facilityId)
    expect(row).toMatchObject({ holderName: 'Bea Buyer', holderType: 'temporary', auctionBuyer: true })
    expect((await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).result).toBe('granted')
    expect((await accessEventLog(owner(), { facilityId }))[0]).toMatchObject({
      holderName: 'Bea Buyer',
      holderKind: 'auction_buyer',
    })

    expect(await cancelAuction(owner(), auction.id, 'tenant paid')).toEqual({ ok: true })
    expect((await evaluateKeypadEntry(facilityId, issued.code, WEDNESDAY)).result).toBe('denied')
  })

  it('needs access:manage_grants, and a grant has exactly one kind of holder', async () => {
    await expect(
      issueNonTenantCode(counter(), { facilityId, holderType: 'vendor', holderName: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    // The CHECK is the backstop: a tenant's grant cannot also name a vendor,
    // and a vendor's cannot be nameless.
    await expect(
      prisma.accessGrant.create({
        data: { facilityId, tenantId, holderType: 'vendor', holderName: 'Both' },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.accessGrant.create({ data: { facilityId, holderType: 'vendor' } }),
    ).rejects.toThrow()
  })
})
