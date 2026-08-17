import { captureMarketplaceLead, partnerForKey } from '@/lib/marketing/marketplace-leads'

// B-082 part 1. PRD 04 §3.2 US-4's "lead attribution in".
//
// Authenticated, unlike the availability feed beside it — that one publishes
// what is already on the website, this one WRITES. The key decides which
// partner the lead is credited to, so it is the trust boundary for a number
// somebody eventually gets invoiced on.
export async function POST(request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  const partner = partnerForKey(presented)
  if (!partner) {
    // No detail, and the same answer for "no key", "wrong key" and "no partners
    // configured". Anything more tells an unauthenticated caller which of the
    // three it is.
    return Response.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
  const asOptionalString = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null

  const result = await captureMarketplaceLead(partner, {
    facilitySlug: asString(input.facilitySlug),
    name: asString(input.name),
    email: asString(input.email),
    phone: asOptionalString(input.phone),
    unitTypeId: asOptionalString(input.unitTypeId),
    moveInDate: asOptionalString(input.moveInDate),
    note: asOptionalString(input.note),
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  // `deduplicated` is reported rather than hidden: a partner sending the same
  // renter twice should be able to see that we merged them, instead of
  // believing they delivered two leads and later disputing one move-in.
  return Response.json(
    { leadId: result.leadId, deduplicated: result.deduplicated, channel: 'aggregator', source: partner },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
