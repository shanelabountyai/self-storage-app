import { prisma } from '@storage/db'
import type { ContentItem } from '@storage/core/marketing'
import { citySlugPath, facilityPagePath } from '@/lib/marketing/paths'
import { citiesWithFacilities, facilitiesInCity } from '@/lib/facility/city-facilities'
import { cityIntro } from '@/lib/marketing/city-copy'
import { GUIDES, guidePath } from '@/lib/guides/catalog'

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
const KIND = {
  meta: 'Search-result descriptions',
  hero: 'Facility page opening lines',
  long: 'Facility page long descriptions',
  cityIntro: 'City page intros',
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

  // The city intros (B-082 part 2, D-58). Generated from the facilities in each
  // city, so they are templated by construction — which was accepted with the
  // note that it is thin-content protection at the floor. This is the check
  // that says whether the floor is holding, and it is the reason this report
  // covers generated copy at all.
  for (const city of await citiesWithFacilities()) {
    const inCity = await facilitiesInCity(city.state, city.city)
    const text = cityIntro(city.city, city.state, inCity).join(' ')
    if (!text.trim()) continue
    items.push({
      key: `city:${city.state}/${city.city}`,
      url: citySlugPath(city.state, city.city),
      label: `${city.city}, ${city.state.toUpperCase()}`,
      kind: KIND.cityIntro,
      origin: 'generated',
      text,
    })
  }

  for (const guide of GUIDES) {
    items.push({
      key: `guide:${guide.slug}`,
      url: guidePath(guide),
      label: guide.title,
      kind: KIND.guide,
      origin: 'authored',
      text: guide.description,
    })
  }

  return items
}
