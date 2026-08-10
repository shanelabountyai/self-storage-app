import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

// PRD 04 US-9 AC1 (B-073). The abandonment email's own resume link.
//
// A DIFFERENT token from the session's own `tokenHash` on purpose. The live
// session token is minted once, at step 1, and only its hash is ever stored —
// so there is no plaintext left to put in an email sent days later. Rather
// than storing a second plaintext token at rest (or worse, reusing a hash
// lookup nothing can reverse), this is signed and unstored, the same device
// `quote-token.ts` and `unsubscribe-token.ts` use — with a real expiry,
// unlike the unsubscribe token, because "come back and finish THIS checkout"
// is a claim with a natural ceiling the way "stop mailing me" is not.
//
// Visiting the link does not resume the session directly — see
// `apps/web/app/checkout/resume/[token]/page.tsx`. It mints a FRESH real
// session token at click time and redirects into the ordinary flow, so
// `advance`/`extendLock`/`relock` see exactly the hashed-token shape they
// already handle, unchanged.

const VERSION = 1
const TTL_MS = 14 * 24 * 3_600_000

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is required to sign checkout resume tokens')
  }
  return Buffer.from(
    hkdfSync('sha256', secret, 'storage-checkout-resume-token', `checkout-resume-token-v${VERSION}`, 32),
  )
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingKey()).update(encodedPayload).digest('base64url')
}

type Payload = { v: number; s: string; exp: number }

export function mintCheckoutResumeToken(sessionId: string, now: Date = new Date()): string {
  const payload: Payload = { v: VERSION, s: sessionId, exp: now.getTime() + TTL_MS }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function checkoutResumeUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/checkout/resume/${token}`
}

export type ResumeVerdict =
  | { valid: true; sessionId: string }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyCheckoutResumeToken(token: string, now: Date = new Date()): ResumeVerdict {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' }
  const [encoded, providedSignature] = parts

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
  if (payload.v !== VERSION || typeof payload.s !== 'string' || !Number.isInteger(payload.exp)) {
    return { valid: false, reason: 'malformed' }
  }
  if (payload.exp <= now.getTime()) return { valid: false, reason: 'expired' }

  return { valid: true, sessionId: payload.s }
}
