import { prisma } from '@storage/db'
import type { ContentItem } from '@storage/core/marketing'
import { citySizePath, citySlugPath, facilityPagePath } from '@/lib/marketing/paths'
import {
  authoredCityIntro,
  citiesWithFacilities,
  facilitiesInCity,
} from '@/lib/facility/city-facilities'
import { cityIntro } from '@/lib/marketing/city-copy'
import { citySizeIntro, dimensionLabel } from '@storage/core/marketing'
import { sizesInCity } from '@/lib/facility/city-size-pages'
import { GUIDES, guideCopy, guidePath } from '@/lib/guides/catalog'
import { DEFAULT_LOCALE } from '@/lib/i18n'

// PRD 04 §7 Phase 2 (B-082 part 6). Everything the site publishes as prose,
// gathered so it can be compared against itself.
//
// Read from the same functions the pages render from, never from a second copy:
// the city intros come from `cityIntro`, the guide descriptions from the guide
// catalog, the facility copy from the facility record. A corpus assembled any
// other way would be checking text that is not on any page — which is worse
// than not checking, because it produces confident warnings about nothing.

/// The kinds, written for the person reading the report rather than as keys.
///
/// Only items sharing a kind are compared. A 155-character meta description and
/// a 600-word long description would score low against each other for reasons of
/// length rather than content.
export const KIND = {
  meta: 'Search-result descriptions',
  hero: 'Facility page opening lines',
  long: 'Facility page long descriptions',
  cityIntro: 'City page intros',
  sizeIntro: 'City/size page intros',
  guide: 'Guide descriptions',
} as const

export async function contentCorpus(): Promise<ContentItem[]> {
  const items: ContentItem[] = []

  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: {
      name: true,
      slug: true,
      city: true,
      state: true,
      metaDescription: true,
      heroCopy: true,
      longDescription: true,
    },
    orderBy: { name: 'asc' },
  })

  for (const facility of facilities) {
    const url = facilityPagePath(facility)
    // Authored, every one of them — B-066's generated defaults are used when
    // these are null, and a null contributes nothing to the corpus. That is
    // deliberate: the generated title and description ARE templated by design,
    // and flagging every unedited facility against every other would bury the
    // one case where somebody actually pasted.
    for (const [kind, text] of [
      [KIND.meta, facility.metaDescription],
      [KIND.hero, facility.heroCopy],
      [KIND.long, facility.longDescription],
    ] as const) {
      if (!text?.trim()) continue
      items.push({
        key: `${facility.slug}:${kind}`,
        url,
        label: facility.name,
        kind,
        origin: 'authored',
        text,
      })
    }
  }

  // The city intros (B-082 part 2, D-58; B-128, D-62). Generated from the
  // facilities in each city unless somebody has written copy for it — which is
  // exactly the distinction the report's advice turns on, so `origin` is taken
  // from which one actually rendered rather than assumed to be 'generated'.
  //
  // The consequence is the point of B-128: writing real copy for two cities
  // moves both rows to 'authored', and if they are STILL alike the report says
  // "somebody wrote both" — which is now a fixable finding rather than a note
  // about a product gap.
  for (const city of await citiesWithFacilities()) {
    const inCity = await facilitiesInCity(city.state, city.city)
    const authored = await authoredCityIntro(city.state, city.city)
    const text = cityIntro(city.city, city.state, inCity, authored).join(' ')
    if (!text.trim()) continue
    items.push({
      key: `city:${city.state}/${city.city}`,
      url: citySlugPath(city.state, city.city),
      label: `${city.city}, ${city.state.toUpperCase()}`,
      kind: KIND.cityIntro,
      origin: authored ? 'authored' : 'generated',
      text,
    })
  }

  // B-089's per-city/size intros. These are the pages D-77 gates BEFORE they
  // are published, so a row here is not a warning that something got indexed —
  // it is the record of a page that did not, and of which sibling stopped it.
  // Listed anyway, and deliberately: the gate is silent to a visitor by design,
  // so this report is the only place an operator can see that a page they
  // expected to rank is not being offered to an index at all.
  for (const city of await citiesWithFacilities()) {
    for (const size of (await sizesInCity(city.state, city.city)).values()) {
      const text = citySizeIntro(
        size.widthFt,
        size.lengthFt,
        city.city,
        city.state,
        size.facilities,
      ).join(' ')
      if (!text.trim()) continue
      items.push({
        key: `size:${city.state}/${city.city}/${size.dimension}`,
        url: citySizePath(city.state, city.city, size.dimension),
        label: `${dimensionLabel(size.widthFt, size.lengthFt)} — ${city.city}, ${city.state.toUpperCase()}`,
        kind: KIND.sizeIntro,
        // Generated, always. Unlike a city intro there is no authored override
        // to fall back from — see B-134, which is where one goes if a real
        // portfolio trips this gate.
        origin: 'generated',
        text,
      })
    }
  }

  // B-262. English only, and that is a stated limit rather than an oversight:
  // the corpus compares prose for near-duplicates, and comparing a Spanish
  // description against an English one measures the language gap, not the
  // duplication. Every other input here is English too — the facility copy is
  // operator-typed and the city intros are generated in English — so a mixed
  // corpus would report noise.
  //
  // The Spanish URLs are indexable now, so they deserve the same gate against
  // EACH OTHER: four Spanish guide descriptions can be as near-duplicate as
  // four English ones. That needs the corpus built per locale and the report
  // showing both, and it is the same change the city and size intros will want
  // when they are translated — so it belongs with them rather than half-done
  // here. Named in `docs/PROGRESS.md` as what this item left behind.
  for (const guide of GUIDES) {
    const copy = guideCopy(guide, DEFAULT_LOCALE)
    items.push({
      key: `guide:${guide.slug}`,
      url: guidePath(guide),
      label: copy.title,
      kind: KIND.guide,
      origin: 'authored',
      text: copy.description,
    })
  }

  return items
}
