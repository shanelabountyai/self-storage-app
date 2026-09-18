import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from '../apps/web/lib/comms/unsubscribe-token'

// PRD 05 US-13 AC2 — "a working one-click unsubscribe... takes effect
// immediately."

const SECRET = 'test-secret-for-unsubscribe-tokens-only'
let originalSecret: string | undefined

beforeAll(() => {
  originalSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = SECRET
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe('unsubscribe tokens', () => {
  it('round-trips the address', () => {
    const token = mintUnsubscribeToken('Ada@Example.com', 'en')
    expect(verifyUnsubscribeToken(token)).toEqual({ valid: true, address: 'ada@example.com', locale: 'en' })
  })

  it('carries the language of the email it was minted for, signed (B-321)', () => {
    const token = mintUnsubscribeToken('ada@example.com', 'es')
    expect(verifyUnsubscribeToken(token)).toEqual({ valid: true, address: 'ada@example.com', locale: 'es' })
    // The page trusts it, so a visitor must not be able to swap it.
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ v: 1, a: 'ada@example.com', l: 'en' })).toString('base64url')}.${signature}`
    expect(verifyUnsubscribeToken(forged)).toEqual({ valid: false })
  })

  it('never expires — no exp field at all', () => {
    // A marketing email opened six months later must still unsubscribe on the
    // first click.
    const token = mintUnsubscribeToken('ada@example.com', 'en')
    expect(token).not.toContain('"exp"')
  })

  it('refuses a tampered address', () => {
    const token = mintUnsubscribeToken('ada@example.com', 'en')
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ v: 1, a: 'someoneelse@example.com' })).toString('base64url')}.${signature}`
    expect(verifyUnsubscribeToken(forged)).toEqual({ valid: false })
  })

  it('refuses a malformed token', () => {
    expect(verifyUnsubscribeToken('not-a-token')).toEqual({ valid: false })
    expect(verifyUnsubscribeToken('')).toEqual({ valid: false })
    expect(verifyUnsubscribeToken('a.b.c')).toEqual({ valid: false })
  })

  it('refuses a token signed under a different secret', () => {
    const token = mintUnsubscribeToken('ada@example.com', 'en')
    process.env.AUTH_SECRET = 'a-different-secret'
    expect(verifyUnsubscribeToken(token)).toEqual({ valid: false })
    process.env.AUTH_SECRET = SECRET
  })

  it('builds the URL from an origin, trailing slash and all', () => {
    const token = mintUnsubscribeToken('ada@example.com', 'en')
    expect(unsubscribeUrl(token, 'https://example.com/')).toBe(`https://example.com/unsubscribe/${token}`)
  })
})
