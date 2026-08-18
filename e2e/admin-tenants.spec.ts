import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

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

  test('a search with no matches says so', async ({ page }) => {
    await page.goto('/admin/tenants?q=zzz-nobody-zzz')
    await expect(page.getByText(/No tenants match/)).toBeVisible()
  })

  test('the tenant profile has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await expect(page.getByRole('main')).toBeVisible()

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

  test('puts a generation refusal on the screen instead of failing', async ({ page }) => {
    // The reachable contract, and it is narrower than it looks — see B-130.
    //
    // NO demo lease can generate a lien notice: measured 2026-08-18 with the
    // product's own `previewNotice`, 0 of 14. Twelve owe nothing and one is in
    // credit, which are correct refusals; the fourteenth is the DELINQUENT
    // lease this screen belongs to, and it refuses with
    // `ledger_does_not_reconcile`. So B-061's generation path — and therefore
    // B-083's send button, which only appears on a generated notice — cannot be
    // reached from demo data at all. B-130 owns fixing the seed.
    //
    // What is assertable today is that the refusal REACHES the screen with its
    // reason, rather than rendering an error boundary or a missing button with
    // no explanation. That is worth pinning on its own: it is the state every
    // operator opening this screen against a non-reconciling lease will see.
    const main = page.getByRole('main')
    await expect(main).toContainText('Nothing generated for this lease yet')
    await expect(main.getByRole('alert').first()).toContainText('Cannot generate this notice')
  })
})
