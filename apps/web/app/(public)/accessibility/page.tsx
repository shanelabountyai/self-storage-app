import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { customerFacingExceptions, customerFacingStateExceptions } from '@/lib/a11y/scan-coverage'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export const metadata = metadataFor(
  'Accessibility',
  'Our accessibility target, what we test, and how to tell us when we get it wrong.',
)

/// The date the claims below were last checked against the build. A statement's
/// credibility rests on the record, not the intention — an undated one is a
/// claim about a codebase that has since moved. Update this when the claims are
/// re-verified, not when the page is edited.
// B-262 (D-122). **The statement now makes every one of its claims in a
// second language**, which is the only kind of edit to this page that adds
// claims without changing a single English one. Every sentence moved into
// `en.ts`/`es.ts` word for word — the English rendering is unchanged, and
// `npm run typecheck` refuses a key that exists in one dictionary and not the
// other, so the Spanish cannot silently fall behind the English the way a
// duplicated page would.
//
// **The two generated lists are translated too, and that was the decision.**
// The route and state exception lists are the page's promise to name every
// gap; rendering half of them in English to a Spanish reader would read as
// though the untranslated rows were the ones that did not matter. Each
// customer-facing row in `scan-coverage.ts` carries a `reasonEs` beside its
// `reason`, checked by `tests/a11y-scan-coverage.test.ts` — the admin rows
// deliberately carry none, because staff screens are English throughout.
//
// **No new claim, and one existing gap now covers more.** `/` | Spanish in
// `STATE_EXCEPTIONS` already said the scan loops carry no locale cookie and
// that the rest of the public site is scanned in English only; these three
// pages are part of "the rest", so the gap is named where it always was
// rather than growing a row per page. `LAST_REVIEWED` is not bumped — this is
// a translation, not a re-verification, and B-254 owns the date itself. It
// did change SHAPE, from '19 August 2026' to an ISO date formatted by `Intl`
// per locale: one constant still, rendered "19 August 2026" and "19 de agosto
// de 2026", with `timeZone: 'UTC'` so the date cannot slide a day west of
// Greenwich (B-228's class, and B-260 hit it again on /portal/methods).
//
// **`/messaging-policy` was in this item's scope and is deliberately still
// English.** It is the TCPA / A2P 10DLC disclosure a carrier and a regulator
// read, its keywords (STOP, HELP, START) are English by construction, and the
// consent a tenant actually gives is recorded against an English version
// constant — telling somebody in Spanish what they are agreeing to and then
// recording agreement to a different document is worse than not translating
// it. B-259 owns that, and it is blocked on a legal read.
//
// Re-verified 2026-09-04, at B-086 part 2 (phone unlock, D-122). Customer-
// facing and a new control, on a route this page already lists and already
// scans: `/portal/access` gains a section that turns a mobile key on, opens the
// gate, and turns it off again.
//
// **What was checked and what it cost.** The four criteria US-8 AC4 wrote for
// this control were built rather than retrofitted, because the default build of
// an unlock button fails all four: the in-flight state is `aria-busy` on a real
// `<button type="submit">` (4.1.2, 2.1.1) with the label changing in TEXT, so
// nothing about the state is colour (1.4.1); the outcome is announced from
// `AdminForm`'s pre-existing `role="status"` on success and its `role="alert"`
// box on a refusal, never a toast (4.1.3); and a refused unlock names the
// facility's phone number in words, because the failure state of this control
// is somebody standing outside a gate. `aria-pressed` was deliberately NOT
// used, though the AC offers it: this is a momentary action, and a button
// reported as "pressed" tells a screen-reader user the gate is being held open.
//
// **One real defect found by writing the e2e, not by review.** The enrol form
// and the unlock form are conditional siblings in one slot, so React
// reconciled the first into the other and carried its `useActionState` across:
// "Phone unlock is on for this gate" appeared in the UNLOCK form's status
// region as though the gate had just opened. Keys fixed the identity, and the
// two forms that remove themselves on success now announce through
// `AnnounceRegion` (B-170's case) rather than into a region the revalidation
// unmounts in the same commit.
//
// **The new STATE is scanned, not promised.** `/portal/access | phone unlock
// refused` is in `SCANNED_STATES` and `e2e/portal.spec.ts` runs axe on it, so
// the branch that matters — what the page looks like when the gate does not
// open — is audited rather than assumed. B-184 still owns route-versus-state in
// general.
//
// No public route added, so the generated coverage claim and the route-keyed
// exception list are untouched. **The "where we fall short" list needed no
// change and was re-read to be sure** — none of its three entries is about the
// portal, and this row adds no known gap to it. The screen-reader and keyboard
// sentence above it stays exactly as it is: no manual pass was carried out
// here, and this control does not rest on one. `LAST_REVIEWED` is not bumped —
// this is one flow verified, not the page, and B-254 owns the date itself.
/// Stored as an ISO date rather than as English prose, so one constant can be
/// rendered in either language. `timeZone: 'UTC'` is load-bearing: without it
/// `new Date('2026-08-19')` is UTC midnight rendered in the server's zone, and
/// anywhere west of Greenwich the page dates itself the 18th.
const LAST_REVIEWED = '2026-08-19'

