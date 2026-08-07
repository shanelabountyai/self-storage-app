import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  canonicalPath,
  citySlug,
  isCanonicalSlug,
  isNoindexPath,
  toSlug,
  TRACKING_PARAMS,
} from '../packages/core/marketing/urls'

// B-066 / PRD 04 FR-SEO-2, US-3 AC2/AC3. One canonical URL per page.

describe('canonicalPath', () => {
  it('leaves an already-canonical path alone', () => {
    const result = canonicalPath('/storage/tx/austin/south-congress')
    expect(result.target).toBe('/storage/tx/austin/south-congress')
    expect(result.isCanonical).toBe(true)
  })

  it('lower-cases the path', () => {
    // One capitalised link in one email is all it takes to create a duplicate.
    expect(canonicalPath('/Storage/TX/Austin/South-Congress').target).toBe(
      '/storage/tx/austin/south-congress',
    )
  })

  it('strips a trailing slash, but never the root', () => {
    expect(canonicalPath('/storage/tx/austin/south/').target).toBe('/storage/tx/austin/south')
    expect(canonicalPath('/').target).toBe('/')
    expect(canonicalPath('/').isCanonical).toBe(true)
  })

  it('collapses doubled slashes', () => {
    expect(canonicalPath('//storage//tx///austin').target).toBe('/storage/tx/austin')
  })

  it('drops every tracking parameter', () => {
    const search = TRACKING_PARAMS.map((param) => `${param}=x`).join('&')
    expect(canonicalPath('/storage/search', `?${search}`).target).toBe('/storage/search')
  })

  it('keeps parameters that change what the page shows', () => {
    // The bug this guards: stripping `q` would redirect a search for 78704 to
    // an empty results page, which is worse than any duplicate-content problem.
    expect(canonicalPath('/storage/search', '?q=78704').target).toBe('/storage/search?q=78704')
    expect(canonicalPath('/storage/tx/austin/s', '?size=10x10&sort=price').target).toBe(
      '/storage/tx/austin/s?size=10x10&sort=price',
    )
  })

  it('sorts remaining parameters so order cannot create a duplicate', () => {
    expect(canonicalPath('/storage/search', '?b=2&a=1').target).toBe('/storage/search?a=1&b=2')
  })

  it('keeps a tracked parameter out while keeping a real one in', () => {
    expect(canonicalPath('/storage/search', '?utm_source=email&q=78704').target).toBe(
      '/storage/search?q=78704',
    )
  })

  it('does not lower-case the query', () => {
    // `?q=Austin` is a search term somebody typed; mangling it would change the
    // results in order to tidy the address bar.
    expect(canonicalPath('/storage/search', '?q=Austin').target).toBe('/storage/search?q=Austin')
  })
})

describe('isNoindexPath — US-3 AC2', () => {
  it('covers everything behind a login or mid-transaction', () => {
    for (const path of [
      '/admin',
      '/admin/reports/revenue',
      '/portal/pay',
      '/checkout',
      '/pay/abc123',
      '/login',
      '/reset-password',
      '/api/cron',
    ]) {
      expect(isNoindexPath(path)).toBe(true)
    }
  })

  it('leaves marketing routes indexable', () => {
    for (const path of [
      '/',
      '/storage/search',
      '/storage/tx/austin/south-congress',
      '/storage/size-guide',
      '/about',
      '/faq',
    ]) {
      expect(isNoindexPath(path)).toBe(false)
    }
  })

  it('does not match a prefix that is merely a substring', () => {
    // `/paycheck-guide` is not `/pay`. Getting this wrong would silently
    // deindex a marketing page.
    expect(isNoindexPath('/paycheck-guide')).toBe(false)
    expect(isNoindexPath('/administration')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isNoindexPath('/Admin/Reports')).toBe(true)
  })
})

describe('slugs', () => {
  it('recognises the canonical shape', () => {
    expect(isCanonicalSlug('south-congress')).toBe(true)
    expect(isCanonicalSlug('unit-10x10')).toBe(true)
  })

  it('rejects shapes FR-SEO-2 forbids', () => {
    for (const bad of ['South-Congress', 'south_congress', '-south', 'south-', 'south--congress', '']) {
      expect(isCanonicalSlug(bad)).toBe(false)
    }
  })

  it('coerces arbitrary text', () => {
    expect(toSlug('South Congress Ave.')).toBe('south-congress-ave')
    expect(toSlug('  Fort   Worth  ')).toBe('fort-worth')
    expect(toSlug('Città')).toBe('citta')
  })

  it('slugifies city names the same way everywhere', () => {
    expect(citySlug('San Antonio')).toBe('san-antonio')
    expect(citySlug('Fort Worth')).toBe(toSlug('Fort Worth'))
  })
})

describe('absoluteUrl', () => {
  it('joins without doubling the slash', () => {
    expect(absoluteUrl('https://example.com', '/storage')).toBe('https://example.com/storage')
    expect(absoluteUrl('https://example.com/', '/storage')).toBe('https://example.com/storage')
    expect(absoluteUrl('https://example.com', 'storage')).toBe('https://example.com/storage')
  })
})
