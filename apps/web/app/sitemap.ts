import type { MetadataRoute } from 'next'
import { prisma } from '@storage/db'
import { absoluteUrl } from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { citySlugPath, facilityPagePath } from '@/lib/marketing/paths'
import { citiesWithFacilities } from '@/lib/facility/city-facilities'
import { GUIDES, guidePath } from '@/lib/guides/catalog'

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
  // B-082 part 3. The hub; the guides under it are appended below from the same
  // catalog the routes are generated from, so a new guide reaches the sitemap
  // by being written rather than by somebody remembering this file.
  { path: '/guides', priority: 0.6, changeFrequency: 'monthly' },
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
  // when ≥1 facility exists in the city", which is the same rule the page
  // enforces by 404ing. Both read `citiesWithFacilities`, so the sitemap
  // cannot advertise a URL the page refuses to render.
  //
  // Listed from B-082 part 2, which built the page. Until then this block
  // computed the list and threw it away, because the page was a 404 — and the
  // comment deferred it to "B-071", which shipped reviews instead.
  const cityEntries: MetadataRoute.Sitemap = (await citiesWithFacilities()).map((city) => ({
    url: absoluteUrl(origin, citySlugPath(city.state, city.city)),
    lastModified: city.lastModified,
    // Below a facility page and above the static set: a city page is a route
    // to a facility, not the thing being rented.
    priority: 0.7,
    changeFrequency: 'daily',
  }))

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(origin, route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  // B-082 part 3. One entry per guide, from the catalog the routes read — so a
  // guide cannot exist without being listed, and cannot be listed without
  // existing. `lastModified` is the guide's own `updated` date, typed by
  // whoever changed the words: stamping `now` here would tell a crawler that
  // every guide changed on every deploy, which is how the field gets ignored.
  const guideEntries: MetadataRoute.Sitemap = GUIDES.map((guide) => ({
    url: absoluteUrl(origin, guidePath(guide)),
    lastModified: new Date(`${guide.updated}T00:00:00Z`),
    changeFrequency: 'monthly',
    priority: 0.5,
  }))

  return [...staticEntries, ...guideEntries, ...cityEntries, ...facilityEntries]
  // ponytail: one flat sitemap. FR-SEO-5 wants segmentation above 1,000 URLs;
  // with one entry per facility plus one per city that is hundreds of
  // facilities away, and a sitemap index built now would be scaffolding for a
  // scale this does not have. The upgrade is a `sitemap.ts` returning an index
  // plus `sitemap/[id].ts` segments, and the trigger is the returned length
  // approaching 1,000.
}
