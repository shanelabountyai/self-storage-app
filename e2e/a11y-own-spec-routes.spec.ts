import { expect, test, type Page } from '@playwright/test'
import { SCANNED_BY_OWN_SPEC } from '../apps/web/lib/a11y/scan-coverage'
import { signInAsDemoOwner, signInAsDemoTenant } from './sign-in'
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

type Audience = 'admin' | 'tenant'

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

for (const { route, spec } of SCANNED_BY_OWN_SPEC) {
  const reach = REACH[route]

  test(`${route} holds its layout at 320px, 200% zoom and forced text spacing`, async ({
    page,
  }) => {
    expect(
      reach,
      `${route} is scanned by ${spec} but has no entry in REACH, so nothing checks it at 320px`,
    ).toBeDefined()

    if (reach.audience === 'admin') await signInAsDemoOwner(page)
    else await signInAsDemoTenant(page)

    // Reached once, at the project's own viewport, then measured three times.
    // The three are one test rather than three because the click-through is
    // two or three page loads and the assertion is the same function each
    // time — splitting them triples the cost of the expensive half for no
    // information the first failure would not already have given, since all
    // three measure the same page for the same kind of fault. The condition
    // string is what says which pass produced a failure.
    await reach.go(page)

    // 1.4.10 Reflow: 320 CSS px, the criterion's own width.
    await page.setViewportSize({ width: 320, height: 800 })
    await expectNoHorizontalOverflow(page, `at 320px on ${route}`)

    // 1.4.4 Resize text: 640×512 is a 1280×1024 desktop at 200%. The device
    // scale factor the static loops also set is a rendering concern, not a
    // layout one — the CSS viewport, which is all an overflow measurement
    // reads, is 640 either way, and it cannot be changed after the context
    // exists anyway.
    await page.setViewportSize({ width: 640, height: 512 })
    await expectNoHorizontalOverflow(page, `at 200% zoom on ${route}`)

    // 1.4.12 Text spacing, on the zoomed viewport it is hardest at.
    await page.addStyleTag({ content: TEXT_SPACING })
    await expectNoHorizontalOverflow(page, `under forced text spacing on ${route}`)
  })
}
