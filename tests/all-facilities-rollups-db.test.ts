import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  auctionApprovalRollup,
  rateIncreaseApprovalRollup,
  walkthroughRollup,
} from '../apps/web/lib/admin/rollups'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 §4.1 US-1, US-2 (B-235). What "All facilities" shows on the screens
// that used to answer it with a sentence.
//
// The properties worth a database, all of them shared by the six roll-ups
// through one helper: a row appears only where the actor holds the screen's
// permission, the figure counts what is WAITING rather than what exists, zero
// is stated in words, and the link drills into that facility rather than
// switching the persistent context.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let approvableId = ''
let unapprovableId = ''
let leaseId = ''
let unitId = ''
// `AuctionCase.leaseId` is unique — one case per lease — so "waiting" and
// "already approved" need a lease each.
let approvedLeaseId = ''
let approvedUnitId = ''
let staffId = ''

/// Regional at both facilities, but holding `auctions:approve` at only one —
/// the case the helper's permission filter exists for. Access scope says which
/// sites are visible; the permission says which of them a screen answers for.
function actor(permissionsAtApprovable: PermissionKey[]): Actor {
  const base = { roleKey: 'regional', rank: 30, limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null } }
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      { ...base, facilityId: approvableId, permissions: new Set<PermissionKey>(permissionsAtApprovable) },
      { ...base, facilityId: unapprovableId, permissions: new Set<PermissionKey>(['tenants:view']) },
    ],
  }
}

