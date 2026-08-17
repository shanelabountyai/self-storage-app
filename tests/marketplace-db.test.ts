import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { marketplaceFeed } from '../apps/web/lib/marketing/marketplace-feed'
import { captureMarketplaceLead, partnerForKey } from '../apps/web/lib/marketing/marketplace-leads'
import { publicInventoryForFacility } from '../apps/web/lib/inventory/public-inventory'

// B-082 part 1. The marketplace integration surface: availability out, lead
// attribution in.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `mkt-${suffix}`

let facilityId = ''
let unitTypeId = ''

describeDb('marketplace integration', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Marketplace Test ${suffix}`,
        slug,
        status: 'active',
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        latitude: 30.2428,
        longitude: -97.7658,
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
    await prisma.unit.createMany({
      data: [
        { facilityId, unitTypeId, number: `M-1-${suffix}`, status: 'available' },
        { facilityId, unitTypeId, number: `M-2-${suffix}`, status: 'available' },
        { facilityId, unitTypeId, number: `M-3-${suffix}`, status: 'occupied' },
      ],
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.consent.deleteMany({ where: { lead: { facilityId } } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    delete process.env.MARKETPLACE_LEAD_KEYS
    await prisma.$disconnect()
  })

  describe('availability feed', () => {
    // The property the whole design rests on. Rate parity is not a job that
    // compares two numbers — there is one number, because the feed and the
    // website call the same function. This test is what keeps that true: split
    // them, and it fails.
    it('publishes exactly the rates and counts the website publishes', async () => {
      const feed = await marketplaceFeed()
      const site = await publicInventoryForFacility(slug)
      const row = feed.facilities.find((facility) => facility.slug === slug)

      expect(row).toBeDefined()
      expect(site).not.toBeNull()
      const feedType = row!.unitTypes.find((unitType) => unitType.id === unitTypeId)!
      const siteType = site!.unitTypes.find((unitType) => unitType.unitTypeId === unitTypeId)!

      expect(feedType.webRateCents).toBe(siteType.webRateCents)
      expect(feedType.streetRateCents).toBe(siteType.streetRateCents)
      expect(feedType.availableCount).toBe(siteType.availableCount)
    })

    it('counts only what is actually rentable', async () => {
      // Two available, one occupied. A feed that counted the occupied unit
      // advertises a unit somebody lives in.
      const feed = await marketplaceFeed()
      const row = feed.facilities.find((facility) => facility.slug === slug)!
      expect(row.unitTypes.find((unitType) => unitType.id === unitTypeId)!.availableCount).toBe(2)
    })

    it('gives an absolute URL, because a feed is read off-site', async () => {
      const feed = await marketplaceFeed()
      const row = feed.facilities.find((facility) => facility.slug === slug)!
      expect(row.url).toMatch(/^https?:\/\/.+\/storage\/tx\/austin\//)
    })

    it('drops a facility we have stopped advertising', async () => {
      await prisma.facility.update({ where: { id: facilityId }, data: { status: 'inactive' } })
      const feed = await marketplaceFeed()
      expect(feed.facilities.some((facility) => facility.slug === slug)).toBe(false)
      await prisma.facility.update({ where: { id: facilityId }, data: { status: 'active' } })
    })
  })

  describe('inbound lead attribution', () => {
    it('authenticates by key and never by anything the caller can claim', () => {
      process.env.MARKETPLACE_LEAD_KEYS = JSON.stringify({
        sparefoot: 'key-sparefoot',
        storable: 'key-storable',
      })
      expect(partnerForKey('key-sparefoot')).toBe('sparefoot')
      expect(partnerForKey('key-storable')).toBe('storable')
      expect(partnerForKey('key-wrong')).toBeNull()
      expect(partnerForKey('')).toBeNull()
      expect(partnerForKey(null)).toBeNull()
    })

    it('refuses everyone when the key list is missing or malformed', () => {
      // The failure that matters: a malformed value must not degrade into an
      // empty key that every caller matches.
      delete process.env.MARKETPLACE_LEAD_KEYS
      expect(partnerForKey('anything')).toBeNull()
      process.env.MARKETPLACE_LEAD_KEYS = 'not json'
      expect(partnerForKey('anything')).toBeNull()
      process.env.MARKETPLACE_LEAD_KEYS = JSON.stringify({ partner: '' })
      expect(partnerForKey('')).toBeNull()
    })

    it('files an inbound lead as aggregator, named by the partner that sent it', async () => {
      process.env.MARKETPLACE_LEAD_KEYS = JSON.stringify({ sparefoot: 'key-sparefoot' })
      const result = await captureMarketplaceLead('sparefoot', {
        facilitySlug: slug,
        name: 'Ada Renter',
        email: `mkt-lead-${suffix}@example.com`,
        phone: '512-555-0148',
        unitTypeId,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } })
      // The whole point of the inbound half: this lead must never look like an
      // ordinary web form, or the move-in it becomes is credited to organic.
      expect(lead.channel).toBe('aggregator')
      expect(lead.firstTouchSource).toBe('sparefoot')
      expect(lead.lastTouchMedium).toBe('marketplace')
      expect(lead.facilityId).toBe(facilityId)
    })

    it('does not apply the public form’s per-IP rate limit to a partner', async () => {
      // Every lead from a partner arrives from one address. With the form's
      // limit applied, the sixth genuine lead in ten minutes would be rejected
      // — silently losing rentals from the channel that charges most for them.
      process.env.MARKETPLACE_LEAD_KEYS = JSON.stringify({ sparefoot: 'key-sparefoot' })
      for (let i = 0; i < 7; i += 1) {
        const result = await captureMarketplaceLead('sparefoot', {
          facilitySlug: slug,
          name: `Burst ${i}`,
          email: `burst-${i}-${suffix}@example.com`,
        })
        expect(result.ok, `lead ${i} should be accepted`).toBe(true)
      }
    })

    it('refuses a lead for a facility we do not advertise', async () => {
      const missing = await captureMarketplaceLead('sparefoot', {
        facilitySlug: `no-such-${suffix}`,
        name: 'Ada Renter',
        email: `nope-${suffix}@example.com`,
      })
      expect(missing.ok).toBe(false)
      if (missing.ok) throw new Error('unreachable')
      // 404 rather than a quiet 200: the partner has to stop sending these, and
      // a success response never tells them that.
      expect(missing.status).toBe(404)
      expect(missing.error).toBe('unknown_facility')
    })

    it('rejects an unparseable move-in date rather than dropping it', async () => {
      const bad = await captureMarketplaceLead('sparefoot', {
        facilitySlug: slug,
        name: 'Ada Renter',
        email: `baddate-${suffix}@example.com`,
        moveInDate: 'next tuesday',
      })
      expect(bad.ok).toBe(false)
      if (bad.ok) throw new Error('unreachable')
      expect(bad.error).toBe('invalid_move_in_date')
    })
  })
})
