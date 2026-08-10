import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

// PRD 05 US-13 AC2 / FR-MSG-3 (B-072). "A working one-click unsubscribe...
// unsubscribe takes effect immediately... resolves without login."
//
// Signed, not stored — the same device `quote-token.ts` uses and for the same
// reason: an unsubscribe link's whole purpose is to work months after it was
// sent, so there is nothing to revoke and nothing worth a database row on a
// hot outbound path. Unlike a quote, it never expires — a marketing email
// opened in a stale inbox six months later must still unsubscribe on the
// first click, not fail and make the recipient go looking for another way.
//
// Scoped to the ADDRESS, not to a tenant or a message: unsubscribing suppresses
// an inbox, which is exactly what `Suppression` keys on (`channel`, `address`).
// A token bound to a tenant would do nothing for a lead, who has no tenant id.

const VERSION = 1

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is required to sign unsubscribe tokens')
  }
  return Buffer.from(
    hkdfSync('sha256', secret, 'storage-unsubscribe-token', `unsubscribe-token-v${VERSION}`, 32),
  )
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingKey()).update(encodedPayload).digest('base64url')
}

type Payload = { v: number; a: string }

export function mintUnsubscribeToken(address: string): string {
  const payload: Payload = { v: VERSION, a: address.toLowerCase() }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function unsubscribeUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/unsubscribe/${token}`
}

export type UnsubscribeVerdict = { valid: true; address: string } | { valid: false }

export function verifyUnsubscribeToken(token: string): UnsubscribeVerdict {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false }
  const [encoded, providedSignature] = parts

  const expected = Buffer.from(sign(encoded))
  const provided = Buffer.from(providedSignature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { valid: false }
  }

  let payload: Payload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return { valid: false }
  }
  if (payload.v !== VERSION || typeof payload.a !== 'string' || !payload.a) {
    return { valid: false }
  }

  return { valid: true, address: payload.a }
}
