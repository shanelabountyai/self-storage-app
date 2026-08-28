import { expect, test, type Page } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
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

      await assertNoAxeViolations(page)
    })
  }

  // B-196 (gap 3). B-195 shipped this report and declared its populated state
  // as a STATE_EXCEPTION in the same breath: nothing in the demo seed placed a
  // hold or agreed a plan, so the route loop scanned the headings, the month
  // picker and two empty tables, and the halted table — the reason the page
  // exists — had never been rendered under axe. The seed now places one, and
  // the table sits behind a per-facility <details>, so this opens it.
  //
  // Read-only: nothing here writes, so the shared plan fixture is unchanged by
  // a sweep (B-120). Self-skips rather than fails if nothing is halted, for the
  // same reason.
  // a11y-state: /admin/reports/plans-holds | a facility with halted leases
  test('the halted table has no WCAG 2.1 AA violations, with a facility open', async ({ page }) => {
    await page.goto('/admin/reports/plans-holds')
    await expect(page.getByRole('main')).toBeVisible()

    const summary = page.locator('summary', { hasText: /leases? halted/ })
    test.skip((await summary.count()) === 0, 'nothing halted at any visible facility to scan')

    await summary.first().click()
    // The table itself, not the disclosure that holds it — a scan that passed
    // on a closed <details> would prove nothing (D-95).
    await expect(page.getByRole('columnheader', { name: 'Deferred' }).first()).toBeVisible()

    await assertNoAxeViolations(page, { state: 'a facility with halted leases' })
  })

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
    //
    // B-200: this compared ONE screen cell against one CSV field, by position,
    // and had the position wrong — the facility name is a `<th scope="row">`,
    // so `td` 3 is sq-ft occupancy while CSV field 3 is unit occupancy. It
    // passed for as long as the two ratios happened to round the same, which
    // means the column US-39's AC actually names had never been asserted. Every
    // screen column is mapped to its field now rather than one: the export can
    // no longer drift on a column nobody is looking at, and a mapping that goes
    // wrong fails loudly instead of coinciding.
    await page.goto('/admin/reports')
    const cells = page
      .getByRole('row')
      .filter({ hasText: 'All facilities' })
      .first()
      .locator('td')

    const response = await page.request.get('/admin/reports/occupancy.csv')
    expect(response.headers()['content-type']).toContain('text/csv')
    const csv = await response.text()

    const totalLine = csv.split('\r\n').find((line) => line.startsWith('All facilities'))
    expect(totalLine, 'the export has no roll-up row').toBeTruthy()
    const fields = totalLine!.split(',')

    // [screen `td` index, CSV field index, column name]. The CSV carries three
    // columns the table does not show (rentable/occupied sq ft, gross
    // potential), which is why this is a map and not a zip.
    const COLUMNS: readonly [number, number, string][] = [
      [0, 1, 'Occupied'],
      [1, 2, 'Rentable'],
      [2, 3, 'Unit occ.'],
      [3, 6, 'Sq-ft occ.'],
      [4, 7, 'Collected'],
      [5, 9, 'Economic occ.'],
    ]

    for (const [td, field, name] of COLUMNS) {
      // The screen renders "50.2%" and "$1,234.56"; the CSV carries "50.2" and
      // "1234.56" so a spreadsheet reads them as numbers. Same figure, and the
      // rounding is asserted with it.
      const onScreen = (await cells.nth(td).innerText()).replace(/[%$,]/g, '')
      expect(fields[field], `${name} differs between the screen and the export`).toBe(onScreen)
    }
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

// B-082 part 6 / PRD 04 §7 Phase 2. Site-wide duplicate content.

// B-200. `.filter({ hasText: 'Austin, TX' }).first()` used to be the city-intro
// row, and B-089 took that away: the per-city/size intros score higher against
// each other (~0.94 against 0.82–0.85), the report sorts most-alike first, and
// their labels read "10×10 — Austin, TX" so they match the same text filter. A
// positional `.first()` cannot say which kind it meant; the rowheader can, and
// it stays correct however the pairs re-sort.
const kindRow = (page: Page, kind: string) =>
  page
    .getByRole('row')
    .filter({ hasText: 'Austin, TX' })
    .filter({ has: page.getByRole('rowheader', { name: kind, exact: true }) })
    .first()

const cityIntroRow = (page: Page) => kindRow(page, 'City page intros')

