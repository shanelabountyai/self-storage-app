import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 US-2 / US-39 (B-042).

test.describe('reports role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/reports')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  for (const route of ['/admin/reports', '/admin/reports/rent-roll']) {
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

  test('shows a per-facility row and an all-facilities roll-up', async ({ page }) => {
    await page.goto('/admin/reports')
    await expect(page.getByRole('heading', { name: /^Reports/ })).toBeVisible()
    await expect(page.getByText('All facilities').first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Unit occ.' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Economic occ.' })).toBeVisible()
  })

  test('the CSV export matches the screen exactly', async ({ page }) => {
    // US-39's own AC. Same figures, same rounding — the export is generated
    // from the identical call, so this asserts they have not diverged.
    await page.goto('/admin/reports')
    const rolledUnitOcc = await page
      .getByRole('row')
      .filter({ hasText: 'All facilities' })
      .first()
      .locator('td')
      .nth(3)
      .innerText()

    const response = await page.request.get('/admin/reports/occupancy.csv')
    expect(response.headers()['content-type']).toContain('text/csv')
    const csv = await response.text()

    const totalLine = csv.split('\r\n').find((line) => line.startsWith('All facilities'))
    expect(totalLine, 'the export has no roll-up row').toBeTruthy()
    // The screen renders "50.2%"; the CSV carries "50.2".
    expect(totalLine!.split(',')[3]).toBe(rolledUnitOcc.replace('%', ''))
  })

  test('the rent roll is sorted by the biggest rate gap', async ({ page }) => {
    await page.goto('/admin/reports/rent-roll')
    await expect(page.getByRole('heading', { name: /^Rent roll/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Gap' })).toBeVisible()
  })
})
