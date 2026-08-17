import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { LEGAL_PAGES } from '../apps/web/lib/site-config'
import { DEMO_PROMO_CODE } from '../apps/web/scripts/demo-credentials'

test('home page renders its search hero', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByLabel('Where do you need storage?')).toBeVisible()
})

test('the first tab stop is the skip link', async ({ page }) => {
  await page.goto('/')

  // Keyboard users must be able to bypass the header (WCAG 2.4.1), and the
  // skip link only works if it is genuinely the first focusable element.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
})

test('search submits to a shareable URL', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  // US-101: the query has to survive into a bookmarkable URL.
  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('78704')
})

test('search ranks real facilities with distance and a from-price', async ({ page }) => {
  // 78704 is the demo Austin facility's own zip, so it must rank first at
  // essentially zero distance (US-101).
  await page.goto('/storage/search?q=78704')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Austin, TX 78704')
  const first = page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()
  await expect(first).toBeVisible()
  await expect(first).toContainText('mi')
  await expect(first).toContainText(/Units from \$\d/)
})

test('a search with nothing nearby offers the closest facilities instead', async ({ page }) => {
  // US-101: never a dead end. Anchorage is real, so this is the
  // "nothing within the radius" state, not the "we can't find that" one.
  await page.goto('/storage/search?q=99501')

  await expect(page.getByRole('heading', { name: /Nothing within \d+ miles/ })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo —' }).first()).toBeVisible()
})

test('an unrecognisable search names the problem and offers a human', async ({ page }) => {
  await page.goto('/storage/search?q=zzzzz')

  await expect(page.getByRole('heading', { name: /We couldn't find/ })).toBeVisible()
  // §6.7: full-page error states always include click-to-call. Scoped to main
  // because the header carries a phone link on every page — the point is that
  // the error state itself offers a human, not that the chrome does.
  await expect(page.getByRole('main').getByRole('link', { name: /^Call/ })).toBeVisible()
})

test('search works with JavaScript disabled', async ({ browser }) => {
  // The form is a plain GET form and "Use my location" is purely additive, so
  // the core journey must not depend on the client bundle at all.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()).toBeVisible()
  await context.close()
})

// B-107. Every assertion here is about OUR half of the map. The Google script
// is aborted at the network layer in the graceful-degradation test and never
// needed in the other two, so nothing in this suite depends on a vendor being
// reachable, on a key being valid, or on tiles rendering — a spec that did
// would go red for a firewall and read as a broken page.
test('the search map is behind a toggle and the list is the view', async ({ page }) => {
  await page.goto('/storage/search?q=78704')

  // The results come first and are complete without the map existing at all.
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()).toBeVisible()

  // A `<summary>` is addressed by element, not by role: Playwright's role
  // engine does not map it to `button`, so `getByRole('button')` finds nothing
  // and the failure reads as a missing control rather than a wrong locator.
  // Every other <details> in this suite is targeted the same way.
  await expect(page.locator('summary', { hasText: 'Show map' })).toBeVisible()

  // Collapsed at load, so the map is out of the tab order and out of the
  // accessibility tree until it is asked for — nobody traverses a map they
  // cannot use to reach the results.
  const map = page.getByRole('group', { name: /^Map of the \d+ facilit/ })
  await expect(map).toBeHidden()

  // The map's own live region exists before there is anything to announce, and
  // OUTSIDE the <details> — one that is display:none at load and revealed with
  // its first message is announced about as reliably as one inserted later,
  // which is the trap "Use my location" already documents. Addressed as the
  // sibling of the disclosure because this page carries a second, unrelated
  // status region (that same "Use my location" button).
  await expect(
    page.locator('details:has(summary:text("Show map")) + [role="status"]'),
  ).toBeAttached()
})

test('the map degrades to the list when its script cannot load', async ({ page }) => {
  // D-46: "a map that fails to load must leave the results intact".
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.goto('/storage/search?q=78704')

  await page.locator('summary', { hasText: 'Show map' }).click()

  await expect(page.getByText('The map could not be loaded')).toBeVisible()
  // The point of the test: the results are still there and still complete.
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()).toBeVisible()
})

test('the opened map introduces no accessibility violations', async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.goto('/storage/search?q=78704')
  await page.locator('summary', { hasText: 'Show map' }).click()
  await expect(page.getByText('The map could not be loaded')).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
})

// B-082 part 1. The marketplace surface, asserted through real HTTP rather
// than by calling the library — these are the two routes a partner integrates
// against, and a handler that throws on a missing export is invisible to a
// unit test that imports the function directly.
test('the availability feed publishes what the website publishes', async ({ request }) => {
  const response = await request.get('/api/public/marketplace/availability')
  expect(response.status()).toBe(200)

  const feed = (await response.json()) as {
    generatedAt: string
    facilities: { slug: string; url: string; unitTypes: { webRateCents: number }[] }[]
  }
  const demo = feed.facilities.find((facility) => facility.slug === 'demo-austin-south')
  expect(demo, 'the demo facility is advertised').toBeDefined()
  expect(demo!.url).toContain('/storage/tx/austin/demo-austin-south')
  expect(demo!.unitTypes.length).toBeGreaterThan(0)
  // Rate parity, end to end: the same number the public inventory API serves.
  const site = await (
    await request.get('/api/public/facilities/demo-austin-south/inventory')
  ).json()
  const feedRate = demo!.unitTypes[0].webRateCents
  const siteRates = (site.unitTypes as { webRateCents: number }[]).map((u) => u.webRateCents)
  expect(siteRates).toContain(feedRate)
})

test('the inbound lead endpoint refuses an unauthenticated caller', async ({ request }) => {
  // No key is configured for the e2e build, so EVERY caller is unauthenticated
  // — which is the closed default this asserts. A partner cannot name its own
  // channel because it never gets as far as the body.
  const response = await request.post('/api/public/marketplace/leads', {
    data: { facilitySlug: 'demo-austin-south', name: 'Ada', email: 'ada@example.com' },
  })
  expect(response.status()).toBe(401)
  expect(await response.json()).toEqual({ error: 'unauthorized' })

  const withGuess = await request.post('/api/public/marketplace/leads', {
    headers: { authorization: 'Bearer not-a-real-key' },
    data: { facilitySlug: 'demo-austin-south', name: 'Ada', email: 'ada@example.com' },
  })
  // The same answer for "no key" and "wrong key": anything else tells an
  // unauthenticated caller which of the two it is.
  expect(withGuess.status()).toBe(401)
  expect(await withGuess.json()).toEqual({ error: 'unauthorized' })
})

test('a search result links through to its facility page', async ({ page }) => {
  await page.goto('/storage/search?q=78704')
  await page.getByRole('link', { name: 'Demo — Austin South' }).click()

  // US-103: the crawlable URL scheme is /storage/{state}/{city}/{slug}. The
  // `from` parameter carries the search onward so the facility page can offer
  // a way back; it is not part of the canonical path.
  await expect(page).toHaveURL(/\/storage\/tx\/austin\/demo-austin-south(\?|$)/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo — Austin South')
})

test('the facility page separates office hours from gate hours', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §6.3: these must never be conflated. The demo facility's office is shut on
  // Sunday while the gate is open — if one table were rendering for both, this
  // pair could not both hold.
  const office = page.getByRole('table', { name: 'Office hours' })
  const gate = page.getByRole('table', { name: 'Gate access hours' })
  await expect(office.getByRole('row').filter({ hasText: 'sunday' })).toContainText('Closed')
  await expect(gate.getByRole('row').filter({ hasText: 'sunday' })).toContainText('8:00 AM')
})

test('the facility page offers click-to-call without scrolling', async ({ page }, testInfo) => {
  // §4.1 US-103: visible without scrolling ON MOBILE — not a desktop claim,
  // and B-118's hero photo (above the contact block, on purpose) pushes the
  // call link past a 720px desktop fold while staying comfortably inside a
  // real phone's first viewport. Explicit rather than relying on which
  // project happens to run this, matching the reflow tests' own pattern.
  test.skip(testInfo.project.name !== 'mobile-chrome', 'US-103 is a mobile requirement, not a desktop one')
  await page.goto('/storage/tx/austin/demo-austin-south')

  const call = page.getByRole('main').getByRole('link', { name: /^Call/ })
  await expect(call).toBeVisible()
  const box = await call.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})

test('a non-canonical facility URL redirects to the canonical one', async ({ page }) => {
  // The slug alone resolves the facility, so the state/city segments are
  // forgeable. One URL per facility in the index, not one per spelling.
  await page.goto('/storage/ca/nowhere/demo-austin-south')
  await expect(page).toHaveURL('/storage/tx/austin/demo-austin-south')
})

test('an unknown facility 404s rather than rendering an empty page', async ({ page }) => {
  const response = await page.goto('/storage/tx/austin/no-such-facility')
  expect(response?.status()).toBe(404)
})

// B-082 part 2 / PRD 04 US-4 AC1. The city page.

test('the city page lists the facilities in the city and routes to one', async ({ page }) => {
  await page.goto('/storage/tx/austin')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Austin, TX')

  const card = page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()
  await expect(card).toBeVisible()
  // AC1's starting price, from the same inventory read the facility page uses.
  await expect(card).toContainText(/Units from \$\d/)

  await card.getByRole('link', { name: 'Demo — Austin South' }).click()
  await expect(page).toHaveURL('/storage/tx/austin/demo-austin-south')
})

test('the city page carries ItemList structured data naming the same facilities', async ({
  page,
}) => {
  await page.goto('/storage/tx/austin')

  // FR-SEO-4. Read out of the DOM rather than trusted from the source, because
  // the failure this guards is markup that describes a list the reader is not
  // looking at — so it is checked against the links actually rendered.
  const nodes = await page.locator('script[type="application/ld+json"]').allTextContents()
  const itemList = nodes
    .map((node) => JSON.parse(node) as { '@type': string; itemListElement?: { url: string }[] })
    .find((node) => node['@type'] === 'ItemList')

  expect(itemList).toBeDefined()
  const listed = itemList?.itemListElement?.map((item) => new URL(item.url).pathname) ?? []
  expect(listed).toContain('/storage/tx/austin/demo-austin-south')

  for (const path of listed) {
    await expect(page.locator(`main a[href="${path}"]`)).toBeVisible()
  }
})

test('a city with no facilities 404s rather than serving a thin page', async ({ page }) => {
  // AC1: "indexable only when ≥1 facility exists in the city." A 200 with
  // nothing on it is the shape a crawler penalises the rest of the site for.
  const response = await page.goto('/storage/tx/nowhereville')
  expect(response?.status()).toBe(404)
})

test('a non-canonical city URL redirects to the canonical one', async ({ page }) => {
  // There is no middleware in this app, so the page enforces its own canonical
  // spelling exactly as the facility page below it does.
  await page.goto('/storage/TX/AUSTIN')
  await expect(page).toHaveURL('/storage/tx/austin')
})

test('every city the sitemap advertises actually renders', async ({ page, request }) => {
  // The sitemap computed this list for months and threw it away, because the
  // page was a 404 — so the pairing, not either half, is what is worth
  // asserting: a URL good enough to invite a crawler to is good enough to serve.
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBe(true)

  const paths = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname)
    // Two segments under /storage is a city page; three is a facility.
    .filter((path) => /^\/storage\/[a-z]{2}\/[a-z0-9-]+$/.test(path))

  expect(paths).toContain('/storage/tx/austin')
  for (const path of paths) {
    const response = await page.goto(path)
    expect(response?.status(), `${path} is in the sitemap and must not 404`).toBe(200)
  }
})