test.describe('duplicate content', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('catches the generated city intros, and sends the operator to the box that fixes them', async ({
    page,
  }) => {
    // The demo cities each hold one facility, so their generated intros differ
    // only by city, facility name and price — and score 0.82–0.85 against each
    // other, over this codebase's own 0.8 threshold. That is the check working
    // on the copy B-082 part 2 generated, and it is the reason this report
    // covers generated text at all rather than only what somebody typed.
    await page.goto('/admin/reports/duplicate-content')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Duplicate content')

    const row = cityIntroRow(page)
    await expect(row).toBeVisible()

    // The guidance for a generated pair is not "rewrite the weaker one" — that
    // is the advice for two pasted descriptions, and until B-128 there was no
    // city field to rewrite at all. There is one now, and the row links to it
    // rather than describing a product gap.
    await expect(row).toContainText('alike because the records are alike')
    await expect(row).not.toContainText('rewrite the weaker one')
    await expect(row.getByRole('link', { name: 'Write copy for one of these cities' })).toHaveAttribute(
      'href',
      '/admin/settings/marketing/cities',
    )
  })

  test('links both sides of a pair to the pages themselves', async ({ page }) => {
    await page.goto('/admin/reports/duplicate-content')
    const row = cityIntroRow(page)
    // A report that names a problem without a route to it makes somebody go
    // and find the page by hand.
    await row.getByRole('link', { name: 'Austin, TX', exact: true }).click()
    await expect(page).toHaveURL('/storage/tx/austin')
  })

  test('does not offer the cities box as the fix for a city/size pair', async ({ page }) => {
    // B-200. Both kinds are generated, and the row treated that as one case —
    // so a City/size pair carried "Write copy for one of these cities", which
    // cannot fix it: `citySizeIntro` takes no authored override, so writing the
    // city copy changes the city page and leaves this pair exactly as it was.
    // An operator following that link does the work and watches nothing happen.
    // Self-skips rather than fails if the demo portfolio has no size pair
    // above the threshold — the assertion is about what the row SAYS, and a
    // report with nothing to say is not the failure (B-120).
    await page.goto('/admin/reports/duplicate-content')
    const row = kindRow(page, 'City/size page intros')
    test.skip((await row.count()) === 0, 'no city/size pair above the threshold to advise on')

    await expect(row).not.toContainText('Write copy for one of these cities')
    await expect(row.getByRole('link')).toHaveCount(2) // the two pages, and no fix link
    await expect(row).toContainText('noindex')
  })

  test('says how much it compared, so a clean result means something', async ({ page }) => {
    await page.goto('/admin/reports/duplicate-content')
    // "Nothing found" and "we checked N pieces of text and found nothing" are
    // different claims, and only the second is reassuring.
    await expect(page.getByRole('main')).toContainText('pieces of text')
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Duplicate content — pages that say the same thing/ }).click()
    await expect(page).toHaveURL('/admin/reports/duplicate-content')
  })
})

// B-087 part 1 / PRD 04 §7 Phase 3, D-76. Structured-data monitoring, and the
// IndexNow status beside it.
//
// Read-only, so it is safe against the shared demo database (B-120). It is also
// the only place the monitor is exercised end to end: the report fetches the
// app under test's OWN pages over HTTP and parses what they actually serve, so
// a facility page that stopped rendering its JSON-LD fails here and nowhere
// else — the unit tests check the rules against fixtures, not the wiring.

