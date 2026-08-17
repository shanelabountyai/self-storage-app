import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@storage/db'
import type { TouchPoint } from '@storage/core/marketing'
import { captureLead, type CaptureResult } from './lead-capture'

// B-082 part 1. PRD 04 §3.2 US-4: "lead attribution in".
//
// A marketplace posts a lead here and it lands as a `Lead` with
// `channel: 'aggregator'` — not derived, not guessed, and not taken from the
// request body. This is the inbound half of the same problem the outbound half
// solves: an aggregator lead that arrives looking like an ordinary web form is
// an aggregator move-in credited to organic three weeks later, which is how a
// business defunds the channel that was working while paying the one that was
// not.
//
// Nothing here writes a lead itself. `captureLead` does, exactly as it does for
// the public form, so dedup (FR-LEAD-1), consent, the drip sequence and every
// validation rule apply identically. A second lead-writing path is how the two
// drift.

/// Partner name → shared key, from `MARKETPLACE_LEAD_KEYS` as a JSON object:
/// `{"sparefoot":"<key>","storable":"<key>"}`.
///
/// One env var rather than a table because this is a handful of partners
/// negotiated by contract, not something an operator self-serves. When that
/// stops being true it earns a model and a screen; until then a table would be
/// a migration, a CRUD screen and a permission for three rows.
function partnerKeys(): Map<string, string> {
  const raw = process.env.MARKETPLACE_LEAD_KEYS
  if (!raw) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([name, key]) => name.length > 0 && typeof key === 'string' && key.length > 0)
        .map(([name, key]) => [name, key as string]),
    )
  } catch {
    // A malformed value means NO partner authenticates, rather than falling
    // back to an empty-string key that every request would match.
    return new Map()
  }
}

/// The partner a presented key belongs to, or null.
///
/// The channel is decided by WHICH KEY AUTHENTICATED, never by a field in the
/// body. Attribution is what an aggregator invoices against, so a body that
/// could name its own channel is a body that could name a competitor's.
///
/// Compared in constant time over a digest, so neither the key's length nor its
/// content leaks through response timing, and every candidate is checked even
/// after a match — a loop that returns early re-introduces the oracle the
/// constant-time compare removed.
export function partnerForKey(presented: string | null | undefined): string | null {
  if (!presented) return null
  const offered = createHash('sha256').update(presented).digest()

  let matched: string | null = null
  for (const [name, key] of partnerKeys()) {
    const known = createHash('sha256').update(key).digest()
    if (timingSafeEqual(offered, known)) matched = name
  }
  return matched
}

export type MarketplaceLeadInput = {
  facilitySlug: string
  name: string
  email: string
  phone?: string | null
  unitTypeId?: string | null
  /// ISO date. Rejected rather than silently dropped when unparseable — a
  /// move-in date is what a follow-up sorts by.
  moveInDate?: string | null
  note?: string | null
}

export type MarketplaceLeadResult =
  | { ok: true; leadId: string; deduplicated: boolean }
  | { ok: false; status: 400 | 401 | 404; error: string }

export async function captureMarketplaceLead(
  partner: string,
  input: MarketplaceLeadInput,
): Promise<MarketplaceLeadResult> {
  const facility = await prisma.facility.findUnique({
    where: { slug: input.facilitySlug },
    select: { id: true, status: true },
  })
  // A lead for a site we no longer advertise is refused rather than filed
  // somewhere nobody looks — the partner needs to stop sending them, and a 200
  // does not tell them that.
  if (!facility || facility.status !== 'active') {
    return { ok: false, status: 404, error: 'unknown_facility' }
  }

  let moveInDate: Date | null = null
  if (input.moveInDate) {
    const parsed = new Date(input.moveInDate)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, error: 'invalid_move_in_date' }
    }
    moveInDate = parsed
  }

  // The attribution, fixed by the authenticated partner. `source` is the
  // partner's own name so the report can tell SpareFoot from Storable — they
  // are separate contracts at separate rates, and `aggregator` alone cannot
  // answer "which one".
  const touch: TouchPoint = {
    source: partner,
    medium: 'marketplace',
    campaign: null,
    landingPage: null,
    channel: 'aggregator',
  }

  const result: CaptureResult = await captureLead(
    {
      facilityId: facility.id,
      name: input.name ?? '',
      email: input.email ?? '',
      phone: input.phone ?? '',
      unitTypeId: input.unitTypeId ?? null,
      moveInDate,
      note: input.note ?? null,
      // `quote` and not `callback`: a marketplace lead carries no promise that
      // anyone asked to be phoned, and `callback` makes phone mandatory.
      kind: 'quote',
      // No marketing consent. A partner cannot consent on a renter's behalf,
      // and an unchecked box is silence rather than a recorded decline.
    },
    {
      firstTouch: touch,
      lastTouch: touch,
      landingPage: null,
      referrer: null,
      gclid: null,
      selfHost: null,
      // Deliberately null, which skips the per-submitter rate limit.
      //
      // That limit is an anti-bot measure for a public form, keyed on the
      // submitter's IP. Every lead from a partner arrives from the SAME address,
      // so applying it here would reject the sixth genuine lead of any ten
      // minutes — silently losing rentals from the channel that charges most for
      // them. An authenticated partner is already rate-limited by the fact that
      // it holds a key we issued and can revoke.
      ip: null,
    },
  )

  if (result.ok) return { ok: true, leadId: result.leadId, deduplicated: result.deduplicated }
  // The honeypot cannot fire here (nothing sets it), so any failure left is a
  // validation problem the partner has to fix, and naming the field is what
  // lets them fix it.
  return { ok: false, status: 400, error: result.field === 'silent' ? 'discarded' : result.field }
}
