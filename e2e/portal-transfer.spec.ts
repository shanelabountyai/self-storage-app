import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoTenant } from './sign-in'

// PRD 01 §9 / US-14 (B-090 part 2). Pick a unit → pick a date → see what the
// swap settles to → ask. Nothing here commits a transfer: that stays B-077's,
// gated behind a human who can see whether the old unit is actually empty.
//
// ── Why nothing below submits the form (B-120's rule) ───────────────────────
//
// A transfer request mutates shared demo state twice over — it holds a unit,
// which takes it off the board for every availability assertion in the suite,
// and it raises a task, which lands in the queue `admin-tasks.spec.ts` counts.
// None of the three disciplines B-120 established would make that safe here
// without inventing a fixture nobody else uses.
//
// It does not need to. Everything this page owns is reachable by GET: the
// picker, and the priced preview, which is rendered by a `method="GET"` form
// precisely so the arithmetic happens server-side. The request itself is
// covered against real rows in `tests/portal-transfer-db.test.ts`, where the
// database is disposable. What is left for a browser is that the two states
// render and are accessible, and both are read-only.

test.describe('portal transfer role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/portal/transfer')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  test('/portal/transfer has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal/transfer')
    await expect(page.getByRole('main')).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
  })

  test('offers other units priced against what the tenant pays now', async ({ page }) => {
    await page.goto('/portal/transfer')
    // The demo tenant (Dana) has one unit, so this lands directly on the
    // picker rather than a lease chooser.
    await expect(page.getByRole('heading', { name: /into another unit/ })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Which unit would you like?' })).toBeVisible()
    await expect(page.getByLabel('When would you like to move?')).toBeVisible()

    // Every option carries a monthly figure and its difference — the two
    // numbers the decision actually turns on.
    const first = page.getByRole('radio').first()
    await expect(first).toBeVisible()
    await expect(page.getByText(/\/mo/).first()).toBeVisible()
    await expect(page.getByText(/a month|same as now/).first()).toBeVisible()
  })

  test('prices the swap server-side before anything is requested', async ({ page }) => {
    await page.goto('/portal/transfer')
    await page.getByRole('radio').first().check()
    await page.getByRole('button', { name: 'Show me what it costs' }).click()

    // A GET round trip, so the figures come from the same module the staff
    // wizard posts from rather than from arithmetic in the browser.
    await expect(page.getByText(/New monthly rent for Unit/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Request Unit / })).toBeVisible()
  })

  test('the accessible name of the picker survives text zoom to 200%', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 })
    await page.goto('/portal/transfer')
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })

    await expect(page.getByRole('group', { name: 'Which unit would you like?' })).toBeVisible()
    // WCAG 1.4.10: no horizontal scroll on the page itself at 200%.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, 'the page scrolls horizontally at 200% text zoom').toBe(false)
  })
})
