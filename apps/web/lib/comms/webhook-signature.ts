import { createHmac, timingSafeEqual } from 'node:crypto'

// PRD 05 FR-14 (B-054). Resend signs its delivery webhooks with Svix.
//
// Split out of the route for the same reason B-028 split the hardware one: the
// signature check is the whole security boundary of a public unauthenticated
// endpoint, and it deserves tests that do not need a running server. A forged
// `email.bounced` would suppress a real tenant's address and cut them off from
// every notice this system sends — a quiet denial of service against exactly
// the person a lien notice has to reach.
//
// There is no `svix` dependency here on purpose: the scheme is one HMAC, and a
// package whose whole job is one `createHmac` call is supply-chain surface we
// do not need.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

/// Svix signs `${id}.${timestamp}.${body}` with the raw secret bytes.
function digestFor(secret: string, id: string, timestamp: string, body: string): Buffer {
  // The secret is `whsec_` + standard base64 of the actual key material.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
}

/// Produces the `svix-signature` header for a payload. Only tests send; this
/// exists so a test can prove the verifier accepts a genuine signature rather
/// than only that it rejects garbage.
export function signResendPayload(input: {
  secret: string
  id: string
  timestamp: string
  body: string
}): string {
  return `v1,${digestFor(input.secret, input.id, input.timestamp, input.body).toString('base64')}`
}

/// Whether the header carries a valid signature for this exact body.
///
/// The header is a space-separated list of `v<n>,<base64>` — plural because a
/// secret rotation signs with both for a while. Any one matching is enough.
export function verifyResendSignature(input: {
  secret: string
  id: string
  timestamp: string
  body: string
  header: string
}): boolean {
  const expected = digestFor(input.secret, input.id, input.timestamp, input.body)

  return input.header.split(' ').some((part) => {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) return false
    const given = Buffer.from(value, 'base64')
    // timingSafeEqual throws on a length mismatch, so the length is checked
    // rather than caught — a throw here would 500 instead of rejecting.
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/// Whether the delivery is recent enough to act on.
///
/// The signature alone would happily validate a captured delivery from last
/// month, and re-applying an old `email.bounced` would re-suppress an address
/// that has since been fixed.
export function timestampIsFresh(timestamp: string, now: number = Date.now()): boolean {
  const age = Math.abs(now / 1000 - Number(timestamp))
  return Number.isFinite(age) && age <= SIGNATURE_TOLERANCE_SECONDS
}
