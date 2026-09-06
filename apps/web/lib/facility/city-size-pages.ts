import { cache } from 'react'
import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { citySizeIntro, citySlug, dimensionKey, sizeIndexGate } from '@storage/core/marketing'
import { LOCALES } from '@/lib/i18n'

// PRD 00 §6 Phase 3 (B-089). What sizes a city actually has, and at what price.
//
// **One query set for the WHOLE city, not for one size.** That shape is not an
// optimisation, it is what makes the duplicate gate affordable: the page has to
// score its own intro against every sibling size's intro before it knows
// whether it may be indexed (D-77), and every sibling derives from the same
// facilities, the same unit types and the same rates. Loading per-size would
// mean N loads to render one page.
//
// A size exists as a page precisely when a facility in the city has a unit type
// with those dimensions AND a rate in effect for it. Both halves matter: an
// unpriced type is not sellable — `publicInventoryForFacility` already drops
// them for the same reason — and a page advertising a size nobody can rent is
// the thin content this item is under instruction to avoid.

export type SizeFacility = {
  id: string
  slug: string
  name: string
  city: string
  state: string
  addressLine1: string
  addressLine2: string | null
  postalCode: string
  /// The web rate for THIS size here, in cents. Null when the facility has the
  /// size but nothing of it is rentable today — never 0.
  webRateCents: number | null
  streetRateCents: number | null
  availableCount: number
}

export type CitySize = {
  /// `10x10`. The URL segment and the map key.
  dimension: string
  widthFt: number
  lengthFt: number
  /// Cheapest-first, then by name — the same ordering rule `facilitiesInCity`
  /// uses, for the same reason: a prospect who has already chosen the city and
  /// the size is choosing on price.
  facilities: SizeFacility[]
  lastModified: Date
}

/// Every size a city publishes, keyed by dimension.
///
/// Cached per request (`react.cache`) because `generateMetadata` and the page
/// body are separate calls into the same render, and this is the expensive read
/// on the page.
export const sizesInCity = cache(async function sizesInCity(
  state: string,
  city: string,
  asOf: Date = new Date(),
): Promise<Map<string, CitySize>> {
  const wanted = citySlug(city)
  if (!wanted || !state.trim()) return new Map()

  const facilities = await prisma.facility.findMany({
    where: { status: 'active', state: { equals: state, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      name: true,
      city: true,
      state: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      updatedAt: true,
    },
  })

  // Slugified in JS rather than matched in SQL — the database stores "Fort
  // Worth" and the URL carries "fort-worth", and `citySlug` is the only thing
  // that knows how to turn one into the other. Same reasoning, and the same
  // function, as `facilitiesInCity`.
  const inCity = facilities.filter((facility) => citySlug(facility.city) === wanted)
  if (inCity.length === 0) return new Map()

  const ids = inCity.map((facility) => facility.id)
  const [unitTypes, rateRows, availability] = await Promise.all([
    prisma.unitType.findMany({
      where: { facilityId: { in: ids } },
      select: { id: true, facilityId: true, widthFt: true, lengthFt: true },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId: { in: ids } },
      select: { unitTypeId: true, streetRateCents: true, webRateCents: true, effectiveFrom: true },
    }),
    prisma.unit.groupBy({
      by: ['unitTypeId'],
      where: { facilityId: { in: ids }, status: 'available' },
      _count: { _all: true },
    }),
  ])

  const rates = effectiveByGroup(rateRows, asOf, (row) => row.unitTypeId)
  const counts = new Map(availability.map((row) => [row.unitTypeId, row._count._all]))
  const byId = new Map(inCity.map((facility) => [facility.id, facility]))

  const sizes = new Map<string, CitySize>()

  for (const unitType of unitTypes) {
    const rate = rates.get(unitType.id)
    // No rate in effect means not sellable, so it contributes no page and no
    // price. Publishing it would mean either inventing a rate or rendering a
    // "Rent now" button with nothing to charge.
    if (!rate) continue

    const facility = byId.get(unitType.facilityId)
    if (!facility) continue

    const dimension = dimensionKey(unitType.widthFt, unitType.lengthFt)
    const available = counts.get(unitType.id) ?? 0

    let size = sizes.get(dimension)
    if (!size) {
      size = {
        dimension,
        widthFt: unitType.widthFt,
        lengthFt: unitType.lengthFt,
        facilities: [],
        lastModified: facility.updatedAt,
      }
      sizes.set(dimension, size)
    }

    // A facility can have two unit types of the same dimensions — a climate
    // 10×10 and a drive-up 10×10 are different products at different prices.
    // The page is about the SIZE, so they fold into one row carrying the
    // cheapest rentable price and the combined count, rather than listing the
    // same address twice.
    const existing = size.facilities.find((row) => row.id === facility.id)
    const sellable = available > 0
    if (existing) {
      existing.availableCount += available
      if (sellable && (existing.webRateCents === null || rate.webRateCents < existing.webRateCents)) {
        existing.webRateCents = rate.webRateCents
        existing.streetRateCents = rate.streetRateCents
      }
    } else {
      size.facilities.push({
        id: facility.id,
        slug: facility.slug,
        name: facility.name,
        city: facility.city,
        state: facility.state,
        addressLine1: facility.addressLine1,
        addressLine2: facility.addressLine2,
        postalCode: facility.postalCode,
        webRateCents: sellable ? rate.webRateCents : null,
        streetRateCents: sellable ? rate.streetRateCents : null,
        availableCount: available,
      })
    }

    if (size.lastModified < facility.updatedAt) size.lastModified = facility.updatedAt
  }

  for (const size of sizes.values()) {
    size.facilities.sort((a, b) => {
      // Nothing-rentable last, then price, then name — stable across renders
      // rather than whatever Postgres returned.
      if ((a.webRateCents === null) !== (b.webRateCents === null)) {
        return a.webRateCents === null ? 1 : -1
      }
      if (a.webRateCents !== null && b.webRateCents !== null && a.webRateCents !== b.webRateCents) {
        return a.webRateCents - b.webRateCents
      }
      return a.name.localeCompare(b.name)
    })
  }

  return sizes
})

