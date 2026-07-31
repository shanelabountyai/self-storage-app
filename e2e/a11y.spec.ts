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
  '/faq',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/accessibility',
]

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(route)

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
