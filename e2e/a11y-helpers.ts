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
    // Not found is deliberately NOT waived — a node axe flagged that has since
    // vanished means the DOM moved under the scan, and waiving it would hide
    // that. But it is not an overlap either, so the caller says which it is
    // (B-199): the failure it produces otherwise sends you hunting for an
    // overlay that never existed, on a page the node was never on.
    if (!el) return false

    // The same DOM-ancestor walk `offscreenOffenders` does below, duplicated
    // rather than shared: a closure cannot cross the `page.evaluate` boundary.
    // Two copies, kept in step by hand — change one, change the other.
    const scrollsHorizontally = (node: Element) => {
      for (let a = node.parentElement; a; a = a.parentElement) {
        const { overflowX } = getComputedStyle(a)
        if (overflowX === 'auto' || overflowX === 'scroll') return true
      }
      return false
    }

    const rect = el.getBoundingClientRect()
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    // An empty stack means the centre is off-screen. That is the case axe
    // cannot decide ONLY where the reader has a scrollbar that brings it back —
    // a cell scrolled out of an `overflow-x: auto` table, which is the whole
    // reason this hit test exists. Off-screen with nothing to scroll is B-199's
    // case instead: painted past the edge and unreachable by any means. Waiving
    // that left 1.4.3 and 1.4.11 unenforced on exactly the nodes where they
    // matter most, so it is now a question rather than an assumption (B-214).
    if (stack.length === 0) return scrollsHorizontally(el)
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

  // A node axe reached INSIDE a nested browsing context: `target` is a path
  // (`['iframe[name=...]', 'html']`) rather than one selector, and no text match
  // applies, since a target path there is never stable to begin with.
  //
  // B-214: this used to drop every such node, on every route, with only the
  // Stripe reasoning below to justify it — so an undecided check inside ANY
  // frame was silently waived, including one whose document we write. It is now
  // scoped to a frame whose content is not ours: cross-origin by its own `src`,
  // which covers Stripe's Payment Element and the Google Maps embed on a
  // facility page, and covers nothing we author. A same-origin frame is kept and
  // reported like any other node.
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
  const isThirdPartyFrame = async (
    n: (typeof incomplete)[number]['nodes'][number],
  ): Promise<boolean> => {
    // Stripe's frames stay matched by name as well as by origin: several of them
    // carry no `src` of their own, so the origin test alone would start
    // reporting the payment step's undecided checks against markup we cannot fix.
    if (n.target.some((t) => typeof t === 'string' && /stripeframe/i.test(t))) return true
    // Only a node INSIDE a frame. The iframe element itself is markup we wrote,
    // wherever it points, so a bad title or a missing name on it still fails.
    if (n.target.length === 1) return false
    const sel = n.target[0]
    if (typeof sel !== 'string') return false
    return page.evaluate((s) => {
      const frame = document.querySelector(s)
      if (!(frame instanceof HTMLIFrameElement) || !frame.src) return false
      try {
        return new URL(frame.src, location.href).origin !== location.origin
      } catch {
        return false
      }
    }, sel)
  }

  const keep = async (n: (typeof incomplete)[number]['nodes'][number]): Promise<boolean> => {
    if (await isThirdPartyFrame(n)) return false
    // Everything below reads a single resolvable selector; a node in a frame we
    // do author has none, and is reported rather than measured.
    if (n.target.length !== 1) return true
    const summary = n.failureSummary ?? ''
    if (inForce.some((row) => row.pattern.test(summary))) return false
    if (VERIFIED_BY_HIT_TEST.some((pattern) => pattern.test(summary))) {
      const selector = n.target[0]
      if (typeof selector === 'string' && (await nothingOverlaps(page, selector))) return false
    }
    return true
  }

  // Targets axe flagged that no longer resolve — see `nothingOverlaps`.
  const absent = new Set<string>()
  for (const item of incomplete) {
    for (const n of item.nodes) {
      const sel = String(n.target[0])
      if (n.target.length === 1 && !(await page.locator(sel).count())) absent.add(sel)
    }
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
  //
  // B-199 adds the target selectors for the same reason one level down. The
  // phrasing says what kind of limitation it is; the selector says which node
  // to go and look at. Without it a hand check starts by re-running the scan
  // with a debugger attached, which is the work the message exists to save.
  expect(
    ownPage.map((i) => {
      const summaries = [
        ...new Set(i.nodes.map((n) => (n.failureSummary ?? '').split('\n').at(-1)?.trim() ?? '')),
      ].filter(Boolean)
      const targets = [...new Set(i.nodes.flatMap((n) => n.target.map(String)))]
      const note = i.nodes.some((n) => absent.has(String(n.target[0])))
        ? ' — NOTE: some of these are no longer in the DOM, so this scan probably raced a navigation; await the URL before scanning'
        : ''
      return `${i.id}: ${i.help} — ${summaries.join(' | ')} [${targets.join(', ')}]${note}`
    }),
    `axe could not decide these on ${pathname}${options.state ? ` (${options.state})` : ''} — check them by hand, then add a route-scoped entry to HAND_CHECKED_INCOMPLETE`,
  ).toEqual([])
}

