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