test('every footer legal page resolves', async ({ page }) => {
  for (const legalPage of LEGAL_PAGES) {
    const response = await page.goto(legalPage.href)
    expect(response?.status(), `${legalPage.href} should not 404`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

// Reflow moved to e2e/a11y.spec.ts in B-093, where it runs over every public
// route rather than the homepage alone — the two-column hours grid and the unit
// tables are the things that break out of 320px, and neither is on the homepage.

test('the skip link paints a real focus indicator', async ({ page }) => {
  // The programmatic half of WCAG 1.4.11 for focus. A machine can check that an
  // indicator is drawn and how thick it is; it cannot check that it is visible
  // against what is behind it — tests/contrast-tokens.test.ts does the contrast
  // arithmetic, and a human still has to look at it in Safari, whose handling of
  // `outline-style: auto` differs from Chromium's.
  await page.goto('/')
  await page.keyboard.press('Tab')

  const indicator = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    }
  })

  expect(indicator, 'nothing was focused after one Tab').not.toBeNull()
  const drawn =
    (indicator!.outlineStyle !== 'none' && indicator!.outlineWidth >= 2) ||
    indicator!.boxShadow !== 'none'
  expect(drawn, `focused element draws no indicator: ${JSON.stringify(indicator)}`).toBe(true)
})

test('a unit shows both rates only when they differ', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // The demo facility prices every size below its street rate, so the saving
  // must be stated in words as well as struck through — a line through a
  // number is a visual-only signal (1.4.1).
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Climate' }).first()
  await expect(card).toContainText('/mo online')
  await expect(card).toContainText('off for renting online')
})

