import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'

// PRD 05 CN-4 (B-051). The pay link's boundaries, from the outside.
//
// No valid token is minted here: doing so needs a real lease with a balance,
// and the demo lifecycle fixtures are shared with the admin and portal specs.
// The behaviour that matters at this layer is what an INVALID token does — that
// it is never a dead end, never enumerable, and never a way into the portal —
// and that is exactly what can be driven without touching anyone's fixtures.
// The valid-token path is covered against disposable rows in
// tests/pay-links-db.test.ts.

test('an expired or unknown pay link lands on the login, never a dead end', async ({ page }) => {
  await page.goto('/pay/not-a-real-token-at-all')

  // CN-4: "an expired link lands on the portal login with the payment screen as
  // post-login destination — never a dead end."
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('a bad token says the same thing whatever kind of bad it is', async ({ page }) => {
  // Nothing to enumerate: a revoked link, an expired one and one that never
  // existed are indistinguishable from outside.
  await page.goto('/pay/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  const first = page.url()
  await page.goto('/pay/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
  expect(page.url()).toBe(first)
})

test('the pay route never grants the portal', async ({ page }) => {
  // The whole security shape of this item: a pay link is not a session, so
  // visiting one must leave the rest of the portal exactly as closed as before.
  await page.goto('/pay/not-a-real-token-at-all')
  await page.goto('/portal')
  await expect(page).toHaveURL(/\/login/)
})

test('the login it lands on has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/pay/not-a-real-token-at-all')
  await expect(page.getByRole('main')).toBeVisible()

  await assertNoAxeViolations(page)
})
