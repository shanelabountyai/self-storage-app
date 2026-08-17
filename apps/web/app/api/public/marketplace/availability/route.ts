import { INVENTORY_CACHE_TTL_SECONDS } from '@/lib/inventory/public-inventory'
import { marketplaceFeed } from '@/lib/marketing/marketplace-feed'

// B-082 part 1. PRD 04 §3.2 US-4. The whole-portfolio availability feed a
// marketplace polls — the counterpart to the per-facility
// /api/public/facilities/[slug]/inventory the website itself uses.
//
// Unauthenticated on purpose. Everything here is already on the public site:
// addresses, sizes, features, availability and published rates. A key would
// protect nothing and would turn "list us" into an integration project.
//
// The same `s-maxage` ceiling as the per-facility route, and for the same
// reason: FR-2.1 puts a five-minute worst case on published availability, and
// a marketplace advertising a unit we sold twenty minutes ago is the same
// oversell that ceiling exists to bound.
export async function GET() {
  const feed = await marketplaceFeed()

  return Response.json(feed, {
    headers: {
      'Cache-Control': `public, max-age=0, s-maxage=${INVENTORY_CACHE_TTL_SECONDS}`,
    },
  })
}