test('"What you\'d pay today" itemizes and foots', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  const card = page.getByRole('listitem').filter({ hasText: '10x10 Climate' }).first()
  await card.getByText("What you'd pay today").click()

  // US-301: rent, the one-time fee, tax, and the protection plan named even
  // though it costs nothing yet — plus both totals.
  await expect(card).toContainText('First month rent')
  await expect(card).toContainText('One-time admin fee')
  await expect(card).toContainText('Tax')
  await expect(card).toContainText('Protection plan')
  await expect(card).toContainText('Total due today')
  await expect(card).toContainText('Then each month')
})

test('the hero photo sits above the fold, LCP-primed, and never repeats in the gallery below (B-118)', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §6.3 fixes photos first — the hero strip has to render before the contact
  // block reachable "without scrolling" claims below it, not merely exist
  // somewhere on the page.
  const heroImg = page.getByRole('img', { name: 'The gated entrance and drive at Demo — Austin South' })
  await expect(heroImg).toBeVisible()
  await expect(heroImg).toHaveAttribute('fetchpriority', 'high')
  await expect(heroImg).toHaveAttribute('loading', 'eager')
  await expect(heroImg).toHaveAttribute('width', '800')
  await expect(heroImg).toHaveAttribute('height', '600')
  // Scoped to `main`: the header carries its own "Call us at..." link on
  // every page, and an unscoped query hits both (strict-mode violation).
  const contactBlock = page.getByRole('main').getByRole('link', { name: /^Call/ })
  const heroBox = await heroImg.boundingBox()
  const contactBox = await contactBlock.boundingBox()
  expect(heroBox!.y).toBeLessThan(contactBox!.y)

  // Only the FIRST hero image carries the priority hint — it names the LCP
  // candidate, and putting it on more than one dilutes which image the
  // browser should race to fetch.
  const secondHero = page.getByRole('img', { name: 'A row of ground-floor drive-up units' })
  await expect(secondHero).not.toHaveAttribute('fetchpriority', 'high')

  // The gallery further down the page carries the FOURTH seeded photo — the
  // one that did not fit in the hero's three — and none of the three that
  // did. A dedup bug shows up as either the fourth photo missing (sliced
  // wrong) or one of the first three reappearing (not sliced at all).
  const photosSection = page.getByRole('region', { name: 'Photos' })
  await expect(photosSection.getByRole('img', { name: 'The keypad at the gated entrance' })).toBeVisible()
  await expect(photosSection.getByRole('img', { name: 'The gated entrance and drive at Demo — Austin South' })).toHaveCount(0)
  await expect(photosSection.getByRole('img')).toHaveCount(1)
})

test('a facility with no photos renders no hero and no empty gallery frame (B-118)', async ({ page }) => {
  // The e2e sandbox facility is seeded with zero FacilityPhoto rows on
  // purpose — "renders no placeholder and no empty frame" needs a real case,
  // not just an absence of failure.
  await page.goto('/storage/tx/houston/demo-e2e')
  await expect(page.getByRole('region', { name: 'Photos' })).toHaveCount(0)
  await expect(page.getByRole('img')).toHaveCount(0)
})

test('the sticky Rent now bar names the cheapest of three sizes, below sm only (B-118)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'the bar is sm:hidden — asserted absent on desktop below')
  // Austin, read-only — no checkout POST here, so no unit is consumed. That
  // matters on this facility specifically: 5x5 Locker has only 6 units, and
  // this file's many "Rent now" tests already contend for Austin's small
  // pools under full parallel load (see the sandbox-facility test below for
  // the real click-through, which needs room this facility does not have).
  await page.goto('/storage/tx/austin/demo-austin-south')

  // 5x5 Locker is the cheapest of the three seeded types (web 5_900 vs 12_900
  // and 22_900) — the bar has to pick the true minimum, not the first row.
  const bar = page.getByText('From $59', { exact: false }).locator('..')
  await expect(bar.getByRole('button', { name: 'Rent now' })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Reserve free' })).toBeVisible()
})

