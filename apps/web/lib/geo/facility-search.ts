import { prisma } from '@storage/db'
import { lowestAvailableWebRateByFacility } from '@/lib/inventory/public-inventory'
import { distanceMiles, geocodeQuery, type GeoPoint } from './geocode'

// PRD 01 US-101 / FR-1.1. Radius search over facility coordinates, ranked by
// distance from the geocoded query point.
//
// Facility data comes from the admin registry and nowhere else (FR-1.2) — this
// module reads it, and there is deliberately no website-side copy of a name,
// address, or coordinate.

/// US-101 has no stated radius. 25 miles is the distance a self-storage renter
/// will plausibly drive with a car full of boxes; beyond that the "nearest
/// facilities beyond the radius" state is the more honest answer than a result
/// list implying we are convenient.
export const SEARCH_RADIUS_MILES = 25

/// How many out-of-radius facilities to offer when nothing is close. Enough to
/// be useful, few enough that the page still reads as "nothing nearby".
const BEYOND_RADIUS_LIMIT = 3

export type FacilityResult = {
  id: string
  slug: string
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  phone: string | null
  amenities: string[]
  distanceMiles: number
  /// Lowest current web rate among unit types with a unit available.
  /// Null when nothing is rentable — never 0, which would read as free.
  fromWebRateCents: number | null
}

export type SearchOutcome =
  | { status: 'ok'; query: string; label: string; point: GeoPoint; results: FacilityResult[] }
  /// Geocoded fine, but no facility is within the radius. `results` holds the
  /// nearest ones anyway — US-101 forbids a dead end here.
  | { status: 'none_nearby'; query: string; label: string; point: GeoPoint; results: FacilityResult[] }
  /// The query is not a place we can resolve. Distinct from `none_nearby`
  /// because the fix is different: retype vs widen expectations.
  | { status: 'not_found'; query: string }
  | { status: 'empty' }

type SearchInput = { q?: string; point?: GeoPoint }

async function rankFacilities(point: GeoPoint): Promise<FacilityResult[]> {
  const facilities = await prisma.facility.findMany({
    // Only active sites are advertised, matching the public inventory feed.
    // Facilities without coordinates cannot be ranked and are excluded rather
    // than sorted to an arbitrary position.
    where: { status: 'active', latitude: { not: null }, longitude: { not: null } },
    select: {
      id: true,
      slug: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      phone: true,
      amenities: true,
      latitude: true,
      longitude: true,
    },
  })

  const fromRates = await lowestAvailableWebRateByFacility(facilities.map((f) => f.id))

  return facilities
    .map(({ latitude, longitude, ...facility }) => ({
      ...facility,
      distanceMiles: distanceMiles(point, { latitude: latitude!, longitude: longitude! }),
      fromWebRateCents: fromRates.get(facility.id) ?? null,
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
}

export async function searchFacilities(input: SearchInput): Promise<SearchOutcome> {
  // "Use my location" hands over a point directly, so it skips geocoding
  // entirely (US-101: geolocation is offered, never required).
  if (input.point) {
    const ranked = await rankFacilities(input.point)
    return partition(ranked, 'Your location', '', input.point)
  }

  const query = input.q?.trim() ?? ''
  if (query.length === 0) return { status: 'empty' }

  const geocoded = geocodeQuery(query)
  if (!geocoded) return { status: 'not_found', query }

  const ranked = await rankFacilities(geocoded)
  return partition(ranked, geocoded.label, query, geocoded)
}

function partition(
  ranked: FacilityResult[],
  label: string,
  query: string,
  point: GeoPoint,
): SearchOutcome {
  const within = ranked.filter((f) => f.distanceMiles <= SEARCH_RADIUS_MILES)
  if (within.length > 0) return { status: 'ok', query, label, point, results: within }

  return {
    status: 'none_nearby',
    query,
    label,
    point,
    results: ranked.slice(0, BEYOND_RADIUS_LIMIT),
  }
}
