import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { offerFor, redeemPromotion } from '../apps/web/lib/promotions/service'
import { promoDiscountOn, sessionByToken, startCheckout } from '../apps/web/lib/checkout/session'
import { amountDueToday } from '../apps/web/lib/checkout/payment'
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

  describe('the advertised price and the charged price (found 2026-08-14)', () => {
    // `startCheckout` claims a unit, and the suite's one fixture unit is
    // already spoken for by the lease above. Each of these gets its own.
    let sequence = 0
    async function availableUnit() {
      sequence += 1
      await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `PC-${suffix.slice(0, 3)}-${sequence}` },
      })
    }

    // The defect: the facility page priced a promotion through `offerFor`, and
    // "Rent now" started a checkout at `unitType.webRateCents` with no promo
    // attached at all. `checkout_session.promotionId` was a column nothing ever
    // wrote, so the card advertised a discount, the checkout charged full
    // price, and `provisionMoveIn`'s redemption block — guarded on that same
    // column — never ran for anybody. No `PromoRedemption` row had ever been
    // written by a real move-in, for a code promo or an automatic one.

    it('carries the offer onto the session and charges the discounted total', async () => {
      await availableUnit()
      await makePromotion()
      const offer = await offerFor({
        facilityId,
        unitTypeId,
        monthlyRateCents: RENT,
        isNewTenant: true,
      })
      expect(offer.offer?.firstPeriodCents).toBe(RENT / 2)

      const started = await startCheckout({
        facilityId,
        unitTypeId,
        quotedRateCents: RENT,
        promo: {
          promotionId: offer.offer!.promotionId,
          promoCodeId: offer.offer!.promoCodeId,
          terms: offer.offer!.terms,
          firstPeriodCents: offer.offer!.firstPeriodCents,
          schedule: offer.offer!.schedule,
        },
      })
      if (!started.ok) throw new Error('no unit to start a checkout on')

      const session = await sessionByToken(started.token)
      expect(session?.promotionId).toBe(offer.offer!.promotionId)

      const due = await amountDueToday(session!)
      const promoLine = due.lines.find((line) => line.key === 'promo')
      expect(promoLine?.amountCents).toBe(-(RENT / 2))
      // The figure the unit card advertised, arrived at by the money path.
      expect(due.totalDueTodayCents).toBe(RENT - RENT / 2)
      // And the recurring figure is untouched — this is a first-month promo.
      expect(due.ongoingMonthlyCents).toBe(RENT)
    })

    it('locks the offer, so pausing the promotion mid-checkout cannot raise the total', async () => {
      await availableUnit()
      const promotion = await makePromotion()
      const offer = await offerFor({ facilityId, unitTypeId, monthlyRateCents: RENT, isNewTenant: true })
      const started = await startCheckout({
        facilityId,
        unitTypeId,
        quotedRateCents: RENT,
        promo: {
          promotionId: offer.offer!.promotionId,
          promoCodeId: null,
          terms: offer.offer!.terms,
          firstPeriodCents: offer.offer!.firstPeriodCents,
          schedule: offer.offer!.schedule,
        },
      })
      if (!started.ok) throw new Error('no unit to start a checkout on')

      // The operator pauses it while the renter is on step 3.
      await prisma.promotion.update({ where: { id: promotion.id }, data: { status: 'paused' } })

      const session = await sessionByToken(started.token)
      const due = await amountDueToday(session!)
      // §6.4: a total may not move under a renter mid-checkout. `quotedRateCents`
      // has always been locked for exactly this reason; the discount is now too.
      expect(due.totalDueTodayCents).toBe(RENT - RENT / 2)
      expect(promoDiscountOn(session!)?.schedule).toEqual(offer.offer!.schedule)
    })

    it('attaches nothing when no promotion is live', async () => {
      await availableUnit()
      const offer = await offerFor({ facilityId, unitTypeId, monthlyRateCents: RENT, isNewTenant: true })
      expect(offer.offer).toBeNull()

      const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: RENT })
      if (!started.ok) throw new Error('no unit to start a checkout on')
      const session = await sessionByToken(started.token)

      expect(session?.promotionId).toBeNull()
      expect(promoDiscountOn(session!)).toBeNull()
      const due = await amountDueToday(session!)
      expect(due.lines.map((line) => line.key)).not.toContain('promo')
      expect(due.totalDueTodayCents).toBe(RENT)
    })
  })

})
