import { canonicalPath as canonicalise, citySlug as slugify } from '@storage/core/marketing'

// PRD 04 FR-SEO-2 (B-066). The app's path vocabulary, in one place.
//
// A thin re-export plus the two paths that only exist at the app layer. It is
// here rather than inlined at each call site because a URL scheme written down
// twice is a URL scheme that eventually disagrees with itself — which is
// exactly the duplicate-content problem FR-SEO-2 exists to prevent.

export { canonicalise as canonicalPath }

/// `/storage/{state}/{city}` — the city page (B-071 builds the page itself;
/// the path exists now because retired facilities redirect to it, US-3 AC4).
export function citySlugPath(state: string, city: string): string {
  return `/storage/${state.toLowerCase()}/${slugify(city)}`
}

/// `/storage/{state}/{city}/{slug}` — the facility page.
export function facilityPagePath(facility: {
  state: string
  city: string
  slug: string
}): string {
  return `${citySlugPath(facility.state, facility.city)}/${facility.slug}`
}
