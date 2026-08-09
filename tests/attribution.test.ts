import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_COOKIE_DAYS,
  DEDUP_WINDOW_DAYS,
  decodeTouch,
  dedupKeys,
  deriveChannel,
  encodeTouch,
  isWithinDedupWindow,
  MARKETING_CHANNELS,
  touchFrom,
} from '../packages/core/marketing/attribution'

// B-068 / PRD 04 FR-LEAD-1, FR-LEAD-2.

const SELF = 'storage.example.com'

describe('deriveChannel — FR-LEAD-2', () => {
  it('treats a gclid as proof of a paid click, whatever else is missing', () => {
    // The single most expensive misattribution available: a redirect strips
    // utm_medium, and paid traffic files itself as organic.
    expect(deriveChannel({ gclid: 'Cj0KCQ', referrer: 'https://www.google.com/' })).toBe(
      'paid_search',
    )
  })

  it('reads paid from the medium, not the source', () => {
    // `utm_source: google` says nothing about whether money changed hands.
    expect(deriveChannel({ utmSource: 'google', utmMedium: 'cpc' })).toBe('paid_search')
    expect(deriveChannel({ utmSource: 'google', utmMedium: 'organic' })).toBe('organic')
  })

  it('separates paid social from paid search', () => {
    expect(deriveChannel({ utmSource: 'facebook', utmMedium: 'paid-social' })).toBe('paid_social')
    expect(deriveChannel({ utmSource: 'facebook', utmMedium: 'cpc' })).toBe('paid_social')
  })

  it('recognises email campaigns', () => {
    expect(deriveChannel({ utmSource: 'mailchimp', utmMedium: 'email' })).toBe('email')
  })

  it('files a search-engine referrer with no tags as organic', () => {
    // FR-LEAD-2's rule, stated: "no UTMs + search-engine referrer → organic".
    for (const referrer of [
      'https://www.google.com/',
      'https://duckduckgo.com/?q=storage',
      'https://www.bing.com/search?q=x',
    ]) {
      expect(deriveChannel({ referrer, selfHost: SELF })).toBe('organic')
    }
  })

  it('files no referrer at all as direct', () => {
    expect(deriveChannel({ selfHost: SELF })).toBe('direct')
    expect(deriveChannel({ referrer: null, selfHost: SELF })).toBe('direct')
  })

  it('does not count our own pages as a referral from ourselves', () => {
    expect(deriveChannel({ referrer: `https://${SELF}/storage/search`, selfHost: SELF })).toBe(
      'direct',
    )
  })

  it('names aggregator traffic as what it is', () => {
    // PRD 04 §2: aggregators charge per completed move-in. The most expensive
    // channel there is, and it must not hide inside `referral`.
    expect(deriveChannel({ referrer: 'https://www.sparefoot.com/x', selfHost: SELF })).toBe(
      'aggregator',
    )
    expect(deriveChannel({ utmSource: 'sparefoot' })).toBe('aggregator')
  })

  it('files an ordinary site as a referral', () => {
    expect(deriveChannel({ referrer: 'https://someblog.example/post', selfHost: SELF })).toBe(
      'referral',
    )
  })

  it('does not mistake researchgate for a search engine', () => {
    // A "contains the word search" heuristic would, and misfiling inflates the
    // organic number this exists to protect.
    expect(deriveChannel({ referrer: 'https://www.researchgate.net/x', selfHost: SELF })).toBe(
      'referral',
    )
  })

  it('survives a malformed referrer', () => {
    expect(deriveChannel({ referrer: 'not a url', selfHost: SELF })).toBe('direct')
  })

  it('only ever returns a declared channel', () => {
    for (const input of [
      {},
      { utmMedium: 'something-nobody-has-heard-of' },
      { utmSource: 'x', utmMedium: 'y' },
      { referrer: 'https://t.co/abc', selfHost: SELF },
    ]) {
      expect(MARKETING_CHANNELS).toContain(deriveChannel(input))
    }
  })
})

describe('the attribution cookie', () => {
  const touch = touchFrom({
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'spring-10x10',
    landingPage: '/storage/tx/austin/south',
  })

  it('round-trips', () => {
    expect(decodeTouch(encodeTouch(touch))).toEqual(touch)
  })

  it('persists for 90 days — FR-LEAD-2', () => {
    expect(ATTRIBUTION_COOKIE_DAYS).toBe(90)
  })

  it('degrades to nothing on a malformed cookie rather than throwing', () => {
    // A cookie is attacker-controlled. A throw here would take down the form
    // somebody is trying to submit.
    for (const bad of ['', 'not-json', '%7Bbroken', encodeURIComponent('"a string"'), null]) {
      expect(() => decodeTouch(bad)).not.toThrow()
    }
    expect(decodeTouch('not-json')).toBeNull()
  })

  it('falls back to direct when the stored channel is not one of ours', () => {
    const forged = encodeURIComponent(JSON.stringify({ ch: 'free_money' }))
    expect(decodeTouch(forged)?.channel).toBe('direct')
  })

  it('caps what a cookie can push into a database column', () => {
    const huge = encodeURIComponent(JSON.stringify({ s: 'x'.repeat(5000), ch: 'direct' }))
    expect(decodeTouch(huge)!.source!.length).toBeLessThanOrEqual(500)
  })
})

describe('dedup — FR-LEAD-1', () => {
  it('uses a 30-day window', () => {
    expect(DEDUP_WINDOW_DAYS).toBe(30)
    const now = new Date('2026-08-09T00:00:00Z')
    expect(isWithinDedupWindow(new Date('2026-07-25T00:00:00Z'), now)).toBe(true)
    expect(isWithinDedupWindow(new Date('2026-06-25T00:00:00Z'), now)).toBe(false)
  })

  it('treats the same number written differently as the same person', () => {
    // Which it is. Two leads means two staff calling them.
    const a = dedupKeys({ phone: '(512) 555-0100' })
    const b = dedupKeys({ phone: '512-555-0100' })
    const c = dedupKeys({ phone: '+1 512 555 0100' })
    expect(a.phone).toBe(b.phone)
    expect(b.phone).toBe(c.phone)
  })

  it('lower-cases email', () => {
    expect(dedupKeys({ email: '  Ada@Example.COM ' }).email).toBe('ada@example.com')
  })

  it('ignores a number too short to be one', () => {
    expect(dedupKeys({ phone: '555' }).phone).toBeNull()
  })

  it('returns nulls rather than empty strings for nothing', () => {
    expect(dedupKeys({})).toEqual({ email: null, phone: null })
  })
})
