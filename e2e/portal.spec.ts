import { PORTAL_SCAN_ROUTES as PORTAL_ROUTES } from '../apps/web/lib/a11y/scan-coverage'
import { expect, test } from '@playwright/test'
import { signInAsDemoTenant, signInAsPlanTenant } from './sign-in'
import { assertNoAxeViolations, expectAnnounced, expectPreexisting } from './a11y-helpers'

// PRD 01 §4.7 US-701/US-702, §6.8.1. Mirrors e2e/admin.spec.ts's split: an
// unauthenticated gating check, then a real session against the demo tenant
// (B-034's `dana@demo.example.com`, seeded with a real past-due balance and a
// suspended access grant so the banner/suspended-panel branches are actually
// exercised, not just the empty-state ones).
test.describe('portal role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('redirects an unauthenticated visitor away from the pay screen too', async ({ page }) => {
    await page.goto('/portal/pay?lease=anything')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  // B-139. Moved to `apps/web/lib/a11y/scan-coverage.ts` — see the note there.

  for (const route of PORTAL_ROUTES) {
    test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()

      await assertNoAxeViolations(page)
    })
  }

  // a11y-state: /portal/access | add-someone disclosure open
  //
  // B-086 part 1. Everything behind a closed <details> is invisible to axe
  // (D-95), and this row put two new controls inside one — the schedule select
  // and the "Last day" date field. Without this the base loop above would have
  // moved them out of the audit rather than into it.
  test('the shared-access form has no WCAG 2.1 AA violations, with the disclosure open', async ({
    page,
  }) => {
    await page.goto('/portal/access')
    await expect(page.getByRole('main')).toBeVisible()

    // The demo tenant may already be at the facility's cap, in which case the
    // form is deliberately not rendered at all — the same self-skip discipline
    // B-120 requires of any spec touching shared demo fixtures, rather than a
    // failure that reads as a broken page.
    //
    // Located by `summary` rather than by role: Chromium's mapping of
    // <details> to `group`, and of <summary> to that group's accessible name,
    // is not something to bet a scan on — and a locator that quietly matches
    // nothing turns this test into a permanent skip that audits nothing, which
    // is the exact failure it exists to prevent.
    const summary = page.locator('summary', { hasText: 'Add someone' })
    test.skip(
      (await summary.count()) === 0,
      'this tenant is at the authorized-access cap; no form to scan',
    )

    await summary.first().click()
    await expect(page.getByLabel('When they can get in').first()).toBeVisible()
    await expect(page.getByLabel('Last day (optional)').first()).toBeVisible()

    await assertNoAxeViolations(page)
  })

  for (const route of PORTAL_ROUTES) {
    test(`${route} reflows to 320px without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(route)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'portal scrolls horizontally at 320px').toBe(false)
    })
  }

  test.describe('text zoomed to 200%', () => {
    test.use({ viewport: { width: 640, height: 512 }, deviceScaleFactor: 2 })

    for (const route of PORTAL_ROUTES) {
      test(`${route} survives 200% zoom`, async ({ page }) => {
        // The outer describe's beforeEach already signs in.
        await page.goto(route)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(overflow, 'portal scrolls horizontally at 200% zoom').toBe(false)
      })
    }
  })

  const TEXT_SPACING = `* {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }`

  for (const route of PORTAL_ROUTES) {
    test(`${route} tolerates forced text spacing`, async ({ page }) => {
      await page.goto(route)
      await page.addStyleTag({ content: TEXT_SPACING })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'content is clipped when text spacing is increased').toBe(false)
    })
  }

  test('shows the past-due banner and a suspended gate-code panel, not a code', async ({ page }) => {
    await page.goto('/portal')
    // Scoped to <main>: Next ships its own empty role="alert" route announcer
    // in the document, and an unscoped query matches that instead (same note
    // as e2e/admin.spec.ts's settings-error test).
    await expect(page.getByRole('main').getByRole('alert')).toContainText('past due')
    await expect(page.getByText('Access is suspended until the balance is paid')).toBeVisible()
    await expect(page.getByRole('button', { name: /show gate code/i })).toHaveCount(0)
  })

  test('pay now reaches the pay screen in one tap, with the balance prefilled', async ({ page }) => {
    // US-703's ≤3 taps: this link is tap one, confirming in the Payment
    // Element is tap two.
    await page.goto('/portal')
    await page.getByRole('link', { name: /pay \$.* now/i }).first().click()

    await expect(page).toHaveURL(/\/portal\/pay\?lease=/)
    await expect(page.getByRole('heading', { name: 'Pay your balance' })).toBeVisible()
    // The amount to be charged is stated before anything can charge it (3.3.4).
    await expect(page.getByText('Paying today')).toBeVisible()
  })

  test('the pay screen refuses a lease that is not on this account', async ({ page }) => {
    // The lease id is in the URL, so this is the check that matters.
    await page.goto('/portal/pay?lease=not-this-tenants-lease')
    await expect(page.getByText(/couldn.t find that unit/i)).toBeVisible()
  })

  test('/portal/pay has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal')
    await page.getByRole('link', { name: /pay \$.* now/i }).first().click()
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('an over-payment is refused server-side and falls back to the balance', async ({ page }) => {
    // The amount is a query param, so this is a crafted request rather than
    // one the form would produce — which is exactly the case that has to hold.
    await page.goto('/portal')
    await page.getByRole('link', { name: /pay \$.* now/i }).first().click()
    await expect(page).toHaveURL(/\/portal\/pay\?lease=/)
    const leaseId = new URL(page.url()).searchParams.get('lease')

    await page.goto(`/portal/pay?lease=${leaseId}&amount=999999`)
    // Scoped to THIS alert: the Payment Element renders an (empty) alert region
    // of its own once Stripe is configured, so an unscoped `getByRole('alert')`
    // matches two and fails on strict mode rather than on behaviour.
    await expect(
      page.getByRole('main').getByRole('alert').filter({ hasText: 'more than you owe' }),
    ).toBeVisible()
    // And it did not quietly prepare a charge for the crafted amount.
    await expect(page.getByText('$9,999.99')).toHaveCount(0)
  })

  test('/portal/methods lists autopay per unit and has no WCAG 2.1 AA violations', async ({
    page,
  }) => {
    await page.goto('/portal/methods')
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toBeVisible()
    // §4.6 wants the amount and the date beside the control, not behind a link.
    await expect(page.getByRole('heading', { name: 'Automatic payments' })).toBeVisible()
    await expect(page.getByText(/day 1 of each month/i).first()).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('autopay cannot be turned on with no card to charge', async ({ page }) => {
    // The guard that stops the dashboard reading "On" while the billing day
    // takes nothing. The demo tenant has no saved method.
    await page.goto('/portal/methods')
    const turnOn = page.getByRole('button', { name: /turn on automatic payments/i }).first()
    await expect(turnOn).toBeVisible()
    await turnOn.click()

    await expect(page.getByRole('main').getByRole('alert')).toContainText('Add a card first')
    // Still off, and still offering to turn on rather than off.
    await expect(page.getByRole('button', { name: /turn on automatic payments/i }).first()).toBeVisible()
  })

  // The re-auth gate on turning autopay ON (US-701) is NOT exercised here:
  // every e2e session is minted seconds earlier by the sign-in helper, so it
  // is genuinely fresh and the gate correctly declines to fire. Driving the
  // stale branch would mean either a >15-minute-old session or forging
  // `authTime` in the JWT, and the decision itself is already covered
  // directly by tests/reauth.test.ts's boundary cases. See PROGRESS.md.

  // /portal/documents and /portal/contact's axe coverage now lives in
  // PORTAL_ROUTES above — this used to be its own small loop, which is the
  // exact "coverage grew by accident" shape B-119 closes: two lists that
  // could silently drift apart about which routes are actually checked.

  test('saving an address keeps the previous one on file', async ({ page }) => {
    // PRD 02 US-13: the address of record is a history, because "which
    // address did the notice go to" has to be answerable from records.
    await page.goto('/portal/contact')

    // B-156 / PRD 02 §5.5 FR-25(3). Captured and checked BEFORE the submit —
    // the cheapest catch for "a control that does nothing silently": this
    // region must already be attached and empty, not fetched fresh after the
    // click, or an element unmounted-and-remounted-already-populated would
    // pass just as wrongly as a truly silent control.
    //
    // Scoped to the form that saves, not to the first status region on the
    // page. B-111 stopped `AdminForm` hiding its live region while empty
    // (`display:none` had been taking it out of the accessibility tree until
    // the moment it had text, which is the failure the region exists to
    // avoid), so this screen now correctly exposes three of them and `.first()`
    // is whichever comes first in the DOM rather than whichever just spoke.
    const status = page.getByRole('form', { name: 'Mailing address' }).getByRole('status')
    await expectPreexisting(status)

    // Unique per run: re-saving the same address is correctly a no-op, so a
    // fixed value passes once and then reports "already your address".
    await page.getByLabel('Street address').fill(`${Date.now() % 100000} Evidence Lane`)
    await page.getByLabel('City').fill('Austin')
    await page.getByLabel('State').fill('TX')
    await page.getByLabel('ZIP code').fill('78704')
    await page.getByRole('button', { name: 'Save address' }).click()

    await expectAnnounced(status, /address is updated/)
    await expect(page.getByText('Previous addresses')).toBeVisible()
  })

  test('an email change is not applied until the link is opened', async ({ page }) => {
    await page.goto('/portal/contact')
    const before = await page.getByText(/Your email is/).textContent()

    await page.getByLabel('New email address').fill(`changed-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Send confirmation link' }).click()

    await expect(
      page.getByRole('form', { name: 'Change email address' }).getByRole('status'),
    ).toContainText('Nothing changes until you open it')
    // Still the old address on the account.
    await expect(page.getByText(/Your email is/)).toHaveText(before!)
  })

  test('a bad confirmation link changes nothing and says so', async ({ page }) => {
    await page.goto('/confirm-email?token=not-a-real-token')
    await expect(page.getByRole('heading', { name: /didn.t work/i })).toBeVisible()
    await expect(page.getByText(/Nothing has changed/)).toBeVisible()
  })

  // GateCodePanel's own reveal/copy interaction (the aria-expanded toggle,
  // the character-by-character sr-only text, and the "Copied" live region
  // §6.8 requires to pre-exist the click that fills it) is NOT covered here.
  // The demo tenant with a known password is deliberately the suspended one
  // (above), so this panel never renders for it, and no seeded credential is
  // ever genuinely revealable regardless — ACCESS_CODE_ENCRYPTION_KEY is
  // unconfigured everywhere in this project by design (lib/access/secret.ts's
  // own "no safe dev fallback" comment), so codeForLease() returns null for
  // every demo lease. Verified instead with a real running dev server, a
  // temporary key, and a temporary revealable credential on a non-suspended
  // demo tenant — see PROGRESS.md's B-034 entry.
})

