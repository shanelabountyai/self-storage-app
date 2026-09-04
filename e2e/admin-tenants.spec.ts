import { expect, test, type Page } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'

// B-181. The occasional write forms live behind native <details> now — the
// support-session form was the third thing on the page and the leases were the
// ninth. Playwright will not fill a control inside a closed disclosure, and
// that refusal is the point: a spec that still passed without this would mean
// the form was never actually hidden.
async function openDisclosure(page: Page, name: string) {
  await page.locator('summary').filter({ hasText: name }).first().click()
}

// PRD 02 §4.4 US-13/US-16 (B-038). Search → profile, the same split as every
// other admin surface in this suite: gate first, then a real session.

test.describe('tenant search role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('/admin/tenants has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('searching by a demo tenant’s name finds them and links to their profile', async ({ page }) => {
    // dana@demo.example.com uniquely: two "Dana Delinquent" tenants exist
    // (one per demo facility), and the name alone would not tell them apart.
    // This one is B-034's seeded demo tenant with a real ledger charge.
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    const link = page.getByRole('link', { name: 'Dana Delinquent' })
    await expect(link).toBeVisible()
    await link.click()

    await expect(page).toHaveURL(/\/admin\/tenants\/.+/)
    await expect(page.getByRole('heading', { name: 'Dana Delinquent' })).toBeVisible()
    // Balance due — the honest delinquency signal (a real ledger charge),
    // not a fabricated "Delinquent" status label (see the page's own note).
    await expect(page.getByText(/Balance due/)).toBeVisible()
  })

  test('the leases are the first thing under the banners, and the writes are closed (B-181)', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    // Waits for the PROFILE, not for `main` — the list has a `main` too, so
    // `getByRole('main')` is satisfied before the navigation and the first
    // draft of this test read the list's headings and reported none.
    await expect(page.getByRole('heading', { name: 'Dana Delinquent', level: 1 })).toBeVisible()

    // The units, rates and balances used to be the ninth section, behind three
    // write forms. Asserted by POSITION rather than by presence, because the
    // section was always present — being ninth was the defect.
    // textContent, not innerText: two of the banner headings are `sr-only`,
    // which is a rendering state, and asserting on what is RENDERED would make
    // this pass or fail on a CSS class rather than on the order.
    const headings = (
      await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents()
    ).map((h) => h.trim())
    expect(headings).toContain('Leases')
    expect(headings.indexOf('Leases')).toBeLessThan(headings.indexOf('Contact'))
    expect(headings.indexOf('Leases')).toBeLessThan(headings.indexOf('Actions'))

    // And the support-session form is still on the page — one disclosure away,
    // not deleted, and reporting its own collapsed state (4.1.2).
    const impersonate = page.locator('details').filter({
      has: page.locator('summary', { hasText: 'View the portal as this tenant' }),
    })
    await expect(impersonate).toHaveCount(1)
    await expect(impersonate).not.toHaveAttribute('open', /.*/)
    // Scoped to this disclosure: "Reason" is also the label on Place a hold,
    // which now sits in the same region — both are inside their own named
    // form, so they are distinguishable to a reader and only to a bare
    // getByLabel are they the same field.
    await expect(impersonate.getByLabel('Reason')).toBeHidden()
  })

  test('a search with no matches says so', async ({ page }) => {
    await page.goto('/admin/tenants?q=zzz-nobody-zzz')
    await expect(page.getByText(/No tenants match/)).toBeVisible()
  })

  // a11y-state: /admin/tenants/[tenantId] | disclosure open
  test('the tenant profile has no WCAG 2.1 AA violations, with a disclosure open', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await expect(page.getByRole('main')).toBeVisible()

    // FR-25 (1), and B-184's whole complaint: a route in the scan list is not
    // the same as its states being scanned. Everything behind a closed
    // <details> is invisible to axe, so B-181's disclosures would have moved
    // half the page's controls out of the audit rather than into it. Two are
    // opened — one write form, one long-log "show more" — before the pass.
    await openDisclosure(page, 'Edit contact details')
    await openDisclosure(page, 'Place a hold')
    // B-90 part 3. The plan builder's per-installment grid is its own
    // disclosure, same reasoning as the two above.
    await openDisclosure(page, 'Set up a payment plan')

    // B-196. The state is passed, not only commented: the `[contain:layout]`
    // obscuring exemption is scoped to this route IN THIS STATE, because the
    // limitation needs a page taller than one screen and the open disclosure is
    // what makes it one.
    await assertNoAxeViolations(page, { state: 'disclosure open' })
  })

  // a11y-state: /admin/tenants/[tenantId] | sticky summary
  //
  // B-240. Two claims in one pass, because reaching the page is the expensive
  // half. (1) Every anchor in the new nav lands on a heading that is actually
  // on the page — two of the six sections render conditionally, so a link to an
  // id nothing painted is the failure mode this list invites. (2) Activating
  // one moves FOCUS to that heading rather than only scrolling (2.4.3); the
  // `tabIndex={-1}` on the target is what makes the native fragment jump do it,
  // and nothing else in the repo would notice if it were dropped.
  //
  // Read-only against the shared fixture (B-120): nothing here submits.
  test('the profile summary and its in-page nav reach every section they name', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await expect(page.getByRole('main')).toBeVisible()

    // The four facts, as labelled pairs rather than bare numbers.
    await expect(page.getByText('Balance due')).toBeVisible()
    await expect(page.getByText('Days past due')).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'On this profile' })
    const links = await nav.getByRole('link').all()
    expect(links.length).toBeGreaterThan(3)
    for (const link of links) {
      const href = await link.getAttribute('href')
      await expect(page.locator(href!), `${href} names a heading this page does not render`).toHaveCount(1)
    }

    await nav.getByRole('link', { name: 'Take action' }).click()
    await expect(page.locator('#actions-heading')).toBeFocused()

    // Scanned where the bar is actually STUCK — at the top of the document it
    // is an ordinary block, and the state this key names is the one where it
    // overlays the sections below it.
    await page.mouse.wheel(0, 2000)
    await assertNoAxeViolations(page, { state: 'sticky summary' })
  })

  test('the military-service control states its consequences before it is used (B-121)', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    await openDisclosure(page, 'Military service')
    const scra = page.getByRole('group', { name: /Active-duty military/ })
    await expect(scra).toBeVisible()
    // The consequence is on screen BEFORE the choice, not discovered after it:
    // recording yes halts collections on leases at facilities this staffer may
    // not even be able to open.
    await expect(scra).toContainText('every lease they hold')
    await expect(scra).toContainText('including at other facilities')
    // And the asymmetry that keeps US-42's manager-only lift honest.
    await expect(scra).toContainText('until a manager lifts it')

    // Records "No", deliberately, and never "Yes".
    //
    // This is the B-120 discipline applied to a spec that has to mutate shared
    // demo state: recording no writes the flag and places NO hold, so a full
    // sweep leaves Dana exactly as dunnable as it found her — while a "Yes"
    // here would halt collections on the tenant that the portal past-due
    // banner, the delinquency queue and the dunning specs all depend on being
    // chased. The placing side is proved 11 ways over in
    // tests/active-duty-scra-db.test.ts against disposable fixtures.
    await scra.getByRole('radio', { name: /^No/ }).check()
    await page.getByRole('button', { name: 'Save military service' }).click()

    await expect(page.getByRole('status').filter({ hasText: /not active-duty/ })).toBeVisible()
  })

  test('adding a note shows it immediately, with author and pin control', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    const noteText = `Called about balance — e2e ${Date.now()}`
    await openDisclosure(page, 'Add a note')
    await page.getByLabel('New note').fill(noteText)
    await page.getByRole('button', { name: 'Add note' }).click()

    await expect(page.getByText(noteText)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pin' }).first()).toBeVisible()
  })

  test('logging a document with a blank title is refused server-side, not just by the required attribute', async ({
    page,
  }) => {
    // A single space passes the browser's native `required` check (which only
    // rejects an empty string) but not the server's trim-based validation —
    // proving the real rejection happens server-side, the same guarantee a
    // crafted request without JavaScript needs.
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    await openDisclosure(page, 'Log a document')
    await page.getByLabel('Title').fill(' ')
    await page.getByRole('button', { name: 'Log document' }).click()
    // AdminForm renders the same message twice on error — once in the field
    // list, once beside the field itself — so this asserts count rather than
    // picking one.
    await expect(page.getByRole('main').getByText(/Enter a title/)).toHaveCount(2)
  })
})

