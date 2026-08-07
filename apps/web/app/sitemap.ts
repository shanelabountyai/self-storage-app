import type { MetadataRoute } from 'next'
import { prisma } from '@storage/db'
import { absoluteUrl, citySlug } from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { citySlugPath, facilityPagePath } from '@/lib/marketing/paths'

// PRD 04 FR-SEO-5 / US-3 AC1 (B-066). The sitemap, generated from the records.
//
// "auto-regenerates on facility/page publish events and includes lastmod."
// Regenerated per request rather than on an event: `force-dynamic` plus a
// database read is simpler than an invalidation hook, and at this scale the
// query is a handful of rows. FR-SEO-5's segmentation threshold is 1,000 URLs
// and the honest position is that we are two orders of magnitude away — see
// the note at the bottom for what changes when that stops being true.
//
// `lastmod` is the facility's own `updatedAt`, not the build time. A sitemap
// that stamps every URL with "now" on every deploy is telling crawlers that
// every page changed, every deploy — which trains them to ignore the field.

export const dynamic = 'force-dynamic'
export const revalidate = 0

/// Pages that exist regardless of inventory. Priorities are relative within
/// this site only; they are a hint about internal importance, not a ranking
/// lever, and setting everything to 1.0 says nothing at all.
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/storage/search', priority: 0.8, changeFrequency: 'daily' },
  { path: '/storage/size-guide', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/faq', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/accessibility', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()

  const facilities = await prisma.facility.findMany({
    // Only what a renter can actually rent. A facility that is not taking
    // customers has a page that either 404s or wastes a crawl, and inviting a
    // crawler to either is worse than not listing it.
    where: { status: 'active' },
    select: { slug: true, city: true, state: true, updatedAt: true },
    orderBy: { name: 'asc' },
  })

  const now = new Date()

  const facilityEntries: MetadataRoute.Sitemap = facilities.map((facility) => ({
    url: absoluteUrl(origin, facilityPagePath(facility)),
    lastModified: facility.updatedAt,
    changeFrequency: 'daily',
    // Facility pages are the point of the site. Everything else routes to them.
    priority: 0.9,
  }))

  // One entry per city that actually has a facility — US-4 AC1: "indexable only
  // when ≥1 facility exists in the city". Derived from the same rows rather
  // than a second query, so the two lists cannot disagree about which cities
  // exist. The page itself is B-071; listing it before it renders would be
  // inviting a crawl of a 404, so this stays keyed to what exists.
  const cities = new Map<string, { state: string; city: string; lastModified: Date }>()
  for (const facility of facilities) {
    const key = `${facility.state.toLowerCase()}/${citySlug(facility.city)}`
    const existing = cities.get(key)
    if (!existing || existing.lastModified < facility.updatedAt) {
      cities.set(key, { state: facility.state, city: facility.city, lastModified: facility.updatedAt })
    }
  }

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(origin, route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  return [...staticEntries, ...facilityEntries]
  // ponytail: one flat sitemap. FR-SEO-5 wants segmentation above 1,000 URLs;
  // with one entry per facility that is 1,000 facilities away, and a sitemap
  // index built now would be scaffolding for a scale this does not have. The
  // upgrade is a `sitemap.ts` returning an index plus `sitemap/[id].ts`
  // segments, and the trigger is `facilities.length + STATIC_ROUTES.length`
  // approaching 1,000.
}

/// Exported for the test: which city pages the sitemap would list once B-071
/// ships them. Kept out of the returned entries deliberately — see above.
export async function sitemapCityPaths(): Promise<string[]> {
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { city: true, state: true },
  })
  return [...new Set(facilities.map((facility) => citySlugPath(facility.state, facility.city)))].sort()
}
