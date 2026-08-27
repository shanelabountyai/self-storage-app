import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

// B-156 / PRD 02 §5.5 FR-25(3). "A control that does nothing fails CI" — the
// cheapest catch the accessibility review named: after a submit, a live
// region that was ALREADY ATTACHED before the submit has non-empty text.
//
// The locator must be captured and checked BEFORE the action, not fetched
// fresh afterward — a fresh locator would pass even if the element had been
// unmounted and remounted already populated, which is the exact announcement
// failure `AdminForm`'s own comment warns against (FR-20: "a live region
// inserted into the DOM already populated is unreliably announced by
// VoiceOver and routinely missed by NVDA"). `expectPreexisting` is what turns
// that into something CI checks rather than something a comment asserts.
//
// Only safe to use on a region that is unconditionally mounted — `AdminForm`'s
// own success `role="status"` paragraph is (empty at idle, always present);
// its error/confirm summary is NOT (conditionally rendered only once the
// action has failed once), so this helper cannot yet verify the error path
// pre-exists — that gap is real and is left for a future item, not silently
// worked around here.
export async function expectPreexisting(region: Locator): Promise<void> {
  await expect(region).toBeAttached()
  await expect(region).toHaveText('')
}

// B-184 (T4). `focused: true` asserts the region took focus once the
// announcement landed — the outcome has to survive the control that reported
// it, not just print words nobody's cursor is anywhere near (2.4.3). Optional
// because most callers of this only care that the words are there; two now
// care that focus followed them (`/portal/contact`'s address save, a
// completed task).
export async function expectAnnounced(
  region: Locator,
  pattern: string | RegExp,
  options?: { focused?: boolean },
): Promise<void> {
  await expect(region).toHaveText(pattern)
  if (options?.focused) await expect(region).toBeFocused()
}

// B-184 (T2). One function every axe scan in the suite routes through, lifted
// out of `e2e/a11y.spec.ts`'s public-route loop. Before this, eight other spec
// files destructured `violations` on its own and asserted nothing about
// `incomplete` — the checks axe could not decide — so "we did not test that"
// quietly read as "that passed" everywhere except the public pages. The
// accessibility statement claimed otherwise (B-159 finding 4); this is what
// makes the claim true rather than narrowing it further.
/// B-196 (gap 1). A hand check is a claim about ONE element on ONE screen, so
/// the exemption it earns is scoped to that screen.
///
/// Before this, `HAND_CHECKED_INCOMPLETE` was four bare regexes matched against
/// axe's `failureSummary` on EVERY route in the suite. Each had been verified
/// properly, by hand, on a single element — B-118's sticky Rent-now bar, the
/// `unrentable` badge's gradient, the checkout stepper's glyph, the tenant
/// profile under CSS containment — and each then silently suppressed its whole
/// check product-wide, including over a genuine overlap on a page nobody had
/// looked at. "Checked by hand here" had quietly become "never checked
/// anywhere".
///
/// The three below are each ONE component on one screen, and they are keyed to
/// it. `route` is the Next.js pattern, `[param]` segments kept, matched against
/// the pathname the scan is actually on — the same shape `SCANNED_STATES` uses,
/// and deliberately so: the two lists are the same contract at two levels.
/// `state` narrows it further where a limitation exists only in one, and is
/// compared against the `state` the caller passes. None of the reasoning below
/// is re-litigated here; every hand check stands exactly as it was written.
///
/// The fourth and fifth are NOT here, and that is this row's real finding — see
/// `VERIFIED_BY_HIT_TEST` below. They were never a property of the two pages
/// they had been checked on.
type HandCheckedIncomplete = {
  route: string
  state?: string
  pattern: RegExp
  why: string
}

