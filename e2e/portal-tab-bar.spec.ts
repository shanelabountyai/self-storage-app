import { expect, test, type Page } from '@playwright/test'
import { signInAsDemoTenant, signInAsPosTenant } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'

// B-372. The portal's phone-width tab bar. Read-only: nothing here mutates the
// demo fixtures. Dana (demo tenant) owes money; the POS tenant is the second
// login, used for the "every lease card shows a tel: link" check.
test.use({ viewport: { width: 375, height: 800 } })

const bar = (page: Page) => page.getByRole('navigation', { name: 'Quick links' })
const header = (page: Page) => page.getByRole('navigation', { name: 'Your account' })

test.describe('portal tab bar, signed in as the demo tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  test('at most one tab is current, and only where a tab is the page', async ({ page }) => {
    const expected: [string, number][] = [
      ['/portal', 1],
      ['/portal/access', 0],
      ['/portal/contact', 0],
      ['/portal/payment-plan', 0],
    ]
    for (const [route, count] of expected) {
      await page.goto(route)
      await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(count)
    }
    await bar(page).getByRole('link', { name: /^Pay/ }).click()
    await expect(page).toHaveURL(/\/portal\/pay/)
    await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(bar(page).getByRole('link', { name: /^Pay/ })).toHaveAttribute('aria-current', 'page')
  })

  test('each tab is named as the header names the same destination', async ({ page }) => {
    await page.goto('/portal')
    await expect(bar(page).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/portal')
    await expect(header(page).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/portal')
    // The gate code tab is a fragment on Overview, named for what it lands on.
    const gate = bar(page).getByRole('link', { name: 'Gate code' })
    await expect(gate).toHaveAttribute('href', '/portal#gate-code')
    await gate.click()
    await expect(page.getByRole('heading', { name: 'Gate code' }).first()).toBeInViewport()
    // Neither old label survives.
    await expect(bar(page).getByRole('link', { name: 'Home' })).toHaveCount(0)
    await expect(bar(page).getByRole('link', { name: 'Access' })).toHaveCount(0)
  })

  test('Help is a call to the facility when every unit shares one phone', async ({ page }) => {
    await page.goto('/portal')
    const help = bar(page).getByRole('link', { name: /^Help/ })
    const href = await help.getAttribute('href')
    if (href?.startsWith('tel:')) {
      await expect(help).toHaveAccessibleName(/^Help: call /)
    } else {
      // More than one phone: it goes to the per-unit call lines.
      expect(href).toBe('/portal#facility-phone')
    }
  })

  test('the last focusable control on each portal route clears the bar', async ({ page }) => {
    for (const route of ['/portal', '/portal/access', '/portal/contact', '/portal/statements', '/portal/documents']) {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()
      const last = page
        .locator(
          'main :is(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):not([disabled])',
        )
        .locator('visible=true')
        .last()
      if ((await last.count()) === 0) continue
      await last.focus()
      await page.waitForTimeout(150)
      const box = await last.boundingBox()
      const barBox = await bar(page).boundingBox()
      expect(box, route).not.toBeNull()
      expect(box!.y + box!.height, `${route}: control sits under the bar`).toBeLessThanOrEqual(barBox!.y + 0.5)
    }
  })

  for (const lang of ['en', 'es'] as const) {
    test(`the bar has no axe violations (${lang})`, async ({ page, context }) => {
      if (lang === 'es') await context.addCookies([{ name: 'st_locale', value: 'es', url: 'http://localhost:3000' }])
      await page.goto('/portal')
      await expect(page.getByRole('main')).toBeVisible()
      await assertNoAxeViolations(page)
    })
  }
})

test('every lease card shows a tel: link, whatever the balance', async ({ page }) => {
  await signInAsPosTenant(page)
  await page.goto('/portal')
  const cards = page.locator('section[aria-labelledby^="lease-"]')
  const n = await cards.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    await expect(cards.nth(i).locator('a[href^="tel:"]').first()).toBeVisible()
  }
})
