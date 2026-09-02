import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'

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

      await assertNoAxeViolations(page)
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
    // B-201. `waitForURL`, not just a visible `<main>` — the profile's own
    // `<main>` is already visible, so without it the scan below can win the
    // race against the client-side transition and scan the PREVIOUS page. This
    // is the fault B-199 diagnosed and fixed on the lien-notices scan; the same
    // two lines were here and in the ledger scan the whole time. It surfaced as
    // a `color-contrast` incomplete naming `.text-left > .text-right`, a
    // profile element that is not on this route, with the "no longer in the
    // DOM" note `assertNoAxeViolations` prints for exactly this case.
    await page.waitForURL(/\/move-out\?lease=/)
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  // B-173. The defect this replaces: the picker sat in a separate GET form, the
  // committing form carried a hidden copy of the URL, and pressing Complete
  // closed the lease on the OLD date after showing the new one's figures.
  //
  // Safe against the shared demo database (see CLAUDE.md) because the path
  // under test is the REFUSAL — Dana's lease is not closed, nothing is written,
  // and the assertion holds on a re-run for the same reason it holds the first
  // time.
  // a11y-state: /admin/tenants/[tenantId]/move-out | stale-preview refusal
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

    // B-184 (T1). The one stale-preview refusal that IS on an admin screen —
    // its portal siblings are STATE_EXCEPTIONS because the requesting form no
    // longer lets a visitor reach them; this one is reached the ordinary way
    // (type, don't recalculate, submit), so there is no excuse not to scan it.
    await assertNoAxeViolations(page)
  })

  // B-194. The date field announced as "Notice given on Off-platform notice —
  // at the counter, by phone, by mail. Leave blank if nobody has confirmed
  // one." — the whole hint paragraph was nested INSIDE the <label>, so the
  // field's accessible name was a sentence about where notice can be given
  // rather than what the field is (2.4.6 AA, 3.3.2 A). Reads only; nothing is
  // filled and nothing is submitted, so this is safe against the shared demo
  // database however many times it runs.
  test('the notice-date field is named by its label and described by its hint', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Move out' }).first().click()

    // Scoped to THIS screen's form, not to the page. The profile has a
    // `noticeGivenAt` field of its own per lease, and during the App Router's
    // client transition both trees are briefly mounted — a page-wide locator
    // resolved to two elements and the test failed as a strict-mode violation
    // rather than on anything it asserts. Found while building B-231; it was
    // already failing on `main`, on both projects.
    const notice = page
      .locator('form[aria-label="Record the notice date"]')
      .locator('input[name="noticeGivenAt"]')
    await expect(notice).toHaveAccessibleName('Notice given on')
    await expect(notice).toHaveAccessibleDescription(/at the counter, by phone, by mail/)

    // And the two date fields on this screen say which is which, because the
    // gap between them is the whole point (US-14's three dates).
    await expect(page.getByText(/This screen has two dates/)).toBeVisible()
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
