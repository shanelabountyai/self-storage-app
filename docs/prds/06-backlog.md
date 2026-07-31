# 06 — Prioritized Product Backlog

**Product:** Multi-facility self-storage business application
**Status:** v1.0 — 2026-07-30
**Sources:** `00-master-prd.md`, `01-customer-website-prd.md`, `02-admin-dashboard-prd.md`, `03-hardware-integrations-prd.md`, `04-marketing-seo-prd.md`, `05-communications-prd.md`

This is the single, strictly-ordered build backlog for the whole platform. Items are sequenced so that every item is buildable when reached (all dependencies appear earlier), foundation comes first, and the shortest path runs to the two golden paths: **(1) a renter completes an online move-in with payment and receives a simulated gate code** (end of Milestone 2) and **(2) the billing engine invoices tenants and the comms module sends payment/past-due reminders** (end of Milestone 4). Numbering is global and continuous across milestones.

Sizes: **S** ≈ one short session, **M** ≈ one focused session, **L** ≈ 2–3 sessions or one long one, **XL** ≈ should be split during sprint planning. Phase = the phase the feature belongs to per the PRDs (master PRD wins on conflicts — see Flagged gaps/conflicts). A ✅ on the ID means the item is built and committed.

---

## Milestone 1: Foundation

Everything else builds on this: repo, schema, auth, RBAC, jobs/events, and the facility/unit inventory that both the website and billing consume.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 1 | B-001 ✅ | Monorepo & app scaffold: Next.js (App Router) + TypeScript, Tailwind/shadcn, Prisma + Postgres, Vitest/Playwright, CI (incl. axe + Lighthouse hooks), env/secret handling | PRD 00 §5 Tech Stack, §7.2–7.4 | M | — | MVP |
| 2 | B-002 ✅ | Core data model & migrations: Facility, UnitType, Unit, Tenant, Lease, Invoice/LineItem, Payment, LedgerEntry, AccessCredential/AccessGrant, Reservation, Lead, Promotion, Notice, AuditLog, StaffUser — money as integer cents, facility_id everywhere | PRD 00 §7.5–7.6 Data Model; PRD 02 §6.1 | L | B-001 | MVP |
| 3 | B-003 ✅ | Auth foundation: Auth.js sessions for customers (email/password + magic link) and staff; rate-limited login, password reset | PRD 00 §7.1 Auth; PRD 01 FR-5 | M | B-002 | MVP |
| 4 | B-004 ✅ | RBAC roles-as-data (tenant/counter/manager/regional/owner/system) + server-side facility scoping on every endpoint; monetary authority limits config | PRD 00 §7.1; PRD 02 §3 Roles & Permissions | M | B-003 | MVP |
| 5 | B-005 ✅ | Append-only audit log service (actor, timestamp, entity, before/after, reason codes) wired as a shared package | PRD 00 §7.1; PRD 02 §4.10 US-38 | M | B-002 | MVP |
| 6 | B-006 ✅ | Background jobs + event bus foundation: job runner (Inngest/Trigger.dev or Vercel Cron), domain-event outbox, idempotent consumers | PRD 00 §5; PRD 02 FR-4/FR-7 | M | B-001 | MVP |
| 7 | B-007 ✅ | Admin shell: left nav, global header, facility switcher with "All facilities" context, universal search stub, role-gated routes — **plus `db:create-owner` bootstrap script** (creates the first StaffUser with an all-facilities `owner` assignment and a single-use password-setup link; refuses a second owner without `--force`). Nothing can create a staff account before this, per D-12 | PRD 02 §4.1 US-1, FR-1–3 | M | B-004 | MVP |
| 8 | B-008 ✅ | Facility settings CRUD: address/geo, timezone, office + gate hours, effective-dated tax components & fee schedule, state field | PRD 02 §4.1 US-3 | M | B-007, B-005 | MVP |
| 9 | B-009 ✅ | Unit type management: dimensions, attributes (climate, drive-up, floor, power), clonable across facilities | PRD 02 §4.2 US-6 | S | B-008 | MVP |
| 10 | B-010 ✅ | Unit inventory: list + grid view (JSON layout import), derived statuses (available/reserved/occupied/overlocked/maintenance/unrentable), bulk edit with preview | PRD 02 §4.2 US-5/US-7/US-8 | M | B-009 | MVP |
| 11 | B-011 ✅ | Street rate management: web vs in-store rates per unit type, effective-dated, rate history, exposed via API | PRD 02 §4.3 US-9 | S | B-009 | MVP |
| 12 | B-012 ✅ | Seed & demo data script: ≥2 facilities, unit types/units, tenants in every lifecycle state | PRD 02 §7 (demo scenarios); PRD 03 US-7 AC4 | S | B-010, B-011 | MVP |

