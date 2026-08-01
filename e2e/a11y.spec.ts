import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// PRD 01 §6.8: "CI includes automated a11y checks (axe) on all key templates."
// Every public route is listed here — a new page that isn't added is a page
// nobody checks, so this list is the contract.
const PUBLIC_ROUTES = [
  '/',
  '/storage/search?q=78704',
  // The three search outcomes render different templates, so each is its own
  // page as far as axe is concerned. 99501 is Anchorage — a real place with no
  // facility near it, which is the "nothing nearby" state.
  '/storage/search?q=99501',
  '/storage/search?q=zzzzz',
  // US-103's facility detail template: hours tables, live unit list, and the
  // map iframe, which is the part axe is most likely to have an opinion about.
  '/storage/tx/austin/demo-austin-south',
  // The filtered view is a different template from the unfiltered one — it
  // renders the "nothing matches those filters" state and the applied controls.
  '/storage/tx/austin/demo-austin-south?size=small&features=climate&sort=size',
  '/storage/size-guide',
  '/faq',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/accessibility',
]

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

    const { violations, incomplete } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])

    // Incompletes are the checks axe could not decide. Asserting only on
    // violations quietly reads "we didn't test that" as "that passed", so they
    // are asserted too.
    //
    // The one exemption is content inside a third-party iframe. Playwright does
    // inject axe into cross-origin frames — worth knowing, because the usual
    // assumption is that it cannot. The facility page's OpenStreetMap embed sits
    // behind a collapsed <details>, so it is not in the DOM for this scan at
    // all; when expanded it returns undecidable colour-contrast results for its
    // own attribution text over map tiles, which we cannot restyle in someone
    // else's document. A node inside a frame has a target path of length > 1,
    // which is how those are identified here.
    const ownPage = incomplete
      .map((i) => ({ ...i, nodes: i.nodes.filter((n) => n.target.length === 1) }))
      .filter((i) => i.nodes.length > 0)

    expect(
      ownPage.map((i) => `${i.id}: ${i.help}`),
      'axe could not decide these — check them by hand, then fix or exempt',
    ).toEqual([])
  })
}

// --- 1.4.10 Reflow -----------------------------------------------------------
// The shipped reflow check covered the homepage alone. A two-column hours grid
// and a table are exactly the things that break out of 320px, and neither is on
// the homepage.
for (const route of PUBLIC_ROUTES) {
  test(`${route} reflows to 320px without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(route)

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      overflow.scrollWidth,
      `document scrolls horizontally at 320px (${overflow.scrollWidth}px of content)`,
    ).toBeLessThanOrEqual(overflow.clientWidth)
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
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflow, 'document scrolls horizontally at 200% zoom').toBe(false)
    })
  }
})

// --- 1.4.12 Text spacing -----------------------------------------------------
// The user-stylesheet values from the criterion itself. Content must not be
// clipped or overlapped when a reader forces them — the usual failure is a
// fixed-height button or a `truncate` that turns into lost words.
const TEXT_SPACING = `* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }`

for (const route of PUBLIC_ROUTES) {
  test(`${route} tolerates forced text spacing`, async ({ page }) => {
    await page.goto(route)
    await page.addStyleTag({ content: TEXT_SPACING })

    // Horizontal overflow is the observable form of "content was clipped".
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow, 'content is clipped when text spacing is increased').toBe(false)
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

  const status = page.locator('[role="status"]')
  await expect(status).toBeAttached()
  await expect(status).toHaveText('')
})