// B-201 / 1.4.10 Reflow. The overflow assertion that `[contain:layout]` cannot
// mask.
//
// Every reflow, zoom and text-spacing check in this suite asked one question of
// one element: `document.documentElement.scrollWidth > clientWidth`. B-116 put
// `contain: layout` on admin's `<main>` so a correctly-wrapped table's own
// scroll region would stop Chromium's root-level scrollWidth walk — and it
// stops the walk either way. A wide table with NO `overflow-x-auto` wrapper
// overflows inside a containing block the document cannot see past, so the root
// stays at 320 and the assertion passes while the columns are unreachable by
// any means: not by scrolling the page, not by scrolling the table, not at all.
// That is strictly worse than the sideways scroll the check exists to catch,
// and seven admin tables were in exactly that state while every one of their
// routes was green (B-199).
//
// So ask a question the document is not the subject of: **is anything painted
// past the right edge of the screen that no scrollbar reaches?** That is what a
// reader actually experiences, it is measured per element rather than per
// document, and no amount of containment between the element and the root can
// hide it. The root check stays too — it is the criterion's own wording, it is
// one line, and it catches a page that scrolls for a reason no single element
// accounts for.
//
// ── What is deliberately NOT flagged, and why ───────────────────────────────
//
// The first version of this compared `scrollWidth > clientWidth` on every
// element instead. It is more sensitive and it was unusable: on seven routes it
// produced 60+ findings and not one of them was a defect.
//
//  - **`sr-only` text.** A 1×1 clipped box always has content wider than
//    itself; that is what visually-hidden means. Worse, `sr-only` is
//    `position: absolute`, and a `div.overflow-x-auto` here is `position:
//    static` — so an sr-only span inside a horizontally scrolled table is NOT
//    clipped by that scroll container, escapes to the nearest positioned
//    ancestor, and single-handedly pushed `<main>`'s scrollWidth to 675px on
//    the tenant profile. `<main>` then looked like the very defect this exists
//    to find, on a page that renders correctly.
//  - **The contents of a CLOSED `<details>`.** Chromium lays out
//    `content-visibility: hidden` subtrees, so the portal nav's collapsed
//    "Manage" menu reported six links overflowing a 45px column nobody can see.
//  - **Content inside a real scroll region.** The whole point of the wrapper.
//
// So: only elements a reader can actually see, and only where nothing scrolls
// to them. `checkVisibility` covers `display: none`, `visibility: hidden` and
// the skipped-subtree case in one call.
const EDGE_SLACK_PX = 1

async function offscreenOffenders(page: Page): Promise<string[]> {
  return page.evaluate((slack) => {
    const name = (el: Element) => {
      const classes =
        typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : []
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        classes.length ? `.${classes.slice(0, 4).join('.')}` : ''
      }`
    }

    // Reachable by scrolling something. A DOM-ancestor walk rather than a
    // containing-block one: what matters is whether the reader has a scrollbar
    // that brings this into view, and for everything in normal flow the two
    // agree.
    const scrollsHorizontally = (el: Element) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const { overflowX } = getComputedStyle(a)
        if (overflowX === 'auto' || overflowX === 'scroll') return true
      }
      return false
    }

    const visible = (el: Element) => {
      if (!(el as HTMLElement).checkVisibility?.({ contentVisibilityAuto: true, visibilityProperty: true }))
        return false
      const style = getComputedStyle(el)
      // Tailwind's `sr-only`. Both spellings, since the utility has used
      // `clip: rect(0,0,0,0)` and `clip-path: inset(50%)` in different majors.
      if (style.clipPath === 'inset(50%)' || /rect\(0px,\s*0px,\s*0px,\s*0px\)/.test(style.clip))
        return false
      return true
    }

    const offenders: Element[] = []
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right <= window.innerWidth + slack) continue
      if (!visible(el)) continue
      if (scrollsHorizontally(el)) continue
      offenders.push(el)
    }

    // The OUTERMOST offenders. A table that sticks out past the screen takes
    // every row, cell and link in it along; the element that needs the wrapper
    // is the one at the top of that chain, and the rest are the same defect
    // reported forty times.
    return offenders
      .filter((el) => !offenders.some((other) => other !== el && other.contains(el)))
      .map((el) => {
        // The text is what makes this findable. A class list says what the
        // element is made of; the words say which one on the page it is, which
        // is the difference between reading the failure and re-running the
        // check under a debugger (the same reason B-199 put axe's target
        // selectors in `assertNoAxeViolations`'s message).
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
        return `${name(el)} — right edge at ${Math.round(el.getBoundingClientRect().right)}px, screen is ${window.innerWidth}px${text ? ` — "${text}"` : ''}`
      })
  }, EDGE_SLACK_PX)
}

/// `condition` names what was being done to the page — "at 320px", "at 200%
/// zoom" — because the assertion is the same one three times over and the
/// failure has to say which pass produced it.
export async function expectNoHorizontalOverflow(page: Page, condition: string): Promise<void> {
  expect(
    await offscreenOffenders(page),
    `content is painted past the right edge of the screen with no way to scroll to it, ${condition}. The usual fix is the wrapper the rest of this codebase uses for a wide table: \`overflow-x-auto\` on the parent AND a \`min-w-\` floor on the table (B-199 — \`overflow-x-auto\` alone does nothing, because \`w-full\` sizes the table to the wrapper and the columns are crushed instead)`,
  ).toEqual([])

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
    `the page scrolls horizontally, ${condition}`,
  ).toBe(false)
}

// 1.4.12 Text spacing. The user-stylesheet values from the criterion itself.
// Content must not be clipped or overlapped when a reader forces them — the
// usual failure is a fixed-height button or a `truncate` that turns into lost
// words. One copy: `e2e/a11y.spec.ts` and `e2e/admin.spec.ts` each carried an
// identical one, differing only in indentation (B-201).
export const TEXT_SPACING = `* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }`
