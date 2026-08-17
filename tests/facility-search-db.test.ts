import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { searchFacilities, SEARCH_RADIUS_MILES } from '../apps/web/lib/geo/facility-search'
import { lowestAvailableWebRateByFacility } from '../apps/web/lib/inventory/public-inventory'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)

// The 78704 centroid — the same point `geocodeQuery('78704')` returns, so
// "distance from the search" is exactly measurable rather than approximately.
const AUSTIN = { latitude: 30.2428, longitude: -97.7658 }
/// ~10 miles north. One degree of latitude is ~69 miles.
const TEN_MILES_NORTH = { latitude: AUSTIN.latitude + 10 / 69, longitude: AUSTIN.longitude }
/// Central Montana — far from every facility, demo data included.
const MIDDLE_OF_NOWHERE = { latitude: 47.0, longitude: -109.5 }

const ids: Record<string, string> = {}
const created: string[] = []

async function makeFacility(
  key: string,
  options: {
    status?: 'active' | 'inactive'
    latitude?: number | null
    longitude?: number | null
  } = {},
) {
  const facility = await prisma.facility.create({
    data: {
      name: `Search ${key} ${suffix}`,
      slug: `search-${key}-${suffix}`,
      status: options.status ?? 'active',
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
      amenities: ['Gated access'],
      latitude: options.latitude === undefined ? AUSTIN.latitude : options.latitude,
      longitude: options.longitude === undefined ? AUSTIN.longitude : options.longitude,
    },
  })
  ids[key] = facility.id
  created.push(facility.id)
  return facility.id
}

/// Adds a priced unit type with `availableCount` rentable units.
async function addPricedType(
  facilityId: string,
  name: string,
  webRateCents: number,
  availableCount: number,
) {
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
  if (availableCount > 0) {
    await prisma.unit.createMany({
      data: Array.from({ length: availableCount }, (_, i) => ({
        facilityId,
        unitTypeId: unitType.id,
        number: `${name}-${suffix}-${i}`,
        status: 'available' as const,
      })),
    })
  }
  return unitType.id
}

beforeAll(async () => {
  if (!hasDatabase) return

  await makeFacility('near')
  await makeFacility('mid', { ...TEN_MILES_NORTH })
  // ~185 miles away, well beyond the radius.
  await makeFacility('far', { latitude: 32.7904, longitude: -96.8044 })
  await makeFacility('hidden', { status: 'inactive' })
  await makeFacility('nocoords', { latitude: null, longitude: null })

  // 'near' is cheapest at $99 among types that actually have a unit free.
  await addPricedType(ids.near, 'ten', 12_900, 2)
  await addPricedType(ids.near, 'five', 9_900, 1)
  // A cheaper type with nothing available must not set the "from" price.
  await addPricedType(ids.near, 'sold-out', 4_900, 0)
  // 'mid' is priced but has nothing rentable at all.
  await addPricedType(ids.mid, 'none-free', 8_900, 0)
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.unit.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.unitType.deleteMany({ where: { facilityId: { in: created } } })
  await prisma.facility.deleteMany({ where: { id: { in: created } } })
  await prisma.$disconnect()
})

/// Assertions are relative to our own fixtures, never absolute counts — demo
/// facilities are active in this database too and legitimately show up.
const idsIn = (results: { id: string }[]) => results.map((r) => r.id)

