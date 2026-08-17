import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 US-2 / US-39 (B-042).

test.describe('reports role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/reports')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  for (const route of ['/admin/reports', '/admin/reports/rent-roll']) {
    test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      expect(
        violations.map((v) => `${v.id}: ${v.help}`),
        'axe found accessibility violations',
      ).toEqual([])
    })
  }

  test('shows a per-facility row and an all-facilities roll-up', async ({ page }) => {
    await page.goto('/admin/reports')
    await expect(page.getByRole('heading', { name: /^Reports/ })).toBeVisible()
    // The report's own roll-up ROW, not the facility switcher's option of the
    // same name — B-113 made "All facilities" selectable here, so a bare text
    // match now finds a hidden <option> first.
    await expect(
      page.getByRole('row').filter({ hasText: 'All facilities' }).first(),
    ).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Unit occ.' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Economic occ.' })).toBeVisible()
  })

  test('the CSV export matches the screen exactly', async ({ page }) => {
    // US-39's own AC. Same figures, same rounding — the export is generated
    // from the identical call, so this asserts they have not diverged.
    await page.goto('/admin/reports')
    const rolledUnitOcc = await page
      .getByRole('row')
      .filter({ hasText: 'All facilities' })
      .first()
      .locator('td')
      .nth(3)
      .innerText()

    const response = await page.request.get('/admin/reports/occupancy.csv')
    expect(response.headers()['content-type']).toContain('text/csv')
    const csv = await response.text()

    const totalLine = csv.split('\r\n').find((line) => line.startsWith('All facilities'))
    expect(totalLine, 'the export has no roll-up row').toBeTruthy()
    // The screen renders "50.2%"; the CSV carries "50.2".
    expect(totalLine!.split(',')[3]).toBe(rolledUnitOcc.replace('%', ''))
  })

  test('the rent roll is sorted by the biggest rate gap', async ({ page }) => {
    await page.goto('/admin/reports/rent-roll')
    await expect(page.getByRole('heading', { name: /^Rent roll/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Gap' })).toBeVisible()
  })
})

// B-082 part 4 / PRD 04 FR-AN-3. Funnel v2 and promo ROI.

test.describe('funnel v2 and promo ROI', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('the funnel offers the source and medium filters it has always accepted', async ({
    page,
  }) => {
    // `funnelReport` has taken `utmSource`/`utmMedium` since B-069 and nothing
    // could set them — the repo's "a field that changes behaviour ships with
    // its control" rule, broken in a report rather than a form.
    // `getByRole('combobox')` rather than `getByLabel`: the breakdown section
    // below is `aria-labelledby="by-source"`, so a label lookup for "Source"
    // matches the region as well as the select.
    await page.goto('/admin/reports/funnel')
    await expect(page.getByRole('combobox', { name: 'Source' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Medium' })).toBeVisible()

    // And they reach the report rather than being decoration — including for a
    // value with no events in the range, which is the case that used to render
    // as "Every source" over a report that was still filtered.
    await page.goto('/admin/reports/funnel?source=google&medium=cpc')
    await expect(page.getByRole('combobox', { name: 'Source' })).toHaveValue('google')
    await expect(page.getByRole('combobox', { name: 'Medium' })).toHaveValue('cpc')
  })

  test('the funnel breaks down by source and medium, and the rows foot', async ({ page }) => {
    await page.goto('/admin/reports/funnel')

    const breakdown = page.getByRole('table', { name: /by campaign source and medium/i })
    await expect(page.getByRole('heading', { name: 'By source and medium' })).toBeVisible()

    // The property worth asserting in a browser rather than a unit test: what
    // is RENDERED adds up to the funnel table above it. A breakdown that does
    // not foot is two sets of numbers to reconcile.
    const funnelSessions = Number(
      await page
        .getByRole('table', { name: /Funnel steps with conversion rates/i })
        .getByRole('row')
        .filter({ hasText: 'Sessions' })
        .getByRole('cell')
        .first()
        .innerText(),
    )

    if (funnelSessions > 0) {
      const cells = await breakdown.locator('tbody tr td:nth-child(2)').allInnerTexts()
      const summed = cells.reduce((total, cell) => total + Number(cell), 0)
      expect(summed, 'the breakdown must add up to the funnel above it').toBe(funnelSessions)
    }
  })

  test('the funnel names every follow-up sequence, including the ones at zero', async ({
    page,
  }) => {
    await page.goto('/admin/reports/funnel')
    const heading = page.getByRole('heading', { name: 'Move-ins a follow-up brought back' })
    await expect(heading).toBeVisible()

    // A missing row reads as "we do not measure that"; a zero reads as "it did
    // not work", which is the true statement.
    const section = page.locator('section', { has: heading })
    const empty = await section.getByText('No move-ins in this range').count()
    if (empty === 0) {
      await expect(section.getByRole('rowheader', { name: /Abandoned-checkout/ })).toBeVisible()
      await expect(section.getByRole('rowheader', { name: /Lead follow-up drip/ })).toBeVisible()
      // The overlap warning is not optional: the rows legitimately sum to more
      // than the total, and a reader who does not know that will call it a bug.
      await expect(section).toContainText('counted in more than one row')
    }
  })

  test('promo ROI separates the discount given from the discount still owed', async ({ page }) => {
    await page.goto('/admin/reports/promotions')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Promotions')

    // The two-column split is the entire point of the report, so it is asserted
    // as a contract rather than left to whether the demo data happens to show
    // an interesting number.
    await expect(page.getByRole('columnheader', { name: 'Discount given' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Still to give' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Months to earn back' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('actually come off an invoice')

    // The seeded campaign has applied one of its two periods, so given and
    // still-to-give must differ — a populated row, not just a header. Both
    // being zero would satisfy the headers above and prove nothing.
    const row = page.getByRole('row').filter({ hasText: 'Spring — half off two months' })
    await expect(row).toBeVisible()
    const given = (await row.getByRole('cell').nth(3).innerText()).trim()
    const owed = (await row.getByRole('cell').nth(4).innerText()).trim()
    expect(given).not.toBe('$0.00')
    expect(given).toBe(owed)
    // Redeemed once, moved in once, still renting — so there is a payback
    // figure rather than the em dash an all-departed promotion gets.
    // Index 6, not 7: the promotion name is a `th scope="row"`, which is a
    // rowheader rather than a cell, so the seven data columns are 0..6.
    await expect(row.getByRole('cell').nth(6)).not.toHaveText('—')
  })

  test('the reports index links to promo ROI', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Promotions — what each discount bought/ }).click()
    await expect(page).toHaveURL('/admin/reports/promotions')
  })
})

// B-082 part 5 / PRD 04 §7 Phase 2. Search Console indexation monitoring.

test.describe('indexation monitoring', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('says which credentials are missing, and invents no verdicts', async ({ page }) => {
    // This is the state that actually ships: no Search Console service account
    // is configured anywhere, so the disconnected page is the one every real
    // visit renders. It is asserted for the same reason B-107's map is — the
    // degraded state is the shipped state until somebody sets a credential.
    await page.goto('/admin/reports/indexation')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Indexation')

    const main = page.getByRole('main')
    await expect(main).toContainText("Search Console isn't connected yet")

    // Named variables, not "not configured". Somebody has to go and set these.
    await expect(main).toContainText('GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL')
    await expect(main).toContainText('GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY')
    await expect(main).toContainText('GOOGLE_SEARCH_CONSOLE_SITE_URL')

    // And nothing that looks like an answer. A fabricated verdict on a screen
    // an operator makes decisions from is the whole reason there is no
    // simulator here.
    await expect(main.getByRole('table')).toHaveCount(0)
    await expect(main).not.toContainText('Indexed')
  })

  test('counts the same pages the sitemap advertises', async ({ page, request }) => {
    // The report asks about exactly what the sitemap publishes. Asking about a
    // different set would answer a question nobody has.
    const sitemap = await request.get('/sitemap.xml')
    const count = [...(await sitemap.text()).matchAll(/<loc>/g)].length

    await page.goto('/admin/reports/indexation')
    await expect(page.getByRole('main')).toContainText(`${count} pages our sitemap advertises`)
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Indexation — what Google has indexed/ }).click()
    await expect(page).toHaveURL('/admin/reports/indexation')
  })
})
