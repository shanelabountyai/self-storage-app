import { describe, expect, it } from 'vitest'
import { isFreshlyAuthenticated, REAUTH_FRESH_SECONDS } from '../apps/web/lib/auth/reauth-freshness'

// B-033 / PRD 01 US-701. Pure freshness logic — no session, no database.

describe('isFreshlyAuthenticated', () => {
  it('is fresh immediately after signing in', () => {
    const now = new Date()
    const authTime = Math.floor(now.getTime() / 1000)
    expect(isFreshlyAuthenticated(authTime, now)).toBe(true)
  })

  it('is fresh right up to the boundary', () => {
    const now = new Date()
    const authTime = Math.floor(now.getTime() / 1000) - (REAUTH_FRESH_SECONDS - 1)
    expect(isFreshlyAuthenticated(authTime, now)).toBe(true)
  })

  it('is stale once the window has passed', () => {
    const now = new Date()
    const authTime = Math.floor(now.getTime() / 1000) - (REAUTH_FRESH_SECONDS + 1)
    expect(isFreshlyAuthenticated(authTime, now)).toBe(false)
  })

  it('is stale for a session authenticated a day ago — the 30-day cookie is not the same as a fresh sign-in', () => {
    const now = new Date()
    const oneDayAgo = Math.floor(now.getTime() / 1000) - 24 * 60 * 60
    expect(isFreshlyAuthenticated(oneDayAgo, now)).toBe(false)
  })
})