function reviewedOn(locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${LAST_REVIEWED}T00:00:00Z`))
}

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
// Re-verified 2026-08-27, at B-191 (a payment plan tells the tenant what is
// happening to it). Customer-facing twice over: the portal dashboard card, and
// four emails a tenant receives about money they owe.
//
// **One exception is ADDED, and it is a pre-existing gap being declared rather
// than a new one being created.** `/portal` has carried a payment-plan card
// since B-090c, in a state no scan has ever reached — the card renders only for
// a tenant with a plan, and the demo seed creates none — and unlike the
// schedule table on `/portal/payment-plan`, that state was never named in
// `STATE_EXCEPTIONS`. This item changes that card (it now also renders for a
// BROKEN plan, and it distinguishes a missed payment from the next one in
// words), so leaving the gap undeclared while editing it would be the
// overstating direction. It is declared now; B-196's seed row is what closes
// both it and its twin.
//
// **What the card itself is built to.** The three states are told apart by
// words, never by colour (1.4.1 A) — "Your payment plan has ended", "A payment
// on your plan was missed" — and the region is server-rendered and present at
// page load rather than inserted on change (4.1.3 AA), which is why it stays a
// `role="status"` and not an alert.
//
// **The emails.** FR-9a's criteria now hold for every templated message this
// product sends, not only the generated report kind B-084 part 3 built them
// for: `renderEmail`'s text-only fallback was one `<p>` of the whole body with
// `<br>`s in it and the merged values interpolated raw, and it is now a
// language-declared wrapper with the subject as a single `<h1>`, one `<p>` per
// block, and every value escaped. What is NOT met is the one criterion that
// needs an HTML body of its own: the agreed-plan schedule is a numbered list
// rather than a `<table>` with a `<caption>` and `<th scope>`, because a
// seeded `bodyHtml` would be erased by the first save through CN-16's editor,
// which writes `bodyHtml: null` unconditionally. That is written down in
// PROGRESS and raised as its own row rather than half-built here.
//
// **No claim below changes.** This page says nothing about email, which is
// worth noticing rather than quietly fixing — it is a statement about the site.
// `LAST_REVIEWED` is not bumped: the coverage claim was re-checked against the
// build, the rest of the page was not.
// Re-read 2026-08-27, at B-192 (the payment-plan builder). **No change, and
// the reason is that nothing this row touched is customer-facing**: the whole
// item is the staff tenant profile — the builder and cancel control moved into
// `Actions` per D-95, six installment groups given real `<fieldset>`/`<legend>`
// names, and the schedule's refusals re-keyed onto the installment that caused
// them. This page is a statement about the SITE a customer uses, so a staff
// screen changing does not put any sentence on it in either direction. The
// exception B-191 added for `/portal`'s payment-plan card still stands and is
// still B-196's to close. `LAST_REVIEWED` does not move.
// Re-read 2026-08-27, at B-193 (the tenant's plan page has more than one way
// in). Customer-facing: a portal nav entry, and the plan page itself now
// rendering broken, cancelled and completed schedules rather than only the
// live one.
//
// **No route is added and no claim on this page moves — but one exception's
// WORDING was going false in the overstating direction, so it is widened
// rather than left.** `STATE_EXCEPTIONS` declared the unscanned state as the
// "active plan schedule"; the page now renders a schedule for every plan a
// tenant has ever had, and the nav entry that reaches it renders on EVERY
// portal route. All of that sits behind the one fixture that does not exist
// (no demo `PaymentPlan`), so it stays one exception — but "active plan"
// would have implied the other three states were covered when nothing scans
// them. B-196's seed row closes it, along with its `/portal` twin.
//
// **What the page is built to.** Two routes in satisfies 2.4.5 Multiple Ways
// (AA) — the dashboard card while a plan is live, the nav entry whenever the
// tenant has any plan at all. Every status is a sentence and never a colour
// (1.4.1 A), and each one says what it costs the tenant today rather than only
// what happened. The schedule stays a real `<table>` with a `<caption>` naming
// the unit and the date agreed, and `<th scope="col">` on all four columns.
// `LAST_REVIEWED` is not bumped: one flow re-checked, not the page.
//
// Corrected 2026-08-27 by B-196 (the scan contract IV), and this is the
// OVERSTATING direction caught before a customer read it rather than after.
//
// **One sentence on this page was not true.** "They also fail on checks the
// tool could not decide, everywhere they run" — added by B-184 (finding 4)
// and correct about the eight spec files it was written for — was false about
// four checks. `e2e/a11y-helpers.ts` held four regexes matched against axe's
// `failureSummary` on EVERY route in the suite, each earned by a hand check of
// ONE element on ONE screen: B-118's sticky Rent-now bar, the unrentable
// badge's hatch pattern, the checkout stepper's glyph, the tenant profile
// under `[contain:layout]`. Every one of those hand checks was done properly
// and none is re-litigated here — but a waiver scoped to nothing suppressed
// its whole check product-wide, including over a genuine overlap on a page
// nobody had looked at. They are keyed to the route (and, for the one that
// needs it, the state) they were checked on now, the same way `SCANNED_STATES`
// keys everything else, and the page says so in a sentence of its own rather
// than leaving the earlier claim to carry a hole.
//
// **Four state exceptions become scanned states, and two are narrowed rather
// than deleted.** Every payment-plan surface in the product — the portal
// schedule and the nav entry that reaches it, the dashboard card, the staff
// halted table and the delinquency queue's halted section — rendered only for
// a lease under a hold, and the demo seed placed none, so four of them were
// scanned in their empty state and declared. The answer named in every one of
// those declarations was a SEED, not another exception, and it is here: an
// agreed plan on its own demo tenant (`pia@demo.example.com`, deliberately not
// Dana, whose lease four suites need chased). What that fixture cannot hold
// still is a plan that has BROKEN — a missed installment moves the moment the
// nightly jobs run — so the two ended-plan states stay declared, narrowed to
// what is actually unreached instead of being quietly folded into the merge.
//
// **The two new admin states are not on this page** and are not meant to be:
// the profile's plan schedule and a refused submit of the six-installment
// builder are staff screens, and this is a statement about the site a customer
// uses. They are in `SCANNED_STATES` where the unit test can check them.
//
// `LAST_REVIEWED` is not bumped: the coverage claim and one sentence about how
// the run works were re-checked against the build, the rest of the page was
// not.
//
// ── B-197 (2026-08-28) ──────────────────────────────────────────────────────
//
// **Nothing on this page changes, and that is the finding rather than the
// omission.** `/admin/settings/roles` is where an owner sets how much each
// staff role may waive, refund, credit or defer — five forms and a table, every
// one of them behind `users:manage`, and no customer reaches any of it. This
// page is a statement about the site a customer uses, so it makes no claim
// about `/admin` to keep true here. The route IS added to `ADMIN_SCAN_ROUTES`,
// so `admin.spec.ts` scans it like every other admin page and the B-139
// contract still refuses a route that appears in neither list.
// ── B-199 (2026-08-28) ──────────────────────────────────────────────────────
//
// **No sentence changes, but this row came closer to one than any admin-only
// item so far, and the reason it does not is worth stating.** The claim above
// — "the page reflows to 320px wide without sideways scrolling" — is the exact
// criterion B-199 found broken, and it was broken on seven staff tables whose
// action links sat outside a 375px document. This page is a statement about
// the SITE a customer uses, so an admin table is out of its scope in the
// ordinary way.
//
// What had to be checked before leaving the sentence alone is the MECHANISM,
// not the scope. B-199's real finding is that the 320px assertion can pass for
// the wrong reason: `[contain:layout]` stops Chromium's root-level
// `scrollWidth` walk at the containing block, so an unwrapped wide table
// overflows somewhere `document.documentElement.scrollWidth` cannot see, and
// the check reports 320 while the columns are unreachable. If that containment
// were anywhere on the public site, this sentence would be resting on a check
// that cannot fail — which is worse than an untested claim, because it reads
// as evidence. It is not: `[contain:layout]` appears on `admin/layout.tsx` and
// nowhere else in the product, verified by grep. The public reflow claim is
// still carried by an assertion that can genuinely go red, so it stands.
//
// `LAST_REVIEWED` does not move. The reflow claim was re-checked against the
// build; the rest of the page was not.
//
// Re-read 2026-08-28, at B-198 (the email template's second body is deleted).
// Nothing a customer touches on this SITE changes — but the B-191 entry above
// is a statement about what this product's emails do and do not meet, and this
// item makes half of it false, so it is corrected here rather than left to
// read as current.
//
// **What that entry said, and what is now true.** It said the agreed-plan
// schedule is a numbered list rather than a `<table>` with a `<caption>` and
// `<th scope>`, "because a seeded `bodyHtml` would be erased by the first save
// through CN-16's editor". `MessageTemplate.bodyHtml` no longer exists. The
// schedule is a real table with a caption and both header scopes, rendered
// through the same `tableHtml` a generated report email uses, and the text
// part is still the numbered list — both built from the one array of
// installments rather than either being derived from the other, which is the
// half of FR-9a that a hand-maintained HTML twin loses first. CN-24's email
// criteria are met in full.
//
// **The claim that is NOT made.** These are still emails, and this page says
// nothing about email in either direction — no sentence below is added,
// because a client's rendering of a message is not the site, and a page that
// starts certifying outbound mail acquires a claim nobody re-checks. The
// record lives in PROGRESS and in `render.ts`.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// Re-read 2026-08-31, at B-207 (the chased/halted split reaches the roll-up,
// the emailed report and the month-end close). **No change, and nothing
// customer-facing:** every surface is behind `reports:financial` — the AR table
// on `/admin/reports`, the aging table on `/admin/reports/delinquency`, the
// dashboard's Money owed tile, the scheduled delinquency email a staff
// subscriber receives, and the accounting close pack. No public or portal route
// is added or altered, so the generated coverage claim and the route-keyed
// exception list are both untouched.
//
// Two things worth naming rather than leaving implied. The aging table is now
// ONE shared component rendered on two admin screens, which means an accessible
// name, a row header or a scroll container fixed in one place is fixed in both
// — and, equally, a defect in it is now a defect on two screens. And that
// component still attaches each facility's name with `scope="rowgroup"`, which
// **B-216 has already established no screen reader implements**; this row moved
// that markup and deliberately did not fix it, because B-216 owns the remedy
// and half-fixing it here would leave the two screens disagreeing until that
// row lands. Recorded so B-216 is read as covering the shared component rather
// than only the page it was raised against.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// Re-read 2026-08-31, at B-208 (a payment plan stops covering for rent it never
// deferred). **No change.** The item is a nightly job, one new event and one
// new email template; it renders no route, no state and no control. Nothing on
// the public site or the portal is added or altered, so the generated coverage
// claim and the route-keyed exception list are both untouched.
//
// The one thing worth naming: this ships a SIXTH payment-plan email, and the
// B-198 entry above settled that this page says nothing about email in either
// direction — a client's rendering of a message is not the site, and a page
// that starts certifying outbound mail acquires a claim nobody re-checks. That
// stands, and it is why a new template adds no sentence here. The template's
// own FR-9a record is in `render.ts` and in PROGRESS, where B-198 put it.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// ── B-201 (2026-08-28) ──────────────────────────────────────────────────────
//
// Re-read at B-201 (the reflow check that `[contain:layout]` cannot mask).
// **No sentence changes, and unlike B-199 this row DID ship customer-facing
// markup, so that needs saying rather than assuming.**
//
// **What reached a customer page.** The fix is `min-w-0` on `Field`'s wrapper,
// and `Field` is not an admin-only component — `/checkout`, `/reservations`
// and eight portal pages import it. So the change landed on the very pages the
// sentence below is about. It was re-run rather than reasoned about: the
// public and portal loops were measured at 320px, at 200% zoom and under
// forced text spacing against the build, and are green. The claim is
// re-checked, not merely still written down.
//
// **Every DEFECT found was on `/admin`** — six overflowing `<select>` wrappers
// and one unbreakable environment-variable name, on four staff routes this page
// makes no claim about. Nothing below was false and nothing below becomes true.
//
// **What changed is what CARRIES the sentence, which is the part worth
// recording.** The B-199 entry above argued the public reflow claim was safe
// because `[contain:layout]` sits on `admin/layout.tsx` and nowhere else, so
// the public assertion could still genuinely go red — an argument that was
// correct and that had to be re-made by grep every time somebody added a
// containing block. The public loops no longer rest on it: they ask, per
// element, whether anything is painted past the right edge of the screen that
// no scrollbar reaches, which no containment between that element and the root
// can hide. The sentence is now carried by a check whose validity is not a
// property of some other layout file.
//
// **One gap named rather than left implicit.** `/portal/pay` and
// `/portal/transfer` are customer-facing, and until this row they had never
// been checked at 320px, at 200% zoom or under forced text spacing by
// anything — B-156 gave them an axe scan in their own specs and only an axe
// scan. Both now pass all three. No sentence here enumerates which check
// reaches which route, so nothing on the page was false; but "automated tests
// run at both phone and desktop widths" was true of the axe scan on those two
// routes and not of the width checks, and that is the kind of distance between
// a general claim and its coverage this page exists to refuse.
//
// `LAST_REVIEWED` does not move: the reflow claim was re-checked against the
// build and the rest of the page was not, which is the rule the B-150 entry
// states.
//
// ── B-129 (2026-08-29) ──────────────────────────────────────────────────────
//
// Re-read at B-129 (the auction lot sheet). **Nothing on this page changes, and
// nothing on it should.** Everything this row shipped is behind `auctions:approve`
// or `facility:settings`: a section on `/admin/auctions`, a terms-of-sale form
// on `/admin/settings/delinquency`, and a staff-only CSV route. No customer
// reaches any of it, and this page is a statement about the site a customer
// uses — the same reasoning as the B-197 entry above.
//
// The routes are not left unchecked, though. Both screens are already in
// `ADMIN_SCAN_ROUTES`, so `admin.spec.ts` scans the new markup for WCAG
// violations and — since B-201 — measures it at 320px, at 200% zoom and under
// forced text spacing, with the per-element check that `[contain:layout]`
// cannot mask. The refusal list is a `<ul>` of links with the reason as text
// beside each one, so it is not carrying meaning in colour or position.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// Re-read at B-203 (a manual payment reaches the plan, not this month's tax).
// **Nothing on this page changes — but unlike the B-129 and B-197 entries
// above, this row IS customer-facing, so the reason has to be different.** It
// is not that no customer reaches the change; a tenant paying in the portal
// reaches it every time. It is that what changed is where the cents land, not
// a pixel of markup: no route, no state, no control, no message, no colour.
// `/portal/pay` is already scanned by `e2e/portal.spec.ts` and by
// `a11y-own-spec-routes.spec.ts`, and its own claims here — the pre-mounted
// "Taking payment" region, the field-level refusals — are untouched.
//
// Worth saying plainly, because the customer-facing test is about the customer
// rather than about the DOM: the tenant-visible effect of this row is that a
// plan reads as paid when the tenant has paid it. That is a correctness claim
// about money, and this page deliberately makes none — it is a statement about
// whether the site can be operated, not about whether it is right.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.//
// Re-read at B-205 (the lot sheet carries what an advertisement has to carry).
// **Nothing on this page changes**, and it is the B-129 reasoning unchanged:
// every surface this row touched is behind `auctions:approve`, `tenants:edit`
// or `facility:settings` — two columns and a filename on a staff-only CSV, a
// time-of-sale field on `/admin/settings/delinquency`, a description field on
// the auction case screen, and two notes on `/admin/auctions`. No customer
// reaches any of it.
//
// One thing IS worth naming rather than leaving to the B-129 sentence above.
// That entry said the new markup is scanned because both screens are in
// `ADMIN_SCAN_ROUTES` — true of the routes, and B-215 has since found it is
// not true of the STATE: `/admin/auctions`'s populated lot-sheet branch has
// been rendered by no scan, because the demo seed schedules no sale. The notes
// this row adds sit inside that same unscanned branch. That is a pre-existing
// gap this row neither creates nor closes, and B-215 owns it by name; it is
// recorded here so the B-129 sentence is not read as more coverage than it is.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// ── B-210 (2026-08-31) ──────────────────────────────────────────────────────
//
// Re-read at B-210 (a tenant one day late is told their plan is dead).
// **Customer-facing, and it adds a state to two portal screens — so the
// declared exceptions are WIDENED rather than left, and nothing else moves.**
//
// **What reached a customer page.** `/portal`'s plan card gains a third
// warning state ("A payment on your plan is late", with the pay-by date and a
// pay link carrying the installment amount) and loses its permanent one — the
// card is now suppressed once the lease owes nothing, so "Your payment plan
// has ended… the full balance above is due now" no longer renders forever over
// a $0.00 balance. `/portal/payment-plan`'s schedule gains a "Late — pay by
// <date>" row status.
//
// **Both are told apart by WORDS, not colour (1.4.1 A)** — the same rule the
// B-191 entry above records for this card, and the reason the late row is a
// sentence with a date in it rather than an amber cell. The card is still a
// server-rendered `role="status"` present at page load rather than inserted on
// change (4.1.3 AA); a plan going from live to late is not something that
// happens while the tenant is looking at the page.
//
// **Two exceptions in `STATE_EXCEPTIONS` are widened, in the understating
// direction.** The `/portal` card exception named "the two warning states" and
// there are now three; the `/portal/payment-plan` exception covered only ENDED
// plans, and the late and missed ROW states of a live one were never named at
// all. Both need an installment whose date has actually gone by, which the
// demo seed deliberately does not create (a past installment would be broken
// by the nightly job on a schedule nobody controls, so the fixture would show
// a different thing depending on when the jobs last ran — the B-193 entry
// above settled that). Declared, not closed.
//
// **The emails are again out of scope of this page**, per the B-198 and B-208
// entries: two plan templates now state D-98's grace window instead of "miss
// it and the plan ends", and this page says nothing about outbound mail in
// either direction.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.
//
// ── B-214 (2026-08-31) ──────────────────────────────────────────────────────
//
// Re-read at B-214 (this page's own hand-check sentence). **This row exists
// because a sentence here was false, so unusually the page IS the change.**
//
// "Each of those is waived only on the page it was checked on" described ONE of
// three waiver paths. `HAND_CHECKED_INCOMPLETE` is genuinely route-keyed and
// the sentence was true of it. `VERIFIED_BY_HIT_TEST` waives two checks on
// EVERY route and re-proves them per node — better engineering than a route
// list, and not what the sentence said. And `if (n.target.length !== 1)` in
// `assertNoAxeViolations` dropped every undecided node inside ANY iframe, on
// every route, under a comment describing a Stripe-specific waiver. Three
// bullets now, one per path, each saying what it actually promises.
//
// **Two of the three were also narrowed, not just described.** The hit test
// waived a node whose centre point is off-screen; that is the case axe cannot
// decide only where a scrollbar brings the node back, so it now asks
// (`scrollsHorizontally`) instead of assuming. Off-screen with nothing to
// scroll is B-199's case — unreachable by any means — and 1.4.3 and 1.4.11 were
// silently unenforced on exactly those nodes. The iframe drop is now scoped to
// a frame whose `src` is cross-origin (Stripe's Payment Element; the Google
// Maps embed behind "Show map"), so a same-origin frame we author is checked
// like any other markup. Neither narrowing can waive MORE than before.
//
// **The "everywhere they run" sentence** was three clauses deep and is now
// plain: a check the tool cannot decide fails the run as well, on every page in
// it. Every commitment it carried is still made.
//
// **No route, state or exception list moves**, and no page's coverage changes —
// the waivers got smaller, which can only turn a scan red, never green.
//
// `LAST_REVIEWED` does not move: this corrects a description of the mechanism
// to match the mechanism. No claim about a page was re-checked against the
// build.

// ── B-215 (2026-09-01) ──────────────────────────────────────────────────────
//
// Re-read at B-215 (the layout checks reach routes but never states).
// **Nothing on this page changes, no markup shipped, and the row's own
// prediction of a defect was wrong — which is the part worth recording.**
//
// **What was actually open.** B-201 gave the 320px / 200%-zoom /
// text-spacing loops to `SCANNED_BY_OWN_SPEC` and not to `SCANNED_STATES`.
// `portal.spec.ts` runs its layout loops as Dana, who has no plan, so
// `/portal/payment-plan` was measured in its EMPTY state and the plan-tenant
// block ran axe and nothing else. Both customer-facing plan surfaces — the
// four-column installment schedule and the dashboard plan card — had been
// scanned since B-196 and measured at no width by anything. Same distance
// between a general claim and its coverage the B-201 entry above names: the
// sentence below was true of the axe scan on those two surfaces and not of
// the width checks.
//
// **They are measured now, and they were already green.** A `STATE_REACH`
// table in `e2e/a11y-own-spec-routes.spec.ts`, keyed by the same
// `route | state` string `SCANNED_STATES` uses, reaches both by signing in as
// the plan tenant and going to the page, then runs the same three passes.
// **The backlog row expected a defect here and there is none**: the schedule
// is a bare `w-full` table with no scroll wrapper, four columns of dates and
// money, and at 320px under forced text spacing it fits. No wrapper was added
// — `overflow-x-auto` alone does nothing (B-199), and pairing it with a
// `min-w-` floor would MANUFACTURE a sideways scroll on a page that has none
// today, which is worse for the tenant reading it on a phone. The measurement
// stands in place of the prediction: with `min-w-2xl` forced onto that table
// as a probe, the new check failed at 320px exactly as it should, so what is
// recorded here is a check known to bite, not a green result taken on trust.
//
// **The contract runs one way only, and says so.** `STATE_REACH` asserts each
// of its keys names a real `SCANNED_STATES` entry, so a renamed state fails
// rather than quietly measuring nothing. It does NOT assert the reverse: most
// scanned states are reached by a submit or a disclosure rather than a `goto`,
// and claiming this file covers them would be the overstatement the two lists
// exist to stop.
//
// **One admin state declared rather than left implicit.** `/admin/auctions`
// renders "no sale here is ready to advertise" against demo data, so the lot
// sheet's populated branch — B-129's download link and B-205's per-lot
// missing-description note — is rendered by no scan and was in neither list.
// It is a `STATE_EXCEPTIONS` row now, `audience: 'admin'`, so it does not
// print on this page: a visitor is owed an honest account of the surfaces THEY
// use, and this is not one.
//
// `LAST_REVIEWED` does not move: no claim about a customer page changed, and
// the two surfaces newly measured were measured against the build rather than
// reasoned about — but neither is named in a sentence here, so nothing below
// was false before and nothing below becomes true now.
// ── B-216 (2026-09-01) ──────────────────────────────────────────────────────
//
// Re-read at B-216 (the aging report's `scope="rowgroup"` facility header).
// **Nothing on this page changes, and nothing on it should — but one comment
// ABOVE it has gone false, and correcting it is the point of this entry.**
//
// The B-207 entry says the shared aging component "still attaches each
// facility's name with `scope="rowgroup"` ... this row moved that markup and
// deliberately did not fix it, because B-216 owns the remedy". B-216 has now
// landed, so read that paragraph as history: the facility is carried in each
// row's own `<th scope="row">` — visually hidden, beside the label the row
// already had — and the spanning cell is a plain `<td>` that exists to be
// seen. `scope="rowgroup"` is gone from that component. The comment is left
// standing rather than edited because it records what was true when it was
// written, which is how every entry on this page works.
//
// **The sentence that was deleted matters more than the markup that changed.**
// The old comment asserted the halted row announces as "Cedar Park, Halted,
// 61–90 days". Nobody had heard that, and it was not even structurally true —
// NVDA, JAWS and VoiceOver each implement no `rowgroup` scope. The replacement
// claims only structure: every figure has a row header, in the row it belongs
// to, naming both the facility and which half of the split it is. **No
// announcement is asserted and none was observed.** This page's whole method is
// that a claim nobody re-checks goes false quietly, and a claim about a screen
// reader nobody has run is that failure in its purest form.
//
// **Not customer-facing.** `ArAgingSplitTable` renders on `/admin/reports` and
// `/admin/reports/delinquency`, both behind `reports:financial`. No public or
// portal route is added or altered, so the generated coverage claim and both
// exception lists are untouched — the same reasoning as the B-129 and B-197
// entries above.
//
// **One sibling instance found and deliberately not fixed here**, raised as
// B-222 instead: `/admin/reports/revenue` uses the same `scope="rowgroup"`
// construct, and unlike the aging table it has no per-row header at all to fold
// the facility into — every one of a facility's fourteen figures sits in a row
// whose only identity is a `<span>` inside its first money cell. The remedy is
// a visible row-label column, which is a design call rather than a markup one.
// Named rather than half-fixed, because the `headers`/`id` alternative would
// trade the claim just removed for a second one this repo equally cannot watch.
//
// **One runnable check**, in `e2e/admin.spec.ts` beside the assertion that the
// split's halves tie out: the halted row's `rowheader` is named for the
// facility, not just "Halted". Reverting the fix is a one-line deletion whose
// only visible effect is markup nobody looks at, so it gets a test rather than
// a comment. Verified by deleting that line and watching the assertion fail.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.

// ── B-220 (2026-09-01) ──────────────────────────────────────────────────────
//
// Re-read at B-220 (the two month-turn defects in the reports section).
// **Nothing on this page changes, and nothing on it should.** Every file the
// item touched is under `/admin` — the report date-range parser, the management
// pack, the gate-activity and support-session logs, the facility switcher's
// type, and the demo seed. No public or portal route is added or altered, so
// the generated coverage claim and both exception lists are untouched. Same
// reasoning as the B-129, B-197 and B-216 entries above.
//
// One thing worth naming, because it is the kind of change that LOOKS like it
// reaches a customer and does not: D-109 moved every report's default window to
// the last complete calendar month, and a tenant sees no report. The one
// customer-facing surface that renders a date range — a portal statement — goes
// through `monthBounds` on the lease's facility, not through `reportRange`, and
// was not touched.
//
// `LAST_REVIEWED` does not move: no claim on this page was re-checked against
// the build, and none changed.

// ── B-217 (2026-09-01) ─────────────────────────────────────────────────
//
// Re-read at B-217 (the stacked leases card and the scroll affordance).
// **No sentence changes, and unlike B-199 this row does reach two customer
// pages — which is why it was checked rather than waved through on "admin
// only".** The stacked card is on the staff tenant profile and makes no claim
// here. The scrollbar rule in `globals.css` is not scoped to `/admin`: it
// styles every `tabIndex={0}` `overflow-x-auto` region in the product, and two
// of them are on `/portal` (the referrals table and the notification-history
// table). Both get a visible scrollbar where macOS and iOS previously drew an
// overlay one that vanished, so a region a tenant could scroll now says so.
//
// That is an improvement to an affordance, not a new claim, and the page has
// no sentence about scrollbars to keep true. Two things were checked before
// leaving it alone. The thumb is `--muted-foreground` on a `--muted` track —
// a UI component boundary under 1.4.11, and the pair clears 3:1 in both
// themes (light 0.556 on 0.97, dark 0.708 on 0.269). And the affordance is
// deliberately NOT a background gradient, which is the other standard answer:
// axe cannot resolve text contrast over a background image, so a gradient on
// the wrapper would have reported every cell inside every one of these forty
// regions as a `color-contrast` incomplete — forty regions' worth of noise
// burying the hand checks this page's own exception list depends on being
// short enough to read.
//
// `LAST_REVIEWED` does not move: two portal regions gained an affordance, no
// claim on this page was re-checked against the build, and none changed.
//
// Re-read 2026-09-01, at B-222 (the revenue report's `scope="rowgroup"`).
// **The sibling instance the B-216 entry above named as deliberately not fixed
// is now fixed**, so that entry should be read with this one: `RowPair` no
// longer uses `scope="rowgroup"` anywhere, and the construct is gone from the
// whole codebase rather than from one of its two users.
//
// B-216's remedy did not transfer, which is why this was its own row. The
// aging table already had a per-row `<th scope="row">` to fold the facility
// into; `RowPair` had none, because each row's identity ("Billed", "Coll.")
// lived in a `<span>` INSIDE its first money cell — a row describing itself
// from within one of its own data cells. So making a row header meant giving
// the label column real content, and the two half-labels moved out of the
// figures and into the headers where they belong. That is a visible change to
// an operator-facing report, and it is the change B-222 named as the design
// call: the alternative, `headers`/`id` across all fourteen cells, would have
// traded the AT-behaviour claim B-216 removed for a second one this repo can
// equally not watch.
//
// **The comment claims structure and nothing else.** Every figure now sits in
// a row whose header names the facility and which half of the pair it is. No
// announcement is asserted and none was observed — the standard B-216 set.
//
// **One runnable check**, `e2e/admin-reports.spec.ts`: every Billed row header
// has a Coll. row header naming the same facility. It reads `textContent`
// rather than `innerText`, because the half-labels render through
// `text-transform: uppercase` and `innerText` returns what is PAINTED
// ("BILLED") — asserting on that would make the test a check on a CSS
// declaration rather than on the markup. **Verified by replacing the second
// row's `<th>` with a `<td>` and watching it fail**, then restoring.
//
// `LAST_REVIEWED` does not move: `/admin/reports/revenue` is behind
// `reports:financial`, no public or portal route is touched, and no claim on
// this page was re-checked against the build. The structurally frozen review
// date is B-250's row, not this one's to move.

// Re-read 2026-09-01, at B-224 (a sale schedulable before the notice deadline).
// **No claim on this page changed, and `LAST_REVIEWED` does not move** —
// `/admin/auctions/[caseId]` is behind `auctions:approve` and no public or
// portal route is touched.
//
// Worth recording anyway, because it moved an admin screen TOWARD the standard
// rather than away from it: the schedule form and the sale-outcome form became
// `AdminForm`s, so their refusals now land in a focused `role="alert"` summary
// with the submitted values restored, instead of a re-render that looked
// exactly like the button having done nothing (FR-19, and B-141's defect). The
// sale-date field is a real `Field`, so its refusal carries `aria-invalid` and
// `aria-describedby`.
//
// **The other six forms on that screen are still bare `<form>`s** — lock cut,
// advertisement, cancel, and the three surplus controls — with plain labels,
// no error summary and actions that return `void`. That is named here rather
// than left implied, because this page's exception lists are only as honest as
// what gets written down when a sweep is partial.

// Re-read 2026-09-01, at B-244 (the portal dashboard's heading order).
// **Customer-facing, and a real SC 1.3.1 (A) failure removed** — every money
// statement on a lease card (the balance, the Pay button, the late installment,
// the suspension alert) was emitted ABOVE the `<h2>` naming its unit, inside a
// `<section>` with no accessible name, so on a two-unit tenant they all sat
// under the other unit's heading in the outline with no region name to fall
// back on.
//
// **Nothing on this page changes, and that is the finding worth recording.**
// The shortfall list never mentioned this, because nobody knew: every portal
// fixture in the suite was a single-lease tenant, so the ambiguous case was
// rendered by no test and scanned by no axe run. A statement can only be as
// honest as the coverage behind it, and this one was silent rather than wrong.
// The seed now gives one demo tenant two units, so the case exists to be
// scanned at all.
//
// `LAST_REVIEWED` does not move. No claim on this page was re-checked against
// the build and none changed — the shortfall list was read and had nothing to
// remove. That this rule, applied item by item, guarantees the date never moves
// is **B-250**, and the cadence that would replace it is **D-115**; neither is
// this row's to decide.

// Re-read 2026-09-01, at B-245 (nine live regions that were never status
// messages). **Customer-facing** — seven of the nine are on `/portal`.
//
// **No claim on this page changes and `LAST_REVIEWED` does not move**, and the
// reasoning is worth writing down because it cuts against the instinct. This
// page says nothing about live regions or announcements, and that silence is
// correct: what an inserted-already-populated region announces is precisely
// what nobody here has measured. B-245's fix was to STOP INSERTING them rather
// than to claim what happens when they arrive, so there is no new claim to
// make — the surfaces simply no longer do the thing whose effect was unknown.
//
// Recording the shape anyway, because it is the second time in two rows that a
// defect survived by being invisible to the tooling: every axe run in this
// repo is a `goto`, a fresh document load, so a fault that only appears after a
// CLIENT-SIDE navigation was on a surface no scan could reach. There is one
// spec for that now. B-244's was the fixture gap; this one was the navigation
// gap. Neither was a gap in the rules being checked.

// Re-read 2026-09-01, at B-246 (scan contract VI — the layout half had no
// exception list). **No claim on this page changes and `LAST_REVIEWED` does
// not move**: the two states involved are both behind `tenants:view` on
// `/admin/tenants/[tenantId]`, no public or portal route is touched, and the
// generated coverage claim and `STATE_EXCEPTIONS` are both untouched.
//
// Two things recorded rather than left implied. **A real reflow defect was
// found by turning the measurement on** — the payment-plan builder painted
// content 18px past the right edge at 200% zoom, because `sm:grid-cols-3` and
// Tailwind's `sm` breakpoint is 640px, which is exactly the viewport a
// 200%-zoom check produces. Fixed here, on an admin screen, so this page has
// nothing to add or retract; the fourth instance of this shape in the repo
// (B-199, B-201, B-217) and the first caused by a breakpoint rather than a
// missing wrapper.
//
// And the coverage picture in the CODE is now richer than the one on this
// page. Seventeen states declare, with a reason, that their layout is not
// measured directly; this page publishes only the axe exceptions. That is a
// deliberate scope line — publishing a second list is a claim change — but it
// means "what we have checked" is understated here rather than overstated,
// which is the safe direction and the one worth naming.

// Re-read 2026-09-01, at B-247 (the Manage menu's tap targets).
// **Customer-facing, and `LAST_REVIEWED` still does not move** — because
// nothing this page claims was re-checked and nothing it claims changed.
//
// The distinction the row turns on is worth keeping written down here, since
// this is the page where overstatement costs most: a 20px tap target on the
// portal nav is a **PRD 01 §6.2** miss and **not a WCAG 2.1 AA failure**.
// 2.5.5 Target Size is AAA in WCAG 2.1 and 2.5.8 is WCAG 2.2, and neither is
// what this page says we target. So there was no conformance defect to
// disclose while it was broken, and there is no conformance improvement to
// claim now that it is fixed — only our own gate, met.
//
// Also worth recording: **no automated rule would have caught this.** axe does
// not check a project's own shipping gate, and the state was behind a closed
// disclosure the route loop never opens, so it was in the accessibility tree
// of no scan and measured at no width. The fix ships with a declared state and
// a direct height assertion for that reason. Third row running where the
// defect survived by being invisible to the tooling rather than by being
// subtle.

// Re-read 2026-09-01, at B-248 (the payment-plan builder's running total).
// **Admin-only** — `/admin/tenants/[tenantId]`, behind `tenants:view` and
// `delinquency:execute_step`. **No claim on this page changes and
// `LAST_REVIEWED` does not move.**
//
// Recorded because the defect was a COMMENT, not markup. The region asserted
// that "a polite region coalesces, so typing an amount announces the figure
// once the typing stops" — which is not a property polite regions have, on the
// one form in the product whose figure is money owed. B-216's standard ("no
// announcement is asserted and none was observed") exists precisely so a
// comment cannot quietly become a conformance claim nobody measured, and this
// one predated it. The fix settles the region's text 700ms after the last
// keystroke so one field edit is one text change; what a screen reader then
// says is still unobserved and is still not asserted anywhere.
//
// The direction matters for this page: an unmeasured claim living in a source
// comment is the same failure mode as an unmeasured claim living in this
// file's prose, one audience narrower. Nothing here needed retracting only
// because this page has never said anything about announcements — the silence
// B-245 recorded as correct is what kept it out.

// Re-read 2026-09-01, at B-249 (fifty-six focusable scroll regions with no
// role and no name). **Customer-facing** — two of the fifty-six are on
// `/portal`, the same two B-217's note names: the referrals table and the
// notification-preferences table. **No claim on this page changes and
// `LAST_REVIEWED` does not move.**
//
// The reason it does not move is the same one as B-245's, and it is worth
// saying plainly because this row is the largest single a11y change the repo
// has made: **this page has never claimed anything about scroll regions**, so
// there was no false sentence while fifty-six of them announced nothing, and
// there is no sentence to strengthen now that they are named. The shortfall
// list was read and had nothing to remove.
//
// **The conformance call is carried as the reviewer wrote it and NOT
// upgraded.** Whether a scroll container is a "user interface component" under
// SC 4.1.2 is genuinely contested; the reviewer declined to inflate it and so
// does this note. What is not contested, and what the fix is actually for, is
// that each one was a focus stop that announced nothing.
//
// Recorded because it is the fourth row running where the defect was invisible
// to the tooling rather than subtle — and this one is the sharpest case yet.
// **axe has a rule that looks straight at these elements and passes them**:
// `scrollable-region-focusable` checks only that a scroll container IS
// focusable, so a focusable one with no name is a pass. Every scan in this repo
// ran over all fifty-six and reported nothing, for as long as they have
// existed. B-244's was a fixture gap, B-245's a navigation gap, B-247's a
// closed disclosure; this one was in every scan's reach the whole time and the
// rule was not asking the question.

// ── B-218, entered late at B-250 (2026-09-01) ──────────────────────────
//
// **This entry is backdated, and that is the point of writing it.** B-218 was
// merged with no entry here, and it changed the TRUTH VALUE of a sentence on
// this page — the one case this log exists to catch, and the one it missed.
//
// "How we check" says automated tests run *"on every push to our main branch,
// and on every pull request that is open for review"*. The second half was
// **false for the entire life of the split lanes.** `on: pull_request` with no
// `types:` defaults to `opened, synchronize, reopened`; `ready_for_review` is
// not among them, so `gh pr ready` fired no workflow event at all and the
// `e2e` job kept whatever `skipping` conclusion it had earned while the PR was
// still a draft. Sixteen PRs reported `e2e=skipping` on the strength of it.
// B-218 added `types: [opened, synchronize, reopened, ready_for_review]` and
// the sentence became true.
//
// So the sentence was an OVERSTATEMENT when written and is accurate now, and
// **neither half was recorded when it happened**. The rule this page follows is
// that a claim changing truth value is logged **in either direction** — the
// direction that matters most being the one where the page was ahead of the
// build, because that is the one that reads as a misrepresentation rather than
// as modesty. It was caught by a review, not by this log, which is the honest
// summary of what happened.
//
// `LAST_REVIEWED` does not move. A sentence becoming true is not a re-check of
// the page, and correcting the record of an overstatement never moves the date
// (PRD 01 §6.8).

// Re-read 2026-09-01, at B-250 (this page's own review date).
//
// **The "Where we fall short" list was re-read against the build in full**, not
// as a side effect of another row — B-250 exists because no per-item re-read
// ever does that. All three entries are still true today: the no-JavaScript
// hold countdown still does not tick, Tasks/Leads/Delinquency/Support sessions
// are still unpaginated, and the two embedded maps are unchanged and still
// collapsed behind a button.
//
// **A prediction in the backlog turned out to be wrong, and it is recorded
// rather than quietly dropped.** B-250's row and D-115 both say that B-244,
// B-245, B-247 and B-249 "change the 'Where we fall short' list rather than
// `LAST_REVIEWED`". They changed neither: all four fixed customer-facing
// defects that this list had **never named**, because nobody knew about them
// until the review that raised them. A shortfall list can only shorten when the
// thing it admits to gets fixed, and none of these four were on it.
//
// That is worth keeping because it sharpens what the list is: it is a record of
// **known** problems, and four unknown ones were found and fixed in a single
// day without it moving. The list being short is not evidence the page is
// close to done.
//
// **`LAST_REVIEWED` still does not move, and B-250 could not fix that** — the
// cadence half is blocked on **D-115**, which is an owner decision about
// somebody's recurring time and not a thing a build session may settle. What
// this row could do, it did: the missing B-218 entry above, and this
// re-verification. The date stands at 19 August 2026 with twenty-one merged
// items behind it, and **B-254** owns moving it.

// Re-read 2026-09-01, at B-225 (money paid ahead had nowhere to live).
// **Customer-facing** — `/portal/pay` gains a new refusal sentence and now
// accepts an amount larger than the balance. **No claim on this page changes
// and `LAST_REVIEWED` does not move.**
//
// Checked rather than waved through, because a money form is where a wrong
// error message costs most. The new copy replaces nothing: `above_balance`
// keeps its wording for the surfaces that still refuse overpayment, and
// `above_prepay_ceiling` is a second sentence for a second situation. That
// distinction is an accessibility one as much as a content one — 3.3.3 Error
// Suggestion asks that a message say what to DO, and telling a tenant who is
// deliberately paying six months ahead to "enter your balance or less" is
// advice that would make their task impossible.
//
// The field, its label, its error wiring and the live region around it are all
// unchanged; this row changed which sentence appears in a `<p>` that was
// already correctly associated. So there is nothing here to add or retract —
// and, as at B-245 and B-249, the reason there is no new claim to make is that
// this page has never claimed anything about error-message wording.

// Re-read 2026-09-01, at B-226 (the facility page's promo was missing from its
// own total). **Customer-facing** — the public facility page, under a badge a
// comparison shopper is reading. **No claim on this page changes and
// `LAST_REVIEWED` does not move.**
//
// Worth recording because the row carries WCAG acceptance criteria and every
// one of them was **already met before the fix**, which is a distinction this
// page exists to keep straight. The discount is a line of text with its terms
// as the label, inside the same expander as the other figures, so no meaning
// is carried by the badge colour (1.4.1) and the expander keeps a name that
// says what it opens (2.4.6). None of that changed here — `calculateMoveInCost`
// has emitted the line, the note and the reduced taxable base since B-070, and
// the markup around it was correct the whole time.
//
// **What was wrong was the number, and a wrong number is not an accessibility
// defect.** It is worth being exact about that on this page rather than
// claiming an a11y improvement the row did not make: the figure was equally
// wrong for every reader, in the same way, whatever they were reading it with.
// The nearest thing to a criterion it touched is 3.3.3-adjacent — a sentence
// asserting "it is already in the total below" when it was not — and that is a
// truthfulness defect, which this repo has been careful all week not to file
// under conformance.

// Re-read 2026-09-01, at B-227 (three screens promised a monthly charge with
// the tax left out, and the payment step said "Autopay is on" after the renter
// turned it off). **Customer-facing** — `/portal`, `/portal/methods` and the
// checkout payment step. **No claim on this page changes and `LAST_REVIEWED`
// does not move.**
//
// The half that reaches this page is the autopay disclosure, and it is worth
// being exact about which criterion it did and did not fail. **4.1.3 Status
// Messages was already met and this row did not improve it**: `setAutopayAction`
// has always returned a worded, branched outcome and `AdminForm`'s
// `role="status"` region is in the DOM before the submit (B-184), so the result
// announced correctly the whole time. What was wrong was that the STATIC
// paragraph beside the checkbox contradicted it — the region said "Automatic
// payments are off" and the disclosure underneath went on asserting autopay was
// on, and named an amount and a day.
//
// So this was a **truthfulness defect and a consent defect**, not a conformance
// one — D-11a permits a default-on enrolment only with an adjacent, accurate
// disclosure. Filing it as a WCAG failure would be the overstatement this page
// keeps catching in the other direction; claiming the fix as an accessibility
// improvement would be the same error wearing a better coat.
//
// One thing genuinely improved for readers and is NOT claimed here either,
// because this page makes no promise about it: the recurring figure now states
// what it contains ("rent, tax and your protection plan") rather than standing
// alone, which is US-301's requirement that components be named rather than
// silently omitted.

// Re-read 2026-09-02, at B-230 (the counter could not take a card, a walk-in
// move-in could not take cash, and every counter rental reported as a web
// rental). **Customer-facing in one respect only, and it is a FIX to a real
// 1.4.3 failure this page had no idea about.** The item's own screens are all
// staff ones — `/admin/pos/card`, the POS form, the tenant profile — and the
// staff-only tender it adds to the checkout payment step renders for nobody
// else, so no claim about the public site or the portal changes and
// `LAST_REVIEWED` does not move.
//
// **What it found.** The new counter card screen reuses `PortalPayment`, so it
// got that component's first axe scan in a state the two existing ones never
// reach: `aria-busy` true, while the Stripe script is still loading. The pay
// button carried `aria-busy:opacity-60`, and dimmed it measures **3.34:1**
// (#dadada on #747474) — a 1.4.3 Contrast (Minimum) failure on the button a
// payer is about to press. It was equally the portal's and checkout's: the
// identical button is in `components/checkout/payment-element.tsx`, and both
// of their scans miss it by racing the script, so by the time they run
// `aria-busy` is false and the button is at full opacity.
//
// **Why the "inactive component" exemption does not apply.** 1.4.3 exempts
// inactive user interface components, and this button is deliberately NOT
// `disabled` — B-110 made it `aria-busy` precisely so it stays focusable and
// activatable while the confirmation runs (disabling the focused element blurs
// it to <body> in Chromium). A control that keeps its focus and its activation
// is not inactive, so the exemption it might have claimed is one its own design
// gives up.
//
// The opacity is gone from both components. Nothing is lost: the busy state is
// still announced by the pre-mounted "Taking payment" region and still shown
// by the label changing to "Taking payment…", which is what the log entry of
// 2026-08-14 above already describes. `/admin/pos/card` is now scanned by its
// own click-through in `e2e/admin-pos.spec.ts` and is registered in
// `SCANNED_BY_OWN_SPEC`; `/admin/pos/card/done` joins `ADMIN_SCAN_ROUTES` in
// the same posture as `/portal/pay/done` (only its not-found state is
// reachable without a real card payment). Neither is on this page's own
// coverage claim, which covers the public site and the portal.
//
// Re-read 2026-09-02, at B-231 (the counter now sees what the tenant owes, and
// a former tenant can hand over cash). **Staff-only throughout** — `/admin/pos`
// and `/admin/tenants/former`. Nothing customer-facing changed, no public route
// was added, so the generated coverage claim, the route-keyed exception list
// and `LAST_REVIEWED` are all untouched, and no claim on this page needed to
// move in either direction.
//
// What the item's own screens gained, recorded because it is the kind of thing
// this log exists to keep honest: the balance and its aging are TEXT beside the
// control ("$312.40, 41 days past due"), not colour and not position, and the
// same figures are repeated in the `<option>` labels — so the picker is usable
// without reading the paragraph above it. "Pay in full" is a real
// `<button type="button">` at the 44px target, and it PREFILLS an editable
// field rather than acting as a second submit. `/admin/pos` keeps its existing
// axe pass in `e2e/admin-pos.spec.ts`.
//
// The item also fixed a pre-existing e2e defect that was NOT an accessibility
// one despite reading like it: `admin-move-out.spec.ts`'s
// `toHaveAccessibleName` check on the notice-date field was failing on `main`
// as a strict-mode violation — a page-wide locator matching both the tenant
// profile's per-lease field and the move-out screen's during the App Router's
// client transition. The accessible name it was asserting was correct all
// along; only the locator was wrong.

// Re-read 2026-09-02, at B-232 (the portal says what the balance is FOR, and
// what paying it buys). **Customer-facing**, on `/portal/pay`, `/portal` and
// `/portal/statements`. No public route added, so the generated coverage claim
// and the route-keyed exception list are untouched, and no claim on this page
// changed in either direction — but three of the row's acceptance criteria were
// accessibility ones and are worth recording as built rather than promised.
//
// **(1) The itemisation is a real `<table>` with column headers** (1.3.1), not a
// row of flex divs that happen to line up. The association between "Late fee,
// assessed 11 August" and "$20.00" has to survive being read one cell at a
// time, and a visual list gives a screen-reader user the amounts as a bare
// column of numbers. `<th scope="row">` on the Balance and Paying-today rows in
// the `<tfoot>`, for the same reason. It sits in an `overflow-x-auto` wrapper,
// which is exactly the scrollbar case the "wide table" bullet above already
// describes — the cell is reachable, not painted off the edge.
//
// **(2) The live consequence region pre-exists its message** (4.1.3). "Pay a
// different amount" now says what the entered figure does to gate access, and
// the `role="status"` paragraph renders unconditionally and empty rather than
// being inserted when there is something to announce — the failure mode this
// file has recorded since B-105 and `AdminForm` states for every admin form.
// It carries B-248's 700ms settle for B-248's reason: typing "437.50" mutates
// the sentence six times, and a polite region does not coalesce those.
//
// **(3) The phone number for a disputable charge is on that charge's line**
// (2.4.4), not only at the foot of the page. A tenant who thinks a late fee is
// wrong should not have to scroll past the pay button to find out who to ask.
// `/portal/statements`'s rows gained their closing balance in the same item,
// which incidentally retires twelve identical "View" links — the least useful
// accessible name a list of months can offer.
//
// `/portal/pay`, `/portal` and `/portal/statements` are all already in the
// portal scan (`e2e/portal.spec.ts`, `PORTAL_ROUTES`), so all three keep their
// axe pass plus the 320px, 200%-zoom and text-spacing passes; the new e2e
// asserts the table's headers by role and the status region by role rather than
// by class, so a regression to divs fails the suite rather than the scan.
//
// **`LAST_REVIEWED` is not bumped**, per the rule the B-150 entry states: this
// is three screens re-checked and one new pattern scanned, not a re-review of
// the page's claims, and no screen-reader pass was recorded.

// Re-read 2026-09-02, at B-237 (there was no way to create a facility, and one
// created by hand took rent and did nothing else). **Staff-only throughout** —
// `/admin/settings/facilities/new`, plus a readiness banner on `/admin` and
// `/admin/settings`. No public route was added, so the generated coverage
// claim, the route-keyed exception list and `LAST_REVIEWED` are all untouched,
// and no claim on this page moved in either direction.
//
// What the item's own screens carry, recorded because four of the row's
// acceptance criteria were accessibility ones:
//
// **(1) The readiness banner is text and links, not a colour badge** (1.4.1).
// Each gap names what is missing, what silently does not happen while it is,
// and links to the control that fixes it. A red dot would carry none of the
// three, and the whole point of the banner is that the failure it describes
// raises no error anywhere.
//
// **(2) 3.3.4 is the confirm-and-echo step already shipped at
// `/admin/settings`, reused rather than reinvented** — the same `FormState`
// `confirm` branch, the same pre-mounted status region, a `confirmLabel` of
// "Yes, create this facility". A facility that will invoice real tenants is a
// financial and legal commitment, and its state decides which compliance rules
// it can ever run (D-10, US-29).
//
// **(3) Every control goes through `Field`**, so `aria-invalid` and
// `aria-describedby` cannot be omitted, and the timezone `<select>` gets
// `max-w-full` (from `CONTROL_CLASS`) and `min-w-0` (from `Field`'s own
// wrapper) — B-201's exact defect, which a hand-rolled control would have
// reproduced.
//
// **(4) The route joined `ADMIN_SCAN_ROUTES` and both of its states joined
// `SCANNED_STATES` in the same commit**, not a follow-up. The refusal is
// `layout: 'excepted'` on the admin loop's own measurement; the confirm step is
// `layout: 'reached'` and NOT excepted, because six `<dl>` rows of long values
// (a full address, a web address) is not the tax step's two short ones.

// Re-read 2026-09-03, at B-239 (the move-in confirmation hands the renter
// something to do next, and Pay replaces Move out in the portal nav).
// **Customer-facing twice over** — the checkout confirmation screen and the
// nav on every route under `/portal`. **No claim on this page changes and
// `LAST_REVIEWED` does not move.**
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true, unchanged and unchanged in scope: the no-JavaScript
// hold countdown still does not tick, the four staff lists are still
// unpaginated, and the two embedded maps are untouched by this row.
//
// **Nothing here is a new claim, and one thing is worth saying about why.**
// This row ADDS `aria-current="page"` to eleven portal links that carried it
// on none — so it fixes a real defect on a customer surface, and the list
// above never named it, for the same reason B-250 recorded about B-244/245/
// 247/249: a shortfall list records KNOWN problems, and this one was found by
// a review rather than by the list. The list shortening is not what happened.
//
// Two things this row deliberately does not let the page claim:
//
// **(1) `aria-current` is SC 2.4.8 Location, which is AAA.** This page claims
// WCAG 2.1 AA and must keep claiming exactly that. The fix was taken because
// it is one attribute on a pattern already written in
// `components/admin/side-nav.tsx`, not because conformance required it — and
// a AAA courtesy must never be written up as an AA obligation met.
//
// **(2) The sticky pay bar's non-obstruction at 320px is asserted by
// construction, not by measurement.** `expectNoHorizontalOverflow` — which is
// what the portal reflow loop actually runs — measures horizontal overflow and
// cannot see a fixed element sitting on top of the last paragraph on the page.
// The `pb-24` on `<main>` is the fix, and nothing automated will notice if a
// later change removes it. Said here rather than left implicit, because the
// page's own text is careful that automated coverage is "a floor, not a
// ceiling" and this is precisely one of the gaps that phrase is about.

// Re-read 2026-09-04, at B-242 (a search result names the size its price
// belongs to, and carries a photo). **Customer-facing**, on `/storage/search`,
// which is already in `SCANNED_ROUTES` — no route added, no state added, so the
// generated coverage claim and both exception lists are untouched. **No claim
// on this page changes and `LAST_REVIEWED` does not move.**
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown still does not tick, the four staff lists are still unpaginated,
// and the two embedded maps are untouched by this row — in particular the
// search map's price markers are not what this changes; the card underneath it
// is.
//
// Three things this row adds that the page must not be read as claiming more
// about than is true:
//
// **(1) The thumbnail is `alt=""` and is not a link.** It sits beside a link
// that already names the facility, so a repeated name would be noise rather
// than a text alternative (1.1.1). `FacilityPhoto.alt` is required and is
// populated — the decision to render the empty string is about this placement
// specifically, and the facility gallery still renders the stored alt.
//
// **(2) The size and the price are ONE accessible sentence, not two nodes.**
// U+00D7 announces as a multiplication operator, which is why the sighted
// compact form (`5×10`) and the spoken one ("5 foot by 10 foot from $99 per
// month") are separate spans — the pattern B-016 shipped, and this is the
// fourth surface to need it. Rendering "5×10" and "Units from $99/mo" as
// adjacent nodes would have satisfied a scan and told a screen-reader user
// nothing about which price belongs to which size.
//
// **(3) The distance moved INTO the link's accessible name (2.4.4) and out of
// the assistive-technology tree beside it.** The visible distance is now
// `aria-hidden`, because carrying it in both places reads it twice. That is a
// judgement about announcement order that no automated check can make — axe
// sees a named link either way — so it is recorded here rather than left to a
// green scan.
//
// Re-verified 2026-09-04, at B-255 (a web move-in's payment reaches the
// ledger). No prose change and none needed in either direction. The row adds no
// route, no control and no copy — it is an ordering fix inside the Stripe
// webhook handler and a repair script — so the generated coverage claim is
// unaffected. What a tenant SEES does change, and in the direction that helps:
// the portal balance after a card move-in stops reading as the whole first
// month still owing. A number that was wrong is not an accessibility exception
// and does not belong in "Where we fall short"; that list was re-read against
// this build and all three entries are still true and unchanged in scope.
// `LAST_REVIEWED` is not bumped, for the reason the entries above give and per
// D-115 — only a recorded manual screen-reader pass moves it (B-254).

// Re-verified 2026-09-04, at B-090 part 4 (announcements — a staff-sent
// broadcast to a site's tenants). No prose change and none needed in either
// direction, and the reason is worth stating rather than implied: the SCREEN
// is staff-facing, so it is covered by the second shortfall bullet's admission
// rather than by any claim here — and it is a form, not one of the four
// unpaginated lists that bullet names, so the bullet's scope is unchanged.
//
// What a customer receives is an EMAIL, and this page has never made a claim
// about email. It does not start now, but the email is not unassessed: a
// broadcast renders through the same `renderEmail` every other template uses,
// so it inherits FR-9a's text/HTML pair from one body, the subject as the
// single `<h1>`, `lang` on the wrapper and escaping on every merged value —
// which is what stops a facility called "Bob & Sons" emitting broken markup.
// Nothing about that is new work this row did, and nothing about it is a
// promise this page can make on behalf of every mail client.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope. `LAST_REVIEWED` is not
// bumped, per D-115 — only a recorded manual screen-reader pass moves it
// (B-254).
//
// Re-verified 2026-09-04, at B-256 (a business account's payer gets one card,
// one Pay button and one consolidated statement instead of eleven of each).
// This one IS customer-facing — three portal surfaces change and one route is
// new — and it renders this page byte-identically, which is the outcome to
// check rather than to assume: no `SCAN_EXCEPTIONS` row was added, so the
// generated coverage claim below is untouched.
//
// It is untouched because the new work went INTO the scan contract rather than
// around it. `/portal/statements/account/[accountId]/[period]` joined
// `SCANNED_BY_OWN_SPEC` with a `REACH` entry (a bare `goto` cannot invent an
// account id or a month), and the two states the route loops could never
// reach — the account card on `/portal` and the consolidated bill on
// `/portal/pay`, both of which the loops render as Dana, who pays for no
// account and therefore has neither — joined `SCANNED_STATES` as `reached`,
// with `STATE_REACH` keys so they are measured at 320px, 200% zoom and forced
// text spacing rather than only scanned. Each is a three- or five-column table
// of units, tenant names and money on a page a payer reads on a phone, which
// is the shape B-199 spent an item on.
//
// Found while doing that, and fixed here: `/admin/billing/accounts/[id]` was
// put in `SCANNED_BY_OWN_SPEC` by B-090e with no `REACH` entry, so that
// route's layout test has FAILED since that item merged and the page had been
// measured at no width by anything. Staff-only, so this page makes no claim
// about it either way — but a coverage list with a false entry in it is the
// thing this page's history is mostly about.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. None of them is
// touched by an account card. `LAST_REVIEWED` is not bumped, per D-115.

// Re-verified 2026-09-04, at B-258 (authorized users on a business account —
// the people allowed to SEE it). Customer-facing, and this page again renders
// byte-identically, which is the outcome to check rather than assume.
//
// No route is added: the member's portal is `/portal`, which is already in the
// scan lists. What IS new is a second STATE of that route, and it went into the
// contract rather than around it — `/portal | business account card, member` is
// in `SCANNED_STATES` as `reached` with a `STATE_REACH` key, so it is measured
// at 320px, 200% zoom and forced text spacing rather than only scanned. That
// mattered more than it looks: the member's card is a DIFFERENT table from the
// payer's — one fewer column, no Pay button — so a scan of the payer's state
// measures none of it, and the contract test refused the `reached` claim until
// the reach entry existed. No `SCAN_EXCEPTIONS` row was added, so the generated
// coverage claim below is untouched.
//
// The staff side (`/admin/billing/accounts/[id]` gains a list and two forms) is
// covered by the second shortfall bullet's admission the way every admin screen
// is, and it is not one of the four unpaginated lists that bullet names — an
// account's authorized users is a handful of rows by construction — so the
// bullet's scope is unchanged.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. A read-only account card
// touches none of them. `LAST_REVIEWED` is not bumped, per D-115.
//
// Re-verified 2026-09-05, at B-090 part 6 (Spanish on the move-in path —
// D-122). The first item to change what LANGUAGE this page's claims are about,
// which makes it the first that could make the coverage sentence false without
// touching a single route.
//
// **The claim that needed re-checking is "automated tests on every page".** It
// was true and stayed true, but it quietly narrowed: the route loops carry no
// locale cookie, so all of them scan English, and the site now renders a second
// set of strings that no scan had ever seen. Two entries record that rather
// than letting the sentence cover a language it does not. `SCANNED_STATES`
// gains the facility page in Spanish — scanned by axe AND measured for reflow,
// zoom and text spacing through `STATE_REACH`, which matters because Spanish
// runs ~20% longer and that route is the tightest public layout at 320px —
// and `STATE_EXCEPTIONS` names the rest of the public site and the checkout as
// scanned in English only. Both render on the page.
//
// **The reflow claim went false during this item and is true again.** The
// language toggle adds two controls to the header, whose `<nav>` was `flex`
// without `flex-wrap` — the header around it wrapped, the nav inside it could
// not — and 26 of the 320px reflow specs failed on a horizontally scrolling
// page. Recorded here because "the page reflows to 320px without sideways
// scrolling" is a bullet in "What is true today", and it was briefly a false
// one on this branch. The nav now wraps and all 130 layout specs pass.
//
// **Two things are NOT claimed and both are deliberate.** WCAG 3.1.1 Language
// of Page is met — `<html lang>` follows the cookie, asserted in
// `e2e/i18n.spec.ts` — and 3.1.2 Language of Parts is met on the toggle, whose
// buttons carry their own `lang` so "Español" is not read with English
// phonemes. What is NOT met by translation is anything a lawyer wrote: the
// legal pages, the lease, every notice, and the three consent disclosures on
// checkout step 1 stay English, because a translated TCPA disclosure recorded
// against an English version constant would be evidence of a consent nobody
// gave. The footer says so in Spanish, in the sentence that already admits the
// legal pages are unreviewed drafts. That is a product gap (B-259), not an
// accessibility one, so the "Where we fall short" list is unchanged.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown (the Spanish checkout degrades identically), the staff screens, and
// the embedded maps. `LAST_REVIEWED` is not bumped, per D-115 — no manual
// screen-reader pass was performed, and an axe run in a second language is
// exactly the kind of evidence B-254 says cannot move that date.

// Re-verified 2026-09-05, at B-260 (the portal in Spanish — D-122). The
// second half of the language work, and the half that reaches a signed-in
// tenant: all seventeen portal routes, their nav, and the components they
// share with checkout.
//
// **The coverage sentence needed the same treatment as B-090f's and got it.**
// The portal route loop signs a tenant in with no locale cookie, so it scans
// English exactly as the public loop does. `SCANNED_STATES` gains `/portal` in
// Spanish — scanned as Dana, who is seeded past-due with a suspended access
// grant, so it is the money and access branches that are scanned rather than
// an empty account — and `STATE_EXCEPTIONS` names the other ten portal routes
// as English-only. Both render on this page. `/portal` is `layout: 'excepted'`
// with its reason recorded: `portal.spec.ts` already measures that route as
// the same tenant at every width, and what Spanish changes there is string
// length inside the same single-column cards. The tightest translated layout
// is the facility page, which IS measured at 320px (B-090f).
//
// **A pre-existing defect was found and fixed on the way**, and it is B-228's
// class rather than a language one: `/portal/methods` formatted the next
// autopay charge with a bare `Intl.DateTimeFormat('en-US', …)` and no
// `timeZone`, against a date held at UTC midnight — so in every US timezone it
// named the day BEFORE. Reproduced in America/Chicago: this screen said
// "October 14" for a charge the dashboard, one tap away, dated "October 15",
// about the same money on the same lease. It now uses `formatCalendarDate`,
// which pins UTC like every other calendar day in this product.
//
// **What the English copy must not do is change, and it did.** Lifting portal
// strings into the dictionary spelled 56 of them with a typographic
// apostrophe where the JSX had written `&apos;` — a straight one. Three e2e
// assertions caught it ("You're on a payment plan"), and it is a real change
// rather than a nit: it breaks every by-text locator and every operator's
// ⌘F. All 56 are restored, and `tests/i18n.test.ts` now fails on a curly
// apostrophe in an English value so this cannot happen a third time.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed.

// Re-verified 2026-09-06, at B-261 (the language we WRITE to a tenant in —
// D-122). Customer-facing, and one new control on a route this page already
// lists and already scans: `/portal/notifications` gains a `<select>` that
// sets `Tenant.preferredLocale`, the language every email and text goes out
// in.
//
// **What was checked.** The control is a labelled native `<select>` inside the
// existing `AdminForm`, so it inherits the form's error handling and its
// announced result; the label is a real `<label for>` rather than a placeholder
// (1.3.1, 3.3.2), the option names are written in the language each one names
// (`LOCALE_NAMES`, so "Español" is legible to the person who needs it), and the
// submit button meets the same 44px target as every control beside it. Nothing
// here is colour-carried and nothing is new in kind — it is the same
// `AdminForm` + native-control pattern as the notification grid above it on the
// same page.
//
// **One real accessibility DEFECT was fixed, and it is not on a page.** Every
// templated email rendered inside `<div lang="en">`, hardcoded — so the Spanish
// templates this item seeds would have told a screen reader to pronounce
// Spanish with English phonemes. That is 3.1.2, on a document a tenant reads
// rather than a page they visit, and it is the one accessibility failure a
// translation INTRODUCES rather than fixes. `renderEmail` now takes the
// language and declares it, checked by `tests/comms-locale-db.test.ts` in both
// directions.
//
// **No new claim about scan coverage.** The scan loops carry no locale cookie
// and `/portal` in Spanish is already in `SCANNED_STATES` from B-260; the
// language control sits on `/portal/notifications`, which `STATE_EXCEPTIONS`
// already names as scanned in English only. The gap is where it was.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed, and this
// item performed none.

// Re-verified 2026-09-06, at B-263 (the Spanish checkout's field errors —
// D-122). Customer-facing, on the money path, and it fixes an accessibility
// failure rather than only a product one.
//
// **What was actually wrong is 3.1.2 Language of Parts, and it was ours.** A
// Spanish renter was served `<html lang="es">` — asserted by `e2e/i18n.spec.ts`
// — and then, on a refused step, an English sentence inside it with no `lang`
// of its own. A screen reader reads that with Spanish phonemes, which is the
// same defect B-261 fixed in the templated emails, arrived at from the page
// side. Every field error on steps 1 through 4 is now translated, so it is
// fixed by saying the right words rather than by marking up the wrong ones.
//
// **The bullet this touches is "What is true today" → errors, and it does not
// change.** It claims the message is tied to its field, that what was typed
// survives, and that a save is announced — all three are about the mechanism,
// were true in both languages before this item, and are true now. What the
// bullet never claimed is the language of the message, which is why nothing on
// this page had gone false: the gap was real and unstated rather than
// misstated. It is stated now, in this note.
//
// **No new claim about scan coverage, and no new route or control.** The scan
// loops still carry no locale cookie and `STATE_EXCEPTIONS` still names the
// checkout as scanned in English only — B-090f recorded that and it is
// unchanged. This item adds no page, no control and no interaction; it changes
// which words an existing live region announces.
//
// **One thing worth naming because it is the 3.3.3 half.** `err.postalCodeUnknown`
// tells the renter to open a disclosure BY NAME, so a rename in one language
// and not the other would point a Spanish reader at a control that is not on
// their page — a refusal with no way out, for exactly the person who cannot
// read the other language. `tests/i18n.test.ts` now asserts each locale's
// message quotes that locale's own `details.enterMyself`.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed, and this
// item performed none.

// Re-verified 2026-09-06, at B-264 (the lead form on a Spanish facility page —
// D-122, D-125). Customer-facing, on a route this page already lists and
// already scans, and the same 3.1.2 failure B-263 fixed on the checkout, one
// funnel step earlier.
//
// **What was wrong.** The facility page has been `<html lang="es">` since
// B-090f and the quote/callback form inside it was English end to end — every
// label, the size options, the refusals, and the marketing-consent sentence. A
// screen reader announcing that form under a Spanish document reads English
// words with Spanish phonemes, which is Language of Parts, and it is again
// fixed by saying the right words rather than by marking up the wrong ones.
//
// **Two bullets were re-read and neither changes.** "Form fields have real
// labels" is about the mechanism and was true in both languages before this
// item; the `<label for>` / sibling `<input>` shape B-171 gave these fields is
// untouched, and translating a label does not weaken it. The errors bullet is
// the one B-263's note already walked: it claims the message is tied to its
// field, that what was typed survives, and that a save is announced — all
// three about mechanism, none about language. As with B-263, the gap here was
// real and unstated rather than misstated.
//
// **No new claim about scan coverage, and no new state.** The scan loops carry
// no locale cookie, and the Spanish facility page is already in
// `SCANNED_STATES` from B-090f. The new spec asserts words rather than running
// axe, so it carries no `a11y-state:` comment and adds nothing to either list —
// the refused Spanish form is the same markup as the refused English one that
// `smoke.spec.ts` already scans, with different sentences in it.
//
// **One thing named because it is where an a11y fix and a legal one meet.**
// The consent sentence beside the checkbox is NOT a dictionary entry (D-125):
// it is a versioned disclosure, so `Dictionary`'s typecheck cannot catch a
// missing translation and only a rendered page can. That is why the e2e spec
// asserts the Spanish words and the `disclosureLocale` field directly. A
// disclosure a reader cannot read is not consent, whichever discipline is
// asked.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope: the no-JavaScript hold
// countdown, the staff screens, and the embedded maps. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed, and this
// item performed none.
// Re-verified 2026-09-07, at B-267 (the reservation form on a Spanish facility
// page — D-122). Customer-facing, the last untranslated form on the public
// site, and the same 3.1.2 Language of Parts failure B-263 fixed on the
// checkout and B-264 on the lead form beside it.
//
// **What was wrong, and it was the whole surface.** `reserve/page.tsx`
// imported nothing from `@/lib/i18n` and `reserveAction` built five field
// refusals plus two non-field messages as English literals. A Spanish visitor
// pressed "Reservar gratis" on a Spanish facility page and landed on an
// English form; refused, they were told why in English under `<html lang="es">`.
// The two non-field messages are the ones that mattered — a size selling out
// mid-form, and "you already had a hold, so we updated it", which is the
// sentence a renter has to read to not believe their reservation vanished.
//
// **A CLAIM ON THIS PAGE WAS FALSE, in the overstating direction, and the
// re-read is what found it.** `/storage/[state]/[city]/[slug]/reserve` was
// listed in `PUBLIC_SCAN_ROUTES` as
// `.../reserve?unitType=INVALID` — a URL that REDIRECTS, because no unit type
// has that id. So all four public loops (axe, 320px reflow, 200% zoom, forced
// text spacing) have been scanning the facility page's "that size just went"
// notice, twice, and the reservation form has never been scanned by anything.
// The coverage test could not see it: it strips the query string, so the entry
// satisfied the route pattern. Fixed rather than disclaimed — the entry is
// renamed to the page it actually visits, and the form is in
// `SCANNED_BY_OWN_SPEC`, reached by a real click in `smoke.spec.ts` with a
// `REACH` entry in `a11y-own-spec-routes.spec.ts` for the three layout checks.
// It cannot go back in the URL list: the route needs a real unit-type cuid,
// which no fixed string holds across a reseed. This is the `/admin/pos/card`
// arrangement from B-230, for the same reason.
//
// **No bullet below changes.** "Form fields have real labels" and the errors
// bullet are both about mechanism, and translating a label or a refusal
// neither strengthens nor weakens either — the same reading B-263 and B-264
// recorded. The reservation form's `<label for>` / `<input>` shape, its
// `aria-invalid`, its described-by error and its focused summary are
// `AdminForm`'s and are untouched.
//
// **No new state claim.** The Spanish form is asserted by words rather than by
// axe, so the new spec carries no `a11y-state:` comment: the scan loops carry
// no locale cookie, which the `/` | Spanish row in `STATE_EXCEPTIONS` has said
// since B-262, and the refused Spanish form is the refused English form's
// markup with different sentences in it.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope — the no-JavaScript countdown
// is the CHECKOUT's 30-minute hold and not this form, the staff screens, and
// the embedded maps. `LAST_REVIEWED` is not bumped, per D-115 — no manual
// screen-reader pass was performed, and this item performed none. The scan-
// coverage correction above is a fix to a generated list, not a re-verification
// of the dated claims.
// Re-verified 2026-09-07, at B-272 (English prose under `<html lang="es">` —
// SC 3.1.2 Language of Parts, AA). Customer-facing, and a defect this page's
// own scan contract was structurally unable to see. **Merged after B-267
// above, and the merge changed one of its numbers** — see the last paragraph.
//
// **What was wrong.** D-122 puts the locale in a cookie and the root layout
// sets `<html lang>` from it, so a Spanish visitor was served `<html lang="es">`
// around the English terms and privacy pages D-123 and D-124 deliberately keep
// English — a screen reader pronouncing contract text with Spanish phonemes.
// Nine more public pages were English inside the same shell because nobody has
// translated them yet, which is the same failure arrived at from the other
// side. Every public page now declares the language of its own content, and
// `ProsePage` takes `lang` as a REQUIRED prop so the next prose page states it
// or fails `npm run typecheck`.
//
// **Why no scan caught it, which is the half worth keeping.** Axe cannot: no
// rule reads prose and decides what language it is in, and `html-has-lang`
// passes on the broken page. The route loops could not either — they carry no
// locale cookie, so every automated run visits as an English visitor, where
// the markup is trivially correct. A contract that cannot enter the broken
// state cannot fail on it. Two things replace the scan:
// `ENGLISH_UNDER_A_TRANSLATED_SHELL` in `scan-coverage.ts` lists every public
// page that renders no dictionary string, and `tests/a11y-scan-coverage.test.ts`
// walks `app/(public)` and fails when a page is in neither the dictionary nor
// that list, or is in the list with no `lang` in its markup.
//
// **This page's own claims.** No sentence here changed. The statement makes no
// claim about language in either direction, and none was added — a bullet under
// "What is true today" would be a new public commitment, which is not what a
// defect fix is for. Two SCANNED_STATES rows were added (`/terms` and
// `/privacy` visited as a Spanish reader), so the `/` state-exception row no
// longer speaks for them and now says so; that row is rendered here, in both
// languages, and is the only visible change. `LAST_REVIEWED` is not bumped,
// per D-115 — no manual screen-reader pass was performed.
//
// **What is left, named rather than implied.** The ADMIN screens are English
// under the same cookie-driven shell, and one of them — the message-template
// editor — renders Spanish template bodies inside it, which is the mirror
// defect. Staff-facing, already disclaimed by the "our staff-facing screens
// have known problems" bullet, and owned by **B-273** rather than fixed here.
// (B-273 closed it on 2026-09-08. Noted so this paragraph is not read as an
// open gap; NO sentence rendered on this page changed, in either direction,
// because none of it was ever about staff screens — see B-273's own entry.)
//
// **The merge with B-267, because it is the guard doing its job rather than a
// conflict.** B-272 was built against a `main` where the reservation form was
// still English, and marked it `lang="en"` like the other ten. B-267 then
// translated that form, which makes the mark a lie in the mirror direction —
// and `tests/a11y-scan-coverage.test.ts` says so out loud ("lists no page that
// has since been translated"), which is the direction the walker was written
// for and the first time it has been paid. The attribute and the row are gone;
// the page renders from the dictionary and needs neither.

// Re-verified 2026-09-07, at B-266 (the promo code box on a Spanish checkout
// and a Spanish facility page — D-122). Customer-facing, on the money path,
// and B-263's 3.1.2 Language of Parts failure one field over: an English
// sentence inside `<html lang="es">` is read aloud with Spanish phonemes.
//
// **What was wrong, and half of it was not a refusal.** `describeCodeOutcome`
// built nine English sentences inside `@storage/core/promotions` — seven
// refusals plus "Code applied" and "We kept your better offer" — and both
// renter-facing surfaces rendered them verbatim. The two that are not refusals
// are the ones worth naming here: the checkout styles that branch green with a
// `role="status"` and no `aria-invalid`, so a Spanish renter whose code WORKED
// was told so in English by a live region announcing in the wrong language.
// The facility page's box was worse — its label, placeholder and submit button
// were English too, so it was a whole English control on a translated page.
//
// **One gap this row does NOT close, and it is a real 3.1.2 one.**
// `promo.codeApplied` renders "Código aplicado: {terms}", and `{terms}` is the
// promotion's own wording — an operator's `termsText` or `describeTerms`'
// generated sentence — which is English on every surface that shows it: this
// message, every unit-card badge, and the checkout summary. So a Spanish
// reader still meets one English fragment inside a Spanish sentence. It is
// **B-269**, filed rather than half-fixed inside this message, because the
// badges are the larger share of it and fixing one and not the others would
// leave the page inconsistent about which English is deliberate.
// *(B-269 closed the generated half of that on 2026-09-07; see the block
// below for what remains and why.)*
//
// **No bullet below changes, and no new claim.** "Form fields have real
// labels" and the errors bullet are about mechanism; translating a label or a
// refusal neither strengthens nor weakens either, the reading B-263, B-264 and
// B-267 each recorded. No route is added: the facility page and the checkout
// are both already in the scanned set, and this changes the strings inside
// controls whose markup is untouched. No new `a11y-state:` either — the scan
// loops carry no locale cookie, which the `/` | Spanish row in
// `STATE_EXCEPTIONS` has said since B-262, and the new e2e assertions are on
// words rather than axe.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed, and this
// item performed none.

// Re-verified 2026-09-07, at B-269 (a promotion's own terms, on every
// translated surface that quotes them — D-122, D-129). This is the gap the
// B-266 block above filed, and it closes in one half and is bounded in the
// other.
//
// **What was wrong.** `describeTerms` and `withMinStay` built English prose
// inside `@storage/core/promotions` — "50% off the first month",
// "First month free — 6-month minimum stay" — and five surfaces rendered it
// verbatim: every unit-card badge on a translated facility page (the biggest
// by far, and one badge per size on a page that may show six), the facility
// page's "what you'd pay" discount line, the checkout price summary, the
// applied-code confirmation and the checkout's "currently applied" line. Each
// was an English phrase inside `<html lang="es">` with nothing to say so, read
// aloud with Spanish phonemes. The generated half is now keys and their
// numbers, resolved per surface, so those phrases are Spanish on a Spanish
// page rather than marked English on one.
//
// **What is bounded rather than fixed, and it is a genuine residual.**
// `Promotion.termsText` is an operator's free text in a database column. There
// is no key to return for it, and D-129 settles that it is rendered as typed
// rather than growing a column per language. So on a Spanish page an operator
// override is still English — correctly so, since nothing translated it — and
// the honest thing available is to SAY it is English. The unit-card badge does:
// `OfferTermsText` emits `<span lang="en">` around the operator's words and
// leaves an appended minimum stay outside it, because that clause IS
// translated and marking the whole span would mislabel it. Three surfaces do
// NOT: the applied-code confirmation and the "currently applied" line, because
// `FormState.message` and `fieldErrors` are string-typed end to end, and the
// move-in cost `<dt>`, because `costLineLabel` returns text. Turning those
// into nodes is a change to the form machinery every admin screen shares, and
// it is not this row's. **This is stated rather than left implied**: a promo
// with an operator override, read in Spanish, still meets unmarked English in
// three places.
//
// **No bullet below changes, and no new claim.** The "Where we fall short"
// list names JavaScript, the staff screens and the maps; none of the three is
// touched, and an untranslated fragment of an operator's own wording is not
// one of them — it is bounded above and carried by D-129 rather than by a
// public promise. No route is added: the facility page and the checkout are
// both already in the scanned set, and this changes strings inside controls
// whose markup is otherwise untouched. The one markup change is a `<span>`
// with a `lang` attribute, which is the fix rather than a thing to declare. No
// new `a11y-state:` — the scan loops carry no locale cookie, which the `/` |
// Spanish row in `STATE_EXCEPTIONS` has said since B-262.
//
// The "Where we fall short" list was re-read against this build and all three
// entries are still true and unchanged in scope. `LAST_REVIEWED` is not
// bumped, per D-115 — no manual screen-reader pass was performed, and this
// item performed none.

// Re-verified 2026-09-07, at B-265 (the emails composed in code, not from a
// template — D-122, D-130). Customer-facing, and it closes a real 3.1.2 gap
// that this page had NOT overstated in either direction.
//
// **What was wrong.** B-261 fixed `renderEmail`'s hardcoded `<div lang="en">`,
// which the note above records. It fixed the TEMPLATED path only. Nine sends
// go out through `sendDirectEmail`, which composes no document and passed the
// caller's HTML to the provider untouched — so the reservation confirmation,
// the checkout resume link, the sign-in and reset links, both halves of the
// email-change flow, the waitlist availability mail, the platform alert, the
// scheduled report and every broadcast carried NO language declaration at all.
// That was survivable only while every one of them was English; the moment
// four of them became Spanish it is 3.1.2 on a document a renter reads.
//
// **Where the fix went is the part worth recording.** Not at the nine call
// sites — in `sendDirectEmail` itself, which now requires the locale and wraps
// the HTML in it. A caller that can forget the declaration is a caller that
// will, and the failure is invisible: a message with no `lang` looks the same
// in every inbox and only sounds wrong. The three sends that stay English say
// so where they pass `en`, so "English" is a decision in the code rather than
// the absence of one.
//
// **A second, smaller defect was fixed on the way.** Both email-change
// messages interpolated the tenant's own first name raw into their HTML part.
// It is escaped now, through the same `escapeHtml` the render path uses.
//
// **No claim below changes, and none needed correcting.** This page has said
// nothing about email since B-198 settled that it says nothing in either
// direction, and that sentence held: nothing here was disclaimed that has
// since shipped, and nothing was claimed that had not. The "Where we fall
// short" list was re-read against this build — the no-JavaScript hold
// countdown, the staff screens, the embedded maps — and all three are still
// true and unchanged in scope. No route and no `a11y-state:` is added: this
// changes no page. `LAST_REVIEWED` is not bumped, per D-115 — no manual
// screen-reader pass was performed, and this item performed none.

export default async function AccessibilityPage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const reviewed = reviewedOn(locale)

  /// A row's Spanish is optional on the type and required by test, so this is
  /// where the two meet: fall back to the English rather than render nothing.
  /// A missing translation should read as an untranslated gap, not as a gap
  /// that stopped existing.
  const reasonIn = (row: { reason: string; reasonEs?: string }) =>
    locale === 'es' ? (row.reasonEs ?? row.reason) : row.reason

  return (
    <ProsePage lang={locale} title={t('a11y.title')} intro={t('a11y.intro')}>
      <Section heading={t('a11y.target.heading')}>
        <p>{t('a11y.target.body')}</p>
      </Section>

      <Section heading={t('a11y.true.heading')}>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('a11y.true.keyboard')}</li>
          <li>{t('a11y.true.colour')}</li>
          <li>{t('a11y.true.resize')}</li>
          <li>{t('a11y.true.labels')}</li>
          <li>{t('a11y.true.errors')}</li>
          <li>{t('a11y.true.motion')}</li>
          <li>{t('a11y.true.maps')}</li>
        </ul>
      </Section>

      <Section heading={t('a11y.check.heading')}>
        <p>{t('a11y.check.ci')}</p>
        <p>{t('a11y.check.waivedIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('a11y.check.waived.page')}</li>
          <li>{t('a11y.check.waived.site')}</li>
          <li>{t('a11y.check.waived.thirdParty')}</li>
        </ul>
        <p>{t('a11y.check.routesIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          {customerFacingExceptions().map((exception) => (
            <li key={exception.route}>{reasonIn(exception)}</li>
          ))}
        </ul>
        <p>{t('a11y.check.routesTail')}</p>
        <p>{t('a11y.check.statesIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          {customerFacingStateExceptions().map((exception) => (
            <li key={`${exception.route}-${exception.state}`}>{reasonIn(exception)}</li>
          ))}
        </ul>
        <p>{t('a11y.check.statesTail')}</p>
        <p>
          {t('a11y.check.floor')}{' '}
          <strong>{t('a11y.check.noManualPass')}</strong>, {t('a11y.check.noManualPassTail')}
        </p>
      </Section>

      <Section heading={t('a11y.short.heading')}>
        <p>{t('a11y.short.intro', { date: reviewed })}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>{t('a11y.short.js.term')}</strong> {t('a11y.short.js.body')}
          </li>
          <li>
            <strong>{t('a11y.short.staff.term')}</strong> {t('a11y.short.staff.body')}
          </li>
          <li>
            <strong>{t('a11y.short.maps.term')}</strong>, {t('a11y.short.maps.body')}
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          {t('a11y.short.reviewed', { date: reviewed })}
        </p>
      </Section>

      <Section heading={t('a11y.tell.heading')}>
        <p>
          {t('a11y.tell.before')}{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>{' '}
          {t('a11y.tell.orCall')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          . {t('a11y.tell.tail')}
        </p>
      </Section>
    </ProsePage>
  )
}