test.describe('the tenant ledger (B-049)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('reaches a ledger from the profile, reconciled, and exports it', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: /^Ledger/ }).first().click()

    await expect(page.getByRole('heading', { name: /^Ledger — unit/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Balance' })).toBeVisible()

    // US-24's AC is stated on the screen rather than left in a document.
    await expect(page.getByRole('heading', { name: /Reconciled|Does not reconcile/ })).toBeVisible()

    // The export comes from the same call as the screen, so the closing
    // balance on the last row must be the balance the page reports.
    const balance = await page
      .getByRole('term')
      .filter({ hasText: 'Balance' })
      .locator('xpath=following-sibling::dd[1]')
      .innerText()

    const response = await page.request.get(`${page.url()}/ledger.csv`)
    expect(response.headers()['content-type']).toContain('text/csv')
    // Per-tenant money must never be cached by a shared proxy.
    expect(response.headers()['cache-control']).toContain('no-store')

    const rows = (await response.text()).trim().split('\r\n')
    if (rows.length > 1) {
      const lastBalance = rows[rows.length - 1].split(',').at(-1)!.replace(/"/g, '')
      expect(balance.replace(/[$,]/g, '')).toBe(lastBalance)
    }
  })

  test('the ledger has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: /^Ledger/ }).first().click()
    // B-201. `waitForURL`, not just a visible `<main>` — the profile's own
    // `<main>` is already visible, so without it the scan below can win the
    // race against the client-side transition and scan the PREVIOUS page. This
    // is the fault B-199 diagnosed and fixed on the lien-notices scan; the same
    // two lines were here and in the move-out scan the whole time. It surfaced as
    // a `color-contrast` incomplete naming `.text-left > .text-right`, a
    // profile element that is not on this route, with the "no longer in the
    // DOM" note `assertNoAxeViolations` prints for exactly this case.
    await page.waitForURL(/\/ledger\//)
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })
})

test.describe('the tenant list (B-114)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('lists tenants without being asked a question first (B-114)', async ({ page }) => {
    // The screen was a heading, a search box and nothing else until you typed.
    await page.goto('/admin/tenants')

    await expect(page.getByRole('status').filter({ hasText: /Showing \d+–\d+ of \d+/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Balance' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Days past due' })).toBeVisible()

    // The row is a link to the profile, which is the next thing anybody wants.
    const firstRow = page.getByRole('row').nth(1)
    await expect(firstRow.getByRole('link')).toHaveAttribute('href', /\/admin\/tenants\/.+/)
  })

  test('filter chips are links, so a view is shareable (B-114)', async ({ page }) => {
    await page.goto('/admin/tenants')
    const filters = page.getByRole('navigation', { name: 'Filter tenants' })
    await expect(filters.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')

    await filters.getByRole('link', { name: 'Past due' }).click()
    // A URL somebody can send to a colleague — not client state.
    await expect(page).toHaveURL(/\/admin\/tenants\?filter=past_due/)
    await expect(
      page.getByRole('navigation', { name: 'Filter tenants' }).getByRole('link', { name: 'Past due' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('a past-due row carries the words, not only a colour (B-114)', async ({ page }) => {
    // 1.4.1. This is the column somebody acts on, and a tinted row says
    // nothing to anyone who cannot see the tint.
    await page.goto('/admin/tenants?filter=past_due')
    const row = page.getByRole('row').filter({ hasText: 'Dana Delinquent' }).first()
    await expect(row).toBeVisible()
    await expect(row).toContainText(/days past due/)
  })

  test('a truncated search says so rather than dropping matches (B-114)', async ({ page }) => {
    // The demo seed carries far fewer than 25 matching tenants, so this
    // asserts the honest case: an uncapped result set claims nothing.
    await page.goto('/admin/tenants?q=demo.example.com')
    await expect(page.getByText(/Showing the first 25 matches/)).toHaveCount(0)
    await expect(page.getByRole('row').nth(1)).toBeVisible()
  })
})

// B-196 (gap 4). The two payment-plan states on the tenant profile that nothing
// reached: the READ half, which renders only for a lease that has a plan, and a
// REFUSED submit of the builder — the densest new form in the product, twelve
// fields called "Due" and "Amount ($)", scanned until now only in its pristine
// state.
//
// Split across two tenants on purpose. The schedule needs a lease with a plan,
// which is Pia's; the refusal has to happen where the builder still renders,
// and the builder is deliberately hidden on a lease that already has an active
// plan — so it has to be Dana's. A refused submit writes nothing, which is what
// makes it safe to point at the lease four other suites depend on (B-120).

test.describe('payment plans on the tenant profile', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  // a11y-state: /admin/tenants/[tenantId] | payment plan schedule
  test('the agreed schedule has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=pia@demo.example.com')
    await page.getByRole('link', { name: 'Pia Planned' }).click()
    await expect(page.getByRole('main')).toBeVisible()

    // The schedule itself, not an empty heading: this whole row exists because
    // a scan of the surrounding furniture read as coverage of the table.
    const section = page.getByRole('region', { name: 'Payment plans' })
    await expect(section).toContainText('On a payment plan')
    await expect(section.getByRole('columnheader', { name: 'Left after' })).toBeVisible()

    await assertNoAxeViolations(page, { state: 'payment plan schedule' })
  })

  // a11y-state: /admin/tenants/[tenantId] | payment plan builder refused
  test('a refused plan says why, and the refusal has no WCAG 2.1 AA violations', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await openDisclosure(page, 'Set up a payment plan')

    // Submitted empty. `validateSchedule` refuses a plan with no installments
    // by name, the server round trip happens, and nothing is written — so this
    // is repeatable against the shared fixture for ever, unlike a valid plan,
    // which would halt collections on the one lease the dunning specs need
    // chased.
    await page.getByRole('button', { name: /^Agree the plan for unit/ }).click()

    // Scoped to the Actions region: the profile also renders a `role="alert"`
    // for the balance due, so an unscoped query is a strict-mode violation
    // rather than a missing summary.
    const alert = page.getByRole('region', { name: 'Actions' }).getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/at least one installment/i)
    await expect(alert).toBeFocused()

    await assertNoAxeViolations(page, { state: 'payment plan builder refused' })
  })

  // a11y-state: /admin/tenants/[tenantId] | payment plan builder refused per installment
  //
  // B-213. The refusal that lands ON an installment, which no test in the repo
  // had ever rendered — the empty submit above yields only `index: null`
  // problems, so `fieldErrors` is `{}` and no fieldset error is ever painted.
  // That gap is why B-192's group error could sit on the <fieldset> as
  // `aria-invalid`/`aria-describedby`, reaching no screen reader, through two
  // items and an axe pass.
  //
  // Read-only against the shared fixture (B-120): the schedule is refused, so
  // nothing is written and nothing on Dana's lease moves.
  test('a refusal about one installment reaches that installment, not just the summary', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await openDisclosure(page, 'Set up a payment plan')

    const details = page.locator('details').filter({ hasText: 'Set up a payment plan' })

    // Two installments, out of date order. `validateSchedule` reports that
    // against the SECOND one — an installment, not one of its two fields — and
    // the sum will not match either, which is a plan-level problem and belongs
    // in the summary rather than on a row.
    // B-248. The accessible name carries the ordinal now, because <legend> is
    // announced on entering the group and a rotor jump enters nothing — so
    // these are addressed by name rather than by `.nth()` off a name twelve
    // controls share.
    await details.getByLabel('Installment 1 due date').fill('2027-03-01')
    await details.getByLabel('Installment 1 amount ($)').fill('80.00')
    await details.getByLabel('Installment 2 due date').fill('2027-02-01')
    await details.getByLabel('Installment 2 amount ($)').fill('80.00')
    await details.getByRole('button', { name: /^Agree the plan for unit/ }).click()

    // The summary names WHERE to go, which is the one thing an error summary
    // is for and the one thing its ordinal-less <ul> could not say.
    const alert = page.getByRole('region', { name: 'Actions' }).getByRole('alert')
    await expect(alert).toContainText('Installment 2 is marked below.')

    // The group carries the message as part of its NAME, which is what every
    // screen reader announces on entering it — and is what reaches the bare
    // radios in the protection step and the SCRA declaration, which are not
    // `Field`s and can never be described by one.
    const group = details.getByRole('group', { name: /^Installment 2/ })
    await expect(group).toHaveAccessibleName(/must be in date order/)

    // And both controls inside it are described by that message and marked
    // invalid, so a jump straight to either one still carries it. Before this
    // they carried neither: the error is keyed `installment_2` while they are
    // named `dueDate_2` and `amount_2`.
    for (const field of ['Installment 2 due date', 'Installment 2 amount ($)']) {
      const control = group.getByLabel(field, { exact: true })
      await expect(control).toHaveAccessibleDescription(/must be in date order/)
      await expect(control).toHaveAttribute('aria-invalid', 'true')
    }

    // The <fieldset> itself no longer claims an invalid state it cannot convey.
    await expect(group).not.toHaveAttribute('aria-invalid', 'true')

    await assertNoAxeViolations(page, { state: 'payment plan builder refused per installment' })
  })

  // B-212. The even split, which exists because the staffer was making up to
  // six amounts sum to the arrears to the cent, in their head, at a counter.
  //
  // Read-only against the shared fixture on purpose (B-120): it fills the form
  // and reads the running total, and never submits. Agreeing a plan on Dana
  // would place a `payment_plan` hold and halt collections on the one lease
  // the dunning specs need chased.
  test('fills a schedule that adds up exactly, without being asked to do the sum', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await openDisclosure(page, 'Set up a payment plan')

    const details = page.locator('details').filter({ hasText: 'Set up a payment plan' })
    // `.first()`: this disclosure holds TWO polite regions — the running
    // total, and `AdminForm`'s own success region, which is empty at idle and
    // sits inside the <form> below it (B-184). The running total is first in
    // DOM order, which is also where it belongs on screen.
    const total = details.getByRole('status').first()

    // Nothing typed yet, so the whole arrears is still to allocate — and the
    // figure is the PAST DUE one, not the lease balance beside it.
    await expect(total).toContainText(/to allocate\.$/)

    await details.getByLabel('Split into').selectOption('3')
    await details.getByLabel('First one due').fill('2027-01-31')
    await details.getByRole('button', { name: 'Fill the schedule' }).click()

    await expect(total).toHaveText(/^Adds up exactly to \$/)

    // Monthly, with the day of month clamped rather than rolled forward —
    // naive month arithmetic puts installments 2 and 3 both in March.
    await expect(details.getByLabel('Installment 1 due date')).toHaveValue('2027-01-31')
    await expect(details.getByLabel('Installment 2 due date')).toHaveValue('2027-02-28')
    await expect(details.getByLabel('Installment 3 due date')).toHaveValue('2027-03-31')

    // Editing after the fill is the point of a suggestion: the total follows.
    await details.getByLabel('Installment 1 amount ($)').fill('1.00')
    await expect(total).toContainText('still to allocate')
  })

  // B-248 / SC 4.1.3. The region used to render the live figure, and the
  // comment above it claimed a polite region "coalesces" so typing announces
  // once. It does not — NVDA queues each text change and JAWS speaks them —
  // so typing `306.23` into one of twelve amount fields was six full
  // sentences of money owed. Counting the region's DISTINCT text values is
  // exactly what an assistive technology queues, and is what fails if the
  // 700ms settle is removed: six values before, one now.
  //
  // Read-only against the shared fixture (B-120): nothing is submitted.
  test('one field edit changes the running total once, not once per keystroke', async ({
    page,
  }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await openDisclosure(page, 'Set up a payment plan')

    const details = page.locator('details').filter({ hasText: 'Set up a payment plan' })
    const total = details.getByRole('status').first()
    await expect(total).toContainText(/to allocate\.$/)

    await total.evaluate((node) => {
      const seen: string[] = []
      ;(window as unknown as { __b248: string[] }).__b248 = seen
      new MutationObserver(() => {
        const text = node.textContent ?? ''
        if (seen[seen.length - 1] !== text) seen.push(text)
      }).observe(node, { characterData: true, childList: true, subtree: true })
    })

    // Typed a character at a time, the way a person types it. Deliberately a
    // SMALL amount: it only has to stay under whatever the fixture's arrears
    // is for the figure to read "still to allocate", so this does not break
    // the day the demo seed's past-due number moves. `12.34` is still four
    // distinct running totals before the settle ($1.00, $12.00, $12.30,
    // $12.34) — the `12.` keystroke parses to the same cents as `12`.
    await details.getByLabel('Installment 1 amount ($)').pressSequentially('12.34', { delay: 40 })
    await expect(total).toContainText('still to allocate')

    const seen = await page.evaluate(() => (window as unknown as { __b248: string[] }).__b248)
    expect(seen).toHaveLength(1)
  })

  // B-212. The builder used to render for every non-ended lease with no active
  // plan, so a current tenant got twelve fields over "$0.00 is past due" that
  // refused every submit.
  test('is not offered on a lease with nothing past due', async ({ page }) => {
    await page.goto('/admin/tenants?q=alex.active5@demo.example.com')
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await expect(page.getByRole('region', { name: 'Actions' })).toBeVisible()
    await expect(page.locator('summary').filter({ hasText: 'Set up a payment plan' })).toHaveCount(0)
  })
})

