import { expect, test, type Page } from '@playwright/test'
import { SCANNED_BY_OWN_SPEC, SCANNED_STATES } from '../apps/web/lib/a11y/scan-coverage'
import { DEMO_BUSINESS_ACCOUNT_NAME } from '../apps/web/scripts/demo-credentials'
import {
  signInAsBusinessMember,
  signInAsBusinessPayer,
  signInAsDemoOwner,
  signInAsDemoTenant,
  signInAsPlanTenant,
} from './sign-in'
import { expectNoHorizontalOverflow, TEXT_SPACING } from './a11y-helpers'

// B-201 / PRD 02 §5.5 FR-24 (WCAG 2.1 AA, 1.4.10 Reflow, 1.4.4 Resize text,
// 1.4.12 Text spacing).
//
// `a11y.spec.ts` and `admin.spec.ts` each run three layout loops — 320px,
// 200% zoom, forced text spacing — over a list of static route strings. A
// dynamic route cannot be in such a list: it needs a real demo id, which no
// hard-coded string can hold across a reseed. B-156 solved that for AXE by
// giving each of those routes a scan inside its own topic spec, reached
// through a real click-through, and recording the arrangement in
// `SCANNED_BY_OWN_SPEC` so the coverage test can tell "covered elsewhere" from
// "not covered at all".
//
// It solved it for axe and only for axe. Seven routes — the whole tenant
// profile branch, `/portal/pay` and `/portal/transfer` — had never been
// checked at 320px, at 200% zoom, or under forced text spacing by anything.
// B-199's defect (a seven-column leases table with no scroll wrapper, its
// action links untappable on a phone) lived on one of them for four items,
// reported six times as a `mobile-chrome` flake.
//
// So this file is the layout half of what B-156 did for axe: the same routes,
// reached the same way, through ONE table of click-throughs rather than seven
// copies pasted into seven topic files. The click-through belongs here and not
// in those files because it is the thing being shared; the axe scans stay
// where they are, beside the behaviour they were written next to.

type Audience =
  | 'admin'
  | 'tenant'
  | 'plan-tenant'
  | 'business-payer'
  | 'business-member'
  /// B-090 part 6. Every other audience is a person signed in; a Spanish
  /// visitor is nobody, holding a cookie. Without this the only way to measure
  /// a translated page here was to sign somebody in who did not need to be.
  | 'public'

async function signIn(page: Page, audience: Audience): Promise<void> {
  if (audience === 'public') return
  if (audience === 'admin') await signInAsDemoOwner(page)
  else if (audience === 'plan-tenant') await signInAsPlanTenant(page)
  // B-256. Casey Contractor holds no lease, so this is the only session in
  // which the account card and the consolidated pay screen render at all.
  else if (audience === 'business-payer') await signInAsBusinessPayer(page)
  // B-258. Robin Bookkeeper sees the account and cannot pay it, which is a
  // different card — one fewer column and no Pay button.
  else if (audience === 'business-member') await signInAsBusinessMember(page)
  else await signInAsDemoTenant(page)
}

