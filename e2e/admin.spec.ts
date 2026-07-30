import { expect, test } from '@playwright/test'

// Proves the edge-level gate (apps/web/proxy.ts) actually redirects, which is
// the security-critical property of "role-gated routes" (PRD 02 FR-1-3).
//
// A full authenticated pass (rendering the shell, axe scan) is deferred to
// B-033, which builds the real sign-in screen — that's the more valuable
// place to exercise a real session than forging one here.
test.describe('admin role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('preserves the originally requested path for a post-login return', async ({ page }) => {
    await page.goto('/admin/units')
    await expect(page).toHaveURL(/\/login\?from=%2Fadmin%2Funits/)
  })
})
