import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  INVENTORY_CACHE_TTL_SECONDS,
  liveAvailableCount,
  publicInventoryForFacility,
} from '../apps/web/lib/inventory/public-inventory'
import { verifyQuoteFor } from '../apps/web/lib/pricing/quote-token'
import { GET as inventoryRoute } from '../apps/web/app/api/public/facilities/[slug]/inventory/route'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const slug = `public-inv-${suffix}`
const inactiveSlug = `public-inv-off-${suffix}`

let facilityId = ''
let inactiveFacilityId = ''
let pricedTypeId = ''
let unpricedTypeId = ''

const past = new Date('2020-01-01T00:00:00Z')

// Everything is created through plain Prisma rather than the admin libs on
// purpose: those record audit entries, and an audited facility can never be
// hard-deleted (AuditLog.facility is Restrict). This suite needs an *active*
// facility to exercise the public read at all, so it must be able to clean up
// after itself rather than leaving a live facility in the switcher.
async function makeFacility(name: string, facilitySlug: string, status: 'active' | 'inactive') {
  const facility = await prisma.facility.create({
    data: {
      name,
      slug: facilitySlug,
      status,
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
      phone: '512-555-0100',
    },
  })
  return facility.id
}

beforeAll(async () => {
  if (!hasDatabase) return

  facilityId = await makeFacility('Public Inventory Test', slug, 'active')
  inactiveFacilityId = await makeFacility('Closed Site', inactiveSlug, 'inactive')

  const priced = await prisma.unitType.create({
    data: { facilityId, name: `10x10 Climate ${suffix}`, widthFt: 10, lengthFt: 10, climateControlled: true },
  })
  pricedTypeId = priced.id

  const unpriced = await prisma.unitType.create({
    data: { facilityId, name: `10x30 Unpriced ${suffix}`, widthFt: 10, lengthFt: 30 },
  })
  unpricedTypeId = unpriced.id

  await prisma.unitTypeRate.create({
    data: {
      facilityId,
      unitTypeId: pricedTypeId,
      streetRateCents: 19_900,
      webRateCents: 14_900,
      effectiveFrom: past,
    },
  })

  // `status` is normally derived by recomputeUnitStatus(); written directly
  // here to stand in for the lease/reservation events that would produce each
  // state, since this suite is testing the counting, not the derivation.
  const statuses = [
    'available',
    'available',
    'available',
    'occupied',
    'reserved',
    'maintenance',
    'overlocked',
    'unrentable',
  ] as const

  await prisma.unit.createMany({
    data: statuses.map((status, index) => ({
      facilityId,
      unitTypeId: pricedTypeId,
      number: `${suffix}-${index}`,
      status,
      operationalStatus: status === 'maintenance' || status === 'unrentable' ? status : 'available',
    })),
  })
})

