import { expect, test } from '@playwright/test'

test('home page renders and is keyboard reachable', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Keyboard operability is a WCAG 2.1 AA acceptance criterion (master §7.2),
  // so the harness proves it from the first commit rather than at cleanup time.
  // Named explicitly rather than `getByRole('button')`: Next's dev-tools
  // overlay injects its own button in dev mode, and a bare role query
  // intermittently matches that one under concurrent test load instead.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Nothing to click yet' })).toBeFocused()
})
