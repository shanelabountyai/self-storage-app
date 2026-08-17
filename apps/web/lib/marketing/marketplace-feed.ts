import { prisma } from '@storage/db'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { facilityPath } from '@/lib/facility/public-facility'
import { siteOrigin } from './origin'

// B-082 part 1. The availability feed a marketplace consumes.
//
// **Rate parity is structural here, not a reconciliation job.** Every rate and
// every count in this feed comes from `publicInventoryForFacility` — the exact
// function that renders the facility page and answers the public inventory API.
// There is no second query, no separate "feed price" column and no nightly job
// comparing the two, because there is only one number. A parity checker exists
// to catch two sources drifting; the cheaper fix is to not have two sources.
//
// The consequence worth stating: a rate change on the admin screen is in this
// feed the moment the cache window turns over, and it cannot be in the feed
// without also being on the website.

export type MarketplaceUnitType = {
  id: string
  name: string
  widthFt: number
  lengthFt: number
  sqFt: number
  climateControlled: boolean
  driveUp: boolean
  floor: number
  powerAvailable: boolean
  availableCount: number
  /// The published street rate and the online rate, in cents — the SAME pair
  /// the facility page prints. A marketplace quoting a different number is
  /// quoting one we never published.
  streetRateCents: number
  webRateCents: number
}

export type MarketplaceFacility = {
  slug: string
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  latitude: number | null
  longitude: number | null
  phone: string | null
  /// Absolute, because a feed is consumed off-site by definition.
  url: string
  unitTypes: MarketplaceUnitType[]
}

export type MarketplaceFeed = {
  generatedAt: string
  facilities: MarketplaceFacility[]
}

export async function marketplaceFeed(asOf: Date = new Date()): Promise<MarketplaceFeed> {
  // Active only, matching the public site exactly. A facility we have stopped
  // advertising must not keep taking marketplace bookings.
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    orderBy: { name: 'asc' },
    select: {
      slug: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      latitude: true,
      longitude: true,
      phone: true,
    },
  })

  const origin = siteOrigin()
  // ponytail: one inventory read per facility, in parallel. Measured at ~1.5s
  // for the whole portfolio against a remote database, behind a 5-minute edge
  // cache, so a marketplace polling every minute costs one of these an hour.
  // Reuses the website's own read deliberately — that is what makes rate parity
  // structural. If the portfolio ever reaches a size where this is slow, batch
  // the underlying queries in `publicInventoryForFacility`; do NOT give the feed
  // its own query, which is how the two prices start to differ.
  const rows = await Promise.all(
    facilities.map(async (facility) => {
      const inventory = await publicInventoryForFacility(facility.slug, asOf)
      return { facility, inventory }
    }),
  )

  return {
    generatedAt: asOf.toISOString(),
    facilities: rows
      // A facility whose inventory read came back null is omitted rather than
      // published with an empty unit list: "we have nothing" and "we could not
      // tell you" are different answers, and a marketplace acting on the first
      // when the second is true de-lists a full site.
      .filter((row): row is typeof row & { inventory: NonNullable<typeof row.inventory> } =>
        row.inventory !== null,
      )
      .map(({ facility, inventory }) => ({
        slug: facility.slug,
        name: facility.name,
        addressLine1: facility.addressLine1,
        addressLine2: facility.addressLine2,
        city: facility.city,
        state: facility.state,
        postalCode: facility.postalCode,
        latitude: facility.latitude,
        longitude: facility.longitude,
        phone: facility.phone,
        url: `${origin}${facilityPath({ slug: facility.slug, city: facility.city, state: facility.state })}`,
        // The quote token that `PublicUnitType` carries is deliberately dropped.
        // It binds a facility, a unit type and a price for 30 minutes, and a
        // feed polled every few minutes would mint thousands nobody redeems.
        // A marketplace sends the renter to `url` and the site mints one there.
        unitTypes: inventory.unitTypes.map((unitType) => ({
          id: unitType.unitTypeId,
          name: unitType.name,
          widthFt: unitType.widthFt,
          lengthFt: unitType.lengthFt,
          sqFt: unitType.sqFt,
          climateControlled: unitType.climateControlled,
          driveUp: unitType.driveUp,
          floor: unitType.floor,
          powerAvailable: unitType.powerAvailable,
          availableCount: unitType.availableCount,
          streetRateCents: unitType.streetRateCents,
          webRateCents: unitType.webRateCents,
        })),
      })),
  }
}
