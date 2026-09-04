import { cache } from 'react'
import { prisma } from '@storage/db'
import { citySlug } from '@storage/core/marketing'
import type { AggregateRating } from '@storage/core/reviews'
import { lowestAvailableWebRateByFacility } from '@/lib/inventory/public-inventory'
import { visibleRatingsByFacility } from '@/lib/reviews/public'

// PRD 04 §3.2 US-4 AC1 (B-082 part 2). What a city page lists.
//
// "City pages list all facilities in that city with distance, starting price,
// and rating; indexable only when ≥1 facility exists in the city."
//
// Reads the same facility registry the search page and the sitemap read
// (FR-1.2) — no second copy of a name or an address anywhere in here. B-128's
// `City` row is deliberately not part of that: it carries authored prose and
// nothing else, so it can never disagree with the facilities about where a
// city is or how it is spelled. `state` and `city` arrive as URL segments, so
// both are treated as untrusted strings and matched rather than interpolated.

export type CityFacility = {
  id: string
  slug: string
  name: string
  addressLine1: string
  addressLine2: string | null
  /// The stored spelling, not the slug — the page prints it and builds the
  /// canonical URL from it, so a request for `/storage/tx/fort-worth` renders
  /// "Fort Worth".
  city: string
  state: string
  postalCode: string
  amenities: string[]
  /// Lowest current web rate among unit types with a unit available. Null when
  /// nothing is rentable here — never 0, which would read as free.
  fromWebRateCents: number | null
  /// Null when nothing visible has been reviewed. Display only; a city page
  /// marks up no ratings (D-33).
  rating: AggregateRating | null
}

/// Every active facility in one city, cheapest-first.
///
/// Cheapest first because that is the question a prospect on a city page is
/// asking — they have already chosen the city, so the ordering that helps is
/// price. Facilities with nothing rentable sort last rather than being hidden:
/// a full site is still a site to call, and dropping it would tell somebody the
/// city has fewer locations than it does.
/// Cached per request (`react.cache`), because `generateMetadata` and the page
/// body both need the same list and Next.js calls them separately — the same
/// reason `publicFacilityBySlug` is wrapped.
export const facilitiesInCity = cache(async function facilitiesInCity(
  state: string,
  city: string,
): Promise<CityFacility[]> {
  const wanted = citySlug(city)
  if (!wanted || !state.trim()) return []

  // Matched on the slugified city rather than in SQL: the database stores
  // "Fort Worth" and the URL carries "fort-worth", and the only thing that
  // knows how to turn one into the other is `citySlug` — the same function the
  // sitemap, the redirect map and the facility page use. Doing the comparison
  // here rather than with an `ILIKE` guess is what keeps all four in agreement.
  const facilities = await prisma.facility.findMany({
    where: { status: 'active', state: { equals: state, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      amenities: true,
    },
  })

  const inCity = facilities.filter((facility) => citySlug(facility.city) === wanted)
  if (inCity.length === 0) return []

  const ids = inCity.map((facility) => facility.id)
  const [fromRates, ratings] = await Promise.all([
    lowestAvailableWebRateByFacility(ids),
    visibleRatingsByFacility(ids),
  ])

  return inCity
    .map((facility) => ({
      ...facility,
      fromWebRateCents: fromRates.get(facility.id)?.webRateCents ?? null,
      rating: ratings.get(facility.id) ?? null,
    }))
    .sort((a, b) => {
      // Nothing-rentable sorts last, then by price, then by name so the order
      // is stable across renders rather than whatever Postgres returned.
      if ((a.fromWebRateCents === null) !== (b.fromWebRateCents === null)) {
        return a.fromWebRateCents === null ? 1 : -1
      }
      if (a.fromWebRateCents !== null && b.fromWebRateCents !== null && a.fromWebRateCents !== b.fromWebRateCents) {
        return a.fromWebRateCents - b.fromWebRateCents
      }
      return a.name.localeCompare(b.name)
    })
})

/// The authored intro for a city, or null when nobody has written one — which
/// is every city until somebody does, and is why the caller falls back to the
/// generated intro rather than treating this as required (B-128, D-62).
///
/// Cached per request for the same reason `facilitiesInCity` is: the page body
/// and `generateMetadata` are separate calls into the same render.
export const authoredCityIntro = cache(async function authoredCityIntro(
  state: string,
  city: string,
): Promise<string | null> {
  const slug = citySlug(city)
  if (!slug || !state.trim()) return null
  const row = await prisma.city.findFirst({
    // The state is matched case-insensitively because it reaches this function
    // from a URL segment as well as from a facility record, and those two
    // disagree about casing by construction.
    where: { slug, state: { equals: state, mode: 'insensitive' } },
    select: { intro: true },
  })
  return row?.intro?.trim() ? row.intro : null
})

/// Every city that has at least one active facility, as `{state, city}` pairs.
///
/// The sitemap's list, and the source of "indexable only when ≥1 facility
/// exists" — a city is on this list precisely because a facility puts it there,
/// so a city page and its sitemap entry cannot disagree about whether it should
/// exist.
export async function citiesWithFacilities(): Promise<
  { state: string; city: string; lastModified: Date }[]
> {
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { city: true, state: true, updatedAt: true },
  })

  const cities = new Map<string, { state: string; city: string; lastModified: Date }>()
  for (const facility of facilities) {
    const key = `${facility.state.toLowerCase()}/${citySlug(facility.city)}`
    const existing = cities.get(key)
    // `lastmod` is the newest change among the facilities the page lists —
    // the page's content is those facilities, so that is genuinely when it last
    // changed.
    if (!existing || existing.lastModified < facility.updatedAt) {
      cities.set(key, { state: facility.state, city: facility.city, lastModified: facility.updatedAt })
    }
  }
  return [...cities.values()].sort((a, b) =>
    `${a.state}${a.city}`.localeCompare(`${b.state}${b.city}`),
  )
}
