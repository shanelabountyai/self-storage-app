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
- **Commercial/business accounts with multiple units under one invoice** (later phase).
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
- Optional "size estimator" quiz (MVP-optional, see Phasing): pick rooms/items, get a recommended size with a direct link to available units of that size at the selected facility.
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
- **Autopay enrollment** stores the payment method (Stripe SetupIntent → saved payment method on the Stripe Customer) and charges rent automatically on the due date. Enrollment state is visible and toggleable in the portal (US-704).
- **One-time payments** in the portal: pay current balance or a chosen amount ≥ minimum due; instant receipt (§4.8).
- Failed autopay triggers dunning: automatic retry per configurable schedule (e.g., day 1, 3, 5), notifications at each attempt (§4.8), and a prominent "update card & pay now" portal banner. Delinquency status/fees are computed by the admin module — the site only displays them.
- All amounts, receipts, and statements shown in USD with taxes itemized; Stripe webhooks reconcile payment state with the admin ledger (integration point §7).

### 4.7 Tenant portal

**US-701 — Log in easily**
- Login with email + password **or** passwordless magic link; "forgot password" self-service. Session length 30 days on trusted devices; sensitive actions (change payout of stored card, move-out) re-verify by fresh login or emailed code.

**US-702 — See my account at a glance**
- Dashboard shows: unit(s) with facility, unit number, size, monthly rate; current balance and due date; autopay status; **gate code** behind a "show" tap (with copy button); next payment amount.

**US-703 — Pay my bill**
- Pay balance in ≤3 taps from dashboard using saved method or a new one; wallet support.

**US-704 — Manage autopay & payment methods**
- Toggle autopay on/off; add/remove/update cards or bank accounts (Stripe-hosted forms); set default method; see next scheduled charge.

**US-705 — View lease, receipts, statements**
- Download signed lease PDF; list of all payments with downloadable PDF receipts; monthly statements; insurance/protection selection visible with option to change tier (takes effect next billing cycle) or submit proof of own insurance.

**US-706 — Update contact info**
- Edit phone, email, mailing address, alternate contact; email change requires confirmation to both old and new addresses.

**US-707 — Request move-out**
- Select unit → "Schedule move-out" → pick date (validation against required-notice rules configured in admin, e.g., no notice or 10-day notice) → see what's owed/prorated per policy → confirm. Confirmation email/SMS sent; the request lands in the admin module for staff verification (unit vacant + clean) before finalization. Tenant can cancel a scheduled move-out before the date.

**US-708 — Get help**
- Contact page per facility: click-to-call, contact form, hours. Past-due lockout states show a clear explanation and a "pay now to restore access" path where policy allows.

### 4.8 Notifications (email + SMS)

**US-801 — Keep me informed without spamming me**
*Acceptance criteria — transactional messages (email always; SMS where marked, with opt-in at collection):*

| Event | Email | SMS |
|---|---|---|
| Reservation confirmation | ✓ | ✓ |
| Reservation expiring reminder (24h before) | ✓ | ✓ |
| Move-in complete: lease PDF, receipt, **gate code**, unit directions | ✓ | ✓ (gate code + address) |
| Payment receipt (every successful charge) | ✓ | opt-in |
| Upcoming due date (X days before; default 5, admin-config) — sent only when autopay is OFF | ✓ | ✓ |
| Autopay upcoming charge notice (2 days before) | ✓ | – |
| Failed payment (each attempt) | ✓ | ✓ |
| Card expiring soon | ✓ | – |
| Move-out scheduled / completed / final statement | ✓ | – |
| Rate change notice (admin-triggered; site renders in portal too) | ✓ | – |

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
4.1 Server-side checkout session state machine: details → unit-assign → insurance → lease → payment → provisioned. Each transition validated server-side; resumable; 30-min unit lock with heartbeat extension.
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
9.1 Core Web Vitals "good" thresholds on mobile (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) for search, facility, and unit pages.
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

### 6.4 Checkout stepper
- Progress indicator with step names; back navigation never loses data.
- Each step ≤7 visible fields; optional fields marked "(optional)" — required is the default and unmarked.
- Errors inline, next to the field, in plain language, announced to screen readers (`aria-live`); the page scrolls to the first error.
- Price summary persistently visible (collapsible on mobile) through all checkout steps; **total due today** never changes without an explicit intervening choice by the user.
- Lease step: plain-language summary card first; full lease scrollable below; signature control disabled until the summary has been rendered (not until "scrolled to bottom" — that pattern is hostile and fails on screen readers).

