import { unstable_cache } from 'next/cache'
import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
import {
  INVENTORY_CACHE_TTL_SECONDS,
  lowestAvailableWebRateByFacility,
  lowestAvailableWebRateBySize,
  type FacilityFromRate,
  type SizeFromRate,
} from '@/lib/inventory/public-inventory'
import { distanceMiles, type GeoPoint } from '@/lib/geo/geocode'

// B-365 (D-147: take the voice, derive the facts). Every number the home page
// states comes from here, read from the active facilities, so the page cannot
// promise a price, a hold window or a plan the registry does not have.

export type HomeFacility = {
  id: string
  slug: string
  name: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  phone: string | null
  /// Null when the facility has no coordinates on file. B-366's locations
  /// page uses these to sort nearest-first; the home page ignores them.
  latitude: number | null
  longitude: number | null
  from: FacilityFromRate | null
}

export type HomeFacts = {
  facilities: HomeFacility[]
  /// Up to four sizes, the ones with the most units free, smallest first.
  sizes: SizeFromRate[]
  /// The cheapest protection plan on sale anywhere today; null when none is.
  protectionFromCents: number | null
  /// The free-hold window, only when every active facility uses the same
  /// one. A single number stated site-wide would be wrong for the others.
  holdDays: number | null
}

async function homeFacts(): Promise<HomeFacts> {
  const now = new Date()
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      slug: true,
      name: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      phone: true,
      latitude: true,
      longitude: true,
      reservationHoldGraceDays: true,
    },
    orderBy: [{ state: 'asc' }, { city: 'asc' }, { name: 'asc' }],
  })
  const ids = facilities.map((f) => f.id)

  const [fromRates, sizes, plans] = await Promise.all([
    lowestAvailableWebRateByFacility(ids, now),
    lowestAvailableWebRateBySize(ids, now),
    prisma.protectionPlan.findMany({ where: { facilityId: { in: ids } } }),
  ])

  const onSale = effectiveByGroup(plans, now, (p) => `${p.facilityId}:${p.tier}`)
  const premiums = [...onSale.values()].map((p) => p.premiumCents)
  const holdWindows = new Set(facilities.map((f) => f.reservationHoldGraceDays))

  return {
    facilities: facilities.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      addressLine1: f.addressLine1,
      city: f.city,
      state: f.state,
      postalCode: f.postalCode,
      phone: f.phone,
      latitude: f.latitude,
      longitude: f.longitude,
      from: fromRates.get(f.id) ?? null,
    })),
    sizes: [...sizes]
      .sort((a, b) => b.availableUnits - a.availableUnits)
      .slice(0, 4)
      .sort((a, b) => a.widthFt * a.lengthFt - b.widthFt * b.lengthFt),
    protectionFromCents: premiums.length > 0 ? Math.min(...premiums) : null,
    holdDays: holdWindows.size === 1 ? [...holdWindows][0]! : null,
  }
}

/// FR-2.1's five-minute display ceiling, the same one the facility page's
/// inventory read uses. The root layout reads a cookie, so the page itself is
/// rendered per request and this is what keeps it off the database.
export const cachedHomeFacts = unstable_cache(homeFacts, ['home-facts'], {
  revalidate: INVENTORY_CACHE_TTL_SECONDS,
  tags: ['public-inventory'],
})

/// B-366. The locations page's nearest-first cut, pulled out as a pure
/// function so the sort has a unit test rather than only a rendered page.
/// Without `point` (nobody has shared their location) the input order is kept
/// as-is — `cachedHomeFacts` already returns state/city/name order. With one,
/// a facility missing coordinates sorts after every one that has them, rather
/// than at a fabricated distance of zero.
export function sortByDistance(
  facilities: readonly HomeFacility[],
  point: GeoPoint | undefined,
): { facility: HomeFacility; distanceMiles?: number }[] {
  if (!point) return facilities.map((facility) => ({ facility }))

  return facilities
    .map((facility) => ({
      facility,
      distanceMiles:
        facility.latitude !== null && facility.longitude !== null
          ? distanceMiles(point, { latitude: facility.latitude, longitude: facility.longitude })
          : undefined,
    }))
    .sort((a, b) => {
      if ((a.distanceMiles === undefined) !== (b.distanceMiles === undefined)) {
        return a.distanceMiles === undefined ? 1 : -1
      }
      if (a.distanceMiles !== undefined && b.distanceMiles !== undefined) {
        return a.distanceMiles - b.distanceMiles
      }
      return 0
    })
}
