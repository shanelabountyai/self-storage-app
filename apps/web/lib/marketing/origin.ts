// PRD 04 FR-SEO-2/5. The site's own absolute origin.
//
// Sitemaps and canonical tags are the two places a relative URL is worthless —
// a sitemap entry without a scheme is invalid, and a relative canonical is
// ignored. Both need this, and both need it to be the SAME value, which is why
// it is resolved once here rather than assembled per caller.
//
// `NEXT_PUBLIC_SITE_URL` wins when set, because a custom domain is what should
// appear in search results rather than the `.vercel.app` deployment host.
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  // Localhost rather than a guessed production URL: a sitemap generated on a
  // laptop that names the real domain is a sitemap somebody will eventually
  // submit by accident.
  return 'http://localhost:3000'
}

/// Whether this deployment is serving from its REAL domain.
///
/// `NEXT_PUBLIC_SITE_URL` is set deliberately, by a person, once a domain
/// exists. Its absence means the site is answering on a `.vercel.app` host —
/// a preview, or a production deployment that has not been pointed at a domain
/// yet. Neither should ever be indexed: FR-SEO-2's whole concern is that every
/// variant a crawler can reach is a separate URL as far as an index is
/// concerned, splitting the ranking signal of the page they all point at. A
/// `.vercel.app` twin of the real site is the largest such variant there is,
/// and an empty pre-launch storefront is the worst possible thing to have
/// indexed under it.
export function hasCanonicalDomain(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SITE_URL)
}
