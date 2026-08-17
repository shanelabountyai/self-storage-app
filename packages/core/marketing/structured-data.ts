import { DAYS_OF_WEEK, type DayOfWeek, type WeeklySchedule } from '../facility-settings/weekly-schedule.ts'
import { formatStreetAddress, telHref, type NapSource } from './nap.ts'

// PRD 04 FR-SEO-4 (B-066). JSON-LD, generated from the facility record.
//
// "All generated from the facility record — never hand-authored." The reason is
// in the failure mode rather than the effort: hand-written structured data
// drifts from the page it describes, and structured data that contradicts the
// visible page is the thing Google penalises. If the address moves, both the
// footer and the schema have to move with it, which means both read the same
// record through the same formatter (FR-SEO-7).
//
// Everything here is pure and returns plain objects. Serialising and embedding
// is the page's job — see `renderJsonLd` for the one escaping rule that matters.

export type JsonLd = Record<string, unknown>

/// schema.org day names. Their vocabulary, not ours, so the mapping lives here
/// rather than in the weekly-schedule shape which has no business knowing about
/// search engines.
const SCHEMA_DAYS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

/// FR-SEO-4: "openingHoursSpecification (office and gate hours as separate
/// specs)".
///
/// Closed days are omitted rather than emitted with equal open/close times.
/// A `Monday 00:00–00:00` spec is read by some consumers as open all day, which
/// is the opposite of what it means, and sends somebody to a locked office.
export function openingHours(
  schedule: WeeklySchedule | null,
  name: string,
): JsonLd[] {
  if (!schedule) return []
  return DAYS_OF_WEEK.filter((day) => !schedule[day].closed).map((day) => {
    const entry = schedule[day]
    return {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
      opens: entry.closed ? undefined : entry.open,
      closes: entry.closed ? undefined : entry.close,
      name,
    }
  })
}

export type UnitTypeOffer = {
  name: string
  sqFt: number
  /// The rate a renter would actually pay today, in cents. The web rate, not
  /// the street rate — an `Offer` naming a price nobody is charged is a
  /// mismatch between schema and page, which is the one thing this file exists
  /// to avoid.
  webRateCents: number
  availableCount: number
  description: string | null
}

export type FacilitySchemaInput = {
  facility: NapSource & {
    slug: string
    latitude: number | null
    longitude: number | null
    amenities: string[]
    officeHours: WeeklySchedule | null
    gateHours: WeeklySchedule | null
  }
  /// Absolute, with scheme and host. A relative `url` in JSON-LD is not an
  /// error but is worth nothing — the whole point is to name the canonical
  /// page.
  url: string
  images: string[]
  unitTypes: readonly UnitTypeOffer[]
  /// US-6 AC3 gates ratings: only real, verified reviews may be marked up.
  /// Undefined until that exists, and passing a fabricated one is the fastest
  /// way to a manual action against the whole domain.
  aggregateRating?: { ratingValue: number; reviewCount: number }
}

/// The `SelfStorage` node for a facility page.
///
/// `SelfStorage` is a subtype of `LocalBusiness`, which is what makes the
/// address, hours and offers eligible for local rich results at all.
export function selfStorageJsonLd(input: FacilitySchemaInput): JsonLd {
  const { facility } = input
  const phone = telHref(facility.phone)

  // Only offers a renter could actually take. Marking up a sold-out size as
  // available is a mismatch a crawler can check against the page.
  const offers = input.unitTypes
    .filter((unitType) => unitType.availableCount > 0 && unitType.webRateCents > 0)
    .map((unitType) => ({
      '@type': 'Offer',
      name: `${unitType.name} storage unit`,
      description: unitType.description ?? `${unitType.sqFt} sq ft self-storage unit`,
      price: (unitType.webRateCents / 100).toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      // Monthly. Without this a crawler reads "$129" as a one-off purchase
      // price, which is a different and much better-sounding offer than the
      // one being made.
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: (unitType.webRateCents / 100).toFixed(2),
        priceCurrency: 'USD',
        unitCode: 'MON',
      },
    }))

  return prune({
    '@context': 'https://schema.org',
    '@type': 'SelfStorage',
    name: facility.name,
    url: input.url,
    telephone: phone ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: [facility.addressLine1, facility.addressLine2].filter(Boolean).join(', '),
      addressLocality: facility.city,
      addressRegion: facility.state,
      postalCode: facility.postalCode,
      addressCountry: 'US',
    },
    geo:
      facility.latitude !== null && facility.longitude !== null
        ? { '@type': 'GeoCoordinates', latitude: facility.latitude, longitude: facility.longitude }
        : undefined,
    image: input.images.length > 0 ? input.images : undefined,
    // Derived from what is actually for rent rather than typed by hand, so it
    // cannot contradict the prices on the page.
    priceRange: priceRangeFor(input.unitTypes),
    openingHoursSpecification: [
      ...openingHours(facility.officeHours, 'Office hours'),
      ...openingHours(facility.gateHours, 'Gate access hours'),
    ],
    amenityFeature: facility.amenities.map((amenity) => ({
      '@type': 'LocationFeatureSpecification',
      name: amenity,
      value: true,
    })),
    makesOffer: offers.length > 0 ? offers : undefined,
    aggregateRating: input.aggregateRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: input.aggregateRating.ratingValue,
          reviewCount: input.aggregateRating.reviewCount,
        }
      : undefined,
  })
}