describeDb('searchFacilities', () => {
  it('ranks by distance, nearest first', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    const distances = outcome.results.map((r) => r.distanceMiles)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))

    const found = idsIn(outcome.results)
    expect(found.indexOf(ids.near)).toBeLessThan(found.indexOf(ids.mid))
  })

  it('measures distance against the geocoded point', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    const near = outcome.results.find((r) => r.id === ids.near)!
    const mid = outcome.results.find((r) => r.id === ids.mid)!
    expect(near.distanceMiles).toBeCloseTo(0, 2)
    expect(mid.distanceMiles).toBeCloseTo(10, 0)
  })

  // B-107. The map plots the ranked results and nothing else. If the
  // coordinates stopped coming through, the map would silently plot nothing —
  // a facility the list names and the map omits is the one failure mode that
  // looks like a styling problem.
  it('carries the coordinates it ranked by, so the map plots the same rows', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    const near = outcome.results.find((r) => r.id === ids.near)!
    expect(near.latitude).toBeCloseTo(AUSTIN.latitude, 4)
    expect(near.longitude).toBeCloseTo(AUSTIN.longitude, 4)
    expect(outcome.results.every((r) => Number.isFinite(r.latitude))).toBe(true)
    expect(outcome.results.every((r) => Number.isFinite(r.longitude))).toBe(true)
  })

  it('excludes facilities beyond the radius from a normal result', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    expect(idsIn(outcome.results)).not.toContain(ids.far)
    expect(outcome.results.every((r) => r.distanceMiles <= SEARCH_RADIUS_MILES)).toBe(true)
  })

  it('never advertises an inactive facility or one without coordinates', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    const found = idsIn(outcome.results)
    expect(found).not.toContain(ids.hidden)
    // A facility with no coordinates cannot be ranked; excluded rather than
    // sorted to an arbitrary position in a distance-ordered list.
    expect(found).not.toContain(ids.nocoords)
  })

  it('offers the nearest facilities instead of a dead end when nothing is close', async () => {
    // US-101: "Zero-results state suggests the nearest facilities beyond the
    // search radius with distances, never a dead end."
    const outcome = await searchFacilities({ point: MIDDLE_OF_NOWHERE })
    expect(outcome.status).toBe('none_nearby')
    if (outcome.status !== 'none_nearby') return

    expect(outcome.results.length).toBeGreaterThan(0)
    expect(outcome.results.every((r) => r.distanceMiles > SEARCH_RADIUS_MILES)).toBe(true)
    const distances = outcome.results.map((r) => r.distanceMiles)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  it('accepts a point directly, so geolocation needs no geocoding', async () => {
    const outcome = await searchFacilities({ point: AUSTIN })
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(idsIn(outcome.results)).toContain(ids.near)
  })

  it('separates "not a place" from "nothing nearby"', async () => {
    // The two need different copy: retype vs widen expectations.
    expect((await searchFacilities({ q: 'zzzzz not a place' })).status).toBe('not_found')
    expect((await searchFacilities({ q: '   ' })).status).toBe('empty')
    expect((await searchFacilities({})).status).toBe('empty')
  })

  it('echoes a cleaned-up label rather than the raw input', async () => {
    const outcome = await searchFacilities({ q: '  austin,   tx  ' })
    if (outcome.status !== 'ok') throw new Error('expected results')
    expect(outcome.label).toBe('Austin, TX')
  })
})

describeDb('units from $X/mo', () => {
  it('is the cheapest rate that a renter could actually take today', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    const near = outcome.results.find((r) => r.id === ids.near)!
    // $49 exists but is sold out; $99 is the cheapest with a unit free.
    // Advertising the sold-out price would be a truthfulness bug, not a
    // rounding one.
    expect(near.fromWebRateCents).toBe(9_900)
  })

  it('is null, not zero, when nothing is rentable', async () => {
    const outcome = await searchFacilities({ q: '78704' })
    if (outcome.status !== 'ok') throw new Error('expected results')

    const mid = outcome.results.find((r) => r.id === ids.mid)!
    expect(mid.fromWebRateCents).toBeNull()
  })

  it('answers for many facilities without a query per facility', async () => {
    const lowest = await lowestAvailableWebRateByFacility([ids.near, ids.mid, ids.far])
    expect(lowest.get(ids.near)).toBe(9_900)
    // Absent rather than present-and-zero, so a caller cannot render "$0".
    expect(lowest.has(ids.mid)).toBe(false)
    expect(lowest.has(ids.far)).toBe(false)
  })

  it('returns an empty map for no facilities without touching the database', async () => {
    expect(await lowestAvailableWebRateByFacility([])).toEqual(new Map())
  })
})
