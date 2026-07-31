import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
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
  unitTypes: PublicUnitType[]
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

  const [unitTypes, rates, counts] = await Promise.all([
    prisma.unitType.findMany({
      where: { facilityId: facility.id },
      orderBy: [{ widthFt: 'asc' }, { lengthFt: 'asc' }, { name: 'asc' }],
    }),
    currentRatesForFacility(facility.id, asOf),
    availableCountsByUnitType(facility.id),
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
    unitTypes: priced,
  }
}

/// US-101's "units from $X/mo" — the lowest current web rate across unit types
/// that actually have a unit available, for many facilities at once.
///
/// Two queries regardless of how many facilities are passed, because a search
/// result list would otherwise fan out into one rate query per facility.
///
/// A facility is absent from the map when nothing is rentable there, which is
/// not the same as $0 — callers must render "call for availability" rather than
/// a price. `null`-vs-absent is the same distinction `currentRatesForFacility`
/// makes for unpriced types.
export async function lowestAvailableWebRateByFacility(
  facilityIds: string[],
  asOf: Date = new Date(),
): Promise<Map<string, number>> {
  if (facilityIds.length === 0) return new Map()

  const [availability, rateRows] = await Promise.all([
    prisma.unit.groupBy({
      by: ['facilityId', 'unitTypeId'],
      where: { facilityId: { in: facilityIds }, status: 'available' },
      _count: { _all: true },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { unitTypeId: true, streetRateCents: true, webRateCents: true, effectiveFrom: true },
    }),
  ])

  const rates = effectiveByGroup(rateRows, asOf, (row) => row.unitTypeId)

  const lowest = new Map<string, number>()
  for (const row of availability) {
    if (row._count._all === 0) continue
    const rate = rates.get(row.unitTypeId)
    // An available unit whose type has no rate in effect is not sellable, so
    // it must not set the "from" price — same rule as the facility feed.
    if (!rate) continue

    const current = lowest.get(row.facilityId)
    if (current === undefined || rate.webRateCents < current) {
      lowest.set(row.facilityId, rate.webRateCents)
    }
  }
  return lowest
}

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
