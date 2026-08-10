import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkoutResumeUrl,
  mintCheckoutResumeToken,
  verifyCheckoutResumeToken,
} from '../apps/web/lib/checkout/resume-token'

// PRD 04 US-9 AC1 — "a link resuming the exact unit/quote."

const SECRET = 'test-secret-for-checkout-resume-tokens-only'
let originalSecret: string | undefined

beforeAll(() => {
  originalSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = SECRET
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe('checkout resume tokens', () => {
  const NOW = new Date('2026-07-01T12:00:00Z')

  it('round-trips the session id', () => {
    const token = mintCheckoutResumeToken('session_123', NOW)
    expect(verifyCheckoutResumeToken(token, NOW)).toEqual({ valid: true, sessionId: 'session_123' })
  })

  it('expires after 14 days — unlike the unsubscribe token, this has a real ceiling', () => {
    const token = mintCheckoutResumeToken('session_123', NOW)
    const justBefore = new Date(NOW.getTime() + 14 * 24 * 3_600_000 - 1000)
    const justAfter = new Date(NOW.getTime() + 14 * 24 * 3_600_000 + 1000)
    expect(verifyCheckoutResumeToken(token, justBefore).valid).toBe(true)
    expect(verifyCheckoutResumeToken(token, justAfter)).toEqual({ valid: false, reason: 'expired' })
  })

  it('refuses a tampered session id', () => {
    const token = mintCheckoutResumeToken('session_123', NOW)
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ v: 1, s: 'session_999', exp: NOW.getTime() + 1_000_000 })).toString('base64url')}.${signature}`
    expect(verifyCheckoutResumeToken(forged, NOW)).toEqual({ valid: false, reason: 'bad_signature' })
  })

  it('refuses a malformed token', () => {
    expect(verifyCheckoutResumeToken('nope', NOW)).toEqual({ valid: false, reason: 'malformed' })
  })

  it('builds the URL from an origin, trailing slash and all', () => {
    const token = mintCheckoutResumeToken('session_123', NOW)
    expect(checkoutResumeUrl(token, 'https://example.com/')).toBe(`https://example.com/checkout/resume/${token}`)
  })
})
