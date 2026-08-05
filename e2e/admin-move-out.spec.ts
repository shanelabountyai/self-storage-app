import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 US-14 (move-out) (B-040). The settlement is previewed before it
// posts, and the unit never goes straight back on sale.

test.describe('move-out role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/tenants/former')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  for (const route of ['/admin/tenants/former', '/admin/units/ready']) {
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

  test('the move-out screen previews the settlement before anything posts', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    await page.getByRole('link', { name: 'Move out' }).first().click()
    await expect(page).toHaveURL(/\/move-out\?lease=/)

    // 3.3.4 Error Prevention (Financial): the figure is shown before the act
    // that commits it.
    await expect(page.getByText('Balance today')).toBeVisible()
    await expect(page.getByText('Proration credit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Complete move-out' })).toBeVisible()
    // And the unit-release rule is stated on the screen, not just enforced.
    await expect(page.getByText(/maintenance, not straight back on sale/)).toBeVisible()
  })

  test('the move-out screen has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Move out' }).first().click()
    await expect(page.getByRole('main')).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
  })

  test('recalculating for a different date re-runs the settlement server-side', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Move out' }).first().click()

    await page.getByLabel('Move-out date').fill('2027-03-15')
    await page.getByRole('button', { name: 'Recalculate' }).click()
    await expect(page).toHaveURL(/date=2027-03-15/)
    await expect(page.getByText('Balance today')).toBeVisible()
  })
})
