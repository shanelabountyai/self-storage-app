import { expect, test } from 'vitest'

// SEC-06 found this. `rate-limit.ts` read `LOCK_MINUTES` from the checkout
// session module, which reaches the limiter again through comms and the auth
// flows. Loaded session-first, the window was NaN here and the production
// build died on "Cannot access before initialization". The order is the test.
test('the checkout limit window is a number when the session module loads first', async () => {
  await import('@/lib/checkout/session')
  const { PUBLIC_LIMITS } = await import('@/lib/http/rate-limit')
  expect(PUBLIC_LIMITS.checkoutWindowMs).toBe(30 * 60_000)
})