const HAND_CHECKED_INCOMPLETE: readonly HandCheckedIncomplete[] = [
  {
    // B-118's sticky "Rent now" bar (facility page, below `sm`). `position:
    // sticky; bottom: 0` means it deliberately overlaps whatever the visitor
    // has scrolled to underneath it — that is the whole point of a persistent
    // CTA — and axe's contrast checker cannot compute an effective background
    // for an element it detects spatially overlapping another, regardless of
    // what that background actually is. Checked by hand: `bg-background` is
    // fully opaque (no `bg-background/NN`) and pairs `text-foreground`-weight
    // text at 14px/500 the same way every other card on this page does, which
    // `contrast-tokens.test.ts` already asserts meets AA.
    route: '/storage/[state]/[city]/[slug]',
    pattern: /partially overlaps other elements/i,
    why: "B-118's sticky Rent-now bar, which overlaps by design",
  },
  {
    // `UnitStatusBadge`'s `unrentable` state layers a translucent hatch pattern
    // over `bg-gray-100` so the six unit statuses stay distinguishable without
    // relying on hue alone (1.4.1) — axe cannot compute an effective background
    // through a `background-image` gradient. The badge sets no gradient on any
    // other status, and `bg-gray-100` / `text-gray-700` is the same pairing used
    // unadorned elsewhere.
    route: '/admin/units',
    pattern: /background gradient/i,
    why: "the unrentable badge's hatch pattern, which is what keeps status off hue alone",
  },
  {
    // The checkout stepper's `✓` / step-number glyph
    // (`components/checkout/stepper.tsx`) is a font-metrics limitation in axe,
    // not a real ambiguity — the span sets no colour of its own, so it inherits
    // whatever text colour the step's own label already renders in, the same
    // text-on-background pairing `contrast-tokens.test.ts` already asserts meets
    // AA.
    route: '/checkout',
    pattern: /only non-text characters/i,
    why: "the checkout stepper's step glyph, which sets no colour of its own",
  },
]

