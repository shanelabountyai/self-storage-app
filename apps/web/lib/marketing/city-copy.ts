import { formatRate } from '@/lib/format'

// PRD 04 §3.2 US-4 AC1 (B-082 part 2). The city page's own words.
//
// "Unique intro copy per city." Generated from the facilities in the city and
// never hand-authored — the same rule the facility page's FAQs and its JSON-LD
// already follow (FR-SEO-4), for the same reason: copy typed once drifts from
// the prices, the names and the amenities it describes, and a landing page
// that contradicts the list underneath it is worse than one with no prose.
//
// What makes it unique per city is that every sentence is derived: the count,
// the names, the price floor and the amenities differ because the facilities
// do.
//
// B-128 / D-62 added the other half. `cityIntro` now takes an optional
// authored intro, which wins when it is there — but the generated one is still
// what a city with nobody's writing gets, and that is every city until somebody
// opens the editor. The reason for the change is a measurement rather than a
// change of mind: the duplicate-content report scores these generated intros at
// 0.82–0.85 against each other, above this codebase's own 0.8 threshold, so a
// page built to rank had no way to stop being duplicate content. D-58's own
// rule is honoured in what is NOT editable: the title, the meta description,
// the facility list and the amenity set are still derived on every city page,
// authored intro or not, because those are the ones that carry the count, the
// names and the price floor — exactly the facts that go stale when typed.
//
// Pure, so the wording is testable without a database.

const list = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' })

export type CityFacilitySummary = {
  name: string
  amenities: string[]
  /// Lowest web rate among available units. Null when nothing is rentable.
  fromWebRateCents: number | null
}

/// "Austin, TX". One definition, because the heading, the title, the meta
/// description and the breadcrumb all print it and a mismatch between them
/// reads as two different places.
export function cityLabel(city: string, state: string): string {
  return `${city}, ${state.toUpperCase()}`
}

/// FR-SEO-3's title shape, for a city rather than a facility. The layout
/// appends the site name, so this must not.
export function cityTitle(city: string, state: string): string {
  return `Storage Units in ${cityLabel(city, state)}`
}

/// The lowest advertised rate anywhere in the city, or null when nothing in it
/// is rentable today. Never 0 — `fromWebRateCents` is already null in that case
/// and a "$0" city page would be a lie with a price tag on it.
export function cityFromRateCents(facilities: readonly CityFacilitySummary[]): number | null {
  const rates = facilities
    .map((facility) => facility.fromWebRateCents)
    .filter((cents): cents is number => cents !== null && cents > 0)
  return rates.length > 0 ? Math.min(...rates) : null
}

/// The meta description. Kept inside the ~155 characters a result actually
/// renders (`DESCRIPTION_IDEAL_MAX`) rather than truncated by Google mid-word.
export function cityDescription(
  city: string,
  state: string,
  facilities: readonly CityFacilitySummary[],
): string {
  const label = cityLabel(city, state)
  const count = facilities.length
  const places = count === 1 ? '1 location' : `${count} locations`
  const from = cityFromRateCents(facilities)

  return from === null
    ? `Self-storage in ${label}. ${places}, month-to-month with no long-term contract. Compare sizes and check what is open today.`
    : `Self-storage in ${label}. ${places}, units from ${formatRate(from)}/mo online, month-to-month with no long-term contract.`
}

/// Splits a textarea's contents into paragraphs on blank lines — the same rule
/// the facility page's long description follows, because it is the same
/// textarea habit and two different rules would be a surprise.
function authoredParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

/// The intro paragraphs, in reading order.
///
/// With no `authored` copy every claim is derived from the facilities passed
/// in, so there is nothing that can go stale. With authored copy the words are
/// whatever was written — a page nobody has written for is still complete, and
/// a page somebody HAS written for is not silently half-templated.
///
/// Still returns nothing when the city has no facilities, authored or not: that
/// city 404s (AC1's indexability rule), and rendering somebody's prose on a
/// page about no locations would be the thin content this is here to prevent.
export function cityIntro(
  city: string,
  state: string,
  facilities: readonly CityFacilitySummary[],
  authored?: string | null,
): string[] {
  if (facilities.length === 0) return []

  const written = authored?.trim() ? authoredParagraphs(authored) : []
  if (written.length > 0) return written

  const label = cityLabel(city, state)
  const names = list.format(facilities.map((facility) => facility.name))
  const from = cityFromRateCents(facilities)

  const paragraphs: string[] = []

  // The count and the names, which is the fact a prospect came for. Names are
  // printed rather than described — the list below links them, and a reader
  // scanning the first line should already know whether we are in their city.
  paragraphs.push(
    facilities.length === 1
      ? `We have one storage facility in ${label}: ${names}.`
      : `We have ${facilities.length} storage facilities in ${label}: ${names}.`,
  )

  // The price sentence is omitted entirely rather than softened when nothing is
  // rentable — "from $0" and "prices vary" are both worse than saying it
  // plainly in the list below, where each facility carries its own status.
  if (from !== null) {
    paragraphs.push(
      `Units start at ${formatRate(from)} a month at the online rate — what you pay renting on this page, which is lower than the in-store rate. Every unit is month-to-month, so there is no long-term contract to sign.`,
    )
  } else {
    paragraphs.push(
      `Everything in ${label} is rented right now. The locations below are still worth a call — units open up most weeks, and we will tell you what is coming free.`,
    )
  }

  return paragraphs
}

/// The distinct amenities across every facility in the city, in first-seen
/// order.
///
/// Returned as a list rather than folded into a sentence on purpose: these are
/// operator-typed strings ("Climate controlled", "24-hour gate access") and any
/// prose wrapper would have to lower-case or pluralise text it does not own.
/// The page renders them as a labelled list, which needs no grammar and cannot
/// mangle what somebody typed.
export function cityAmenities(facilities: readonly CityFacilitySummary[]): string[] {
  const seen = new Set<string>()
  const amenities: string[] = []
  for (const facility of facilities) {
    for (const amenity of facility.amenities) {
      const trimmed = amenity.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      amenities.push(trimmed)
    }
  }
  return amenities
}