test('the sticky Rent now bar actually starts a checkout (B-118)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'the bar is sm:hidden')
  // The e2e sandbox facility, not Austin: this test really POSTs and holds a
  // unit, and the sandbox is the one facility sized (250 units of one type)
  // for exactly that under full parallel load — see global-setup.ts.
  await page.goto('/storage/tx/houston/demo-e2e')

  const bar = page.getByText('From $129', { exact: false }).locator('..')
  await bar.getByRole('button', { name: 'Rent now' }).click()
  await expect(page).toHaveURL(/\/checkout\?token=/)
})

// ── B-122: promo codes ───────────────────────────────────────────────────────
//
// `offerFor` has taken a `code` since B-070 and no surface passed one, so a
// code-gated promotion could be created in admin, was correctly hidden from the
// badges, and could never be redeemed by anybody. The seeded demo code is gated
// and scoped to the sandbox facility precisely so it is invisible to every
// other assertion in this file until one of these tests types it.

test('a promo code applies from the facility page and shows its terms (B-122)', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')

  // Nothing before the code is entered: gated means gated, and a badge here
  // would make the code pointless.
  await expect(page.getByText('Half off your first month')).toHaveCount(0)

  await page.getByLabel('Have a promo code?').fill(DEMO_PROMO_CODE)
  await page.getByRole('button', { name: 'Apply code' }).click()

  // The outcome is announced from a live region, not left to be inferred from
  // a changed number (§6.4, and 4.1.3).
  await expect(page.getByRole('status').filter({ hasText: /Code applied/ })).toBeVisible()
  // And the money actually moved: the card now carries the badge and its terms.
  await expect(page.getByText('Half off your first month').first()).toBeVisible()
  // Shareable and survives a reload, because it is in the URL.
  await expect(page).toHaveURL(new RegExp(`promo=${DEMO_PROMO_CODE}`, 'i'))
})

test('a refused code says WHICH rule refused it, not just that it failed (B-122)', async ({ page }) => {
  // The seeded promotion is scoped to the sandbox facility, so the same code
  // at Austin is a real `not_for_this_facility` — a distinct message, which is
  // the whole point: `REJECTION_MESSAGES` has distinguished seven refusals
  // since B-070 and nothing had ever displayed one. A generic "that code is
  // not valid" is a support call and a 3.3.3 failure.
  await page.goto('/storage/tx/austin/demo-austin-south')

  await page.getByLabel('Have a promo code?').fill(DEMO_PROMO_CODE)
  await page.getByRole('button', { name: 'Apply code' }).click()

  await expect(page.getByRole('status').filter({ hasText: /different location/ })).toBeVisible()
  // The field keeps what was typed — 3.3.3 again: an error that clears the
  // thing it is complaining about makes the renter retype it to find out what
  // was wrong.
  await expect(page.getByLabel('Have a promo code?')).toHaveValue(DEMO_PROMO_CODE)
})

test('an unknown code is named as unknown, and nothing is discounted (B-122)', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')

  await page.getByLabel('Have a promo code?').fill('NOT-A-REAL-CODE')
  await page.getByRole('button', { name: 'Apply code' }).click()

  await expect(page.getByRole('status').filter({ hasText: /not one of ours/ })).toBeVisible()
  await expect(page.getByText('Half off your first month')).toHaveCount(0)
})

test('a code entered on the facility page carries into the checkout total (B-122)', async ({ page }) => {
  // The join that did not exist. The code had to survive the "Rent now" POST
  // and be RE-EVALUATED server-side there — the form carries the string only,
  // never a discount — or the card would advertise half off and the checkout
  // would quote full price, which is the exact defect B-070's own comment
  // describes about the automatic case.
  await page.goto(`/storage/tx/houston/demo-e2e?promo=${DEMO_PROMO_CODE}`)
  await expect(page.getByText('Half off your first month').first()).toBeVisible()

  await page.getByRole('button', { name: 'Rent now' }).first().click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // $129 web rate, half off the first month → $64.50 off, and the summary says
  // so in the renter's own words rather than only in a smaller number.
  const priceSummary = page.getByRole('complementary', { name: 'What you are paying' })
  // The <summary> element itself — "Due today" also matches the "Total due
  // today" line inside the disclosure it opens.
  await priceSummary.locator('summary').click()
  await expect(priceSummary.getByText('Half off your first month')).toBeVisible()
})

test('a promo code can be entered during checkout, and the total follows (B-122)', async ({ page }) => {
  // Started with NO code, the way most renters arrive — then entered at the
  // price summary, which is where a code from an email actually gets used.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page.getByRole('button', { name: 'Rent now' }).first().click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  const priceSummary = page.getByRole('complementary', { name: 'What you are paying' })
  await expect(priceSummary.getByText('Half off your first month')).toHaveCount(0)

  await page.getByText('Have a promo code?').click()
  await page.getByRole('textbox', { name: 'Promo code' }).fill(DEMO_PROMO_CODE)
  await page.getByRole('button', { name: 'Apply code' }).click()

  await expect(page.getByRole('status').filter({ hasText: /Code applied/ })).toBeVisible()
  await priceSummary.locator('summary').click()
  await expect(priceSummary.getByText('Half off your first month')).toBeVisible()
})

