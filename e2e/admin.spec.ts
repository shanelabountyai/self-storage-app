import { ADMIN_SCAN_ROUTES as ADMIN_ROUTES } from '../apps/web/lib/a11y/scan-coverage'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations, expectPreexisting } from './a11y-helpers'

// Proves the edge-level gate (apps/web/proxy.ts) actually redirects, which is
// the security-critical property of "role-gated routes" (PRD 02 FR-1-3).
//
// A full authenticated pass (rendering the shell, axe scan) is deferred to
// B-033, which builds the real sign-in screen — that's the more valuable
// place to exercise a real session than forging one here.
test.describe('admin role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('the second-factor field is reachable at a bare /login (B-108)', async ({ page }) => {
    // The bug: the field keyed off `audienceFor`, which defaults to TENANT
    // when there is no `?from=`. An enrolled staff member reaching /login by
    // bookmark, typed address or sign-out got no code field, submitted without
    // one, and was refused — the "correct password rejected" symptom D-47
    // exists to kill, arriving by a different route.
    await page.goto('/login')
    await expect(page.getByLabel('Authentication code')).toBeVisible()

    // And it is byte-identical to the staff-hinted form: no branch here is
    // observable, so nothing about it enumerates accounts.
    await page.goto('/login?from=%2Fadmin')
    await expect(page.getByLabel('Authentication code')).toBeVisible()
  })

  test('a bare /login says staff cannot use a sign-in link, as a general fact (B-108)', async ({
    page,
  }) => {
    // D-40. The disclosure is offered at a bare /login, and a staff member who
    // used it was told a link was on its way that flows.ts will never mint.
    // The sentence is true of staff accounts as a class and says nothing about
    // whether the address in the box is one.
    await page.goto('/login')
    await page.getByText('Email me a sign-in link instead').click()
    await expect(
      page.getByText(/Staff accounts always sign in with a password and an authentication code/),
    ).toBeVisible()
  })

  test('preserves the originally requested path for a post-login return', async ({ page }) => {
    await page.goto('/admin/units')
    await expect(page).toHaveURL(/\/login\?from=%2Fadmin%2Funits/)
  })
})

