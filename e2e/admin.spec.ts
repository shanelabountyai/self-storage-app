import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

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

// --- authenticated pass -------------------------------------------------------
// B-094. Everything above tests the gate; nothing tested the surface behind it,
// and PRD 02 had no accessibility section at all — which is why /admin carried
// the majority of the accessibility audit's blocking findings.
test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  const ADMIN_ROUTES = ['/admin', '/admin/units', '/admin/units/types', '/admin/settings', '/admin/dev/keypad']

  for (const route of ADMIN_ROUTES) {
    test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      expect(
        violations.map((v) => `${v.id}: ${v.help}`),
        'axe found accessibility violations',
      ).toEqual([])
    })
  }

  // 1.4.10 Reflow, which PRD 02 FR-16 applies to admin as well as the customer
  // site. B-094 fixed the shell — a fixed 192px side nav beside the content, a
  // header that could not wrap, an unbreakable JSON example, and two unwrapped
  // hours tables — and the dashboard now reflows cleanly. It did NOT finish the
  // dense screens: the unit list, the unit-type list and the settings forms
  // still push the page sideways at 320px.
  //
  // Left as `fixme` rather than deleted, so the gap stays enumerated in the test
  // output instead of living only in a document. Reflow was not in B-094's
  // scope — the row covers the shell, the error pattern and the axe run — and
  // finishing it means reworking three data-dense layouts, which is its own
  // item. Tracked in PROGRESS.md under B-094.
  const REFLOW_PENDING = ['/admin/units', '/admin/units/types', '/admin/settings']

  for (const route of ADMIN_ROUTES) {
    test(`${route} reflows to 320px without horizontal scroll`, async ({ page }) => {
      test.fixme(
        REFLOW_PENDING.includes(route),
        'dense admin layout still overflows at 320px — see PROGRESS.md, B-094',
      )
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(route)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'admin scrolls horizontally at 320px').toBe(false)
    })
  }

  test('the first tab stop in admin is the skip link', async ({ page }) => {
    // 2.4.1. Without it a keyboard user tabs the switcher, the search, the
    // bell, the user menu, sign-out and every nav item on every page load.
    await page.goto('/admin')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  })

  test('changing the facility select does not navigate', async ({ page }) => {
    // 3.2.2 On Input. Arrow-keying a <select> fires `change` on every option
    // passed on some platforms, so an auto-submitting switcher walked a
    // keyboard user through several wrong facilities to reach the one they
    // wanted — each a full page load that reset their focus.
    await page.goto('/admin/units')
    const before = page.url()

    const options = await page.getByLabel('Switch facility').locator('option').all()
    test.skip(options.length < 2, 'needs two assigned facilities to switch between')

    const target = await options[1].getAttribute('value')
    await page.getByLabel('Switch facility').selectOption(target!)
    await page.waitForTimeout(300)
    expect(page.url(), 'selecting an option navigated on its own').toBe(before)

    // And the explicit control still works.
    await page.getByRole('button', { name: 'Switch' }).click()
    await expect(page).toHaveURL(/\/admin\/units/)
  })

  test('an invalid settings submit reports the error next to the field', async ({ page }) => {
    // 3.3.1/3.3.3/4.1.3, and the scan that matters: axe only ever sees a
    // freshly loaded page, so the error state was never checked by anything.
    await page.goto('/admin/settings')
    // "T1", not "TEXAS": the field carries maxLength={2}, so a longer string is
    // truncated to a perfectly valid "TE" before it ever reaches the server.
    await page.getByLabel('State').fill('T1')
    await page.getByRole('button', { name: 'Save details' }).click()

    // Scoped to <main>: Next ships its own empty role="alert" route announcer
    // in the document, and an unscoped query matches that instead.
    const alert = page.getByRole('main').getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('2-letter code')
    await expect(page.getByLabel('State')).toHaveAttribute('aria-invalid', 'true')

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })

  test('an append-only tax rate is confirmed before it publishes', async ({ page }) => {
    // 3.3.4 Error Prevention (Financial). Tax components cannot be edited or
    // deleted, so "Add rate" used to be one click from a rate every future
    // invoice applies.
    await page.goto('/admin/settings')
    await page.getByLabel('Jurisdiction').fill('e2e-check')
    await page.getByLabel('Rate (%)').fill('8.25')
    await page.getByRole('button', { name: 'Add rate' }).click()

    // Echoes back what it parsed, in the user's terms, and waits.
    const confirm = page.getByText('cannot be edited or deleted')
    await expect(confirm).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yes, add it' })).toBeVisible()
    await expect(page.getByText('8.25%')).toBeVisible()
  })

  // The fat-finger case — 825 typed into a percent field — cannot be driven
  // from here: the input carries max="100", so the browser refuses to submit
  // and the server is never reached. That client-side guard is not the one that
  // matters (a crafted POST skips it entirely), so the server-side range check
  // is unit-tested directly in tests/form-state.test.ts.
})
