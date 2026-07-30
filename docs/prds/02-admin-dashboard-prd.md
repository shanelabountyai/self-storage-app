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

### 4.1 Multi-Facility

**US-1 [MVP]** As a regional manager, I can switch my working facility from a persistent facility switcher so that all screens scope to that facility.
- AC: Switcher visible in the global header on every screen; shows facility name + code; search/filter for >5 facilities; switching preserves the current screen where meaningful (e.g., unit list reloads scoped) and lands on the facility dashboard otherwise; last selection persists per user across sessions.
- AC: An "All facilities" context is available only on roll-up screens (dashboard, reports) for roles with cross-facility access.

**US-2 [MVP]** As an owner, I see a portfolio dashboard rolling up occupancy, revenue MTD, delinquency exposure, and today's move-ins/outs per facility, so I can spot problems in under a minute.
- AC: One row/card per facility with unit occupancy %, economic occupancy %, revenue MTD vs prior month, delinquent tenant count and delinquent AR $, today's scheduled move-ins/outs; each metric links to the corresponding facility-scoped report; loads in <2s for 20 facilities.

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

**US-12 [P2]** Rules-based revenue management: automatic street-rate suggestions from occupancy per unit type (e.g., raise when type occupancy > 92%), one-click apply. (Comparable to incumbent "rate management" offerings — [Storable SiteLink](https://www.storable.com/products/sitelink/).)

### 4.4 Tenant & Lease Management

**US-13 [MVP]** As counter staff, I see a tenant profile with contact info, alternate contact, active/past leases, balance, payment methods, communication history, notes, and uploaded documents, so any staffer can pick up any conversation.
- AC: Tenant search by name, phone, email, unit number (partial match, <500ms); profile shows delinquency status prominently; notes support pinning; every note records author + timestamp and is immutable once saved (corrections are new notes).

**US-14 [MVP]** Lease lifecycle: reserve → move-in → (transfer)* → move-out.
- *Reserve:* holds a specific unit (or unit type) with optional deposit; auto-expires after configurable days; reserved units are excluded from availability. AC: expiry releases the unit and notifies the tenant; reservations created on the website (PRD 03) appear identically.
- *Move-in:* wizard collects tenant info (or links existing tenant), unit, rate (street ± promo), fees (admin fee, first period prorated per policy), insurance selection, lease generation → e-sign or print/countersign upload, payment, gate code issuance (event to PRD 04). AC: completing move-in sets unit `occupied`, creates the recurring billing schedule, and stores the executed lease PDF against the lease record.
- *Transfer:* moves a tenant to another unit in the same facility; closes old lease, opens new lease with new rate, prorates both sides per policy, keeps tenant history unified. AC: one wizard, one confirmation, both units' statuses update atomically.
- *Move-out:* records date, computes final balance (prorated refund or amount due per facility policy), settles or writes off small balances (≤ configurable threshold, logged), releases the unit to `available` (or `maintenance` if flagged for cleanout), revokes gate access (event to PRD 04). AC: cannot complete move-out with an unsettled balance above the write-off threshold without a manager override (logged).

**US-15 [MVP]** E-sign lease storage: executed leases (e-signed via the customer flow in PRD 03, or in-office) are stored immutably against the lease with signer, timestamp, IP (for e-sign), and template version.
- AC: Any staff role with tenant view access can view/download the lease PDF; re-generation of a lease document creates a new version, never overwrites; the e-sign provider integration is shared with PRD 03 (same envelope records).

**US-16 [MVP]** Document uploads on tenant/lease: ID copies, insurance certificates, correspondence, lien evidence. AC: PDF/JPG/PNG up to 20MB; documents are typed (ID, insurance, lien-notice, other); deletion is soft (admin-only) and audit-logged.

### 4.5 Billing Engine

**US-17 [MVP]** As the system, I generate recurring monthly invoices per lease on the configured billing day (anniversary-date or first-of-month per facility policy), including rent, insurance, recurring fees, and taxes, so tenants are billed accurately without manual work.
- AC: Invoices generate N days before due (configurable, default 5) and notify the tenant (email; SMS P2, shared comms service with PRD 03); line items carry tax treatment per facility tax settings; invoice numbering is sequential per facility and gapless.

**US-18 [MVP]** Proration: move-ins, move-outs, and transfers prorate rent by day count against the billing period, per facility policy (prorate in/out both configurable; option: no refund on move-out).
- AC: Proration math is deterministic and unit-tested (documented formula: daily rate = monthly rate / days in billing period; rounding half-up to cents at line level); every prorated line shows the day range on the invoice.

**US-19 [MVP]** Autopay: tenants with a stored payment method (card/ACH via the shared payment provider) are charged automatically on the due date in a nightly autopay run.
- AC: Autopay run is idempotent (safe to re-run; never double-charges); run results are visible in a Billing Runs screen (succeeded / failed / skipped with reasons); failures immediately enter the retry schedule.

**US-20 [MVP]** Failed-payment retry: configurable retry schedule (default: retry on day +1, +3, +5; max 3 retries), tenant notified on each failure, staff see a "failed payments" queue.
- AC: A payment that ultimately fails leaves the invoice unpaid and the lease enters the delinquency clock from the original due date (not the last retry); card-expired failures skip retries and notify the tenant to update the card (deep link to portal, PRD 03).

**US-21 [MVP]** Late fee schedule: per-facility rules such as "$X or Y% (greater/lesser) at N days late; second fee at M days" — applied automatically by the delinquency engine, itemized on the ledger.
- AC: Late fees respect configurable caps; waiving a late fee requires the fee-waive permission and a reason code; waivers are audit-logged and reportable.

**US-22 [MVP]** Partial payments: staff (and portal) can accept any amount; allocation order is configurable per facility (default: taxes → fees → insurance → oldest rent first).
- AC: Allocation is displayed at payment time and on the receipt; a partial payment does not by itself stop the delinquency clock (configurable: option to require balance below threshold to exit delinquency).

**US-23 [MVP]** Refunds: card refunds to original payment method via provider; cash/check refunds recorded as payable with a check-number field; all refunds require reason code and permission per RBAC-2.
- AC: Refund cannot exceed the original payment; partial refunds supported; refunds appear on deposits reconciliation and the audit log.

**US-24 [MVP]** Tenant ledger: a single chronological ledger per lease showing every charge, tax, payment, credit, refund, and write-off with running balance. AC: ledger totals always reconcile to invoice totals and reported AR; exportable to CSV/PDF.

### 4.6 Delinquency & Lien Workflow

Design informed by the commonly described US lien-sale process: default → denial of access/overlock → written lien notice with itemized claim and conspicuous sale warning → advertising per state rules → auction after statutory waiting periods → application of proceeds and handling of surplus. Notice delivery is commonly by verified mail or email where state law permits, with proof-of-delivery requirements varying by state; waiting periods (e.g., 5–10 days before access denial, ~15 days after first advertisement before sale) and advertising rules (e.g., newspaper publication once a week for two consecutive weeks vs. online advertising) vary by state ([Inside Self-Storage: 7 Steps to Lien-Sale Success](https://www.insideselfstorage.com/legal-issues/7-steps-to-lien-sale-success-avoiding-wrongful-sale-liability-in-the-self-storage-auction-process); see also [OpenTech lien-law update](https://opentechalliance.com/blog/self-storage-legislation-update-changes-to-your-self-storage-lien-laws/) and [Column's California notice guide](https://www.column.us/resources/what-you-need-to-know-about-storage-units-and-public-notice-of-sale-in-california/)). **The workflow below is therefore a configurable state machine, not a hardcoded legal process. Not legal advice; operators must validate configuration with counsel per state.**

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

**US-29 [MVP]** Per-state disclaimer & guardrails: the timeline configuration screen displays a persistent disclaimer that lien requirements vary by state and configurations must be attorney-reviewed; the system requires a facility "state" and shows the configured timeline summary on every auction approval screen.
- AC: No default timeline is presented as legally compliant; defaults are labeled "example configuration."

**US-30 [P2]** Integrations: certified-mail API for automated pre-lien/lien mailing with tracked proof; online auction platform listing (e.g., StorageTreasures-style) from the auction pipeline.

### 4.7 Communications (supporting)

**US-31 [MVP]** All tenant-facing messages (invoices, receipts, failure notices, rate-increase letters, delinquency notices) are template-driven per facility, sent via the shared comms service (email in MVP; SMS and print/mail queue P2), and logged on the tenant communication history with timestamp, channel, and template version.

### 4.8 Walk-In Operations (POS)

**US-32 [MVP]** As counter staff, I complete a walk-in move-in at the counter in under 5 minutes: pick unit from map/list → tenant details → lease e-sign on a tablet/counter screen (or print) → take payment (card via terminal/manual entry, cash, or check) → receipt (print/email) → gate code issued.
- AC: The POS flow is the same move-in wizard as US-14 with a payment step supporting card, cash (with tendered/change calculation), and check (check # required); cash and check payments post to the drawer session.

**US-33 [MVP]** Cash/check recording & drawer management: each facility day has a drawer session — opening float, all cash/check transactions, close-out count with over/short recorded and explained.
- AC: Drawer close-out produces a deposit slip summary (cash total, check list) that feeds the deposits reconciliation report (US-40); over/short beyond a configurable threshold requires a manager note; sessions are audit-logged.

**US-34 [P2]** Merchandise sales: locks, boxes, packing supplies as SKU'd inventory per facility — price, tax category, stock count, low-stock alert — sellable standalone or attached to a move-in; simple COGS report.

### 4.9 Tasks & Operations

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

---

## 6. Data & Integration Points

### 6.1 Core Entities (owned by this module unless noted)
`Facility` (settings, tax components, fee schedule, hours, timezone, state) · `UnitType` · `Unit` (facility, type, map coordinates, derived status) · `Tenant` (shared with PRD 03 portal identity) · `Lease` (unit, tenant, rate, billing day, status, timeline version) · `Reservation` · `Invoice` / `LineItem` / `Payment` / `Credit` / `Refund` / `LedgerEntry` · `Promotion` · `RateChange` (street) / `TenantRateIncrease` · `DelinquencyTimeline` / `DelinquencyStepInstance` (with proofs) · `Notice` (generated docs) · `AuctionRecord` · `DrawerSession` · `Task` / `MaintenanceTicket` · `Document` · `AuditEntry` · `User` / `RoleAssignment` (shared identity service).

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
- Tenants & leases: profiles, reserve/move-in/transfer/move-out, e-sign storage, notes, documents (US-13–16)
- Billing: recurring invoices, proration, autopay + retries, late fees, partial payments, refunds, ledger (US-17–24)
- Delinquency & lien: configurable timeline, queue, generated notices with proofs, auction pipeline with hard-blocked approvals, disclaimers (US-25–29)
- POS: counter move-in, cash/check, drawer sessions (US-32–33)
- Tasks: walkthrough checklist, overlock list, maintenance tickets (US-35–37)
- Audit log (US-38); Reports 1–6 with CSV (US-39); email comms (US-31)

### Phase 2
- Visual map layout editor; org-level settings push (US-4); revenue-management rate suggestions (US-12)
- Merchandise/retail inventory (US-34); SMS + print/mail queues; certified-mail and auction-platform integrations (US-30)
- Scheduled reports, monthly close + accounting export (US-40); approval workflows for refunds at scale; gate-activity display from PRD 04

### Phase 3 (candidates)
- Dynamic pricing engine; tenant-level LTV/churn analytics; multi-language notices; franchise/white-label org hierarchy; staff scheduling.

---

## 10. Open Questions

1. **Billing anniversary vs first-of-month:** support both per facility in MVP, or anniversary-only to simplify proration? (Leaning: both, since incumbents support both and migration demand expects it.)
2. **Delinquency clock vs partial payments:** default policy for whether a partial payment pauses the timeline — configurable in MVP (US-22), but what should the shipped default be? Needs owner input.
3. **State configuration depth:** do we ship example timeline presets per state (clearly labeled non-legal-advice), or only a single generic example? Presets are valuable but raise "implied compliance" risk — needs a decision with the disclaimer language.
4. **Map editor scope:** is JSON layout import acceptable for MVP, or is a minimal drag-to-place editor required for the learning-project demo?
5. **Insurance/protection plans:** treated here as a recurring line item; is a full insurance-program feature (provider integration, claims) in scope for any phase, and which PRD owns it?
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
