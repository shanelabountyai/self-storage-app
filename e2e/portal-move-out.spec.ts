import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoTenant } from './sign-in'

// PRD 01 US-707 (B-041). Pick a unit → pick a date → see what it settles to
// → confirm. Nothing here finalizes anything — that stays B-040's, gated
// behind a human checking the unit is actually empty.

test.describe('portal move-out role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/portal/move-out')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  test('/portal/move-out has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal/move-out')
    await expect(page.getByRole('main')).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
  })

  test('shows the notice-policy floor and a settlement preview before confirming', async ({ page }) => {
    await page.goto('/portal/move-out')
    // The demo tenant (Dana) has one unit, so this lands directly on the
    // date-picker screen rather than a unit chooser.
    await expect(page.getByRole('heading', { name: /Request a move-out/ })).toBeVisible()
    await expect(page.getByLabel('Move-out date')).toBeVisible()
    await expect(page.getByText('Current balance')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request this move-out' })).toBeVisible()
  })
})
