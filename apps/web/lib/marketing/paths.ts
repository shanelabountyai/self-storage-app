import { canonicalPath as canonicalise, citySlug as slugify } from '@storage/core/marketing'

// PRD 04 FR-SEO-2 (B-066). The app's path vocabulary, in one place.
//
// A thin re-export plus the two paths that only exist at the app layer. It is
// here rather than inlined at each call site because a URL scheme written down
// twice is a URL scheme that eventually disagrees with itself — which is
// exactly the duplicate-content problem FR-SEO-2 exists to prevent.

export { canonicalise as canonicalPath }

/// `/storage/{state}/{city}` — the city page (B-082 part 2). The path existed
/// before the page did, because retired facilities redirect to it (US-3 AC4)
/// and the facility breadcrumb names it — which is how it stayed a 404 for
/// months without anybody noticing.
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

/// `/storage/{state}/{city}/size/{dimension}` — the per-city/size landing page
/// (B-089).
///
/// The literal `size` segment is load-bearing rather than decorative. Without
/// it the dimension would sit in the facility page's `{slug}` position, sharing
/// a namespace with every slug an operator can type — and Next.js would resolve
/// the collision silently, in favour of whichever route matched first.
export function citySizePath(state: string, city: string, dimension: string): string {
  return `${citySlugPath(state, city)}/size/${dimension}`
}
