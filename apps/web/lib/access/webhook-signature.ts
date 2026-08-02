import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// PRD 03 FR-8: "Simulator exposes the same webhook signature scheme as the
// design's real-vendor contract so security code paths are exercised."
//
// Timestamped HMAC-SHA256, the same shape Stripe uses (B-019 already leans on
// that pattern for our own webhook) and the shape most gate-vendor webhooks
// use in practice. The header carries the timestamp so a captured payload
// cannot be replayed indefinitely — the check that matters is not "was this
// signed with the right secret" alone, it is "was this signed recently".

const TOLERANCE_SECONDS = 5 * 60

let devSecret: string | null = null

/// The secret both the route and the simulator sign against.
///
/// Outside production, an unset `HARDWARE_WEBHOOK_SECRET` gets a random value
/// generated once per process rather than failing closed the way B-019's
/// Stripe webhook does. The two are not the same kind of secret: Stripe's
/// protects a boundary an external party can actually reach, so failing closed
/// is the only honest option. Nothing external calls this endpoint yet — only
/// the in-process simulator (B-028) — so a real signature is still generated
/// and verified end to end, which is what FR-8 asks to be exercised, without
/// forcing a manual setup step before US-7's "zero external dependencies" demo
/// will run.
// ponytail: process-local dev secret; require a real HARDWARE_WEBHOOK_SECRET
// once a real vendor's webhook can reach this route (B-085).
export function hardwareWebhookSecret(): string | null {
  if (process.env.HARDWARE_WEBHOOK_SECRET) return process.env.HARDWARE_WEBHOOK_SECRET
  if (process.env.NODE_ENV === 'production') return null
  devSecret ??= randomBytes(32).toString('hex')
  return devSecret
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function signHardwarePayload(body: string, secret: string, now: Date = new Date()): string {
  const timestamp = Math.floor(now.getTime() / 1000)
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`
}

export class InvalidHardwareSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHardwareSignatureError'
  }
}

/// Verifies a signed body, the same way `stripe.webhooks.constructEvent`
/// does: parse the header, recompute the HMAC over `${timestamp}.${body}`,
/// compare in constant time, and reject anything outside the tolerance
/// window. Throws rather than returning false/true, so a caller cannot
/// forget to check the result — the same shape B-019 already established.
export function verifyHardwareSignature(
  body: string,
  header: string,
  secret: string,
  now: Date = new Date(),
): void {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=') as [string, string]),
  )
  const timestamp = Number(parts.t)
  const signature = parts.v1
  if (!Number.isFinite(timestamp) || !signature) {
    throw new InvalidHardwareSignatureError('Malformed signature header')
  }

  const expected = hmac(secret, timestamp, body)
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new InvalidHardwareSignatureError('Signature does not match')
  }

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - timestamp)
  if (ageSeconds > TOLERANCE_SECONDS) {
    throw new InvalidHardwareSignatureError('Signature is outside the allowed time window')
  }
}
