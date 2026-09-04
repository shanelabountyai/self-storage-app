import { unstable_cache } from 'next/cache'
import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
import type { TaxRate } from '@storage/core/pricing'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'
import { mintQuoteToken } from '@/lib/pricing/quote-token'

// PRD 01 FR-2.1 / US-201. The public, unauthenticated read behind facility and
// search pages. Two rules shape it:
//
// 1. It returns *unit types with counts*, never unit numbers. US-201 calls this
//    out as the thing that prevents inventory races — nobody can reserve "unit
//    214" from a listing page because no listing page ever names one.
// 2. Display reads may be stale (bounded below); checkout reads may not. Those
//    are two different functions here, and the cached one is not reachable from
//    checkout.

/// FR-2.1's "≤5-minute staleness worst case". Applied as route-segment
/// revalidation, so the ceiling is enforced by the platform rather than by a
/// cache we would have to write and then debug.
export const INVENTORY_CACHE_TTL_SECONDS = 300

export type PublicUnitType = {
  unitTypeId: string
  name: string
  widthFt: number
  lengthFt: number
  heightFt: number | null
  sqFt: number
  climateControlled: boolean
  driveUp: boolean
  floor: number
  powerAvailable: boolean
  description: string | null
  /// Real count of rentable units. US-201 permits a "Only 2 left" scarcity
  /// label *only* when driven by this number.
  availableCount: number
  streetRateCents: number
  webRateCents: number
  quote: { token: string; expiresAt: string }
}

/// The facility-level money a cost estimate needs, effective today. Read here
/// rather than on the page so the browse estimate and B-020's checkout stepper
/// draw from one source (US-301: one shared calculation).
export type PublicPricingContext = {
  /// Undefined when the facility has no admin fee configured, which is not the
  /// same as zero — a $0.00 line is noise, an absent one is correct.
  adminFeeCents?: number
  taxRates: TaxRate[]
}

export type PublicInventory = {
  facility: {
    id: string
    slug: string
    name: string
    city: string
    state: string
    timezone: string
    phone: string | null
  }
  asOf: string
  pricing: PublicPricingContext
  unitTypes: PublicUnitType[]
}

/// Effective admin fee and tax rates for a facility. Same effective-dating rule
/// as everything else: rows are never edited, the latest one on or before
/// `asOf` wins (FR-9).
async function pricingContext(facilityId: string, asOf: Date): Promise<PublicPricingContext> {
  const [feeRows, taxRows] = await Promise.all([
    prisma.feeSchedule.findMany({
      where: { facilityId, feeType: 'admin' },
      select: { feeType: true, amountCents: true, effectiveFrom: true },
    }),
    prisma.taxComponent.findMany({
      where: { facilityId },
      select: { jurisdiction: true, rateBasisPoints: true, effectiveFrom: true },
    }),
  ])

  const admin = effectiveByGroup(feeRows, asOf, (row) => row.feeType).get('admin')
  const taxes = effectiveByGroup(taxRows, asOf, (row) => row.jurisdiction)

  return {
    adminFeeCents: admin?.amountCents,
    taxRates: [...taxes.values()]
      .map((row) => ({ jurisdiction: row.jurisdiction, rateBasisPoints: row.rateBasisPoints }))
      .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction)),
  }
}

/// Availability per unit type, counted from the derived `Unit.status`.
/// `available` is the only status that can be rented — `reserved`, `occupied`,
/// `overlocked`, `maintenance`, and `unrentable` all mean "not sellable right
/// now", so counting anything else would put units on sale that aren't.
async function availableCountsByUnitType(facilityId: string): Promise<Map<string, number>> {
  const rows = await prisma.unit.groupBy({
    by: ['unitTypeId'],
    where: { facilityId, status: 'available' },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.unitTypeId, row._count._all]))
}

export async function publicInventoryForFacility(
  slug: string,
  asOf: Date = new Date(),
): Promise<PublicInventory | null> {
  const facility = await prisma.facility.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      city: true,
      state: true,
      timezone: true,
      phone: true,
      status: true,
    },
  })
  // An inactive facility is not open for business; the public site must not
  // advertise it at all, so this is a 404 rather than an empty list.
  if (!facility || facility.status !== 'active') return null

  const [unitTypes, rates, counts, pricing] = await Promise.all([
    prisma.unitType.findMany({
      where: { facilityId: facility.id },
      orderBy: [{ widthFt: 'asc' }, { lengthFt: 'asc' }, { name: 'asc' }],
    }),
    currentRatesForFacility(facility.id, asOf),
    availableCountsByUnitType(facility.id),
    pricingContext(facility.id, asOf),
  ])

  const priced: PublicUnitType[] = []
  for (const unitType of unitTypes) {
    const rate = rates.get(unitType.id)
    // A type with no rate in effect is not sellable, so it is omitted rather
    // than published at a null price. Showing it would mean either inventing a
    // price or rendering a "Rent now" button with nothing to charge.
    if (!rate) continue

    const quote = mintQuoteToken({
      facilityId: facility.id,
      unitTypeId: unitType.id,
      streetRateCents: rate.streetRateCents,
      webRateCents: rate.webRateCents,
      now: asOf,
    })

    priced.push({
      unitTypeId: unitType.id,
      name: unitType.name,
      widthFt: unitType.widthFt,
      lengthFt: unitType.lengthFt,
      heightFt: unitType.heightFt,
      sqFt: unitType.widthFt * unitType.lengthFt,
      climateControlled: unitType.climateControlled,
      driveUp: unitType.driveUp,
      floor: unitType.floor,
      powerAvailable: unitType.powerAvailable,
      description: unitType.description,
      availableCount: counts.get(unitType.id) ?? 0,
      streetRateCents: rate.streetRateCents,
      webRateCents: rate.webRateCents,
      quote: { token: quote.token, expiresAt: quote.expiresAt.toISOString() },
    })
  }

  return {
    // Listed field by field rather than spread, so a column added to Facility
    // later cannot silently appear in an unauthenticated response.
    facility: {
      id: facility.id,
      slug: facility.slug,
      name: facility.name,
      city: facility.city,
      state: facility.state,
      timezone: facility.timezone,
      phone: facility.phone,
    },
    asOf: asOf.toISOString(),
    pricing,
    unitTypes: priced,
  }
}

