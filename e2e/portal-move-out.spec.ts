import { expect, test } from '@playwright/test'
import { signInAsDemoTenant } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'

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

    await assertNoAxeViolations(page)
  })

  test('shows the notice-policy floor and a settlement preview before confirming', async ({ page }) => {
    await page.goto('/portal/move-out')
    // The demo tenant (Dana) has one unit, so this lands directly on the
    // date-picker screen rather than a unit chooser.
    await expect(page.getByRole('heading', { name: /Request a move-out/ })).toBeVisible()
    await expect(page.getByLabel('Move-out date')).toBeVisible()
    await expect(page.getByText('Current balance')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Request a move-out on / })).toBeVisible()
  })

  // B-174. The refused preview, which used to render as a blank where the money
  // had been while "Request this move-out" stayed live and pressable beside it
  // (3.3.1) — B-142 fixed exactly this on the sibling transfer screen and the
  // fix never crossed one file.
  //
  // Driven straight off the URL, so it needs no interaction and mutates
  // nothing: the date is read from `searchParams` and priced server-side. Safe
  // against the shared demo database for the reason B-120 asks for, and
  // repeatable for the same one.
  test('a date past the ceiling says so, and takes the request button with it', async ({ page }) => {
    await page.goto('/portal/move-out')
    await expect(page.getByLabel('Move-out date')).toBeVisible()
    const url = new URL(page.url())
    url.searchParams.set('date', '2031-01-01')
    await page.goto(url.pathname + url.search)

    // Scoped to <main>: Next renders an always-present `role="alert"` route
    // announcer outside it, so a bare `getByRole('alert')` is a strict-mode
    // violation on every page in the product and fails before the refusal it
    // was looking for has rendered — which reads exactly like the refusal not
    // firing.
    await expect(page.getByRole('main').getByRole('alert')).toContainText('within the next 365 days')
    // The figures are gone, and so is the button that would have committed
    // them — hidden rather than disabled, so nothing focusable is left
    // announcing nothing.
    await expect(page.getByText('Current balance')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Request a move-out on / })).toHaveCount(0)
    // The picker itself stays, because changing the date is the way out.
    await expect(page.getByLabel('Move-out date')).toBeVisible()
  })

  // The refusal is a STATE, not a route, so the route-keyed scan contract never
  // reaches it — B-184's gap, closed for this one state the way B-171 and B-172
  // closed it for theirs.
  // a11y-state: /portal/move-out | date past the ceiling (refused)
  test('the refused move-out preview has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal/move-out')
    await expect(page.getByLabel('Move-out date')).toBeVisible()
    const url = new URL(page.url())
    url.searchParams.set('date', '2031-01-01')
    await page.goto(url.pathname + url.search)
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  // B-184 (T1). B-173's `stalePreview` guard, reachable the ordinary way — this
  // page has an explicit "Update" button beside the picker (a native GET
  // submit of the same form), so typing a new date and pressing "Request a
  // move-out on …" directly, without pressing Update first, is not a
  // contrived path. Safe against the shared demo database for the reason the
  // ceiling test above is: `stalePreview` returns before anything is written.
  // a11y-state: /portal/move-out | stale-preview refusal
  test('a date changed since Update refuses rather than committing either one', async ({ page }) => {
    await page.goto('/portal/move-out')
    const dateField = page.getByLabel('Move-out date')
    const original = await dateField.inputValue()
    const changed = new Date(`${original}T00:00:00.000Z`)
    changed.setUTCDate(changed.getUTCDate() + 1)
    await dateField.fill(changed.toISOString().slice(0, 10))

    await page.getByRole('button', { name: /^Request a move-out on / }).click()

    const alert = page.getByRole('main').getByRole('alert')
    await expect(alert).toContainText('You changed the date')
    await expect(alert).toBeFocused()
    // Nothing posted: still on the request screen.
    await expect(page).toHaveURL(/\/move-out(\?|$)/)

    await assertNoAxeViolations(page)
  })
})
