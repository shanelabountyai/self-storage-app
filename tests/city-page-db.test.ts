import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { citiesWithFacilities, facilitiesInCity } from '../apps/web/lib/facility/city-facilities'
import { visibleRatingsByFacility } from '../apps/web/lib/reviews/public'

// PRD 04 §3.2 US-4 AC1 (B-082 part 2). What the city page reads, against real
// rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
/// A city nothing else in the suite or the demo seed uses, so the assertions
/// can be absolute counts rather than "contains" — every other suite's Austin
/// fixtures would otherwise show up in these results.
const CITY = `Fort Testing ${suffix}`
const CITY_SLUG = `fort-testing-${suffix}`

const ids: Record<string, string> = {}
const created: string[] = []

async function makeFacility(
  key: string,
  options: { city?: string; state?: string; status?: 'active' | 'inactive' } = {},
) {
  const facility = await prisma.facility.create({
    data: {
      name: `City ${key} ${suffix}`,
      slug: `city-${key}-${suffix}`,
      status: options.status ?? 'active',
      addressLine1: '1 Storage Way',
      city: options.city ?? CITY,
      state: options.state ?? 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
      amenities: key === 'cheap' ? ['Climate controlled', 'Gated access'] : ['gated access'],
    },
  })
  ids[key] = facility.id
  created.push(facility.id)
  return facility.id
}

async function addPricedType(facilityId: string, name: string, webRateCents: number, available: number) {
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `${name} ${suffix}`, widthFt: 10, lengthFt: 10 },
  })
  await prisma.unitTypeRate.create({
    data: {
      facilityId,
      unitTypeId: unitType.id,
      streetRateCents: webRateCents + 2_000,
      webRateCents,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    },
  })
  if (available > 0) {
    await prisma.unit.createMany({
      data: Array.from({ length: available }, (_, index) => ({
        facilityId,
        unitTypeId: unitType.id,
        number: `${name}-${suffix}-${index}`,
        status: 'available' as const,
      })),
    })
  }
}

async function addReview(facilityId: string, rating: number, visible = true) {
  await prisma.review.create({
    data: {
      facilityId,
      rating,
      text: 'Clean and easy to get into.',
      reviewerDisplayName: 'Ada R.',
      reviewDate: new Date('2026-01-15'),
      visible,
    },
  })
}

beforeAll(async () => {
  if (!hasDatabase) return

  await makeFacility('cheap')
  // Same city, spelled with different casing and spacing in the record — the
  // slug is what has to match, not the string.
  await makeFacility('pricey', { city: CITY.toUpperCase() })
  await makeFacility('full')
  await makeFacility('hidden', { status: 'inactive' })
  await makeFacility('elsewhere', { city: `Somewhere Else ${suffix}` })

  await addPricedType(ids.cheap, 'small', 5_900, 3)
  await addPricedType(ids.pricey, 'large', 22_900, 2)
  // Priced, but nothing rentable — the "from" price must stay null rather than
  // quoting a rate nobody can take.
  await addPricedType(ids.full, 'none', 8_900, 0)

  await addReview(ids.cheap, 5)
  await addReview(ids.cheap, 4)
  // A hidden review is as absent from the average as it is from the list.
  await addReview(ids.cheap, 1, false)
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.review.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.unit.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.unitType.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.facility.deleteMany({ where: { id: { in: created } } })
  await prisma.$disconnect()
})

describeDb('facilitiesInCity', () => {
  it('lists every active facility in the city, whatever the stored casing', async () => {
    const results = await facilitiesInCity('tx', CITY_SLUG)
    expect(results.map((facility) => facility.id).sort()).toEqual(
      [ids.cheap, ids.pricey, ids.full].sort(),
    )
  })

  it('matches the state case-insensitively, because the URL is lower-case', async () => {
    const lower = await facilitiesInCity('tx', CITY_SLUG)
    const upper = await facilitiesInCity('TX', CITY_SLUG)
    expect(upper.map((f) => f.id)).toEqual(lower.map((f) => f.id))
  })

  it('excludes inactive facilities and other cities', async () => {
    const results = await facilitiesInCity('tx', CITY_SLUG)
    const found = results.map((facility) => facility.id)
    expect(found).not.toContain(ids.hidden)
    expect(found).not.toContain(ids.elsewhere)
  })

  it('orders cheapest first with nothing-rentable last', async () => {
    const results = await facilitiesInCity('tx', CITY_SLUG)
    expect(results.map((facility) => facility.id)).toEqual([ids.cheap, ids.pricey, ids.full])
    expect(results[0].fromWebRateCents).toBe(5_900)
    expect(results[1].fromWebRateCents).toBe(22_900)
    // Null, never 0 — the page renders "no units available" from this, and a
    // zero would render as a price.
    expect(results[2].fromWebRateCents).toBeNull()
  })

  it('carries the stored city spelling, not the slug', async () => {
    // The page prints this and builds its canonical URL from it, so a slug
    // leaking through here would render "fort-testing" as the city name.
    const results = await facilitiesInCity('tx', CITY_SLUG)
    expect(results[0].city).toBe(CITY)
  })

  it('attaches the visible-review average per facility', async () => {
    const results = await facilitiesInCity('tx', CITY_SLUG)
    const cheap = results.find((facility) => facility.id === ids.cheap)
    // 5 and 4 visible; the hidden 1 would drag this to 3.3 if it counted.
    expect(cheap?.rating).toEqual({ ratingValue: 4.5, reviewCount: 2 })
    expect(results.find((facility) => facility.id === ids.pricey)?.rating).toBeNull()
  })

  it('returns nothing for a city with no facilities, which is what makes the page 404', async () => {
    expect(await facilitiesInCity('tx', `nowhere-${suffix}`)).toEqual([])
    // A city that exists in another state is not this city.
    expect(await facilitiesInCity('ca', CITY_SLUG)).toEqual([])
    expect(await facilitiesInCity('tx', '')).toEqual([])
  })
})

describeDb('visibleRatingsByFacility', () => {
  it('omits a facility with no visible reviews rather than returning a zero', async () => {
    const ratings = await visibleRatingsByFacility([ids.cheap, ids.pricey])
    expect(ratings.get(ids.cheap)).toEqual({ ratingValue: 4.5, reviewCount: 2 })
    expect(ratings.has(ids.pricey)).toBe(false)
  })

  it('is empty for an empty list without hitting the database', async () => {
    expect(await visibleRatingsByFacility([])).toEqual(new Map())
  })
})

describeDb('citiesWithFacilities', () => {
  it('lists a city exactly once however many facilities it has', async () => {
    const cities = await citiesWithFacilities()
    const mine = cities.filter((city) => city.city.toLowerCase() === CITY.toLowerCase())
    // Three active facilities, two spellings of the city, one entry — this is
    // what stops the sitemap listing the same page twice.
    expect(mine).toHaveLength(1)
  })

  it('never lists a city whose only facilities are inactive', async () => {
    const orphan = await prisma.facility.create({
      data: {
        name: `Retired ${suffix}`,
        slug: `retired-${suffix}`,
        status: 'inactive',
        addressLine1: '1 Storage Way',
        city: `Ghost Town ${suffix}`,
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    created.push(orphan.id)

    const cities = await citiesWithFacilities()
    expect(cities.some((city) => city.city.includes('Ghost Town'))).toBe(false)
    // The sitemap would otherwise advertise a URL the page answers 404 to.
    expect(await facilitiesInCity('tx', `ghost-town-${suffix}`)).toEqual([])
  })
})