// --- authenticated pass -------------------------------------------------------
// B-094. Everything above tests the gate; nothing tested the surface behind it,
// and PRD 02 had no accessibility section at all — which is why /admin carried
// the majority of the accessibility audit's blocking findings.
test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  // B-139. Moved to `apps/web/lib/a11y/scan-coverage.ts` — see the note there.

  for (const route of ADMIN_ROUTES) {
    test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()

      await assertNoAxeViolations(page)
    })
  }

  // 1.4.10 Reflow, which PRD 02 FR-16 applies to admin as well as the customer
  // site. B-094 fixed the shell — a fixed 192px side nav beside the content, a
  // header that could not wrap, an unbreakable JSON example, and two unwrapped
  // hours tables. B-116 finished the three it left: the unit list, the
  // unit-type list and the settings forms. All three shared one real cause,
  // not three — see `[contain:layout]` on `<main>` in `admin/layout.tsx`.

  for (const route of ADMIN_ROUTES) {
    test(`${route} reflows to 320px without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(route)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'admin scrolls horizontally at 320px').toBe(false)
    })
  }

  // B-119 (test gap 6). Axe and reflow were the only two of a11y.spec.ts's
  // four PUBLIC_ROUTES loops that ever ran anywhere near admin — 200% zoom
  // and forced text spacing had never touched a staff-facing screen at all.
  test.describe('text zoomed to 200%', () => {
    test.use({ viewport: { width: 640, height: 512 }, deviceScaleFactor: 2 })

    for (const route of ADMIN_ROUTES) {
      test(`${route} survives 200% zoom`, async ({ page }) => {
        // The outer describe's beforeEach (line ~30) already signs in.
        await page.goto(route)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(overflow, 'admin scrolls horizontally at 200% zoom').toBe(false)
      })
    }
  })

  const TEXT_SPACING = `* {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }`

  for (const route of ADMIN_ROUTES) {
    test(`${route} tolerates forced text spacing`, async ({ page }) => {
      await page.goto(route)
      await page.addStyleTag({ content: TEXT_SPACING })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'content is clipped when text spacing is increased').toBe(false)
    })
  }

  test('the first tab stop in admin is the skip link', async ({ page }) => {
    // 2.4.1. Without it a keyboard user tabs the switcher, the search, the
    // bell, the user menu, sign-out and every nav item on every page load.
    await page.goto('/admin')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  })

  test('changing the facility select does not navigate', async ({ page }) => {
    // 3.2.2 On Input. Arrow-keying a <select> fires `change` on every option
    // passed on some platforms, so an auto-submitting switcher walked a
    // keyboard user through several wrong facilities to reach the one they
    // wanted — each a full page load that reset their focus.
    await page.goto('/admin/units')
    const before = page.url()

    const options = await page.getByLabel('Switch facility').locator('option').all()
    test.skip(options.length < 2, 'needs two assigned facilities to switch between')

    const target = await options[1].getAttribute('value')
    await page.getByLabel('Switch facility').selectOption(target!)
    await page.waitForTimeout(300)
    expect(page.url(), 'selecting an option navigated on its own').toBe(before)

    // And the explicit control still works.
    await page.getByRole('button', { name: 'Switch' }).click()
    await expect(page).toHaveURL(/\/admin\/units/)
  })

  // a11y-state: /admin/settings | settings submit refused
  test('an invalid settings submit reports the error next to the field', async ({ page }) => {
    // 3.3.1/3.3.3/4.1.3, and the scan that matters: axe only ever sees a
    // freshly loaded page, so the error state was never checked by anything.
    await page.goto('/admin/settings')
    // "T1", not "TEXAS": the field carries maxLength={2}, so a longer string is
    // truncated to a perfectly valid "TE" before it ever reaches the server.
    await page.getByLabel('State').fill('T1')
    await page.getByRole('button', { name: 'Save details' }).click()

    // Scoped to <main>: Next ships its own empty role="alert" route announcer
    // in the document, and an unscoped query matches that instead.
    const alert = page.getByRole('main').getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('2-letter code')
    await expect(page.getByLabel('State')).toHaveAttribute('aria-invalid', 'true')

    await assertNoAxeViolations(page)
  })

  // a11y-state: /admin/settings | tax rate confirm-and-echo
  test('an append-only tax rate is confirmed before it publishes', async ({ page }) => {
    // 3.3.4 Error Prevention (Financial). Tax components cannot be edited or
    // deleted, so "Add rate" used to be one click from a rate every future
    // invoice applies.
    await page.goto('/admin/settings')

    // B-184 (T5). Pre-mounted and empty before the submit — the confirm
    // sentence is announced from THIS region rather than from the bordered box
    // that arrives with it, which is what makes it reliable for VoiceOver/NVDA
    // rather than merely present for anyone reading the screen.
    const form = page.getByRole('form', { name: 'Add a tax component' })
    const status = form.getByRole('status')
    await expectPreexisting(status)

    await form.getByLabel('Jurisdiction').fill('e2e-check')
    await form.getByLabel('Rate (%)').fill('8.25')
    await form.getByRole('button', { name: 'Add rate' }).click()

    // Echoes back what it parsed, in the user's terms, and waits.
    await expect(status).toHaveText(/cannot be edited or deleted/)
    await expect(page.getByRole('button', { name: 'Yes, add it' })).toBeVisible()
    await expect(page.getByText('8.25%')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  // The fat-finger case — 825 typed into a percent field — cannot be driven
  // from here: the input carries max="100", so the browser refuses to submit
  // and the server is never reached. That client-side guard is not the one that
  // matters (a crafted POST skips it entirely), so the server-side range check
  // is unit-tested directly in tests/form-state.test.ts.
})

test.describe('billing settings, given a screen', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  // Every field here shipped as a database column with no way to reach it.
  // These assert the screen exists and that its one piece of real parsing —
  // the retry schedule — reports a bad value beside the field rather than
  // throwing (FR-19/3.3.3).
  test('the billing policy is editable, not database-only', async ({ page }) => {
    await page.goto('/admin/settings')

    await expect(page.getByRole('heading', { name: 'Billing policy' })).toBeVisible()
    await expect(page.getByLabel('Billing day')).toBeVisible()
    await expect(page.getByLabel('Invoice this many days ahead')).toBeVisible()
    await expect(page.getByLabel('Retry a failed card on days')).toBeVisible()
    // B-098's two settings, which shipped column-only and are now reachable.
    await expect(page.getByLabel('Suspend gate access at')).toBeVisible()
    await expect(
      page.getByLabel('Restore access once the balance is at or below ($)'),
    ).toBeVisible()
  })

  test('the access threshold saves, and says what it now does', async ({ page }) => {
    await page.goto('/admin/settings')
    const form = page.getByRole('form', { name: 'Billing policy' })

    await form.getByLabel('Suspend gate access at').fill('0')
    await form.getByRole('button', { name: 'Save billing policy' }).click()

    // Zero disables the rule, and the confirmation says so rather than echoing
    // a number that reads like a threshold of nought days.
    await expect(form.getByText(/never suspended for non-payment/)).toBeVisible()

    await form.getByLabel('Suspend gate access at').fill('6')
    await form.getByRole('button', { name: 'Save billing policy' }).click()
    await expect(form.getByText(/suspended at 6 days past due/)).toBeVisible()
  })

  test('a retry schedule out of order is refused with the reason', async ({ page }) => {
    await page.goto('/admin/settings')

    const form = page.getByRole('form', { name: 'Billing policy' })
    await form.getByLabel('Retry a failed card on days').fill('5, 1')
    await form.getByRole('button', { name: 'Save billing policy' }).click()

    // The days count from the original due date, so a decreasing list is not a
    // faster schedule — it is one whose later attempt is already in the past.
    // Twice over, which is the AdminForm pattern: once in the error summary at
    // the top and once beside the field itself.
    await expect(form.getByText(/increasing order/).first()).toBeVisible()
    await expect(form.getByText(/increasing order/)).toHaveCount(2)
  })

  test('the last four column-only settings are reachable', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page.getByRole('heading', { name: 'Operations policy' })).toBeVisible()

    const form = page.getByRole('form', { name: 'Operations policy' })
    await form.getByLabel('Named people per lease').fill('4')
    await form.getByRole('button', { name: 'Save operations policy' }).click()

    await expect(form.getByText(/Up to 4 named people per lease/)).toBeVisible()
  })

  test('the late-fee ladder is editable and refuses an uncapped percentage', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page.getByRole('heading', { name: 'Late fees' })).toBeVisible()

    const form = page.getByRole('form', { name: 'Add a late-fee step' })
    await form.getByLabel('Cap ($)').fill('')
    await form.getByRole('button', { name: 'Add step' }).click()

    // An uncapped percentage is the one shape that can run away, so it is
    // refused rather than warned about.
    await expect(form.getByText(/needs a cap/).first()).toBeVisible()
  })
})

test.describe('template editor (B-053)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('lists templates, shows the field picker and a rendered preview', async ({ page }) => {
    await page.goto('/admin/settings/templates')

    await expect(page.getByRole('heading', { name: /^Message templates/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Fields you can use' })).toBeVisible()

    // The preview renders sample data, so an operator reads the sentence rather
    // than the placeholders.
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(page.getByText('{{tenant.first_name}}').first()).toBeVisible()
    await expect(preview.getByText(/From:/)).toBeVisible()
  })

  test('has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/settings/templates')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('blocks publishing a field the event cannot supply', async ({ page }) => {
    await page.goto('/admin/settings/templates')

    const form = page.getByRole('form', { name: /^Edit / })
    await form.getByLabel('Message').fill('Hi {{tenant.middle_name}}, your rent is due.')
    await form.getByRole('button', { name: 'Publish new version' }).click()

    // Blocked rather than warned: this would fail at send time, in a job, with
    // the tenant simply never hearing from us.
    await expect(form.getByText(/tenant\.middle_name/).first()).toBeVisible()
  })


})
test.describe('the dashboard (B-113)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('every tile links to the list behind it', async ({ page }) => {
    // Five of seven were dead ends, including both tiles that mean somebody
    // has to act. "Failed payments today: 3 · needs attention" with nowhere
    // to go teaches the reader to skip the row — the exact failure that
    // tile's own rewrite was meant to prevent.
    await page.goto('/admin')
    const tiles = page.getByRole('main').locator('a').filter({ hasText: /today|Available now|Occupancy|Money owed/ })
    const count = await tiles.count()
    expect(count).toBeGreaterThanOrEqual(6)
    for (let index = 0; index < count; index += 1) {
      await expect(tiles.nth(index)).toHaveAttribute('href', /^\/admin\//)
    }
  })

  test('reports money owed in dollars, agreeing with the report it links to', async ({ page }) => {
    // The tile counted `Lease.status = 'delinquent'`, which nothing sets
    // until B-057, so it read 0 beside real receivables. Both figures now
    // come from `delinquencyReport` — this asserts they arrive equal on the
    // two screens, which is the thing a shared module is FOR.
    await page.goto('/admin')
    const tile = page.getByRole('link').filter({ hasText: 'Money owed' })
    await expect(tile).toBeVisible()
    const shown = (await tile.innerText()).match(/\$[\d,]+\.\d{2}/)?.[0]
    expect(shown, 'the tile shows a dollar figure, not a count').toBeTruthy()

    const facilityName = await page.getByRole('heading', { level: 1 }).innerText()
    await page.goto('/admin/reports/delinquency')
    // `.first()` is the aging table's own row for this facility; the detail
    // table below it repeats the name once per delinquent tenant.
    const row = page.getByRole('row').filter({ hasText: facilityName }).first()
    await expect(row).toContainText(shown!)
  })

  test('All facilities rolls up instead of sending the owner away', async ({ page }) => {
    // D-12: owner + all-facilities is the ordinary unrestricted account, so
    // this is the owner's own default context — not an exotic state.
    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption('all')
    await page.getByRole('button', { name: 'Switch', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'All facilities' })).toBeVisible()
    const rollup = page.getByRole('region', { name: 'Across your facilities' })
    await expect(rollup).toBeVisible()
    // Each row links into that facility without changing the switcher.
    const first = rollup.getByRole('link').first()
    await expect(first).toHaveAttribute('href', /\/admin\?facility=/)
    await first.click()
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('All facilities')
  })

  test('New inquiry opens with a facility selector rather than refusing', async ({ page }) => {
    // The screen exists so a ringing phone costs one click, and the target is
    // sixty seconds end to end. "Pick a specific facility above" spent that
    // budget before the caller finished their sentence.
    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption('all')
    await page.getByRole('button', { name: 'Switch', exact: true }).click()
    // Await the switch landing before navigating: the cookie is set by the
    // server action, and a `goto` racing it lands on the single-facility page.
    await expect(page.getByRole('heading', { name: 'All facilities' })).toBeVisible()
    await page.goto('/admin/leads')

    const form = page.getByRole('form', { name: 'New inquiry' })
    await expect(form).toBeVisible()
    await expect(form.getByLabel('Facility')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Across your facilities' })).toBeVisible()
  })
})

test.describe('units (B-116)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('add-a-unit and import-layout moved off the daily inventory screen', async ({ page }) => {
    await page.goto('/admin/units')
    await expect(page.getByRole('heading', { name: 'Add a unit' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Import layout (JSON)' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Add or import units' }).click()
    await expect(page).toHaveURL(/\/admin\/units\/setup/)
    await expect(page.getByRole('heading', { name: 'Add a unit' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Import layout (JSON)' })).toBeVisible()
  })

  test('/admin/units/setup has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/units/setup')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('an occupied unit names the tenant and links to their profile', async ({ page }) => {
    // Not scoped to the table's own `row` role: below `sm` the table is
    // `hidden` in favour of the card list, which carries the identical link
    // with no table semantics at all. `.first()` rather than a strict single
    // match, because POS's own real, permanent walk-in move-ins
    // (admin-pos.spec.ts) can leave this demo tenant (B-034) holding more
    // than one unit across a session's repeated sweeps.
    await page.goto('/admin/units')
    const link = page.getByRole('main').getByRole('link', { name: 'Alex Active' }).first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /\/admin\/tenants\/.+/)
  })

  test('paginates at 50, and the total is the true total rather than the page size', async ({ page }) => {
    // The e2e sandbox facility seeds 250 units specifically to give this a
    // real fifth page — Austin and Dallas both stay under 50 on purpose.
    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption({ label: 'Demo — E2E Sandbox' })
    await page.getByRole('button', { name: 'Switch', exact: true }).click()
    // Waited rather than raced: the cookie is set by the server action, and a
    // `goto` straight to /admin/units before it lands reads the OLD facility
    // — the same trap "New inquiry opens with a facility selector" above
    // already documents.
    await expect(page.getByRole('heading', { name: 'Demo — E2E Sandbox' })).toBeVisible()
    await page.goto('/admin/units')

    await expect(page.getByRole('status').filter({ hasText: /Showing \d+–\d+ of \d+/ })).toHaveText(
      'Showing 1–50 of 250',
    )
    const nav = page.getByRole('navigation', { name: 'Pages' })
    await expect(nav.getByText('Page 1 of 5')).toBeVisible()

    await nav.getByRole('link', { name: 'Next' }).click()
    await expect(page).toHaveURL(/[?&]page=2/)
    await expect(page.getByRole('status').filter({ hasText: /Showing \d+–\d+ of \d+/ })).toHaveText(
      'Showing 51–100 of 250',
    )
  })
})

test.describe('nav grouping (B-117)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('the desktop nav is grouped into four labelled sections, and drops Leases/Audit Log', async ({ page }) => {
    // Explicit rather than relying on the project's own default viewport —
    // this is a claim about the DESKTOP markup specifically, and mobile-chrome
    // defaults to 412px, below the `sm` breakpoint that switches it on.
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'Admin' })
    for (const heading of ['Today', 'Property', 'Money & tenants', 'Admin']) {
      await expect(nav.getByRole('heading', { name: heading })).toBeVisible()
    }
    await expect(nav.getByRole('link', { name: 'Leases' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Audit Log' })).toHaveCount(0)
    // Neither placeholder route is reachable by URL either, now that nothing
    // in the nav names it.
    const response = await page.goto('/admin/leases')
    expect(response?.status()).toBe(404)
  })

  test('below sm, Tasks is in the Today strip and everything else sits behind More', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'Admin' })

    // Visible without opening anything — Walkthrough and Tasks used to sit at
    // positions 9 and 14 in one flat list.
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()

    const more = nav.getByText('More')
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0)
    await more.click()
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
  })
})
