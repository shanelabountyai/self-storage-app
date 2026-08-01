# Master PRD — Multi-Facility Self-Storage Business Application

**Document:** 00-master-prd.md (Master PRD)
**Owner:** Product Management
**Status:** Draft v1.0 — 2026-07-30
**Companion module PRDs:** `01-customer-website-prd.md`, `02-admin-dashboard-prd.md`, `03-hardware-integrations-prd.md`, `04-marketing-seo-prd.md`, `05-communications-prd.md` · **Build order:** `06-backlog.md`

This is the top-level product requirements document. It defines the vision, personas, feature map, platform strategy, tech stack, roadmap, and cross-cutting requirements for the whole system. Each module PRD inherits this document's decisions; where a module PRD conflicts with this one, this one wins until explicitly amended.

---

## 1. Product Vision & Business Context

### 1.1 Vision

Give a small-to-mid-size self-storage operator (2–10 facilities under one brand, with room to grow) a single, modern software platform that runs the whole business: customers find a facility online, reserve and rent a unit in minutes without visiting an office, pay automatically every month, and get in the gate — while the operator manages inventory, tenants, billing, delinquency, and marketing from one dashboard instead of a patchwork of spreadsheets, legacy management software, and third-party websites.

### 1.2 Business context

Self-storage is a large, steadily growing industry with unusually favorable software economics for an owner-operator:

- **Demand is broad and mainstream.** Industry surveys consistently show a large share of Americans renting storage — RentCafe's consumer survey found roughly one in five Americans rents a unit, and StorageCafe's 2025 demand analysis puts usage as high as one in three as space shortages grow ([RentCafe survey](https://www.rentcafe.com/blog/self-storage/self-storage-survey/), [StorageCafe 2025 trends](https://www.storagecafe.com/blog/self-storage-demand-and-trends-2025/)).
- **The U.S. market is tens of billions of dollars annually** and forecast to keep growing through the late 2020s ([Mordor Intelligence via GlobeNewswire](https://www.globenewswire.com/en/news-release/2023/07/25/2710555/0/en/United-States-Self-Storage-Market-Revenues-to-Reach-USD-48-73-billion-by-2028-Market-Size-Share-Forecasts-Trends-Analysis-Report-by-Mordor-Intelligence.html)).
- **Discovery is local and search-driven.** Storage is bought when a life event happens (move, downsize, divorce, death, business overflow), and prospects overwhelmingly start with a local online search ("storage units near me"); winning local SEO is treated as the primary demand channel by industry marketing guides ([Inside Self-Storage SEO guide](https://www.insideselfstorage.com/marketing/seo-survival-guide-for-self-storage-operators-building-a-modern-strategy-to-keep-you-on-top-in-a-competitive-market), [StoragePug: how tenants find you](https://www.storagepug.com/blog/how-do-tenants-find-you)).
- **The transaction can be fully self-serve.** Public Storage announced it had passed **one million contactless move-ins** through its web-based "eRental" online leasing process ([Public Storage press release](https://www.financialcontent.com/article/bizwire-2022-3-30-public-storage-celebrates-one-million-contactless-move-ins)) — proof that renting a unit end-to-end online, with no office visit, is now the industry norm, not an innovation.

**Our operator's problem today:** small multi-facility operators typically rent management software (Storable SiteLink/storEDGE, Tenant Inc, Easy Storage Solutions) plus a templated website plus separate gate software. It works, but it's expensive per-facility per-month, weakly differentiated for SEO, and hard to customize. This project builds an owned, integrated alternative — and doubles as a structured learning project for building a real production system with Claude Code.

### 1.3 Business goals (what success looks like)

1. **More move-ins at lower acquisition cost:** rank in local search for each facility's market; convert search → reservation → paid move-in fully online.
2. **Higher revenue per unit:** occupancy visibility, promotions, and (later) simple revenue management.
3. **Lower operating cost:** automated billing, autopay, delinquency workflows, and gate-access sync mean fewer manager hours per facility.
4. **Scales from 2 to 10+ facilities** without re-platforming: everything is multi-facility from day one.

### 1.4 Non-goals (v1)

- Marketplace aggregation (listing on SpareFoot-style marketplaces) — Phase 3 consideration.
- Portable storage / valet storage / truck rental lines of business.
- Dynamic AI-driven revenue management (start with manual pricing + promotions).
- Native mobile app (see Section 4 — responsive web first).

---

## 2. Personas

### 2.1 Prospective Renter — "Priya, 34, mid-move"

Priya is moving apartments in three weeks. She searches "storage units near me" on her phone during a lunch break, compares 3–4 facilities on price, size, distance, and reviews, and wants to lock in a unit *now* without phone calls. She has never rented storage before and doesn't know what size she needs.

- **Needs:** clear prices, a size guide, real availability, reviews, instant online reservation or rental, and a move-in cost with no surprise fees.
- **Frustrations:** "call for pricing," clunky mobile sites, mandatory office visits, hidden admin/insurance fees.
- **Success:** reserves or rents a unit from her phone in under 5 minutes.

### 2.2 Current Tenant — "Marcus, 52, long-term tenant"

Marcus has stored his late father's furniture for two years. He interacts with the facility rarely: he visits the unit a few times a year and otherwise just wants payments to happen automatically. Once or twice a year something comes up — a card expires, he needs his gate code, he wants a receipt for taxes, or he finally schedules a move-out.

- **Needs:** autopay that just works, easy card updates, gate code retrieval, payment history/receipts, a simple move-out flow, and clear notices if his rate changes.
- **Frustrations:** creating yet another account/app for something he touches four times a year; late fees caused by a silently expired card.
- **Success:** months go by with zero effort; when he does need something, the tenant portal solves it in two minutes on whatever device he's holding.

### 2.3 Facility Manager — "Dana, 41, runs 2 sites"

Dana manages day-to-day operations across two of the brand's facilities: walk-in rentals, unit walkthroughs, overlocking delinquent units, coordinating auctions, answering the phone, and keeping the site clean and secure. She lives in the management dashboard on a desktop at the front desk and on a tablet/phone while walking the property.

- **Needs:** a fast rent/move-in flow at the counter, a live unit map/list per facility, tenant lookup, taking payments, delinquency queue with next-action prompts (late notice → overlock → lien → auction), gate access control (suspend/restore codes), and daily task lists.
- **Frustrations:** software that requires head-office to do simple things; gate system and billing system disagreeing about who's locked out.
- **Success:** delinquency actions and gate status are always in sync automatically; a walk-in rental takes under 5 minutes.

### 2.4 Owner/Operator — "Sam, 47, owns the brand"

Sam owns the portfolio (currently 3 facilities, wants 10). Sam thinks in occupancy, revenue, delinquency rate, and cost per move-in. Sam sets street rates and promotions, reviews performance weekly, and makes buy/build/hire decisions. Sam is also the sponsor of this software project.

- **Needs:** cross-facility reporting (occupancy %, revenue, move-ins/outs, delinquency aging, promo performance), pricing controls, user/role management, and confidence that payments, legal notices, and lien processes are compliant.
- **Frustrations:** per-facility SaaS fees that scale with success; data trapped in vendor systems; no single view across sites.
- **Success:** one dashboard answers "how is the business doing?" in 30 seconds, and adding facility #4 is configuration, not a project.

---

## 3. Feature Map — Five Modules

The system is one platform with five product surfaces sharing one database and one auth system. Each has its own module PRD; summaries and interconnections below.

### 3.1 Customer Website (`01-customer-website.md`)

The public, SEO-optimized brand website plus the logged-in tenant portal. Prospects browse facilities and unit types with live availability and pricing, use a size guide, and either **reserve** (hold a unit, no/low commitment) or **rent** (full online move-in: lease e-sign, ID capture, insurance/protection-plan selection, first payment via Stripe, gate code issued instantly). Tenants log in to a portal to manage autopay, view invoices/receipts, retrieve their gate code, update contact/payment details, and schedule move-out. Fully mobile-responsive — the majority of first visits will come from phones (Section 4).

**Interconnects:** reads live unit availability and pricing from the same inventory the admin dashboard manages; a completed online rental creates the Tenant, Lease, Invoice, Payment, and AccessCredential records the dashboard and gate system use; leads that don't convert flow into the marketing module's lead pipeline.

### 3.2 Admin/Operator Dashboard (`02-admin-dashboard.md`)

The internal web app for managers and the owner. Covers: **inventory** (facilities, unit types, units, a visual/status unit map, walk-in rentals and transfers), **tenants & leases** (profiles, documents, notes, communication log), **billing** (recurring invoicing, autopay runs, manual payments, fees, refunds, rate changes), **delinquency & lien** (configurable late-fee/notice schedule, overlock queue, state-compliant lien and auction workflow with an auditable timeline), and **reporting** (occupancy, revenue, delinquency aging, move-in/out activity, per-facility and roll-up). Role-based: managers see their facilities; the owner sees everything plus pricing and user administration.

**Interconnects:** is the source of truth for inventory and pricing shown on the website; delinquency status changes automatically suspend/restore gate credentials via the hardware module; reporting consumes payment data from Stripe webhooks; promotions configured here surface on the marketing module's pages.

### 3.3 Facility Hardware Integrations (`03-hardware-integrations.md`)

The integration layer between the platform and on-site hardware: **gate access** (sync PIN codes to gate controllers — e.g., PTI, DoorKing, and cloud systems like OpenTech — issue on move-in, suspend on delinquency, revoke on move-out), **smart entry** (optional per-unit smart locks such as Janus Nokē, which use the vendor's Bluetooth mobile app for unlocking — see [Janus Nokē](https://www.janusintl.com/products/noke)), **cameras** (link/embed vendor camera feeds per facility for managers; event bookmarking), and **kiosk mode** (the customer website's rental flow running full-screen on an on-site tablet for after-hours walk-ups). Designed as an adapter pattern: one internal `AccessCredential` model, per-vendor drivers, with a manual-sync fallback ("code list export") so the platform works even before any hardware API is connected.

**Interconnects:** listens to lease/billing events (move-in, delinquent, cured, move-out) from the admin module and pushes credential changes to hardware; surfaces gate/entry event logs back into the tenant timeline and manager dashboard; the tenant portal displays the gate code it manages.

### 3.4 Marketing & SEO Layer (`04-marketing-seo.md`)

The demand engine. **Location pages:** a structured, schema.org-marked-up page per facility (and per unit-size-in-city landing pages) optimized for "storage units in {city}" queries — the industry's primary acquisition channel ([Inside Self-Storage SEO guide](https://www.insideselfstorage.com/marketing/seo-survival-guide-for-self-storage-operators-building-a-modern-strategy-to-keep-you-on-top-in-a-competitive-market)). **Reviews:** Google review solicitation after move-in, review display on location pages, response tracking. **Lead capture:** quote forms, click-to-call, abandoned-reservation follow-up emails/SMS, and a simple lead pipeline with source attribution. **Promotions:** promo codes and offers (e.g., "first month 50% off") with start/end dates, per-facility targeting, and conversion reporting.

**Interconnects:** location pages render live pricing/availability from inventory; leads convert into reservations/tenants in the core data model; promotions apply discounts inside the website's checkout and the dashboard's walk-in rental flow; reporting attributes move-ins to marketing sources.

### 3.5 Communications & Notifications (`05-communications-prd.md`)

The follow-up engine. **Payment reminders:** upcoming-due and due-date reminders by email and SMS, then a configurable past-due dunning ladder (day 1/5/10/30) with escalating tone and one-tap "pay now" magic links into the portal. **Transactional messaging:** move-in confirmations, gate code delivery, receipts, failed-payment alerts, rate-increase and delinquency-stage notices (as supplements to legally required mail). **Channels & compliance:** email plus Twilio SMS with A2P 10DLC registration, SMS consent captured at move-in, STOP/HELP handling, quiet hours, and per-tenant channel preferences. **Admin controls:** template editor, sequence configuration, suppression list, delivery dashboard, and full message history on the tenant record.

**Interconnects:** consumes billing/delinquency and lease events emitted by the admin module (billing decides *what and when is owed*; communications decides *how and when to say it*); pay-now links deep-link into the customer website's portal; marketing owns marketing consent while this module owns transactional/operational sends; message history renders in the admin tenant timeline.

---

## 4. Platform Recommendation: Mobile-Responsive Website vs. Native App

### 4.1 Recommendation

**Build a mobile-responsive website first. Do not build a native phone app in MVP or Phase 2.** Revisit a native app (or first a PWA) only in Phase 3, and only if we adopt Bluetooth smart-entry hardware whose unlock experience requires a native app — and even then, prefer the hardware vendor's existing app (e.g., Nokē) over building our own.

### 4.2 What the industry actually does

- **The giant operators are web-first for acquisition.** Public Storage's contactless "eRental" — a web-based online lease — passed **one million move-ins** as announced in 2022 ([press release](https://www.financialcontent.com/article/bizwire-2022-3-30-public-storage-celebrates-one-million-contactless-move-ins)). Renting happens on the website; the app is not the front door.
- **Their apps exist for *tenant convenience*, not rental acquisition.** Public Storage's app centers on account management and gate access from your phone ([Public Storage app help](https://help.publicstorage.com/manage-your-account/account-management/public-storage-app), [App Store listing](https://apps.apple.com/us/app/public-storage/id1537135259)); Extra Space's app similarly focuses on payments, account management, and contactless/Bluetooth gate entry ([Extra Space mobile app](https://www.extraspace.com/mobile-app/), [contactless entry FAQ](https://www.extraspace.com/self-storage/faq/do-you-offer-contactless-entry/)). These are billion-dollar REITs adding an app *on top of* a mature web funnel — the opposite of a reason for a 2–10 facility operator to start with an app.
- **The software vendors that serve operators our size sell websites, not apps.** Storable's SiteLink/storEDGE product line leads with responsive websites and an out-of-the-box **online rental center** ([storEDGE rental center](https://rental-center.storedge.com/), [SiteLink online rentals announcement](https://www.sitelink.com/about/news/sitelink-adds-outofthebox-online-rental-options-to-its-web-template-and-sitelinkstore), [Storable website product](https://www.storable.com/sitelink-integrations/storedge/)). Tenant Inc's award-winning Hummingbird platform is likewise web-platform-centric ([Tenant Inc award](https://www.einpresswire.com/article/544590816/tenant-inc-wins-inside-self-storage-best-of-business-award)), and Storable's Easy Storage Solutions targets small operators with website + management software bundles ([Easy Storage Solutions](https://www.storageunitsoftware.com/)). The entire vendor ecosystem's default answer for operators like ours is: responsive website with online rentals.
- **Discovery is search, and search lands on web pages.** Industry marketing guidance is unanimous that prospects find facilities through local search and Google Business Profiles, making local SEO the core acquisition strategy ([Inside Self-Storage](https://www.insideselfstorage.com/marketing/seo-survival-guide-for-self-storage-operators-building-a-modern-strategy-to-keep-you-on-top-in-a-competitive-market), [StoragePug](https://www.storagepug.com/blog/how-do-tenants-find-you), [StoragePug Google Trends analysis](https://www.storagepug.com/blog/self-storage-google-trends)). An app is invisible to that funnel; a fast mobile web page *is* the funnel. Operators have been optimizing for mobile web visitors since at least 2010, when U-Store-It (now CubeSmart) launched a mobile-optimized site ([CubeSmart/U-Store-It press release](https://s205.q4cdn.com/638877794/files/doc_news/2010/04/1/U-Store-It-Launches-Website-Optimized-for-Mobile-Users-04-14-2010-2010.pdf)).

### 4.3 Reasoning

1. **Acquisition is SEO-driven.** New rentals start with a local Google search on a phone. Search results open web pages, not apps. Every dollar spent on an app funnel is a dollar not spent on the funnel that actually produces move-ins.
2. **Tenant interactions are low-frequency.** A typical tenant touches the platform a handful of times a year (autopay update, gate code, receipt, move-out). Nobody installs and retains an app for that; app-install friction would actively lose conversions at the moment of rental.
3. **No install friction at the moment of intent.** Priya (Persona 2.1) is comparing four facilities in ten minutes. The operator whose mobile page loads fast and rents in five taps wins. "Download our app first" loses.
4. **One codebase, one team (you + Claude Code).** A responsive Next.js site is one deliverable; iOS + Android + web is three, plus app-store review cycles — a poor fit for a small operator and for a learning project's scope.
5. **The genuine app case is hardware, and it's deferrable.** The one capability that truly favors native is Bluetooth smart-lock unlocking (e.g., Janus Nokē per-unit smart locks, which ship with their own tenant app — [Nokē](https://noke.app/), [Nokē FAQs](https://www.janusintl.com/products/noke/noke-faqs)). If we adopt Nokē-class hardware in Phase 3, tenants use the *vendor's* app for unlocking while our platform manages credentials via API. Cloud/keypad gate access (PIN codes) needs no app at all. A PWA (installable, push-capable) is the intermediate step if tenant-portal engagement ever justifies a home-screen presence.

### 4.4 Decision record

| Option | Verdict | Why |
|---|---|---|
| Mobile-responsive website (SSR, fast, SEO-first) | **Build now (MVP)** | Matches how 100% of demand arrives; matches industry norm from REITs to small-operator vendors |
| PWA layer (installable, push notifications) | Phase 3, optional | Cheap upgrade to the same codebase if tenant engagement warrants |
| Native iOS/Android app | Not planned | Only justified by Bluetooth smart-entry at scale; use hardware vendor's app instead |

---

## 5. Suggested Tech Stack (for building with Claude Code)

Chosen to be mainstream (best Claude Code training coverage, best docs), boring where it matters, and cheap at 2–10 facility scale.

| Layer | Choice | Why | Alternatives |
|---|---|---|---|
| Framework | **Next.js (App Router) + React + TypeScript** | One framework for the SEO-critical public site (SSR/SSG), the tenant portal, and the admin dashboard; TypeScript catches errors early, which matters when an AI writes much of the code | Remix, SvelteKit; separate Vite SPA for admin |
| UI | **Tailwind CSS + shadcn/ui** | Fast to build consistent, accessible components; huge example corpus | Chakra, MUI |
| Database | **PostgreSQL** | Relational data (units, leases, invoices) is the heart of this product; Postgres is the default serious choice | MySQL; SQLite for local dev |
| ORM | **Prisma** (or Drizzle) | Schema-as-code migrations map cleanly to the data model in Section 7.5 | Drizzle, Kysely |
| Auth | **Auth.js (NextAuth) or Clerk** | Email/password + magic links for tenants; role-based sessions for staff; Clerk if we'd rather buy than build | Lucia, Supabase Auth |
| Payments | **Stripe** — Checkout/Elements + Billing + webhooks | Hosted payment fields keep us in the lightest PCI scope (SAQ A — Section 7.4); Stripe Billing handles recurring monthly rent and card-expiry retries | Stripe alone is the recommendation; industry-specific processors not needed at this scale |
| Hosting | **Vercel** (app) + **Neon or Supabase** (Postgres) | Zero-ops deploys, preview environments per PR — ideal Claude Code workflow | Railway, Render, Fly.io; AWS later if needed |
| Email/SMS | **Resend** (email) + **Twilio** (SMS) | Invoices, receipts, late notices, gate codes, lead follow-ups | Postmark, SendGrid |
| Background jobs | **Inngest or Trigger.dev** (or Vercel Cron for MVP) | Nightly billing runs, late-fee scheduler, gate-sync retries | BullMQ + a small worker if self-hosting |
| File storage | **S3-compatible (Cloudflare R2 / AWS S3)** | Lease PDFs, ID captures, auction photos | Vercel Blob, Supabase Storage |
| Monitoring | **Sentry** + Vercel Analytics | Errors and web vitals (SEO depends on Core Web Vitals) | — |
| Testing | **Vitest + Playwright** | Unit tests for billing math; end-to-end tests for the rental funnel — the two places bugs cost real money | — |

**Repo shape:** a single monorepo (`apps/web`, `packages/db`, `packages/core` for billing/lease domain logic, `prds/` for these documents). One deployable Next.js app serves public site, portal, and admin under role-gated routes until scale demands splitting.

---

## 6. Phased Roadmap

### Phase 1 — MVP: "Rent a unit online, run one facility's books" (~first build)

| Module | In MVP |
|---|---|
| Customer website | Facility pages with live availability & pricing, size guide, **online reservation + full online rental** (lease e-sign, Stripe first payment, gate code issued), basic tenant portal (view balance, pay, autopay on/off, gate code, receipts) |
| Admin dashboard | Facility/unit-type/unit CRUD, unit list with statuses, walk-in move-in/move-out, tenant profiles, recurring monthly invoicing + autopay via Stripe, manual payments, basic late-fee schedule, occupancy & rent-roll report |
| Hardware | **Manual-sync adapter only:** gate-code list export + "mark as synced"; `AccessCredential` model in place so real drivers slot in later |
| Marketing/SEO | SEO-correct location pages (schema.org `SelfStorage` markup, sitemaps, Core Web Vitals), Google Business Profile linkage, basic lead-capture form with email notification |

**MVP exit criteria:** a real prospect can find a facility on Google, rent and pay online, and appear correctly in the operator's rent roll — with zero manual data entry.

### Phase 2 — Operate at scale: "Automate the hard parts"

| Module | Phase 2 |
|---|---|
| Customer website | Move-out scheduling, unit transfers, protection-plan/insurance selection, saved payment methods, ACH option |
| Admin dashboard | Full **delinquency pipeline** (notice schedule, overlock queue, state-compliant lien & auction workflow with document generation and audit trail), rate-change management with tenant notices, refunds/credits, multi-facility roll-up reporting, staff roles & permissions hardening |
| Hardware | First real **gate integration** (one vendor driver, e.g., PTI or OpenTech cloud API): auto issue/suspend/revoke on lease events; gate event log on tenant timeline; kiosk mode (rental flow on an on-site tablet) |
| Marketing/SEO | Review solicitation & display, promo codes in checkout with conversion tracking, abandoned-reservation email/SMS follow-up, lead pipeline with source attribution |

### Phase 3 — Grow: "Optimize and extend"

| Module | Phase 3 |
|---|---|
| Customer website | PWA layer (installable portal, push for payment reminders) **if metrics justify**; multilingual pages |
| Admin dashboard | Revenue-management aids (occupancy-based street-rate suggestions), owner KPI dashboard, exports/accounting integration (QuickBooks), auction listing integrations |
| Hardware | Smart-entry integration (Janus Nokē-class) via vendor API + vendor tenant app; camera feed embedding & event bookmarks; second gate-vendor driver |
| Marketing/SEO | Per-city/size landing-page generation, A/B testing of offers, marketplace channel evaluation (SpareFoot-style), referral program |

---

## 7. Cross-Cutting Requirements

These apply to every module; module PRDs must not re-decide them.

### 7.1 Authentication & Roles

- One auth system, two audiences: **customers** (prospect → tenant) and **staff**.
- Roles: `tenant`, `manager` (scoped to assigned facilities), `owner` (all facilities + pricing + user admin), `system` (integrations/jobs). Design roles as data, not code, so adding `regional_manager` later is configuration.
- Staff auth requires MFA (TOTP) from Phase 2. Tenants use email/password + magic-link fallback.
- Every privileged action (rate change, fee waiver, credential suspend, lien step) is written to an append-only audit log with actor, timestamp, and before/after values.

### 7.2 Accessibility — WCAG 2.1 AA

- All customer-facing and admin surfaces meet **WCAG 2.1 AA**: semantic HTML, full keyboard operability, visible focus states, 4.5:1 text contrast, labeled form fields with inline error text, and screen-reader-tested rental and payment flows.
- Automated checks (axe) run in CI; the rental funnel and payment flow additionally get manual keyboard/screen-reader passes before each release.

### 7.3 Mobile Responsiveness

- Mobile-first CSS; every flow usable one-handed on a 360-px-wide viewport. The rental funnel is designed on mobile and adapted up to desktop, not vice versa.
- Performance budget on 4G mobile: LCP < 2.5 s on location pages (they are the SEO surface), CLS < 0.1.
- **That budget is the *field* target — the Core Web Vitals threshold real users are measured against. The CI *lab* gate is a different number** (D-19): Lighthouse's mobile run applies simulated 4× CPU throttling and reports pessimistically by design, so it warns at 2500 ms and fails at 3000 ms with run aggregation pinned. Two measurements, two purposes. Do not tighten the lab failure threshold to match the field target — a text-only page with nothing left to defer already reproduces ~2.6 s in the lab, and a gate that passes only because aggregation picked a lucky run is flaky rather than green.

### 7.4 Security & PCI Scope

- **Card data never touches our servers or our DOM-controlled inputs.** All card entry uses **Stripe-hosted surfaces (Stripe Checkout or Stripe Elements iframes)**; we store only Stripe customer/payment-method tokens. This keeps us in the minimal self-assessment tier (SAQ A / SAQ A-EP) rather than full PCI DSS scope.
- Webhook signatures verified; secrets in platform env vaults, never in the repo; TLS everywhere; per-role least-privilege DB access from app code.
- PII minimization: store only what leasing and lien law require; encrypt ID-document images at rest; retention schedule for former tenants (see Open Questions).
- Rate limiting + bot protection on auth, quote, and checkout endpoints.

### 7.5 Data Model — Core Entities

All modules share one schema. Names below are canonical; module PRDs must use them.

| Entity | Purpose | Key relationships / notes |
|---|---|---|
| **Facility** | A physical location (address, geo, hours, gate hours, timezone, amenities, photos) | has many Units, UnitTypes, staff assignments; the tenancy anchor for multi-facility scoping |
| **UnitType** | A rentable size/class at a facility (e.g., 10×10 climate-controlled): dimensions, features, street rate, web rate | belongs to Facility; has many Units; what the website merchandises |
| **Unit** | A physical unit (number, floor, door type, status: `available` / `reserved` / `occupied` / `overlocked` / `unrentable`) | belongs to UnitType; at most one active Lease |
| **Tenant** | A customer with an account: contact info, addresses, alternate contact, communication preferences | has many Leases, Payments; one login identity |
| **Lease** | The rental agreement: tenant × unit, start date, monthly rate, billing day, protection plan, status (`active`, `delinquent`, `pending_auction`, `ended`), signed-document reference | belongs to Tenant and Unit; has many Invoices; drives AccessCredential state |
| **Invoice** | A billing document: line items (rent, fees, protection, tax, promo discount), due date, status | belongs to Lease; settled by Payments |
| **Payment** | A money movement: amount, method, Stripe reference, status, refund linkage | applies to Invoice(s); belongs to Tenant |
| **AccessCredential** | A gate/entry credential: type (PIN, mobile key), value reference, state (`active`, `suspended`, `revoked`), hardware sync status | belongs to Lease (and Facility); the hardware module's contract with the rest of the system |
| **Lead** | A prospect interaction: contact info, facility/unit-type interest, source/UTM, status (`new` → `contacted` → `reserved` → `converted`/`lost`) | may convert to Tenant + Lease; marketing module's core object |

Supporting entities (module PRDs may extend): `Reservation`, `Promotion`, `Fee`, `Notice` (delinquency/lien documents), `AuditLog`, `StaffUser`, `Review`, `GateEvent`.

### 7.6 Multi-Facility by Default

Every query, screen, report, and permission is facility-scoped from day one. No table that represents physical or financial reality omits a `facility_id` (directly or via its parent). Adding a facility is a data operation, never a code change.

---

## 8. Open Questions & Assumptions

### Assumptions (proceed on these until overridden)

1. Single brand, single legal operating entity across all facilities; one Stripe account.
2. U.S.-only, English-only at launch; USD; state lien law compliance needed only for states where facilities operate.
3. Gate hardware at existing facilities is PIN-keypad based (no smart locks yet); manual code sync is an acceptable MVP bridge.
4. Tenant protection plans are offered as a simple in-house plan or a single third-party insurance partner — not a marketplace.
5. The operator has (or will claim) Google Business Profiles for each facility.
6. This is a learning project built to production standards, but initial deployment targets one pilot facility before portfolio rollout.

### Open questions (need owner decisions; tracked per module)

1. **Which states?** Lien/auction law, late-fee caps, and required notice language vary by state — the delinquency module's compliance rules depend on this. *(Blocks Phase 2 admin work.)*
2. **Which gate vendor(s)** are installed at the pilot facilities, and do they expose an API (cloud) or only local software? Determines the first hardware driver.
3. **Reservation policy:** free hold (how many days?) vs. paid deposit? Affects funnel conversion and no-show handling.
4. **Protection plan:** in-house plan vs. insurance partner (e.g., a tenant-insurance provider) — revenue and compliance implications.
5. **Pricing authority:** can managers discount, or is pricing owner-only with promo codes as the sole discount mechanism?
6. **Data retention:** how long to keep former-tenant PII and ID images? (Legal minimum per state vs. marketing value.)
7. **Existing tenant migration:** is there legacy management software to import from, and in what format?
8. **SMS consent & compliance:** confirm TCPA-compliant opt-in flows before enabling SMS notices in Phase 2.
9. **Auction channel:** live on-site auctions vs. online (e.g., StorageTreasures-style) — affects Phase 2 lien workflow endpoints.

---

*Sources cited inline above. Key references: [Public Storage one million contactless move-ins](https://www.financialcontent.com/article/bizwire-2022-3-30-public-storage-celebrates-one-million-contactless-move-ins) · [Public Storage app](https://help.publicstorage.com/manage-your-account/account-management/public-storage-app) · [Extra Space mobile app](https://www.extraspace.com/mobile-app/) · [storEDGE rental center](https://rental-center.storedge.com/) · [SiteLink online rentals](https://www.sitelink.com/about/news/sitelink-adds-outofthebox-online-rental-options-to-its-web-template-and-sitelinkstore) · [Easy Storage Solutions](https://www.storageunitsoftware.com/) · [Tenant Inc](https://www.einpresswire.com/article/544590816/tenant-inc-wins-inside-self-storage-best-of-business-award) · [Janus Nokē](https://www.janusintl.com/products/noke) · [RentCafe survey](https://www.rentcafe.com/blog/self-storage/self-storage-survey/) · [StorageCafe 2025 trends](https://www.storagecafe.com/blog/self-storage-demand-and-trends-2025/) · [Inside Self-Storage SEO guide](https://www.insideselfstorage.com/marketing/seo-survival-guide-for-self-storage-operators-building-a-modern-strategy-to-keep-you-on-top-in-a-competitive-market) · [CubeSmart/U-Store-It mobile site, 2010](https://s205.q4cdn.com/638877794/files/doc_news/2010/04/1/U-Store-It-Launches-Website-Optimized-for-Mobile-Users-04-14-2010-2010.pdf)*