test.describe('the account nav (B-117)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  test('the four frequent links are one tap away; the rest sit behind Manage', async ({ page }) => {
    await page.goto('/portal')
    const nav = page.getByRole('navigation', { name: 'Your account' })

    for (const label of ['Overview', 'Payment methods', 'Statements', 'Documents']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }
    // Not rendered until Manage opens — a closed <details> keeps its content
    // out of the accessibility tree entirely, not merely hidden from view.
    for (const label of ['Who can get in', 'Protection', 'Contact details', 'Notifications']) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0)
    }

    await nav.getByText('Manage').click()
    for (const label of ['Who can get in', 'Protection', 'Contact details', 'Notifications']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('Move out stays reachable without opening Manage — it is not one of the four errands', async ({ page }) => {
    await page.goto('/portal')
    const nav = page.getByRole('navigation', { name: 'Your account' })
    await expect(nav.getByRole('link', { name: 'Move out' })).toBeVisible()
  })
})

// B-196 (gaps 3 and 4). The plan surfaces, which until this row rendered for no
// demo tenant at all — `/portal/payment-plan` was listed as scanned while only
// its "you're not on a plan" empty state was ever reached, and the dashboard's
// plan card, live since B-090c, had never been in an audit on any run.
//
// A SEPARATE tenant from Dana, and that is the whole design (see the note beside
// DEMO_PLAN_TENANT_EMAIL). An active plan places a `payment_plan` hold, which
// halts dunning, late fees and access suspension — put it on Dana and the past-due
// banner, the delinquency queue, the dunning specs and the builder form's own
// scan all lose the thing they assert on.
//
// Read-only, both of them: nothing here submits anything, so the shared plan
// fixture comes out of a sweep exactly as it went in (B-120).
test.describe('signed in as the tenant on a payment plan', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsPlanTenant(page)
  })

  // a11y-state: /portal/payment-plan | active plan schedule
  test('the installment schedule has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal/payment-plan')
    await expect(page.getByRole('main')).toBeVisible()

    // The TABLE, not the empty state — a scan that passed because there was
    // nothing on the page is the failure this row exists to end, so assert the
    // schedule is really rendered before believing the result.
    await expect(page.getByRole('columnheader', { name: 'Left after' })).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(4) // header + three installments

    // B-193's nav entry, which renders on every portal route for a tenant with
    // a plan and is reached by nothing else in the suite.
    await expect(
      page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Payment plan' }),
    ).toBeVisible()

    await assertNoAxeViolations(page, { state: 'active plan schedule' })
  })

  // a11y-state: /portal | payment plan card
  test('the dashboard plan card has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal')
    await expect(page.getByRole('main')).toBeVisible()

    // The card itself, not the nav entry that shares its words.
    const card = page.getByRole('main').getByRole('status').filter({ hasText: 'payment plan' })
    await expect(card).toContainText("You're on a payment plan")
    await expect(card).toContainText('Your next payment is')
    await expect(card.getByRole('link', { name: 'See the full schedule' })).toBeVisible()

    await assertNoAxeViolations(page, { state: 'payment plan card' })
  })
})
