import { expect, test } from '@playwright/test'

test('home page renders and is keyboard reachable', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Keyboard operability is a WCAG 2.1 AA acceptance criterion (master §7.2),
  // so the harness proves it from the first commit rather than at cleanup time.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button')).toBeFocused()
})
