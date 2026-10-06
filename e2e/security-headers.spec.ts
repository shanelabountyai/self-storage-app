import { expect, test } from '@playwright/test'

// SEC-06. The global headers from `next.config.ts`, read off the route's own
// response (no redirect followed), on one route per audience. The pay token is
// one no link carries: the header belongs to the route, not to a valid token.
for (const path of ['/', '/admin', '/pay/not-a-real-token-at-all']) {
  test(`${path} carries the security headers`, async ({ request }) => {
    const headers = (await request.get(path, { maxRedirects: 0 })).headers()
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['strict-transport-security']).toContain('max-age=63072000')
  })
}