## Milestone 2: First online move-in (Golden Path 1)

Search → facility page → unit → reserve or rent → e-sign → Stripe payment → provisioned lease → simulated gate code → confirmation email.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 13 | B-013 ✅ | Public site shell: mobile-first layout, persistent header, homepage with search hero, static/legal pages (FAQ, terms, privacy, accessibility statement) | PRD 01 §6.1–6.2, FR-8 | M | B-001 | MVP |
| 14 | B-014 ✅ | Inventory & pricing read API with quote tokens (price seen = price charged), availability cache TTL + live checkout checks | PRD 01 FR-2 §Inventory & pricing | M | B-010, B-011 | MVP |
| 15 | B-015 | Location search: geocode zip/city, distance-ranked results with "units from $X/mo", shareable URLs, zero-results fallback | PRD 01 §4.1 US-101, FR-1 | M | B-013, B-008, B-014 | MVP |
| 16 | B-016 | Facility detail page: photos, office vs gate hours, amenities, click-to-call, maps deep link, live unit list, crawlable URL scheme | PRD 01 §4.1 US-103 | M | B-015 | MVP |
| 17 | B-017 | Unit browsing + transparent pricing: filters/sort, availability counts (truthful scarcity), web vs in-store rate display, cost summary itemization; static size guide page | PRD 01 §4.2–4.3 US-201/US-202/US-301 | M | B-016 | MVP |
| 18 | B-018 | Free reservation service: no-card hold with expiry, atomic availability decrement, signed-token complete/cancel links, duplicate guard, expiry job | PRD 01 §4.4 US-401, FR-3; PRD 02 US-14 (reserve) | M | B-017, B-006 | MVP |
| 19 | B-019 | Stripe foundation: Customers, PaymentIntents/SetupIntents, signed webhooks, idempotency keys, reconciliation of events into the ledger | PRD 01 §7.3; PRD 00 §7.4 PCI scope | M | B-002, B-006 | MVP |
| 20 | B-020 | Checkout session state machine: server-side resumable stepper, 30-min unit lock with heartbeat, unit-lost fallback offer | PRD 01 FR-4.1 Move-in orchestration | L | B-017, B-018 | MVP |
| 21 | B-021 | Checkout steps 1–2: renter details with autocomplete, implicit account creation (guest-style), unit assignment & confirmation | PRD 01 §4.5 US-501 steps 1–2, FR-5 | M | B-020, B-003 | MVP |
| 22 | B-022 | Protection plan: admin-configured plan catalog + choose-or-waive checkout step with attestation, premium added to recurring billing | PRD 01 US-501 step 3, FR-4.3 | M | B-021 | MVP |
| 23 | B-023 | Document generation service: templated PDFs with merge-field validation (fails loudly on missing fields) — shared by leases, receipts, notices | PRD 02 FR-6 Document generation | M | B-002 | MVP |
| 24 | B-024 | Lease template + e-sign step: merged lease render, plain-language summary, typed signature + consent (IP, timestamp, SHA-256 hash), immutable stored PDF | PRD 01 US-501 step 4, FR-4.2; PRD 02 US-15 | M | B-023, B-022 | MVP |
| 25 | B-025 | Payment step: Stripe Payment Element + wallets, itemized total due today, autopay default-on enrollment with one-tap opt-out (SetupIntent) | PRD 01 US-501 step 5, §4.6 US-601 | M | B-019, B-024 | MVP |
| 26 | B-026 | Move-in provisioning + rollback: webhook-driven finalization, unit → occupied, lease + ledger created, `lease.moved_in` emitted, downstream failures become admin tasks never dead ends | PRD 01 FR-4.4–4.6; PRD 02 US-14 (move-in) | M | B-025 | MVP |
| 27 | B-027 | Access Control Service: AccessGrant state machine (pending→active⇄suspended→revoked), persistent command outbox with idempotency/retry/dead-letter, per-facility adapter config | PRD 03 §4.1, FR-1–FR-3 | L | B-006, B-002 | MVP |
| 28 | B-028 | SimulatedAdapter + mock gate controller + virtual keypad dev page + fault injection (offline/latency/webhook failure) | PRD 03 FR-8, US-7 Simulation | M | B-027, B-012 | MVP |
| 29 | B-029 | Gate code issuance on move-in + confirmation screen: unique code per code policy, async issuance with retry ("code texted within 15 min" fallback), confirmation page with code/address/hours | PRD 03 US-1; PRD 01 US-501 step 7 | M | B-026, B-028 | MVP |
| 30 | B-030 | Comms core: event-driven notification service — rules as data, consent/suppression check, template render, Resend email with domain auth, idempotent sends (hard invariant), append-only message log, kill switch + sandbox redirect | PRD 05 FR-1–FR-4, FR-16–FR-21 | L | B-006 | MVP |
| 31 | B-031 | Move-in path transactional emails: reservation confirmation + expiry reminder, move-in welcome (gate code after credential active, masked in logs), lease PDF + first receipt | PRD 05 CN-7; PRD 01 §4.8 US-801 | M | B-030, B-029, B-018 | MVP |
| 32 | B-032 | SMS consent capture at move-in (unchecked-by-default checkbox, disclosure versioning, stored consent record) + kick off A2P 10DLC brand/campaign registration (long external lead time) | PRD 05 CN-15, §6.3; PRD 04 FR-MSG-1 | S | B-021 | MVP |

