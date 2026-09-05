import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoOwner } from './sign-in'
import { DEMO_BUSINESS_ACCOUNT_NAME } from '../apps/web/scripts/demo-credentials'

// PRD 01 §9 Phase 3 (B-090 part 5). Business accounts: one payer, several
// tenants' units.
//
// **Read-only against the shared demo account, on purpose (B-120).** Adding or
// removing a unit here would re-point who pays for a lease that `admin-pos`
// takes real money against, and a run that died between the add and the remove
// would leave it re-pointed for every run after. The refusals and the two
// mutations are covered against their own fixtures in
// `tests/billing-accounts-db.test.ts`; what this file asserts is the screen.

test.describe('business accounts role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/billing/accounts')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('/admin/billing/accounts has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/billing/accounts')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('/admin/billing/accounts/[id] has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/billing/accounts')
    await page.getByRole('link', { name: DEMO_BUSINESS_ACCOUNT_NAME }).click()
    await page.waitForURL(/\/admin\/billing\/accounts\/[^/?]+$/)
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('names the payer, the units, and one total across them', async ({ page }) => {
    await page.goto('/admin/billing/accounts')
    await expect(page.getByRole('heading', { name: 'Business accounts' })).toBeVisible()

    await page.getByRole('link', { name: DEMO_BUSINESS_ACCOUNT_NAME }).click()
    await page.waitForURL(/\/admin\/billing\/accounts\/[^/?]+$/)

    await expect(
      page.getByRole('heading', { level: 1, name: DEMO_BUSINESS_ACCOUNT_NAME }),
    ).toBeVisible()
    // The point of the screen: the lease's own tenant is named beside the unit,
    // because the payer and the person whose goods are in it are different
    // people and the operator has to see both.
    await expect(page.getByText('Casey Contractor')).toBeVisible()
    await expect(page.getByRole('table')).toContainText('Alex Active')
    await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible()
  })
})
