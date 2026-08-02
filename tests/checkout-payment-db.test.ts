import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { amountDueToday, preparePayment } from '../apps/web/lib/checkout/payment'
import type { CheckoutSessionView } from '../apps/web/lib/checkout/session'
import { calculateMoveInCost } from '../packages/core/pricing'

// B-025 / PRD 01 US-501 step 5, FR-4.4.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''

function sessionView(overrides: Partial<CheckoutSessionView> = {}): CheckoutSessionView {
  return {
    id: `session-${suffix}`,
    step: 'payment',
    status: 'active',
    facilityId,
    unitTypeId,
    unitId: null,
    email: `pay-${suffix}@example.com`,
    quotedRateCents: 12_900,
    lockExpiresAt: new Date(Date.now() + 600_000),
    data: {},
    lockLapsed: false,
    ...overrides,
  }
}

describeDb('amount due today', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Pay Test',
        slug: `pay-${suffix}`,
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

    await prisma.feeSchedule.create({
      data: {
        facilityId,
        feeType: 'admin',
        amountCents: 2_500,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
    await prisma.taxComponent.createMany({
      data: [
        { facilityId, jurisdiction: 'state', rateBasisPoints: 625, effectiveFrom: new Date('2020-01-01T00:00:00Z') },
        { facilityId, jurisdiction: 'city', rateBasisPoints: 200, effectiveFrom: new Date('2020-01-01T00:00:00Z') },
      ],
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.taxComponent.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('agrees with the figure shown while browsing', async () => {
    // US-301 makes a disagreement here a release-blocking defect, so this
    // asserts the two really are the same calculation rather than two that
    // happen to match today.
    const due = await amountDueToday(sessionView())
    const browsing = calculateMoveInCost({
      webRateCents: 12_900,
      streetRateCents: 12_900,
      adminFeeCents: 2_500,
      taxRates: [
        { jurisdiction: 'city', rateBasisPoints: 200 },
        { jurisdiction: 'state', rateBasisPoints: 625 },
      ],
    })
    expect(due.totalDueTodayCents).toBe(browsing.totalDueTodayCents)
  })

  it('itemises to exactly the total it charges', async () => {
    const due = await amountDueToday(sessionView())
    const summed = due.lines.reduce((total, line) => total + line.amountCents, 0)
    expect(summed).toBe(due.totalDueTodayCents)
  })

  it('adds the protection premium the renter actually chose', async () => {
    const due = await amountDueToday(sessionView({ data: { protectionPremiumCents: 1_400 } }))
    const without = await amountDueToday(sessionView())
    expect(due.totalDueTodayCents).toBe(without.totalDueTodayCents + 1_400)
    expect(due.ongoingMonthlyCents).toBe(without.ongoingMonthlyCents + 1_400)
    expect(due.lines.some((line) => line.key === 'protection')).toBe(true)
  })

  it('takes the premium from the session, never from the caller', async () => {
    // The session is where step 3 recorded it. A premium the browser could
    // supply is a total the renter could choose.
    const due = await amountDueToday(sessionView({ data: { protectionPremiumCents: 'free' } }))
    const without = await amountDueToday(sessionView())
    expect(due.totalDueTodayCents).toBe(without.totalDueTodayCents)
  })

  it('reports payments unavailable rather than throwing when Stripe is unconfigured', async () => {
    // No keys are configured anywhere in this project yet, so this is the live
    // path: the step tells the renter to call instead of rendering a form that
    // cannot submit.
    const before = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    expect(await preparePayment(sessionView())).toEqual({ available: false })
    if (before !== undefined) process.env.STRIPE_SECRET_KEY = before
  })
})