/// US-101's "units from $X/mo" — the lowest current web rate across unit types
/// that actually have a unit available, for many facilities at once, plus the
/// size that rate belongs to and what else is free there.
///
/// The size travels with the price because a price without one is not a
/// comparison (B-242): a 5×5 at $60 and a 10×10 at $60 are different decisions,
/// and the list that ranks facilities is the denominator of every rate below
/// it. This function already had to pick a winning unit type to find the
/// cheapest rate — it used to throw the identity away.
///
/// Three queries regardless of how many facilities are passed, because a search
/// result list would otherwise fan out into one query per facility.
///
/// A facility is absent from the map when nothing is rentable there, which is
/// not the same as $0 — callers must render "call for availability" rather than
/// a price. `null`-vs-absent is the same distinction `currentRatesForFacility`
/// makes for unpriced types.
export type FacilityFromRate = {
  webRateCents: number
  /// The dimensions of the type that rate belongs to. Rendered with the price,
  /// never apart from it.
  widthFt: number
  lengthFt: number
  /// Distinct sizes with at least one unit free, and units free across all of
  /// them. Both are real counts — US-201 permits a scarcity label only when it
  /// is driven by one, and there is no other source for one here.
  availableSizes: number
  availableUnits: number
}

export async function lowestAvailableWebRateByFacility(
  facilityIds: string[],
  asOf: Date = new Date(),
): Promise<Map<string, FacilityFromRate>> {
  if (facilityIds.length === 0) return new Map()

  const [availability, rateRows, unitTypes] = await Promise.all([
    prisma.unit.groupBy({
      by: ['facilityId', 'unitTypeId'],
      where: { facilityId: { in: facilityIds }, status: 'available' },
      _count: { _all: true },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { unitTypeId: true, streetRateCents: true, webRateCents: true, effectiveFrom: true },
    }),
    prisma.unitType.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { id: true, widthFt: true, lengthFt: true },
    }),
  ])

  const rates = effectiveByGroup(rateRows, asOf, (row) => row.unitTypeId)
  const sizes = new Map(unitTypes.map((type) => [type.id, type]))

  const lowest = new Map<string, FacilityFromRate>()
  for (const row of availability) {
    if (row._count._all === 0) continue
    const rate = rates.get(row.unitTypeId)
    // An available unit whose type has no rate in effect is not sellable, so
    // it must not set the "from" price — same rule as the facility feed.
    if (!rate) continue
    const size = sizes.get(row.unitTypeId)
    // Unreachable in practice (the type is what the units hang off), but a
    // missing row must not invent dimensions.
    if (!size) continue

    const current = lowest.get(row.facilityId)
    if (current === undefined) {
      lowest.set(row.facilityId, {
        webRateCents: rate.webRateCents,
        widthFt: size.widthFt,
        lengthFt: size.lengthFt,
        availableSizes: 1,
        availableUnits: row._count._all,
      })
      continue
    }

    current.availableSizes += 1
    current.availableUnits += row._count._all
    if (rate.webRateCents < current.webRateCents) {
      current.webRateCents = rate.webRateCents
      current.widthFt = size.widthFt
      current.lengthFt = size.lengthFt
    }
  }
  return lowest
}

/// The cached display read. B-017 gave the facility page filter and sort
/// parameters, which makes it a dynamic route — `searchParams` cannot be
/// prerendered — so the route-segment `revalidate` that used to enforce
/// FR-2.1's ≤5-minute ceiling no longer applies to it.
///
/// Caching the *read* rather than the page keeps that ceiling real and bounds
/// database load to one query set per facility per window however many filter
/// combinations get requested. What it gives up versus B-016's prerender is
/// TTFB: the page now renders per request, it just doesn't wait on Postgres.
///
/// Not reachable from checkout — `liveAvailableCount` below is the always-live
/// path, and that separation is the point.
export const cachedPublicInventory = unstable_cache(
  (slug: string) => publicInventoryForFacility(slug),
  ['public-inventory'],
  { revalidate: INVENTORY_CACHE_TTL_SECONDS, tags: ['public-inventory'] },
)

/// FR-2.1: "checkout availability checks are always live."
///
/// Deliberately not routed through `publicInventoryForFacility` — that one is
/// served from a cached route segment, and a checkout that trusted a
/// five-minute-old count would happily sell the last unit twice. This hits the
/// database every call. It is a read, not a hold: B-018 still has to decrement
/// availability atomically when it creates the reservation.
export async function liveAvailableCount(unitTypeId: string): Promise<number> {
  return prisma.unit.count({ where: { unitTypeId, status: 'available' } })
}
