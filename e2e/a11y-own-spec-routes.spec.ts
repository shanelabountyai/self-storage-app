import { expect, test, type Page } from '@playwright/test'
import { SCANNED_BY_OWN_SPEC, SCANNED_STATES } from '../apps/web/lib/a11y/scan-coverage'
import { signInAsDemoOwner, signInAsDemoTenant, signInAsPlanTenant } from './sign-in'
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

type Audience = 'admin' | 'tenant' | 'plan-tenant'

async function signIn(page: Page, audience: Audience): Promise<void> {
  if (audience === 'admin') await signInAsDemoOwner(page)
  else if (audience === 'plan-tenant') await signInAsPlanTenant(page)
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
  // B-246. The two states B-215 left with axe and no width measurement at all,
  // and which were declared in neither list — the exact hole this row closed in
  // `SCANNED_STATES`. Both are on the tenant profile, which B-217 established
  // is real phone work for counter staff.
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