## Milestone 3: Tenant portal & admin operations essentials

Tenants can self-serve; staff can run the counter. Also unlocks saved payment methods, which the autopay run needs.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 33 | B-033 | Portal login: email/password + magic link, forgot password, 30-day sessions with re-auth for sensitive actions | PRD 01 §4.7 US-701 | M | B-003 | MVP |
| 34 | B-034 | Portal dashboard: balance/due date, autopay status, gate code behind "show" tap with copy | PRD 01 US-702, §6.5 | M | B-033, B-029 | MVP |
| 35 | B-035 | Portal one-time payment: pay balance in ≤3 taps, saved or new method, instant receipt | PRD 01 US-703 | M | B-034, B-019 | MVP |
| 36 | B-036 | Payment methods & autopay management: toggle autopay, add/remove/update cards, default method, next scheduled charge | PRD 01 US-704 | M | B-035 | MVP |
| 37 | B-037 | Portal documents & contact info: lease PDF, receipts, statements list; edit phone/email/address/alt contact with dual-email confirmation, syncs to admin | PRD 01 US-705/US-706 | M | B-034, B-023 | MVP |
| 38 | B-038 | Admin tenant profile: fast search, leases, balance, delinquency status, immutable notes, typed document uploads, communication history shell | PRD 02 §4.4 US-13/US-16 | M | B-026 | MVP |
| 39 | B-039 | Walk-in (POS) move-in + manual payments: same move-in wizard at the counter, card/cash (tendered/change)/check payments, print/email receipt | PRD 02 §4.8 US-32 | M | B-026, B-038 | MVP |
| 40 | B-040 | Admin move-out: final balance per proration policy, write-off threshold with override, unit released, `lease.moved_out` → access revoked, move-out confirmation email | PRD 02 US-14 (move-out); PRD 03 US-2; PRD 05 CN-8 | M | B-038, B-027, B-030 | MVP |
| 41 | B-041 | Portal move-out request: date picker with notice-rule validation, owed/prorated preview, staff verification queue, cancellable | PRD 01 US-707 | M | B-040, B-034 | MVP |
| 42 | B-042 | MVP reporting: portfolio dashboard (occupancy, revenue MTD, delinquent AR, today's moves per facility) + occupancy & rent-roll report with CSV export | PRD 02 US-2, §4.11 US-39(1–2); PRD 00 §6 MVP | M | B-038 | MVP |

## Milestone 4: Billing engine & payment reminders (Golden Path 2)

Recurring invoices, autopay, retries, fees — and the comms centerpiece: due-soon/due-date reminders and the past-due dunning ladder with pay-now magic links.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 43 | B-043 | Billing scheduler: nightly per-facility jobs (facility-local time), idempotent + re-runnable, Billing Runs screen with per-item outcomes, catch-up after downtime | PRD 02 FR-4 Billing scheduler | M | B-006, B-026 | MVP |
| 44 | B-044 | Recurring invoice generation + proration: anniversary/first-of-month policies, gapless sequential numbering, tax treatment, deterministic unit-tested proration math, `invoice.created/due_soon/due_today` events | PRD 02 §4.5 US-17/US-18 | L | B-043 | MVP |
| 45 | B-045 | Autopay run: nightly idempotent charge run against saved methods, succeeded/failed/skipped visibility | PRD 02 US-19 | M | B-044, B-036 | MVP |
| 46 | B-046 | Failed-payment retry: configurable schedule (+1/+3/+5), card-expired short-circuit, failed-payments staff queue, delinquency clock from original due date | PRD 02 US-20 | M | B-045 | MVP |
| 47 | B-047 | Late fee schedule: per-facility rules, caps, automatic assessment, waive with permission + reason code (audited) | PRD 02 US-21 | S | B-044 | MVP |
| 48 | B-048 | Partial payments (configurable allocation order, displayed at payment time) + refunds (card via Stripe, cash/check payable, reason codes, RBAC limits) | PRD 02 US-22/US-23 | M | B-044, B-039 | MVP |
| 49 | B-049 | Tenant ledger screen: chronological charges/payments/credits/refunds with running balance, reconciles to invoices/AR, CSV/PDF export | PRD 02 US-24 | M | B-044 | MVP |
| 50 | B-050 | Payment lifecycle notices: upcoming-due (default 5 days) + due-date reminders with autopay skip logic, payment receipts, payment-failed notice with fix path ≤5 min | PRD 05 §3.1 CN-1/CN-2/CN-6 | M | B-044, B-046, B-030 | MVP |
| 51 | B-051 | Pay-now magic links: ≥128-bit single-purpose tokens, limited portal session scoped to pay, expiry/revocation, click + payment attribution back to the send record | PRD 05 CN-4, FR-12/FR-13 | M | B-035, B-030 | MVP |
| 52 | B-052 | Past-due dunning ladder: configurable day 1/5/10/30 steps driven by billing-engine events (never a comms-side calendar), at-most-once per invoice per step, instant halt on qualifying payment/move-out/hold | PRD 05 CN-3/CN-5 | M | B-050, B-051 | MVP |
| 53 | B-053 | Template editor + per-facility sender identity: merge-field picker, preview + test-send, versioned saves, publish blocked on unknown fields; per-facility From address/reply-to, auto postal-address footer | PRD 05 CN-16/CN-17 | M | B-030 | MVP |
| 54 | B-054 | Message history on tenant record + shared suppression list + failure queue (hard bounce → tenant flag + staff task) | PRD 05 CN-18/CN-19/CN-20, FR-14/FR-15 | M | B-030, B-038 | MVP |
| 55 | B-055 | Revenue + delinquency-aging reports (billed vs collected by category; AR aging buckets with tenant detail), CSV export | PRD 02 US-39(4–5) | M | B-044 | MVP |

## Milestone 5: Delinquency pipeline, access sync & field ops

The full late → overlock → pre-lien → lien → auction state machine, wired to gate suspension and comms. (Full pipeline is Phase 2 per the master roadmap; PRD 02 marks it MVP — see Flagged conflicts.)

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 56 | B-056 | Delinquency timeline configuration: per-facility ordered steps keyed to days-past-due, versioned, per-state disclaimer guardrails ("example configuration" labeling) | PRD 02 §4.6 US-25/US-29 | M | B-047 | Phase 2 |
| 57 | B-057 | Delinquency engine: nightly evaluation against timeline version, automated actions + queued staff tasks, `delinquency.day_reached` / `stage_changed` events, cure halts pipeline and restores access | PRD 02 FR-5 Delinquency engine | L | B-056, B-043 | Phase 2 |
| 58 | B-058 | Gate access suspend/restore on delinquency/cure: idempotent stage-event handling, restore SLA ≤2 min (simulated), overlock task creation | PRD 03 US-3 | M | B-057, B-027 | Phase 2 |
| 59 | B-059 | Delinquency queue: today's due steps grouped by type, required proof fields (tracking #, photo), visual escalation of overdue items | PRD 02 US-26 | M | B-057 | Phase 2 |
| 60 | B-060 | Field ops: overlock should-be vs confirmed list with mismatch flags, daily mobile walkthrough checklist, maintenance tickets (blocking unit availability) | PRD 02 §4.9 US-35/US-36/US-37 | M | B-059 | Phase 2 |
| 61 | B-061 | Pre-lien/lien notice generation: templated notices with itemized ledger-reconciled claim, immutable PDFs with delivery proofs | PRD 02 US-27 | M | B-057, B-023 | Phase 2 |
| 62 | B-062 | Auction pipeline: eligibility flags, hard-blocked approval when any step lacks proof, advertising record fields, sale outcome + surplus recording, cancel-on-payment | PRD 02 US-28 | L | B-061 | Phase 2 |
| 63 | B-063 | Comms delinquency-stage notices + pre-lien/lien supplements (courtesy only, never claims to be the statutory notice; linked to PRD 02 evidence chain) + access-restored message | PRD 05 §3.3 CN-11/CN-12 | M | B-057, B-030 | Phase 2 |
| 64 | B-064 | Gate hours enforcement (per-facility weekly schedule, timezone/DST-safe, per-grant overrides) + access event pipeline and admin event log with anomaly flags (after-hours, repeated denials, unknown code) | PRD 03 US-4/US-5, FR-4/FR-5 | L | B-028 | MVP |
| 65 | B-065 | ManualAdapter work queue: commands become staff tasks with exact keypad actions, escalation on overdue, adapter switching preserves grants | PRD 03 US-6 | M | B-027 | MVP |

## Milestone 6: Marketing, SEO & lead capture

The demand engine. SEO location pages and lead capture are master-MVP; reviews, drips, and abandoned-cart follow-ups are master-Phase 2 (PRD 04 lists them Phase 1 — see Flagged conflicts).

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 66 | B-066 | SEO infrastructure: SSR/SSG marketing routes, `SelfStorage` JSON-LD (+`FAQPage`), canonical/URL policy with 301 map, sitemap.xml + robots.txt, meta/OG templates, NAP formatting utility, CWV/Lighthouse CI gate | PRD 04 §3.1 US-1/US-3, FR-SEO-1–7 | L | B-016 | MVP |
| 67 | B-067 | Facility marketing profile editor: SEO title/meta with character guidance, hero/long copy, FAQs, photo management with required alt text, 5-min revalidation; GBP manual checklist card | PRD 04 US-2/US-5, FR-CMS-1/2 | M | B-008, B-066 | MVP |
| 68 | B-068 | Lead capture & attribution: quote/callback forms, lead entity with dedup, first/last-touch UTM cookie (90-day), spam controls, `lead.created` hand-off + manager notification, lead status lifecycle in admin | PRD 04 §3.5 US-8/US-10, FR-LEAD-1–3 | M | B-016, B-002 | MVP |
| 69 | B-069 | Analytics: `track()` wrapper, server-side event log as funnel source of truth, standard event set incl. server-fired `move_in_completed`, per-facility funnel report, cookie consent banner | PRD 04 §3.8 US-15, FR-AN-1–4 | M | B-013, B-026 | MVP |
| 70 | B-070 | Promotions engine end-to-end: promo/promo-code entities + admin CRUD, eligibility service, site badges with plain-language terms, checkout carry-through, structured discount hand-off to billing invoices, redemption tracking with atomic caps | PRD 02 US-10; PRD 04 §3.6 US-11/US-12, FR-PROMO-1–5 | L | B-011, B-020, B-044 | MVP |
| 71 | B-071 | Reviews: manual entry + facility-page display (gated `aggregateRating` decision), post-move-in review-request email (max 1/tenancy, tracked) | PRD 04 §3.4 US-6/US-7, FR-REV-1–3 | M | B-067, B-030, B-026 | Phase 2 |
| 72 | B-072 | Marketing consent + lead drip: `marketing_email`/`marketing_sms` consent capture, CAN-SPAM unsubscribe, shared suppression enforcement, declarative sequence engine, 3-step lead drip | PRD 04 §3.7 US-13/US-14, FR-MSG-1–5 | M | B-054, B-068 | Phase 2 |
| 73 | B-073 | Abandoned-reservation follow-up: 60-min abandonment detection, +1h/+24h/+72h resume-checkout sequence (consent-gated), recovery attribution | PRD 04 US-9, FR-LEAD-4 | M | B-072, B-020 | Phase 2 |

## Milestone 7: Phase 2 hardening & reach

SMS goes live (gated on 10DLC), operational depth in admin, hardware hardening, and website/marketing fast-follows.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 74 | B-074 | SMS channel live: Twilio Messaging Service per facility, STOP/HELP/START keywords (provider + app level), quiet hours 8am–9pm, SMS→email fallback with paired idempotency, SMS variants of all reminder/dunning templates; tenant notification preference center | PRD 05 CN-13/CN-14, FR-5/FR-7/FR-8; §6.2–6.4 | L | B-032, B-052 | Phase 2 |
| 75 | B-075 | Delivery dashboard + alerting: sends/delivery/bounce/opt-out rates per facility/template, failure queue with follow-up tasks, silent-failure detectors and dead-letter surface | PRD 05 CN-19, FR-19 | M | B-054 | Phase 2 |
| 76 | B-076 | Tenant rate increases: one-off + rule-based scheduling, minimum-notice enforcement, approval review screen, templated notice generation and delivery, auto-apply to first invoice on/after effective date | PRD 02 §4.3 US-11; PRD 05 CN-9 | M | B-044, B-053 | Phase 2 |
| 77 | B-077 | Unit transfer wizard: close old lease / open new, two-sided proration, atomic status updates, unified tenant history | PRD 02 US-14 (transfer) | M | B-040 | Phase 2 |
| 78 | B-078 | POS depth: drawer sessions (float, close-out, over/short), deposits reconciliation report, merchandise sales (locks/boxes SKUs, stock, COGS) | PRD 02 US-33/US-34, US-39(6) | L | B-039, B-048 | Phase 2 |
| 79 | B-079 | Staff & org hardening: TOTP MFA for staff, org-level defaults push (fees, templates, timelines) with visible per-facility overrides | PRD 00 §7.1; PRD 02 US-4 | M | B-004, B-053 | Phase 2 |
| 80 | B-080 | Hardware hardening: nightly expected-vs-actual reconciliation job, adapter contract-test suite, stub PTI/OpenTech adapters in vendor-emulation profiles, adapter health dashboards, camera link management, webhook secret rotation | PRD 03 §8 Phase 2, FR-9/FR-10 | L | B-027, B-064 | Phase 2 |
| 81 | B-081 | Customer website fast-follows: map view + "use my location", ACH + Stripe Link, monthly statements center, insurance tier change + proof upload, size-estimator quiz, future-dated/multi-unit checkout | PRD 01 §9 Phase 2 | L | B-015, B-036 | Phase 2 |
| 82 | B-082 | Marketing reach: city pages (`ItemList` schema) + markdown/MDX content hub with guide schema, funnel reporting v2 (source/medium, sequence attribution, promo ROI), Search Console integration, duplicate-content warnings | PRD 04 §3.2 US-4, §7 Phase 2 | L | B-066, B-069 | Phase 2 |
| 83 | B-083 | Certified-mail API integration for lien notices with tracked proof + online auction platform listing from the auction pipeline | PRD 02 US-30 | M | B-061, B-062 | Phase 2 |
| 84 | B-084 | Reporting depth: scheduled report emails, monthly close with frozen snapshots, management summary pack, QuickBooks-compatible journal export | PRD 02 US-40, §8 | M | B-055, B-042 | Phase 2 |

## Milestone 8: Phase 3 — grow & extend

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 85 | B-085 | First real gate-vendor driver (OpenTech CIA or PTI StorLogix Cloud — needs partner agreement, PRD 03 OQ-5) + kiosk-mode evaluation/decision | PRD 00 §6 Phase 2 (hardware); PRD 03 §8 Phase 2–3 | L | B-080 | Phase 3 |
| 86 | B-086 | Smart-entry shared access (Nokē-class, simulated unless partnered): secondary time-boxed credentials, individual revocation, native-app/PWA spike for Bluetooth unlock | PRD 03 US-8, §8 Phase 3 | L | B-080 | Phase 3 |
| 87 | B-087 | Marketing API automation: Google reviews ingestion (retire manual entry), GBP API sync with discrepancy alerts, IndexNow/sitemap ping, structured-data monitoring | PRD 04 §7 Phase 3 | M | B-071, B-067 | Phase 3 |
| 88 | B-088 | Revenue-management aids (occupancy-based street-rate suggestions, one-click apply) + owner KPI dashboard | PRD 02 US-12; PRD 00 §6 Phase 3 | M | B-042, B-055 | Phase 3 |
| 89 | B-089 | Growth marketing bundle: per-city/size landing-page generation, offer A/B testing, referral program, marketplace (SpareFoot-style) channel evaluation | PRD 00 §6 Phase 3; PRD 04 §7 Phase 3 | L | B-082 | Phase 3 |
| 90 | B-090 | Tenant experience & channel expansion: waitlists with notify-me, business accounts (consolidated billing), online transfer flow, delinquency payment plans/self-cure, live chat/AI assistant, two-way SMS inbox + broadcast sends, PWA push, Spanish/multilingual | PRD 01 §9 Phase 2–3; PRD 05 §8 Phase 3; PRD 00 §6 Phase 3 | XL | B-074, B-081 | Phase 3 |

## Appended after v1.0 — internal tooling

Added 2026-07-30, after the original 90 were sequenced. Appended rather than inserted so the global numbering above stays stable. **These are not in top-to-bottom build order** — their dependencies (B-003/B-004/B-005) are already built, so they are buildable at any point; the Phase column is the recommendation, not a gate.

| # | ID | Item | PRD/Feature | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| 91 | B-091 | Support impersonation core: `ImpersonationSession` model, four permissions, escalation guard (rank + facility-scope subset), read-only enforcement with the permanent hard-block list, persistent banner, dual-attribution audit (`impersonatorStaffId` on AuditLog), start/end/expiry | PRD 09 §5–7 Phase A | L | B-003, B-004, B-005 | Phase 2 |
| 92 | B-092 | Impersonation oversight: active-session list with force-end, impersonation report + CSV export, frequency flags. **No tenant notification and no tenant-facing activity view** (D-13a) — which makes this the *only* misuse-detection channel, so it should not trail B-091 indefinitely | PRD 09 §5.5, §8 Phase B | M | B-091 | Phase 2 |

---

## How to use this backlog with Claude Code

- **Work strictly top to bottom.** The order encodes the dependency graph; when you reach an item, everything it depends on is already built. Don't cherry-pick a later item unless its entire "Depends on" chain is done.
- **One item (or one small cluster) per session.** S/M items are a single focused session. L items should be split into 2–3 sessions at start ("build the state machine," then "build the UI on it"). B-090 (XL) must be split before starting.
- **Load the source PRD section as context.** Each item's PRD/Feature column points at the authoritative spec (e.g., "PRD 02 §4.5 US-17/US-18" → open `02-admin-dashboard-prd.md` and paste/reference that section plus the master PRD's data model §7.5). The PRD's acceptance criteria are the item's definition of done.
- **Start each session with:** the backlog row, the PRD section(s), the master PRD's cross-cutting requirements (§7 — auth, WCAG 2.1 AA, mobile-first, PCI scope, data model), and the current schema. End each session with tests passing (billing math and the rental funnel are the two places the PRDs demand tests) and the seed script updated if entities changed.
- **Two demo checkpoints:** after B-032 run the golden-path-1 demo (search → rent → pay → simulated gate code → welcome email). After B-055 run golden-path-2 (nightly run invoices a seeded lease → due-soon reminder → simulated failed payment → dunning step 1 → magic-link payment halts the ladder).
- **Don't resolve flagged conflicts silently.** If an item touches something in the Flagged gaps/conflicts list, get an owner decision first or build to the master PRD's position and note it.