/// Whether a route pattern covers the pathname a scan is on. Same conversion
/// `tests/a11y-scan-coverage.test.ts` uses: a `[param]` segment matches one
/// path segment and nothing else.
function routeMatches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true
  if (!pattern.includes('[')) return false
  const source = pattern
    .split('/')
    .map((part) => (part.startsWith('[') ? '[^/]+' : part.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${source}$`).test(pathname)
}

/// B-196. The one exemption that is re-proved on every node it waives, rather
/// than keyed to a route.
///
/// Two of axe's phrasings — `elmPartiallyObscured` giving up, and
/// `shortTextContent` giving up — were hand-checked twice before this row, on
/// the tenant profile (B-090c) and the lead screen (B-187), and both times the
/// finding was the same: nothing was overlapping anything. Keying them to those
/// two routes turned out to understate the scope badly. Walking every route in
/// `ADMIN_SCAN_ROUTES` at phone width found **thirteen more** — every report
/// with a wide table, `/admin/units/types`, `/admin/units/rates`,
/// `/admin/access` — and **zero genuine overlaps among them**.
///
/// The mechanism is one thing and it is not the page: a wide table inside an
/// `overflow-x: auto` container on a narrow viewport puts a cell's CENTRE POINT
/// outside the viewport, so `document.elementsFromPoint` returns an empty stack
/// and axe cannot resolve an effective background. Enumerating fifteen routes
/// would be a list that rots on the next admin table.
///
/// So this does the hand check itself, on every scan: waive only where nothing
/// that is not the element's own ancestor or descendant actually sits on top of
/// it. A real overlay over a real cell still fails, anywhere in the product,
/// which is more than a route-keyed waiver could promise — the check is
/// performed rather than remembered.
const VERIFIED_BY_HIT_TEST = [
  /partially obscured by another element/i,
  /too short to determine if it is actual text content/i,
]

async function nothingOverlaps(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    // An empty stack means the centre is off-screen — scrolled out of a
    // horizontally overflowing table — which is the case axe cannot decide and
    // a sighted reader is not looking at either.
    if (stack.length === 0) return true
    const top = stack[0]
    return top === el || el.contains(top) || top.contains(el)
  }, selector)
}

export type AxeScanOptions = {
  /// The assertion message, when the default is not specific enough.
  message?: string
  /// The state this scan is of, matched against the `// a11y-state:` name the
  /// spec already carries. Only needed where an exemption is scoped to a state
  /// (B-196); everywhere else the route alone decides.
  state?: string
}

// B-184 (T2). One function every axe scan in the suite routes through, lifted
// out of `e2e/a11y.spec.ts`'s public-route loop. Before this, eight other spec
// files destructured `violations` on its own and asserted nothing about
// `incomplete` — the checks axe could not decide — so "we did not test that"
// quietly read as "that passed" everywhere except the public pages. The
// accessibility statement claimed otherwise (B-159 finding 4); this is what
// makes the claim true rather than narrowing it further.
export async function assertNoAxeViolations(
  page: Page,
  options: AxeScanOptions = {},
): Promise<void> {
  const { violations, incomplete } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const message = options.message ?? 'axe found accessibility violations'
  expect(violations.map((v) => `${v.id}: ${v.help}`), message).toEqual([])

  // The exemptions in force HERE — on this route, in this state — and nowhere
  // else. Identified by axe's own phrasing for the specific limitation rather
  // than by a CSS target path (which shifts if a component's classes ever do).
  const pathname = new URL(page.url()).pathname
  const inForce = HAND_CHECKED_INCOMPLETE.filter(
    (row) =>
      routeMatches(row.route, pathname) && (row.state === undefined || row.state === options.state),
  )

  // A node inside a third-party iframe (target path length > 1) is the one
  // exemption that isn't text-matched, since a target path there is never
  // stable to begin with.
  //
  // Payment step: Stripe's own Payment Element splits into several
  // `__privateStripeFrame…` iframes, each carrying the identical title Stripe
  // assigns them ("Secure payment input frame") — not a page we author markup
  // for. Matched on the frame's own `target` selector
  // (`iframe[name="__privateStripeFrameNNNN"]`) rather than `html`, which axe
  // truncates — a truncated snippet cut the "m" off "stripe.com" and the first
  // version of this exemption silently never matched. `target` is a CSS
  // selector, never prose, so it isn't subject to that truncation. A real
  // duplicate title on an iframe we DO control still fails: nothing here
  // matches by the generic "title is not unique" wording alone.
  const isThirdPartyFrame = (n: (typeof incomplete)[number]['nodes'][number]) =>
    n.target.some((t) => typeof t === 'string' && /stripeframe/i.test(t))

  const keep = async (n: (typeof incomplete)[number]['nodes'][number]): Promise<boolean> => {
    if (n.target.length !== 1) return false
    if (isThirdPartyFrame(n)) return false
    const summary = n.failureSummary ?? ''
    if (inForce.some((row) => row.pattern.test(summary))) return false
    if (VERIFIED_BY_HIT_TEST.some((pattern) => pattern.test(summary))) {
      const selector = n.target[0]
      if (typeof selector === 'string' && (await nothingOverlaps(page, selector))) return false
    }
    return true
  }

  const ownPage: typeof incomplete = []
  for (const item of incomplete) {
    const nodes = []
    for (const node of item.nodes) if (await keep(node)) nodes.push(node)
    if (nodes.length > 0) ownPage.push({ ...item, nodes })
  }

  // The report names axe's OWN phrasing for the limitation, not just the rule
  // that could not decide. That phrasing is what an exemption is keyed on, so a
  // message without it tells you a hand check is needed and not what to look
  // for — which is most of the work (B-196).
  expect(
    ownPage.map((i) => {
      const summaries = [
        ...new Set(i.nodes.map((n) => (n.failureSummary ?? '').split('\n').at(-1)?.trim() ?? '')),
      ].filter(Boolean)
      return `${i.id}: ${i.help} — ${summaries.join(' | ')}`
    }),
    `axe could not decide these on ${pathname}${options.state ? ` (${options.state})` : ''} — check them by hand, then add a route-scoped entry to HAND_CHECKED_INCOMPLETE`,
  ).toEqual([])
}
