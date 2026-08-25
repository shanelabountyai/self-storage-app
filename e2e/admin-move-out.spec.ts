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
    await expect(page.getByRole('button', { name: /^Complete move-out on / })).toBeVisible()
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

  // B-173. The defect this replaces: the picker sat in a separate GET form, the
  // committing form carried a hidden copy of the URL, and pressing Complete
  // closed the lease on the OLD date after showing the new one's figures.
  //
  // Safe against the shared demo database (see CLAUDE.md) because the path
  // under test is the REFUSAL — Dana's lease is not closed, nothing is written,
  // and the assertion holds on a re-run for the same reason it holds the first
  // time.
  test('a date changed since the preview refuses rather than committing either one', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Move out' }).first().click()

    // Typed, and deliberately NOT recalculated.
    await page.getByLabel('Move-out date').fill('2027-03-15')
    await page.getByRole('button', { name: /^Complete move-out on / }).click()

    // `AdminForm`'s error summary specifically. Not a bare `getByRole('alert')`:
    // Dana's lease is over the write-off threshold, so the manager-override
    // panel is already an alert on this page, and Next's route announcer is a
    // third — a strict locator resolves to those two and fails before the
    // summary it was looking for has even rendered.
    const alert = page.getByRole('alert').filter({ hasText: 'You changed the date' })
    // Names the date now in the picker, so the refusal says which one it is
    // talking about rather than only that something is wrong.
    await expect(alert).toContainText('Mar 15, 2027')
    await expect(alert).toBeFocused()
    // Nothing posted: still on the move-out screen, not the profile.
    await expect(page).toHaveURL(/\/move-out\?lease=/)
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
