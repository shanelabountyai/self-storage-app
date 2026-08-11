import type { MetadataRoute } from 'next'
import { NOINDEX_PREFIXES } from '@storage/core/marketing'
import { hasCanonicalDomain, siteOrigin } from '@/lib/marketing/origin'

// PRD 04 FR-SEO-5 / US-3 AC2: "robots.txt allows marketing routes;
// account/portal/checkout routes are noindex."
//
// The disallow list is generated from the SAME constant the middleware stamps
// `X-Robots-Tag` from, so the two can never disagree — a path disallowed here
// but not stamped there is one a crawler that ignores robots.txt will happily
// index, and every crawler worth worrying about ignores robots.txt sometimes.

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  // No real domain yet means this is a `.vercel.app` host, and nothing on it
  // should reach an index — see `hasCanonicalDomain`. Deliberately a blanket
  // refusal rather than the usual allow-list: the objection is to the HOST, not
  // to particular routes on it.
  if (!hasCanonicalDomain()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: NOINDEX_PREFIXES.map((prefix) => `${prefix}/`),
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  }
}
