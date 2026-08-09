import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { offerFor, redeemPromotion } from '../apps/web/lib/promotions/service'
import { discountForLeasePeriod, markDiscountApplied } from '../apps/web/lib/promotions/billing'

// B-070 / PRD 04 FR-PROMO-3/4/5, against real rows.
//
// FR-PROMO-5 is the one worth a database: "redemption caps enforced atomically
// at reservation completion." Atomicity is not something a unit test can see.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let leaseId = ''
const RENT = 12_900

async function makePromotion(overrides: Record<string, unknown> = {}) {
  return prisma.promotion.create({
    data: {
      name: `Promo ${suffix}`,
      type: 'percent_off',
      value: 50,
      durationPeriods: 1,
      status: 'active',
      displayMode: 'auto',
      facilityIds: [facilityId],
      ...overrides,
    },
  })
}

describeDb('promotions', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Promo ${suffix}`,
        slug: `promo-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id

    const tenant = await prisma.tenant.create({
      data: { email: `promo-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `P-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-07-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: RENT,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promoCode.deleteMany({ where: { promotion: { name: { contains: suffix } } } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promoCode.deleteMany({ where: { promotion: { name: { contains: suffix } } } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.$disconnect()
  })

  describe('offerFor — FR-PROMO-3', () => {
    it('finds an automatic promo and computes its schedule', async () => {
      await makePromotion()
      const lookup = await offerFor({
        facilityId,
        unitTypeId,
        monthlyRateCents: RENT,
        isNewTenant: true,
      })
      expect(lookup.offer?.firstPeriodCents).toBe(6_450)
      expect(lookup.badges).toHaveLength(1)
    })

    it('will not offer a code whose own cap is spent, even with the promo open', async () => {
      // A partner's allocation runs out while the promotion has redemptions
      // left. Two separate limits, and the code's is the one that bit.
      const promotion = await makePromotion({ displayMode: 'code' })
      await prisma.promoCode.create({
        data: { promotionId: promotion.id, code: `spent-${suffix}`, maxUses: 1, usesCount: 1 },
      })

      const lookup = await offerFor({
        facilityId,
        unitTypeId,
        monthlyRateCents: RENT,
        isNewTenant: true,
        code: `SPENT-${suffix}`,
      })
      expect(lookup.offer).toBeNull()
      expect(lookup.problem).toBeTruthy()
    })
  })

  describe('redeemPromotion — FR-PROMO-5', () => {
    it('claims a redemption and snapshots the schedule', async () => {
      const promotion = await makePromotion()

      const result = await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: null,
          facilityId,
          schedule: [{ periodIndex: 0, amountCents: 6_450 }],
          totalCents: 6_450,
        }),
      )
      expect(result).toMatchObject({ ok: true, totalCents: 6_450 })

      const after = await prisma.promotion.findUniqueOrThrow({ where: { id: promotion.id } })
      expect(after.redemptionCount).toBe(1)
    })

    it('enforces the cap under genuine concurrency', async () => {
      // The test this file exists for. Five transactions race for the last two
      // redemptions; a check-then-write would let all five through.
      const promotion = await makePromotion({ maxRedemptions: 2 })

      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          prisma.$transaction((tx) =>
            redeemPromotion(tx, {
              promotionId: promotion.id,
              promoCodeId: null,
              facilityId,
              schedule: [{ periodIndex: 0, amountCents: 6_450 }],
              totalCents: 6_450,
            }),
          ),
        ),
      )

      expect(attempts.filter((one) => one.ok)).toHaveLength(2)
      expect(attempts.filter((one) => !one.ok)).toHaveLength(3)

      const after = await prisma.promotion.findUniqueOrThrow({ where: { id: promotion.id } })
      expect(after.redemptionCount).toBe(2)
      expect(await prisma.promoRedemption.count({ where: { promotionId: promotion.id } })).toBe(2)
    })

    it('falls back gracefully rather than throwing when the cap is gone', async () => {
      // FR-PROMO-5: "over-cap attempts fall back gracefully (reservation
      // completes at standard rate)". The rental proceeds; the discount does not.
      const promotion = await makePromotion({ maxRedemptions: 1, redemptionCount: 1 })

      const result = await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: null,
          facilityId,
          schedule: [{ periodIndex: 0, amountCents: 6_450 }],
          totalCents: 6_450,
        }),
      )
      expect(result).toEqual({ ok: false, reason: 'cap_reached' })
    })

    it('does not spend a promotion redemption when the code’s cap fails', async () => {
      const promotion = await makePromotion({ displayMode: 'code' })
      const code = await prisma.promoCode.create({
        data: { promotionId: promotion.id, code: `full-${suffix}`, maxUses: 1, usesCount: 1 },
      })

      const result = await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: code.id,
          facilityId,
          schedule: [{ periodIndex: 0, amountCents: 6_450 }],
          totalCents: 6_450,
        }),
      )
      expect(result).toEqual({ ok: false, reason: 'cap_reached' })

      // The rollback: the promotion's own counter must not have been consumed
      // by a redemption that never happened.
      const after = await prisma.promotion.findUniqueOrThrow({ where: { id: promotion.id } })
      expect(after.redemptionCount).toBe(0)
    })
  })

  describe('the billing hand-off — US-12 AC2', () => {
    it('answers what comes off each period from the snapshot', async () => {
      const promotion = await makePromotion({ durationPeriods: 2 })
      await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: null,
          facilityId,
          leaseId,
          schedule: [
            { periodIndex: 0, amountCents: 6_450 },
            { periodIndex: 1, amountCents: 6_450 },
          ],
          totalCents: 12_900,
        }),
      )

      expect((await discountForLeasePeriod(leaseId, 0))?.amountCents).toBe(6_450)
      expect((await discountForLeasePeriod(leaseId, 1))?.amountCents).toBe(6_450)
      // Past the promo, the tenant pays full price.
      expect(await discountForLeasePeriod(leaseId, 2)).toBeNull()
    })

    it('never discounts the same period twice, however often the run repeats', async () => {
      // The nightly job is re-runnable and catches up missed dates (FR-4).
      // Without `appliedPeriods` a caught-up week would apply the first
      // month's discount seven times.
      const promotion = await makePromotion()
      const redeemed = await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: null,
          facilityId,
          leaseId,
          schedule: [{ periodIndex: 0, amountCents: 6_450 }],
          totalCents: 6_450,
        }),
      )
      if (!redeemed.ok) throw new Error('unreachable')

      expect(await discountForLeasePeriod(leaseId, 0)).not.toBeNull()
      await prisma.$transaction((tx) => markDiscountApplied(tx, redeemed.redemptionId, 0))
      expect(await discountForLeasePeriod(leaseId, 0)).toBeNull()
    })

    it('reads the snapshot, not the promotion, after the promo changes', async () => {
      // A promo edited or ended next quarter must not rewrite what a tenant was
      // already promised.
      const promotion = await makePromotion()
      await prisma.$transaction((tx) =>
        redeemPromotion(tx, {
          promotionId: promotion.id,
          promoCodeId: null,
          facilityId,
          leaseId,
          schedule: [{ periodIndex: 0, amountCents: 6_450 }],
          totalCents: 6_450,
        }),
      )

      await prisma.promotion.update({
        where: { id: promotion.id },
        data: { value: 5, status: 'ended' },
      })

      expect((await discountForLeasePeriod(leaseId, 0))?.amountCents).toBe(6_450)
    })
  })
})