test.describe('structured data', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('finds the demo pages intact, by fetching them as a crawler would', async ({ page }) => {
    await page.goto('/admin/reports/structured-data')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Structured data')

    const main = page.getByRole('main')
    // The demo seed's facilities, cities and guides all render their markup, so
    // a clean run is the expected result — and it is asserted as "N of N",
    // never as an absence of rows, because a monitor that checked nothing at
    // all would also show no problems.
    await expect(main).toContainText('Every monitored page is still emitting the markup it should')
    await expect(main.getByRole('table')).toHaveCount(0)

    // "Intact: N of N" with N greater than zero. Asserted as a backreference
    // rather than as the absence of problems, because a monitor that checked
    // NOTHING — a broken sitemap read, every URL classified static — also shows
    // no problems, and "0 of 0" is the reading that would slip through.
    // Lookaround rather than `\b`: `toContainText` matches against the element's
    // concatenated text, where the count runs straight into the next label
    // ("Intact10 of 10With problems") and a word boundary has nowhere to sit.
    await expect(main).toContainText(/(?<!\d)([1-9]\d*) of \1(?!\d)/)
  })

  test('says IndexNow is not set up, and names the variable', async ({ page }) => {
    // The shipped state: no INDEXNOW_KEY is configured anywhere, so this is the
    // section every real visit renders. Same reasoning as the indexation
    // report's disconnected state above.
    await page.goto('/admin/reports/structured-data')
    const main = page.getByRole('main')
    await expect(main).toContainText("IndexNow isn't set up")
    await expect(main).toContainText('INDEXNOW_KEY')
  })

  test('the key file 404s while nothing is configured', async ({ page }) => {
    // A key file that answered with whatever path was requested would let
    // anybody claim ownership of this host by choosing their own key. Unset
    // must therefore be a 404 rather than an empty 200.
    const response = await page.request.get('/indexnow/anything-at-all.txt')
    expect(response.status()).toBe(404)
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Structured data — markup a page has stopped emitting/ }).click()
    await expect(page).toHaveURL('/admin/reports/structured-data')
  })
})

// B-128 / PRD 04 §3.2 US-4 AC1, D-62. The city page copy editor.
//
// Read-only on purpose. Every demo city's intro is asserted as GENERATED by the
// duplicate-content specs above, so writing copy for one here would change what
// those tests see against a shared, un-reseeded database — the exact
// unscoped-mutation trap B-120 documents. The save path (its permission gate,
// its refusals, the audit entry and the origin flip to "authored") is covered by
// tests/city-copy-db.test.ts against fixtures it owns.

test.describe('city page copy', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('lists every city with a facility, and shows what the page says today', async ({ page }) => {
    await page.goto('/admin/settings/marketing/cities')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('City page copy')

    const austin = page.getByRole('region', { name: 'Austin, TX' })
    await expect(austin).toBeVisible()
    // "Generated" as a word, not a colour or an icon (WCAG 1.4.1) — and the
    // generated text itself, so "clear the box to go back" is something an
    // operator can see rather than a claim a hint makes.
    await expect(austin).toContainText('Generated')
    await expect(austin).toContainText('We have')
    await expect(austin.getByRole('textbox', { name: 'Intro copy' })).toHaveValue('')
  })

  test('links to the live page it edits', async ({ page }) => {
    await page.goto('/admin/settings/marketing/cities')
    await page
      .getByRole('region', { name: 'Austin, TX' })
      .getByRole('link', { name: 'See the live page' })
      .click()
    await expect(page).toHaveURL('/storage/tx/austin')
  })

  test('settings links to it', async ({ page }) => {
    await page.goto('/admin/settings')
    await page
      .getByRole('link', { name: /City page copy — the intro on each city landing page/ })
      .click()
    await expect(page).toHaveURL('/admin/settings/marketing/cities')
  })
})

// B-084 part 1 / PRD 02 §8, US-40. The monthly close.
//
// Read-only. Closing a demo month would freeze figures the revenue, occupancy
// and delinquency specs read live, and a closed month is not something a
// re-seed clears — `accounting_period` survives `seed-demo.mts`, so a sweep
// would leave the next one testing a different screen. The close, reopen,
// re-close and drift paths are covered against disposable fixtures in
// tests/accounting-close-db.test.ts.

