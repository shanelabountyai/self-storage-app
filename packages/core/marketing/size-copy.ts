import { DUPLICATE_THRESHOLD, similarity } from './profile.ts'
import { DEFAULT_MARKETING_LOCALE, type MarketingLocale } from './locale.ts'
import { dimensionLabel, sizeFacts } from './unit-sizes.ts'

// PRD 00 §6 Phase 3 / PRD 04 §7 (B-089). The per-city/size landing page's words.
//
// **This page type is the one this codebase has twice decided not to build in a
// narrower form, and the reason it is built now is that the copy carries facts
// the city page could not.** D-58 refused a `City` model because derived copy
// cannot drift; B-128 then had to add authored city copy anyway, because the
// duplicate-content report scored the generated city intros at 0.82–0.85
// against each other — the template had nothing to vary on but a place name.
//
// A size template does have something to vary on. A 10×10 page and a 10×15 page
// in the same city differ by square footage, by price, by how many units are
// free, and by two sentences of size-specific description from the guide
// catalogue. That is a real difference, and it is measured rather than
// asserted: `citySizeIntro`'s output is scored against its siblings' at render
// time, and a page that fails to clear the threshold is served `noindex`
// instead of being published as thin content (D-77).
//
// Pure, so both the wording and the gate are testable without a database.
//
// B-262: generated per language. The templates are HERE rather than in the
// app's message catalogue, and the package boundary is the whole reason —
// nothing in `packages/core` can import `apps/web/lib/i18n`, and inverting that
// to make a pure copy generator depend on a UI dictionary would be the wrong
// dependency for the sake of putting all the strings in one file. What the two
// share is the LIST of languages (`./locale.ts`), so a locale cannot exist in
// one and not the other.
//
// The gate below is unchanged and deliberately so: `sizeIndexGate` scores a
// page against its siblings IN THE SAME LANGUAGE, because that is what
// `citySizeIntro` is called with. Scoring a Spanish intro against an English
// one would measure the language gap and pass everything.

export type SizeFacilitySummary = {
  name: string
  /// The web rate for THIS size at this facility, in cents. Null when the
  /// facility has the size but nothing in it is rentable today.
  webRateCents: number | null
  /// Rentable units of this size, right now.
  availableCount: number
}

