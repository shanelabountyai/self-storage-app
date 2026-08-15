// PRD 04 FR-SEO-2 / US-3 AC3 (B-066). One canonical URL per page.
//
// "No duplicate indexable URLs for the same facility (trailing-slash, casing,
// and query-param variants canonicalize)."
//
// Every variant a crawler can reach is a separate URL as far as an index is
// concerned, and each one splits the ranking signal of the page they all point
// at. `/Storage/TX/Austin/demo/` and `/storage/tx/austin/demo?utm_source=x` are
// the same page to a human and four different pages to a crawler.
//
// Pure, because the middleware that enforces it runs on the edge and must not
// touch a database to decide whether to redirect.

/// Query parameters stripped before canonicalising.
///
/// Tracking parameters only. A parameter that CHANGES what the page shows —
/// `?q=`, `?size=`, `?sort=` — must never be stripped, or a search result page
/// would redirect to a different set of results than the one requested. That is
/// why this is an allow-list of things to remove rather than a rule about which
/// ones to keep.
export const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'ttclid',
  'ref',
  'mc_cid',
  'mc_eid',
] as const

/// Routes that must never be indexed: anything behind a login, anything
/// mid-transaction, and anything holding a token.
///
/// Prefix matches. Ordered from most to least obvious so the list reads as an
/// argument rather than a pile.
export const NOINDEX_PREFIXES = [
  '/admin',
  '/portal',
  '/checkout',
  // A signed, single-use payment link (B-050). Indexing one would publish it.
  '/pay',
  '/login',
  '/logout',
  '/reauth',
  '/forgot-password',
  '/reset-password',
  '/confirm-email',
  '/api',
  /// PRD 10 (B-100). A referral link is a single-use bearer token worth $50.
  /// Indexing one publishes it — which is the coupon-site exposure the
  /// single-use design exists to bound, except with a search engine doing the
  /// posting. The middleware stamps `X-Robots-Tag` from this same list, so a
  /// crawler that ignores robots.txt is covered too.
  '/r',
] as const

export function isNoindexPath(pathname: string): boolean {
  const path = pathname.toLowerCase()
  return NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export type CanonicalResult = {
  /// The path-and-query a crawler should be sent to.
  target: string
  /// True when the request was already canonical and no redirect is needed.
  isCanonical: boolean
}

/// The canonical form of a request path plus query.
///
/// Rules, in order:
///   1. Lower-case the path. Slugs are lower-case by policy (FR-SEO-2) and
///      case-sensitive URLs are the easiest duplicate to create by accident —
///      one capitalised link in one email.
///   2. Strip a trailing slash, except at the root.
///   3. Collapse repeated slashes, which proxies and hand-built links produce.
///   4. Drop tracking parameters, and sort what remains so `?a=1&b=2` and
///      `?b=2&a=1` are one URL rather than two.
///
/// The query is deliberately NOT lower-cased: `?q=Austin` is a search term a
/// person typed, and mangling it would change the results to canonicalise the
/// address bar.
export function canonicalPath(pathname: string, search = ''): CanonicalResult {
  let path = pathname.toLowerCase().replace(/\/{2,}/g, '/')
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '')
  if (path === '') path = '/'

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  for (const tracking of TRACKING_PARAMS) params.delete(tracking)

  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const query = sorted.length > 0 ? `?${new URLSearchParams(sorted).toString()}` : ''

  const target = `${path}${query}`
  const originalQuery = search && !search.startsWith('?') ? `?${search}` : search
  return { target, isCanonical: target === `${pathname}${originalQuery}` }
}

/// An absolute URL for a path, for canonical tags, sitemaps and JSON-LD.
///
/// Absolute because all three are contexts where a relative URL is either
/// ignored (canonical) or invalid (sitemap).
export function absoluteUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/// Whether a slug is in the shape FR-SEO-2 requires: lower-case, hyphenated,
/// no leading or trailing hyphen.
export function isCanonicalSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

/// Coerces arbitrary text into a canonical slug.
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    // Strip accents rather than percent-encoding them: an accented slug is
    // legal and unreadable in a search result.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/// A city name as a URL segment: "San Antonio" → "san-antonio".
///
/// The same function as `toSlug`, named for its caller. Kept as its own export
/// because the facility page, the city page, the sitemap and the redirect map
/// all need to agree on it, and "just call toSlug" is advice that holds until
/// somebody writes `city.toLowerCase()` inline at the fifth call site.
export function citySlug(city: string): string {
  return toSlug(city)
}