afterAll(async () => {
  if (!hasDatabase) return
  // Explicit order: Unit.unitType is Restrict, so units must go before types.
  await prisma.unit.deleteMany({ where: { facilityId } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
  await prisma.unitType.deleteMany({ where: { facilityId } })
  await prisma.facility.deleteMany({ where: { id: { in: [facilityId, inactiveFacilityId] } } })
  await prisma.$disconnect()
})

describeDb('publicInventoryForFacility', () => {
  it('counts only units that are actually rentable', async () => {
    const inventory = await publicInventoryForFacility(slug)
    const type = inventory?.unitTypes.find((t) => t.unitTypeId === pricedTypeId)

    // Three available out of eight. occupied/reserved/overlocked/maintenance/
    // unrentable are all unsellable, and US-201 only permits a scarcity label
    // driven by a truthful count.
    expect(type?.availableCount).toBe(3)
  })

  it('omits unit types with no rate in effect', async () => {
    const inventory = await publicInventoryForFacility(slug)

    expect(inventory?.unitTypes.map((t) => t.unitTypeId)).toEqual([pricedTypeId])
    expect(inventory?.unitTypes.some((t) => t.unitTypeId === unpricedTypeId)).toBe(false)
  })

  it('publishes both rates so the site can show web price against street price', async () => {
    const inventory = await publicInventoryForFacility(slug)
    const type = inventory?.unitTypes[0]

    // US-201: "web rate + crossed-out in-store rate".
    expect(type?.webRateCents).toBe(14_900)
    expect(type?.streetRateCents).toBe(19_900)
    expect(type?.sqFt).toBe(100)
  })

  it('issues a quote token that verifies against the price it published', async () => {
    const inventory = await publicInventoryForFacility(slug)
    const type = inventory!.unitTypes[0]

    const verdict = verifyQuoteFor(type.quote.token, { facilityId, unitTypeId: pricedTypeId })
    expect(verdict.valid).toBe(true)
    if (!verdict.valid) return

    // FR-2.2: what checkout redeems must be what the page displayed.
    expect(verdict.quote.webRateCents).toBe(type.webRateCents)
    expect(verdict.quote.streetRateCents).toBe(type.streetRateCents)
  })

  it('hides a facility that is not active', async () => {
    expect(await publicInventoryForFacility(inactiveSlug)).toBeNull()
  })

  it('returns null for an unknown slug', async () => {
    expect(await publicInventoryForFacility(`no-such-facility-${suffix}`)).toBeNull()
  })

  // B-397. The "If you pay late / If you leave" block reads these terms, so the
  // page can only ever say what the engines run on. Two facilities with
  // different settings must publish different terms, matching their rows.
  it('publishes each facility’s own late fee, gate day, notice and protection prices', async () => {
    const otherSlug = `public-inv-terms-${suffix}`
    const otherId = await makeFacility('Terms Test', otherSlug, 'active')
    try {
      await prisma.unitType.create({
        data: { facilityId: otherId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 },
      }).then((type) =>
        prisma.unitTypeRate.create({
          data: { facilityId: otherId, unitTypeId: type.id, streetRateCents: 5_000, webRateCents: 4_000, effectiveFrom: past },
        }),
      )
      await prisma.facility.update({
        where: { id: otherId },
        data: { billingPolicy: 'first_of_month', moveOutNoticeDays: 0 },
      })
      await prisma.lateFeeRule.create({
        data: { facilityId: otherId, step: 1, daysPastDue: 7, amountCents: 3_500, basis: 'flat', effectiveFrom: past },
      })
      await prisma.protectionPlan.createMany({
        data: [
          { facilityId: otherId, tier: 'basic', name: 'Basic', coverageCents: 100_000, premiumCents: 900, effectiveFrom: past },
          { facilityId: otherId, tier: 'plus', name: 'Plus', coverageCents: 300_000, premiumCents: 1_900, effectiveFrom: past },
        ],
      })
      await prisma.delinquencyTimeline.create({
        data: {
          facilityId: otherId,
          version: 1,
          active: true,
          label: 'test',
          steps: [
            { dayOffset: 20, label: 'Overlock', automatedActions: ['suspend_access'], noticeTemplateKey: null, deliveryMethods: [], staffTaskLabel: null, requiredProofFields: [] },
          ],
        },
      })

      const other = (await publicInventoryForFacility(otherSlug))!.pricing.terms!
      expect(other.billingPolicy).toBe('first_of_month')
      expect(other.moveOutNoticeDays).toBe(0)
      expect(other.lateFeeSteps.map((step) => [step.daysPastDue, step.amountCents])).toEqual([[7, 3_500]])
      expect(other.suspendAccessDay).toBe(20)
      expect(other.protectionCents).toEqual({ min: 900, max: 1_900 })

      // The fixture facility configured none of it: different text, not shared defaults.
      const bare = (await publicInventoryForFacility(slug))!.pricing.terms!
      expect(bare.lateFeeSteps).toEqual([])
      expect(bare.suspendAccessDay).toBeNull()
      expect(bare.protectionCents).toBeNull()
      expect(bare.billingPolicy).toBe('anniversary')
    } finally {
      await prisma.unitTypeRate.deleteMany({ where: { facilityId: otherId } })
      await prisma.unitType.deleteMany({ where: { facilityId: otherId } })
      await prisma.facility.delete({ where: { id: otherId } })
    }
  })

  it('never exposes unit numbers', async () => {
    // US-201: listings are unit *types* with counts. Leaking unit numbers is
    // what lets two people race for the same door.
    const inventory = await publicInventoryForFacility(slug)
    expect(JSON.stringify(inventory)).not.toContain(`${suffix}-0`)
  })
})

describeDb('liveAvailableCount', () => {
  it('sees a change that the cached read would not', async () => {
    const before = await liveAvailableCount(pricedTypeId)
    const taken = await prisma.unit.findFirst({
      where: { unitTypeId: pricedTypeId, status: 'available' },
      orderBy: { number: 'asc' },
    })

    await prisma.unit.update({ where: { id: taken!.id }, data: { status: 'occupied' } })
    try {
      // FR-2.1: "checkout availability checks are always live." No TTL, no
      // memoisation — the next call reflects the write immediately.
      expect(await liveAvailableCount(pricedTypeId)).toBe(before - 1)
    } finally {
      await prisma.unit.update({ where: { id: taken!.id }, data: { status: 'available' } })
    }
  })
})

describeDb('inventory route', () => {
  const call = (facilitySlug: string) =>
    inventoryRoute(new Request(`http://localhost/api/public/facilities/${facilitySlug}/inventory`), {
      params: Promise.resolve({ slug: facilitySlug }),
    })

  it('bounds staleness at the FR-2.1 ceiling and no further', async () => {
    const response = await call(slug)
    expect(response.status).toBe(200)

    // Asserted as a whole string on purpose. A stale-while-revalidate directive
    // sneaking in here would let the edge serve past the 5-minute worst case
    // that FR-2.1 promises, and it would not show up in a numeric check.
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=0, s-maxage=${INVENTORY_CACHE_TTL_SECONDS}`,
    )
    expect(INVENTORY_CACHE_TTL_SECONDS).toBeLessThanOrEqual(300)
  })

  it('does not let a 404 stick in the CDN', async () => {
    const response = await call(`no-such-facility-${suffix}`)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