/// Every city/size pair the site publishes, each carrying whether it is
/// indexable — the sitemap's list, and the structured-data monitor's.
///
/// Built from the same function the page reads, so the sitemap cannot advertise
/// a size page the page itself would 404 — the rule B-082 part 2 established
/// for city pages and the reason that one has never gone stale.
///
/// **The gate is evaluated here too, and the sitemap must honour it.** A URL in
/// the sitemap carrying `noindex` tells a crawler to fetch this page and then
/// tells it not to index the page it just fetched, which is a contradiction
/// that spends crawl budget to say nothing. Advertising only what passed is the
/// point of D-77.
///
/// ponytail: one `sizesInCity` call per city, and each re-reads every active
/// facility in the STATE before filtering to the city in JS — so a ten-city
/// Texas portfolio reads the facility table ten times to build one sitemap.
/// That is `facilitiesInCity`'s existing pattern rather than a new one, and at
/// this scale it is a handful of rows; the upgrade is one state-wide read
/// shared across the loop, and the trigger is the sitemap becoming slow enough
/// to notice.
export async function citySizePages(): Promise<
  {
    state: string
    city: string
    dimension: string
    lastModified: Date
    indexable: boolean
    /// The sibling this page scored closest to. Null when it is the only size
    /// in its city.
    closestTo: string | null
    closestScore: number
  }[]
> {
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { city: true, state: true },
  })

  const cities = new Map<string, { state: string; city: string }>()
  for (const facility of facilities) {
    cities.set(`${facility.state.toLowerCase()}/${citySlug(facility.city)}`, {
      state: facility.state,
      city: facility.city,
    })
  }

  const pages: Awaited<ReturnType<typeof citySizePages>> = []
  for (const { state, city } of cities.values()) {
    const sizes = await sizesInCity(state, city)
    // B-262. The gate is computed in EVERY language and a page is indexable
    // only where all of them pass, which is exactly what the page itself does —
    // and the two agreeing is the whole point of this function. The sitemap
    // lists one entry per URL carrying its `hreflang` alternates, so a page
    // this said was indexable while the page served `noindex` would advertise a
    // URL and then tell the crawler to discard it.
    const introsByLocale = LOCALES.map(
      (locale) =>
        new Map(
          [...sizes.values()].map((size) => [
            size.dimension,
            citySizeIntro(size.widthFt, size.lengthFt, city, state, size.facilities, locale),
          ]),
        ),
    )

    for (const size of sizes.values()) {
      const verdicts = introsByLocale.map((intros) => sizeIndexGate(size.dimension, intros))
      const gate = verdicts.find((verdict) => !verdict.indexable) ?? verdicts[0]
      pages.push({
        state,
        city,
        dimension: size.dimension,
        lastModified: size.lastModified,
        indexable: gate.indexable,
        closestTo: gate.indexable ? null : gate.against,
        closestScore: gate.indexable ? gate.closest : gate.similarity,
      })
    }
  }

  return pages.sort((a, b) =>
    `${a.state}${a.city}${a.dimension}`.localeCompare(`${b.state}${b.city}${b.dimension}`),
  )
}