test.describe('monthly close', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/reports/close')
  })

  test('lists months newest first and will not offer to close the current one', async ({ page }) => {
    const main = page.getByRole('main')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Monthly close')
    // The month in progress is present but explicitly not closable — freezing
    // a part-month under a name claiming all of it is the mistake the guard
    // exists to prevent, and the screen says so rather than hiding the row.
    await expect(main).toContainText('this month has not finished yet')
  })

  test('explains why two of the figures can never be recovered', async ({ page }) => {
    // The justification for the whole feature, on the screen rather than only
    // in a commit message: nothing records what a unit's status was, and the
    // aging report takes no date.
    await expect(page.getByRole('main')).toContainText('cannot be recovered')
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Monthly close — file a month/ }).click()
    await expect(page).toHaveURL('/admin/reports/close')
  })

  // B-084 part 2. The journal export.

  test('offers a form field for every account the journal can post to', async ({ page }) => {
    // The repo's own rule, asserted rather than trusted: an account with no
    // form field is one only a database client can set.
    const main = page.getByRole('main')
    for (const label of ['Accounts Receivable', 'Sales tax payable', 'Bad debt expense']) {
      await expect(main.getByRole('textbox', { name: label })).toBeVisible()
    }
    await expect(main).toContainText('matches on the account NAME')
  })

  test('refuses to export a journal for a month that is not closed', async ({ page }) => {
    // No demo month is closed — closing one would freeze figures the revenue
    // and occupancy specs read live. So the reachable contract is the refusal,
    // and it is worth pinning: it is what stops a journal being cut from
    // numbers that can still move.
    const facilityId = await page.evaluate(() =>
      document.querySelector<HTMLInputElement>('input[name="facilityId"]')?.value ?? '',
    )
    expect(facilityId).not.toBe('')

    // `page.request`, not the bare `request` fixture — the latter carries no
    // session, and the route then refuses on authentication rather than on the
    // thing this test is about. Every other CSV spec here uses `page.request`
    // for the same reason.
    const response = await page.request.get(
      `/admin/reports/journal.csv?facilityId=${facilityId}&year=2026&month=1`,
    )
    expect(response.status()).toBe(409)
    expect(await response.text()).toContain('not closed')
  })

  test('rejects a journal request with no month', async ({ page }) => {
    const response = await page.request.get('/admin/reports/journal.csv')
    expect(response.status()).toBe(400)
  })
})

// B-084 part 3 / PRD 02 US-40. Scheduled report emails.
//
// Read-only. Subscribing against demo data would schedule a real send from the
// 6am job, and the e2e database is the one the demo seed rebuilds — a
// subscription surviving into another run is a mail nobody asked for. The
// add/remove/send paths are covered against disposable fixtures in
// tests/report-subscriptions-db.test.ts.

test.describe('scheduled reports', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/reports/subscriptions')
  })

  test('says when reports go out and why that hour', async ({ page }) => {
    const main = page.getByRole('main')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Scheduled reports')
    // The hour is not arbitrary and the screen says so: after the overnight
    // billing and delinquency jobs, before the working day.
    await expect(main).toContainText('6am')
    await expect(main).toContainText('overnight billing')
  })

  test('offers every report in the catalog and every cadence', async ({ page }) => {
    const main = page.getByRole('main')
    await expect(main.getByRole('combobox', { name: 'Report' })).toBeVisible()
    await expect(main.getByRole('combobox', { name: 'How often' })).toBeVisible()
    await expect(main.getByRole('textbox', { name: 'Send to' })).toBeVisible()
  })

  test('links a monthly report to the close, so a live figure is not mistaken for a filed one', async ({
    page,
  }) => {
    await page.getByRole('link', { name: 'closed' }).click()
    await expect(page).toHaveURL('/admin/reports/close')
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Scheduled reports — send a report by email/ }).click()
    await expect(page).toHaveURL('/admin/reports/subscriptions')
  })
})

// B-084 part 4 / PRD 02 US-40. The management pack.

test.describe('management pack', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/reports/pack')
  })

  test('leads with whether the figures can still change', async ({ page }) => {
    // The most important sentence on the page, and it is FIRST. No demo month
    // is closed, so the reachable state is the live one — which is exactly the
    // case where a reader needs telling.
    const main = page.getByRole('main')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Management pack')
    await expect(main).toContainText('has not been closed')
    await expect(main).toContainText('can still change')
  })

  test('answers the five questions an owner asks, each as its own heading', async ({ page }) => {
    for (const heading of [
      'How full it was',
      'What it earned',
      'What it gave away or lost',
      'What was owed',
      'Who came and went',
    ]) {
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
    }
  })

  test('marks the row that needs acting on with a word, not a colour', async ({ page }) => {
    await expect(page.getByRole('rowheader', { name: /Over 90 days — needs attention/ })).toBeVisible()
  })

  test('names the month being shown rather than only highlighting it', async ({ page }) => {
    // `aria-current="page"` on the selected month, so the choice is not carried
    // by the background colour alone.
    const nav = page.getByRole('navigation', { name: 'Other months' })
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('offers to have it emailed every month', async ({ page }) => {
    await page.getByRole('link', { name: 'Have this emailed every month' }).click()
    await expect(page).toHaveURL('/admin/reports/subscriptions')
  })

  test('the reports index links to it', async ({ page }) => {
    await page.goto('/admin/reports')
    await page.getByRole('link', { name: /Management pack — the whole month/ }).click()
    await expect(page).toHaveURL('/admin/reports/pack')
  })
})
