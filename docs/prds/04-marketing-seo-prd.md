# PRD 04 — Marketing & SEO Layer

**Module:** Marketing / SEO layer of the multi-facility self-storage business application
**Status:** Draft v1.0 — 2026-07-30
**Owner:** Product (Marketing/Growth module)
**Sibling PRDs:** Master PRD, Customer Website PRD, Admin Dashboard PRD, Hardware Integrations PRD (written in parallel — integration points are flagged inline; implementation details of those modules live in their own PRDs)

---

## 1. Overview & Goals

### 1.1 Context

Self-storage is an overwhelmingly *local-intent* business. Industry practitioners consistently describe the acquisition funnel as: a prospect experiences a life event (move, downsizing, divorce, business overflow), searches Google for phrases like "storage units near me" or "storage units in [city]," scans the local map pack and the first page of results, compares a handful of nearby facilities on price and reviews, and reserves — often the same day. Winning that moment depends on three things this module owns:

1. **Local search visibility** — ranking in the Google local pack and organic results for facility-area queries. Multi-location self-storage SEO guides uniformly emphasize a dedicated, unique page per facility, consistent NAP (name/address/phone) data, and an optimized Google Business Profile as the foundation ([Storage Commander](https://www.storagecommander.com/blog/self-storage-seo-best-practices), [Go Local Interactive](https://golocalinteractive.com/why-your-self-storage-facility-isnt-ranking-for-near-me-searches-and-how-to-fix-it/), [StoragePug](https://www.storagepug.com/blog/self-storage-seo-basics), [Tribal Core](https://tribalcore.com/2019/08/self-storage-seo/), [The Storage Agency](https://thestorageagency.com/blog/local-seo-self-storage/)).
2. **Structured data** — schema.org defines a dedicated [`SelfStorage`](https://schema.org/SelfStorage) type, a subtype of [`LocalBusiness`](https://schema.org/LocalBusiness), which lets search engines unambiguously understand each facility's name, address, geo, hours, and offers.
3. **Conversion capture** — turning that visibility into leads and reservations the operator can act on, with attribution so the operator knows which channel produced each move-in.

A structural fact of this industry: a large share of demand flows through aggregators — most prominently SpareFoot / the Storable Marketplace, which advertises itself as the largest online marketplace for self-storage and charges operators per completed move-in rather than per click ([Storable](https://www.storable.com/products/self-storage-marketplace/), [StoragePug on aggregators](https://www.storagepug.com/blog/using-self-storage-aggregators)). Aggregator leads carry a real per-move-in cost, so the strategic goal of this module is to **maximize the share of move-ins from owned channels (organic local search, direct website, GBP)** and make paid/aggregator spend measurable. Direct aggregator API integration is out of scope for MVP (see Non-goals), but the attribution model must be able to classify aggregator-sourced tenants from day one.

### 1.2 Goals

- **G1:** Every facility has a fast, unique, indexable location page that can rank for "[storage type] in [city/neighborhood]" queries and renders valid `SelfStorage` structured data.
- **G2:** Every prospect touchpoint (quote form, callback request, reservation start) produces a lead record with source attribution, handed to the admin dashboard.
- **G3:** Operators can define and track promotions end-to-end (definition → display → redemption → billing), shared with the billing engine.
- **G4:** Basic lifecycle messaging (abandoned-reservation follow-up, post-move-in review request, lead drip) runs automatically with correct consent handling.
- **G5:** Per-facility funnel reporting: sessions → quote/lead → reservation started → reservation completed → move-in, segmented by source.

### 1.3 Guiding principles

- **SEO is an architecture problem first.** Rendering, URLs, canonicals, sitemaps, and structured data are built into the customer website's framework, not bolted on.
- **One source of truth for facility data.** NAP, hours, prices, and unit availability come from the core facility/inventory model (Admin Dashboard PRD); marketing surfaces never hand-maintain copies.
- **Measure everything, buy little.** MVP uses operational discipline (e.g., GBP hygiene checklists) before paid API integrations.
- **Compliance is a feature.** Consent, unsubscribe, and quiet-hours logic ship with the first email/SMS send, not after.

---

## 2. Non-goals

- **Paid search / ads management** (Google Ads, Meta) — out of scope; the module only *attributes* paid traffic via UTMs.
- **Aggregator API integration** (SpareFoot/Storable Marketplace listing sync, iSpot, etc.) — out of scope for all phases in this PRD; attribution supports an "aggregator" source value so these tenants can be classified manually or via future integration.
- **Google Business Profile API write integration** in MVP — GBP is treated as operational guidance plus a manual data-consistency check (Phase 3 candidate for API sync).
- **Full marketing automation platform** (journeys, branching, A/B testing engines) — only the specific drips defined here.
- **CRM beyond lead records** — leads hand off to the admin dashboard; sales-pipeline tooling is the Admin Dashboard PRD's concern.
- **Multilingual SEO** — English-only in MVP.
- **Blog CMS with full editorial workflow** — the Phase 2 content hub is a simple markdown/MDX-backed system, not a headless CMS integration.
- **Review syndication/response management** — displaying reviews yes; replying to Google reviews from our UI, no (operators reply in GBP directly).

---

## 3. User Stories & Acceptance Criteria

Personas: **Prospect** (storage seeker), **Operator** (owner/regional manager), **Facility Manager** (site-level staff), **Marketer** (person wearing the marketing hat — often the operator).

### 3.1 Local SEO location pages

**US-1: As a prospect searching "storage units in [city]," I find the facility's location page and see prices without friction.**
- AC1: Each facility has a stable, human-readable URL: `/storage-units/{state}/{city}/{facility-slug}`.
- AC2: The page server-renders (SSR/SSG) name, full address, phone, hours, unique facility description, available unit types with current "web rate" starting prices, facility photos, feature list (climate control, drive-up, gate hours), an embedded map, and at least 5 facility-specific FAQs.
- AC3: Prices shown are pulled live (or ≤15-minute cache) from the inventory/pricing engine — never hardcoded.
- AC4: Page includes valid JSON-LD `SelfStorage` schema (see FR-SEO-4) that passes Google's Rich Results / schema validation with zero errors.
- AC5: Core Web Vitals at p75 on mobile: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 (Google's published "good" thresholds).
- AC6: Every location page is reachable within 2 clicks from the homepage and present in the XML sitemap.

**US-2: As a marketer, I can edit the unique content blocks of a location page without a deploy.**
- AC1: Admin dashboard exposes editable fields per facility: SEO title, meta description, hero copy, long-form description, FAQ list (question/answer pairs), photo set with alt text.
- AC2: Edits publish to the live page within 5 minutes (revalidation).
- AC3: Title/meta fields show character-count guidance (title ~60 chars, description ~155 chars) and a duplicate-content warning if the description matches another facility's above a similarity threshold.

**US-3: As a search engine crawler, I can discover and correctly index all marketing pages.**
- AC1: `sitemap.xml` auto-regenerates on facility/page publish events and includes `lastmod`.
- AC2: `robots.txt` allows marketing routes; account/portal/checkout routes are `noindex`.
- AC3: Every page has exactly one self-referencing canonical URL; no duplicate indexable URLs for the same facility (trailing-slash, casing, and query-param variants canonicalize).
- AC4: 404/410 handling for retired facilities with 301s to the nearest city page.

### 3.2 City pages & content hub (Phase 2)

**US-4: As a prospect early in research, I land on a city page or guide and route to a facility.**
- AC1: City pages at `/storage/{state}/{city}` list all facilities in that city with starting price and rating; unique intro copy per city; indexable only when ≥1 facility exists in the city.
  - *Built B-082 part 2, 2026-08-17.* The path is `/storage/…` per **D-32**, the same correction US-1 AC1 above already carries. **Distance is not shown (D-59)** — a city page is reached without anybody naming a location, so there is no origin to measure from; the list is ordered cheapest-first instead, and the page carries the search form, which is where a distance can be honest. **The intro copy is generated from the facilities in the city (D-58)**, not typed into a city record. "Indexable only when ≥1 facility exists" is enforced as a **404**, not a `noindex` on an empty page, and the sitemap builds its city list from the same function the page does — so it cannot advertise a URL the page refuses to render.
- AC2: Content hub at `/guides/*` with launch set: unit size guide (with visual comparisons), "what fits in a 10x10," moving checklist, packing tips, climate-control explainer.
  - *Built B-082 part 3, 2026-08-17.* Four MDX guides under `/guides`, plus the size guide, which **stays at `/storage/size-guide` and is linked rather than re-published (D-60)** — copying it would manufacture the duplicate content part 6 of this row exists to detect. Prose lives in `apps/web/content/guides/*.mdx`; everything a machine reads (headline, description, both dates, the CTA filter, the FAQ) is typed in `lib/guides/catalog.ts`, because frontmatter lets a guide ship without the fields `Article` needs and fail silently as absent markup.
- AC3: Every guide includes contextual CTAs (size guide → unit-type filter on nearest facility page) and `FAQPage`/`Article` schema where appropriate.
  - *Built B-082 part 3, 2026-08-17.* The CTA points at the **search**, not at a facility, for the same reason the city page prints no distance (D-59): "nearest" needs a location nobody has given us on a guide page. The filter is carried through the search onto whichever facility the reader picks, so the facility page opens already filtered. `GuideFilter` is typed against `SIZE_BANDS` and `FEATURE_FILTERS`, so a CTA cannot point at a filter value the facility page silently ignores. `FAQPage` is emitted only for guides with two or more real questions — `faqPageJsonLd` refuses fewer, and a one-question FAQPage is the shape that gets ignored.

### 3.3 Google Business Profile alignment

**US-5: As an operator, I know whether each facility's GBP matches our system of record.**
- AC1: Admin dashboard shows a per-facility "GBP checklist" card: NAP matches website, hours match, website link points to the facility's location page (with UTM `utm_source=google&utm_medium=organic_gbp`), ≥10 photos, categories set to "Self-storage facility," posts in the last 30 days.
- AC2: MVP checklist is manually confirmed by staff (checkbox + last-verified date); the system flags items unverified for >90 days.
- AC3: The location page's rendered NAP is byte-identical to the facility record so staff can copy-paste into GBP (formatting helper provided).

### 3.4 Reviews

**US-6: As a prospect, I can see recent reviews on the facility page.**
- AC1: Facility page shows average rating, review count, and the N most recent reviews (text, star rating, reviewer first name, date, source label).
- AC2: MVP source: manual entry in the admin dashboard (facility managers transcribe/curate Google reviews with attribution "via Google"). Phase 3: Google Places/Business Profile API ingestion replacing manual entry.
- AC3: Aggregate rating is included in the `SelfStorage` JSON-LD as `aggregateRating` **only when** reviews are displayed on the page and sourced consistently with Google's structured-data policies (decision gate — see Open Questions Q3).

**US-7: As an operator, I get more Google reviews from happy tenants.**
- AC1: A review-request email sends automatically N days after move-in completion (default 7, configurable per facility), containing the facility's Google review link.
- AC2: Max 1 review request per tenant per tenancy; suppressed if the tenant filed a complaint/ticket in the interim (signal from admin dashboard, if available; otherwise operator can exclude manually).
- AC3: Send/open/click tracked and reported per facility.

### 3.5 Lead capture & follow-up

**US-8: As a prospect not ready to reserve, I can request a quote or callback.**
- AC1: Quote/callback form on every facility page and city page: name, email, phone (optional for quote, required for callback), unit size interest, move-in date, free-text note.
- AC2: Submission creates a Lead record ≤5s, fires a confirmation email, and notifies the facility manager (email + dashboard inbox) in real time.
- AC3: The form captures hidden fields: facility ID, page URL, referrer, UTM parameters (source/medium/campaign/term/content), GCLID if present, first-touch vs last-touch UTMs from a first-party cookie (90-day window).
- AC4: Spam controls: honeypot + rate limiting; CAPTCHA only as escalation (protect conversion rate).

**US-9: As a marketer, abandoned reservations get followed up automatically.**
- AC1: If a prospect starts checkout (unit selected, contact info captured) but doesn't complete within 60 minutes, an abandonment email sends with a link resuming the exact unit/quote, including any active promo.
- AC2: Follow-up sequence: +1h, +24h, +72h (configurable); sequence halts immediately on reservation completion or unsubscribe.
- AC3: Abandonment emails count as **transactional-adjacent marketing** and therefore require marketing consent captured at the form (see FR-MSG-1); no consent, no sequence.
- AC4: Recovered reservations are attributed to the sequence in funnel reporting.

**US-10: As a facility manager, leads appear in my admin dashboard with full context.**
- AC1: Lead record handed to the admin dashboard contains: contact info, facility, unit-size interest, move-in date, source attribution (channel, UTMs, first/last touch, landing page), status (`new`), and timestamps.
- AC2: Lead status lifecycle (`new → contacted → reserved → moved_in → lost`) is owned by the admin dashboard; this module subscribes to status changes to stop drips and attribute conversions. *(Integration point — Admin Dashboard PRD.)*

### 3.6 Promotions engine

**US-11: As an operator, I can create a promotion and control where it applies.**
- AC1: Promo types at MVP: percent off for N months, fixed amount off for N months, first month free (modeled as 100% off month 1).
- AC2: Eligibility rules: facility list (or all), unit types/size classes, minimum stay flag, new-tenants-only, date window, optional total-redemption cap and per-facility cap.
- AC3: Promos can be **auto-applied** (shown on eligible unit cards site-wide) or **code-gated** (promo code entered at checkout; codes unique, case-insensitive, with expiry).
- AC4: Validation prevents stacking (one promo per reservation at MVP) and blocks publishing a promo whose eligibility set is empty.

**US-12: As a prospect, I see the promo clearly and it carries through checkout.**
- AC1: Eligible unit cards and facility pages show promo badge + plain-language terms; the discounted first-invoice amount is shown before payment.
- AC2: The promo attaches to the reservation record and is passed to the billing engine as a structured discount instruction (promo ID, schedule of discounted periods). Billing owns applying it to invoices. *(Integration point — Admin Dashboard/Billing PRD.)*
- AC3: Redemption is recorded at reservation completion; reporting shows redemptions, associated move-ins, and discounted revenue per promo.

### 3.7 Email/SMS marketing basics

**US-13: As a compliance-conscious operator, messaging respects consent and the law.**
- AC1: Every contact has separate flags: `transactional` (implied by doing business — receipts, gate codes, reservation confirmations) and `marketing_email` / `marketing_sms` (explicit opt-in, unchecked-by-default checkbox with disclosure text at capture).
- AC2: All marketing emails include a working one-click unsubscribe and the operator's physical postal address (CAN-SPAM requirements); unsubscribe takes effect immediately in our system and within the legally required window everywhere.
- AC3: Marketing SMS sends only with express written consent captured with TCPA-appropriate disclosure language, supports STOP/HELP keywords, and is suppressed outside 8am–9pm recipient local time. *(This PRD mandates the control; final disclosure copy requires legal review — Open Questions Q5.)* **Built by B-123 and deliberately dark — see D-51.** The `marketing_sms` lane exists end to end: its own consent capture at checkout and in the portal, its own disclosure and version, its own send-time check (`smsConsentGranted` picks the lane by classification), the once-a-day cap, and SMS template variants. **Nothing sends on it yet, and two things that are not code have to land first:** Q5's disclosure copy must be legally reviewed, and A2P 10DLC needs a MARKETING campaign registered separately from the transactional one (PRD 05 §6.3). No seeded notification rule dispatches marketing SMS, and a test asserts that stays true.
- AC4: Consent state changes are audit-logged (timestamp, source, IP).

**US-14: As a marketer, new leads enter a simple drip.**
- AC1: Lead drip (email): immediate quote recap → +2 days value/reviews email → +5 days promo nudge (only if an eligible promo is live). Exits on reservation, status `lost`, or unsubscribe.
- AC2: Templates are per-brand with facility merge fields (name, address, phone, prices, promo); operators can edit copy, not sequence logic, at MVP.

### 3.8 Analytics

**US-15: As an operator, I see which channels produce move-ins, per facility.**
- AC1: Analytics instrumented via GA4 **or** a privacy-friendly alternative (decision — Open Questions Q1) behind a thin internal event wrapper so the vendor is swappable.
- AC2: Standard event set (mirrored server-side for the funnel source of truth): `page_view`, `quote_form_submit`, `callback_request`, `reservation_started`, `reservation_completed`, `move_in_completed`, `promo_applied`, `review_request_click`.
- AC3: `move_in_completed` is fired server-side from the admin dashboard's move-in event (client analytics can't see it). *(Integration point.)*
- AC4: Per-facility funnel report in the admin dashboard: sessions → leads → reservations started → completed → move-ins, filterable by date range and source/medium; conversion rates at each step.
- AC5: Cookie consent banner gates analytics per applicable law; server-side funnel events (first-party, pseudonymous) remain the reporting fallback when consent is declined.

---

## 4. Functional Requirements

### 4.1 SEO infrastructure (FR-SEO)

- **FR-SEO-1 Rendering:** All marketing pages (home, facility, city, guides) are server-rendered or statically generated with revalidation; content visible without JavaScript execution.
- **FR-SEO-2 URL & canonical policy:** Lowercase, hyphenated slugs; single canonical per page; 301 redirect map maintained for renamed/retired slugs; facility slug changes auto-create redirects.
- **FR-SEO-3 Meta & OG:** Per-page title, meta description, Open Graph/Twitter tags; templated defaults (`{Facility Name} | Storage Units in {City}, {State}`) overridable per facility (US-2).
- **FR-SEO-4 Structured data:** JSON-LD on facility pages using `SelfStorage` (subtype of `LocalBusiness` per [schema.org](https://schema.org/SelfStorage)) with: `name`, `address` (PostalAddress), `geo`, `telephone`, `url`, `openingHoursSpecification` (office and gate hours as separate specs), `image`, `priceRange`, `makesOffer`/`Offer` for unit types with price and `priceCurrency`, `aggregateRating` (gated per US-6 AC3), and `FAQPage` schema for the FAQ block. City pages: `ItemList`. Guides: `Article`/`FAQPage`. All generated from the facility record — never hand-authored.
- **FR-SEO-5 Sitemap/robots:** Auto-generated `sitemap.xml` (segmented if >1,000 URLs) and `robots.txt` as in US-3; sitemap pings/IndexNow on publish (nice-to-have).
- **FR-SEO-6 Performance budget:** Enforced in CI — image optimization (responsive `srcset`, modern formats, lazy-load below fold), font subsetting, JS budget for marketing routes, no CLS from late-loading promo banners (reserve space). Lighthouse CI gate: performance ≥ 90 on facility page template.
- **FR-SEO-7 NAP integrity:** Facility name/address/phone rendered from the canonical facility record everywhere (header, footer, contact blocks, schema); a single formatting utility guarantees consistency.

### 4.2 Content management (FR-CMS)

- **FR-CMS-1:** Per-facility editable marketing fields (US-2) stored on a `facility_marketing_profile` entity, versioned (last-editor, timestamp, previous value).
- **FR-CMS-2:** Photo management: upload, order, alt-text required before publish, automatic resizing.
- **FR-CMS-3 (Phase 2):** City-page copy and guide content authored as markdown/MDX with frontmatter (title, description, slug, publish date), previewable before publish.

### 4.3 Reviews (FR-REV)

- **FR-REV-1:** `review` entity: facility ID, rating (1–5), text, reviewer display name, review date, source (`manual_google`, `manual_other`, `google_api` later), visibility flag, created-by.
- **FR-REV-2:** Facility page renders aggregate + latest N (default 5) visible reviews; admin can hide (not edit) any review's display — text is never altered.
- **FR-REV-3:** Review-request automation per US-7, driven by the `move_in_completed` event from the admin dashboard.
- **FR-REV-4 (Phase 3):** Google review ingestion job (Places/GBP API), deduplication against manual entries, manual entry disabled once API source is live for a facility.

### 4.4 Leads & attribution (FR-LEAD)

- **FR-LEAD-1:** `lead` entity as in US-10; unique per (email/phone, facility, 30-day window) with new inquiries appended as activities rather than duplicate leads.
- **FR-LEAD-2:** First-party attribution cookie: first-touch UTMs + landing page persisted 90 days; last-touch updated each session; both stored on lead and reservation records. Channel derivation rules: `utm_source` → mapped channel; no UTMs + search-engine referrer → `organic`; no referrer → `direct`; operator-selectable `aggregator`, `walk_in`, `phone` for manually created leads (admin dashboard).
- **FR-LEAD-3:** Lead hand-off: leads written to the shared datastore/API consumed by the admin dashboard; webhook/event (`lead.created`) emitted for real-time notification. *(Integration contract to be finalized with Admin Dashboard PRD.)*
- **FR-LEAD-4:** Abandoned-reservation detection: reservation-started event without completion in 60 minutes enqueues the follow-up sequence (US-9), idempotent per reservation.

### 4.5 Promotions (FR-PROMO)

- **FR-PROMO-1:** `promotion` entity: name, type (`percent_off`, `amount_off`, `free_months`), value, duration in billing periods, eligibility (facility IDs, unit-type IDs/size classes, new-tenant flag, min-stay flag), date window, caps, display mode (`auto` | `code`), status (`draft/active/paused/ended`).
- **FR-PROMO-2:** `promo_code` entity (for code-gated promos): code, promo ID, expiry, max uses, uses count.
- **FR-PROMO-3:** Eligibility evaluation service: given (facility, unit type, tenant-newness, date, optional code) → applicable promo + computed discount schedule; used by facility pages, checkout, and the quote email.
- **FR-PROMO-4:** `promo_redemption` entity created at reservation completion: promo ID, code (if any), reservation ID, facility, discount schedule snapshot. Passed to billing engine; billing applies discounts to invoices and reports discounted amounts back for ROI reporting. *(Integration point — billing owns money; marketing owns definition, display, eligibility, and redemption tracking.)*
- **FR-PROMO-5:** Concurrency: redemption caps enforced atomically at reservation completion; over-cap attempts fall back gracefully (reservation completes at standard rate with clear messaging before payment).

### 4.6 Messaging (FR-MSG)

- **FR-MSG-1 Consent model:** `contact_consent` records per channel (`marketing_email`, `marketing_sms`) with state, timestamp, capture source, disclosure version, IP; transactional messages exempt from marketing consent but still respect global suppression (bounce, complaint).
- **FR-MSG-2 Sending:** Email via a transactional ESP (e.g., Postmark/SES/Resend — implementation choice) with separate sending streams/subdomains for transactional vs marketing to protect deliverability; SMS via Twilio-class provider, Phase 2+.
- **FR-MSG-3 Suppression:** Global suppression list (unsubscribes, hard bounces, spam complaints) checked at send time by every sequence; unsubscribe link resolves without login.
- **FR-MSG-4 Sequences:** Declarative sequence definitions (trigger event, steps with delays, exit conditions) for: lead drip, abandoned reservation, review request. All sends logged (`message_send`: template, contact, sequence, status, opens/clicks).
- **FR-MSG-5 Quiet hours & rate:** No marketing sends 9pm–8am recipient local time (facility timezone as proxy); max 1 marketing email/day/contact across sequences.

### 4.7 Analytics (FR-AN)

- **FR-AN-1:** Internal `track(event, properties)` wrapper on web + server; vendor adapters (GA4 and/or privacy-friendly alternative) configured per environment.
- **FR-AN-2:** Server-side event log is the source of truth for funnel reporting (immune to ad blockers/consent declines); client vendor is for exploration and campaign tooling.
- **FR-AN-3:** Funnel report API consumed by the admin dashboard reporting UI (per US-15 AC4). *(Integration point — dashboard renders; this module computes.)*
  - *v2 built B-082 part 4, 2026-08-17.* The report is split by **source/medium** as well as filtered by it — the `utmSource`/`utmMedium` filters had been accepted by `funnelReport` since B-069 with no control able to set them. Every session is attributed to exactly one source/medium from its first event in the range (**D-61**), which is what makes the breakdown foot to the funnel above it. **Sequence attribution** widened from the single abandonment flag B-073 shipped to a catalog, now covering the lead drip too; the sequences are deliberately not mutually exclusive and the page says so, because one renter can legitimately be counted in both rows. **Promo ROI** lives at `/admin/reports/promotions` and reads `PromoRedemption`, not the event log — it measures money, where the record is the truth, while the funnel measures behaviour and must take every step from one measurement. Discount **given** and **still to give** are separate columns; reporting them as one overstates the cost of every short tenancy or understates the exposure of every promotion still running.
- **FR-AN-4:** UTM convention documented and enforced (lowercase; registry of approved `utm_source`/`utm_medium` values, including `google/organic_gbp` for GBP website links and `aggregator` sources).

---

## 5. Data & Integration Points

### 5.1 Entities owned by this module

| Entity | Key fields | Notes |
|---|---|---|
| `facility_marketing_profile` | facility_id, seo_title, meta_description, hero_copy, description, faqs[], photos[], versions | 1:1 with facility record |
| `gbp_checklist` | facility_id, item, verified_at, verified_by | Manual in MVP |
| `review` | facility_id, rating, text, source, visible | Manual → API source later |
| `lead` | contact, facility_id, interest, attribution{}, status ref | Status owned by admin dashboard |
| `promotion` / `promo_code` / `promo_redemption` | see FR-PROMO | Redemption shared with billing |
| `contact_consent` / `suppression` / `message_send` | see FR-MSG | Audit-logged |
| `analytics_event` (server-side) | event, ts, session, facility_id, properties | Funnel source of truth |

### 5.2 Reads from other modules (system of record elsewhere)

- **Facility record** (name, NAP, geo, hours, gate hours, features, photos, timezone) — Admin Dashboard PRD.
- **Unit inventory & pricing** (unit types, availability, web rates) — Admin Dashboard PRD; consumed by location pages, promo eligibility, quote emails.
- **Reservation & tenant lifecycle events** (`reservation_started`, `reservation_completed`, `move_in_completed`, lead status changes) — Customer Website + Admin Dashboard; consumed by sequences, redemption, analytics.

### 5.3 Writes/hand-offs to other modules

- **Leads → Admin Dashboard** (record + `lead.created` event; source attribution attached).
- **Promo discount schedule → Billing engine** (structured instruction at reservation completion; billing applies and reports discounted revenue back).
- **Funnel report API → Admin Dashboard** reporting UI.
- **Attribution fields → Reservation records** (Customer Website checkout persists first/last-touch UTMs from the shared cookie).

### 5.4 External services

- Analytics vendor (GA4 or alternative — Q1); ESP for email; SMS provider (Phase 2+); Google Places/GBP API (Phase 3); maps embed provider (facility pages — coordinate with Customer Website PRD to pick one and mind its CWV cost).

### 5.5 Explicit boundaries with sibling PRDs

- **Customer Website PRD** owns the checkout/reservation UX and the site framework; this PRD specifies the marketing routes, SEO behavior of those routes, and the events checkout must emit.
- **Admin Dashboard PRD** owns lead workflow UI, facility/inventory data, billing; this PRD specifies the lead payload, promo/billing contract, and the reports it needs rendered.
- **Hardware Integrations PRD** — no direct dependency; move-in events used here originate from the admin dashboard regardless of gate hardware.

---

## 6. Success Metrics

Targets are directional for a learning project; the *instrumentation* is the requirement.

| Metric | Definition | Direction/target |
|---|---|---|
| Organic sessions per facility page | Monthly, from analytics | Growing MoM after indexation |
| Local visibility proxy | Impressions/clicks for facility queries via Search Console (manual review in MVP) | Growing |
| Lead conversion rate | (quote + callback + reservation starts) / facility-page sessions | Baseline then +; industry-typical benchmark TBD |
| Reservation completion rate | completed / started | ≥ 60% (hypothesis; validate) |
| Abandonment recovery rate | recovered / abandoned sequences sent | Instrumented; target TBD |
| Owned-channel share of move-ins | move-ins attributed organic+direct+GBP / all | Primary strategic metric — growing |
| Review request CTR & review velocity | clicks / sends; new Google reviews per facility per month | Growing |
| Promo ROI | incremental move-ins & revenue vs discounted revenue per promo | Reported per promo |
| CWV compliance | % of facility pages passing p75 good thresholds | 100% |
| Deliverability health | bounce < 2%, spam complaint < 0.1% | Maintained |

---

## 7. Phasing

### Phase 1 — MVP (foundation + capture)
- Facility location pages with full SEO stack (FR-SEO-1…7), `SelfStorage` JSON-LD, sitemap/robots, CWV budget in CI.
- Marketing profile editing in admin dashboard (US-2), photo management.
- Manual reviews entry + display; review-request email post-move-in.
- Quote/callback forms, lead entity, UTM/attribution capture, lead hand-off + notifications.
- Promotions engine: percent-off / amount-off / first-month-free, auto + code display, redemption tracking, billing hand-off.
- Email: transactional + review request + lead drip + abandoned-reservation sequence; consent model, unsubscribe, suppression (CAN-SPAM compliant).
- Analytics wrapper, server-side event log, core events, basic per-facility funnel report.
- GBP operational checklist (manual).

### Phase 2 — Reach (content + SMS)
- City pages and content hub (size guide, moving tips, FAQs) with schema.
- SMS channel with TCPA consent flow (drip + abandonment steps optional per operator).
- Funnel reporting v2: source/medium breakdowns, sequence attribution, promo ROI report.
- Duplicate-content warnings, Search Console integration for indexation monitoring.
  - *Search Console built B-082 part 5, 2026-08-17.* Scoped to indexation, not ranking: of the URLs our sitemap advertises, which has Google indexed. The site-verification token is in the root layout; a service-account client talks to `urlInspection.index.inspect` directly via `node:crypto`-signed JWTs rather than through `googleapis`; `/admin/reports/indexation` renders the result. **There is deliberately no simulator** — a fabricated index verdict is a claim about Google on a screen an operator decides from — so unconfigured shows no verdicts and names the missing variables. IndexNow and sitemap-ping automation stay Phase 3 (B-087).

### Phase 3 — Automation (APIs)
- Google reviews ingestion via API; retire manual entry.
- GBP API sync (hours/NAP push, discrepancy alerts) replacing manual checklist items.
- IndexNow/sitemap ping automation; structured-data monitoring alerts.
- Aggregator attribution improvements (still no listing-sync integration — future consideration beyond this PRD).

---

## 8. Open Questions

1. **Analytics vendor:** GA4 (free, ad-ecosystem integration, consent-mode complexity) vs privacy-friendly alternative (e.g., Plausible-class: simpler consent posture, cost, weaker ad attribution)? Recommendation: privacy-friendly + server-side log for MVP simplicity; revisit if paid ads enter scope. **Decide before analytics implementation.**
2. **Pricing display policy:** Show true live web rates on indexable pages (better conversion/schema `Offer` accuracy) vs "starting at" floors (pricing-strategy flexibility)? Interacts with revenue-management features in the Admin Dashboard PRD.
3. **`aggregateRating` schema:** Include only when review sourcing meets Google's self-serving review policies — confirm whether manually transcribed Google reviews qualify or whether we hold `aggregateRating` until API ingestion (Phase 3). Needs a policy read before launch.
4. **Abandonment email consent posture:** We've classified cart-abandonment as requiring marketing consent (conservative). Is the operator comfortable with the conversion cost, or do we treat it as transactional follow-up where law permits? Legal review required.
5. **TCPA disclosure copy & quiet-hours edge cases** (tenant vs facility timezone) — legal review before SMS ships (Phase 2).
6. **Lead dedup contract:** Confirm with Admin Dashboard PRD whether dedup lives here (FR-LEAD-1) or in the dashboard's lead workflow, to avoid double implementation.
7. **Facility slug governance:** Who approves slug changes (SEO-sensitive) — free-form admin edit with auto-redirect, or locked after first publish?
8. **Multi-brand support:** Master PRD question — if facilities operate under multiple brands, location-page templates, sending domains, and GBP guidance need brand dimensions. Assumed single brand at MVP.

---

## Sources

- [Storage Commander — Self-Storage SEO Best Practices for Multi-Location Operators](https://www.storagecommander.com/blog/self-storage-seo-best-practices)
- [Go Local Interactive — Why Your Self-Storage Facility Isn't Ranking for "Near Me" Searches](https://golocalinteractive.com/why-your-self-storage-facility-isnt-ranking-for-near-me-searches-and-how-to-fix-it/)
- [StoragePug — Self Storage SEO Basics](https://www.storagepug.com/blog/self-storage-seo-basics)
- [Tribal Core — Self Storage SEO Guide](https://tribalcore.com/2019/08/self-storage-seo/)
- [The Storage Agency — Local SEO for Self Storage](https://thestorageagency.com/blog/local-seo-self-storage/)
- [XPS — How to Optimize Your Self-Storage Website for Local SEO](https://www.xpsusa.com/self-storage-website-for-local-seo/)
- [Storable — Self Storage Marketplace (SpareFoot)](https://www.storable.com/products/self-storage-marketplace/)
- [StoragePug — Using Self Storage Aggregators](https://www.storagepug.com/blog/using-self-storage-aggregators)
- [StoragePug — SpareFoot vs. Google Ads in Self Storage](https://www.storagepug.com/blog/sparefoot-vs-google-ads)
- [schema.org — SelfStorage type](https://schema.org/SelfStorage)
- [schema.org — LocalBusiness type](https://schema.org/LocalBusiness)
