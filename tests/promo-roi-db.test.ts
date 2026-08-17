import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { promoRoiReport } from '../apps/web/lib/analytics/promo-roi'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 04 §3.2 US-4 (B-082 part 4). Promo ROI against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const RANGE = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') }
const IN_RANGE = new Date('2026-05-15T12:00:00Z')
const RENT = 12_900

let facilityId = ''
let staffId = ''
let unitTypeId = ''
let tenantId = ''
const leaseIds: Record<string, string> = {}

function actor(permissions: PermissionKey[] = ['reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeLease(key: string, status: 'active' | 'ended' | 'pending') {
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `R-${suffix.slice(0, 4)}-${key}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status,
      startDate: new Date('2026-05-01T00:00:00Z'),
      billingDay: 1,
      monthlyRateCents: RENT,
    },
  })
  leaseIds[key] = lease.id
  return lease.id
}

async function makePromotion(name: string) {
  const promotion = await prisma.promotion.create({
    data: {
      name: `${name} ${suffix}`,
      type: 'percent_off',
      value: 50,
      durationPeriods: 2,
      status: 'active',
      displayMode: 'auto',
      facilityIds: [facilityId],
    },
  })
  return promotion.id
}

async function redeem(input: {
  promotionId: string
  leaseId?: string
  totalCents: number
  schedule: { periodIndex: number; amountCents: number }[]
  appliedPeriods?: number[]
  at?: Date
}) {
  const row = await prisma.promoRedemption.create({
    data: {
      promotionId: input.promotionId,
      facilityId,
      leaseId: input.leaseId ?? null,
      schedule: input.schedule,
      totalCents: input.totalCents,
      appliedPeriods: input.appliedPeriods ?? [],
    },
  })
  // `createdAt` is what the range filters on and it defaults to now.
  await prisma.promoRedemption.update({
    where: { id: row.id },
    data: { createdAt: input.at ?? IN_RANGE },
  })
  return row.id
}

describeDb('promo ROI', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `ROI ${suffix}`,
        slug: `roi-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `roi-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id

    const tenant = await prisma.tenant.create({
      data: { email: `roi-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    await makeLease('active', 'active')
    await makeLease('ended', 'ended')
    await makeLease('pending', 'pending')
  })

  beforeEach(async () => {
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.staffUser.deleteMany({ where: { id: staffId } })
    await prisma.$disconnect()
  })

  it('reports given and still-to-give separately', async () => {
    const promotionId = await makePromotion('Half off two months')
    await redeem({
      promotionId,
      leaseId: leaseIds.active,
      totalCents: 12_900,
      schedule: [
        { periodIndex: 0, amountCents: 6_450 },
        { periodIndex: 1, amountCents: 6_450 },
      ],
      appliedPeriods: [0],
    })

    const report = await promoRoiReport(actor(), RANGE)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].realisedCents).toBe(6_450)
    expect(report.rows[0].outstandingCents).toBe(6_450)
    expect(report.rows[0].committedCents).toBe(12_900)
  })

  it('counts a redemption that never reached a lease, but not as a move-in', async () => {
    // It cost nothing and bought nothing. Counting it as a move-in is the
    // easiest way to make a promotion look better than it was.
    const promotionId = await makePromotion('Reserved never rented')
    await redeem({
      promotionId,
      totalCents: 12_900,
      schedule: [{ periodIndex: 0, amountCents: 12_900 }],
    })

    const report = await promoRoiReport(actor(), RANGE)
    expect(report.rows[0].redemptions).toBe(1)
    expect(report.rows[0].moveIns).toBe(0)
    expect(report.rows[0].stillRenting).toBe(0)
    expect(report.rows[0].monthlyRentCents).toBe(0)
  })

  it('counts only leases that are actually paying as still renting', async () => {
    const promotionId = await makePromotion('Mixed outcomes')
    for (const key of ['active', 'ended', 'pending'] as const) {
      await redeem({
        promotionId,
        leaseId: leaseIds[key],
        totalCents: 12_900,
        schedule: [{ periodIndex: 0, amountCents: 12_900 }],
        appliedPeriods: [0],
      })
    }

    const report = await promoRoiReport(actor(), RANGE)
    expect(report.rows[0].moveIns).toBe(3)
    // `ended` has left; `pending` has not started. Counting either as recurring
    // revenue the discount bought would flatter the promotion.
    expect(report.rows[0].stillRenting).toBe(1)
    expect(report.rows[0].monthlyRentCents).toBe(RENT)
  })

  it('groups by promotion and totals to the rows it renders', async () => {
    const a = await makePromotion('Promo A')
    const b = await makePromotion('Promo B')
    await redeem({ promotionId: a, leaseId: leaseIds.active, totalCents: 5_000, schedule: [{ periodIndex: 0, amountCents: 5_000 }], appliedPeriods: [0] })
    await redeem({ promotionId: a, totalCents: 5_000, schedule: [{ periodIndex: 0, amountCents: 5_000 }] })
    await redeem({ promotionId: b, totalCents: 1_000, schedule: [{ periodIndex: 0, amountCents: 1_000 }], appliedPeriods: [0] })

    const report = await promoRoiReport(actor(), RANGE)
    expect(report.rows).toHaveLength(2)
    // Most expensive first — the promotion needing a decision is the one
    // giving the most away.
    expect(report.rows[0].realisedCents).toBe(5_000)
    expect(report.totals.redemptions).toBe(3)
    expect(report.totals.realisedCents).toBe(6_000)
    expect(report.totals.committedCents).toBe(11_000)
  })

  it('excludes redemptions outside the range', async () => {
    const promotionId = await makePromotion('Last month')
    await redeem({
      promotionId,
      totalCents: 9_900,
      schedule: [{ periodIndex: 0, amountCents: 9_900 }],
      at: new Date('2026-04-02T00:00:00Z'),
    })

    expect((await promoRoiReport(actor(), RANGE)).rows).toHaveLength(0)
  })

  it('returns nothing to an actor without the reports permission', async () => {
    const promotionId = await makePromotion('Hidden')
    await redeem({ promotionId, totalCents: 1_000, schedule: [{ periodIndex: 0, amountCents: 1_000 }] })

    const report = await promoRoiReport(actor(['tenants:view']), RANGE)
    expect(report.rows).toEqual([])
    expect(report.totals.redemptions).toBe(0)
  })
})
