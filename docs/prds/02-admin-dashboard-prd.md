# PRD 02 — Admin/Operator Dashboard

**Product:** Self-Storage Business Application (learning project)
**Module:** Admin/Operator Dashboard (facility management back office)
**Status:** Draft v1.0 — 2026-07-30
**Author:** Product Management
**Sibling PRDs:** `00-master-prd.md` (vision, architecture, shared data model), `01-customer-website-prd.md` (public site, tenant portal, online move-in), `03-hardware-integrations-prd.md` (gate/access control, cameras, smart locks), `04-marketing-seo-prd.md` (acquisition, listings, SEO), `05-communications-prd.md` (payment reminders, dunning, SMS/email)

> **Legal disclaimer:** This document describes software behavior for a *configurable* delinquency and lien workflow. Self-storage lien law varies significantly by US state (notice types, delivery methods, waiting periods, advertising requirements, sale conduct). Nothing in this PRD is legal advice; operators must have their lien timelines and notice templates reviewed by an attorney licensed in each state where they operate. The system ships with sensible defaults and per-state configuration, not legal guarantees.

---

## 1. Overview & Goals

The Admin/Operator Dashboard is the internal web application used by staff of a multi-facility self-storage business to run daily operations: manage unit inventory, price units, move tenants in and out, bill them, chase delinquency through a legally-sensitive lien process, and report on the health of the business.

It is the operational core of the platform. The customer website (PRD 03) creates reservations, online move-ins, and payments that land here; hardware integrations (PRD 04) consume access rules (gate codes, overlock status) that are decided here; marketing (PRD 05) consumes availability and street rates published from here.

