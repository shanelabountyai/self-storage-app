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

test('a search result links through to its facility page', async ({ page }) => {
  await page.goto('/storage/search?q=78704')
  await page.getByRole('link', { name: 'Demo — Austin South' }).click()

  // US-103: the crawlable URL scheme is /storage/{state}/{city}/{slug}.
  await expect(page).toHaveURL('/storage/tx/austin/demo-austin-south')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo — Austin South')
})

test('the facility page separates office hours from gate hours', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §6.3: these must never be conflated. The demo facility's office is shut on
  // Sunday while the gate is open — if one table were rendering for both, this
  // pair could not both hold.
  const office = page.getByRole('table', { name: 'Office hours' })
  const gate = page.getByRole('table', { name: 'Gate access hours' })
  await expect(office.getByRole('row').filter({ hasText: 'sunday' })).toContainText('Closed')
  await expect(gate.getByRole('row').filter({ hasText: 'sunday' })).toContainText('8:00 AM')
})

test('the facility page offers click-to-call without scrolling', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §4.1 US-103: visible without scrolling on mobile. Asserted as "inside the
  // first viewport", which is what that sentence means on a phone.
  const call = page.getByRole('main').getByRole('link', { name: /^Call/ })
  await expect(call).toBeVisible()
  const box = await call.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})

test('a non-canonical facility URL redirects to the canonical one', async ({ page }) => {
  // The slug alone resolves the facility, so the state/city segments are
  // forgeable. One URL per facility in the index, not one per spelling.
  await page.goto('/storage/ca/nowhere/demo-austin-south')
  await expect(page).toHaveURL('/storage/tx/austin/demo-austin-south')
})

test('an unknown facility 404s rather than rendering an empty page', async ({ page }) => {
  const response = await page.goto('/storage/tx/austin/no-such-facility')
  expect(response?.status()).toBe(404)
})

test('every footer legal page resolves', async ({ page }) => {
  for (const legalPage of LEGAL_PAGES) {
    const response = await page.goto(legalPage.href)
    expect(response?.status(), `${legalPage.href} should not 404`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

// Reflow moved to e2e/a11y.spec.ts in B-093, where it runs over every public
// route rather than the homepage alone — the two-column hours grid and the unit
// tables are the things that break out of 320px, and neither is on the homepage.

test('the skip link paints a real focus indicator', async ({ page }) => {
  // The programmatic half of WCAG 1.4.11 for focus. A machine can check that an
  // indicator is drawn and how thick it is; it cannot check that it is visible
  // against what is behind it — tests/contrast-tokens.test.ts does the contrast
  // arithmetic, and a human still has to look at it in Safari, whose handling of
  // `outline-style: auto` differs from Chromium's.
  await page.goto('/')
  await page.keyboard.press('Tab')

  const indicator = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    }
  })

  expect(indicator, 'nothing was focused after one Tab').not.toBeNull()
  const drawn =
    (indicator!.outlineStyle !== 'none' && indicator!.outlineWidth >= 2) ||
    indicator!.boxShadow !== 'none'
  expect(drawn, `focused element draws no indicator: ${JSON.stringify(indicator)}`).toBe(true)
})