describeDb('all-facilities roll-ups (B-235)', () => {
  beforeAll(async () => {
    const facility = (name: string, slug: string) =>
      prisma.facility.create({
        data: {
          name,
          slug,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
    // Named so the alphabetical order `accessibleFacilities` imposes is known:
    // the approvable one sorts first.
    const [a, b] = await Promise.all([
      facility(`AA Rollup ${suffix}`, `aa-rollup-${suffix}`),
      facility(`ZZ Rollup ${suffix}`, `zz-rollup-${suffix}`),
    ])
    approvableId = a.id
    unapprovableId = b.id

    const staff = await prisma.staffUser.create({
      data: { email: `rollup-${suffix}@example.com`, firstName: 'Rhea', lastName: 'Regional' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `rollup-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unitType = await prisma.unitType.create({
      data: { facilityId: approvableId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId: approvableId, unitTypeId: unitType.id, number: `R-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId: approvableId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'pending_auction',
        startDate: new Date('2026-05-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id

    const secondUnit = await prisma.unit.create({
      data: { facilityId: approvableId, unitTypeId: unitType.id, number: `S-${suffix.slice(0, 4)}` },
    })
    approvedUnitId = secondUnit.id
    const secondLease = await prisma.lease.create({
      data: {
        facilityId: approvableId,
        tenantId: tenant.id,
        unitId: secondUnit.id,
        status: 'pending_auction',
        startDate: new Date('2026-05-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    approvedLeaseId = secondLease.id
  })

  beforeEach(async () => {
    await prisma.auctionCase.deleteMany({ where: { facilityId: { in: [approvableId, unapprovableId] } } })
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId: approvableId } })
    await prisma.task.deleteMany({ where: { facilityId: { in: [approvableId, unapprovableId] } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // `audit_log` is append-only and holds a RESTRICT key to `facility`
    // (B-185), so nothing here writes one — these are direct row creates and
    // read-only roll-ups.
    await prisma.auctionCase.deleteMany({ where: { facilityId: { in: [approvableId, unapprovableId] } } })
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId: approvableId } })
    await prisma.task.deleteMany({ where: { facilityId: { in: [approvableId, unapprovableId] } } })
    await prisma.lease.deleteMany({ where: { facilityId: approvableId } })
    await prisma.unit.deleteMany({ where: { facilityId: approvableId } })
    await prisma.unitType.deleteMany({ where: { facilityId: approvableId } })
    await prisma.tenant.deleteMany({ where: { email: `rollup-t-${suffix}@example.com` } })
    await prisma.staffUser.deleteMany({ where: { id: staffId } })
    await prisma.facility.deleteMany({ where: { id: { in: [approvableId, unapprovableId] } } })
  })

  /// `storage_test` accumulates facilities across suites (B-185), so every
  /// assertion is scoped to this suite's own two rather than to the list's
  /// length.
  const mine = <T extends { facilityId: string }>(rows: T[]): T[] =>
    rows.filter((row) => row.facilityId === approvableId || row.facilityId === unapprovableId)

  describe('auction approvals', () => {
    const openCase = (approved: boolean) =>
      prisma.auctionCase.create({
        data: {
          facilityId: approvableId,
          leaseId: approved ? approvedLeaseId : leaseId,
          unitId: approved ? approvedUnitId : unitId,
          status: 'eligible',
          approvedAt: approved ? new Date('2026-08-01T00:00:00Z') : null,
          approvedByStaffId: approved ? staffId : null,
        },
      })

    it('states a zero in words rather than leaving the row blank', async () => {
      const rows = mine(await auctionApprovalRollup(actor(['auctions:approve'])))
      const row = rows.find((one) => one.facilityId === approvableId)!
      // A site with nothing waiting has to read as EMPTY, not as unvisited —
      // an em dash or a missing row is the same signal as "I have not looked".
      expect(row.summary).toBe('Nothing waiting for approval')
    })

    it('counts what is waiting, not what exists', async () => {
      await openCase(false)
      await openCase(true)

      const rows = mine(await auctionApprovalRollup(actor(['auctions:approve'])))
      const row = rows.find((one) => one.facilityId === approvableId)!
      // Two open cases, one already signed off. The roll-up is a worklist.
      expect(row.summary).toBe('1 waiting for approval')
    })

    it('drills into the facility rather than switching the context', async () => {
      const rows = mine(await auctionApprovalRollup(actor(['auctions:approve'])))
      const row = rows.find((one) => one.facilityId === approvableId)!
      expect(row.href).toBe(`/admin/auctions?facility=${approvableId}`)
    })

    it('omits a facility the actor can see but cannot approve at', async () => {
      const rows = mine(await auctionApprovalRollup(actor(['auctions:approve'])))
      // Visible in the switcher, absent from the worklist: a zero here would be
      // a claim that there is nothing waiting, which this actor cannot know.
      expect(rows.map((one) => one.facilityId)).toEqual([approvableId])
    })

    it('shows nothing at all to an actor holding the permission nowhere', async () => {
      expect(mine(await auctionApprovalRollup(actor(['tenants:view'])))).toEqual([])
    })
  })

  describe('rate-increase approvals', () => {
    it('counts a batch waiting on a regional signature', async () => {
      await prisma.tenantRateIncrease.create({
        data: {
          facilityId: approvableId,
          leaseId,
          currentRateCents: 12_900,
          newRateCents: 13_900,
          effectiveDate: new Date('2026-11-01T00:00:00Z'),
          noticeDate: new Date('2026-10-01T00:00:00Z'),
          noticeDays: 30,
          status: 'pending_approval',
        },
      })

      const rows = mine(await rateIncreaseApprovalRollup(actor(['rates:tenant_increase'])))
      expect(rows.find((one) => one.facilityId === approvableId)!.summary).toBe(
        '1 waiting for approval',
      )
    })
  })

  describe('the daily walk', () => {
    it('says which of the two states a site is in, not a count of one', async () => {
      await prisma.task.create({
        data: {
          facilityId: approvableId,
          type: 'daily_walkthrough',
          entityType: 'Facility',
          entityId: approvableId,
          businessDate: new Date('2026-09-02T00:00:00Z'),
        },
      })

      const rows = mine(await walkthroughRollup(actor(['tenants:view'])))
      expect(rows.find((one) => one.facilityId === approvableId)!.summary).toBe(
        'Walk not confirmed today',
      )
      // The other site has no open task — one per facility per day, so "0" is
      // not a figure anybody wants read out.
      expect(rows.find((one) => one.facilityId === unapprovableId)!.summary).toBe(
        'Walk confirmed, or not yet raised',
      )
    })
  })
})