// B-083 / PRD 02 §4.6 US-30. The lien-notices screen for one lease.
//
// This dynamic sub-route had NO axe scan anywhere, despite admin.spec.ts's list
// comment claiming every per-entity route "already has its own axe scan in its
// topic file". It does now, added by the item that put a new form on it.
//
// Read-only throughout: nothing here generates or serves a notice. Generating
// one against shared demo data would leave a served lien notice on Dana's lease,
// which is the scheduling precondition the auction specs and the delinquency
// queue read — the unscoped-mutation trap B-120 documents.

test.describe('lien notices for a lease', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.getByRole('link', { name: 'Notices' }).first().click()
    // B-199. `waitForURL`, not just a visible `<main>`: the profile's own
    // `<main>` is already visible, so without this the axe scan below can win
    // the race against the client-side transition and scan the PREVIOUS page.
    // It presented as a `color-contrast` incomplete on this route naming two
    // nodes that do not exist on it — the profile's Balance column — because
    // axe read the old DOM while `page.url()` already reported the new path,
    // and the hit test then looked for those nodes on the page that had since
    // rendered. Diagnosed by scanning with the wait in place: zero incompletes.
    await page.waitForURL(/\/notices\//)
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has no WCAG 2.1 AA violations', async ({ page }) => {
    await assertNoAxeViolations(page)
  })

  test('names the variable to set rather than offering a button that would fail', async ({
    page,
  }) => {
    // The shipped state: no mail provider is configured here, in CI, or in any
    // preview deploy, and that is a supported state rather than a broken one.
    // Asserted as a contract because the alternative — a disabled button, or one
    // that errors when pressed — is what this posture exists to avoid.
    const main = page.getByRole('main')
    await expect(main).toContainText('CERTIFIED_MAIL_API_KEY')
    await expect(main.getByRole('button', { name: 'Send by certified mail' })).toHaveCount(0)
  })

  test('offers generation, now that a demo lease can actually reconcile (B-130)', async ({
    page,
  }) => {
    // This assertion is the inverse of the one it replaces, and the change IS
    // B-130. Until 2026-08-18 no demo lease could generate a lien notice — 0 of
    // 14, measured with the product's own `previewNotice` — because the seed
    // posted the delinquent lease's ledger charge with no `invoiceId`, so
    // `reconcile` counted the same amount twice and US-27 correctly refused to
    // state a claim from sources that disagreed. B-061's generation, its
    // service, and B-083's certified-mail send therefore had no e2e path at all.
    await expect(page.getByRole('button', { name: 'Generate and store' }).first()).toBeVisible()
    await expect(page.getByRole('main')).not.toContainText('Cannot generate this notice')
  })

  test('generates a lien notice, stores its hash, and records service (B-130)', async ({ page }) => {
    // The path that had never been exercised in a browser, on the most
    // legally-loaded screen in the product.
    //
    // Safe against shared demo data by B-120's third discipline: `global-setup`
    // deletes demo notices at the start of every run, which qualifies because
    // nothing in the suite reads a pre-existing notice and the seed itself
    // deletes them on re-run. It has to, because generating is deliberately NOT
    // idempotent — a notice is a served document, so the product creates a new
    // row rather than rewriting one.
    const main = page.getByRole('main')

    await main.getByRole('button', { name: 'Generate and store' }).first().click()

    // Stored and hashed, per US-16's evidence chain — not merely displayed.
    const notice = main.getByRole('listitem').filter({ hasText: /Lien notice|Pre-lien notice/ }).first()
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Not yet served')
    await expect(notice.getByText(/^[0-9a-f]{64}$/)).toBeVisible()

    // Serve it by certified mail, by hand — the flow an unconfigured install
    // uses, and the one B-083's send button sits beside.
    await notice.getByRole('combobox', { name: 'Method' }).selectOption('certified_mail')
    await notice.getByRole('textbox', { name: 'Tracking number' }).fill('9407-B130-TEST')
    await notice.getByRole('button', { name: 'Record delivery' }).click()

    const served = main.getByRole('listitem').filter({ hasText: /Lien notice|Pre-lien notice/ }).first()
    await expect(served).toContainText('9407-B130-TEST')
    await expect(served).not.toContainText('Not yet served')
  })
})