/// "$" through "$$$$", from the cheapest unit on offer. Google shows this
/// verbatim, so it is derived rather than configured — a facility that raised
/// its rates should not still be advertising itself as the cheap one.
function priceRangeFor(unitTypes: readonly UnitTypeOffer[]): string | undefined {
  const rates = unitTypes.map((unitType) => unitType.webRateCents).filter((cents) => cents > 0)
  if (rates.length === 0) return undefined
  const lowest = Math.min(...rates)
  if (lowest < 7_500) return '$'
  if (lowest < 15_000) return '$$'
  if (lowest < 25_000) return '$$$'
  return '$$$$'
}

export type FaqEntry = { question: string; answer: string }

/// FR-SEO-4's `FAQPage` for the FAQ block.
///
/// Returns null below a floor rather than emitting a one-question FAQPage:
/// Google's own guidance is that the markup must reflect a genuine FAQ section,
/// and a single Q&A marked up as a page-level FAQ is the shape that gets
/// ignored at best.
export function faqPageJsonLd(entries: readonly FaqEntry[], minimum = 2): JsonLd | null {
  const usable = entries.filter((entry) => entry.question.trim() && entry.answer.trim())
  if (usable.length < minimum) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: usable.map((entry) => ({
      '@type': 'Question',
      name: entry.question.trim(),
      acceptedAnswer: { '@type': 'Answer', text: entry.answer.trim() },
    })),
  }
}

/// FR-SEO-4's `ItemList` for city and search pages.
export function itemListJsonLd(
  items: readonly { name: string; url: string }[],
  listName: string,
): JsonLd | null {
  if (items.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  }
}

export type ArticleSchemaInput = {
  headline: string
  description: string
  /// Absolute, with scheme and host — same rule as every other `url` here.
  url: string
  /// ISO date (YYYY-MM-DD). The day the guide's text last changed, typed by
  /// whoever changed it.
  datePublished: string
  dateModified?: string
  /// The organisation. Guides are house content, not bylined by a person, and
  /// inventing an author name to fill the field is a fabricated credential.
  publisher: string
}

/// FR-SEO-4's `Article`, for a guide in the content hub (US-4 AC3).
///
/// `Article` and not `BlogPosting` or `NewsArticle`: both of those carry
/// expectations about recency and editorial cadence that a set of evergreen
/// how-to pages does not meet, and claiming a type whose conventions the page
/// does not follow is the same mistake as marking up a rating we did not
/// collect.
///
/// Deliberately no `image` and no `author`. An `Article` with an image URL that
/// 404s is worse than one with no image, and there is no guide art in this
/// product; `author` is left to `publisher` because nobody is bylined.
export function articleJsonLd(input: ArticleSchemaInput): JsonLd {
  return prune({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    // `mainEntityOfPage` rather than a bare `url`: it is the property that says
    // "this article IS this page" rather than "this article mentions it", which
    // is what stops the same guide being read as content syndicated from
    // somewhere else.
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    url: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    publisher: { '@type': 'Organization', name: input.publisher },
  })
}

/// `BreadcrumbList`, so a facility page shows its city path in results rather
/// than a bare URL.
export function breadcrumbJsonLd(crumbs: readonly { name: string; url: string }[]): JsonLd | null {
  if (crumbs.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  }
}

/// Drops undefined values and empty arrays, recursively.
///
/// Not cosmetic: `"telephone": null` is a positive assertion that the business
/// has no phone number, and an empty `makesOffer: []` says it rents nothing.
/// Absent and empty are different claims, and only one of them is true here.
export function prune<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined)
    return items as unknown as T
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, prune(inner)] as const)
      .filter(([, inner]) => {
        if (inner === undefined || inner === null) return false
        if (Array.isArray(inner) && inner.length === 0) return false
        return true
      })
    return Object.fromEntries(entries) as T
  }
  return value
}

/// Serialises for embedding in a `<script type="application/ld+json">`.
///
/// The `<` escape is the only rule that matters and it is not optional: a
/// facility description containing `</script>` would otherwise close the tag
/// early and drop whatever followed straight into the document as markup. That
/// is an XSS hole wearing a structured-data hat, and operator-supplied copy
/// reaches this function.
export function renderJsonLd(node: JsonLd | null): string {
  if (!node) return ''
  return JSON.stringify(node).replace(/</g, '\\u003c')
}