test('the sticky bar is absent above sm — each unit card already carries its own buttons', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'desktop-only assertion')
  await page.goto('/storage/tx/austin/demo-austin-south')
  // `toBeHidden`, not `toHaveCount(0)`: `sm:hidden` is `display:none`, which
  // takes the element out of the RENDER tree but not out of the DOM — a plain
  // text-content locator like `getByText` still counts it (unlike `getByRole`,
  // which does respect the accessibility tree). `toHaveCount(0)` here would
  // pass even if `sm:hidden` silently stopped applying.
  await expect(page.getByText('From $59', { exact: false })).toBeHidden()
})

test('filters narrow the list and survive into the URL', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // `exact` because B-068's lead form added a "Size you are interested in"
  // select further down the page — two controls may legitimately mention size,
  // so the filter is addressed precisely rather than by substring.
  //
  // B-122 hit the same thing twice more on this one page, which is the lesson
  // worth keeping: `getByRole`'s `name` is a SUBSTRING match, so the promo
  // box's "Apply code" button started matching `{ name: 'Apply' }`, and its
  // (deliberately pre-mounted, deliberately empty) live region became a second
  // `role="status"` here. Neither is a defect in the page — a page may have
  // two live regions and two buttons whose labels share a word — so both
  // locators are narrowed rather than the page changed.
  await page.getByLabel('Size', { exact: true }).selectOption('small')
  // 3.2.2: selecting must not navigate on its own.
  await expect(page).not.toHaveURL(/size=small/)

  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page).toHaveURL(/size=small/)
  await expect(page.getByRole('status').filter({ hasText: /sizes? match/ })).toContainText(
    '1 size matches',
  )
})

test('a filter combination with no matches offers a way out', async ({ page }) => {
  // §6.7: name the problem and the next action. "Nothing matches" is a
  // different problem from "this facility has nothing", and needs different copy.
  await page.goto('/storage/tx/austin/demo-austin-south?size=small&features=driveUp')

  await expect(page.getByRole('main')).toContainText('Nothing here matches those filters')
  await expect(page.getByRole('link', { name: 'Clear them' })).toBeVisible()
})

test('a search result carries its query into the facility page', async ({ page }) => {
  await page.goto('/storage/search?q=78704')
  await page.getByRole('link', { name: 'Demo — Austin South' }).click()

  // US-103: a comparer must be able to get back without retyping their zip.
  await expect(page.getByRole('link', { name: /Back to storage near 78704/ })).toBeVisible()
  await page.getByRole('link', { name: /Back to storage near 78704/ }).click()
  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
})