function formatDollars(cents: number): string {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`
}

/// The lowest advertised rate for this size in this city, or null when nothing
/// of this size is rentable. Never 0 — a "$0" landing page is a lie with a
/// price tag on it, the same rule `cityFromRateCents` follows.
export function sizeFromRateCents(facilities: readonly SizeFacilitySummary[]): number | null {
  const rates = facilities
    .map((facility) => facility.webRateCents)
    .filter((cents): cents is number => cents !== null && cents > 0)
  return rates.length > 0 ? Math.min(...rates) : null
}

export function sizeAvailableCount(facilities: readonly SizeFacilitySummary[]): number {
  return facilities.reduce((total, facility) => total + facility.availableCount, 0)
}

/// FR-SEO-3's title shape. The layout appends the site name, so this must not.
///
/// The dimension leads, because it is the term the query carries — somebody
/// searching "10x10 storage austin", or "bodegas 10x10 austin", is looking for
/// the number first, and that is true in both languages.
export function citySizeTitle(
  widthFt: number,
  lengthFt: number,
  city: string,
  state: string,
  locale: MarketingLocale = DEFAULT_MARKETING_LOCALE,
): string {
  const label = dimensionLabel(widthFt, lengthFt)
  const place = `${city}, ${state.toUpperCase()}`
  return locale === 'es'
    ? `Bodegas de ${label} en ${place}`
    : `${label} Storage Units in ${place}`
}

export function citySizeDescription(
  widthFt: number,
  lengthFt: number,
  city: string,
  state: string,
  facilities: readonly SizeFacilitySummary[],
  locale: MarketingLocale = DEFAULT_MARKETING_LOCALE,
): string {
  const label = dimensionLabel(widthFt, lengthFt)
  const place = `${city}, ${state.toUpperCase()}`
  const from = sizeFromRateCents(facilities)
  const sqFt = widthFt * lengthFt

  if (locale === 'es') {
    return from === null
      ? `Bodegas de ${label} (${sqFt} pies cuadrados) en ${place}. Ahora mismo todas las de ${label} están rentadas — vea qué sucursales tienen una y qué más está libre.`
      : `Bodegas de ${label} (${sqFt} pies cuadrados) en ${place} desde ${formatDollars(from)} al mes en línea. Compare lo que cobra cada sucursal y aparte en unos minutos.`
  }

  return from === null
    ? `${label} storage units (${sqFt} sq ft) in ${place}. Every ${label} is rented right now — see which locations have one and what else is free.`
    : `${label} storage units (${sqFt} sq ft) in ${place} from ${formatDollars(from)}/mo online. Compare what each location charges and reserve in a few minutes.`
}

/// The intro paragraphs, in reading order.
///
/// Every claim is derived from the inventory passed in, so nothing here can go
/// stale — D-58's rule, which this page keeps because unlike a city page it has
/// size-specific facts to carry.
export function citySizeIntro(
  widthFt: number,
  lengthFt: number,
  city: string,
  state: string,
  facilities: readonly SizeFacilitySummary[],
  locale: MarketingLocale = DEFAULT_MARKETING_LOCALE,
): string[] {
  if (facilities.length === 0) return []

  const label = dimensionLabel(widthFt, lengthFt)
  const place = `${city}, ${state.toUpperCase()}`
  const sqFt = widthFt * lengthFt
  const facts = sizeFacts(widthFt, lengthFt, locale)
  const from = sizeFromRateCents(facilities)
  const available = sizeAvailableCount(facilities)
  const paragraphs: string[] = []

  if (locale === 'es') {
    paragraphs.push(
      facts
        ? `Una unidad de ${label} tiene ${sqFt} pies cuadrados. ${facts.comparison} ${facts.typical}`
        : `Una unidad de ${label} tiene ${sqFt} pies cuadrados.`,
    )

    const sucursales =
      facilities.length === 1 ? 'una sucursal' : `${facilities.length} sucursales`
    if (from !== null) {
      paragraphs.push(
        `Tenemos unidades de ${label} en ${sucursales} en ${place}, desde ${formatDollars(from)} al mes al precio en línea — lo que usted paga rentando en esta página, que es más bajo que el precio en tienda. Todas las unidades son mes con mes, así que no hay contrato de largo plazo que firmar.`,
      )
    } else {
      paragraphs.push(
        `Tenemos unidades de ${label} en ${sucursales} en ${place}, y hoy todas están rentadas. Vale la pena llamar a las sucursales de abajo — casi cada semana se desocupa alguna, y puede haber un tamaño parecido que le sirva.`,
      )
    }

    if (available > 0 && available <= 3) {
      paragraphs.push(
        available === 1
          ? `Hoy queda una unidad de ${label} en ${place}.`
          : `Hoy quedan ${available} unidades de ${label} en ${place}.`,
      )
    }

    return paragraphs
  }

  // What the size IS. Two sentences from the guide catalogue, and they are the
  // ones that differ most between sibling pages — which is the entire reason a
  // per-size page is worth publishing rather than a filter on the city page.
  //
  // A size with no catalogue entry gets the measurement alone. Deliberately not
  // padded with a generic sentence: a filler line repeated on every unlisted
  // size would push those pages TOWARDS each other, which is the opposite of
  // what this paragraph is for.
  paragraphs.push(
    facts
      ? `A ${label} unit is ${sqFt} square feet. ${facts.comparison} ${facts.typical}`
      : `A ${label} unit is ${sqFt} square feet.`,
  )

  // Where it is, and what it costs. The count of LOCATIONS rather than of
  // units, because a prospect is choosing a place to drive to.
  const places = facilities.length === 1 ? 'one location' : `${facilities.length} locations`
  if (from !== null) {
    paragraphs.push(
      `We have ${label} units at ${places} in ${place}, from ${formatDollars(from)} a month at the online rate — what you pay renting on this page, which is lower than the in-store rate. Every unit is month-to-month, so there is no long-term contract to sign.`,
    )
  } else {
    paragraphs.push(
      `We have ${label} units at ${places} in ${place}, and every one of them is rented today. The locations below are still worth a call — units open up most weeks, and there may be a nearby size that suits.`,
    )
  }

  // Real scarcity only, from the real count — the same rule US-201 puts on the
  // facility page's "only 2 left". Silent above the threshold rather than
  // printing a reassuring number, because "14 available" invites waiting.
  if (available > 0 && available <= 3) {
    paragraphs.push(
      available === 1
        ? `There is one ${label} left in ${place} today.`
        : `There are ${available} ${label} units left in ${place} today.`,
    )
  }

  return paragraphs
}

export type IndexGate =
  | { indexable: true; closest: number }
  /// Names the sibling it is too close to, so the duplicate report can say
  /// which page to fix rather than "this one is a duplicate of something".
  | { indexable: false; against: string; similarity: number }

/// D-77. Whether a size page has earned the right to be indexed.
///
/// **A gate, not a report.** B-082 part 6 built the duplicate detector as a
/// screen somebody reads afterwards, and that was right for pages a person
/// wrote — a human pasted, a human un-pastes. It is not enough for pages the
/// product GENERATES by the dozen: by the time the report is read, the thin
/// pages are already indexed, and the damage from thin content is to the domain
/// rather than to the page. So the same `similarity` function that scores the
/// report runs before the page is published, and a page that fails is served
/// `noindex, follow` instead of being advertised.
///
/// **Compared against sibling SIZES only, never against the city page.** That
/// is `findDuplicatePairs`' own rule — pairwise within a kind and never across
/// kinds — and it holds for the same reason: a two-paragraph size intro scored
/// against a differently-shaped city intro would score low for reasons of
/// length rather than content, and a gate that passes for the wrong reason is
/// worse than no gate.
///
/// `follow` rather than `nofollow` on the failing case, deliberately: the page
/// links to the facilities, and those links are worth crawling even when this
/// page is not worth indexing.
export function sizeIndexGate(
  dimension: string,
  intros: ReadonlyMap<string, readonly string[]>,
  threshold: number = DUPLICATE_THRESHOLD,
): IndexGate {
  const own = (intros.get(dimension) ?? []).join(' ').trim()
  // A page with no intro at all has nothing to be a duplicate OF, and also
  // nothing to rank. It is refused rather than passed: an empty page is the
  // purest thin content there is.
  if (!own) return { indexable: false, against: dimension, similarity: 1 }

  let worst: { against: string; similarity: number } | null = null
  for (const [other, paragraphs] of intros) {
    if (other === dimension) continue
    const text = paragraphs.join(' ').trim()
    if (!text) continue
    const score = similarity(own, text)
    if (!worst || score > worst.similarity) worst = { against: other, similarity: score }
  }

  // The only size in the city. Nothing to be a duplicate of, and it carries
  // real inventory — that is a page worth having.
  if (!worst) return { indexable: true, closest: 0 }

  return worst.similarity >= threshold
    ? { indexable: false, against: worst.against, similarity: worst.similarity }
    : { indexable: true, closest: worst.similarity }
}
