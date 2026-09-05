# PRD 01 — Customer-Facing Website

**Module:** Customer-facing website (responsive web, not a native app)
**Parent doc:** `00-master-prd.md` (master PRD)
**Sibling modules:** `02-admin-dashboard-prd.md`, `03-hardware-integrations-prd.md`, `04-marketing-seo-prd.md`
**Status:** Draft v1 — 2026-07-30
**Audience:** Claude Code (build context), engineering, design

---

## 1. Overview & Goals

The customer-facing website is the primary revenue channel for a multi-facility self-storage business. It lets a prospective renter find a facility, compare available units, understand pricing, and either **reserve a unit for free (no payment)** or **complete a full online move-in** — account, lease e-signature, insurance selection, payment, and immediate gate-code issuance — without ever calling or visiting the office. Existing tenants use the same site's **tenant portal** to pay bills, manage autopay, view their gate code, and request move-out.

This mirrors what the industry leaders now treat as table stakes: CubeSmart launched fully online "SmartRental" in 2020 (select a unit, sign the lease electronically, pay, and move in without visiting the office) ([CubeSmart press release](https://www.globenewswire.com/news-release/2020/04/28/2023680/0/en/CubeSmart-Launches-Fully-Online-Rental-Capability.html), [SmartRental page](https://www.cubesmart.com/smartrental/)); Public Storage's contactless "eRental" passed one million online move-ins by early 2022 ([Public Storage](https://www.publicstorage.com/blog/public-storage/public-storage-launches-contactless-move-ins-for-peace-of-mind.html), [milestone coverage](https://markets.financialcontent.com/clarkebroadcasting.mymotherlode/article/bizwire-2022-3-30-public-storage-celebrates-one-million-contactless-move-ins)); Extra Space offers "Rapid Rental" fully-online move-in ([Extra Space](https://www.extraspace.com/rapid-rental/)); U-Haul offers Online Move-In with contact-free access ([U-Haul](https://www.uhaul.com/Storage/Online-Move-In/)). Management platforms like Storable's storEDGE ship a hosted "Rental Center" with e-sign leases and online move-in as a standard capability ([storEDGE Rental Center](https://rental-center.storedge.com/), [storEDGE e-sign](https://help.storedge.com/hc/en-us/articles/212179406-E-sign-Overview)).

### Goals

1. **Convert visitors to renters online.** A first-time, non-technical renter can go from landing page to a signed lease and working gate code in under 10 minutes on a phone.
2. **Reduce office workload.** Online move-in and the tenant portal handle rentals, payments, card updates, and move-out requests that would otherwise be phone calls or counter visits.
3. **Show real inventory, real prices.** Availability and pricing come live from the admin module's inventory — never a stale cache that lets two people rent the same unit.
4. **Serve existing tenants as well as prospects.** The tenant portal is a first-class surface, not an afterthought.
5. **Be accessible and mobile-first.** WCAG 2.1 AA compliance; the majority of storage searches happen on mobile ("storage near me" intent).

### Guiding principle: minimize friction

Every flow decision in this PRD defaults to the lowest-friction option that is still operationally safe. Explicit decisions (detailed in §6.9):

- **Reservation requires no payment and no account** — name, email, phone, move-in date only (industry norm: Public Storage, Extra Space, and CubeSmart all offer free no-card reservations).
- **Account creation happens implicitly during move-in**, not as a gate in front of it (guest-style checkout; the account is created from data the renter already entered, with a set-password step at the end or via magic link).
- **Minimal form fields**, progressive disclosure, one primary CTA per screen, autofill/autocomplete enabled everywhere.

---

## 2. Non-Goals

Out of scope for this module (owned elsewhere or deferred):

- **Admin/staff functionality** — unit inventory management, rate management, delinquency workflows, reporting. → Admin Dashboard PRD. This site *consumes* that data via API.
- **Hardware control logic** — gate controller integration, access-control provisioning, smart locks, cameras. → Hardware Integrations PRD. This site *requests* gate codes and *displays* them; it does not talk to gate hardware.
- **SEO content strategy, blog, local landing-page generation, paid-ad landing pages, review management** — → Marketing/SEO PRD. This PRD covers on-page technical requirements only where they affect core flows (e.g., facility pages must be crawlable/structured-data-ready as an integration point).
- **Native mobile apps** (iOS/Android). This is a responsive website. No push notifications; SMS/email instead.
- **Call center / live chat staffing and chatbot AI.** A click-to-call link and contact form are in scope; chat is a later-phase open question (§10).
- **Delinquency/auction flows for tenants** (lien notices, overlock status display beyond a simple "account past due — call us" state). Full delinquency UX is a later phase coordinated with the admin module.
- **Multi-language support** (later phase; see Phasing).
- **Commercial/business accounts with multiple units under one invoice** (later phase). *Partly built 2026-09-04 (B-090e, **D-118**), and the wording above is corrected by it:* the account is a payer above the lease and there is **no one invoice**. Invoices stay per-lease because a lien attaches to the goods in one unit, a §59 notice names one unit and late fees anchor on one lease's rent — so what an account consolidates is the PAYMENT and the TOTAL, not the document. The payer's one payment settles every lease on the account; the portal view and the authorized users are **B-256**.
- **Marketplace/aggregator listings** (SpareFoot etc.) — Marketing PRD.

---

## 3. Personas Served

| Persona | Description | Primary needs |
|---|---|---|
| **P1. Life-event mover ("Maria")** | 30s–50s, moving house/divorce/downsizing. Stressed, time-poor, on her phone. Not tech-savvy; has never rented storage. | Find a unit near her, understand what size she needs, know the real monthly cost, rent it *now* without a trip to an office. |
| **P2. Deliberate comparer ("David")** | Price-conscious, compares 3–4 facilities in tabs. Wants web deals, will reserve to lock a price but may not commit today. | Transparent pricing incl. fees, promotions clearly explained, free no-card reservation that holds the unit and price. |
| **P3. Existing tenant ("Elena")** | Rents a unit already. Interacts monthly at most. Forgets gate code, wants to pay/update card and get out. | Fast login, pay bill in seconds, autopay, see gate code, download receipts, request move-out. |
| **P4. Vehicle/RV owner ("Frank")** | Needs parking/RV/boat storage. Cares about space dimensions, surface type, access hours. | Filter for parking/covered/uncovered, vehicle-length guidance, gate hours. |
| **P5. Small-business user ("Priya")** | Uses a unit for inventory/tools. Frequent access, needs receipts/statements for bookkeeping. | Drive-up availability, extended gate hours, downloadable statements/receipts. |
| **P6. Assisting family member ("Sam")** | Renting on behalf of an elderly parent; may complete checkout on their behalf. | Simple language, large text, ability to set a different "authorized access" contact. |

Accessibility personas cut across all of the above: screen-reader users, low-vision users (zoom to 200%), motor-impaired users (keyboard-only), and older users unfamiliar with web conventions.

---

## 4. User Stories with Acceptance Criteria

Stories are grouped by feature area. IDs are stable for cross-referencing from tickets.

### 4.1 Location finder

**US-101 — Search by zip/city**
As a prospect, I want to enter my zip code or city so I can see nearby facilities.
*Acceptance criteria:*
- Single search input on the homepage accepts zip, city, or "city, state"; tolerant of casing/whitespace; shows typeahead suggestions after 2 characters.
- Results are sorted by distance from the geocoded query point; each result card shows facility name, distance, address, star amenities (climate control, drive-up, etc.), and "units from $X/mo" (lowest current web rate for an available unit).
- **A price on a result card names its size** *(added 2026-09-01 from the digital-experience review; B-242)*: *"10×10 from $60/mo · 4 more sizes"*. "From $60" with no size ranks a facility whose cheapest unit is a locker above one whose cheapest is a garage, on the list that is the denominator of every rate below it. Each card carries **one lazily loaded photo** where the facility has one and no placeholder frame where it does not — the rule the facility page already follows — and availability is stated in the same truthful vocabulary from the real count, never a badge without a number.
- Browser geolocation ("Use my location") is offered but never required; declining it degrades gracefully to manual entry.
- Zero-results state suggests the nearest facilities beyond the search radius with distances, never a dead end.
- URL is shareable/bookmarkable (`/storage/search?q=78704`).

**US-102 — Map view**
As a prospect, I want a map of facilities so I can judge which is convenient to my route.
*Acceptance criteria:*
- Toggle between list and map (mobile) / side-by-side (desktop ≥1024px).
- Map pins show price-from on the pin or on tap; tapping a pin opens a mini-card linking to the facility page.
- Map is keyboard-accessible or has an equivalent list alternative (WCAG); list view is the default on mobile.
- On mobile, an "Open in Maps" deep link (Apple Maps on iOS, Google Maps otherwise) launches turn-by-turn directions to a selected facility.

**US-103 — Facility detail page**
As a prospect, I want a facility page with photos, hours, amenities, and available units so I can decide without calling.
*Acceptance criteria:*
- Page shows: photo gallery (min 5 photos: exterior, gate, hallway, sample unit, security feature), full address with map embed + directions deep link, office hours and **gate/access hours shown separately and labeled as such**, amenity list (climate control, elevator, drive-up, video recording, lighting, month-to-month terms), and the live unit list (see §4.2).
- Click-to-call phone number (`tel:` link) visible without scrolling on mobile.
- Facility page renders availability from the live inventory API; if the API is down, show cached data with a "call to confirm availability" notice rather than an error page.
- Each facility page has a stable, crawlable URL (`/storage/{state}/{city}/{facility-slug}`) — integration point with Marketing/SEO PRD (structured data, local SEO).
- **Comparison is a two-way door.** When the renter arrives from a search, the facility page carries that context: a back affordance at the top of the page ("← Back to storage near 78704") and the distance from the searched point shown under the address. Any "see other locations" link targets the originating search, not a bare results URL. With no search context the back affordance is absent rather than pointing at an empty results page.

### 4.2 Unit browsing & size guide

**US-201 — Filter and sort units**
As a prospect, I want to filter available units by size and type so I only see relevant options.
*Acceptance criteria:*
- Filters: size category (small ≤5x5, medium 5x10–10x10, large ≥10x15), unit type (climate-controlled, drive-up, indoor/interior, parking/covered parking/RV-boat), floor (ground/upper), and features (electrical outlet, first-floor only).
- Sort: price low→high (default), size small→large.
- Filters apply instantly without page reload and are reflected in the URL query string.
- Each unit row shows: dimensions (e.g., "10x10"), sq ft, type badges, a one-line "holds contents of a 2-bedroom home" hint, web rate + crossed-out in-store rate, active promotion badge, and two CTAs: **Reserve for free** and **Rent now** (see §4.4/4.5).
- Units shown are *unit types with availability counts*, not individual unit numbers; specific unit assignment happens at move-in (matches industry practice and prevents inventory races). When availability for a type is ≤3, show "Only 2 left" scarcity indicator (must be truthful — driven by real counts).

**US-202 — Size guide ("what fits in a 10x10")**
As a first-time renter, I want visual size guidance so I can pick the right unit without guessing.
*Acceptance criteria:*
- A size-guide page and an inline drawer on unit lists show each standard size (5x5, 5x10, 5x15, 10x10, 10x15, 10x20, 10x30, parking spaces) with: a real-world comparison ("large closet," "one-bedroom apartment," "two-car garage"), an illustrated top-down view showing example contents (mattress, boxes, appliances), and typical use cases.
- ~~Optional "size estimator" quiz~~ — **dropped** (see §9 Phase 2). The guide carries the whole job: a photograph of each size with real contents in it, and a plain "fits a one-bedroom apartment" line.
- All illustrations have text alternatives; the guide is informational and never blocks the rental flow.

### 4.3 Pricing display

**US-301 — Transparent pricing**
As a comparer, I want to see the real monthly cost and all fees before I commit so there are no surprises at checkout.
*Acceptance criteria:*
- Every unit shows **web rate** (rate for renting/reserving online) and, when different, the **in-store rate** struck through with a "$X off — online rate" label. (Web rates lower than walk-in rates are standard industry practice; operators steer rentals online with web-only discounts — see [Radius+ on web rates](https://www.radiusplus.com/post/what-in-the-self-storage-web-rates-is-going-on/).)
- Promotions (e.g., "First month free," "50% off first two months") appear as badges with an info tooltip/expander stating exact terms: duration, what the rate becomes afterward, and eligibility (new rentals only, select units).
- A cost summary at unit selection and again before payment itemizes: first month's rent (prorated if applicable — show the proration math), one-time admin fee, insurance premium (if selected), lock (if sold), taxes, and **total due today** plus **ongoing monthly total**. No fee may first appear on the payment step.
- Rent is month-to-month; the site states this plainly ("No long-term contract — month to month").
- Rate-increase policy disclosure (e.g., "rates may change with 30 days' notice") appears in the lease summary — exact copy is a legal open question (§10).
- **Both rates render whenever they differ:** the online rate is the primary figure and the in-store rate is struck through, with the saving stated in words ("$179/mo online · $199 in store — $20 off for renting online"). When the two are equal, one figure renders and no strike-through appears — a struck-through price identical to the price charged is a fabricated discount.
- Each size carries a **"What you'd pay today"** expander, closed by default, itemizing: first month's rent (with a note that a mid-month start is prorated), the one-time admin fee, tax, and a line stating that a protection plan *or* proof of the renter's own cover is required and is chosen at checkout. It foots with **Total due today** and **Then $X/mo**.
- Components not knowable before checkout (proration for a mid-month start, protection tier) are **named and explained, not omitted** — the rule is no surprises, not no unknowns.
- Every dollar figure on a customer-facing page carries a unit or a label; no bare number.
- The total shown at unit selection and the total shown on checkout step 1 are produced by **one shared calculation**, not two implementations. A discrepancy between the two is a release-blocking defect, not a rounding issue.
- **A promotion advertised on a browse surface is inside that surface's total** *(added 2026-09-01 from the digital-experience review; B-226)*. A badge, plus a sentence saying the discount is already in the total below, over a total computed without the discount, is the same release-blocking discrepancy as the clause above: the shared calculation takes the promotion as an input, or the promotion is not claimed on that surface. **The equality is a test rather than a statement** — the facility page's total due today for a promoted size equals the amount due today for a checkout session on that size and code. A money field computed on a card and rendered nowhere is how this defect is produced, so each one has exactly one consumer.

### 4.4 Online reservation (no payment)

**US-401 — Reserve a unit for free**
As a prospect who isn't ready to pay, I want to hold a unit and price with no card so I don't lose it while I decide.
*Acceptance criteria:*
- From any available unit: "Reserve for free" opens a single-screen form: first name, last name, email, mobile phone, desired move-in date (date picker, defaults to today, max N days out — default 14, configurable per admin settings). **No password, no account, no payment.**
- Submitting creates a reservation in the admin system, decrements available count for that unit type, and locks the quoted web rate and promotion until the hold expires.
- Confirmation screen + email + SMS include: facility address, unit size/type, quoted rate and promo, move-in date, hold expiration, a link to **complete move-in online**, and facility phone number.
- Reservation holds expire automatically (default: end of day after scheduled move-in date; configurable). Expiration returns the unit type count to inventory. Reminder notifications go out before expiry (§4.8).
- The renter can cancel the reservation from a link in the email (no login needed — signed token URL).
- Duplicate-reservation guard: same email + same facility + same unit type within the hold window updates the existing reservation instead of creating a second.

### 4.5 Full online move-in

**US-501 — Complete move-in entirely online**
As a renter, I want to sign the lease, pay, and get my gate code online so I can move in immediately without visiting the office.
*Acceptance criteria — the flow is a linear, resumable stepper with these steps:*

1. **Your details.** Name, email, mobile phone, address (autocomplete via address API), date of birth if required by lease. If arriving from a reservation link, all known fields are pre-filled. Optional: alternate contact (required in some states — legal open question), military status (SCRA flag), vehicle details (required only for parking/RV units: type, plate, state).
2. **Move-in date & unit confirmation.** Confirm unit type, rate, promo, and move-in date. The system assigns a specific unit number from inventory at this point (admin API call) and holds it for the duration of the checkout session (30-minute soft lock, extendable while the session is active).
3. **Protection plan.** Renter must either select a tenant-insurance/protection plan (tiered coverage, e.g., $2k/$3k/$5k at $X/mo — plans configured in admin) or actively acknowledge a **waiver** by attesting they have their own coverage (homeowner's/renter's policy — capture provider + policy number, optional upload later). The step cannot be skipped silently; default selection is the mid-tier plan, changeable in one tap. (Requiring insurance-or-waiver at online move-in is standard in storEDGE-class rental flows.)
4. **Lease review & e-signature.** Render the full lease with the renter's details merged; a plain-language summary of key terms (monthly rate, due date, late fees, month-to-month, access hours, insurance selection) sits above the full text. Renter signs by typed-name signature with checkbox consent (E-SIGN/UETA compliant: capture consent to electronic records, IP, timestamp, document hash). Signed PDF is stored and emailed.
5. **Payment.** Stripe-hosted payment element (see §4.6). Itemized total due today (per US-301). **Autopay enrollment is presented default-on with a clear, one-tap opt-out** (decision rationale §6.9). Wallets (Apple Pay/Google Pay) offered first on supporting devices.
6. **Account finalization.** The account was created implicitly from step 1 (email is the identifier). Renter sets a password now **or** skips — a magic-link email lets them into the portal without ever setting one. No email verification wall blocks move-in completion.
7. **Confirmation & access.** Immediately show: **gate code** (large type, copy button), facility address + maps deep link, unit number and a "how to find your unit" map/description, gate hours, lock instructions (bring your own or one was purchased/left in unit — admin-configurable per facility), and next payment date. Same content delivered by email + SMS (§4.8).
   - *(added 2026-09-01 from the digital-experience review; B-239)* The confirmation screen also hands the renter their **account**: a primary "Go to my account" action into the portal using the session just established, the next payment amount and date in words with the autopay state as US-601 already requires, one line on what to bring (a lock, bought here or brought), and what to do if the emailed lease and receipt do not arrive. A screen that has just told a renter "this is your account" and then never shows it to them leaves portal activation entirely dependent on an email being opened.

*Cross-cutting acceptance criteria:*
- Entire flow completes in ≤7 minutes for a median user on mobile; each step is a single screen with one primary button.
- Flow is resumable: leaving and returning via emailed link restores progress (server-side draft keyed to signed token).
- If the specific unit is lost (lock expired and someone else took the last one), the flow offers the nearest equivalent (same type, or next size) at the same or better rate, with an apology — never a silent price change.
- Gate code issuance is an API call to the Hardware Integrations module; if the hardware call fails, the renter still completes move-in and sees "Your gate code will be texted within 15 minutes," a retry queue handles issuance, and staff are alerted via the admin module. Move-in success must not depend on gate-hardware uptime.
- Failed payment keeps the renter on the payment step with a plain-language error and the unit still held for the remainder of the lock.

### 4.6 Payments (prospect checkout + tenant portal)

**US-601 — Pay securely with my preferred method**
*Acceptance criteria:*
- All payment collection uses **Stripe** — Payment Element / hosted components only; card data never touches our servers (SAQ-A scope). Methods: cards, Apple Pay, Google Pay, Link, and ACH bank debit (ACH: portal payments and autopay; optional at checkout).

- **Built in B-103.** Apple Pay and Google Pay are wallets over a card and need no separate handling; Link needs no per-facility switch, because it is a faster way to present a card rather than a different kind of money. **Bank debit is the one with rules (D-45).** It introduced `PaymentStatus.processing` — accepted, irrevocably submitted, not settled — which **posts nothing to the ledger and settles no invoice**, because an invoice reading paid on money that has not arrived is a lie the moment the bank reverses it. What it does do is suppress late fees, dunning and gate suspension, so a tenant is not chased for the four days their money is in transit. At checkout it is **per facility and off by default** (`achAtCheckoutEnabled`), since a move-in hands over a unit and a gate code against reversible money; where it is on, the move-in provisions on `processing` rather than waiting. A debit that bounces after acceptance raises its own high-priority task, distinct from an ordinary card decline: that tenant has a receipt and is about to start getting dunning letters.
- **Autopay enrollment** stores the payment method (Stripe SetupIntent → saved payment method on the Stripe Customer) and charges rent automatically on the due date. Enrollment state is visible and toggleable in the portal (US-704).
- **Autopay default-on carries its disclosure adjacent to the control, not behind a link.** §6.9 permits the pre-selected default only on that condition. Draft copy, to ship with the same "unreviewed draft" convention as the legal pages until OQ-4 closes: *"Autopay is on. We'll charge this card $[X] on the [n]th of each month. We'll email you two days before every charge. Turn it off any time in your account — or here."* with a visible toggle beside it.
- The opt-out is one activation on the same screen — one tap, and one keypress for a keyboard user. It is never a link to a settings page.
- **The disclosure states the state the renter is actually in** *(added 2026-09-01 from the digital-experience review; B-227)*. The paragraph beside the control branches on the current setting: with autopay off it says so, says how the renter will be billed instead, and names how to turn it back on. A static "Autopay is on" rendered under an unticked box is a false statement about recurring billing on the one screen where that is a consent question rather than a copy nit — and the outcome of the toggle is announced in words from a live region, not left to a re-rendered checkbox.
- **One function answers "what recurs on this lease", and every surface quotes that one** *(same review; B-227)*. The recurring figure is rent **plus tax** plus any protection premium, reckoned exactly as the move-in calculation reckons it, and the checkout disclosure, the portal dashboard and the payment-methods screen all call it instead of each summing two columns. The figure names what it includes. Where it cannot be known — a rate increase landing before the next bill — the screen says so rather than printing a stale number. A portal that promises less than the invoice charges is a disputed autopay charge, not a rounding difference.
- The confirmation screen (US-501 step 7) restates the autopay state, the next charge date, and the next charge amount.
- The pre-charge notice (D-11a) is a dependency of this step, not merely a template in the comms backlog: autopay may not ship default-on without it.
- **One-time payments** in the portal: pay current balance or a chosen amount ≥ minimum due; instant receipt (§4.8).
- Failed autopay triggers dunning: automatic retry per configurable schedule (e.g., day 1, 3, 5), notifications at each attempt (§4.8), and a prominent "update card & pay now" portal banner. Delinquency status/fees are computed by the admin module — the site only displays them.
- All amounts, receipts, and statements shown in USD with taxes itemized; Stripe webhooks reconcile payment state with the admin ledger (integration point §7).

### 4.7 Tenant portal

**US-701 — Log in easily**
- Login with email + password **or** passwordless magic link; "forgot password" self-service. Session length 30 days on trusted devices; sensitive actions (change payout of stored card, move-out) re-verify by fresh login or emailed code.

**US-702 — See my account at a glance**
- Dashboard shows: unit(s) with facility, unit number, size, monthly rate; current balance and due date; autopay status; **gate code** behind a "show" tap (with copy button); next payment amount.
- **A past-due account says so, above everything else on the page**, in the problem → consequence → action order of §6.7: "Your account is past due. Your gate code won't open the gate until the balance is paid. **Pay $[X] now**." Pay-now from that banner is ≤2 taps, the same as the normal path.
- **Where access is suspended, the gate-code panel says so instead of displaying a code.** A displayed code that fails at the gate is worse than no code, and it produces the exact support call the portal exists to prevent.
- The banner is **display-only**: it renders whatever delinquency state the ledger exposes at the time it is built and never computes delinquency itself. If no delinquency signal exists yet, the item that builds this dashboard records that as an explicit dependency rather than pulling the delinquency engine forward.
- **Restoration copy is now definite (OQ-11 closed by D-16):** paying restores access automatically, with no staff action, usually within a couple of minutes. The copy must also be honest about what "paying" means — the balance has to reach zero, so a part payment leaves the gate closed. "Pay your full balance of $[X] and your gate code starts working again, usually within a couple of minutes." A banner that implies any payment reopens the gate produces the angriest call the office takes.
- **The restoration copy names the facility's own threshold** *(added 2026-09-01 from the digital-experience review; B-232)*. D-16 stores the qualifying figure per facility precisely so it can be relaxed later, and the default is a zero balance — so the dashboard reads that setting and states the real number instead of restating the default. Where the threshold is zero the copy above is unchanged and correct; where it is not, demanding the full balance for something less would buy is the same wasted trip in the opposite direction.
- **The figure is the tenant's balance across every unit AT THAT FACILITY, less the threshold — never one lease's balance** *(settled while building B-232, 2026-09-02)*. This is not a new rule: it is the rule D-16 already has. An `AccessGrant` is one per tenant × facility and cannot be partially suspended, so the gate decision sums every occupying lease the tenant holds there (`tenantStates`) — and a banner reading one unit's balance told a two-unit tenant that paying unit A would reopen a gate that unit B keeps shut. The dashboard, `/portal/pay` and the suspension notice all take the number from one function (`restoreShortfallCents`), so the three cannot answer this differently.

**US-703 — Pay my bill**
- Pay balance in ≤3 taps from dashboard using saved method or a new one; wallet support.
- **The screen that asks for money says what the money is for** *(added 2026-09-01 from the digital-experience review; B-232)*. The current balance is itemised from the same ledger read that produced the total — rent for the period, each fee with the date it was assessed and in the tenant's words rather than a reason code, protection premium, tax — in the shape the checkout payment step already uses. "Why do I owe this" is the highest-volume call in storage collections, and a two-row summary routes all of it to the phone. Statement rows carry their closing balance, so a month can be found without opening five.
- **Where the amount is editable, the consequence of the amount is stated live** *(same review; B-232)*. On a suspended account, "pay a different amount" says what the entered figure does to gate access — *"$100.00 will not reopen your gate. $437.50 will"* — beside the field, in the same sentence the suspension message uses so the two cannot diverge. A partial payment that silently leaves the gate shut is a wasted trip to the site.
- **What the screen and the message share is the FIGURE, not the string** *(settled while building B-232, 2026-09-02)*. The suspension notice is a seeded `MessageTemplate` a facility may edit, and the screen is a React component; a literal shared sentence would mean either freezing the template or generating copy from code. Both instead read `restoreShortfallCents` — the screen directly, the notice through a new `access.restore_amount` merge field — which is where a divergence would actually have come from. `balance.total` stays available to template authors and is no longer what the shipped copy says.
- **Paying is a permanent destination, not a card on one screen** *(same review; B-239)*. Whenever any lease carries a balance, "Pay" is the first item in the portal's persistent navigation and carries the amount; the one irreversible destination, move-out, sits inside Manage rather than beside it. On a phone a past-due tenant keeps the pay action in reach across the portal, and the top-level row stays within §6.5's four-item limit — Pay replaces Move out, it does not add to it.

**US-704 — Manage autopay & payment methods**
- Toggle autopay on/off; add/remove/update cards or bank accounts (Stripe-hosted forms); set default method; see next scheduled charge.

**US-705 — View lease, receipts, statements**
- Download signed lease PDF; list of all payments with downloadable PDF receipts; monthly statements; insurance/protection selection visible with option to change tier (takes effect next billing cycle) or submit proof of own insurance.

- **The insurance half was built in B-104** at `/portal/protection`. A tier change is **scheduled to the start of the next billing period, never applied today** — even when today is the billing day, because that period's invoice may already have been raised. The reason is not tidiness: a protection premium is a flat monthly charge, so changing it mid-period would mean prorating one, and a prorated premium is a coverage question rather than an arithmetic one ("was this unit covered to $2,000 or $5,000 on the 14th?"). It also stops a tenant upgrading the morning after a break-in and having it apply to the month just gone. **Dropping a paid plan requires current, unexpired proof of the tenant's own cover** — an expired policy is not cover, and letting one justify the drop is the gap D-17 exists to close. **The declaration page can now be attached** — the blob-store gap B-104 left open was closed straight after, on **Vercel Blob** (one token rather than a second cloud account, since the app deploys on Vercel). The upload is optional and its failure is never fatal: the insurer, policy number and expiry date are recorded first, because the expiry is what stops D-17's lapse scan auto-enrolling the tenant into a paid plan and losing it because a photo was the wrong format would be the far worse outcome. The stored type is decided from the **bytes**, not from the upload's declared `Content-Type`; SVG and HTML are refused outright; and the blob URL is never handed to a browser — reads go through an authenticated route that checks who is asking and proxies the bytes with `nosniff` and `Content-Disposition: attachment`.

- **The monthly statements half was built in B-102** at `/portal/statements`, with the same document available to staff from the lease ledger so "can you send me my March statement?" does not require impersonating anybody. A statement is **derived, never stored**: `LedgerEntry` is append-only, so a month recomputes to the same figures forever, and a stored copy would be a second source of truth that could disagree with the ledger the business runs on. It is refused rather than rendered if it does not reconcile — opening balance plus every line must equal the closing balance exactly, and a statement that fails that is a wrong document in front of somebody's accountant. Month boundaries are **facility-local midnight**, not UTC (`zonedMidnight`), so a payment taken at 8pm on the 31st is filed in the month it happened. **Still HTML, not PDF** — the standing B-023 decision: no JavaScript PDF library available here emits tagged PDFs, and an untagged statement is the §6.8.1 failure. The insurance tier-change half of this story is **B-104**.

**US-706 — Update contact info**
- Edit phone, email, mailing address, alternate contact; email change requires confirmation to both old and new addresses.

**US-707 — Request move-out**
- Select unit → "Schedule move-out" → pick date (validation against required-notice rules configured in admin, e.g., no notice or 10-day notice) → see what's owed/prorated per policy → confirm. Confirmation email/SMS sent; the request lands in the admin module for staff verification (unit vacant + clean) before finalization. Tenant can cancel a scheduled move-out before the date.
- **Eligibility is not unconditional (added 2026-08-24, B-164, D-85):** a lease in the lien pipeline does not move out through self-service, for the same reason it does not transfer through it — the goods are being prepared for sale and a tenant must not be able to schedule their own removal unattended, by clicking twice. The lease is **listed and not actionable**, never hidden and never answered with "we couldn't find that unit on your account": a tenant with one unit told that has been told something false and has nowhere to go. The refusal names the lien process in customer language (D-15), carries the facility's own number — falling back to the org line where a facility has none, so a refusal whose only next step is a phone call cannot ship without a number to call — and is a live region present at page load rather than inserted on submit (4.1.3), stating why in text rather than offering a control that silently refuses (3.3.1), with nothing conveyed by colour alone (1.4.1). **Cancelling a request made before the pipeline opened stays allowed**: trapping a tenant with a move-out they cannot withdraw is worse than the hole this closes, and a cancellation moves nobody's goods. The refusal holds on the server too, so a post that never rendered the screen changes nothing. **Staff-side move-out is unaffected** — D-85 settled that side the other way.

**US-708 — Get help**
- Contact page per facility: click-to-call, contact form, hours. Past-due lockout states show a clear explanation and a "pay now to restore access" path where policy allows.

**US-709 — Request a transfer**
*(Shipped at B-090b/B-136; written up here on 2026-08-21 from the UX and accessibility reviews, because the flow existed in the backlog and in the code and in no feature PRD.)*
- See every available unit at my own facility with its size, monthly price and the **difference** against what I pay now; ask for the swap; see what I asked for until staff complete it. The request does **not** commit the transfer (**D-81**) — staff finish it at the counter, because the old unit still has my things in it.
- **The quote binds for as long as the hold lives (D-84)**, and the screen says so with the hold's absolute facility-local expiry date and time. No screen may say the unit is held "until you complete or cancel it": the hold also lapses.
- **A refused preview says why.** Every failure path renders the same problem → consequence → action copy the staff wizard renders from `TRANSFER_PROBLEM_COPY`, in a live region present at page load. A page that re-renders byte-identical after a rejected request is indistinguishable from a broken button (3.3.1, 4.1.3).
- **The requested date carries a ceiling**, enforced on the server as well as by `max` on the input — the same way the public reserve page already does it.
- **A pending request appears on the account home** (US-702), not two taps deep behind a "Manage" disclosure. "Did that go through" is the single question a tenant returns to the portal to answer.
- Eligibility is not unconditional: a lease in the lien pipeline does not transfer through self-service (**D-85**), and the arrears follow whatever **D-86** settles. Neither is decided in this PRD.

**US-710 — See and keep my payment plan**
*(Shipped in part at B-090c; written up here on 2026-08-25 from the fifth review block, because the surface existed in the backlog and in the code and in no feature PRD — the same gap US-709 had.)*
- See the plan I agreed to: every installment, its date, its amount, whether it is paid, and **what is left to pay after it**. Read-only from my side — staff and I agreed it, and one of us changing it alone is not an agreement (the same reason the move-out screen only reads what staff decided).
- **The page does not disappear when the plan does.** A plan that has broken, been cancelled or been completed still renders its schedule and a plain statement of what happened and what it now costs to put right. A tenant whose plan broke last night needs the schedule more than one whose plan is running, and today the only route to it is a dashboard card that unmounts at the same moment (**B-193**; 2.4.5 Multiple Ways requires a second route, and a permanent portal nav entry is it).
- **"Make a payment" carries the installment amount**, with the full balance still one tap away and both labelled. Quoting the whole arrears from an installment schedule offers the tenant the figure the plan exists to replace (**B-193**).
- **Every plan I have had is listed**, not only the most recent one. A tenant on their third plan has paid real money under the first two and can see none of it (**B-190**, **B-193**).
- **I am told, without having to look.** Plan agreed, installment due, plan broken, plan kept — four messages (PRD 05 **CN-24**, **B-191**). The broken one goes the night the hold lifts, before the ladder resumes and before the gate closes; the dashboard card never labels a missed installment "next".
- **A payment that is LATE is not told to me as one that is missed, and the deadline is named** *(added and built 2026-08-31, **B-210**)*. D-98's `planGraceDays` reached only the nightly breach job, so the day after a due date the schedule said "Missed" and the dashboard card said "A payment on your plan was missed" while the plan was in fact alive for three more days — and both plan emails stated the rule as "miss it and the plan ends". Every screen and message states the window the product actually runs: the schedule row reads **"Late — pay by 29 August"**, the card names the deadline and the amount with a pay link carrying that amount, and the agreed-plan and installment-reminder emails say how long there is to catch up. A tenant told their plan has already gone has no reason to pay by the date that would in fact save it. Zero grace is a legitimate configuration and restores the original wording.
- **The dashboard card goes quiet once I owe nothing** *(added and built 2026-08-31, **B-210**)*. "Your payment plan has ended… the full balance above is due now" had no time bound and no balance test, so it rendered for ever — over a $0.00 balance printed directly above it — for every tenant who broke a plan and then paid it off. The plan itself stays on `/portal/payment-plan`, which is where a record of something finished belongs.
- **An installment date is a calendar date in the facility's timezone, everywhere it renders** *(added 2026-09-01 from the digital-experience review; B-228)*. It is a due date on an agreement, not an instant, and one formatter renders it for the dashboard card, the schedule page and the staff-side profile. A date stored at UTC midnight and rendered by surfaces that disagree about the timezone names two different days one tap apart — and the grace deadline derives from the same value, so a tenant who pays on the day the schedule names can have their plan marked broken on the strength of a formatting difference.
- **Accessibility:** the dashboard card is a live region present at page load rather than inserted on change (4.1.3 AA); no plan state is carried by colour alone (1.4.1 A) — including "Late", which is a sentence with a date in it rather than an amber cell (**B-210**); the schedule is a real `<table>` with a `<caption>` and column headers (1.3.1 A); copy is customer language throughout (D-15).
- **Not decided here:** what payment satisfies an installment (**D-96**), whether the installment is auto-collected (**D-97**), and whether a tenant may **request** a plan rather than only view one — see §9.

### 4.8 Notifications (email + SMS)

**US-801 — Keep me informed without spamming me**
*Acceptance criteria — transactional messages (email always; SMS where marked, with opt-in at collection):*

| Event | Email | SMS |
|---|---|---|
| Reservation confirmation | ✓ | ✓ |
| Reservation expiring reminder (24h before) | ✓ | ✓ |
| Checkout resume link (sent when the email is captured at step 1 and the session is still open) | ✓ | – |
| Move-in complete: lease PDF, receipt, **gate code**, unit directions | ✓ | ✓ (gate code + address) |
| Payment receipt (every successful charge) | ✓ | opt-in |
| Upcoming due date (X days before; default 5, admin-config) — sent only when autopay is OFF | ✓ | ✓ |
| Autopay upcoming charge notice (2 days before) | ✓ | – |
| Failed payment (each attempt) | ✓ | ✓ |
| Card expiring soon | ✓ | – |
| Move-out scheduled / completed / final statement | ✓ | – |
| Rate change notice (admin-triggered; site renders in portal too) | ✓ | – |
| Transfer requested (confirmation, both units, no dollar figure — D-81) | ✓ | – |
| Transfer hold expiring (states the absolute local expiry and points at the office, **never** the move-in resume link — CN-23) | ✓ | – |

- SMS requires explicit opt-in checkbox (TCPA); every SMS supports STOP/HELP; quiet hours respected (no SMS 9pm–8am local to the facility).
- Notification preferences page in the portal (transactional payment/legal notices cannot be fully disabled; channel choice only).
- All templates are admin-editable content with merge fields (integration point with admin module); rendering/sending is via a transactional provider (e.g., SES/Postmark + Twilio) — provider choice is an open question (§10).

### 4.9 Accessibility & mobile

**US-901 — Use the whole site with a screen reader / keyboard**
- All flows in this PRD are completable with keyboard only and with VoiceOver/NVDA. See §6.8 for the full WCAG 2.1 AA requirement set (treated as acceptance criteria for every story above).

---

## 5. Functional Requirements

Numbered for traceability. "MUST" = MVP unless the Phasing table says otherwise.

**FR-1 Search & geodata**
1.1 Geocode zip/city input; radius search over facility coordinates; results ranked by distance.
1.2 Facility data (name, address, geo, hours, gate hours, amenities, photos, phone) is sourced from the admin module's facility registry — single source of truth; the website has no facility CMS of its own except marketing copy blocks.
1.3 Map rendering via a mapping provider (Google Maps or Mapbox — open question §10) with static-map fallback for low bandwidth.

**FR-2 Inventory & pricing**
2.1 Unit-type availability, web rate, in-store rate, and promotions are fetched from the admin inventory/pricing API in real time (target: ≤5-minute staleness worst case via cache TTL; checkout availability checks are always live).
2.2 Pricing engine lives in admin; website is display-only and passes a quote token through checkout so the price the renter saw is the price charged (quote token TTL = reservation/checkout hold window).
2.3 Promotions have server-side eligibility validation; the website never computes discounts client-side.

**FR-3 Reservation service**
3.1 Create/extend/cancel reservation; hold decrements availability atomically in admin inventory.
3.2 Signed-token deep links (complete move-in, cancel) with expiry; no login required to act on a reservation.
3.3 Reservation events emitted to admin (for follow-up workflows owned by admin/marketing modules).

**FR-4 Move-in orchestration**
4.1 Server-side checkout session state machine: details → unit-assign → insurance → lease → payment → provisioned. Each transition validated server-side; resumable; 30-min unit lock with heartbeat extension. **Resumability requires a resume link the renter actually receives** — the session's signed token is emailed once the email is captured at step 1 (§4.8), not on abandonment detection, and opening it restores the step the renter left. A draft that only survives while the tab is open is not resumable.
4.2 Lease generation: merge tenant + unit + rate + insurance into facility-specific lease template (templates managed in admin); e-sign capture (typed signature, consent checkbox, timestamp, IP, SHA-256 doc hash); store signed PDF; email copy.
4.3 Insurance: plan catalog from admin config; selection or waiver-with-attestation recorded on the tenant record; premium added to recurring billing.
4.4 Payment: Stripe PaymentIntent for amount due today + SetupIntent for autopay method; idempotency keys on all charge calls; webhook-driven finalization (never trust the client redirect alone).
4.5 Provisioning: on payment success → mark unit occupied in admin, create tenant ledger, request gate code from Hardware module (async with retry queue + staff alert on failure), send confirmation notifications.
4.6 Rollback: if payment succeeds but any downstream step fails permanently, the tenant is still moved in from the customer's point of view; failures create admin tasks, never customer-facing dead ends.

**FR-5 Identity & accounts**
5.1 Email is the account identifier; implicit account creation at move-in step 1; password optional (magic-link auth supported forever, not just onboarding).
5.2 Auth: session cookies (httpOnly, SameSite), rate-limited login, password reset, magic links (15-min expiry, single-use). No third-party social login at MVP.
5.3 One account can hold multiple leases across multiple facilities.

**FR-6 Tenant portal**
6.1 Read models: balance, due date, ledger, lease docs, receipts, statements — all sourced from admin ledger API.
6.2 Actions: one-time payment, autopay toggle, payment-method CRUD (Stripe), contact-info update (syncs to admin tenant record), insurance tier change, move-out request (with notice-rule validation), gate code display (fetched from Hardware module, cached briefly, never stored in browser storage).
6.3 Receipts/statements generated as PDFs; receipts available immediately after webhook confirmation.

**FR-7 Notifications**
7.1 Event-driven notification service consuming events from checkout, Stripe webhooks, admin ledger, and reservation service; per-event templates (admin-editable); email + SMS channels; per-tenant channel preferences; TCPA opt-in/STOP handling; delivery status logged and visible in admin.

**FR-8 Content & legal pages**
8.1 Static/marketing pages: homepage, size guide, FAQ, about, contact, terms, privacy, accessibility statement. Editable via lightweight CMS or markdown-in-repo (open question §10).
8.2 Cookie consent + analytics per privacy requirements (state privacy laws; coordinate with Marketing PRD's analytics plan).

**FR-9 Performance & reliability**
9.1 Core Web Vitals "good" thresholds on mobile (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) for search, facility, and unit pages. These are **field** targets; the CI Lighthouse gate is a separate, looser lab number by design — see master §7.3 and D-19.
9.2 Availability target 99.9% for browse/portal; checkout degrades gracefully (see FR-4.6, US-103).
9.3 All customer PII encrypted at rest; TLS everywhere; payment scope limited to Stripe tokens (SAQ-A).

---

## 6. UX Requirements

### 6.1 Global
- Mobile-first responsive; breakpoints ~360px, 768px, 1024px, 1440px. Every flow designed at 360px width first.
- One primary CTA per screen; primary action is a full-width button in the thumb zone on mobile.
- Plain language throughout, 6th–8th-grade reading level; no industry jargon ("unit type: drive-up ✓ — pull your car right up to the door").
- Persistent header: logo, "Find storage" search, phone number (click-to-call icon on mobile), "Pay bill / My account."
- Skeleton loading states, never spinners >300ms without context; optimistic UI only where safe (never for payment or availability).

### 6.2 Mobile-specific UX (this is a responsive website, not an app)
- Tap targets ≥44×44px with ≥8px spacing.
- `tel:` click-to-call on every phone number; `sms:` optional for the leasing line.
- Maps deep links: `maps://` / geo-intent links so directions open the native app.
- Numeric keyboards for phone/zip/card fields (`inputmode`); autocomplete attributes on all identity/payment fields (`autocomplete="name|email|tel|postal-code|cc-*"`).
- Wallet buttons (Apple Pay/Google Pay) shown above the card form when available — one-tap payment is the fastest mobile path.
- No hover-dependent interactions; filters open as bottom sheets on mobile.
- Sticky "Reserve / Rent now" bar on unit list and unit detail on mobile scroll.

### 6.3 Search & facility pages
- Search-first homepage: the zip/city input is the hero.
- Facility page hierarchy: photos → name/address/call/directions → gate & office hours → available units (with filters) → amenities → map → FAQ.
- Gate hours vs office hours must never be conflated; label explicitly ("Office: 9–6 · Gate access: 6am–10pm daily").
- **The shipped page does not follow this order and B-118 corrects it** — photos render last, after the hours table, every unit card and the long description, so the image a renter judges the site on arrives after everything they scroll past. The header comment that explained the omission ("nothing in the product stores a photo yet") went stale at B-067 and is why nobody re-checked.
- **Open, pending an owner call — where the hours tables sit.** The UX review of 2026-08-12 argues the two hours tables belong *below* the unit list (nobody chooses a facility on gate hours; everybody chooses on size and price), with a one-line summary in the header block — "Office 9–6 · Gate 6am–10pm" — satisfying the never-conflate rule at the top. That contradicts the ordering written above, so it is **not** in B-118's scope and must not be built until the owner decides. Photos-first is not part of the question: the PRD and the review agree on it.

### 6.4 Checkout stepper
- Progress indicator with step names; back navigation never loses data.
- Each step ≤7 visible fields; optional fields marked "(optional)" — required is the default and unmarked.
- Errors inline, next to the field, in plain language, announced to screen readers (`aria-live`); the page scrolls to the first error.
- Price summary persistently visible (collapsible on mobile) through all checkout steps; **total due today** never changes without an explicit intervening choice by the user.
- **The summary is part of the stepper's chrome, not part of the payment step.** It is built with the stepper and renders on every step, including the ones that ship before payment exists. Contents: unit size + facility, total due today (itemized, expandable), ongoing monthly total, move-in date. On mobile it collapses to one sticky line — "Due today $X · then $Y/mo · tap for detail".
- Any step that changes either total states the cause in the same breath as the change ("Protection plan added: $12/mo") and announces it to assistive technology. A total that changes silently between steps is a defect.
- The summary's numbers come from the same shared calculation as the unit-selection total (US-301) — one implementation, two surfaces.
- Lease step: plain-language summary card first; full lease scrollable below; signature control disabled until the summary has been rendered (not until "scrolled to bottom" — that pattern is hostile and fails on screen readers).

### 6.5 Tenant portal
- Dashboard answers the three questions in one glance: *what do I owe, when is it due, what's my gate code.*
- "Pay now" reachable in ≤2 taps from login; amount pre-filled with balance due.
- **"Pay" is a permanent top-level destination whenever a balance exists, and move-out is not** *(added 2026-09-01, B-239)*. The persistent row stays at four or fewer items, so Pay replaces Move out, which belongs inside Manage beside "Move to another unit" — that it is irreversible is an argument for filing it, not for featuring it.
- Gate code hidden behind a tap ("Show gate code") to reduce shoulder-surfing, with copy-to-clipboard.

### 6.6 Trust & friction-reduction surface
- Show "Free cancellation · No credit card needed" beside the Reserve CTA.
- Show "Month-to-month · No long-term commitment" beside Rent now.
- Security messaging at payment ("Payments secured by Stripe"); no fake urgency; scarcity labels only from real inventory counts (US-201).

### 6.7 Empty/error states
- Every error state names the problem, the consequence, and the next action, in that order ("We couldn't hold unit 214. Your card was not charged. Here are similar units…").
- Full-page errors always include click-to-call for the nearest facility — a human fallback for P1-type users.

### 6.8 Accessibility — WCAG 2.1 AA (acceptance criteria for every flow)
- Semantic HTML, landmarks, correct heading order; all interactive elements keyboard-operable with visible focus (≥3:1 focus indicator contrast).
- Color contrast ≥4.5:1 text, ≥3:1 UI components; color never the sole carrier of meaning (e.g., availability badges have text).
- All images/illustrations have meaningful alt text (size-guide diagrams get full text equivalents); form fields have programmatic labels; errors associated via `aria-describedby`.
- **Error identification reaches the control, not only the summary (3.3.1).** Every control that can be invalid carries `aria-invalid` and an `aria-describedby` pointing at its own message — **checkboxes and radio groups included**, with the pair on the `<fieldset>` for a group rather than on each radio. A summary block alone is not enough: screen-reader users overwhelmingly navigate a failed form by form-control (VoiceOver `Ctrl-Opt-Cmd-J`, NVDA `F`), and in that mode a form whose errors live only at the top reports every control as valid. The shared field component is the one place this is wired, so it must cover every control type it is asked to render — the review of 2026-08-12 found it stopped at `<input>` and `<select>`, which is exactly where the omission happened.
- Reflow to 320px CSS width without horizontal scroll; text resizable to 200%; respects `prefers-reduced-motion`.
- Map views have list equivalents; date pickers allow manual text entry; session-timeout warnings with extension option (checkout lock warning at T-5 min).
- Third-party embeds (Stripe elements, maps) chosen/configured for accessibility; Stripe Payment Element meets this.
- CI includes automated a11y checks (axe) on all key templates + manual screen-reader test on the two golden paths (rent online; pay bill) each release. Public accessibility statement page.
- **The accessibility statement claims only what is true today.** Every conformance claim on that page names a mechanism that exists (a CI job, a recorded manual pass, a shipped pattern); anything not yet true belongs in its "where we fall short" section with the item it waits on, and the page carries a dated "last reviewed" line. An overstated statement converts a fixable bug into an alleged misrepresentation.
- **A claim about CI names the gate that actually stops a ship (added 2026-08-24 from the accessibility review — B-159).** "Failing scans block a release" is a claim about **deployment**, not about a workflow's exit code: while the host's Git integration builds a push to `main` in parallel with Actions and independently of its result, the only true sentence is that the scans *run*. The statement says what runs, on which events, or the deploy gate exists and the stronger sentence is earned — never the stronger sentence without the gate. **A generated coverage-exception list names pages, and must say so.** The list is route-keyed by construction (it is derived from the route lists the run uses), so no post-interaction state can ever appear in it; the sentence introducing it therefore states that it names pages and that post-interaction states are not all covered, until the state-keyed contract in PRD 02 §5.5 FR-25 makes them enumerable. **A claim scoped to some routes is scoped in the sentence** — asserting undecidable (`incomplete`) results on the public route loop is not the same as asserting them on the checkout steps. **Correcting an overstated claim does not move the "last reviewed" date**: the date belongs to a re-verification of the "where we fall short" list, not to a retraction.
- **Automated scanning is a floor, not the definition of done.** Axe checks text contrast but has no opinion on focus-indicator or UI-component boundary contrast, cannot judge whether a live region was announced, and only ever sees a freshly loaded page. The token pairs (`--ring` and the operable-control border against their backgrounds) get a unit test asserting ≥3:1; live regions get a structural test asserting the region is in the DOM *before* the event that fills it; error and post-interaction states get their own scans.
- **The statement's coverage-exception list is generated, not written by hand** (added 2026-08-21 from the accessibility review). Every route the automated run does not cover is named on the page because the page reads the same route lists the run reads. A hand-maintained exception list goes stale on a *merge* rather than on an edit, which is precisely how a linked, static portal page came to be covered by no scan and disclaimed by no sentence — the statement named exactly one exception while five routes were unscanned. This page is a public claim about the codebase: an overstated one converts a fixable bug into an alleged misrepresentation, and an understated one publicly certifies that the money path was never assessed. It has gone false in both directions inside twelve days, so the mechanism matters more than the wording.

#### 6.8.1 Per-flow accessibility acceptance criteria

§6.8 states the rules; this section states them as the acceptance criteria the individual backlog item carries, because the item row is what a build session actually loads. Every row below inherits §6.8 in full — these are the additions specific to that flow.

| Flow | Additional acceptance criteria |
|---|---|
| **Unit browsing, filters, size guide** (US-201/US-202) | Result and filter counts announce from a live region present at page load ("7 sizes match"). Filter and sort controls never auto-submit on change (3.2.2). Every size-guide diagram carries a text equivalent describing what fits, adjacent to the diagram, not inside a long `alt`. Truthful-scarcity indicators never rely on colour or an icon alone. The web-vs-in-store comparison is a table with headers, not two coloured numbers. Any rendering of a dimension string (`10×20`) carries the `sr-only` expansion shipped in B-016 ("10 foot by 20 foot") — U+00D7 announces as a multiplication operator. |
| **Reservation hold & magic links** (US-401, pay-now links) | Hold expiry is communicated as an absolute local date and time in text ("expires Friday 8 Aug, 5:00 PM"), not a countdown; any countdown is pausable or extendable (2.2.1). A cancel link from an email lands on a confirmation page — an irreversible action never fires from a `GET` (3.3.4). A scoped payment session warns before expiry and offers extension rather than dropping someone mid-payment. |
| **Checkout stepper** (FR-4.1) | The 30-minute unit lock is a time limit: a warning at T-5 min offers "extend" in one activation and is announced via a live region already in the DOM. The extension control is keyboard-reachable and returns focus where the user was. The heartbeat must not be the only thing holding the lock — a screen-reader user reading a long lease step generates no input events, and an idle-based heartbeat drops that user specifically. Expiry never silently rewrites the page: the unit-lost fallback moves focus to its own heading and is announced. Each step transition moves focus to the new step's `<h2>` and announces "Step 3 of 5, protection plan". The progress indicator carries text, with `aria-current="step"` on the current step. **The live region that announces a transition lives above the step, not inside it.** A message returned into the step's own form is rendered into a component the re-render then unmounts — the announcement and the region holding it are removed in the same commit that would have delivered it, so a renter who fills in a step, presses Continue and hears nothing has no way to tell success from failure but to read the whole document again. The region survives the step change; the announcement names the destination ("Your unit — step 2 of 6"), not the departure. **The T-5-minute warning is delivered without the renter doing anything.** A remaining-time value computed once per server render only warns somebody who happens to submit or reload inside the last five minutes — on the lease step, the longest one by design, a renter reading generates no renders and is never warned at all, which fails 2.2.1 however good the extend control is. A client timer surfaces the warning into the pre-existing region and changes only what is *displayed*, never what is submitted; the announcement fires once, not on every tick. |
| **Renter details** (US-501 step 1) | Every field carries the correct WCAG `autocomplete` token (`given-name`, `family-name`, `email`, `tel`, `address-line1`, `address-level2`, `postal-code`) — 1.3.5 is an AA criterion and is failed by omission. `inputmode` matches the data and only the data: `numeric` belongs on a zip-only field, never on a field that also accepts letters. Any address autocomplete is a native `<datalist>` or a spec-conformant ARIA 1.2 combobox with managed `aria-activedescendant`, with results announced as a count. |
| **Protection plan** (US-501 step 3) | Plan options are a `<fieldset>` with a `<legend>` and real radios; the preselected mid-tier announces as selected on entry. The attestation checkbox is unchecked by default and has its own visible label. **Continue is never disabled** — it submits and fails loudly with focus moved to an identified, announced error. A disabled button is invisible to a user who cannot see why it is disabled. The premium's effect on the recurring total is announced when the selection changes. |
| **Lease review & e-signature** (US-501 step 4) | The on-screen lease carries the same heading structure as the document and is keyboard-scrollable — not a fixed-height clipped div and not an image. The plain-language summary is page content preceding the full text, not a tooltip. The typed signature is a labelled `<input>` with instructions stating what typing the name constitutes; consent is a separate labelled checkbox. A review step shows the exact terms with the ability to go back and correct before the signature commits (3.3.4). |
| **Generated PDFs** (leases, receipts, notices) | Generated PDFs are tagged: heading structure, reading order, table headers, document `lang`, `/Title` metadata, and real text rather than a rasterised page. A lease emailed to a tenant is content they must be able to read; an untagged PDF fails 1.1.1/1.3.1/1.3.2 years before anyone notices. |
| **Payment step** (US-501 step 5) | An itemised review of everything charged today with a distinct confirm action, and back-navigation to any earlier step without losing entered data (3.3.4). The itemised total is a `<table>` or `<dl>` so each amount announces with the thing it is for. The Stripe Payment Element is configured with an `appearance` theme meeting 4.5:1 text and **3:1 borders and focus rings** — Stripe's defaults inherit the same weak-border look this codebase has already had to fix. The checkout route joins the axe list (axe does inject into cross-origin frames), and because contrast over the Element's own surfaces returns undecidable, the scan is paired with a manual keyboard and screen-reader pass and Stripe's current VPAT on file before the item merges. Declined-card and validation errors from inside the Element are mirrored into a page-level live region with focus moved to them. Autopay default-on has a real `<label>`, `aria-describedby` pointing at the pre-charge disclosure, and an opt-out in the same tab sequence. **The in-flight state uses `aria-busy` and a changed label, never `disabled`, and is announced from a pre-mounted `role="status"` ("Taking payment. This can take a few seconds.")** with re-entry guarded in the handler. Disabling the element that currently holds focus blurs it to `<body>` in Chromium and Safari, and a confirmation against a live network is three to ten seconds — considerably longer through 3-D Secure — so the sequence a screen-reader user actually gets is: press Pay, lose their place in the document, hear nothing, then either a decline or a full page change. The realistic response to that silence is a second press or a browser Back, during a card authorisation. This rule is not new here — PRD 02 FR-20 states it for admin and `use-my-location.tsx` documents it in the code — and it applies identically to the portal's pay screen, which is a deliberate near-duplicate of this one. |
| **Portal dashboard & gate code** (US-702) | The reveal control is a `<button>` with `aria-expanded`, and the revealed code is announced. The code announces character by character — a six-digit code read as "four hundred eighty-two thousand…" is useless. "Copied" is announced, not only shown as a transient toast. This is the toast pattern every later surface will copy, so it is specified once, with a region that persists in the DOM. **Where a tenant holds more than one lease, each lease's card names its unit BEFORE it states any money** (added 2026-09-01 from the accessibility review — B-244). The unit heading is the first child of the card and the card is a region named by it (`aria-labelledby`), so a balance, a late plan installment and a Pay button announce under the unit they belong to rather than under the previous card's heading (1.3.1); an unnamed `<section>` is not exposed as a landmark, so there is no second mechanism to fall back on. **Any scan of this screen runs as a multi-lease tenant** — a single-lease fixture cannot see this failure, which is why it shipped. |
| **Portal transfer request** (US-709) | Size options are real radios in a `<fieldset>` with a `<legend>`, and a size renders as two elements (`10` and `10`) rather than a raw `×` inside the option's accessible name (1.3.1) — the two-span pattern is already shipped on the public site. The hold expiry is an absolute local date and time in text, never a countdown (2.2.1). Every refusal — a lost unit, an ineligible lease, a failed price preview — reaches a live region that was in the DOM **before** the submit (3.3.1, 4.1.3), and the requested-date input carries both a `max` and a server-side ceiling. A pending request is visible on the account home, not only behind a disclosure. |
| **Waitlist & lead capture forms** (waitlist notify-me, PRD 04 US-8) | The success and failure region is **mounted at page load and mutated**, never inserted on submit — an inserted `role="status"` announces to nobody (4.1.3). Where the submit control is removed or replaced on success, focus moves deliberately to the region or the heading and may not fall to `<body>` (2.4.3). This is the `AdminForm` behaviour B-111 made product-wide; these two marketing forms are the surfaces it never reached. |
| **Cookie consent banner** (FR-8.2) | Dismissible entirely by keyboard, with focus moved into it on appearance and returned on dismissal, and no trap — consent banners are the most common source of shipped keyboard traps. It does not obscure content at 320px or at 200% zoom. "Reject" is as reachable and as prominent as "Accept". |

### 6.9 Friction-reduction decision log (explicit)
| Decision | Choice | Rationale |
|---|---|---|
| Account before reservation? | **No.** Name/email/phone/date only. | Industry norm; every added field costs conversion; the reservation *is* the lead. |
| Account before move-in? | **Implicit account, guest-style.** Password optional (magic link forever). | Forced registration is the classic checkout killer; the renter already gave us everything an account needs. |
| Payment for reservation? | **No card, free hold with expiry.** | Matches Public Storage/Extra Space/CubeSmart; card-required holds suppress top-of-funnel. |
| Autopay default | **Pre-selected ON with clear one-tap opt-out + pre-charge notice email.** | Reduces delinquency dramatically; disclosure + notices keep it fair. Must be visibly disclosed at enrollment (not buried). |
| Insurance step | **Explicit choose-or-waive; cannot silently skip; mid-tier preselected.** | Protects both parties; forced-choice avoids "surprise fee" complaints while keeping attach rate. |
| Form fields | Minimum legally/operationally required; address autocomplete; DOB only if lease requires. | Every field must justify itself; PM sign-off required to add any field to checkout. |
| ID verification (scan license) | **Not at MVP.** Attestation + payment instrument only; revisit if fraud warrants. | ID-scan steps are high-friction; industry is mixed. Open question §10. |

### 6.10 Customer lexicon (binding on every public surface)

Recorded as **D-15**. The industry's vocabulary is not the renter's, and the shipped site has already drifted three ways for one concept ("unit type" in code and admin, "sizes" on the facility page, "unit types" in the FAQ). One word per concept, used everywhere a customer can read it:

| Concept | Customer word | Admin/internal word |
|---|---|---|
| The dimensions (10×20) | **size** | unit type |
| The thing that is rented | **unit** | Unit |
| Price for renting online | **online price** | web rate |
| Price for renting at the counter | **in-store price** | street rate |
| When the gate opens | **gate hours** | gate hours |
| When the office is staffed | **office hours** | office hours |

- "Unit type", "street rate", "web rate", "lease", and "delinquent" are admin words and do not appear on customer-facing pages.
- Copy states what is actually true of the two prices: the online price applies to **renting** online, not to reserving. The FAQ answer reads "Some sizes cost less when you rent online than when you rent at the counter. Both prices are shown before you commit, so you can see which applies to you."
- No internal identifier — backlog IDs, entity names, status enums — may appear in any customer-reachable route, including `/login` and error states. This is checkable: a test asserts no `B-0\d\d` string renders under the public route group or `/login`.
- One money formatter serves every customer-facing price (`formatRate()`, shipped in B-016): `$129/mo`, no trailing zeros.

---

## 7. Data & Integration Points

The website is a thin, well-behaved client of the platform APIs. It owns *presentation, checkout orchestration state, and web sessions*; everything else is owned elsewhere.

### 7.1 Admin module (system of record) — see `02-admin-dashboard-prd.md`
| Data / capability | Direction | Notes |
|---|---|---|
| Facility registry (address, geo, hours, gate hours, amenities, photos, phone) | Admin → Web | Read API + cache w/ TTL; webhook/cache-bust on change |
| Unit-type inventory & availability counts | Admin → Web | Live check at reserve & checkout; cached (≤5 min) for browse |
| Pricing (web/in-store rates), promotions | Admin → Web | Quote token flows back through checkout (FR-2.2) |
| Reservations (create/cancel/extend, holds) | Web → Admin | Atomic availability decrement in admin |
| Tenant record, lease creation, unit assignment, move-in provisioning | Web → Admin | Checkout finalization writes here |
| Ledger: balance, due dates, charges, receipts, statements | Admin → Web | Portal read models |
| Move-out request | Web → Admin | Staff verification workflow lives in admin |
| Insurance plan catalog, lease templates, fee schedule, notification templates, hold-window & notice-rule config | Admin → Web | All policy knobs configured in admin, consumed here |
| Delinquency status (past-due, overlocked) | Admin → Web | Display-only banner + pay path |

### 7.2 Hardware integrations module — see `03-hardware-integrations-prd.md`
- **Gate code issuance:** Web (via backend) requests code on successful move-in; async with retry queue; SLA target ≤15 min worst case, instant typical. Web never talks to gate hardware directly.
- **Gate code display:** Portal fetches current code per tenant; codes revoked/rotated by hardware module on delinquency or move-out (policy from admin).
- Failure isolation: gate integration downtime must not block move-in completion (FR-4.5/4.6).

### 7.3 Stripe
- Payment Element (cards/wallets/Link/ACH), Customers, PaymentIntents (one-time), SetupIntents + saved methods (autopay), webhooks (`payment_intent.succeeded`, `charge.refunded`, `invoice.*` if Stripe Billing is used — open question §10), Stripe-hosted receipts optional (we send our own branded receipts).
- Reconciliation: webhook events post to the admin ledger; the ledger, not Stripe, is the tenant-facing source of truth for balance.

### 7.4 Third-party services
- Geocoding + maps (Google Maps Platform or Mapbox — §10); address autocomplete (same provider); email (SES/Postmark — §10); SMS (Twilio — §10); e-signature: built-in typed-signature capture (not DocuSign) at MVP — §10.

### 7.5 Marketing/SEO module — see `04-marketing-seo-prd.md`
- Website exposes: crawlable facility/city URLs, structured data hooks (LocalBusiness/SelfStorage schema), analytics events (search, facility view, unit view, reserve start/complete, checkout step funnel, move-in complete, portal payment), UTM passthrough into reservation/move-in records for attribution, and promo-code entry hook at checkout. Content/campaign strategy lives in the marketing module.

### 7.6 Key entities referenced (canonical schemas owned by admin PRD)
`Facility`, `UnitType`, `Unit`, `RateQuote`, `Promotion`, `Reservation`, `Tenant`, `Lease`, `InsuranceSelection`, `LedgerEntry`, `Payment`, `GateCredential`, `NotificationEvent`. This PRD introduces web-owned entities only: `CheckoutSession`, `WebSession`, `NotificationPreference` (tenant-scoped, synced to admin).

---

## 8. Success Metrics

| Metric | Definition | Target (12 mo post-launch) |
|---|---|---|
| **Online move-in conversion** | Move-ins completed online ÷ unit-page "Rent now" starts | ≥ 40% |
| **Visitor → rental conversion** | Move-ins (online) ÷ unique facility-page visitors | ≥ 3% |
| **Reservation → move-in rate** | Reservations that convert to a lease | ≥ 55% |
| **Share of rentals that are fully online** | Online move-ins ÷ all move-ins (incl. in-office) | ≥ 50% |
| **Median time to complete move-in** | Checkout start → gate code issued | ≤ 8 min |
| **Checkout abandonment by step** | Funnel drop-off per stepper step | No single step >25% drop |
| **Autopay attach rate** | New move-ins enrolled in autopay | ≥ 70% |
| **Insurance/protection attach rate** | Move-ins selecting a plan (vs waiver) | ≥ 60% |
| **Portal payment share** | Payments made via portal (incl. autopay) ÷ all payments | ≥ 80% |
| **Support deflection** | Calls per move-in; calls per 100 tenants/mo | ↓ 30% from baseline |
| **Core Web Vitals** | % of mobile page loads passing all three | ≥ 75% |
| **Accessibility** | Zero WCAG 2.1 AA blockers on golden paths per release audit | 0 blockers |
| **Notification deliverability** | Email delivered ≥98%; SMS ≥97% |
| **Uptime** | Browse + portal availability | 99.9% |

Instrumentation: full checkout-funnel events (per §7.5) from day one — the funnel is the product's primary diagnostic.

---

## 9. Phasing

### Phase 1 — MVP (build first; end-to-end golden paths)
1. Location search (zip/city, list view), facility detail pages (photos, hours, gate hours, amenities, click-to-call, maps deep link).
2. Unit browsing with filters (size, climate, drive-up, parking), live availability counts, web-vs-in-store pricing, promotions, static size guide page.
3. Free online reservation with hold, expiry, email+SMS confirmations, cancel link.
4. **Full online move-in:** implicit account, insurance choose-or-waive, lease e-sign, Stripe payment (cards + Apple Pay/Google Pay), autopay enrollment, gate code issuance + confirmation email/SMS.
5. Tenant portal: dashboard (balance/due/gate code), one-time payment, autopay toggle, payment-method management, view/download lease + receipts, update contact info, move-out request.
6. Notifications: the full transactional table in §4.8.
7. WCAG 2.1 AA on all shipped flows; mobile-first responsive; Core Web Vitals budget; analytics funnel events.

### Phase 2 — Fast follow
- Map view with pins/price bubbles; "use my location."
- Richer size-guide illustrations. **The interactive size-estimator quiz is dropped** (operator review, 2026-07-31): renters do not complete quizzes, and a static size guide with photographs and "fits a one-bedroom apartment" copy converts better for a tenth of the cost. The static guide (US-202, B-017) stands; reopen the quiz only with evidence that the guide is failing.
- ACH at checkout (portal-only ACH may ship in MVP if cheap); Stripe Link.
- Monthly statements center; insurance tier change + proof-of-insurance upload in portal.
- Reservation follow-up nudges (coordinated with marketing module); promo-code entry field.
- Scheduled/future-dated move-ins beyond 14 days; multi-unit rental in one checkout.
- Spanish-language support (highest-impact i18n).
  - *Built B-090f, 2026-09-05 (**D-122**) — the move-in path.* Locale is a cookie (`st_locale`) set by a header toggle, and the URLs do not change: `/storage/tx/austin/demo-austin-south` is one URL in both languages, and Googlebot — which carries no cookie — keeps seeing the English pages PRD 04 §3 scopes it to ("Multilingual SEO — English-only in MVP"). `<html lang>` follows the cookie (SC 3.1.1) and the toggle's buttons carry their own `lang` (SC 3.1.2). **What is translated is the interface and not the content (D-122):** every label, button, heading, status, error and instruction from the homepage through search, the facility page and all six checkout steps, plus the shared chrome — and not operator-typed data, generated SEO prose, the guides, the admin surface, or anything a lawyer wrote. §6.10's lexicon binds in Spanish too, one word per concept: tamaño / unidad / precio en línea / precio en tienda / horario de la puerta / horario de oficina, with `contrato` keeping the agreement out of the customer's Spanish exactly as D-15 keeps "lease" out of their English. Register is **usted**.
  - *Open after B-090f:* the three consent disclosures on checkout step 1 are still English and deliberately so — a translated TCPA/E-SIGN disclosure recorded against an English version constant is evidence of a consent nobody gave (**B-259**). The Spanish also stops at the move-in path: the city and size landing pages, the facility FAQs, the guides, the static/legal pages and **the portal a renter is sent to at the end of checkout** are all still English (**B-260**). And the cookie is a browser preference, not a durable one — every email and text, including the dunning ladder, still goes out in English to a renter who rented in Spanish (**B-261**).

### Phase 3 — Later
- Live chat / AI assistant *(do not build yet — see B-090's row; B-097 phone lead capture is the fix)*; kiosk-mode variant of checkout for in-office self-service *(PRD 03 §8 defers with a default answer of no; B-085)*.
- Business accounts (multi-unit consolidated billing, additional authorized users).
  - *Built B-090 part 5, 2026-09-04 (**D-118**) — the money half.* `BillingAccount` (one facility, a name, a payer `Tenant`) and a nullable `Lease.billingAccountId`, with `Lease.tenantId` untouched: the person whose goods are in the unit and the person who pays are different facts, and only the first is served a notice. One `where` fragment (`payableLeaseFilter`) widens what a payment may settle, so the counter, the portal, a pay link and autopay's plan narrowing all inherit consolidation without knowing accounts exist — as a UNION, so a tenant may always still pay for their own unit. A **composite foreign key** pins a lease and its account to the same facility, because `Payment.facilityId` is not nullable and a cross-site attachment would settle out of the wrong drawer and accounting period. Managed at `/admin/billing/accounts` under `billing_accounts:manage`.
  - *Built B-256, 2026-09-04 (**D-119**) — the portal half.* One account card at `/portal` for the payer: the account's units with their own tenants named, one total, one Pay button to `/portal/pay?account=`, and a consolidated statement month at `/portal/statements/account/[accountId]/[period]` whose every row links into the unit's own document — a summary **over** the per-unit statements, never instead of them, because `Invoice` stays per lease (D-118). `payableLeaseWhere` is the one definition of what an account lets a tenant reach, read by the pay screen, the nav's Pay link and the statements list, so what a payer may SEE and what they may PAY cannot drift apart. A lease the viewer holds *and* pays for through their own account keeps its lease card but not a second Pay button; a lease somebody ELSE pays for keeps its own tenant's Pay button and gains a line naming who is billed, so nobody pays it twice. **Autopay does not move — D-119**, and the card says so.
  - *Built B-258, 2026-09-04 (**D-120**) — the authorized users.* `BillingAccountMember` (an account and a `Tenant` who holds no lease), managed under `billing_accounts:manage` on `/admin/billing/accounts/[id]` in the same item as the table. A member gets **the account card at `/portal` and nothing that moves money — D-120**: no Pay button, and `payableLeaseWhere` is deliberately unchanged, so what a member may see is now a strict superset of what they may pay for rather than an equality. They see the account's units, each unit's balance and the one total; they do not see the renters' names, and the account's statements stay the payer's, because the consolidated month is a row per unit naming its renter with a link into that renter's own full ledger. Nothing here mints an identity: a member is an existing `Tenant`, so they sign in and resolve as a tenant with no change to `resolveAudience` (D-47).
  - *Open after B-258:* a member cannot see the account's **statements** — the consolidated month or the per-unit documents — so a bookkeeper reconciling last month still has to ask the payer. Deliberately its own decision rather than a side effect of this one (**D-120**), and it needs an answer to what a member sees of a unit's own ledger before it can be built. Also unbuilt: a member who may PAY, payer-level autopay, a PO number and a per-account allocation order.
- Referral program surface; tenant reviews on facility pages (with marketing module).
- Waitlists for sold-out unit types with notify-me.
  - *Open after B-090a (2026-08-21 operator review):* the notify-me form exists only on the public facility page, so the identical call arriving by phone captures nothing (**B-154**, with PRD 02 US-43); the demand report withholds the contact details the entry already stores (**B-154**); the sold-out branch **inside checkout** — the highest-intent moment in the funnel — still dead-ends in "call us" with no number and no form (**B-149**); and the sweep notifies without holding the unit, so the person we emailed races the public site for it (**D-87**, owner decision, copy must match whichever way it goes).
  - *Built B-090 part 1, 2026-08-20 (**D-79**, **D-80**).* A `<details>` form on each fully-rented size on the facility page — until then a sold-out size dead-ended in a phone number and captured nothing. **Its own `WaitlistEntry` model rather than a `Lead` (D-79):** reusing `Lead` would have raised an uncallable follow-up task per entry and diluted the funnel's conversion denominator. A cron-tick sweep notifies **as many people as there are free units, oldest first**, and holds each claim 72 hours before giving the next person a turn — availability minus outstanding claims, which is what stops twelve people being told about one unit. Mail is transactional and email-only (**D-80**): a phone number typed into a notify-me box is not TCPA consent to text it, so the column exists for staff to call and nothing sends to it. `/admin/reports/waitlist` shows the queue as demand for inventory that does not exist, which is a number no other report here can produce.
- Transfer-unit flow (upsize/downsize online).
  - *Built B-090b, 2026-08-20 (**D-81**, **D-82**), re-quoted at B-136 (**D-84**), and specified as US-709 on 2026-08-21.* Three gaps the third review block left open, each with an owning row: the new lease inherits **none** of the tenant's protective or enforcement state, which is also why a lease in `pending_auction` could be transferred out of the lien pipeline by the tenant (**B-137**, **B-138** — confirmed against the code); a transfer hold triggers the prospect move-in reminder email (**B-140**); and the request screen swallows every preview failure, never states the hold expiry and puts no ceiling on the requested date (**B-142**).
- Delinquency self-cure UX beyond banner (payment plans), coordinated with admin policy.
  - *Built B-090c, 2026-08-26, and specified as US-710 on 2026-08-25.* **Self-cure shipped as visibility, not origination** — staff set up every plan, and the tenant-facing surface is a dashboard card plus a read-only `/portal/payment-plan`. Six gaps the fifth review block found, each with an owning row: progress counts a bounced payment as paid and counts next month's rent as this month's arrears (**B-188**, **D-96**); autopay never hears about the plan and takes the whole balance the night it is agreed, while nothing collects an installment (**B-189**, **D-97**); nothing caps what a plan may defer or how many a lease may have (**B-190**, **D-98**); the tenant is told nothing at any point, and the one card they had unmounts when the plan breaks (**B-191**); the builder and cancel forms announce nothing and name nothing (**B-192**); the plan page has one route in and no history (**B-193**).
  - *Still not built, and deliberately not a backlog row (2026-08-25):* **a tenant-initiated plan REQUEST flow.** The operator review makes a real argument for it — a tenant who can propose a schedule at 11pm is a tenant who does not have to phone, and the ones who most need a plan are the ones least likely to call. It is declined as a row because it is **new scope resting on a policy nobody has set**, not a defect: a request flow needs auto-approval rules or a queue, a floor on what may be proposed, a limit on how often, and an answer to what a rejected request does to the ladder — every one of which is **D-98**'s territory. When D-98 is settled this becomes buildable and should be raised then. Until it is, the honest tenant-facing answer is the facility's own phone number, rendered through `phoneFor`/`CallLink` so a screen whose only next step is a call cannot ship without a number to call (B-164's rule).

---

## 10. Open Questions

1. **Legal/lease:** Which states are we operating in, and what per-state lease clauses, notice periods, SCRA handling, and rate-increase notice rules apply? Who supplies the lease templates (attorney review needed before e-sign ships)?
2. **Insurance model:** Third-party tenant insurance (e.g., a program provider) vs. in-house protection plan? Affects licensing, revenue, and the checkout step's copy. Waiver attestation requirements per state?
3. **ID verification:** Do we require government-ID capture at online move-in (fraud reduction) or keep the low-friction attestation-only approach? Proposal: ship without, monitor fraud/chargebacks, add step-up verification only for flagged rentals.
4. **Autopay default-on:** Confirm with legal that pre-selected autopay with disclosure + pre-charge notices complies in all operating states (auto-renewal statutes).
5. **Stripe Billing vs. admin-ledger-driven charges:** Does recurring rent run on Stripe subscriptions/invoices, or does the admin ledger compute charges and trigger PaymentIntents? (Recommendation: admin-ledger-driven for proration/fee flexibility; needs joint decision with admin PRD.)
6. ~~**Maps provider:**~~ **Closed 2026-08-14 by D-46: Google Maps Platform.** D-14 had already settled the geocoding half — zip/city search resolves against a bundled US dataset, offline and with no vendor, and that does not change. This closes the rendering half (FR-1.3, B-107) and the street-address autocomplete that follows the same choice. The key ships to the browser, so it must be referrer-restricted and scoped to the Maps JavaScript API alone. Reopen the geocoding half only if search must handle street addresses or non-US locations.
7. **Email/SMS providers:** SES vs. Postmark; Twilio vs. alternatives; 10DLC registration timeline for SMS (lead time — start early).
8. **Reservation hold policy:** Default hold length and max future move-in date — product wants generous holds; operations may want tighter. Configurable per facility, but what are launch defaults?
9. **Gate code semantics:** Per-tenant persistent code vs. per-unit vs. rotating — owned by Hardware PRD, but the portal display copy and SMS template depend on it.
10. **CMS choice for marketing content blocks** (FR-8.1): repo-managed markdown (simplest, dev-gated) vs. lightweight headless CMS (marketing self-service). Coordinate with Marketing/SEO PRD.
11. ~~**Overlock/past-due display:**~~ **Closed 2026-07-31 by D-16.** Paying online auto-restores gate access with no staff action, within ~2 minutes, and the portal says so — but "paying" means the balance reaches zero, so the copy states the full amount and does not imply a part payment reopens the gate. Portal messaging is specified at US-702.

---

### Sources
- [CubeSmart launches fully online rental capability (SmartRental), Apr 2020](https://www.globenewswire.com/news-release/2020/04/28/2023680/0/en/CubeSmart-Launches-Fully-Online-Rental-Capability.html)
- [CubeSmart SmartRental — contact-free storage rental](https://www.cubesmart.com/smartrental/)
- [Public Storage launches contactless move-ins (eRental)](https://www.publicstorage.com/blog/public-storage/public-storage-launches-contactless-move-ins-for-peace-of-mind.html)
- [Public Storage celebrates one million contactless move-ins (2022)](https://markets.financialcontent.com/clarkebroadcasting.mymotherlode/article/bizwire-2022-3-30-public-storage-celebrates-one-million-contactless-move-ins)
- [Extra Space Storage — Rapid Rental (fully online move-in)](https://www.extraspace.com/rapid-rental/)
- [Extra Space Storage — guide to renting a storage unit](https://www.extraspace.com/blog/self-storage/your-guide-to-renting-a-storage-unit-with-extra-space-storage/)
- [U-Haul — Online Move-In](https://www.uhaul.com/Storage/Online-Move-In/)
- [storEDGE Rental Center (Storable)](https://rental-center.storedge.com/)
- [storEDGE E-sign overview](https://help.storedge.com/hc/en-us/articles/212179406-E-sign-Overview)
- [Radius+ — What in the self-storage web rates is going on? (web vs street rates)](https://www.radiusplus.com/post/what-in-the-self-storage-web-rates-is-going-on/)