test('the size guide answers the question the links promise', async ({ page }) => {
  await page.goto('/storage/size-guide')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What size')
  await expect(page.getByRole('heading', { name: '10 foot by 10 foot' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('half a standard garage')
})

test('reserving a unit holds it, for free, with no account', async ({ page }) => {
  // US-401 / D-7: no password, no card. The whole journey from a unit card to
  // a confirmed hold.
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reserve this unit')
  await expect(page.getByRole('main')).toContainText('No credit card needed')

  const email = `e2e-${Date.now()}@demo.example.com`
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Prospect')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0142')
  await page.getByRole('button', { name: 'Reserve for free' }).click()

  await expect(page).toHaveURL(/\/reservations\?token=/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your unit is reserved')
  // 2.2.1: the hold is communicated as an absolute date and time, never a
  // countdown the renter cannot pause.
  await expect(page.getByRole('main')).toContainText('We hold it until')
  await expect(page.getByRole('main')).toContainText('Nothing has been charged')

  // Give the unit back. Unlike every other test in this suite these hold real
  // inventory, and the demo facility has a finite number of lockers — a test
  // that keeps what it takes quietly sells the size out after a few runs and
  // then fails for a reason that has nothing to do with the code.
  await page.getByRole('button', { name: 'Cancel this reservation' }).click()
})

test('an invalid reservation reports the problem next to the field', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  // A syntactically valid but wrong-looking email gets past the browser's own
  // check, so the server's message is what the renter actually sees.
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Prospect')
  await page.getByLabel('Email', { exact: true }).fill('ada@nowhere')
  await page.getByLabel('Mobile number').fill('512-555-0142')
  await page.getByRole('button', { name: 'Reserve for free' }).click()

  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true')
})

test('the cancel link shows the hold before releasing it', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  await page.getByLabel('First name').fill('Cancel')
  await page.getByLabel('Last name').fill('Me')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-cancel-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0143')
  await page.getByRole('button', { name: 'Reserve for free' }).click()
  await expect(page).toHaveURL(/\/reservations\?token=/)

  // 3.3.4: landing on the page cancels nothing — a mail client prefetching the
  // link must not release someone's unit. Cancelling is a separate POST.
  // Re-enter the way the emailed link does: the token alone, without the
  // `new=1` the post-submit redirect carries.
  const token = new URL(page.url()).searchParams.get('token')!
  await page.goto(`/reservations?token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your reservation')
  await expect(page.getByRole('button', { name: 'Cancel this reservation' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel this reservation' }).click()
  // The cancel form is gone once the hold is, so the outcome is reported by the
  // state that replaced it — `.first()` because B-111 stopped `AdminForm`
  // hiding its own empty live region, and the cancel form is still mounted
  // while this resolves.
  await expect(page.getByRole('main').getByRole('status').first()).toContainText(
    'back available',
  )
  await expect(page.getByRole('button', { name: 'Cancel this reservation' })).toHaveCount(0)
})

test('a reservation link that is not real says so without leaking why', async ({ page }) => {
  await page.goto('/reservations?token=definitely-not-a-real-token')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("isn't good any more")
  await expect(page.getByRole('main').getByRole('link', { name: /^Call/ })).toBeVisible()
})

test('Rent now starts a checkout and holds the unit', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('button', { name: 'Rent now' }).click()

  await expect(page).toHaveURL(/\/checkout\?token=/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Move in online')

  // §6.4: the price summary is the stepper's chrome, so the total is visible
  // at step 1 rather than first appearing on the screen that asks for a card.
  await expect(page.getByRole('main')).toContainText('Due today')
  await expect(page.getByRole('main')).toContainText('/mo')

  // §6.8.1: the progress indicator carries its state in words, not colour.
  const progress = page.getByRole('navigation', { name: 'Checkout progress' })
  await expect(progress).toContainText('Your details')
  await expect(progress.getByText(/step 1 of 6, current step/)).toBeAttached()
})

test('checkout step 1 creates an account with no password', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // US-501 step 1 / FR-5.1: no password field anywhere, and no verification
  // wall in front of a move-in.
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-details-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Step 2 confirms the unit that was already locked, and names it.
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Your unit')
  await expect(page.getByRole('main')).toContainText('/mo')
})

test('a checkout step change moves focus and announces where it went', async ({ page }) => {
  // B-110. The two things the suite had never asserted about dynamic state:
  // that focus MOVES where it should, and that a live region's text CHANGES on
  // the handle it was captured from. Structural presence was all that was
  // checked, and structural presence is exactly the half that was already true
  // while a renter pressing Continue heard nothing and was left on a submit
  // button that no longer existed.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // Captured BEFORE the action, and asserted on the same handle after: a region
  // that unmounts and is replaced by a populated one is not announced, and is
  // what a fresh locator would have hidden.
  const announcer = page.getByRole('main').getByRole('status').first()
  // `data-live` is set by the announcer's own effect. Waiting on it rather than
  // on mere attachment is the difference between a warm run and a cold one:
  // before hydration, Continue is a plain form post and a full document load,
  // which remounts the region and announces nothing.
  await expect(announcer).toHaveAttribute('data-live', 'true')
  await expect(announcer).toHaveText('')

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-focus-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // Says where they are, in the words the progress indicator uses — not that
  // something happened.
  await expect(announcer).toHaveText(/Your unit — step 2 of 6/)

  // 2.4.3: focus is on the new step's heading, so the next Tab is into step 2
  // rather than back at the top of the document.
  await expect(page.locator('#step')).toBeFocused()

  // B-119: proven for a SECOND transition, not just the first hop into the
  // stepper — a handler wired to "the step after Details" specifically would
  // have passed the assertions above and still left every later Continue
  // silent.
  await page.getByRole('button', { name: 'This is right' }).click()
  // The stepper's own short label ("Protection"), not the step's page
  // heading ("Protect what you store") — the same distinction B-110's
  // comment already draws for step 2's "Your unit".
  await expect(announcer).toHaveText(/Protection — step 3 of 6/)
  await expect(page.locator('#step')).toBeFocused()
})

test('checkout step 1 stays inside the field cap, at a consumer tap size', async ({ page }) => {
  // B-112. §6.4 caps a step at seven visible fields; this one rendered
  // fourteen, on a phone, immediately after "Rent now". Asserted rather than
  // described so the next item cannot quietly re-add — which is exactly how it
  // got to fourteen.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  const form = page.getByRole('form', { name: 'Your details' })
  const visibleControls = form.locator(
    'input:not([type=hidden]):visible, select:visible, textarea:visible',
  )

  // Seven to fill, and the three consent boxes — which sit BELOW the primary
  // action, because consent is the only thing on the screen that serves us
  // rather than the renter.
  await expect(visibleControls).toHaveCount(10)
  const names = await visibleControls.evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).name),
  )
  expect(names).toEqual([
    'firstName',
    'lastName',
    'email',
    'phone',
    'addressLine1',
    'addressLine2',
    'postalCode',
    'smsConsent',
    'marketingConsent',
    // D-51 (B-123). Marketing TEXTS, separate from `smsConsent` (which is
    // transactional) and from `marketingConsent` (which is email). Three boxes
    // because they are three different permissions, and TCPA express written
    // consent has to be provably to the thing it was given for.
    'marketingSmsConsent',
  ])

  // Every consent box unchecked by default — PRD 04 US-13 AC1, and the one
  // property that makes the record mean anything. A pre-ticked box is not
  // consent, it is a default somebody failed to notice.
  for (const name of ['smsConsent', 'marketingConsent', 'marketingSmsConsent']) {
    await expect(form.locator(`input[name="${name}"]`)).not.toBeChecked()
  }

  // City and state are read-only, derived from the zip, with the way to type
  // them by hand closed rather than absent.
  await expect(form.getByText('City and state', { exact: true })).toBeVisible()
  await expect(page.getByLabel('City')).toBeHidden()
  await expect(form.getByText('Enter my city and state myself')).toBeVisible()

  // §6.2: ≥44px. `CONTROL_CLASS` was `h-9` — 36px — on every public and portal
  // form in the product. Asserted on the RENDERED height, because the token now
  // resolves through a CSS variable and a broken variable would still compile.
  const zip = page.getByLabel('Zip code')
  expect((await zip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('checkout goes back, from the control and from the progress indicator', async ({ page }) => {
  // B-111 / §6.4: "back navigation never loses data". `canEnter` has said since
  // B-020 that a completed step may be returned to; until this item nothing
  // rendered a control, so a renter who mistyped the address that receives the
  // lease, the receipt and the gate code found out at step 4 and could only
  // abandon.
  const email = `e2e-back-${Date.now()}@demo.example.com`
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // The control names its destination rather than saying "Back" — a one-word
  // accessible name makes a screen-reader user infer where it goes.
  await page.getByRole('button', { name: 'Back to your details' }).click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)

  // Forward again re-asks nothing, then back again from the progress
  // indicator, which is the other half of the requirement.
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()

  const progress = page.getByRole('navigation', { name: 'Checkout progress' })
  await progress.getByRole('button', { name: /Your details/ }).click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)

  // Step 1 has nothing behind it, so it offers no way back rather than a
  // control that can only be refused.
  await expect(page.getByRole('button', { name: /^Back to/ })).toHaveCount(0)
})

test('a total that moves says what moved it', async ({ page }) => {
  // §6.4: `PriceSummaryProps.changeNote` existed from B-020 and was passed by
  // nobody, so choosing a protection tier moved both totals with no stated
  // cause, one screen before the card form.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-note-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()

  const summary = page.getByRole('complementary', { name: 'What you are paying' })
  await page.getByRole('radio', { name: /\$5,000 cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lease' })).toBeVisible()
  await expect(summary.getByRole('status')).toContainText(/Protection plan added/)

  // Cleared by the next step, not left standing — a note that outlives its
  // cause attributes the current total to a change two steps ago.
  await page.getByRole('button', { name: 'Back to protection' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await expect(summary.getByRole('status')).toHaveText('')
})

test('the sticky price summary does not cover the payment step at 360px', async ({ page }) => {
  // §6.4 wants the summary persistent on every viewport; it must not buy that
  // by sitting on top of the control that charges. Asserted against the LOWEST
  // interactive element of the payment step — everything above it, the Payment
  // Element's own submit included, clears the bar if this does.
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-360-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lease' })).toBeVisible()
  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()
  // `exact`, because the payment step also renders an "Automatic payments"
  // heading (B-025's autopay disclosure) and Playwright matches an accessible
  // name by case-insensitive substring — so the unqualified name resolves to
  // two elements and violates strict mode. It only ever passed because that
  // section is client-rendered: on a loaded machine the assertion resolved
  // before it mounted, and on a quiet one both are present and it fails.
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()

  const back = page.getByRole('button', { name: /^Go back|^Back to/ })
  await back.scrollIntoViewIfNeeded()
  const summary = page.getByRole('complementary', { name: 'What you are paying' })
  const [controlBox, summaryBox] = [await back.boundingBox(), await summary.boundingBox()]

  // `sticky` keeps the summary in flow, so it reserves its own space rather
  // than floating over what precedes it. That is the property being pinned:
  // swapping it for `fixed` would pass every other assertion here and hide the
  // control that charges behind the total.
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(summaryBox!.y + 1)
})

test('checkout step 1 reports a bad field with a suggestion', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-bad-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('555')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // 3.3.1/3.3.3: identified, tied to the field, and carrying a suggestion.
  await expect(page.getByRole('main').getByRole('alert')).toContainText('area code')
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true')
})

test('the checkout stepper advances server-side and resumes', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)
  const url = page.url()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-resume-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // FR-4.1: resumable. Re-entering the same link lands on the step the renter
  // left, not back at the start — the session is the truth, not the tab.
  await page.goto('/')
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
})

test('the protection step cannot be skipped and updates the total', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-prot-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'This is right' }).click()

  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  // US-501: the mid tier is preselected and changeable in one tap.
  await expect(page.getByRole('radio', { name: /\$3,000 cover/ })).toBeChecked()

  // Choosing "my own cover" without the record is refused with a named error,
  // not a disabled button (3.3.1).
  await page.getByRole('radio', { name: /I have my own cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Insurer')).toHaveAttribute('aria-invalid', 'true')

  // A plan instead, and the recurring total moves with a stated cause (§6.4).
  await page.getByRole('radio', { name: /\$5,000 cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('main')).toContainText('Your lease')
  await expect(page.getByRole('main')).toContainText('Protection')
})

test('the lease shows a summary first and signs with a typed name', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-lease-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  // Each step is awaited before the next click. Two reasons: the server action
  // has to land before the next page exists, and Playwright's `name` match is a
  // case-insensitive SUBSTRING — so a bare "Continue" also matches
  // "This is right — continue" and can re-click the previous step's button.
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // §6.4: the plain-language summary is real page content above the full text.
  await expect(page.getByRole('heading', { name: 'The short version' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The full agreement' })).toBeVisible()

  // §6.4/§6.8.1: the signature control is available immediately — never gated
  // on scrolling, which is broken for anyone who does not scroll.
  const sign = page.getByRole('button', { name: 'Sign and continue' })
  await expect(sign).toBeEnabled()

  // Consent and signature are separate acts, and an empty submit must name BOTH
  // — not stop at the first one it finds (3.3.1).
  await sign.click()
  const alert = page.getByRole('main').getByRole('alert')
  await expect(alert).toContainText('Type your full name')
  await expect(alert).toContainText('Tick the box to agree to sign electronically')

  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  const consent = page.getByRole('checkbox', { name: /sign this agreement electronically/ })
  const typedName = page.getByLabel('Type your full name to sign')
  await consent.check()
  await typedName.fill('AR')
  await sign.click()
  await expect(alert).toContainText('That does not match the name on the lease')

  // B-124: the refusal must not take the consent tick with it. React 19 resets
  // a form once its action completes, so this step used to come back EMPTY —
  // and the renter, having fixed only the name they were told about, was then
  // refused for a box they had already ticked. This assertion is the whole
  // point of that fix; without it the next line would have to re-tick.
  await expect(consent).toBeChecked()

  await typedName.fill('Ada Renter')
  await sign.click()
  // `exact`, because the payment step also renders an "Automatic payments"
  // heading (B-025's autopay disclosure) and Playwright matches an accessible
  // name by case-insensitive substring — so the unqualified name resolves to
  // two elements and violates strict mode. It only ever passed because that
  // section is client-rendered: on a loaded machine the assertion resolved
  // before it mounted, and on a quiet one both are present and it fails.
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()
})

// B-119 (accessibility review 2026-08-12, test gap 4). Checkout had been
// scanned exactly once — `/checkout?token=not-a-real-session`, the "session
// not found" state — so five of its six steps and the confirmation screen
// had never been seen by any tool. That gap is why finding 5's dangling
// `aria-labelledby` survived to a source review rather than failing a test.
// Called after each `advance` in the walk below, not folded into a
// PUBLIC_ROUTES-style list: every step needs the PREVIOUS steps' real data
// already filled in to reach it at all, so there is no bare URL to `goto`.
async function assertNoAxeViolations(page: import('@playwright/test').Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    'axe found accessibility violations',
  ).toEqual([])
}

test('the payment step itemises before it charges and discloses autopay', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await assertNoAxeViolations(page) // step 1: Your details

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-pay-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await assertNoAxeViolations(page) // step 2: Your unit

  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await assertNoAxeViolations(page) // step 3: Protection

  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The short version' })).toBeVisible()
  await assertNoAxeViolations(page) // step 4: Your lease

  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()

  // 3.3.4: everything being charged, itemised, before the act that charges it.
  await expect(page.getByRole('heading', { name: 'What you are paying today' })).toBeVisible()
  await assertNoAxeViolations(page) // step 5: Payment
  await expect(page.getByRole('main')).toContainText('Total due today')
  await expect(page.getByRole('main')).toContainText('Then each month')

  // §6.9 / D-11a: default-on, with the amount and date stated beside the
  // control and the opt-out one activation away.
  const autopay = page.getByRole('checkbox', { name: /Pay automatically each month/ })
  await expect(autopay).toBeChecked()
  // B-044 / D-27: anniversary billing, so the day is the renter's own move-in
  // day in the FACILITY's timezone — not a constant 1, and not the UTC day,
  // which is already tomorrow when this suite runs late in the evening here.
  const billingDay = Number(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Chicago' }).format(new Date()),
  )
  await expect(page.locator('#autopay-disclosure')).toContainText(
    `day ${Math.min(billingDay, 28)} of each month`,
  )
  await expect(autopay).toHaveAttribute('aria-describedby', 'autopay-disclosure')

  // Whichever of the two payment affordances is correct for this environment.
  // This test's subject is that everything is itemised BEFORE the control that
  // charges (3.3.4) — not which control that is. It asserted the unconfigured
  // fallback for the project's whole life, and started failing the hour a real
  // Stripe key arrived, which is the test encoding the environment rather than
  // the behaviour.
  // The Payment Element itself lives in a Stripe iframe with no selector of
  // ours, so this asserts on the control that CHARGES — which is the thing
  // 3.3.4 is actually about, and is ours.
  // "Pay and complete move-in" at checkout; "Pay $X" in the portal. Either is
  // the control that charges.
  const payButton = page.getByRole('button', { name: /^Pay\b/ })
  const callInstead = page.getByText("can't take card payments online just now")
  await expect(payButton.or(callInstead).first()).toBeVisible()
})

test('an unknown checkout link says so and charges nothing', async ({ page }) => {
  await page.goto('/checkout?token=not-a-real-session')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("couldn't find that checkout")
  await expect(page.getByRole('main')).toContainText('Nothing has been charged')
})

// B-106 part 5. The multi-unit basket, driven the way a renter drives it.
//
// Scoped to its own fresh checkout session and its own tenant email, per the
// e2e shared-fixture discipline: it only ever ADDS a unit to a session it
// started itself and then removes it again, so it leaves the demo facility's
// availability exactly as it found it and nothing else asserts a fixed value
// against what it touched.
test('a renter can rent two units in one checkout, and the summary itemises them', async ({
  page,
}) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  // Random, not `Date.now()`: the two Playwright projects run this at the
  // same millisecond and collided on the tenant email's unique index.
  const email = `e2e-basket-${randomUUID()}@demo.example.com`
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  // One unit, so there is nothing to remove and no Remove control at all —
  // withheld rather than disabled.
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)

  await page.getByLabel('Size to add').selectOption({ index: 0 })
  await page.getByRole('button', { name: 'Add to my rental' }).click()

  // Two named groups, so the two Remove controls do not share one accessible
  // name (2.4.4/4.1.2) — the criterion the row states outright. Asserted as
  // "two DISTINCT names", not merely "two buttons": two controls both reading
  // "Remove" would satisfy a count and fail the requirement.
  const removeControls = page.getByRole('button', { name: /^Remove / })
  await expect(removeControls).toHaveCount(2)
  const names = await removeControls.allInnerTexts()
  expect(new Set(names).size, `expected two distinct names, got ${JSON.stringify(names)}`).toBe(2)

  // §6.4: the total moved, and the note says WHICH unit moved it.
  const summary = page.getByRole('complementary')
  await expect(summary).toContainText(/Unit .+ added/)

  // The itemisation. The summary is a <details>, collapsed by default, so it
  // is opened the way a renter opens it rather than by reading hidden text.
  await summary.getByText('Due today').first().click()
  for (const name of names) {
    await expect(summary).toContainText(name.replace(/^Remove /, ''))
  }

  await assertNoAxeViolations(page)

  // Put it back exactly as found — the fixture discipline above.
  await removeControls.last().click()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  await expect(summary).toContainText(/taken out of your rental/)
})
