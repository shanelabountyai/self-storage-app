import type { MetadataRoute } from 'next'
import { NOINDEX_PREFIXES } from '@storage/core/marketing'
import { localePath } from '@/lib/i18n/routing'
import { LOCALES } from '@/lib/i18n'
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
        // B-262: once per locale. `/es/portal` is a real, reachable URL that
        // renders the portal in Spanish, so a disallow list naming only
        // `/portal/` leaves the Spanish half of every noindex route advertised
        // as crawlable — which is the same mistake as not having the list.
        disallow: LOCALES.flatMap((locale) =>
          NOINDEX_PREFIXES.map((prefix) => `${localePath(locale, prefix)}/`),
        ),
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  }
}
