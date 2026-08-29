import { expect, test } from '@playwright/test'
import { PUBLIC_SCAN_ROUTES as PUBLIC_ROUTES } from '../apps/web/lib/a11y/scan-coverage'
import { assertNoAxeViolations, expectNoHorizontalOverflow, TEXT_SPACING } from './a11y-helpers'

// B-139. The list itself lives in `apps/web/lib/a11y/scan-coverage.ts`, beside
// the exception list the public accessibility page renders, so the two cannot
// disagree. A route in neither is a failing unit test.

// B-093. Everything below is a check axe structurally cannot make: it scans one
// freshly-loaded page at one width and has no opinion on reflow, zoom, text
// spacing, or whether a live region existed before the event it reports.

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(route)
    // Wait for the page's own content before scanning. `goto` resolves on the
    // document load, which in dev mode can land while the route is still
    // compiling — a scan of a half-rendered page produced one spurious failure
    // in three runs, and a spurious a11y failure is worse than none because it
    // teaches people to re-run the suite.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

    // B-184 (T2). This call, and the incomplete-filtering it does (a third-
    // party iframe's undecidable contrast, the sticky "Rent now" bar's
    // by-design overlap — both checked by hand rather than assumed), used to
    // live only here; every other spec file destructured `violations` on its
    // own and never checked `incomplete` at all.
    await assertNoAxeViolations(page)
  })
}

// --- 1.4.10 Reflow -----------------------------------------------------------
// The shipped reflow check covered the homepage alone. A two-column hours grid
// and a table are exactly the things that break out of 320px, and neither is on
// the homepage.
// B-201. `expectNoHorizontalOverflow` rather than a `documentElement`
// comparison — see its note. The root comparison is still inside it; what is
// added is a per-element check no containment can mask. There is no
// `[contain:layout]` anywhere on the public site (B-199 verified that by grep,
// and the public accessibility statement's reflow sentence rests on it), so
// this closes no hole here. It is the same check everywhere so that the day a
// containing block does appear on a customer page, that claim does not quietly
// stop being tested.
for (const route of PUBLIC_ROUTES) {
  test(`${route} reflows to 320px without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(route)
    await expectNoHorizontalOverflow(page, `at 320px on ${route}`)
  })
}

// --- 1.4.4 Resize text -------------------------------------------------------
test.describe('text zoomed to 200%', () => {
  // Halving the CSS viewport at double scale is what a 200% browser zoom does
  // to layout, which is the thing the criterion is actually about.
  test.use({ viewport: { width: 640, height: 512 }, deviceScaleFactor: 2 })

  for (const route of PUBLIC_ROUTES) {
    test(`${route} survives 200% zoom`, async ({ page }) => {
      await page.goto(route)
      await expectNoHorizontalOverflow(page, `at 200% zoom on ${route}`)
    })
  }
})

// --- 1.4.12 Text spacing -----------------------------------------------------
for (const route of PUBLIC_ROUTES) {
  test(`${route} tolerates forced text spacing`, async ({ page }) => {
    await page.goto(route)
    await page.addStyleTag({ content: TEXT_SPACING })

    // Horizontal overflow is the observable form of "content was clipped".
    await expectNoHorizontalOverflow(page, `under forced text spacing on ${route}`)
  })
}

// --- 4.1.3 Status messages ---------------------------------------------------
test('the search page live region exists before it has anything to say', async ({ page }) => {
  // Not a style preference. A region inserted already-populated is unreliably
  // announced by VoiceOver and routinely missed by NVDA, so "it appears when it
  // fails" is indistinguishable from silence. Asserting it is attached on load
  // is the only part of this a machine can check — that it is *empty* on load is
  // what makes the later announcement a mutation rather than an insertion.
  await page.goto('/storage/search?q=78704')

  // Every one of them, not the one that happened to be here when this was
  // written. B-107 added a second region to this page (the map's result count)
  // and turned a passing single-element assertion into a strict-mode violation
  // — which is the good outcome: the alternative was scoping this to the first
  // region and silently exempting every one added after it.
  const regions = page.locator('[role="status"]')
  expect(await regions.count()).toBeGreaterThan(0)
  for (const region of await regions.all()) {
    await expect(region).toBeAttached()
    await expect(region).toHaveText('')
  }
})

// B-090 part 1. The waitlist form, EXPANDED.
//
// The route loop above cannot reach it. The form lives inside a collapsed
// `<details>` on each fully-rented size, and a collapsed disclosure's contents
// are hidden from the accessibility tree — so axe scanning
// `/storage/tx/austin/demo-austin-south` walks straight past every field in it.
// A scan that silently covers none of a form is exactly the "we did not test
// that reads as that passed" problem the incomplete assertions above exist to
// stop, and the accessibility statement makes a public claim about which pages
// are scanned. So it gets opened first.
// a11y-state: /storage/tx/austin/demo-austin-south | waitlist form opened
test('the waitlist form has no WCAG 2.1 AA violations once opened', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

  // Every sold-out size on the page, not just the first: they render from one
  // component, but an `id` collision between two instances is precisely the
  // defect that only appears with more than one on screen.
  const disclosures = page.locator('details')
  const count = await disclosures.count()
  expect(count, 'no sold-out size on the demo facility page to scan').toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) await disclosures.nth(i).locator('summary').click()

  await assertNoAxeViolations(page, { message: 'axe found accessibility violations in the opened waitlist form' })
})