## Rationale: top ordering decisions & trade-offs

1. **Foundation before any feature (B-001–B-012).** Every PRD reads/writes the shared schema (master §7.5) and assumes facility scoping, RBAC, audit logging, and an event bus. Building these once, first, prevents each module re-inventing them — the master PRD explicitly forbids modules re-deciding cross-cutting concerns.
2. **Golden Path 1 before the tenant portal or billing.** The MVP exit criterion (master §6) is "a real prospect can find a facility, rent and pay online, and appear in the rent roll." Milestone 2 is the shortest dependency chain to that: it forces the checkout state machine, Stripe, document generation, the ACS + simulator, and the comms core into existence — the five hardest shared subsystems — while producing a demoable product early.
3. **ACS + simulator inside Milestone 2, real vendors last.** PRD 03's own conclusion: the market is partner-gated, so the simulated adapter *is* the primary adapter for this build and the contract fixture for future real drivers. Gate codes are therefore "simulated but real" from the first move-in; vendor drivers wait until Phase 3 (B-085), matching PRD 03 over the master's more optimistic Phase 2 wording (flagged below).
4. **Comms core lands in Milestone 2, not 4.** The move-in confirmation email is required for Golden Path 1 anyway, so the idempotent send pipeline, message log, and Resend integration get built early and Milestone 4 only adds rules/templates on top. SMS consent capture and 10DLC registration also start here because registration has unknown external latency (PRD 05 §6.3) — consent must exist before SMS does.
5. **Portal before the autopay run.** B-045 (autopay) needs saved payment methods and the autopay toggle (B-036); the portal milestone also gives dunning links somewhere to land (B-051 deep-links into the pay screen). Interleaving admin essentials (tenant profile, POS, move-out) here means staff can operate the facility as soon as tenants exist.
6. **Billing before delinquency, delinquency before lien.** The dunning ladder (B-052) is driven by billing-engine day events by explicit PRD 05 requirement, so invoices/late fees must exist first. The full delinquency→lien→auction pipeline follows in Milestone 5 as Phase 2 per the master roadmap, even though PRD 02 labels it MVP (flagged) — the learning value and legal risk both argue for doing it after the money loop works.
7. **Marketing/SEO after the transactional core.** SEO pages sell inventory; there must be inventory, live pricing, and a working rental funnel to sell into. Within Milestone 6, master-MVP items (SEO infrastructure, lead capture, promotions) precede master-Phase-2 items (reviews, drips, abandonment). The main trade-off: promotions (B-070) sit late despite touching checkout — acceptable because checkout works without discounts, and B-070 depends on billing (B-044) to apply them to invoices correctly.
8. **Deliberate bundling at the tail.** Phase 2/3 items are bundled (B-078, B-080–B-082, B-089–B-090) to keep the list at ~90; split them when they're reached. MVP items are granular because they'll actually be built next.

