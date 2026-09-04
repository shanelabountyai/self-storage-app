import { prisma } from '@storage/db'
import {
  lowestAvailableWebRateByFacility,
  type FacilityFromRate,
} from '@/lib/inventory/public-inventory'
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
  /// Kept on the result rather than dropped after ranking: B-107's map plots
  /// the same rows the list renders, and re-reading coordinates for a second
  /// consumer is how a map and a list start disagreeing about where a facility
  /// is. `rankFacilities` already excludes facilities without them.
  latitude: number
  longitude: number
  distanceMiles: number
  /// Lowest current web rate among unit types with a unit available.
  /// Null when nothing is rentable — never 0, which would read as free.
  fromWebRateCents: number | null
  /// The size that `fromWebRateCents` belongs to, and what else is free.
  /// Null on exactly the same facilities as the rate: one absent and the other
  /// present would let a card quote a size at no price or a price at no size,
  /// which is the defect B-242 is about.
  from: FacilityFromRate | null
  /// The facility's first gallery photo, or null when it has none. B-118's rule
  /// applies here too: no photo means no frame, never a placeholder.
  photo: { url: string } | null
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

  const ids = facilities.map((f) => f.id)
  const [fromRates, photos] = await Promise.all([
    lowestAvailableWebRateByFacility(ids),
    // One row per facility rather than the whole gallery: `distinct` on a
    // sorted read is Postgres's DISTINCT ON, so this stays a single query
    // however many facilities rank. Only the url is selected — the thumbnail is
    // decorative beside a link that already names the facility, so it renders
    // `alt=""` (WCAG 1.1.1) and the stored alt text would be dead weight.
    prisma.facilityPhoto.findMany({
      where: { facilityId: { in: ids } },
      orderBy: [{ facilityId: 'asc' }, { position: 'asc' }],
      distinct: ['facilityId'],
      select: { facilityId: true, url: true },
    }),
  ])
  const photoByFacility = new Map(photos.map((photo) => [photo.facilityId, { url: photo.url }]))

  return facilities
    .map(({ latitude, longitude, ...facility }) => {
      const from = fromRates.get(facility.id) ?? null
      return {
        ...facility,
        latitude: latitude!,
        longitude: longitude!,
        distanceMiles: distanceMiles(point, { latitude: latitude!, longitude: longitude! }),
        fromWebRateCents: from?.webRateCents ?? null,
        from,
        photo: photoByFacility.get(facility.id) ?? null,
      }
    })
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
