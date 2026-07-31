import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mintQuoteToken,
  QUOTE_TTL_MS,
  verifyQuoteFor,
  verifyQuoteToken,
} from '../apps/web/lib/pricing/quote-token'

// PRD 01 FR-2.2 — "the price the renter saw is the price charged". Everything
// here is a test of that one sentence: the price must survive the round trip
// intact, and must not survive being altered.

const SECRET = 'test-secret-for-quote-tokens-only'
let originalSecret: string | undefined

const FACILITY = 'fac_austin_south'
const UNIT_TYPE = 'ut_10x10_climate'
const NOW = new Date('2026-07-31T12:00:00Z')

function quote(overrides: Partial<Parameters<typeof mintQuoteToken>[0]> = {}) {
  return mintQuoteToken({
    facilityId: FACILITY,
    unitTypeId: UNIT_TYPE,
    streetRateCents: 19_900,
    webRateCents: 14_900,
    now: NOW,
    ...overrides,
  })
}

beforeAll(() => {
  originalSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = SECRET
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe('quote tokens', () => {
  it('round-trips the exact price it was minted with', () => {
    const { token, expiresAt } = quote()
    const verdict = verifyQuoteToken(token, NOW)

    expect(verdict.valid).toBe(true)
    if (!verdict.valid) return
    expect(verdict.quote).toMatchObject({
      facilityId: FACILITY,
      unitTypeId: UNIT_TYPE,
      streetRateCents: 19_900,
      webRateCents: 14_900,
    })
    expect(expiresAt.getTime()).toBe(NOW.getTime() + QUOTE_TTL_MS)
  })

  it('rejects a token whose price has been edited', () => {
    // The attack the whole design exists to stop: re-encode the payload with a
    // cheaper web rate and present it at checkout.
    const [encoded, signature] = quote().token.split('.')
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    payload.w = 100
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`

    expect(verifyQuoteToken(forged, NOW)).toEqual({ valid: false, reason: 'bad_signature' })
  })

  it('rejects a token signed with AUTH_SECRET directly', () => {
    // Key separation: quote signing uses a key *derived* from AUTH_SECRET, so
    // possessing a valid session signature is not enough to mint a price.
    const [encoded] = quote().token.split('.')
    const naive = createHmac('sha256', SECRET).update(encoded).digest('base64url')

    expect(verifyQuoteToken(`${encoded}.${naive}`, NOW)).toEqual({
      valid: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a token signed under a different secret', () => {
    const { token } = quote()
    process.env.AUTH_SECRET = 'a-completely-different-secret'
    try {
      expect(verifyQuoteToken(token, NOW)).toEqual({ valid: false, reason: 'bad_signature' })
    } finally {
      process.env.AUTH_SECRET = SECRET
    }
  })

  it('expires exactly at its TTL, not after', () => {
    const { token } = quote()
    const expiry = new Date(NOW.getTime() + QUOTE_TTL_MS)

    expect(verifyQuoteToken(token, new Date(expiry.getTime() - 1)).valid).toBe(true)
    // A quote valid *at* its expiry instant would be valid for one tick past
    // the hold window, so the boundary is closed deliberately.
    expect(verifyQuoteToken(token, expiry)).toEqual({ valid: false, reason: 'expired' })
  })

  it('rejects malformed tokens instead of throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.sig', 'payload.']) {
      expect(verifyQuoteToken(bad, NOW).valid, bad).toBe(false)
    }
  })

  it('refuses to mint without a secret', () => {
    delete process.env.AUTH_SECRET
    try {
      expect(() => quote()).toThrow(/AUTH_SECRET/)
    } finally {
      process.env.AUTH_SECRET = SECRET
    }
  })
})

describe('verifyQuoteFor', () => {
  it('accepts a quote for the unit type it was minted for', () => {
    const { token } = quote()
    expect(verifyQuoteFor(token, { facilityId: FACILITY, unitTypeId: UNIT_TYPE }, NOW).valid).toBe(
      true,
    )
  })

  it('refuses a cheap quote redeemed against a different unit type', () => {
    // Without this binding, a $69 locker quote would be spendable on a $249
    // drive-up unit — a valid signature is not the same as the right quote.
    const { token } = quote({ webRateCents: 6_900, unitTypeId: 'ut_5x5_locker' })

    expect(verifyQuoteFor(token, { facilityId: FACILITY, unitTypeId: UNIT_TYPE }, NOW)).toEqual({
      valid: false,
      reason: 'wrong_unit_type',
    })
  })

  it('refuses a quote from another facility', () => {
    const { token } = quote({ facilityId: 'fac_dallas_north' })

    expect(verifyQuoteFor(token, { facilityId: FACILITY, unitTypeId: UNIT_TYPE }, NOW)).toEqual({
      valid: false,
      reason: 'wrong_unit_type',
    })
  })

  it('still enforces expiry', () => {
    const { token } = quote()
    const late = new Date(NOW.getTime() + QUOTE_TTL_MS + 1)

    expect(verifyQuoteFor(token, { facilityId: FACILITY, unitTypeId: UNIT_TYPE }, late)).toEqual({
      valid: false,
      reason: 'expired',
    })
  })
})
