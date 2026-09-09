# 07 — Decision index

**This file is generated. Do not edit it by hand** — edit [`07-decisions.md`](07-decisions.md) and run `npm run docs:index`.

`07-decisions.md` amends the PRDs: where a PRD conflicts with a decision, the decision wins. It is also 212 KB, which is more than a session should spend to answer "is there a decision about X".

**This index carries each row's D-number and its topic column, and NOT the decision or the build-impact columns.** A decision that overrides a PRD has to be read in full before it is relied on: its wording is what binds, and several rows carry later corrections inside their own text — D-7 is the clearest, stating a policy and then recording that the policy was wrong on both halves. Reproducing the verdict here would invite deciding from the summary, which is the one failure this file exists to prevent.

`npm run docs:decision -- D-122` prints one row whole and verbatim, which is the cheap way to do that — a few KB rather than 212.

One caveat, because it is visible below rather than hidden: the topic column changed style over time. Early rows name a conflict to resolve ("Kiosk mode (master P2 vs PRD 03 P3)"); later ones state the decision outright ("Attaching a lease to a business account does not move the autopay mandate"). Where the source does that, so does this index — it is quoting, not summarising. Either way the binding text is the row in [`07-decisions.md`](07-decisions.md), not the line here.

**136 decisions.**

| # | Topic |
|---|---|
| D-1 | Delinquency/lien + POS/reports MVP scope (PRD 02 vs master) |
| D-2 | Marketing Phase 1 scope (PRD 04 vs master) |
| D-3 | Kiosk mode (master P2 vs PRD 03 P3) |
| D-4 | First real gate-vendor driver (master P2 vs PRD 03 stubs) |
| D-5 | Scheduled tenant rate increases (PRD 02 MVP vs master P2) |
| D-6 | Stripe Billing vs ledger-driven charges |
| D-7 | Reservation deposit policy |
| D-8 | Consent store ownership |
| D-9 | PRD cross-reference numbering |
| D-10 | Operating state for legal defaults |
| D-11a | Autopay pre-charge reminder default |
| D-11b | Minor phasing splits |
| D-12 | Superuser account (raised during B-004, 2026-07-30) |
| D-13a | Tenant notification on staff impersonation (PRD 09 OQ-1, 2026-07-30) |
| D-13b | Default roles for impersonation permissions (PRD 09 OQ-2) |
| D-13c | `ImpersonationSession` retention (PRD 09 OQ-3) |
| D-13d | Impersonated portal render target (PRD 09 OQ-6) |
| D-13e | Tenant-initiated support access (PRD 09 OQ-4) |
| D-14 | Geocoding provider (PRD 01 OQ-6, raised during B-015, 2026-07-31) |
| D-15 | Customer-facing lexicon (raised by the UX review, 2026-07-31) |
| D-16 | Gate access suspension for non-payment, and what payment restores it (operator review, 2026-07-31) |
| D-17 | Lapsed proof of insurance (operator review, 2026-07-31) |
| D-18 | **Amends D-4** — vendor stub adapters (operator review, 2026-07-31) |
| D-19 | Lighthouse performance gate vs the Core Web Vitals target (raised by B-016, 2026-07-31) |
| D-20 | Where autopay lives, and what re-auth guards (raised during B-036, 2026-08-04) |
| D-21 | The address of record, and what the `Tenant` address columns are now (raised during B-037, 2026-08-05) |
| D-22 | How receipt numbers are made gapless (raised during B-039, 2026-08-05) |
| D-23 | Building B-095 out of its backlog position, and what the Task entity looks like (raised 2026-08-05) |
| D-24 | How a pending portal move-out request is represented, and why the portal enforces notice while staff don't (raised during B-041, 2026-08-05) |
| D-25 | The metric definitions themselves, settled once (raised during B-042, 2026-08-05) |
| D-26 | Defaulting D-17's auto-enrolment to OFF per facility (raised during B-043, 2026-08-05) |
| D-27 | Anniversary billing as the default, and what the billing day is anchored to (raised during B-044, 2026-08-05; owner chose anniversary) |
| D-28 | How an autopay charge is tied to the invoice it pays, and when that link is written (raised during B-045, 2026-08-05) |
| D-29 | When a failed payment reaches a person, and what the tenant hears (owner decision, 2026-08-06) |
| D-30 | What a pay-now link actually grants (raised during B-051, 2026-08-06) |
| D-31 | Adding `halt_autopay` to the hold effects US-42 listed (raised during B-096, 2026-08-06) |
| D-32 | Which URL a facility page lives at, where two PRDs disagree (raised during B-066, 2026-08-07) |
| D-33 | Whether manually transcribed reviews may power the `aggregateRating` JSON-LD (PRD 04 Open Question Q3, raised during B-071, 2026-08-10) |
| D-34 | Whether B-071's `review_request` is retroactively gated on the `marketing_email` consent this item introduces (raised during B-072, 2026-08-10) |
| D-35 | What FR-LEAD-4's "reservation-started event" maps to, and whether `CheckoutStatus.abandoned` gets used (raised during B-073, 2026-08-10) |
| D-36 | Which "reminder/dunning" templates get an SMS variant, where the backlog line and PRD 05 CN-13 disagree (raised during B-074, 2026-08-10) |
| D-37 | Where a scheduled rate increase lives, and what CN-9's "also queued to postal mail" means for this item (raised during B-076, 2026-08-10) |
| D-38 | Move-out proration divided by the wrong denominator, found while building the transfer (raised during B-077, 2026-08-10) |
| D-39 | Whether a merchandise sale is an invoice line, and where its revenue is reported (raised during B-078, 2026-08-10) |
| D-40 | Whether staff MFA is a per-org toggle, and what happens to the staff magic-link path (raised during B-079, 2026-08-10) |
| D-41 | Whether an org-level default is resolved at runtime or pushed, and how "overridden" is recorded (raised during B-079, 2026-08-10) |
| D-42 | Whether the gate adapter port gains a read side, and what "no drift" is allowed to mean (raised during B-080, 2026-08-10) |
| D-43 | What the one vendor stub is actually for, and what it found (raised during B-080, 2026-08-10) |
| D-44 | Splitting B-081 rather than building it whole (raised during B-081, 2026-08-10) |
| D-45 | What an accepted-but-unsettled bank debit is allowed to do (raised during B-103, 2026-08-11) |
| D-46 | Maps vendor for map *rendering* — the half of PRD 01 §10 OQ-6 that D-14 left open (owner decision, 2026-08-14) |
| D-47 | Which audience an email address belongs to, and who wins when it is both (hit in production on 2026-08-13 bootstrapping the first real owner account, then raised independently as the top finding of BOTH the UX and accessibility reviews, 2026-08-14) |
| D-48 | The three admin routes that fail 1.4.10 Reflow at 320px (owner decision, 2026-08-14, on the accessibility review's finding 7) |
| D-49 | Whether the lease gets an SCRA clause, and what closes the servicemember gap (raised during B-112, owner decision 2026-08-14) |
| D-50 | Reservation hold window: D-7's 7-day default vs. the day-after-move-in rule B-018 actually shipped (found during B-118, 2026-08-14) |
| D-51 | Marketing SMS: build the lane, or record that promotional SMS is out of scope (raised by B-123, owner decision 2026-08-15) |
| D-52 | Protection on a multi-unit checkout: one plan for the basket, one per unit, or a tier chosen per unit (raised by B-106 part 3, owner decision 2026-08-16) |
| D-53 | What a renter signs when one checkout rents several units (raised by B-106 parts 3–4, owner decision 2026-08-16) |
| D-54 | How many gate codes a multi-unit renter is issued (found during B-106 part 5, owner decision 2026-08-16) |
| D-55 | Whether a multi-unit move-in sends one welcome message or N (raised by B-106 part 3, owner decision 2026-08-16) |
| D-56 | Which marker API the search map uses, and the second public value it costs (settled while building B-107, 2026-08-17) |
| D-57 | Which touch gets credit for a move-in when the lead and the checkout disagree (settled while building B-082 part 1, 2026-08-17) |
| D-58 | Where a city page's "unique intro copy per city" comes from, given there is no city record (raised while building B-082 part 2, 2026-08-17) |
| D-59 | What replaces "distance" on a city page, which has no point to measure from (raised while building B-082 part 2, 2026-08-17) |
| D-60 | Whether the size guide moves into `/guides` to complete the hub's launch set (raised while building B-082 part 3, 2026-08-17) |
| D-61 | Which source/medium a session belongs to when its events disagree (settled while building B-082 part 4, 2026-08-17) |
| D-62 | Whether city page intro copy stays generated, or becomes something a person writes (raised by B-082 part 6's own duplicate-content report; owner decision, 2026-08-17; **B-128**) |
| D-63 | Whether B-083's two integrations ship together, and what an unconfigured install does (raised while building B-083; owner decision, 2026-08-18) |
| D-64 | Whether US-40's "management summary pack (monthly PDF)" ships as a PDF (raised while building B-084 part 1, 2026-08-18) |
| D-65 | What "frozen month-end snapshot" freezes, given that some figures can be recomputed later and some cannot (settled while building B-084 part 1, 2026-08-18) |
| D-66 | What a QuickBooks journal posts to, and what it deliberately leaves out (settled while building B-084 part 2, 2026-08-18) |
| D-67 | How a scheduled report knows it has already gone out, and whose authority it runs under (settled while building B-084 part 3, 2026-08-18) |
| D-68 | How unit status becomes historical, and whether that reopens D-65's freeze (settled while building B-131, 2026-08-19) |
| D-69 | How a request carries its impersonation session, given PRD 09 §6.1 names a JWT claim (settled while building B-091 part 2, 2026-08-19) |
| D-70 | How read-only is enforced, and whether FR-12's permanent hard-block list ships as a list (settled while building B-091 part 2, 2026-08-19) |
| D-71 | Whether `impersonation:write` ships at all (PRD 09 OQ-2, asked at Phase A and answered at Phase B; owner decision, 2026-08-19; **B-092**) |
| D-72 | What "filterable by facility" means for a session row that deliberately has no facility (raised while building B-092, 2026-08-19) |
| D-73 | Whether FR-20's frequency threshold is configurable, given the PRD says it is (settled while building B-092, 2026-08-19) |
| D-74 | What a street-rate suggestion is allowed to propose, and what stops "one-click apply" becoming a ratchet (settled while building B-088 part 1, 2026-08-19) |
| D-75 | Where an owner KPI trend gets its history from (settled while building B-088 part 2, 2026-08-19) |
| D-76 | What "IndexNow/sitemap ping automation" can actually mean, given half of it no longer exists (settled while building B-087 part 1, 2026-08-20) |
| D-77 | Whether generated per-city/size landing pages may be indexed, given this codebase has twice refused to mass-produce templated pages (settled while building B-089, 2026-08-20) |
| D-78 | Whether B-090's PWA push layer and two-way SMS inbox get built, given both are conditional in their PRDs rather than committed (owner, 2026-08-20, while splitting B-090) |
| D-79 | Whether a waitlist entry is a `Lead` (settled while building B-090 part 1, 2026-08-20) |
| D-80 | How a waitlist availability email is classified, given the recipient is not a tenant and has no consent record (settled while building B-090 part 1, 2026-08-20) |
| D-81 | Whether a tenant-initiated transfer commits, or only asks (settled while building B-090 part 2, 2026-08-20) |
| D-82 | What holds the requested unit, given B-090's own audit said only business accounts needed a schema change (settled while building B-090 part 2, 2026-08-20) |
| D-83 | Where an inbound text is kept, given D-78 refused the two-way inbox that would have given it a table (settled while building B-135, 2026-08-20) |
| D-84 | Whether a transfer quote a tenant was given binds the completion, given `completeTransfer` re-read the street rate (B-136, 2026-08-20) |
| D-85 | Whether a lease in the lien pipeline may transfer at all, and under whose authority (raised by the 2026-08-21 operator review — **RESOLVED 2026-08-21**) |
| D-86 | Whether arrears and the delinquency clock follow the tenant through a transfer, or stay on the lease that ended (raised by the 2026-08-21 operator review — **RESOLVED 2026-08-21**) |
| D-87 | Whether a waitlist notification holds the unit for its claim window (raised by the 2026-08-21 operator review — **RESOLVED 2026-08-21**) |
| D-88 | What happens to a scheduled rate increase whose notice provably did not arrive (raised by the 2026-08-21 operator review — **RESOLVED 2026-08-21**) |
| D-89 | Whether a UNIT TRANSFER triggers promotional recapture (settled while building B-145, 2026-08-21) |
| D-90 | Whether a failing accessibility scan should BLOCK a deploy, or the public statement should stop claiming it does (raised by the 2026-08-24 accessibility review, **RESOLVED 2026-08-24**) |
| D-91 | Whether moving a `pending_auction` tenant's goods to another unit under D-85 requires RE-SERVING the lien notice (raised while building B-160, 2026-08-24, **RESOLVED 2026-08-24**) |
| D-92 | How far a reversal-re-opened arrear may be pushed down the delinquency ladder, and from where (raised while building **B-161**, 2026-08-24, **RESOLVED 2026-08-24**) |
| D-93 | What rate a UNIT TRANSFER opens the new lease at, and whether a promotion follows the tenant through one (raised while building **B-162**, 2026-08-24, **RESOLVED 2026-08-24**; D-89 named this and handed it to B-157, which shipped without it) |
| D-94 | **What a rule-based ECRI batch raises a tenant TO, and what a newly created facility's step is** (raised by **B-165**, 2026-08-24; the row could not be finished without it) |
| D-95 | **What order the tenant profile takes, and what may be hidden behind a disclosure** (raised by **B-181**, 2026-08-25; the row carried its reviewer's MEDIUM confidence and asked for an operator pass before the order was committed to) |
| D-96 | **What payment satisfies a payment-plan installment** (raised by **B-188**, 2026-08-25; **RESOLVED 2026-08-26**) |
| D-97 | **What autopay does for a lease on an active payment plan, in both directions** (raised by **B-189**, 2026-08-25; **RESOLVED 2026-08-26**) |
| D-98 | **What a payment plan may commit to, and how many a lease may have** (raised by **B-190**, 2026-08-25; **RESOLVED 2026-08-27**; the operator review's grace-days question is folded in here rather than given a row) |
| D-99 | **Whether a short-notice move-out is charged, and on what basis** (raised by **B-194**, 2026-08-25; **B-186 named this and deliberately did not settle it**) |
| D-100 | **Whether a per-person shared-access window may WIDEN the facility's own gate hours** (settled while building **B-086 part 1**, 2026-08-25) |
| D-101 | **How a tenant expresses a shared-access schedule** (settled while building **B-086 part 1**, 2026-08-25) |
| D-102 | **Whether a template has a second, HTML body** (settled while building **B-198**, 2026-08-28) |
| D-103 | What the duplicate-content report lists first, now that B-089's city/size pairs outscore the city pairs (raised by B-200, 2026-08-28 — **RESOLVED 2026-08-28**) |
| D-104 | **Whether the auction lot sheet may be built while OQ-9 is open** (raised by B-129, 2026-08-29; **owner decision**) |
| D-105 | **Where a payment nobody narrowed goes, when the payer is on a payment plan** (settled while building **B-203**, 2026-08-29) |
| D-106 | **Whether a lot missing a required advertisement element is refused from the lot sheet or exported blank** (settled while building **B-205**, 2026-08-30) |
| D-107 | **How long rent the plan never deferred may go unpaid before the plan breaks** (settled while building **B-208**, 2026-08-31) |
| D-108 | **Whether a plan cancelled the day it was agreed spends one of the lease's two for the year** (settled while building **B-209**, 2026-08-31) |
| D-109 | **What date window a report opens on when the URL names none** (raised by **B-220**, 2026-09-01; **owner decision**) |
| D-110 | **Whether `reports:financial` is meant to gate the balance figure the counter needs to take a payment** (raised by the digital-experience review, 2026-09-01; **answered by the owner 2026-09-02**; built by **B-231**) |
| D-111 | **Whether `Tenant.email` stops being required and unique** (raised by the operator review, 2026-09-01; **answered by the owner 2026-09-09**; built by **B-238**) |
| D-112 | **Whether a pay link may survive move-out for a lease that still owes money** (raised by the operator review, 2026-09-01; **amends D-30 if accepted**) |
| D-113 | **What a tenant may pay ahead, and what becomes of a credit balance at move-out** (raised by the operator review, 2026-09-01; **blocks B-225's disposition branch only**) |
| D-114 | **Whether the tenant profile's `Actions` region moves above the reference sections** (raised by the digital-experience review, 2026-09-01; **amends D-95 if accepted**; **B-240 builds the half that does not need it**) |
| D-115 | **What moves `LAST_REVIEWED` on the public accessibility statement, and how often the "Where we fall short" list is re-verified** (raised by the accessibility review, 2026-09-01; **blocks B-250's cadence half only**) |
| D-116 | **What a date somebody types into a `yyyy-mm-dd` field IS, and how every surface reads it back** (settled while building **B-228**, 2026-09-02; **overrides B-228's own prescribed fix**, which was to make `parseDate` stop producing a UTC instant for a facility that has a timezone) |
| D-117 | **A broadcast's classification is the operator's choice, and there are exactly two** (settled while building **B-090d**, 2026-09-04; CN-21 left it unstated) |
| D-118 | **What consolidated billing consolidates — and what it must never consolidate** (settled while building **B-090e**, 2026-09-04; B-090's own audit said this part "needs a schema change" and left the shape open) |
| D-119 | **Attaching a lease to a business account does not move the autopay mandate** (raised by **D-118**, answered by the owner 2026-09-04 while building **B-256**; the row was written for either answer and refused to assume one) |
| D-120 | **What an authorized user on a business account may do, and what they may see** (settled while building **B-258**, 2026-09-04; the row named three things it had to settle rather than assume, and this is all three) |
| D-121 | **Native app vs. PWA for Phase 3 Bluetooth unlock** (PRD 03 **OQ-2**, open since the PRD was written and named by **US-8 AC4**; answered by the spike **B-086 part 2** asked for, 2026-09-04) |
| D-122 | **How a renter gets Spanish, and where the Spanish stops** (settled while building **B-090 part 6**, 2026-09-05; PRD 01 §9 Phase 2 committed to "Spanish-language support (highest-impact i18n)" and specified nothing about it) |
| D-123 | **Whether the SEO surfaces get Spanish, now that the interface has it** (raised by **B-262**, 2026-09-06; **D-122** settled that the crawler stays on English and left open what that means for the prose the crawler reads) |
| D-124 | **Where `/messaging-policy` sits, now that the other static pages are Spanish** (settled while building **B-262**, 2026-09-06; the backlog row listed it among "ordinary prose, translate and go" and it is not) |
| D-125 | **What a Spanish consent record has to look like** (settled with the owner at the start of **B-259**, 2026-09-06; **D-122** left the three checkout disclosures English and **D-124** parked `/messaging-policy` behind this answer) |
| D-126 | **How a template carries a second language: a second ROW, or a second body column on the one row** (settled while building **B-261**, 2026-09-06) |
| D-127 | **Whether the courtesy emails that ACCOMPANY a mailed lien notice may be translated, when D-122 keeps the notice itself English** (settled while building **B-261**, 2026-09-06) |
| D-128 | **Whether an unauthenticated checkout may change the language an EXISTING account is written to in** (settled while building **B-261**, 2026-09-06) |
| D-129 | **Whether an operator's own promotion wording gets a per-language column, or is rendered as typed** (settled with the owner while building **B-269**, 2026-09-07; the GENERATED half of a promotion's terms is keys and numbers by that item, and this is the half that cannot be) |
| D-130 | **What language a message composes itself in when the recipient has no `Tenant` row, or no request to read a cookie from** (settled while building **B-265**, 2026-09-07; the templated path has read `recipient.locale` since **B-261**, and the nine `sendDirectEmail` sends bypass it) |
| D-131 | **Auction channel — live on-site sales versus online** (master PRD §8 open question 9, answered by the owner **2026-09-09**. Open since the master PRD was written; **blocking** since **D-63** (2026-08-18) split **B-129** out rather than answer it by building a driver, and deliberately left unanswered again by **D-104** (2026-08-29) when B-129 shipped the lot sheet — the half that is neutral between the two. Answered at a desk, at the request of a session with an empty buildable queue, rather than out of building a row) |
