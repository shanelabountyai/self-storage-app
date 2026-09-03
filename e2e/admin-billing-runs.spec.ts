import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 FR-4 (B-043). The Billing Runs screen.
//
// Deliberately read-only against the demo data: pressing Re-run would execute
// a real nightly job against the shared demo facility, which other specs
// assert on. The re-run path's permission gate and idempotency are covered in
// the DB tests instead.

test.describe('billing runs role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/billing')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('/admin/billing has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/billing')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('renders the real screen, in words rather than job identifiers', async ({ page }) => {
    await page.goto('/admin/billing')
    await expect(page.getByRole('heading', { name: 'Billing runs' })).toBeVisible()
    // The demo database has no JobRun history — the cron route only writes one
    // when it actually runs — so either the table or the explicit empty state
    // is correct here. Asserting the table alone would be asserting on seeded
    // data this screen does not own.
    await expect(
      page.getByRole('table').or(page.getByText('No runs recorded yet.')),
    ).toBeVisible()
    // B-236. What the scheduler still OWES, which is the state a failed run
    // never covered: a run that failed is a row in the table with a status, a
    // run that has not happened writes nothing at all and used to be
    // indistinguishable from a quiet night. Either wording is correct here for
    // the same reason the table-or-empty-state assertion above is — the demo
    // database's job history is not this screen's to seed.
    await expect(
      page
        .getByText('Nothing waiting: every run due so far today has happened.')
        .or(page.getByText(/run(s)? due so far today ha(s|ve) not run yet/)),
    ).toBeVisible()

    // B-229. Whatever history happens to be here, no dotted registry key
    // reaches the page — that is B-109's rule, and this screen was the last
    // place in admin still breaking it.
    await expect(page.getByText(/\b(billing|delinquency|access|pricing)\.[a-z-]+\b/)).toHaveCount(0)
  })
})
