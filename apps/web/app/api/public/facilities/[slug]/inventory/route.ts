import {
  INVENTORY_CACHE_TTL_SECONDS,
  publicInventoryForFacility,
} from '@/lib/inventory/public-inventory'

// PRD 01 FR-2.1. The unauthenticated pricing/availability read for the customer
// site — the public counterpart to the staff-only
// /api/facilities/[facilityId]/rates endpoint.
//
// Keyed by slug, not id: the slug is already the public identifier in
// /storage/{state}/{city}/{slug}, and internal ids have no business in a
// customer-facing URL.
//
// Staleness is bounded with Cache-Control rather than `export const revalidate`.
// Route handlers are dynamic by default in Next 16, and the build output
// confirms it: `revalidate` on this segment marked the route ƒ (Dynamic) and
// cached nothing. An explicit header is what Vercel's edge cache actually
// honours, and unlike segment config it can be applied to hits but not misses.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const inventory = await publicInventoryForFacility(slug)
  if (!inventory) {
    // Deliberately uncached: a facility that goes live should be reachable
    // immediately, not after a stale 404 ages out of the CDN.
    return Response.json(
      { error: 'not_found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Quote tokens inside a cached response are shared by everyone who fetches it
  // within the window. That is fine — a quote binds a facility, a unit type and
  // a price, never a person, and anyone can mint one by asking. The window just
  // eats into the token's TTL: a response served at the end of the 5 minutes
  // still leaves 25 of the token's 30 minutes.
  return Response.json(inventory, {
    headers: {
      // `s-maxage` only, with no stale-while-revalidate: FR-2.1 sets a ≤5-minute
      // worst case, and SWR would let the edge serve past that ceiling.
      // `max-age=0` keeps browsers from holding a private copy the operator
      // cannot purge.
      'Cache-Control': `public, max-age=0, s-maxage=${INVENTORY_CACHE_TTL_SECONDS}`,
    },
  })
}
