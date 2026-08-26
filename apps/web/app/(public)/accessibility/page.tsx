import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { customerFacingExceptions, customerFacingStateExceptions } from '@/lib/a11y/scan-coverage'

export const metadata = metadataFor(
  'Accessibility',
  'Our accessibility target, what we test, and how to tell us when we get it wrong.',
)

/// The date the claims below were last checked against the build. A statement's
/// credibility rests on the record, not the intention — an undated one is a
/// claim about a codebase that has since moved. Update this when the claims are
/// re-verified, not when the page is edited.
const LAST_REVIEWED = '19 August 2026'

// PRD 01 §6.8 requires a public accessibility statement. Unlike the legal pages
// this describes our own conformance, so every sentence has to be true of the
// build that is deployed.
//
// B-093 rewrote it. An accessibility audit found four claims here that the code
// did not support: a visible focus indicator (the ring was 1.54–2.59:1 against a
// required 3:1), announced form errors (there was no error handling in the
// codebase at all), automated tests on "every page" (admin and this sign-in page
// were in no scan), and a manual screen-reader pass "before each release" (none
// had ever been recorded). Three are fixed; the rest moved down to the gaps
// section, which is where an unfinished thing belongs.
//
// An overstated accessibility statement is the first document quoted in a demand
// letter, and it converts a fixable bug into an alleged misrepresentation. When
// in doubt, claim less.
//
// Re-verified 2026-08-14, and it had gone stale in BOTH directions in twelve
// days — which is the lesson worth keeping. It disclaimed renting, paying and
// account management as "not built yet" when all three had shipped, so the page
// was publicly certifying that the money path had never been assessed. It
// understated form errors, which B-094 had since built properly. And it still
// claimed automated tests on "every page" plus recorded screen-reader passes,
// when `/messaging-policy` is in no scan, the sign-in and account-security
// pages are in none at all, checkout is scanned only in its "session not found"
// state, and PROGRESS.md's own B-093 entry says in as many words that the
// VoiceOver pass has never been run.
//
// This file is a claim about the codebase, so it goes stale on merges rather
// than on edits. CLAUDE.md's end-of-item checklist now names it for that reason.
//
// Re-verified 2026-08-14 again, after B-110, and it had gone stale in the
// UNDERSTATING direction within the same day: four of the six gaps listed here
// were the defects B-110 exists to fix, and leaving them would have publicly
// declared the money path broken in ways it no longer is. Removed, each against
// the code that closed it: step transitions now move focus to the step heading
// and announce the destination from a region that outlives the step; a resumed
// lease no longer repeats the page heading (`bodyOf`); the lease summary is
// named by its own `<h2>`; both payment submits use `aria-busy` with a
// pre-mounted "Taking payment" region instead of going `disabled` and silent;
// and every tick box or radio in the public site that CAN carry a validation
// error now carries it on the control — the rest cannot be wrong, which is why
// that bullet went rather than being narrowed. What is left of the hold
// countdown is the no-JavaScript case, and it is stated as exactly that.
//
// B-111 made one claim above TRUE that had been overstated since B-094. "A
// successful save is announced too" rested on `AdminForm` rendering its live
// region before the event it reports — which it did, styled `empty:hidden`,
// which is `display:none`, which kept it out of the accessibility tree until
// the instant it had text. That is the same "region that appears with the
// event" failure the region exists to avoid, and it applied to every form in
// the product. `gate-code-panel.tsx` had diagnosed it in B-105 and named the
// file; nothing changed it until now. The sentence stays because it is now
// accurate, not because it always was.
//
// Re-verified 2026-08-15, after B-119, and it had gone stale in the
// UNDERSTATING direction again: the three named gaps were exactly what B-119
// closed. `/messaging-policy` is scanned now, so is every sign-in and
// account-security page (`/login`, `/forgot-password`, `/reset-password`,
// `/unsubscribe`, plus `/mfa` and `/reauth` scanned signed-in), and checkout
// is scanned at every reachable step, not just "session not found". What is
// left of that gap is named precisely instead of dropped outright: the
// confirmation screen still is not scanned, because it only renders after a
// real Stripe redirect and there is no way to simulate a completed
// PaymentIntent from outside Stripe's own iframe. B-119 also found and fixed
// two real defects the wider scan turned up — 33 scrollable tables missing a
// keyboard stop, and two report pages nesting a stray `<p>` beside `<dt>`/
// `<dd>` inside a `<dl>` — neither of which had been exercised by any test
// before this pass, which is the whole reason coverage work like this earns
// its place here rather than being assumed complete once written.
//
// Re-verified 2026-08-17, after B-107 added a second map — this time the risk
// was OVERSTATING, and the first draft of this edit did it. It said the search
// map's price markers are "ordinary links you can reach with the Tab key",
// which is what the code intends and what nobody has watched happen: the map
// needs a billed vendor key that is not configured, so it does not render in
// production and the automated scan deliberately blocks the vendor script. A
// keyboard claim nobody has tested is exactly the sentence a demand letter
// quotes. It now says the map exists, says whose half is whose, and says the
// assessment is outstanding. The rest of the page was checked against the
// build and is unchanged: the confirmation screen is still unscanned, the
// no-JavaScript hold countdown still does not tick, and the staff lists are
// still unpaginated.
// Re-verified 2026-08-19, at B-091 part 2 and B-092. B-091 part 2 needed no
// change, and the reason is worth recording so the next reader does not
// re-derive it: the impersonation banner renders inside the tenant portal, but
// only during a support session, which no tenant can ever be in — so nothing a
// CUSTOMER sees moved. B-092 did need one, in the understating direction: it
// adds a FOURTH unpaginated staff-facing list (Support sessions), and a
// sentence naming three specific screens implies the fourth is fine. Named
// rather than paginated, because the list is small by construction — owner-only
// at seed, ten sessions an hour — and claiming less is this page's rule when in
// doubt.
//
// The public PRIVACY notice changed in the same pair of items and is a
// different page: B-091 part 2 drafted PRD 09 OQ-1's disclosure there,
// including that tenants are not notified when staff open their account.
//
// Re-verified 2026-08-20, at B-090b (tenant self-service transfer). It needed
// no change to the PROSE, and the reason is the part worth recording: the item
// ships a new customer-facing page, `/portal/transfer`, and this page's
// coverage claim names exactly one exception — the checkout confirmation
// screen. Shipping a second unscanned customer page would have made that
// sentence false in the OVERSTATING direction, silently, by merging rather
// than by editing. So the scan was extended instead of the sentence weakened:
// `e2e/portal-transfer.spec.ts` runs axe over the picker and the priced
// preview, plus a 200%-zoom reflow check. `LAST_REVIEWED` is deliberately NOT
// bumped — the coverage claim was re-checked against the build, the rest of
// the page was not, and a date is a claim about the whole page.
//
// Re-verified 2026-08-21, at B-137 (a transfer carries the tenant's protective
// state). No prose change, and the reasoning is the part worth recording so the
// next reader does not have to redo it. The item adds a customer-facing STATE
// rather than a page: `/portal/transfer` renders a refusal panel — a heading, a
// sentence and a back link, the same components as the "we don't see an active
// unit" state beside it — when the lease is in the lien pipeline. The route is
// already scanned by `e2e/portal-transfer.spec.ts`, so the coverage sentence
// below, which names PAGES outside the run, does not become false in either
// direction.
//
// Scanning that state specifically was considered and deliberately not done: it
// only renders for a `pending_auction` lease, the demo seed's one such lease
// belongs to a tenant with no portal credential, and minting one to scan a
// paragraph and a link is a fixture nobody else needs. **B-156 already owns the
// general gap** — post-interaction and data-dependent states are scanned almost
// nowhere — and that is the row that should close this, not a one-off here.
// `LAST_REVIEWED` is again NOT bumped: the coverage claim was re-checked, the
// rest of the page was not.
//
// Re-verified 2026-08-21, at B-138 (collections survive a transfer). No change,
// and no page or control changed either: the item moves invoices and ledger
// entries between two leases and teaches two nightly jobs where to read the
// ladder's position. What a tenant SEES is different — a transferred lease now
// shows the balance that came with them — but that is data rendered by screens
// already in the scan, not a new surface. Recorded rather than skipped because
// this page's rule is about merges making it stale, and "nothing customer-facing
// changed" is a claim worth having checked rather than assumed.
//
// Rewritten 2026-08-21 by B-139, which is the item this whole comment block has
// been predicting. The coverage sentence below is no longer written here: it
// renders `customerFacingExceptions()` from `lib/a11y/scan-coverage.ts`, where
// the scan lists the e2e specs loop over also live, and
// `tests/a11y-scan-coverage.test.ts` fails when a route under `app/` is in
// neither. The failure this closes was live at the time: `/portal/refer` is
// linked from the portal nav on every page, was in no scan, and was disclaimed
// by nothing, so the "exactly one exception" sentence was FALSE in the
// overstating direction while this comment block sat above it warning about
// exactly that. Four routes were added to the scan set (`/portal/refer`,
// `/portal/pay/done`, `/confirm-email`, `/checkout/resume/[token]`'s bad-token
// state) and the rest are now stated exceptions.
//
// `LAST_REVIEWED` is STILL not bumped, and that is the harder call. The date is
// a claim about the whole page, and the "where we fall short" list — the
// JavaScript-less hold countdown, the unpaginated staff lists, the two maps —
// was not re-verified here. The coverage claim is now continuously verified by
// a test and no longer needs a date; those three still do, and pretending
// otherwise would be the understating failure this page has also already made.
//
// Re-verified 2026-08-22, at B-148. No prose change, and this one is the
// OVERSTATING case caught rather than shipped. "A successful save is announced
// too" has sat in the list below since B-094 and was made honest for
// `AdminForm` by B-111 — but the two PUBLIC marketing forms, the waitlist
// notify-me and the quote/callback, are not built on `AdminForm` and were
// still rendering their `role="status"` only in the success branch. A region
// inserted already carrying its message is the exact failure B-111's own entry
// above describes, so the sentence was false on the two forms a prospect is
// most likely to be the first to use. B-148 moves both onto a shared
// `FormResult` that mounts the region empty at load and writes into it, and
// moves focus there because both replace themselves on success and were
// dropping it to `<body>` (2.4.3). The sentence stays as written and is now
// true of them too; `e2e/smoke.spec.ts` asserts the region pre-exists the
// submit for both, using B-156's `expectPreexisting`, so this cannot silently
// regress the way it did between B-094 and B-111. `LAST_REVIEWED` is not
// bumped, for the reason two entries above give.
//
// Re-verified 2026-08-22, at B-149 (checkout's unit-lost branch stops being a
// dead end). No prose change and none needed, in either direction. It adds no
// route — the coverage claim below is generated from routes under `app/` and
// `/checkout` was already scanned at every reachable step — and the controls it
// adds are the ones already covered: the waitlist form is the same `WaitlistForm`
// B-148 moved onto `FormResult`, so "a successful save is announced too" is true
// of it here for the reason it is true of it on the facility page, and the
// alternatives are plain links under an `<h3>` inside the existing `<h2>`
// section. What it does NOT get is a scan: the sold-out branch only renders for
// a lapsed session whose size has since gone, which is a post-interaction,
// data-dependent state — **B-156 owns that gap** and this is one more instance
// of it, not a new exception to declare. `LAST_REVIEWED` is not bumped, for the
// reason the entries above give.
//
// Re-verified 2026-08-22, at B-150 (AR aging names the instant it answers for;
// three report tables get their row headers). Nothing customer-facing changed —
// every surface it touches is under `/admin`, which this page does not make
// claims about — and no route was added, so the generated coverage claim is
// untouched. Recorded rather than skipped because this page's rule is about
// merges making it stale, and "staff-facing only" is a claim worth having
// checked rather than assumed. `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-22, at B-151 (an overlock no longer outlives its lease).
// Nothing customer-facing: the change is in the move-out, transfer, auction and
// nightly-delinquency services and raises a staff task. No route, no control, no
// copy. Recorded rather than skipped, per the rule two entries above.
// `LAST_REVIEWED` is not bumped.
//
// Corrected 2026-08-24 by B-159, and this is the OVERSTATING failure shipped
// rather than caught — the fourth review block found four claims in "How we
// check", two of them plainly untrue, and the entry is long because the shape
// of the mistake is the reusable part.
//
// (1) "they block a release if they fail" was FALSE. Every axe scan lives in
// the `e2e` lane of `.github/workflows/ci.yml`, gated on `main` or a non-draft
// PR, while `vercel.json` carries no `ignoreCommand` and there is no deploy
// workflow — so Vercel's Git integration builds and ships a push to `main` in
// PARALLEL with Actions and independently of its result. A failing scan has
// never stopped anything. Compounding it, CLAUDE.md's own always-open-as-a-
// draft rule means the lane does not run at all on the PR where the code is
// written. The owner chose to correct the sentence rather than build the gate
// (D-90): it now says where the tests run and says in as many words that they
// are not a release gate. Building the gate is a separate, costed decision and
// the row deliberately did not smuggle it in.
//
// (2) "We test by keyboard by hand" was UNRECORDED, which on this page is the
// same thing as untrue: PRD 02 §5.5 FR-24 defines "recorded" as a line in
// `docs/PROGRESS.md`, and there is none for any item. The screen-reader
// sentence beside it was correctly disclaimed and the keyboard one was not, so
// they are now one disclaimed sentence. It goes back to being a claim when a
// pass is recorded with its date, not before.
//
// (3) The generated exception list is route-keyed BY CONSTRUCTION — it filters
// an array of routes, so no post-interaction STATE can ever appear in it — and
// a list that reads as a complete account of gaps while being structurally
// unable to hold half of them is the same overstatement in a new form. One
// sentence now says it names pages. Enumerating the states is B-184 and this
// row deliberately did not wait for it: a true sentence today beats a complete
// list later.
//
// (4) "They also fail on checks the tool could not decide" held only for the
// public route loop in `e2e/a11y.spec.ts`. `smoke.spec.ts`, `portal.spec.ts`,
// `admin.spec.ts` and the rest destructure `violations` only — so every
// checkout step, the money path, was scanned without the `incomplete`
// assertion the page claimed for it. Scoped to the public pages, with the
// account and checkout named as collected-but-not-enforced. B-184 makes it
// true everywhere by lifting the assertion into the shared helper.
//
// `LAST_REVIEWED` is deliberately NOT bumped. These are retractions, and a
// retraction is not a re-verification — the date is a claim about the whole
// page, and the "where we fall short" list below was not re-checked here.
//
// Re-verified 2026-08-24, at B-161 (a returned payment no longer replays the
// whole delinquency ladder in one night). Nothing customer-facing: the change
// is in the nightly delinquency service and the reversal path, and the only new
// UI is two controls on `/admin/settings/delinquency`, which this page makes no
// claims about. No public route added, so the generated coverage claim and the
// route-keyed exception list are both untouched. Recorded rather than skipped,
// per the rule the B-150 entry states. `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-24, at B-162 (a transfer no longer re-prices to street,
// drops an in-flight increase or resets the ECRI clock). Nothing
// customer-facing in the sense this page makes claims about: the new UI is one
// select on `/admin/settings`, and a number input plus two `role="note"`
// warnings on the staff transfer wizard, all under `/admin`. **The tenant's own
// portal transfer request IS customer-facing and its quoted rate changes** —
// `portal/transfer.ts` quotes `preview.newRateCents`, which is now the policy
// figure rather than street — but that is a different number in an existing,
// already-labelled field, not a new control or a new route. No public route
// added, so the generated coverage claim and the route-keyed exception list are
// untouched. `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-24, at B-163 (proof of insurance keeps being monitored
// after a transfer). Nothing customer-facing: the change is in the transfer
// service and the nightly scan, and the one new page is
// `/admin/reports/protection`, which this statement makes no claims about. It
// IS added to `ADMIN_SCAN_ROUTES`, so `admin.spec.ts` scans it like every other
// admin page — the contract B-139 built exists so a new route cannot ship
// unscanned, and it caught this one. No public route added, so the generated
// coverage claim and the route-keyed exception list are untouched.
// `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-24, at B-164 (a lien-pipeline tenant can no longer
// schedule their own move-out). This one IS customer-facing —
// `/portal/move-out` gains a refusal panel — and it was built to this page's
// own standards rather than around them: `role="alert"` present at page load
// rather than inserted on submit (4.1.3 AA), the reason stated in text rather
// than a control that silently refuses (3.3.1 A), and nothing conveyed by
// colour alone (1.4.1 A). No route added and no existing claim affected —
// `/portal/move-out` was already in `PORTAL_SCAN_ROUTES`, so the new branch is
// inside a page the axe loop already covers. **The branch itself is a state,
// not a route**, which is exactly the route-list gap this page now names and
// B-184 owns: the scan will render the schedulable version of the page and
// never this one. `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-24, at B-165 (a rule-based rate increase is a step, not a
// jump to street). Nothing customer-facing: six controls added to
// `/admin/settings` and two columns to the worklist on `/admin/rate-increases`,
// both staff-only, and this page makes no claims about `/admin`. The notice a
// tenant receives is unchanged — only the figure inside it is smaller. No route
// added, so the generated coverage claim is untouched. Recorded rather than
// skipped, per the rule the B-150 entry states. `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-24, at B-171 (both public marketing forms stop being
// silent when they refuse). This one IS customer-facing, and it makes an
// existing claim more true without changing a word of it. The bullet below says
// a rejection's message "is tied to the field itself", and that "a successful
// save is announced too" — both were true before this item and both still are.
// What was missing is a claim this page never made: that a rejection is
// ANNOUNCED. `FormResult` wrote into its live region on the success branch only
// (`{success ? state.message : ''}`), so every error path on the waitlist
// notify-me and the quote/callback form left the region EMPTY and focus on the
// submit — indistinguishable, to a screen-reader user, from being accepted in
// silence. It writes on both branches now, moves focus either way, and renders
// a refusal in red rather than in the hardcoded green of a confirmation (1.4.1).
//
// The bullet is deliberately NOT strengthened to claim announced rejections.
// That would be a claim about every public form, and only these two are built
// on `FormResult` — checkout's steps render their own refusals. Making a
// sentence true everywhere before writing it is the order this page's own
// history says to use.
//
// Same session, same forms, found by the new test rather than by review: the
// quote/callback `Field` wrapped its hint AND its error inside the `<label>`,
// so the phone field was named "Phone Required if you would like a call back."
// at rest, and a refused email field was named "Email An email address or a
// phone number — we need one way to reply." — the refusal read out as the
// field's identity and then again as its description (2.4.6). Fixed to
// `htmlFor` plus siblings, which is the shape `WaitlistForm` beside it already
// used.
//
// Both refused states now carry an axe scan of their own in `e2e/smoke.spec.ts`
// — the first time either has been scanned, since a refusal is a STATE and the
// scan contract is route-keyed. That is B-184's gap, closed for these two
// states specifically rather than in general. No route added, so the generated
// coverage claim and the route-keyed exception list are both untouched.
// `LAST_REVIEWED` is not bumped: this is one flow re-checked, not the page.
//
// Re-verified 2026-08-24, at B-172 (checkout's unit-lost branch becomes usable
// and readable). Customer-facing, on the money path, and it CLOSES a gap two
// earlier entries declared rather than adding one.
//
// The B-149 entry above says the sold-out branch "does NOT get a scan" because
// it renders only for a lapsed session whose size has since gone — a
// post-interaction, data-dependent state that no route can be visited to reach
// — and hands the gap to B-156, which deferred it too. It is scanned now:
// `e2e/checkout-unit-lost.spec.ts` builds its own facility, two sizes and three
// units, starts a real checkout, takes the size to zero and back-dates the
// lock, then runs axe on the branch. That is one STATE covered, not the general
// problem — B-184 still owns route-versus-state — but the sentence about this
// particular branch is no longer a promise.
//
// What the branch itself gained: the sizes were raw glyphs, so a screen reader
// read the whole recovery path as "10 prime times 15 prime Standard, link"
// (2.4.4, 2.4.6) — fixed with the `aria-hidden`/`sr-only` pair three other
// files in this repo already use correctly. Each size is now a control with its
// own accessible name ("Move me to the 10 foot by 15 foot Large"), named on the
// BUTTON rather than only on the wrapping form, because no screen reader
// composes a form's label into its descendants' names. The outcome is announced
// by `CheckoutAnnouncer`, which already existed for exactly this transition and
// already moves focus to the step heading — it only had to learn that the size
// can now change as well as the unit, since "another unit the same size" would
// otherwise be the announcement contradicting the screen.
//
// No claim below changes and none needed to: this page makes no promise about
// which states are covered beyond the sentence saying they are not all covered,
// which is still true. No public route added, so the generated coverage claim
// and the route-keyed exception list are untouched. `LAST_REVIEWED` is not
// bumped, for the reason the entries above give.
// Re-verified 2026-08-25, at B-173 (the date you typed is the date that posts,
// on all four move-out and transfer screens). Two of the four are
// customer-facing — `/portal/move-out` and `/portal/transfer` — and this is a
// 3.3.4 Error Prevention (Financial) defect being closed, not one being
// introduced. The date picker sat in a separate `method="GET"` form; the
// requesting form carried a hidden copy of the URL, so a tenant who changed the
// date and pressed Request asked for the OLD one, having just been shown what
// the NEW one settles to. Nothing on the screen said the picker was inert until
// a second button had been pressed (3.3.2).
//
// The picker is a field of the requesting form now, and the request refuses
// while it and the priced date disagree, naming the date now in the control.
// Two smaller things came with it: each portal picker is a `Field`, so a
// refusal carries `aria-invalid` and `aria-describedby` rather than only
// appearing in the summary; and the submit restates the day it acts on in its
// own accessible name ("Request a move-out on September 5, 2026"), which is
// 2.4.6 for a button whose subject was several fields further up the page.
//
// No claim below changes and none needed to — this page has never made a
// statement about error prevention on the money path, which is itself worth
// noticing rather than quietly fixing: what it says about forms is that a
// rejection is tied to its field and a save is announced, and both are still
// true. No public route added, so the generated coverage claim and the
// route-keyed exception list are untouched. **The refusal is a STATE, not a
// route**, so no axe scan reaches it — the same route-versus-state gap B-184
// owns, and unlike B-171 and B-172 this item does NOT close it for its own
// states: the guard is asserted on the admin screen only
// (`e2e/admin-move-out.spec.ts`), and the two portal refusals are covered by
// the unit tests on `stalePreview` and by nothing visual. `LAST_REVIEWED` is
// not bumped.
// Re-verified 2026-08-25, at B-174 (the portal move-out preview stops vanishing
// in silence, and the date gets a ceiling). Customer-facing, on `/portal/move-
// out`, and like B-173 it closes a 3.3.1 defect rather than adding one: the
// page kept only the `ok` branch of the preview, so a refused date rendered a
// blank where the settlement had been while "Request this move-out" stayed live
// and pressable beside it. B-142 fixed exactly this on the sibling transfer
// screen and the fix never crossed one file.
//
// The refusal is a `role="alert"` mounted with the branch, the figures and the
// submit are gone together, and the submit is HIDDEN rather than disabled — a
// disabled control is not focusable and announces nothing, so a keyboard or
// screen-reader user meets silence where a sighted one at least sees something
// greyed out. The picker stays, because changing the date is the way out.
//
// **This one DOES scan its refused state**, unlike B-173 one row up:
// `e2e/portal-move-out.spec.ts` drives the refusal straight off the URL and
// runs axe on it. That is one more STATE covered, not the general problem —
// B-184 still owns route-versus-state — but the branch is no longer a promise.
//
// No claim below changes and none needed to. No public route added, so the
// generated coverage claim and the route-keyed exception list are untouched.
// `LAST_REVIEWED` is not bumped.
// Re-verified 2026-08-25, at B-175 (the signed lease states what a broken
// minimum stay costs, not only that there is one). Customer-facing — it is the
// document a renter signs at checkout — but nothing about it is a UI change:
// one merge field's wording branches on the facility's recapture policy, on a
// page this statement makes no claims about beyond the checkout it is reached
// through, which is already scanned at every reachable step. No route added, no
// control added, no new state. The change is a plain-language one, and it makes
// the agreement say the thing a tenant would otherwise first meet on a final
// invoice.
//
// Recorded rather than skipped, per the rule the B-150 entry states — a change
// to what a customer signs is worth a line here even when it moves no pixels.
// `LAST_REVIEWED` is not bumped.
//
// Re-verified 2026-08-25, at B-179 (a returned payment offers the pay route
// instead of a phone number). Customer-facing, on `/portal/documents`, and it
// STRENGTHENS the colour claim rather than testing it: the amount column showed
// the full payment as though it had landed while a sentence in another column
// said it had not, and the returned state is now on the figure itself in words.
// It also removes a 2.4.4 problem rather than adding one — "please call us" was
// an instruction with no link in it at all.
//
// The new controls are a `Link` to `/portal/pay` and a `CallLink`, both plain
// links with visible text; the pay link carries an `aria-label` naming the unit,
// because several returned rows would otherwise offer identically-named links.
//
// `/portal/documents` IS in `SCANNED_ROUTES`, so the page is scanned — but the
// returned row is a STATE that needs a bounced payment, and the demo seed
// creates no payments at all, so the scan reaches the ordinary rows only. That
// is the route-versus-state gap **B-184** owns, named here rather than left to
// be inferred from a green scan. No public route added, so the generated
// coverage claim and the route-keyed exception list are untouched.
// `LAST_REVIEWED` is not bumped.
//
// Corrected 2026-08-25 by B-184, closing two of the four B-159 findings above
// that said "B-184 makes this true" rather than building it in the same row.
//
// (3) The route-keyed exception list could never hold a STATE, and the page
// said so without saying what the states were — "not all covered" named a
// SHAPE of gap, not the gap. `SCANNED_STATES` / `STATE_EXCEPTIONS` in
// `lib/a11y/scan-coverage.ts` are the same contract one level down: a state a
// spec actually scans, tied to a `// a11y-state:` comment a unit test checks
// is still true, or a state genuinely blocked with a stated reason. The
// paragraph below now renders the second list instead of asserting a shape of
// gap exists. Not exhaustive — a route can have a state nobody has named yet,
// which is a real gap this pair does not close — but a name given IS checked,
// the same promise the route list already kept.
//
// (4) "Those undecided checks are collected but not yet enforced" inside your
// account and in checkout was true when written and is not any more:
// `assertNoAxeViolations` in `e2e/a11y-helpers.ts` is now the one function
// every axe scan in the suite calls, and it checks `incomplete` the same way
// everywhere rather than only in the public route loop that originated it.
// Eight spec files were destructuring `violations` on their own and asserting
// nothing about `incomplete` — the exact thing this sentence disclaimed, but
// stated as scoped rather than named as a gap. The carve-out is deleted
// rather than narrowed further, because there is nothing left for it to name.
//
// `LAST_REVIEWED` is not bumped: these two corrections were checked against
// the code that closes them, not the "Where we fall short" list below.
//
// Re-verified 2026-08-26, at B-090c (delinquency payment plans and
// self-cure). Ships one new customer-facing page, `/portal/payment-plan`, and
// the same discipline B-090b's entry above applied: the route is in
// `PORTAL_SCAN_ROUTES` (its "you're not on a plan" empty state is what any
// logged-in tenant without one actually sees, and needs no fixture to reach),
// so the coverage sentence does not go false in the OVERSTATING direction by
// silently merging in an unscanned page. What IS a state gap — the schedule
// TABLE, which only renders for a tenant with a real active plan, and the
// demo seed creates none — is named in `STATE_EXCEPTIONS` rather than left
// for the generic route scan to quietly not reach, the same shape B-179's
// entry above uses for a bounced-payment row. `LAST_REVIEWED` is not bumped:
// the coverage claim was re-checked against the build, the rest of the page
// was not.
//
// Re-verified 2026-08-26, at B-189 (autopay and payment plans). **No change is
// needed, and that is the finding rather than the absence of one.** The item
// ships no new customer-facing route: what it adds to `/portal/payment-plan`
// is one sentence telling the tenant whether their card will be charged on
// each date, and it renders only for a tenant with an active plan — which is
// the exact state `STATE_EXCEPTIONS` already names as unscanned, for the
// reason it already gives (no demo `PaymentPlan` exists). So the coverage
// claim goes false in neither direction: nothing unscanned is silently
// swallowed by the route list, and nothing already covered is disclaimed. The
// seed row that would close that exception is B-196's, not this row's.
// `LAST_REVIEWED` is not bumped: the coverage claim was re-checked against the
// build, the rest of the page was not.
export default function AccessibilityPage() {
  return (
    <ProsePage
      title="Accessibility"
      intro="We aim to meet WCAG 2.1 Level AA across every page and every flow. This page says how far we have actually got."
    >
      <Section heading="What we target">
        <p>
          Web Content Accessibility Guidelines (WCAG) 2.1, Level AA. That covers keyboard
          operation, screen-reader support, colour contrast, text resizing, and reflow on
          small screens.
        </p>
      </Section>

      <Section heading="What is true today">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Every page on this public site works with a keyboard alone, and the focus
            indicator meets the 3:1 contrast the guidelines ask for.
          </li>
          <li>
            Colour is never the only way we tell you something — a status shown in colour
            is also written in words.
          </li>
          <li>
            Text can be resized to 200% and the page reflows to 320px wide without
            sideways scrolling.
          </li>
          <li>Form fields have real labels, not just placeholder text.</li>
          <li>
            When a form rejects something you typed, the message is tied to the field
            itself, so a screen reader reads it out with that field rather than leaving you
            to hunt for it — and what you already entered is still there, so you fix the one
            thing we asked about rather than filling the form in again. A successful save is
            announced too.
          </li>
          <li>Animation respects your system&apos;s reduced-motion setting.</li>
          <li>
            Where we show a map, the information is given as text first and the map is
            collapsed behind a button you have to press. On a facility page that text is
            the address and a directions link; on search results it is the list of
            facilities itself, with distances and prices. You never need the map, and if
            one fails to load we say so rather than leaving an empty box.
          </li>
        </ul>
      </Section>

      <Section heading="How we check">
        <p>
          Automated accessibility tests run at both phone and desktop widths on every
          push to our main branch, and on every pull request that is open for review.
          They are not a release gate: a failing run tells us, it does not stop the
          deploy. They also fail on checks the tool could not decide, everywhere they
          run, so &ldquo;we did not test that&rdquo; cannot quietly read as &ldquo;that
          passed&rdquo;.
        </p>
        <p>
          They do not yet cover everything. These are the pages outside that run, and the
          reason each one is:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {customerFacingExceptions().map((exception) => (
            <li key={exception.route}>{exception.reason}</li>
          ))}
        </ul>
        <p>
          We would rather name each gap than let a general claim cover it. This list is
          generated from the same file the tests read, so a page that stops being checked
          appears here rather than quietly disappearing from both.
        </p>
        <p>
          That list names pages. Some screens also have states — an error message, a
          hold that has expired, a size that sold out while you were deciding — that only
          appear once you have done something on them. These are the ones we know are not
          covered, and why:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {customerFacingStateExceptions().map((exception) => (
            <li key={`${exception.route}-${exception.state}`}>{exception.reason}</li>
          ))}
        </ul>
        <p>
          More states than these probably exist that we have not found and named yet —
          unlike the page list above, this one cannot claim to be complete.
        </p>
        <p>
          Automated testing is a floor, not a ceiling — it catches roughly a third of real
          problems, and it cannot judge whether a screen reader says something that makes
          sense. <strong>Neither a full screen-reader pass nor a recorded keyboard pass
          has been carried out yet</strong>, so nothing on this page rests on one.
        </p>
      </Section>

      <Section heading="Where we fall short today">
        <p>
          This site is under active construction. These are the problems we know about, as
          of {LAST_REVIEWED}. If one of them blocks you, tell us and we will help you
          finish what you were doing by phone or email in the meantime.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Renting online without JavaScript.</strong> The whole checkout works
            with JavaScript turned off, but the countdown on the 30-minute hold does not:
            it shows the time left when the page was drawn and does not tick down, so if
            you are reading the lease when it runs out, the expiry can be the first you
            hear of it. With JavaScript on you are warned five minutes out and can extend
            the hold in one press.
          </li>
          <li>
            <strong>Our staff-facing screens</strong> have known problems. Long lists on Tasks,
            Leads, Delinquency and Support sessions are not paginated. No customer uses them,
            but we are not going to describe them as done.
          </li>
          <li>
            <strong>The maps we show are not fully accessible</strong>, and they are not
            ours to fix. A facility page embeds OpenStreetMap, whose zoom controls are
            named &ldquo;+&rdquo; and &ldquo;&minus;&rdquo; and whose marker has no text
            alternative. Search results can show a second map from a different provider,
            where we control the price markers but not the tiles or the vendor&apos;s own
            controls beneath them; we have not yet assessed that one against a live map,
            so nothing here rests on it. Both stay collapsed behind a button, and neither
            is ever the only way to get the information.
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">Last reviewed: {LAST_REVIEWED}.</p>
      </Section>

      <Section heading="Tell us when we get it wrong">
        <p>
          If something here blocks you, email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>{' '}
          or call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          . Tell us the page and what happened, and we will fix it and reply. An
          accessibility barrier is a bug, and we treat it as one.
        </p>
      </Section>
    </ProsePage>
  )
}
