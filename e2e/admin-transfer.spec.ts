import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'

// PRD 02 §4.3 US-14 (B-077). B-156 / PRD 02 §5.5 FR-25(2): this route was in
// `SCAN_EXCEPTIONS` claiming it "needs a live tenant and an available unit" —
// the same requirement `/admin/tenants/[tenantId]/move-out` has always met by
// reaching it through a real click-through rather than a bare `goto`. The
// reviewers named this wizard specifically as "in no scan at all"; this file
// is what closes that, and `SCANNED_BY_OWN_SPEC` in `scan-coverage.ts` is
// where it is recorded so the coverage test can tell "covered here" from
// "not covered at all".

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('the transfer wizard has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Transfer' }).first().click()
    await expect(page).toHaveURL(/\/transfer\?lease=/)
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  // a11y-state: /admin/tenants/[tenantId]/transfer | settlement recalculated
  test('picking a unit and recalculating scans the priced settlement too', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Transfer' }).first().click()

    const unitPicker = page.getByLabel('Move to')
    const optionCount = await unitPicker.locator('option').count()
    // No available unit to transfer into today is a legitimate demo state
    // (every unit at Dana's facility rented out by an earlier run) rather
    // than a broken page — the WCAG scan above already covers this screen's
    // "nothing available" state either way.
    test.skip(optionCount <= 1, 'no available unit at this facility today — see the note above')

    await unitPicker.selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Recalculate' }).click()
    // Either the priced settlement (a real available unit) or the refusal
    // panel (contested since Dana's own earlier request) — both are real
    // post-interaction states worth scanning, and either confirms the form
    // round-tripped rather than silently doing nothing.
    await expect(page.getByRole('heading', { level: 2 }).or(page.getByRole('alert'))).toBeVisible()

    await assertNoAxeViolations(page)
  })
})