/// How to reach each route in `SCANNED_BY_OWN_SPEC`, keyed by the route
/// pattern. Every entry in that list must appear here — the loop below asserts
/// it, so a new own-spec route with no way to reach it is a failing test rather
/// than a route that quietly drops out of three checks.
const REACH: Record<string, { audience: Audience; go: (page: Page) => Promise<void> }> = {
  '/portal/transfer': {
    audience: 'tenant',
    async go(page) {
      await page.goto('/portal/transfer')
      await expect(page.getByRole('main')).toBeVisible()
    },
  },
  '/portal/pay': {
    audience: 'tenant',
    async go(page) {
      await page.goto('/portal')
      await page.getByRole('link', { name: /pay \$.* now/i }).first().click()
      await page.waitForURL(/\/portal\/pay\?lease=/)
      await expect(page.getByRole('heading', { name: 'Pay your balance' })).toBeVisible()
    },
  },
  // B-090e, added by B-256 — the row that put `/admin/billing/accounts/[id]`
  // in `SCANNED_BY_OWN_SPEC` gave it no entry here, so this test has failed
  // since that item merged and the page has been measured at no width by
  // anything. It is a table of units, tenant names and money on a screen
  // counter staff open on a phone (B-217), which is the shape B-199 spent an
  // item on.
  '/admin/billing/accounts/[id]': {
    audience: 'admin',
    async go(page) {
      await page.goto('/admin/billing/accounts')
      await page.getByRole('link', { name: DEMO_BUSINESS_ACCOUNT_NAME }).click()
      await page.waitForURL(/\/admin\/billing\/accounts\/[^/?]+$/)
      // The units table, not the heading above it.
      await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible()
    },
  },
  // B-256. A five-column table of money on the page a payer prints for their
  // bookkeeper. Reached the way they reach it: the statements list, then the
  // month under the account's own heading — no id can be written down here.
  '/portal/statements/account/[accountId]/[period]': {
    audience: 'business-payer',
    async go(page) {
      await page.goto('/portal/statements')
      await page
        .getByRole('region', { name: /all units/ })
        .getByRole('link')
        .first()
        .click()
      await expect(page.getByRole('rowheader', { name: 'All units' })).toBeVisible()
    },
  },
  '/admin/tenants/[tenantId]': { audience: 'admin', go: (page) => openDanasProfile(page) },
  '/admin/tenants/[tenantId]/ledger/[leaseId]': {
    audience: 'admin',
    go: (page) => fromProfile(page, /^Ledger/, /\/ledger\//),
  },
  '/admin/tenants/[tenantId]/notices/[leaseId]': {
    audience: 'admin',
    go: (page) => fromProfile(page, 'Notices', /\/notices\//),
  },
  '/admin/tenants/[tenantId]/move-out': {
    audience: 'admin',
    go: (page) => fromProfile(page, 'Move out', /\/move-out\?lease=/),
  },
  '/admin/tenants/[tenantId]/transfer': {
    audience: 'admin',
    go: (page) => fromProfile(page, 'Transfer', /\/transfer\?lease=/),
  },
  // B-230. Reached the way the counter reaches it. `Take payment` renders only
  // on a lease with a balance, which is why Dana is the tenant this table
  // already opens. Read-only: with no Stripe key configured the page raises no
  // intent and writes nothing, so it touches no shared fixture (B-120).
  '/admin/pos/card': {
    audience: 'admin',
    go: (page) => fromProfile(page, 'Take payment', /\/admin\/pos\/card\?lease=/),
  },
}

// dana@demo.example.com uniquely: two "Dana Delinquent" tenants exist, one per
// demo facility, and the name alone would not tell them apart. This is the one
// with a real ledger charge, which is what the four sub-routes need to render
// anything worth measuring. Read-only throughout — nothing here submits a
// form, so none of it touches the shared fixture B-120's rule protects.
async function openDanasProfile(page: Page): Promise<void> {
  await page.goto('/admin/tenants?q=dana@demo.example.com')
  await page.getByRole('link', { name: 'Dana Delinquent' }).click()
  await page.waitForURL(/\/admin\/tenants\/[^/?]+$/)
  await expect(page.getByRole('main')).toBeVisible()
}

/// `waitForURL`, not just a visible `<main>`: the profile's own `<main>` is
/// already visible, so a measurement taken without this can win the race
/// against the client-side transition and measure the PREVIOUS page — the
/// mistake B-199 found in the lien-notices scan, where it presented as a
/// finding naming nodes that do not exist on the route.
async function fromProfile(page: Page, link: string | RegExp, url: RegExp): Promise<void> {
  await openDanasProfile(page)
  await page.getByRole('link', { name: link }).first().click()
  await page.waitForURL(url)
  await expect(page.getByRole('main')).toBeVisible()
}

/// The three measurements, once. Reached once at the project's own viewport,
/// then measured three times: the three are one test rather than three because
/// the click-through is two or three page loads and the assertion is the same
/// function each time — splitting them triples the cost of the expensive half
/// for no information the first failure would not already have given, since all
/// three measure the same page for the same kind of fault. The condition string
/// is what says which pass produced a failure.
async function measureThreeWays(page: Page, label: string): Promise<void> {
  // 1.4.10 Reflow: 320 CSS px, the criterion's own width.
  await page.setViewportSize({ width: 320, height: 800 })
  await expectNoHorizontalOverflow(page, `at 320px on ${label}`)

  // 1.4.4 Resize text: 640×512 is a 1280×1024 desktop at 200%. The device
  // scale factor the static loops also set is a rendering concern, not a
  // layout one — the CSS viewport, which is all an overflow measurement
  // reads, is 640 either way, and it cannot be changed after the context
  // exists anyway.
  await page.setViewportSize({ width: 640, height: 512 })
  await expectNoHorizontalOverflow(page, `at 200% zoom on ${label}`)

  // 1.4.12 Text spacing, on the zoomed viewport it is hardest at.
  await page.addStyleTag({ content: TEXT_SPACING })
  await expectNoHorizontalOverflow(page, `under forced text spacing on ${label}`)
}

for (const { route, spec } of SCANNED_BY_OWN_SPEC) {
  const reach = REACH[route]

  test(`${route} holds its layout at 320px, 200% zoom and forced text spacing`, async ({
    page,
  }) => {
    expect(
      reach,
      `${route} is scanned by ${spec} but has no entry in REACH, so nothing checks it at 320px`,
    ).toBeDefined()

    await signIn(page, reach.audience)
    await reach.go(page)
    await measureThreeWays(page, route)
  })
}

// ── B-215: the same gap one level down ──────────────────────────────────────
//
// B-201 gave the three layout loops routes. `SCANNED_STATES` is the level
// below that (B-184): a route's real markup often depends on WHO is signed in
// or what was done on it, and those states were given to axe and to nothing
// else. So both customer-facing payment-plan surfaces — the four-column
// installment schedule and the dashboard plan card — had been scanned by axe
// since B-196 and measured at no width by anything, because `portal.spec.ts`
// runs its layout loops as Dana, who has no plan, and therefore measures
// `/portal/payment-plan` in its EMPTY state. A four-column table of dates and
// money on a page a tenant reads on a phone: the exact shape B-199 spent an
// item on.
//
// Keyed by `route | state`, the same string `SCANNED_STATES` and the coverage
// test already join on.
//
// **This table is opt-in, and the contract runs one way only.** Every key here
// must name a real `SCANNED_STATES` entry — the loop asserts that, so a state
// renamed out from under this file fails rather than silently measuring
// nothing. The reverse is NOT claimed: most scanned states are reached by a
// submit or a disclosure rather than a `goto`, and pretending this file covers
// them would be the overstatement `scan-coverage.ts` exists to stop. What
// belongs here is a state reachable by signing in as the right actor and going
// to the page.
const STATE_REACH: Record<string, { audience: Audience; go: (page: Page) => Promise<void> }> = {
  // B-090 part 6. The facility page in Spanish, measured rather than assumed.
  //
  // Axe alone would not be enough here and the reason is specific: Spanish runs
  // roughly 20% longer than the English it replaces, and this route's unit
  // cards, filter row and sticky Rent/Reserve bar are the tightest layout on
  // the public site at 320px. The English state of the same route is measured
  // by the public reflow loop; that measurement says nothing about the strings
  // that actually ship to a Spanish reader.
  '/storage/[state]/[city]/[slug] | Spanish': {
    audience: 'public',
    async go(page) {
      // B-262: the Spanish page is its own URL. Setting a cookie here would now
      // do nothing at all — `getLocale()` reads the path — and the measurement
      // would quietly have been of the English page under a Spanish key, which
      // is the shape of overstatement `scan-coverage.ts` exists to stop.
      await page.goto('/es/storage/tx/austin/demo-austin-south')
      // The unit cards, not the heading above them: measuring before the
      // inventory renders would measure a page with none of the content this
      // key exists for.
      await expect(page.getByRole('heading', { name: 'Unidades disponibles' })).toBeVisible()
    },
  },
  // B-256. A business account's card is a three-column table of units, tenant
  // names and money, on the page a payer reads on a phone — the shape B-199
  // spent an item on. The portal route loop measures `/portal` as Dana, who
  // has no account and therefore no table, so this is measured here or nowhere.
  '/portal | business account card': {
    audience: 'business-payer',
    async go(page) {
      await page.goto('/portal')
      // The TABLE, not the heading above it: measuring the page before the
      // units render is the failure this key exists to catch.
      await expect(page.getByRole('columnheader', { name: 'Rented by' })).toBeVisible()
    },
  },
  // B-258. The member's card: the same table minus its "Rented by" column and
  // minus the Pay button, which is a different layout at the same width and is
  // measured here or nowhere.
  '/portal | business account card, member': {
    audience: 'business-member',
    async go(page) {
      await page.goto('/portal')
      // The TABLE, not the heading above it — and keyed on a cell rather than
      // on "Rented by", which is the header this state deliberately has not
      // got.
      await expect(page.getByRole('columnheader', { name: 'Balance' })).toBeVisible()
    },
  },
  // And the same table again under the bill, where it sits beside the Payment
  // Element in a narrower container.
  '/portal/pay | business account': {
    audience: 'business-payer',
    async go(page) {
      await page.goto('/portal')
      // Inside `main`: the portal nav carries its own "Pay $X" link (B-239),
      // which points at the one owing LEASE rather than at the account.
      await page.getByRole('main').getByRole('link', { name: /^Pay \$/ }).click()
      await expect(page.getByRole('row', { name: /Paying today/ })).toBeVisible()
    },
  },
  '/portal/payment-plan | active plan schedule': {
    audience: 'plan-tenant',
    async go(page) {
      await page.goto('/portal/payment-plan')
      // The TABLE, not the empty state — the same guard `portal.spec.ts` puts
      // in front of its axe scan, and for the same reason: a layout check that
      // passed because there was nothing on the page is the failure this
      // closes.
      await expect(page.getByRole('columnheader', { name: 'Left after' })).toBeVisible()
    },
  },
  // B-247. The six errands behind `Manage`, which the portal route loop never
  // opens — so their 44px tap targets are measured here or nowhere.
  '/portal | manage menu open': {
    audience: 'tenant',
    async go(page) {
      await page.goto('/portal')
      await page.locator('summary').filter({ hasText: 'Manage' }).first().click()
      await expect(
        page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Refer a friend' }),
      ).toBeVisible()
    },
  },
  // B-237. Six `<dl>` rows of long values — a full address and a web address
  // among them. The tax step's exception does not carry over: two short rows
  // and six long ones are not the same layout question at 320px.
  '/admin/settings/facilities/new | new facility confirm-and-echo': {
    audience: 'admin',
    async go(page) {
      await page.goto('/admin/settings/facilities/new')
      const form = page.getByRole('form', { name: 'Add a facility' })
      await form.getByLabel('Name').fill('E2E Layout Facility')
      await form.getByLabel('Web address').fill('e2e-layout-facility')
      await form.getByLabel('Address line 1', { exact: true }).fill('1 Very Long Test Road, Suite 200')
      await form.getByLabel('City').fill('Austin')
      await form.getByLabel('State').fill('TX')
      await form.getByLabel('Postal code').fill('78704')
      await form.getByRole('button', { name: 'Review this facility' }).click()
      // The echo, not the form it replaced — measuring the page before the step
      // arrives is the failure this key exists to catch.
      await expect(page.getByRole('button', { name: 'Yes, create this facility' })).toBeVisible()
    },
  },
  // B-246. The two states B-215 left with axe and no width measurement at all,
  // and which were declared in neither list — the exact hole this row closed in
  // `SCANNED_STATES`. Both are on the tenant profile, which B-217 established
  // is real phone work for counter staff.
  // B-240. The profile scrolled, so the sticky summary is pinned over the
  // sections beneath it. `expectNoHorizontalOverflow` is a width check and the
  // bar's risk is vertical, so what this actually holds is the shape that makes
  // the vertical risk manageable: four labelled pairs and six links that wrap
  // rather than push the page sideways at 320px and at 200% zoom. The bar goes
  // static below 640px of viewport height, which is why the 640×512 pass here
  // measures it unpinned and the 320×800 pass measures it pinned.
  '/admin/tenants/[tenantId] | sticky summary': {
    audience: 'admin',
    async go(page) {
      await openDanasProfile(page)
      await expect(page.getByRole('navigation', { name: 'On this profile' })).toBeVisible()
      await page.mouse.wheel(0, 2000)
    },
  },
  '/admin/tenants/[tenantId] | payment plan schedule': {
    audience: 'admin',
    async go(page) {
      // The tenant WITH a plan, not Dana — the schedule renders on hers.
      await page.goto('/admin/tenants?q=pia@demo.example.com')
      await page.getByRole('link', { name: 'Pia Planned' }).click()
      const section = page.getByRole('region', { name: 'Payment plans' })
      // The table, not the heading above it. A width check that passed because
      // there was nothing on the page is the failure this row is about.
      await expect(section.getByRole('columnheader', { name: 'Left after' })).toBeVisible()
    },
  },
  '/admin/tenants/[tenantId] | payment plan builder refused': {
    audience: 'admin',
    async go(page) {
      await page.goto('/admin/tenants?q=dana@demo.example.com')
      await page.getByRole('link', { name: 'Dana Delinquent' }).click()
      // The builder lives inside a `<details>`, so `openDanasProfile` measured
      // it at `display: none` — twelve date and money fields in a three-column
      // grid, plus the split-count `<select>`, laid out by no measurement at
      // any width until this entry.
      await page.locator('summary').filter({ hasText: 'Set up a payment plan' }).first().click()
      await expect(page.getByRole('button', { name: /^Agree the plan for unit/ })).toBeVisible()
      // Refused, which is the state named — and repeatable, because nothing is
      // written by a refusal.
      await page.getByRole('button', { name: /^Agree the plan for unit/ }).click()
    },
  },
  '/portal | payment plan card': {
    audience: 'plan-tenant',
    async go(page) {
      await page.goto('/portal')
      // B-245 removed the `role="status"` here; B-244 made each lease card a
      // named region, which is what this reaches for now.
      await expect(
        page
          .getByRole('main')
          .getByRole('region')
          .filter({ hasText: "You're on a payment plan" }),
      ).toContainText("You're on a payment plan")
    },
  },
}

for (const [key, reach] of Object.entries(STATE_REACH)) {
  test(`${key} holds its layout at 320px, 200% zoom and forced text spacing`, async ({ page }) => {
    expect(
      SCANNED_STATES.map((s) => `${s.route} | ${s.state}`),
      `${key} is not a state SCANNED_STATES lists, so this measures a state nothing else claims`,
    ).toContain(key)

    await signIn(page, reach.audience)
    await reach.go(page)
    await measureThreeWays(page, key)
  })
}
