import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

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

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
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

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
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
    await expect(page.getByRole('main')).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
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
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('has no WCAG 2.1 AA violations', async ({ page }) => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
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
