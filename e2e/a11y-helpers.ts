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
export async function assertNoAxeViolations(
  page: Page,
  message = 'axe found accessibility violations',
): Promise<void> {
  const { violations, incomplete } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(violations.map((v) => `${v.id}: ${v.help}`), message).toEqual([])

  // Exemptions, all checked by hand rather than assumed, identified by axe's
  // own phrasing for the specific limitation rather than by a CSS target path
  // (which shifts if a component's classes ever do). A node inside a
  // third-party iframe (target path length > 1) is the one exemption that
  // isn't text-matched, since a target path there is never stable to begin
  // with.
  //
  // Two more surfaced the first time T2 ran this check outside the public
  // route loop (B-184):
  //
  // - "background gradient": `UnitStatusBadge`'s `unrentable` state layers a
  //   translucent hatch pattern over `bg-gray-100` so the six unit statuses
  //   stay distinguishable without relying on hue alone (1.4.1) — axe cannot
  //   compute an effective background through a `background-image` gradient.
  //   The badge sets no gradient on any other status, and `bg-gray-100` /
  //   `text-gray-700` is the same pairing used unadorned elsewhere.
  // - "only non-text characters": the checkout stepper's `✓` / step-number
  //   glyph (`components/checkout/stepper.tsx`) is a font-metrics limitation
  //   in axe, not a real ambiguity — the span sets no colour of its own, so it
  //   inherits whatever text colour the step's own label already renders in,
  //   the same text-on-background pairing `contrast-tokens.test.ts` already
  //   asserts meets AA.
  const HAND_CHECKED_INCOMPLETE = [
    /partially overlaps other elements/i,
    /background gradient/i,
    /only non-text characters/i,
    // B-90 part 3. The tenant profile's `<main>` carries `[contain:layout]`
    // (pre-existing, unrelated to this row) — opening a disclosure tall
    // enough to push the page well past one screen (the payment-plan
    // builder's per-installment grid is the first thing on this page to do
    // that) is what first exposed it: axe's `elmPartiallyObscured` check
    // gives up on an element far down a long page under CSS containment and
    // reports its background as merely "could not be determined by another
    // element" rather than actually finding one. Checked by hand —
    // `document.elementsFromPoint` at the flagged link's centre returns a
    // clean TD → TABLE → MAIN → BODY stack, nothing overlapping it at all.
    /partially obscured by another element/i,
    // B-187, migrating admin-leads.spec.ts onto this helper surfaced a second
    // instance of the SAME `[contain:layout]` limitation above — the lead
    // screen's quote table sits under an identically-marked `<main>`, and
    // axe's `shortTextContent` check gives up on its one- and two-digit
    // "Available" cells for the same reason `elmPartiallyObscured` gives up on
    // longer text under this container: it cannot resolve an effective
    // background through the containment box. Checked by hand the same way —
    // `document.elementsFromPoint` at each flagged cell's centre returns a
    // clean TD → TABLE → DIV → SECTION → DIV → MAIN → BODY stack, nothing
    // overlapping any of them.
    /too short to determine if it is actual text content/i,
  ]

  // Payment step, same session as the two above: Stripe's own Payment Element
  // splits into several `__privateStripeFrame…` iframes, each carrying the
  // identical title Stripe assigns them ("Secure payment input frame") — not
  // a page we author markup for. Matched on the frame's own `target` selector
  // (`iframe[name="__privateStripeFrameNNNN"]`) rather than `html`, which axe
  // truncates — a truncated snippet cut the "m" off "stripe.com" and the
  // first version of this exemption silently never matched. `target` is a
  // CSS selector, never prose, so it isn't subject to that truncation. A real
  // duplicate title on an iframe we DO control still fails: nothing here
  // matches by the generic "title is not unique" wording alone.
  const isThirdPartyFrame = (n: (typeof incomplete)[number]['nodes'][number]) =>
    n.target.some((t) => typeof t === 'string' && /stripeframe/i.test(t))

  const ownPage = incomplete
    .map((i) => ({
      ...i,
      nodes: i.nodes.filter(
        (n) =>
          n.target.length === 1 &&
          !HAND_CHECKED_INCOMPLETE.some((exempt) => exempt.test(n.failureSummary ?? '')) &&
          !isThirdPartyFrame(n),
      ),
    }))
    .filter((i) => i.nodes.length > 0)

  expect(
    ownPage.map((i) => `${i.id}: ${i.help}`),
    'axe could not decide these — check them by hand, then fix or exempt',
  ).toEqual([])
}