Industry incumbents (Storable SiteLink/storEDGE, Tenant Inc's Hummingbird, Easy Storage Solutions, Unit Trac) converge on the same operator feature set: multi-facility "corporate" tools, tenant lifecycle management (move-in/out, transfers), electronic lease signing, payment processing, collections/delinquency automation, rate management, and reporting dashboards ([Storable SiteLink](https://www.storable.com/products/sitelink/), [Storable products](https://www.storable.com/products/), [Taloflow comparison of Tenant Inc and Unit Trac](https://www.taloflow.ai/guides/comparisons/tenant-vs-unittrac-self-storage)). This PRD targets parity on the core of that set at a scale appropriate for a 1–20 facility operator, with a cleaner, modern UX.

### Goals

1. **Single pane of glass for operations.** A facility manager can run a site for a full day — move-ins, payments, walkthrough, delinquency actions — without leaving the dashboard.
2. **Multi-facility from day one.** Owner and regional roles see roll-ups across facilities; every operational entity (unit, tenant, rate, fee, task) is scoped to a facility.
3. **Automated, auditable billing.** Recurring invoicing, autopay, retries, late fees, and refunds run on schedules with a complete audit trail — cash handling is the exception, not the rule.
4. **Compliant-by-configuration delinquency.** The delinquency → overlock → pre-lien → lien → auction pipeline is driven by per-state, per-facility configurable timelines and templated notices, with immutable evidence of what was sent, when, and how.
5. **Decision-grade reporting.** Occupancy (unit and economic), move activity, delinquency aging, revenue, and deposit reconciliation are accurate enough to run the business and export cleanly to CSV.

### Non-Goals (module-level)

- **Public-facing surfaces.** Customer website, tenant self-service portal, online reservation/move-in checkout UX — PRD 03. This module exposes the APIs and settings they consume.
- **Physical hardware control.** Gate controller protocols, keypad firmware, camera feeds, smart-lock pairing — PRD 04. This module owns the *business state* (access allowed/denied, overlock flag) that hardware syncs against.
- **Marketing execution.** SEO, listings syndication, paid campaigns, email drip marketing — PRD 05.
- **Accounting system of record.** We produce journals/exports and reconciliation reports; we do not replace QuickBooks/Xero (integration is a data export in MVP, API sync later).
- **Payroll, HR, scheduling of staff shifts.**
- **Non-US operations.** US-only tax, lien, and notice assumptions in v1.
- **Native mobile apps.** Responsive web only in v1 (the daily walkthrough is designed mobile-web-first).
- **Automated legal compliance.** The system enforces *configured* timelines; it does not itself validate configurations against state statutes.

---

## 2. Personas

### 2.1 Priya — Facility Manager (primary daily user)
Runs one facility, on site 6 days/week. Splits time between the counter, the phone, and walking the property. Moderate computer skills; lives on a desktop at the counter and a phone on the lot.
- **Jobs:** counter move-ins/move-outs, taking payments (card/cash/check), daily walkthrough and lock checks, applying/removing overlocks, answering "what do I owe?" questions, opening maintenance tickets, executing delinquency steps the system queues for her.
- **Pain to avoid:** re-keying data, ambiguity about which delinquency step is due today, cash-drawer mismatches at close.

### 2.2 Marcus — Owner/Operator (economic buyer)
Owns 3 facilities, visits each weekly, manages from a laptop and phone. Cares about revenue, occupancy, delinquency exposure, and not getting sued over a bad lien sale.
- **Jobs:** portfolio dashboard review, approving rate increases and refunds over threshold, reviewing auction candidates before sale, monthly reconciliation and export to his accountant, configuring fees/policies.
- **Pain to avoid:** discovering a mis-run lien sale after the fact; occupancy numbers that don't match reality; margin leaking through unmanaged street rates.

### 2.3 Dana — Regional Manager (scale persona)
Oversees 8 facilities for a larger operator; each has its own manager. Desk-based, heavy report user.
- **Jobs:** cross-facility comparisons, enforcing pricing strategy, auditing manager actions (waived fees, manual discounts, deleted charges), pushing standard settings/templates to facilities, covering for absent managers remotely.
- **Pain to avoid:** having to log in "as" each facility; not being able to tell which manager waived which fee.

Secondary personas: **relief/part-time counter staff** (needs a constrained, mistake-resistant subset), **bookkeeper/accountant** (read-only financial reports and exports).

---

## 3. Roles & Permissions

Role-based access control (RBAC) with facility scoping. A user has exactly one role per facility assignment; a user may be assigned to one, several, or all facilities.

| Capability | Counter Staff | Facility Manager | Regional Manager | Owner/Admin | Read-Only (Bookkeeper) |
|---|---|---|---|---|---|
| View tenants/units (assigned facilities) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Take payments, POS move-in | ✓ | ✓ | ✓ | ✓ | — |
| Move-out, transfers | — | ✓ | ✓ | ✓ | — |
| Waive fees / manual credits (≤ limit) | — | ✓ (limit) | ✓ (higher limit) | ✓ (unlimited) | — |
| Refunds | — | request | approve ≤ limit | approve | — |
| Edit unit inventory / statuses | — | ✓ | ✓ | ✓ | — |
| Street rate changes | — | propose | ✓ | ✓ | — |
| Existing-tenant rate increases | — | — | ✓ | ✓ | — |
| Delinquency step execution (queued) | — | ✓ | ✓ | ✓ | — |
| Delinquency timeline configuration | — | — | — | ✓ | — |
| Approve auction eligibility | — | — | ✓ | ✓ | — |
| Facility settings (hours, fees, taxes) | — | — | ✓ | ✓ | — |
| User management, roles | — | — | — | ✓ | — |
| Reports (own facility) | ✓ (ops only) | ✓ | ✓ | ✓ | ✓ (financial) |
| Cross-facility roll-ups | — | — | ✓ | ✓ | ✓ |
| Audit log | — | — | view | view | — |

**Requirements:**
- **RBAC-1:** Permissions are enforced server-side on every API endpoint; the UI hides what the role can't do.
- **RBAC-2:** Monetary authority limits (max fee waiver, max refund without approval) are configurable per role at the org level; exceeding the limit creates an approval request routed to the next role up.
- **RBAC-3:** All auth via the shared identity service (master PRD); staff accounts require MFA for Owner/Admin and Regional roles.
- **RBAC-4:** Session facility context (see 5.1) never widens data access beyond assigned facilities.

---

## 4. User Stories & Acceptance Criteria

Grouped by feature area. AC = acceptance criteria. Stories tagged **[MVP]** or **[P2]** (see Phasing, §9).

> **Numbering note.** US-41 through US-44 were added on 2026-07-31 from the operator review and are filed in the section they belong to, so numbering is not sequential *within* a section. Numbers are never reused or renumbered — they are referenced from `06-backlog.md` and commit messages.

### 4.1 Multi-Facility

**US-1 [MVP]** As a regional manager, I can switch my working facility from a persistent facility switcher so that all screens scope to that facility.
- AC: Switcher visible in the global header on every screen; shows facility name + code; search/filter for >5 facilities; switching preserves the current screen where meaningful (e.g., unit list reloads scoped) and lands on the facility dashboard otherwise; last selection persists per user across sessions.
- AC: An "All facilities" context is available only on roll-up screens (dashboard, reports) for roles with cross-facility access.

**US-2 [MVP]** As an owner, I see a portfolio dashboard rolling up occupancy, revenue MTD, delinquency exposure, and today's move-ins/outs per facility, so I can spot problems in under a minute.
- AC: One row/card per facility with unit occupancy %, economic occupancy %, revenue MTD vs prior month, delinquent tenant count and delinquent AR $, today's scheduled move-ins/outs; each metric links to the corresponding facility-scoped report; loads in <2s for 20 facilities.
- AC: **No tile shows a lifetime cumulative count.** Every count carries a time window or a resolution concept in its own label ("Failed payments (this month)"), because a number that only ever goes up under a heading like "needs attention" trains the reader to ignore the row within a week. A tile with nothing to show says so in words; a permanent em dash is noise that teaches the eye to skip the whole row.
- AC: Every tile is a link to the filtered list or report behind it, as those screens land. A tile whose destination does not exist yet is not a tile.
- AC: The facility dashboard answers the counter's actual question — **"what can I rent right now?"** — with an *Available now* tile showing the real count of `available` units, hinted with the reserved count. `occupied / total` does not answer it, because reserved, maintenance and unrentable all sit in the gap.

**US-3 [MVP]** As an owner, I configure per-facility settings — office hours, gate hours, tax rates (state/county/city components), fee schedule (admin fee, late fees, NSF fee, lien fees), timezone, address — so each site operates under local rules.
- AC: Settings are versioned (effective-dated for tax rates and fees); gate hours are exposed via API for PRD 04; changing a tax rate applies to invoices generated after the effective date, never retroactively; every change is audit-logged.

**US-4 [P2]** As an owner, I can define org-level defaults (fee schedule, notice templates, delinquency timeline) and push them to selected facilities, with per-facility overrides flagged visibly.

### 4.2 Unit Inventory

**US-5 [MVP]** As a facility manager, I see an interactive facility map (or auto-generated grid fallback) of all units, color-coded by status, so I can answer "what's available" and find a unit visually.
- AC: Statuses and colors: `available` (green), `occupied` (blue), `reserved` (yellow), `overlocked` (red), `maintenance` (gray), `unrentable` (hatched). Clicking a unit opens a detail panel (size, type, attributes, rate, tenant if occupied, balance, quick actions). Map supports zoom/pan; a list view with the same filters is always available. Facilities without an uploaded map layout get the grid view grouped by building/floor.
- AC: Map layout is editable by admin: place/resize unit rectangles on a floor plan image (P2: layout editor; MVP: grid view + optional pre-built JSON layout import).

**US-6 [MVP]** As a facility manager, I manage unit types (e.g., 10x10 Climate, 5x5 Drive-Up, Parking) with attributes (dimensions, floor, climate control, drive-up, power, door type) and assign units to types.
- AC: Unit types are per-facility but clonable across facilities; a unit belongs to exactly one type; type changes on an occupied unit warn and do not change the tenant's current rate.

**US-7 [MVP]** As a facility manager, I can bulk-edit units (select by filter → change status, type, or attributes) so setup and corrections don't require unit-by-unit clicks.
- AC: Bulk operations preview affected units and require confirmation; blocked transitions (e.g., occupied → available) are skipped and reported; bulk changes appear as one grouped audit entry with per-unit detail.

**US-8 [MVP]** Unit status is derived, not free-form: `occupied`/`reserved` come from lease state; `overlocked` from delinquency state; only `maintenance`/`unrentable`/`available` are manually settable, and only when no active lease exists.
- AC: The system rejects manual status edits that contradict lease/delinquency state, with a clear error naming the blocking record.

### 4.3 Pricing & Revenue Management

**US-9 [MVP]** As a regional manager, I set street rates per unit type per facility, with effective dates, so new rentals price correctly and the website (PRD 03) always shows the current rate.
- AC: Street rate changes are effective-dated and never alter existing leases; rate history per unit type is viewable; current street rates are exposed via API to PRDs 03/05.

**US-10 [MVP]** As an owner, I create promotions (e.g., "first month 50% off", "$1 first month", fixed $ off for N months) with constraints (facilities, unit types, date range, online-only vs in-store, min stay implied by recapture rules).
- AC: A promotion applied at move-in generates the correct discounted charges on the right invoices automatically; promotions show on the lease and on invoices as discount line items; expired promotions can't be applied; overlapping promotions require explicit stacking rules (default: no stacking, best single discount).

**US-11 [MVP]** As a regional manager, I schedule rate increases for existing tenants — one-off (selected tenants) or rule-based (e.g., tenants ≥ 9 months since last increase and ≥ $15 below street) — with required advance notice, so revenue keeps pace without violating notice terms.
- AC: Each scheduled increase records: tenant, unit, current rate, new rate, effective date, notice date. The system generates the notice letter/email from a template on the notice date (see 4.7 for delivery), and blocks effective dates that violate the facility's configured minimum notice period (default 30 days; configurable, since required notice varies by state/lease). The new rate applies automatically to the first invoice on/after the effective date, with proration if mid-cycle billing anniversary rules require it. Increases are cancellable up to the effective date; cancellation is audit-logged.
- AC: A rate-increase review screen shows pending increases with projected revenue delta; regional/owner approval is required before notices go out.
- **AC (schema, MVP — must exist before the data does):** every change to a lease's in-place rate writes a `LeaseRateChange` row — lease, previous cents, new cents, effective date, reason (`move_in`, `ecri`, `transfer`, `promo_expiry`, `manual`), actor, notice-sent reference (nullable until this story ships), and the notice days given. The **first** row is written at move-in. `Lease.monthlyRateCents` remains the current rate and is written **only** through the function that writes the history row — the same discipline as `recomputeUnitStatus()`.
  This is deliberately built ahead of the workflow it serves (D-5 keeps the workflow in Phase 2, and that stands). Rule-based eligibility asks two questions — when did we last raise this tenant, and how far below street is he — and neither can be reconstructed retroactively. If the history starts when the workflow ships, the first year of tenants is permanently ineligible.
- **AC (promotional rates):** a discount is a line item; the lease rate is the real rate. A "$1 first month" tenant is not a $1 tenant. Recording a promotion as the lease rate makes economic occupancy lie and makes the first rules-based increase batch do something absurd.

**US-12 [P2]** Rules-based revenue management: automatic street-rate suggestions from occupancy per unit type (e.g., raise when type occupancy > 92%), one-click apply. (Comparable to incumbent "rate management" offerings — [Storable SiteLink](https://www.storable.com/products/sitelink/).)

**US-44 [MVP]** As an owner, I configure the protection-plan catalog and the facility's protection policy, so every move-in either carries a plan or carries evidence of the tenant's own cover.
*(Added 2026-07-31 from the operator review. Protection is the highest-margin line on the invoice and is currently modelled as a checkbox: the tenant waives by claiming homeowner's cover, nobody sees the declaration page, the policy lapses eight months later, the unit floods, and the operator is in a coverage argument with no record.)*
- AC: Per-facility policy setting — protection **required** (with a proof-of-insurance waiver permitted) vs **optional**. Texas practice is generally "required, or show proof"; the setting ships defaulted and clearly labelled as configuration (D-10).
- AC: The plan catalog is coverage tiers with premium cents and coverage cents, **effective-dated like every other price in this system** (FR-9). The premium bills monthly and prorates identically to rent (US-18).
- AC: Waiving requires a structured record — carrier, policy number, expiry date, and an uploaded declaration page (typed document per US-16) — **or** an explicit manager override with a reason code, audit-logged, for the counter case where the tenant will not produce one.
- AC: **Lapse handling, decided as D-17 — notice, then auto-enrolment.** A nightly scan (B-043) finds recorded proof expiring within 30 days and sends the tenant a notice with a portal path to upload replacement proof. If the proof lapses without replacement, the lease is **enrolled into the facility's default protection tier**, the premium begins on the next invoice, and the tenant is notified of the enrolment and its cost. The behaviour is a per-facility policy setting and applies regardless of what the lease captured at signing. Lapsed proof also flags the lease and shows on the tenant profile, and a task is created so a human sees it.
- **Legal note on that AC (D-10, D-17):** auto-enrolment charges a tenant for a term the lease may not have explicitly captured. The owner has weighed that and chosen it. Before this runs against a real tenant it needs an attorney pass on three specific points — the notice copy, the lease clause that authorises enrolment, and whether the facility policy may apply to leases signed before the setting existed. As with every legal artifact in this project, the shipped text is a draft and is not legal advice.
- **Built in B-043, and how it ships (D-26):** the scan, the 30-day notice event, the lapse task and the enrolment all exist. The per-facility switch ships **off** and the default tier ships **unset**, so a lapsed proof raises a high-priority task and charges nothing until a facility deliberately turns it on in Settings — the attorney pass above is what the switch is waiting on. Two refusals guard it: Settings will not enable auto-enrolment with no tier chosen, and the scan will not enrol when the configured tier is no longer on sale, in both cases leaving the task for a person.
- AC: "insurance" describes cover the tenant already holds somewhere else. What we sell is a **protection plan**. The two words are not interchangeable in copy, in the schema, or on an invoice.
- AC: Attach rate is reportable: plan-enrolled leases ÷ new move-ins, per facility, per month, **and per staff member who completed the move-in**. Per-staff is the point — it is a coaching number, not a vanity metric.
- **Scope, decided 2026-07-31:** this ships as an **in-house protection plan catalog** with our own waiver record. §10 Q5 (whether a full insurance *program* — provider integration, claims — belongs in any phase, and which PRD would own it) **stays open** and is not a blocker: if a program is adopted later it replaces the catalog behind the same lease-facing behaviour.

### 4.4 Tenant & Lease Management

**US-13 [MVP]** As counter staff, I see a tenant profile with contact info, alternate contact, active/past leases, balance, payment methods, communication history, notes, and uploaded documents, so any staffer can pick up any conversation.
- AC: Tenant search by name, phone, email, unit number (partial match, <500ms); profile shows delinquency status prominently; notes support pinning; every note records author + timestamp and is immutable once saved (corrections are new notes).
- **AC (address of record, MVP — must exist before the data does):** the tenant's address is a **history**, not a mutable field. Every change writes a row with old and new values, the source (`portal`, `counter`, `mail_return`), the actor, and the timestamp; the current address is derived from the latest row. This holds wherever contact info is written — counter, portal, or import.
  The reason is evidentiary, not tidiness: on day 40 of a lien cycle a tenant updates his address in the portal, and "which address does the notice go to" has to be answerable from records rather than from inference. Mailing to the old one when he can show he told us is a wrongful sale; mailing to the new one when the lease states another may be a failure to use the address of record.
- **AC:** the `Lease` snapshots the address of record at signing. Notice generation stores the address it actually rendered on the `Notice` row alongside the document hash (US-27), so "where did you send it" is answered by the record.
- **AC:** an address row can be flagged **returned mail**, which makes the tenant's contact information visibly stale everywhere it renders and creates a task (US-41) rather than sitting in a folder.
- **AC:** consent to receive **notices by email** is its own consent type, distinct from `account_email` and from marketing consent, captured with the disclosure version at lease signing. Texas permits electronic notice only where the tenant agreed to it; overloading the account-email consent destroys the ability to prove that agreement.

**US-14 [MVP]** Lease lifecycle: reserve → move-in → (transfer)* → move-out.
- *Reserve:* holds a specific unit (or unit type) with optional deposit; auto-expires after configurable days; reserved units are excluded from availability. AC: expiry releases the unit and notifies the tenant; reservations created on the website (PRD 03) appear identically.
- *Move-in:* wizard collects tenant info (or links existing tenant), unit, rate (street ± promo), fees (admin fee, first period prorated per policy), insurance selection, lease generation → e-sign or print/countersign upload, payment, gate code issuance (event to PRD 04). AC: completing move-in sets unit `occupied`, creates the recurring billing schedule, and stores the executed lease PDF against the lease record.
- *Transfer:* moves a tenant to another unit in the same facility; closes old lease, opens new lease with new rate, prorates both sides per policy, keeps tenant history unified. AC: one wizard, one confirmation, both units' statuses update atomically.
- *Move-out:* records date, computes final balance (prorated refund or amount due per facility policy), settles or writes off small balances (≤ configurable threshold, logged), revokes gate access (event to PRD 04). AC: cannot complete move-out with an unsettled balance above the write-off threshold without a manager override (logged).
  - AC: **move-out releases the unit to `maintenance`, never straight to `available`.** A staff "verified empty and clean" confirmation, with optional photo, is what makes it rentable again. Skipping the confirmation requires a manager override and is audit-logged. A unit that goes back on sale before anyone opened the door rents on Saturday with the last tenant's junk and a padlock still on it, and costs a same-day refund and a review.
  - AC: three dates are recorded and never collapsed into one — `moveOutDate` (physical), `paidThroughDate` (billing), and `noticeGivenAt`. Every argument at the counter is about the gap between them.
  - AC: two facility-level policy settings, defaulted to Texas practice and labelled as configuration (D-10): **prorate out vs no refund on move-out**, and **required notice days** (default: none). Both are already implied by the portal's move-out validation (PRD 01 US-707) and by US-18; they become explicit settings rather than constants.
  - AC: **abandonment / no-notice move-out is a distinct, staff-initiated path**, dated to the last known occupancy evidence (gate event, lock check), and it does not silently forgive the balance.
  - AC: an ended lease carrying a balance lands somewhere — a former-tenant AR list with a disposition of write-off (permission + reason code) or collections referral. It never simply disappears from the delinquency view, and it stays inside the AR aging report (US-39.4).
  - AC: gate access revokes **on the move-out date at facility close**, in facility-local time — not at midnight UTC and not whenever the next nightly run happens to fire.
- *Proration math is built once,* in the shared core package, in both directions (in and out). The transfer wizard is then a screen over existing math rather than a second implementation of it.

**US-15 [MVP]** E-sign lease storage: executed leases (e-signed via the customer flow in PRD 03, or in-office) are stored immutably against the lease with signer, timestamp, IP (for e-sign), and template version.
- AC: Any staff role with tenant view access can view/download the lease PDF; re-generation of a lease document creates a new version, never overwrites; the e-sign provider integration is shared with PRD 03 (same envelope records).

**US-16 [MVP]** Document uploads on tenant/lease: ID copies, insurance certificates, correspondence, lien evidence. AC: PDF/JPG/PNG up to 20MB; documents are typed (ID, insurance, lien-notice, other); deletion is soft (admin-only) and audit-logged.
- AC: this is **one** document store, used by lease PDFs, notices, walkthrough photos, overlock photos and auction evidence alike. Three URL columns on three entities is how the evidence chain ends up with three retention policies and two of them wrong.

**US-42 [MVP]** As a facility manager, I place a **hold** on a lease so that automated collections stop that night and the account cannot be sold, and so any staffer sees why the moment they open it.
*(Added 2026-07-31 from the operator review. US-25 already says the pipeline halts on "payment/move-out/hold", and nothing anywhere defines a hold. A tenant deploys, files Chapter 7, or dies and his daughter calls: selling the goods of an active-duty servicemember without a court order, or of a debtor under an automatic stay, is not a bad customer experience — it is a federal problem.)*
- AC: a `LeaseHold` record with type (`military_scra`, `bankruptcy`, `deceased`, `litigation`, `dispute`, `do_not_contact`, `payment_plan`), effective from/to, reason text, supporting-document reference (US-16), and placed-by actor. Multiple concurrent holds are allowed and each is evaluated independently.
- AC: **effects are declared per hold type as configuration, not hardcoded per screen** — halt dunning sends, halt late-fee assessment (configurable per type), halt access suspension, hard-block auction eligibility, suppress marketing channels. A new hold type is a configuration row, not six code changes.
- AC: any active hold renders as a persistent banner on the tenant profile, on the delinquency queue row, and on **every** notice-generation and auction-approval screen. A manager must never be able to approve a sale without the hold in view.
- AC: placing and lifting a hold is audit-logged with a reason; lifting a `military_scra` or `bankruptcy` hold requires manager-or-above.
- AC: the `deceased` type records an estate contact, and access decisions on that lease are staff-only rather than portal-driven.
- Note: which effects each hold type must have in Texas needs an attorney pass under D-10's framing. **The mechanism is built now regardless** — the effects are configuration, and the exposure is uncapped while it does not exist.
- **Built in B-096.** The catalog is `packages/core/holds`: seven types, each declaring its effects, whether lifting needs a manager, and whether it needs an estate contact. Every consumer asks `leaseHasEffect(...)` and none switches on the type, so a new type is a catalog entry. **A sixth effect was added beyond the five listed here — `halt_autopay` (D-31)** — because every listed effect stops us *asking* and none stops us *taking*, and charging a card under an automatic stay is a violation rather than a discourtesy. Concurrent holds **union** their effects rather than one winning, so a narrow hold beside a broad one can never weaken it. Placing needs `tenants:edit` and a reason; **lifting** is where the manager restriction lives, declared per type rather than checked against a hardcoded list. Wired consumers today: late-fee assessment, the autopay run, and the retry-reminder send. `halt_access_suspension` is read by **B-098** and `block_auction` by the Phase-2 pipeline.

### 4.5 Billing Engine

**US-17 [MVP]** As the system, I generate recurring monthly invoices per lease on the configured billing day (anniversary-date or first-of-month per facility policy), including rent, insurance, recurring fees, and taxes, so tenants are billed accurately without manual work.
- AC: Invoices generate N days before due (configurable, default 5) and notify the tenant (email; SMS P2, shared comms service with PRD 03); line items carry tax treatment per facility tax settings; invoice numbering is sequential per facility and gapless.
- **Built in B-044, and how it ships (D-27):** `anniversary` is the default policy and a lease's billing day is the **facility-local day it started**, clamped to 28 — so the move-in payment buys a whole period from that day and nothing is prorated on the way in. `first_of_month` is built and selectable. Idempotency is the unique constraint on `(leaseId, periodStart)`, so the run is re-runnable and catches up missed dates without re-billing. Numbering uses the same gapless row-lock counter as receipts (D-22), zero-padded so the series sorts as it reads. Tax is applied per jurisdiction to the **rent line only** — a protection plan is not rent; per-component taxability per state is the seam a second state will need (D-10).

**US-18 [MVP]** Proration: move-ins, move-outs, and transfers prorate rent by day count against the billing period, per facility policy (prorate in/out both configurable; option: no refund on move-out).
- AC: Proration math is deterministic and unit-tested (documented formula: daily rate = monthly rate / days in billing period; rounding half-up to cents at line level); every prorated line shows the day range on the invoice.
- **Built in B-044 as `packages/core/billing`**, which is the only implementation — B-077's transfer wizard calls it twice (a prorated move-out and a prorated move-in on one day) rather than building a second one. Rounding is at **line** level, asserted in a test: a daily rate rounded first and multiplied out is systematically two cents in the operator's favour on a $129 month. A full period never goes through the division at all, so a whole month bills exactly the rate. `charged + refunded === the full period` is asserted for every day of a 31-day month.

**US-19 [MVP]** Autopay: tenants with a stored payment method (card/ACH via the shared payment provider) are charged automatically on the due date in a nightly autopay run.
- AC: Autopay run is idempotent (safe to re-run; never double-charges); run results are visible in a Billing Runs screen (succeeded / failed / skipped with reasons); failures immediately enter the retry schedule.
- **Built in B-045.** "Never double-charges" is four layered guards, not one: `JobRun`'s uniqueness on (job, facility, business date) serialises the run against itself; the query excludes any invoice with a payment attempt already pending or succeeded; Stripe's idempotency key is derived from the invoice **and** the business date; and `createChargeIntent` recognises a deduplicated intent and discards its own duplicate row instead of colliding. The second guard is durable only because settlement writes a `PaymentAllocation` before the Stripe call and the webhook moves the invoice to paid — **D-28**. Skips are named, not counted: autopay off, no saved card, attempt in flight, nothing outstanding. An off-session decline arrives **synchronously** rather than as a webhook, so the run records it and emits `payment.failed` with Stripe's decline code itself — B-046's retry schedule and the `expired_card` short-circuit both read that code. Invoices due **on or before** the business date are collected, so an outage does not become a delinquency the tenant did not earn.

**US-20 [MVP]** Failed-payment retry: configurable retry schedule (default: retry on day +1, +3, +5; max 3 retries), tenant notified on each failure, staff see a "failed payments" queue.
- AC: A payment that ultimately fails leaves the invoice unpaid and the lease enters the delinquency clock from the original due date (not the last retry); card-expired failures skip retries and notify the tenant to update the card (deep link to portal, PRD 03).
- **Built in B-046.** The schedule is `Facility.paymentRetryDays`, defaulting to +1/+3/+5, and **every offset is measured from the invoice's original due date, never from the last attempt** — measuring from the previous try stretches a 5-day schedule into a 9-day one and the tenant drifts further past due on each decline instead of the schedule converging. That is the same anchoring rule `daysPastDue` uses (D-25). A terminal decline — `expired_card` and eight siblings — stops the schedule wherever it is, and is reported ahead of exhaustion because "the card has expired" is actionable where "we ran out of retries" is not. The failed-payments queue is a `Task` of type `failed_payment` (US-41), raised **once** and **withdrawn automatically** when the invoice is paid.
- **Owner decision, 2026-08-06 — when a person gets involved, and what the tenant hears.** The task is raised on the **second decline**, not when the schedule finishes: waiting for the whole +1/+3/+5 sequence means nobody looks for six days, by which time the tenant is most of the way to a late fee over something a phone call fixes. It is high priority whichever trigger raised it, and the retry schedule keeps running afterwards — a person and a retry are not alternatives. Separately, the tenant is messaged **once a day for three days from the first decline** (`payment.retry_reminder`), deliberately not one message per retry attempt: retries land on +1/+3/+5, so attempt-driven messages would arrive on days 1, 3 and 5 with silence in between, and the day the tenant is most likely to act — the day after they first hear — would say nothing. **This sends email until B-074 configures the SMS channel**, because MVP comms is email-only (PRD 05 FR-4); the message is an event and the channel is a rule, so it becomes a text with no code change here. The decline code travels on `payment.failed` for B-050 to branch on, and the portal deep link is B-051's.

**US-21 [MVP]** Late fee schedule: per-facility rules such as "$X or Y% (greater/lesser) at N days late; second fee at M days" — applied automatically by the delinquency engine, itemized on the ledger.
- AC: Late fees respect configurable caps; waiving a late fee requires the fee-waive permission and a reason code; waivers are audit-logged and reportable.
- AC: the fee catalogue covers what a facility actually charges: `admin`, `late`, `nsf`, `lien`, **`lock_cut`, `cleaning`, `damage`, `transfer`, `certified_mail`, `auction_cost`** — all effective-dated per facility like the original four (FR-9). Uncharged lock-cut and cleaning is $50–75 per move-out, and a fee with nowhere to post is a fee nobody charges.
- **Built in B-047.** The ladder is `LateFeeRule`, effective-dated **per step** so changing the second fee leaves the first alone, with `basis` of flat / percent / greater / lesser and a per-step cap. **The cap applies after the greater/lesser choice, not before** — "the greater of $20 or 10%, capped at $15" on a $900 balance is $15, where capping each side first returns $20 and breaches the configured cap. A fee never exceeds what is owed, and a credit balance can never produce a negative fee.
- **A late fee is its own invoice (`Invoice.kind = 'fee'`), and fees are never charged on fees.** The base and the days-past-due anchor both read **rent** invoices only; without that split an unpaid fee would age and earn more fees, and a balance would compound with nobody having decided it should. Its own invoice rather than a line appended to the rent invoice, because an invoice the tenant has already been sent must not change totals after the fact — and because autopay collects invoices, so a fee posted only to the ledger would never be charged automatically.
- **Assessment runs nightly at 2am local** (`billing.assess-late-fees`), between invoice generation at 1am and autopay at 3am, so a fee raised tonight is collected tonight. US-21 assigns this to the delinquency engine, which is **B-057** in Phase 2; that item drives these same functions from a timeline stage rather than reimplementing the arithmetic. A facility with no configured ladder is charged nothing — no ladder is an operator choice, not a reason to fall back to a default nobody agreed to.
- **Waiving** requires `fees:waive` at the facility, a reason code, and the amount within the actor's monetary limit (RBAC-2) — an over-limit refusal names the rank that can approve it rather than simply failing. The waiver posts a **credit** and marks the invoice `void`, never `paid` and never deleted: the charge and the credit that cancelled it both stay visible, and the revenue report can tell forgiven money from collected money.

**US-22 [MVP]** Partial payments: staff (and portal) can accept any amount; allocation order is configurable per facility (default: taxes → fees → insurance → oldest rent first).
- AC: Allocation is displayed at payment time and on the receipt; a partial payment does not by itself stop the delinquency clock (configurable: option to require balance below threshold to exit delinquency).

**US-23 [MVP]** Refunds: card refunds to original payment method via provider; cash/check refunds recorded as payable with a check-number field; all refunds require reason code and permission per RBAC-2.
- AC: Refund cannot exceed the original payment; partial refunds supported; refunds appear on deposits reconciliation and the audit log.

**US-24 [MVP]** Tenant ledger: a single chronological ledger per lease showing every charge, tax, payment, credit, refund, and write-off with running balance. AC: ledger totals always reconcile to invoice totals and reported AR; exportable to CSV/PDF.

### 4.6 Delinquency & Lien Workflow

Design informed by the commonly described US lien-sale process: default → denial of access/overlock → written lien notice with itemized claim and conspicuous sale warning → advertising per state rules → auction after statutory waiting periods → application of proceeds and handling of surplus. Notice delivery is commonly by verified mail or email where state law permits, with proof-of-delivery requirements varying by state; waiting periods (e.g., 5–10 days before access denial, ~15 days after first advertisement before sale) and advertising rules (e.g., newspaper publication once a week for two consecutive weeks vs. online advertising) vary by state ([Inside Self-Storage: 7 Steps to Lien-Sale Success](https://www.insideselfstorage.com/legal-issues/7-steps-to-lien-sale-success-avoiding-wrongful-sale-liability-in-the-self-storage-auction-process); see also [OpenTech lien-law update](https://opentechalliance.com/blog/self-storage-legislation-update-changes-to-your-self-storage-lien-laws/) and [Column's California notice guide](https://www.column.us/resources/what-you-need-to-know-about-storage-units-and-public-notice-of-sale-in-california/)). **The workflow below is therefore a configurable state machine, not a hardcoded legal process. Not legal advice; operators must validate configuration with counsel per state.**

**US-45 [MVP]** As an owner, a tenant who stops paying loses gate access on a fixed day and gets it back the moment he is current, without anyone deciding to act.
*(Added 2026-07-31, decided as **D-16**. Everything else in this section is Phase 2 per D-1 and stays there — this is the single threshold moved forward, because the rest of MVP has emails and late fees and no leverage. A tenant twelve days past due who can still open his unit with a working code has no reason to pay this week.)*
- AC: one per-facility, versioned rule — **suspend the tenant's `AccessGrant` at N days past due**, default 6 (Texas practice), configurable. Not a timeline engine: one threshold, two transitions, driven by the shared `daysPastDue(lease)` definition (US-39) and executed through the Access Control Service that already exists (PRD 03 US-3).
- AC: **restore is automatic** within ~2 minutes of a qualifying payment, with no staff action. The tenant is notified on both transitions.
- AC: **"qualifying payment" means the balance reaches zero** — rent, late fees, everything — held as a per-facility setting alongside the partial-payment allocation policy (US-22) so it can be relaxed later without a migration. It does not default silently, and it is the same setting the Phase-2 timeline reads. Rationale (D-16): any partial-payment rule teaches a tenant to pay the minimum that reopens the gate, every month.
- AC: suspension and restore each write an audit entry carrying the triggering invoice and the day count, and each renders on the tenant profile in plain English — "Access suspended, 12 days past due, 2026-07-18".
- AC: an active `LeaseHold` whose declared effects include halting access suspension (US-42) blocks this rule outright.
- AC: the Phase-2 delinquency engine (US-25) **inherits** this rule as its access step rather than reimplementing it; the rule's per-facility threshold becomes one step in the configured timeline when that lands.

**US-25 [MVP]** As an owner, I configure a delinquency timeline per facility as an ordered set of steps keyed to days-past-due, e.g.:

| Day (default) | Step | Automated action | Staff action queued |
|---|---|---|---|
| 1 | Late | Late fee #1, email reminder | — |
| 6 | Access denied | Gate access revoked (event → PRD 04), tenant notified | — |
| 10 | Overlock | — | Apply physical overlock (checklist item), photo optional |
| 15 | Pre-lien notice | Generate pre-lien letter from template; send per configured delivery (email and/or mail) | Verify/print/mail if postal; record certificate/tracking # |
| 30 | Lien notice | Generate formal lien notice: itemized claim, deadline, conspicuous sale statement | Record delivery proof |
| 45 | Second late fee / lien fee | Fee applied | — |
| 60 | Auction eligible | Flag lease auction-eligible; appears in auction pipeline | Regional/owner approval required to schedule sale |

- AC: Every step has: trigger day, automated actions, required staff tasks, notice template (if any), delivery method(s), and required proof fields. Steps are re-orderable and per-facility; a facility's timeline is versioned; the lease records which timeline version governed it.
- AC: Paying the qualifying amount (configurable: full balance vs. rent-only) automatically halts the pipeline, restores gate access (event → PRD 04), and queues overlock removal.

**US-26 [MVP]** As a facility manager, I have a Delinquency Queue: today's due steps grouped by type (overlocks to apply/remove, notices to mail, proofs to record), so nothing is missed.
- AC: Each queued item shows tenant, unit, balance, step, and days late; completing an item requires the step's proof fields (e.g., certified-mail tracking number, photo); overdue queue items escalate visually and appear on the regional roll-up.

**US-27 [MVP]** Generated notices: pre-lien and lien notices are generated from per-facility templates with merge fields (tenant, unit, itemized balance with accrual dates, deadline date, sale statement, facility contact info).
- AC: Every generated notice is stored as an immutable PDF on the lease with generation timestamp, template version, delivery method, delivery timestamp, and proof fields; the itemized claim on the notice reconciles to the ledger at generation time.

**US-28 [MVP]** Status tracking & auction pipeline: an Auction Pipeline screen lists auction-eligible leases with full step history (each step, date executed, proof), pending approvals, scheduled sale date, and advertising record fields (publication/site, dates run).
- AC: Scheduling a sale requires regional/owner approval and completion of all prior steps with proofs — the system hard-blocks scheduling if any required step lacks proof; sale outcome recording captures: sale date, buyer, gross proceeds, applied-to-balance amount, surplus amount and disposition note, unit released to `maintenance` for cleanout verification.
- AC: Cancelling a sale (tenant paid) at any point restores the normal lifecycle and logs the reason.
- **AC (lock cut and inventory):** date and time of the cut, the cutting staff member, disposition of the old lock, an itemised inventory of the unit's contents, and photographs — timestamped, stored immutably and hashed like the notices in US-27. This is the primary evidence that you sold what you said you sold.
- **AC (buyer record):** name, address, government-ID reference, sales-tax resale certificate where exempt, amount, payment method, and the cleanout deadline with its forfeit terms. A sales-tax return on auction proceeds cannot be filed without it.
- **AC (proceeds waterfall):** applied by the system in a fixed and stated order — reasonable sale costs → lien balance (rent, late fees, lien fees) → surplus — and **posted as ledger entries against the lease**, never typed in as a total.
- **AC (surplus):** a surplus is a liability with a statutory life, not revenue. Notify the former tenant at the address of record (US-13), hold for the state's required period, and record the disposition — claimed, or remitted to the state comptroller. Surplus quietly retained is how a routine auction becomes a class-action-shaped problem.
- **AC (vehicles, boats, trailers):** flag unit contents as vehicle-containing and **hard-block the standard auction path** with "requires separate vehicle lien process". Titled property follows a different notice and sale route in Texas and most states; running one silently through this pipeline is a wrongful sale by construction.
- Note: the Texas surplus holding period and the vehicle carve-out specifics need an attorney pass under D-10. The fields and the hard block are built now; the durations are configuration.

**US-29 [MVP]** Per-state disclaimer & guardrails: the timeline configuration screen displays a persistent disclaimer that lien requirements vary by state and configurations must be attorney-reviewed; the system requires a facility "state" and shows the configured timeline summary on every auction approval screen.
- AC: No default timeline is presented as legally compliant; defaults are labeled "example configuration."

**US-30 [P2]** Integrations: certified-mail API for automated pre-lien/lien mailing with tracked proof; online auction platform listing (e.g., StorageTreasures-style) from the auction pipeline.

### 4.7 Communications (supporting)

**US-31 [MVP]** All tenant-facing messages (invoices, receipts, failure notices, rate-increase letters, delinquency notices) are template-driven per facility, sent via the shared comms service (email in MVP; SMS and print/mail queue P2), and logged on the tenant communication history with timestamp, channel, and template version.

### 4.8 Walk-In Operations (POS)

**US-32 [MVP]** As counter staff, I complete a walk-in move-in at the counter in under 5 minutes: pick unit from map/list → tenant details → lease e-sign on a tablet/counter screen (or print) → take payment (card via terminal/manual entry, cash, or check) → receipt (print/email) → gate code issued.
- AC: The POS flow is the same move-in wizard as US-14 with a payment step supporting card, cash (with tendered/change calculation), and check (check # required); cash and check payments post to the drawer session where one exists (drawer sessions are Phase 2 per D-1 — the attribution below is not).
- **AC (attribution, MVP):** `Payment.receivedByStaffId` is set from the **session actor**, never from a form field, and is required and non-overridable for `cash`, `check`, and `money_order`. A $200 cash payment that posts with a facility id, a timestamp and no human attached is how money walks out of storage facilities, and it is invisible until an annual audit.
- **AC (daily summary, MVP):** a per-facility per-business-day payments summary — every payment taken that day by method, with the staff name, totals per method, printable as a deposit slip listing check numbers. This is a **read over `Payment`**; it is not a drawer session and does not pre-empt US-33.
- **AC:** cash payments over a configurable amount, and any cash refund, require manager-or-above through the existing monetary-authority machinery (RBAC-2).
- **AC:** receipt numbering is gapless per facility, the same discipline as invoice numbering in US-17, so a voided receipt is a visible gap with a reason rather than an absence.

**US-33 [MVP]** Cash/check recording & drawer management: each facility day has a drawer session — opening float, all cash/check transactions, close-out count with over/short recorded and explained.
- AC: Drawer close-out produces a deposit slip summary (cash total, check list) that feeds the deposits reconciliation report (US-40); over/short beyond a configurable threshold requires a manager note; sessions are audit-logged.

**US-43 [MVP]** As counter staff, I capture a phone or walk-in inquiry in under a minute, so the half of our rentals that start on the phone are in the system instead of on a sticky note.
*(Added 2026-07-31 from the operator review. "Do you have a 10x10 and how much?" is a ninety-second call that converts often. Today there is nowhere to put it: the web forms are a marketing-module item, the reservation flow is customer-facing, and the counter move-in assumes the person is standing there with a card. The consequence is a lead-to-rental report showing only web leads and looking excellent.)*
- AC: a "new inquiry" action reachable in one click from any admin screen: name, phone, what they need, target date, unit-type interest, and source (`phone`, `walk_in`, `referral`, `drive_by`) — writing a `Lead` (the entity already exists in the shared schema).
- AC: from that lead, one click to **quote** (current online and in-store price for the type, plus any applicable promotion) and one click to place a **free hold** through the same reservation service the website uses, with `source = phone`. No card, no account, under 60 seconds end to end.
- AC: a lead not contacted within the facility's configured window generates a follow-up task (US-41). A lead with no disposition is visible, never silently ageing in `new`.
- AC: source and channel carry through reservation → move-in, so the move-in/move-out report (US-39.3) can split walk-in vs phone vs web. Web-only attribution is the classic way software talks an owner into defunding the phone.

**US-34 [P2]** Merchandise sales: locks, boxes, packing supplies as SKU'd inventory per facility — price, tax category, stock count, low-stock alert — sellable standalone or attached to a move-in; simple COGS report.

### 4.9 Tasks & Operations

**US-41 [MVP]** As a part-timer alone on a Saturday, I open **one list** that tells me what to do today at this facility, instead of checking seven queues.
*(Added 2026-07-31 from the operator review. Failed payments, move-out verifications, delinquency steps, overlocks, manual gate commands, bounced emails and move-in provisioning failures are each specced as their own queue, and `Task` appears in §6.1's entity list with nothing building it. Left alone, each of those grows its own table and its own screen, and the manager who works seven screens skips the last three — against a success metric of ≥95% of delinquency steps executed on their scheduled day.)*
- AC: one `Task` entity: facility, type, subject entity (lease / unit / tenant / payment), due date as a **facility-local business date**, priority, assignee (nullable = anyone at the facility), status, required proof fields as typed JSON, completion actor + timestamp, and the **source event id** so a task is traceable to whatever created it.
- AC: creation is **idempotent**, keyed on (type, entityId, businessDate) — a re-run of a nightly job produces one overlock task, not four. This matches the existing job-run idempotency contract.
- AC: one "My day" list per facility: everything due today or overdue, grouped by type, **mobile-first** because half of it is done while walking the property. Overdue items escalate and roll up to the regional view.
- AC: a task whose type demands proof (tracking number, photo) cannot be completed without it. There is no "mark done" shortcut past a required proof field.
- AC: completion is audit-logged wherever the underlying action is sensitive — overlock applied, delinquency step executed, gate command performed manually.
- AC: **every later queue is a filtered view of this list, not a new table.** US-26 (delinquency), US-35/36 (walkthrough, overlock), US-20's failed payments, PRD 03 US-6's manual gate queue, PRD 05 CN-19's failure follow-ups, and PRD 01 FR-4.6's provisioning failures all create and read `Task`.

**US-35 [MVP]** Daily walkthrough checklist: a mobile-web checklist generated daily per facility: overlocks to apply/remove (from delinquency engine), lock checks on recently vacated units, space-by-space verification items, and free-form findings that convert to maintenance tickets.
- AC: Checklist completion status is visible to regional roll-up; items can attach photos; skipped days are visible (not silently absent).

**US-36 [MVP]** Overlock list: a dedicated, always-current list of units that *should be* overlocked vs. *confirmed* overlocked (and the removal equivalent), reconciling system state with physical state.
- AC: Applying/removing an overlock is confirmed by the walker (with optional photo); mismatch > 24h old is flagged on manager and regional dashboards.

**US-37 [MVP]** Maintenance tickets: create (from walkthrough, unit page, or manually), assign, prioritize, track status (open/in-progress/blocked/done); tickets on a unit can set the unit to `maintenance`.
- AC: A unit cannot be set `available` while a blocking ticket is open; ticket history stays with the unit.

### 4.10 Audit Log

**US-38 [MVP]** As an owner/regional, I can review an immutable audit log of sensitive actions: fee waivers/credits/write-offs, refunds, rate changes (street and tenant), lease edits, move-out overrides, delinquency step overrides/skips, notice generation and delivery, auction approvals and outcomes, settings changes, permission/user changes, document deletions, drawer over/short, and manual unit-status overrides.
- AC: Each entry: actor, timestamp (UTC + facility local), facility, entity (type + id), action, before/after values (for edits), reason code where required. Append-only; filterable by actor/entity/action/date; exportable to CSV; retained ≥ 7 years.

### 4.11 Reporting

**US-39 [MVP]** As an owner, I can run these reports, per facility and rolled up, with date-range selection and CSV export:
1. **Occupancy** — unit occupancy % (occupied ÷ rentable units), square-foot occupancy %, by unit type; point-in-time and trend.
2. **Economic occupancy** — actual rent revenue ÷ gross potential rent at street rates; plus rate variance report (in-place rate vs street per unit).
3. **Move-ins / move-outs** — counts, net, by source (walk-in, phone, web — source data shared with PRD 03/05), with conversion from reservations.
4. **Delinquency aging** — AR buckets (0–10, 11–30, 31–60, 61–90, 90+), tenant-level detail, delinquency step distribution, total exposure.
5. **Revenue** — billed vs collected, by category (rent, fees, insurance, merchandise, taxes collected), discounts/promos given, write-offs.
6. **Deposits reconciliation** — per day per facility: system-recorded payments by method (card batches from processor, cash, check) vs drawer close-outs and processor settlement records; variances flagged (US-33).
- AC: Every report: facility filter, date range, on-screen table + summary tiles, CSV export matching on-screen data exactly; report numbers are consistent with each other (one metrics definition layer — e.g., "occupied" means the same everywhere); month-end snapshot values are frozen once the month closes (P2: formal close process).
- **AC (the metrics layer is a module, not an intention):** a shared `metrics` module in the core package owns every definition, each with a written formula and unit tests — unit occupancy (occupied ÷ rentable, where **rentable excludes `unrentable` and includes `maintenance`** — state it, do not leave it to be inferred), square-foot occupancy, economic occupancy (collected ÷ gross potential at street), rate variance, AR aging buckets, days-past-due, move-in/move-out counts, delinquent AR. **No screen, tile, or export computes any of these inline.** The first time the owner dashboard says 91% and the rent roll says 88%, he stops trusting both, and a week goes on proving which one was right.
- **AC:** `daysPastDue(lease)` has exactly one definition, computed from the **original** invoice due date and never from the last retry attempt (US-20), and is used by the dashboard tile, the late-fee run, and every later delinquency consumer.
- **AC:** roll-up equals the sum of the facility reports with no double counting — asserted in a test, not stated in a document.
- **AC (report 3 has an owner):** move-ins/move-outs is not an optional extra. Counts and net by facility and date range, by source (walk-in / phone / web per US-43), with reservation-to-move-in conversion and average days from reservation to move-in, CSV matching the screen exactly. It is the report a multi-site manager opens every morning.
- **AC (rate variance is a report, not a column):** in-place rate vs current street rate per occupied unit, sorted by gap, with months since the last change (US-11). That report is the worklist the Phase-2 rate-increase workflow runs from.

**US-40 [P2]** Scheduled report emails; management summary pack (monthly PDF); accounting export (QuickBooks-compatible journal CSV).

---

## 5. Functional Requirements (consolidated)

### 5.1 Shell & Navigation
- FR-1: Global header: facility switcher (US-1), universal search (tenant/unit/invoice #), notification bell (queued approvals, failed runs, overdue delinquency steps), user menu.
- FR-2: Left nav: Dashboard, Units (map/list), Tenants, Leases, Billing, Delinquency, Auctions, POS/Drawer, Tasks, Reports, Settings, Audit Log — filtered by role.
- FR-3: Facility dashboard (default landing): today's move-ins/outs, payments today, delinquency queue count, walkthrough status, failed payments, occupancy tile.

### 5.2 Engines & Jobs
- FR-4: **Billing scheduler** — nightly per-facility jobs (facility-local time): invoice generation, autopay run, retry run, late-fee assessment, delinquency step evaluation, reservation expiry. All runs idempotent, logged to a Billing Runs screen with per-item outcomes, and manually re-runnable by admin.
- FR-5: **Delinquency engine** — evaluates each delinquent lease against its facility timeline version nightly; executes automated actions, queues staff tasks, emits gate-access events.
- FR-6: **Document generation service** — templated PDF generation (leases, notices, receipts, rate letters) with merge-field validation (generation fails loudly on missing fields; never sends a notice with blank merge fields).
- FR-7: **Event bus (per master PRD)** — this module emits: `unit.status_changed`, `lease.moved_in/out/transferred`, `access.revoke/restore` (PRD 04), `rates.updated` (PRD 03/05), `overlock.required/cleared` (PRD 04); consumes: `reservation.created`, `payment.succeeded/failed` (portal-initiated), `esign.completed` (PRD 03).

### 5.3 Data Integrity
- FR-8: Money stored as integer cents; all financial mutations are double-entry-style ledger events; no destructive edits to posted financial records (corrections are reversing entries).
- FR-9: Effective-dating for: tax rates, fee schedules, street rates, delinquency timelines, notice templates.
- FR-10: Soft delete only for tenants/leases/documents; hard delete never exposed in UI.
- FR-11: Concurrency: optimistic locking on lease/tenant edits; billing jobs take per-lease locks.

### 5.4 Non-Functional
- FR-12: Responsive web; walkthrough/overlock/tasks screens optimized for phone; POS optimized for desktop + card terminal.
- FR-13: p95 < 500ms for search and unit map; nightly runs complete in < 30 min for 20 facilities × 800 units.
- FR-14: Availability target 99.5%; billing jobs recover automatically after downtime (catch-up runs).
- FR-15: PII and payment data handling per master PRD (tokenized payments only — no PAN storage; provider handles PCI scope).

### 5.5 Accessibility — WCAG 2.1 AA (admin surfaces)

*Added 2026-07-31 from the accessibility review, which found that this PRD contained no accessibility text at all — no "accessib", no "WCAG", no "keyboard", no "contrast", no "aria". Master PRD §7.2 puts admin surfaces in scope in two sentences, and PRD 01 §6.8 is scoped to the customer site, so every admin item to date has been built from a spec that never mentioned AA. That is why the shipped admin routes carry the majority of the audit's blocking findings.*

This section is the admin equivalent of PRD 01 §6.8 and is an acceptance criterion on **every** story in this PRD, not a later cleanup. Staff are users, a manager may be the one with low vision, and a back office is exactly where nobody notices for three years.

- **FR-16 Inherited baseline.** Everything in PRD 01 §6.8 applies here: semantic HTML and landmarks, correct heading order, full keyboard operability, ≥4.5:1 text contrast, ≥3:1 for UI components *and focus indicators*, colour never the sole carrier of meaning, reflow to 320px, text resizable to 200%, `prefers-reduced-motion` respected. Admin shares the customer site's design tokens, so a token that fails on the public site fails here too — fix it once, in the token.
- **FR-17 Bypass and shell.** Every admin page has a skip link as its first focusable element, targeting a `<main id="main" tabIndex={-1}>`. Without one, a keyboard or switch user tabs the facility switcher, the search, the bell, the user menu, sign-out and every nav item **on every page load** before reaching content.
- **FR-18 No context change on input (3.2.2).** No `<select>`, checkbox, filter or sort control submits a form or navigates on `change`. The facility switcher, every queue filter, and every report control carry a visible submit. Arrow-keying a select fires `change` on every option passed on some platforms — an auto-submitting switcher navigates a keyboard user to three wrong facilities on the way to the fourth. Where the working context does change, the new context is announced (a `role="status"` on the header facility name is enough).
- **FR-19 Errors are identified, suggested, and announced (3.3.1, 3.3.3, 4.1.3).** Server actions **return** error state rather than throwing — a thrown error is not a user-facing error message. Field errors render adjacent to their control, referenced by `aria-describedby`, with `aria-invalid="true"`; a summary above the form receives focus on submit so the user hears the count and can jump to each. Messages carry a *suggestion*, not just an identification: "State must be a 2-letter code, e.g. TX."
- **FR-20 Success is announced too.** Every form has one `role="status"` region **rendered empty at page load** and filled on state change ("Tax rate added, effective 2026-08-01"). A live region inserted into the DOM already populated is unreliably announced by VoiceOver and routinely missed by NVDA — the region must pre-exist the event. The same rule governs every async control: a control that goes silent for ten seconds after activation has failed, and a control that disables itself while busy blurs the user's focus to `<body>`. Use `aria-busy` and a changed label instead of `disabled`.
- **FR-21 Error prevention for financial and legal data (3.3.4).** Any append-only or irreversible financial configuration — tax components, fee schedule rows, street rates, late-fee rules, refunds, scheduled rate increases — passes through a confirm step that **echoes the parsed result back in the user's terms**: "Add a **state** tax of **8.25%** to *Demo — Austin South*, effective **1 Aug 2026**. This cannot be edited or deleted," with explicit Confirm and Cancel. Values are range-checked server-side and implausible input is rejected with a suggestion rather than stored — a fat-fingered `825` must not become an 825% tax rate on every future invoice. The bulk-edit preview-then-apply shape (US-7) is the pattern to reuse, not to reinvent.
- **FR-22 Tables carry their relationships (1.3.1, 2.4.6).** The identifying cell of a row is a `<th scope="row">` (unit number, day name, tenant name) and header cells are `scope="col"`. **Every repeated control in a table names its row** — a rotor listing "Set" 200 times or fourteen checkboxes all named "Closed" is unusable by ear. Sortable columns carry `aria-sort`; the row count is announced after filtering; bulk actions announce their outcome ("14 units updated, 2 skipped") rather than only re-rendering the table. Disabling a control in response to another control's state is announced, or the control is made read-only and left reachable instead.
- **FR-23 Queues, escalation, and charts.** Visual escalation of overdue work never relies on colour alone — text or icon-plus-text (1.4.1). Dashboard charts carry a data-table equivalent or a full text summary, and series are distinguished by more than hue.
- **FR-24 Verification.** `/admin/*` routes are in the automated axe run using the existing authenticated staff session, alongside the public routes. Automated scanning is a floor: it checks text contrast only, cannot judge announcement, and only ever sees a freshly loaded page — so scans additionally run **after** an invalid form submit and after a bulk-edit preview opens, and token contrast pairs get a unit test. Focus-indicator visibility and screen-reader announcement get a recorded manual pass, and "recorded" means a line in `docs/PROGRESS.md`, not a memory.

---

## 6. Data & Integration Points

### 6.1 Core Entities (owned by this module unless noted)
`Facility` (settings, tax components, fee schedule, hours, timezone, state) · `UnitType` · `Unit` (facility, type, map coordinates, derived status) · `Tenant` (shared with PRD 03 portal identity) · `TenantAddressHistory` (US-13) · `Lease` (unit, tenant, rate, billing day, status, timeline version, address snapshot at signing) · `LeaseRateChange` (US-11) · `LeaseHold` (US-42) · `Reservation` · `Invoice` / `LineItem` / `Payment` (incl. `receivedByStaffId`, US-32) / `Credit` / `Refund` / `LedgerEntry` · `Promotion` · `ProtectionPlan` / `ProtectionWaiver` (US-44) · `RateChange` (street) / `TenantRateIncrease` · `DelinquencyTimeline` / `DelinquencyStepInstance` (with proofs) · `Notice` (generated docs, incl. the address it rendered) · `AuctionRecord` · `DrawerSession` · `Task` (US-41) / `MaintenanceTicket` · `Document` · `AuditEntry` · `User` / `RoleAssignment` (shared identity service).

Four of these are deliberately built **before** the workflow that consumes them, because their value is entirely that they exist before the data does and none of them can be reconstructed retroactively: `LeaseRateChange`, `TenantAddressHistory`, `LeaseHold`, and `Payment.receivedByStaffId`.

### 6.2 Integration Map

| Counterparty | Direction | What |
|---|---|---|
| Customer website / portal (PRD 03) | in | Reservations, online move-ins, portal payments, e-sign completions, tenant contact updates |
| Customer website / portal (PRD 03) | out | Availability + street rates + promos, tenant balance/ledger, invoices/receipts, gate code, lease documents |
| Hardware (PRD 04) | out | Access revoke/restore per tenant/gate-code, overlock required/cleared, gate hours |
| Hardware (PRD 04) | in | Gate activity events (shown on tenant profile), door alarm events → tasks (P2) |
| Marketing (PRD 05) | out | Availability/rates feed, move-in source attribution capture |
| Payment provider (shared service) | both | Tokenized charges, refunds, settlement/batch files for reconciliation |
| E-sign provider (shared service) | both | Envelope creation, signed-document webhook |
| Email/SMS provider (shared comms) | out | All tenant messaging (US-31) |
| Accounting (P2) | out | Journal export CSV (QuickBooks-compatible) |
| Certified mail / auction platforms (P2) | both | Tracked mailing of lien notices; auction listings + results |

Contract details (schemas, event names) live in the master PRD's shared architecture section; this module treats them as the source of truth.

---

## 7. Success Metrics

**Operational efficiency**
- Counter move-in completed in ≤ 5 minutes (median, timed in-app).
- ≥ 95% of delinquency steps executed on their scheduled day (no silent skips).
- Daily walkthrough completion rate ≥ 90% of facility-days.

**Financial accuracy**
- 100% of nightly billing runs complete or auto-recover without manual intervention (target ≥ 99% of nights).
- Deposits reconciliation variance = $0 on ≥ 95% of facility-days; 100% of variances explained within 48h.
- Autopay success rate ≥ 92% after retries (industry-typical card churn assumed).

**Revenue management**
- 100% of tenant rate increases delivered with ≥ configured notice and correct first invoice.
- Rate variance (street vs in-place) visible for 100% of occupied units; economic occupancy report adopted (viewed weekly by owner persona).

**Risk**
- 0 auction approvals with missing step proofs (hard-blocked by design; metric verifies no override path).
- 100% of sensitive actions present in audit log (verified by periodic automated self-audit).

**Learning-project proxies (no real users):** end-to-end demo scenarios pass: 90-day simulated facility (move-ins, billing cycles, one full delinquency-to-auction arc, month-end reports reconcile).

---

## 8. Reporting (summary)
See US-39/40. Principles: one shared metrics-definition layer; every report exportable to CSV; roll-up = sum of facility reports with no double counting; frozen month-end snapshots (P2 close process). Occupancy and economic occupancy are the two headline KPIs on every dashboard.

---

## 9. Phasing

### MVP (Phase 1) — "Run one to three facilities for real"
- Multi-facility shell: switcher, portfolio dashboard, per-facility settings (US-1–3)
- Units: grid + basic map view (JSON layout import), types/attributes, bulk edit, derived statuses (US-5–8)
- Pricing: street rates, promotions, scheduled tenant rate increases with notice letters (US-9–11)
- Tenants & leases: profiles with address-of-record history, reserve/move-in/transfer/move-out, e-sign storage, notes, documents, lease holds (US-13–16, US-42)
- Tasks as one entity with one per-facility "my day" list, consumed by every queue (US-41); phone/walk-in inquiry capture (US-43); protection-plan catalog and waiver record (US-44)
- Billing: recurring invoices, proration, autopay + retries, late fees, partial payments, refunds, ledger (US-17–24)
- Delinquency: **the single access-suspension threshold with automatic restore on a zero balance (US-45, D-16)** — the configurable timeline, queue, generated notices, auction pipeline and disclaimers (US-25–29) remain Phase 2 per D-1
- POS: counter move-in, cash/check, drawer sessions (US-32–33)
- Tasks: walkthrough checklist, overlock list, maintenance tickets (US-35–37)
- Audit log (US-38); Reports 1–6 with CSV (US-39); email comms (US-31)

### Phase 2
- Org-level settings push (US-4); revenue-management rate suggestions (US-12)
- ~~Visual map layout editor~~ — **dropped** (operator review, 2026-07-31). A site layout is drawn once and never again; JSON layout import plus the grid view, both shipped, are the correct answer. This also settles §10 Q4 in the negative. Reopen only if a real facility cannot express its layout as JSON.
- Merchandise/retail inventory (US-34); SMS + print/mail queues; certified-mail and auction-platform integrations (US-30)
- Scheduled reports, monthly close + accounting export (US-40); approval workflows for refunds at scale; gate-activity display from PRD 04

### Phase 3 (candidates)
- Dynamic pricing engine; tenant-level LTV/churn analytics; multi-language notices; franchise/white-label org hierarchy; staff scheduling.

---

## 10. Open Questions

1. **Billing anniversary vs first-of-month:** support both per facility in MVP, or anniversary-only to simplify proration? (Leaning: both, since incumbents support both and migration demand expects it.)
2. ~~**Delinquency clock vs partial payments:**~~ **Closed 2026-07-31 by D-16 — the balance must reach zero.** A partial payment does not restore gate access and does not exit delinquency; the threshold is a per-facility setting so it can be relaxed without a migration. Any partial rule teaches a tenant to pay the minimum that reopens the gate, every month.
3. **State configuration depth:** do we ship example timeline presets per state (clearly labeled non-legal-advice), or only a single generic example? Presets are valuable but raise "implied compliance" risk — needs a decision with the disclaimer language.
4. ~~**Map editor scope:**~~ **Closed 2026-07-31** — JSON layout import plus the grid view is the answer, and the drag-to-place editor is dropped from Phase 2 (see §9).
5. **Insurance/protection plans:** treated here as a recurring line item; is a full insurance-program feature (provider integration, claims) in scope for any phase, and which PRD owns it? — **Still open, deliberately.** Deferred on 2026-07-31 rather than answered: US-44 proceeds with an in-house protection plan catalog and our own waiver record, which is not blocked by the answer. Revisit when there is a reason to — a licensing question, a provider offer, or a claim we cannot handle ourselves.
6. **Approval routing:** single-step approvals (this PRD) vs a shared approval-workflow service used by other modules — master PRD decision.
7. **Processor settlement ingestion:** MVP reconciles against drawer + system records; when do we ingest processor settlement files automatically (needed for true 3-way reconciliation)?
8. **Data migration:** importing tenants/ledgers from SiteLink/storEDGE exports — Phase 2 feature or out of scope for the learning project?
9. **Timezone edge cases:** nightly runs at facility-local time across DST transitions — confirm job-scheduler behavior in master PRD architecture.

---

## Sources

- [Storable SiteLink product page](https://www.storable.com/products/sitelink/) — operator features: corporate multi-facility tools, e-sign, payments, collections, reporting, CRM, marketplace integrations.
- [Storable products overview](https://www.storable.com/products/) and [storEDGE/Edge](https://www.storable.com/products/edge/) — platform scope of the leading incumbent.
- [Inside Self-Storage — 7 Steps to Lien-Sale Success](https://www.insideselfstorage.com/legal-issues/7-steps-to-lien-sale-success-avoiding-wrongful-sale-liability-in-the-self-storage-auction-process) — default determination, access denial (state waits of ~5–10 days in some states), lien notice contents (itemized claim, conspicuous sale statement), verified mail/email delivery, advertising (newspaper 2 consecutive weeks vs online), waiting periods (e.g., ~15 days after first ad), bidder minimums, surplus handling; wrongful-sale claims mostly arise from administrative mistakes.
- [OpenTech Alliance — Lien Laws Update](https://opentechalliance.com/blog/self-storage-legislation-update-changes-to-your-self-storage-lien-laws/) — ongoing state-by-state legislative change, motivating per-state configurability.
- [Column — Storage Units and Public Notice of Sale in California](https://www.column.us/resources/what-you-need-to-know-about-storage-units-and-public-notice-of-sale-in-california/) — example of state-specific public-notice requirements.
- [SpareFoot — Understanding the Self-Storage Lien Process](https://www.sparefoot.com/blog/understanding-the-self-storage-lien-process) — consumer-facing overview of the lien process.
- [Taloflow — Tenant Inc vs Unit Trac](https://www.taloflow.ai/guides/comparisons/tenant-vs-unittrac-self-storage) and [Easy Storage Solutions vs Tenant Inc](https://www.taloflow.ai/guides/comparisons/easystorage-vs-tenant-self-storage) — feature comparison context for smaller-operator software.

*Lien-law statements above are generalized from these sources; requirements vary by state and change over time. This document is not legal advice.*
