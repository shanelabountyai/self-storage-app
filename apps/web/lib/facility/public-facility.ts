import { cache } from 'react'
import { citySlug } from '@storage/core/marketing'
import { prisma } from '@storage/db'
import { parseWeeklySchedule, type WeeklySchedule } from '@storage/core/facility-settings'

// PRD 01 US-103. The public profile half of a facility page — address, hours,
// amenities, coordinates. Pricing and availability stay in
// lib/inventory/public-inventory.ts; the page composes the two.
//
// Facility data comes from the admin registry and nowhere else (FR-1.2), same
// rule the search module follows.

export type PublicFacility = {
  id: string
  slug: string
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  timezone: string
  /// PRD 01 US-401, B-126 / D-50. Days after the renter's chosen move-in date
  /// that a free hold survives. Public because the reserve page's trust line
  /// states the window BEFORE the renter hands over their details, and a
  /// promise about how long we hold a unit has to be the number the code will
  /// actually use — B-118 shipped that line as prose for exactly this reason,
  /// when there was no setting to read.
  reservationHoldGraceDays: number
  amenities: string[]
  /// Null when the operator has not configured hours yet, or when the stored
  /// JSON is malformed. The page says "call for hours" rather than inventing
  /// times a renter might drive out for.
  officeHours: WeeklySchedule | null
  gateHours: WeeklySchedule | null
  // ── PRD 04 US-2 (B-067). The marketer's own copy, where they have written
  // any. Null throughout means "use B-066's generated default", which is what
  // keeps an unedited facility from rendering as a page with holes in it.
  seoTitle: string | null
  metaDescription: string | null
  heroCopy: string | null
  longDescription: string | null
  photos: { url: string; alt: string; kind: string }[]
  /// A facility's own FAQs. Empty means the generated five are shown instead.
  faqs: { question: string; answer: string }[]
}

/// US-103's crawlable URL scheme: `/storage/{state}/{city}/{facility-slug}`.
/// The slug alone identifies the facility — it is unique — so state and city are
/// there for humans and search engines. That makes them forgeable, which is why
/// the page redirects anything that isn't the canonical spelling (B-066 owns the
/// wider canonical/301 policy).
// Re-exported rather than redefined: B-066 moved the canonical implementation
// into @storage/core/marketing so the sitemap, the redirect map and the city
// page all slugify identically. A second copy here is how two of them would
// eventually disagree about "Fort Worth".
export { citySlug }

export function facilityPath(facility: { state: string; city: string; slug: string }): string {
  return `/storage/${facility.state.toLowerCase()}/${citySlug(facility.city)}/${facility.slug}`
}

/// "09:00" → "9:00 AM". Stored times are facility-local wall clock (they are what
/// the sign on the door says), so this formats them and never converts a zone.
export function formatTimeOfDay(hhmm: string): string {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const suffix = hours < 12 ? 'AM' : 'PM'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/// Wrapped in React's `cache` so the page body and `generateMetadata` share one
/// query per render rather than each issuing their own.
export const publicFacilityBySlug = cache(async function publicFacilityBySlug(
  slug: string,
): Promise<PublicFacility | null> {
  const facility = await prisma.facility.findUnique({
    where: { slug },
    // Field by field, not a spread: a column added to Facility later must not
    // appear in an unauthenticated response by accident (same rule as the
    // public inventory feed). Note `email` is deliberately absent — the manager
    // mailbox is not a public contact channel until B-068 builds lead capture.
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
      latitude: true,
      longitude: true,
      timezone: true,
      reservationHoldGraceDays: true,
      amenities: true,
      officeHours: true,
      gateHours: true,
      status: true,
      seoTitle: true,
      metaDescription: true,
      heroCopy: true,
      longDescription: true,
      photos: {
        orderBy: { position: 'asc' },
        select: { url: true, alt: true, kind: true },
      },
      marketingFaqs: {
        orderBy: { position: 'asc' },
        select: { question: true, answer: true },
      },
    },
  })
  if (!facility) return null

  const { status, officeHours, gateHours, marketingFaqs, ...rest } = facility
  // An inactive facility is not open for business, so it is a 404 rather than a
  // page with everything greyed out — matching publicInventoryForFacility.
  if (status !== 'active') return null

  return {
    ...rest,
    officeHours: parseWeeklySchedule(officeHours),
    gateHours: parseWeeklySchedule(gateHours),
    faqs: marketingFaqs,
  }
})

/// Single-line address, the form used for map deep links and `<address>` alike.
export function formatAddress(facility: PublicFacility): string {
  const street = facility.addressLine2
    ? `${facility.addressLine1}, ${facility.addressLine2}`
    : facility.addressLine1
  return `${street}, ${facility.city}, ${facility.state} ${facility.postalCode}`
}

/// §6.2 wants directions to open the native map app. A Google Maps universal
/// link does that on both iOS and Android without a platform sniff, and falls
/// back to the web map on desktop — one link instead of three.
export function directionsUrl(facility: PublicFacility): string {
  const destination =
    facility.latitude !== null && facility.longitude !== null
      ? `${facility.latitude},${facility.longitude}`
      : formatAddress(facility)
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

/// OpenStreetMap's keyless embed. D-14 settled that this product carries no
/// geocoding vendor; the same reasoning applies to the map tile — a required
/// API key would be a vendor dependency for a decorative panel. Returns null
/// when the facility has no coordinates, and the page then renders the address
/// and directions link alone.
export function mapEmbedUrl(facility: PublicFacility): string | null {
  const { latitude: lat, longitude: lng } = facility
  if (lat === null || lng === null) return null
  // ~1.4km box: tight enough to show the cross-streets a driver needs.
  const pad = 0.01
  const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
}
