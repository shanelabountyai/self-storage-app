import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

// PRD 01 FR-2.2: "the website is display-only and passes a quote token through
// checkout so the price the renter saw is the price charged."
//
// These are SIGNED, not stored — the opposite of B-003's auth tokens, and for a
// specific reason. An auth token needs revocation, so it lives in a row that can
// be burned. A quote is the reverse: its entire purpose is to be honoured even
// after the street rate moves, so there is nothing to revoke. Expiry is the only
// bound it needs, and signing keeps a hot public path off the database.
//
// The key is derived from AUTH_SECRET rather than reusing it directly, so a
// quote signature can never be confused with a session signature (key
// separation). One secret to configure, two independent keys.

/// Bridges "saw a price" to "committed to it". Deliberately short: once a
/// Reservation exists, `Reservation.quotedRateCents` is the durable record of
/// the agreed price, so the token does not need to survive the hold. Matches
/// the 30-minute checkout unit lock (PRD 01 FR-4.1).
export const QUOTE_TTL_MS = 30 * 60 * 1000

/// Bumped when the payload gains a field — FR-2.3's server-validated
/// promotions (B-070) are the expected v2. Old tokens are rejected rather than
/// migrated, which a 30-minute TTL makes cheap: the worst case is that a
/// customer mid-browse gets re-quoted at the same price.
const VERSION = 1

export type Quote = {
  facilityId: string
  unitTypeId: string
  streetRateCents: number
  webRateCents: number
  issuedAt: Date
  expiresAt: Date
}

type Payload = {
  v: number
  f: string
  t: string
  s: number
  w: number
  iat: number
  exp: number
}

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    // Failing loudly beats minting tokens under a guessable key.
    throw new Error('AUTH_SECRET is required to sign quote tokens')
  }
  // Salt need not be secret; it exists to domain-separate the derivation.
  return Buffer.from(
    hkdfSync('sha256', secret, 'storage-quote-token', `quote-token-v${VERSION}`, 32),
  )
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingKey()).update(encodedPayload).digest('base64url')
}

export type MintQuoteInput = {
  facilityId: string
  unitTypeId: string
  streetRateCents: number
  webRateCents: number
  now?: Date
  ttlMs?: number
}

export function mintQuoteToken(input: MintQuoteInput): { token: string; expiresAt: Date } {
  const issuedAt = input.now ?? new Date()
  const expiresAt = new Date(issuedAt.getTime() + (input.ttlMs ?? QUOTE_TTL_MS))

  const payload: Payload = {
    v: VERSION,
    f: input.facilityId,
    t: input.unitTypeId,
    s: input.streetRateCents,
    w: input.webRateCents,
    iat: issuedAt.getTime(),
    exp: expiresAt.getTime(),
  }

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${encoded}.${sign(encoded)}`, expiresAt }
}

export type QuoteVerdict =
  | { valid: true; quote: Quote }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_version' }

export function verifyQuoteToken(token: string, now: Date = new Date()): QuoteVerdict {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' }
  const [encoded, providedSignature] = parts

  // Signature is checked BEFORE the payload is trusted for anything, and in
  // constant time, so neither content nor timing leaks to a forger.
  const expected = Buffer.from(sign(encoded))
  const provided = Buffer.from(providedSignature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'bad_signature' }
  }

  let payload: Payload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  if (payload.v !== VERSION) return { valid: false, reason: 'wrong_version' }
  if (
    typeof payload.f !== 'string' ||
    typeof payload.t !== 'string' ||
    !Number.isInteger(payload.s) ||
    !Number.isInteger(payload.w) ||
    !Number.isInteger(payload.exp)
  ) {
    return { valid: false, reason: 'malformed' }
  }

  if (payload.exp <= now.getTime()) return { valid: false, reason: 'expired' }

  return {
    valid: true,
    quote: {
      facilityId: payload.f,
      unitTypeId: payload.t,
      streetRateCents: payload.s,
      webRateCents: payload.w,
      issuedAt: new Date(payload.iat),
      expiresAt: new Date(payload.exp),
    },
  }
}

/// Verifies a token AND that it is the quote for the thing actually being
/// rented. Without the binding check, a token minted for a $69 locker would be
/// redeemable against a $249 drive-up unit.
export function verifyQuoteFor(
  token: string,
  expected: { facilityId: string; unitTypeId: string },
  now: Date = new Date(),
): QuoteVerdict | { valid: false; reason: 'wrong_unit_type' } {
  const verdict = verifyQuoteToken(token, now)
  if (!verdict.valid) return verdict

  if (
    verdict.quote.facilityId !== expected.facilityId ||
    verdict.quote.unitTypeId !== expected.unitTypeId
  ) {
    return { valid: false, reason: 'wrong_unit_type' }
  }
  return verdict
}
