import { describe, expect, it } from 'vitest'
import nextConfig from '../apps/web/next.config'

// K6 (scorecard 2026-11-13). Token pages get same-origin referrer, no-store and noindex
// from next.config.ts, after the global block so the stricter Referrer-Policy
// wins. e2e/security-headers.spec.ts reads the same off a production build.

type Rule = { source: string; headers: { key: string; value: string }[] }

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[]
}

/// Next applies every matching rule in order and a later one wins per key.
function headersFor(all: Rule[], sources: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rule of all) {
    if (!sources.includes(rule.source)) continue
    for (const { key, value } of rule.headers) out[key] = value
  }
  return out
}

describe('K6: token page headers', () => {
  it.each([
    '/pay/:path*',
    '/checkout/resume/:path*',
    '/unsubscribe/:path*',
    '/waitlist/cancel/:path*',
    '/r/:path*',
    '/reservations',
    '/checkout',
    '/login/magic',
    '/reset-password',
    '/confirm-email',
  ])('%s is same-origin, no-store and noindex, over the global headers', async (source) => {
    const h = headersFor(await rules(), ['/:path*', source])
    expect(h['Referrer-Policy']).toBe('same-origin')
    expect(h['Cache-Control']).toContain('no-store')
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Strict-Transport-Security']).toContain('max-age=63072000')
  })

  it('ordinary pages keep the global referrer policy and no forced no-store', async () => {
    const h = headersFor(await rules(), ['/:path*'])
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Cache-Control']).toBeUndefined()
  })
})
