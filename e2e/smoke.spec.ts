import { expect, test } from '@playwright/test'
import { LEGAL_PAGES } from '../apps/web/lib/site-config'

test('home page renders its search hero', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByLabel('Where do you need storage?')).toBeVisible()
})

test('the first tab stop is the skip link', async ({ page }) => {
  await page.goto('/')

  // Keyboard users must be able to bypass the header (WCAG 2.4.1), and the
  // skip link only works if it is genuinely the first focusable element.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
})

test('search submits to a shareable URL', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  // US-101: the query has to survive into a bookmarkable URL.
  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('78704')
})

test('search ranks real facilities with distance and a from-price', async ({ page }) => {
  // 78704 is the demo Austin facility's own zip, so it must rank first at
  // essentially zero distance (US-101).
  await page.goto('/storage/search?q=78704')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Austin, TX 78704')
  const first = page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()
  await expect(first).toBeVisible()
  await expect(first).toContainText('mi')
  await expect(first).toContainText(/Units from \$\d/)
})

test('a search with nothing nearby offers the closest facilities instead', async ({ page }) => {
  // US-101: never a dead end. Anchorage is real, so this is the
  // "nothing within the radius" state, not the "we can't find that" one.
  await page.goto('/storage/search?q=99501')

  await expect(page.getByRole('heading', { name: /Nothing within \d+ miles/ })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo —' }).first()).toBeVisible()
})

test('an unrecognisable search names the problem and offers a human', async ({ page }) => {
  await page.goto('/storage/search?q=zzzzz')

  await expect(page.getByRole('heading', { name: /We couldn't find/ })).toBeVisible()
  // §6.7: full-page error states always include click-to-call. Scoped to main
  // because the header carries a phone link on every page — the point is that
  // the error state itself offers a human, not that the chrome does.
  await expect(page.getByRole('main').getByRole('link', { name: /^Call/ })).toBeVisible()
})

test('search works with JavaScript disabled', async ({ browser }) => {
  // The form is a plain GET form and "Use my location" is purely additive, so
  // the core journey must not depend on the client bundle at all.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()).toBeVisible()
  await context.close()
})

test('every footer legal page resolves', async ({ page }) => {
  for (const legalPage of LEGAL_PAGES) {
    const response = await page.goto(legalPage.href)
    expect(response?.status(), `${legalPage.href} should not 404`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('page reflows to 320px without horizontal scroll', async ({ page }) => {
  // WCAG 1.4.10 / PRD 01 §6.8. Checked at the narrowest supported width
  // because that is where a fixed-width element would first break out.
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflows, 'document scrolls horizontally at 320px').toBe(false)
})