## Flagged gaps/conflicts

> **STATUS: ALL RESOLVED 2026-07-30.** Every item below was decided by the owner — see `07-decisions.md` (D-1 through D-11b), which supersedes the text below. The list is kept for historical context only.

1. **Delinquency/lien scope — PRD 02 vs master.** PRD 02 marks the full delinquency, lien, and auction pipeline (US-25–29), POS drawer sessions (US-33), field ops (US-35–37), and all six reports (US-39) as MVP. Master §6 Phase 1 lists only "basic late-fee schedule" and "occupancy & rent-roll report," deferring the full pipeline, drawer, and roll-up depth to Phase 2. Master wins per its own precedence rule; backlog phases follow master (Milestones 5/7 = Phase 2). Owner should confirm.
2. **Marketing Phase 1 scope — PRD 04 vs master.** PRD 04 Phase 1 includes reviews display, review-request emails, promo codes in checkout, lead drips, and abandoned-reservation sequences. Master Phase 1 marketing is only SEO location pages, GBP linkage, and basic lead capture; the rest is master Phase 2. Backlog labels follow master; ordering follows PRD 04 (built together in Milestone 6). Note promotions are also PRD 02 MVP (US-10), so B-070 is kept MVP.
3. **Kiosk mode — master vs PRD 03.** Master Phase 2 hardware includes "kiosk mode (rental flow on an on-site tablet)"; PRD 03 explicitly defers kiosks to Phase 3 with a default answer of "no." Backlog follows PRD 03 (evaluation only, B-085).
4. **First real gate-vendor driver — master vs PRD 03.** Master Phase 2 promises "first real gate integration (one vendor driver)"; PRD 03 Phase 2 ships only stub adapters because partner agreements are out of scope for the learning build. Backlog follows PRD 03 (stubs in B-080; real driver B-085, Phase 3, contingent on a partnership).
5. **Rate increases — PRD 02 MVP vs master Phase 2.** PRD 02 US-11 (scheduled tenant rate increases with notices) is tagged MVP; master puts "rate-change management with tenant notices" in Phase 2. Backlog places it at B-076 (Phase 2).
6. **Stripe Billing vs ledger-driven charges (unresolved joint decision).** PRD 01 OQ-5 recommends admin-ledger-driven PaymentIntents; PRD 05 CN-6 references "Stripe Billing retry config." B-043–B-046 assume ledger-driven per the PRD 01 recommendation — needs an explicit decision before Milestone 4.
7. **Reservation deposit ambiguity.** PRD 01 mandates free, no-card reservations; PRD 02 US-14 describes reservations "with optional deposit"; master OQ-3 leaves the policy open. B-018 builds free-hold only; deposit support is an open owner decision.
8. **Consent store ownership.** PRD 04 defines `contact_consent`; PRD 05 adds `account_sms` and proposes the shared schema own the table (its OQ-8). B-002/B-032/B-072 must implement one shared package — assign ownership at Milestone 1.
9. **PRD cross-reference numbering is inconsistent.** PRD 02's header cites siblings as `01-master`, `03-customer-website`, `04-hardware`, `05-marketing`, but actual filenames are `00-master`, `01-customer-website`, `03-hardware`, `04-marketing`; PRD 05 (communications) is not in the master PRD's four-module feature map (§3) at all. Recommend a doc pass to renumber references and amend master §3 to five modules.
10. **State selection blocks legal configuration.** Master OQ-1 (operating states) gates lien timelines, notice templates, lease clauses, late-fee caps, and SMS disclosure copy (PRD 01 OQ-1, PRD 02 OQ-3, PRD 05 Q2/Q5). Milestone 5 (B-056, B-061) and B-074 cannot ship real defaults without it — needed before Milestone 5 starts.
11. **Minor phasing splits.** Spanish language: PRD 01 Phase 2 vs master Phase 3 multilingual (bundled in B-090). City pages: PRD 04 Phase 2 vs master Phase 3 "per-city/size landing-page generation" (backlog treats city pages as Phase 2 in B-082, generated size-in-city pages as Phase 3 in B-089). Autopay-tenant reminder default (PRD 05 Q1) needs an owner call before B-050 templates.
