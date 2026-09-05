import { formatRate } from '@/lib/format'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n'

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
//
// B-262: generated per language, with the templates written here rather than in
// the message catalogue. They read as prose with four or five interpolations
// each and belong beside the logic that decides WHICH sentence is used — a
// dictionary key per branch would put the choice in one file and the wording in
// another, which is how the "everything is rented" sentence ends up in a page
// that has inventory.
//
// The authored override (D-62) is untouched by this and deliberately so: an
// operator's own words are their own words, and B-262 adds a SECOND authored
// column so a city can be written in each language rather than having one
// language's prose machine-mangled into the other.
const LIST_FORMATS: Record<Locale, Intl.ListFormat> = {
  en: new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }),
  es: new Intl.ListFormat('es-MX', { style: 'long', type: 'conjunction' }),
}

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
export function cityTitle(city: string, state: string, locale: Locale = DEFAULT_LOCALE): string {
  const label = cityLabel(city, state)
  return locale === 'es' ? `Bodegas en ${label}` : `Storage Units in ${label}`
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
  locale: Locale = DEFAULT_LOCALE,
): string {
  const label = cityLabel(city, state)
  const count = facilities.length
  const from = cityFromRateCents(facilities)

  if (locale === 'es') {
    const sucursales = count === 1 ? '1 sucursal' : `${count} sucursales`
    return from === null
      ? `Bodegas en ${label}. ${sucursales}, mes con mes y sin contrato de largo plazo. Compare tamaños y vea qué hay disponible hoy.`
      : `Bodegas en ${label}. ${sucursales}, unidades desde ${formatRate(from)} al mes en línea, mes con mes y sin contrato de largo plazo.`
  }

  const places = count === 1 ? '1 location' : `${count} locations`
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
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  if (facilities.length === 0) return []

  const written = authored?.trim() ? authoredParagraphs(authored) : []
  if (written.length > 0) return written

  const label = cityLabel(city, state)
  const names = LIST_FORMATS[locale].format(facilities.map((facility) => facility.name))
  const from = cityFromRateCents(facilities)

  const paragraphs: string[] = []

  if (locale === 'es') {
    paragraphs.push(
      facilities.length === 1
        ? `Tenemos una sucursal de bodegas en ${label}: ${names}.`
        : `Tenemos ${facilities.length} sucursales de bodegas en ${label}: ${names}.`,
    )

    if (from !== null) {
      paragraphs.push(
        `Las unidades empiezan en ${formatRate(from)} al mes al precio en línea — lo que usted paga rentando en esta página, que es más bajo que el precio en tienda. Todas las unidades son mes con mes, así que no hay contrato de largo plazo que firmar.`,
      )
    } else {
      paragraphs.push(
        `Ahora mismo todo en ${label} está rentado. Vale la pena llamar a las sucursales de abajo — casi cada semana se desocupan unidades, y le decimos qué va a quedar libre.`,
      )
    }

    return paragraphs
  }

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