// B-199, then B-217. The leases table is seven columns wide with up to four
// action links in the last one, and it shipped with no scroll wrapper — so at
// 375px those links sat outside the document, untappable. Six tests in this
// file and `admin-notices` recorded it as a `mobile-chrome` flake for four
// items before anybody looked underneath.
//
// B-199 made the links reachable with a scroll wrapper and a `min-w-2xl`
// floor, and said in its own row that whether the answer was a scroll wrapper
// or a stacked layout was a UX call it was not making. B-217 made it: below
// `sm` the leases render as cards, so on a phone there is no sideways scroll
// to do. The wrapper and the floor are still there above `sm`, which is what
// the second test pins — dropping the floor would leave the table exactly as
// wide as the wrapper and crush seven columns rather than scroll them.
test.describe('the leases table on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test('renders each lease as a card rather than a sideways scroll', async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    const ledger = page.getByRole('link', { name: /^Ledger/ }).first()
    await expect(ledger).toBeVisible()

    // The visible rendering is the card list, not the table in a scroll
    // region — `closest` returns null because the table is `display: none`
    // here and this link is the card's.
    const inScrollRegion = await ledger.evaluate(
      (el) => el.closest('div.overflow-x-auto') !== null,
    )
    expect(inScrollRegion, 'the leases are still a sideways-scrolled table at 375px').toBe(false)

    // A tap target, not a 16px text link (2.5.5).
    const box = await ledger.boundingBox()
    expect(box, 'the Ledger link has no box').not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)

    // And the document still does not scroll sideways.
    const documentScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(documentScrolls, 'the page scrolls horizontally at 375px').toBe(false)

    // The click the six failing tests could not make.
    await ledger.click()
    await expect(page).toHaveURL(/\/ledger\//)
  })
})

test.describe('the leases table on a desk', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('keeps the scroll wrapper and its floor above sm', async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()

    const ledger = page.getByRole('link', { name: /^Ledger/ }).first()
    await expect(ledger).toBeVisible()

    const floored = await ledger.evaluate((el) => {
      const wrapper = el.closest('div.overflow-x-auto')
      const table = wrapper?.querySelector('table')
      if (!wrapper || !table) return null
      // The floor is what a narrowed wrapper has to overflow. `w-full` alone
      // would make these equal at any width.
      return table.getBoundingClientRect().width >= 672
    })
    expect(floored, 'the leases table has no overflow-x-auto wrapper').not.toBeNull()
    expect(floored, 'the min-w floor is gone, so a narrow wrapper crushes the columns').toBe(true)
  })
})