### 6.5 Tenant portal
- Dashboard answers the three questions in one glance: *what do I owe, when is it due, what's my gate code.*
- "Pay now" reachable in ≤2 taps from login; amount pre-filled with balance due.
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
- Reflow to 320px CSS width without horizontal scroll; text resizable to 200%; respects `prefers-reduced-motion`.
- Map views have list equivalents; date pickers allow manual text entry; session-timeout warnings with extension option (checkout lock warning at T-5 min).
- Third-party embeds (Stripe elements, maps) chosen/configured for accessibility; Stripe Payment Element meets this.
- CI includes automated a11y checks (axe) on all key templates + manual screen-reader test on the two golden paths (rent online; pay bill) each release. Public accessibility statement page.

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
- Interactive size-estimator quiz; richer size-guide illustrations.
- ACH at checkout (portal-only ACH may ship in MVP if cheap); Stripe Link.
- Monthly statements center; insurance tier change + proof-of-insurance upload in portal.
- Reservation follow-up nudges (coordinated with marketing module); promo-code entry field.
- Scheduled/future-dated move-ins beyond 14 days; multi-unit rental in one checkout.
- Spanish-language support (highest-impact i18n).

### Phase 3 — Later
- Live chat / AI assistant; kiosk-mode variant of checkout for in-office self-service.
- Business accounts (multi-unit consolidated billing, additional authorized users).
- Referral program surface; tenant reviews on facility pages (with marketing module).
- Waitlists for sold-out unit types with notify-me.
- Transfer-unit flow (upsize/downsize online).
- Delinquency self-cure UX beyond banner (payment plans), coordinated with admin policy.

---

## 10. Open Questions

1. **Legal/lease:** Which states are we operating in, and what per-state lease clauses, notice periods, SCRA handling, and rate-increase notice rules apply? Who supplies the lease templates (attorney review needed before e-sign ships)?
2. **Insurance model:** Third-party tenant insurance (e.g., a program provider) vs. in-house protection plan? Affects licensing, revenue, and the checkout step's copy. Waiver attestation requirements per state?
3. **ID verification:** Do we require government-ID capture at online move-in (fraud reduction) or keep the low-friction attestation-only approach? Proposal: ship without, monitor fraud/chargebacks, add step-up verification only for flagged rentals.
4. **Autopay default-on:** Confirm with legal that pre-selected autopay with disclosure + pre-charge notices complies in all operating states (auto-renewal statutes).
5. **Stripe Billing vs. admin-ledger-driven charges:** Does recurring rent run on Stripe subscriptions/invoices, or does the admin ledger compute charges and trigger PaymentIntents? (Recommendation: admin-ledger-driven for proration/fee flexibility; needs joint decision with admin PRD.)
6. **Maps provider:** Google Maps Platform (best data, higher cost) vs. Mapbox. Address autocomplete provider follows this choice. **Narrowed by D-14 (B-015): geocoding no longer depends on this** — zip/city search resolves against a bundled US dataset, and search typeahead is served from our own facility list. What still needs a vendor is map *rendering* (FR-1.3, B-016) and street-address autocomplete in checkout. Reopen the geocoding half only if search must handle street addresses or non-US locations.
7. **Email/SMS providers:** SES vs. Postmark; Twilio vs. alternatives; 10DLC registration timeline for SMS (lead time — start early).
8. **Reservation hold policy:** Default hold length and max future move-in date — product wants generous holds; operations may want tighter. Configurable per facility, but what are launch defaults?
9. **Gate code semantics:** Per-tenant persistent code vs. per-unit vs. rotating — owned by Hardware PRD, but the portal display copy and SMS template depend on it.
10. **CMS choice for marketing content blocks** (FR-8.1): repo-managed markdown (simplest, dev-gated) vs. lightweight headless CMS (marketing self-service). Coordinate with Marketing/SEO PRD.
11. **Overlock/past-due display:** Exact portal messaging and whether paying online auto-restores gate access without staff action (joint with admin + hardware modules).

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
