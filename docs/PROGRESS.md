# Build Progress

What has actually been built, in build order. Updated at the end of every completed backlog item.

This is the **narrative** record — what exists, what it decided, and what a later item still has to do. It complements rather than duplicates:

- `docs/prds/06-backlog.md` — the ordered work list and ✅ markers
- `docs/prds/07-decisions.md` — settled decisions that override PRD text
- `git log` — the change-by-change record
- `README.md` — how the built thing works today

**Status:** Milestone 1 complete (B-001–B-012). Milestone 2 in progress — B-013 done. Next: B-014 (inventory & pricing read API with quote tokens).
**Tests:** 312 unit + 30 e2e passing as of B-013.

---

## Milestone 1 — Foundation

### B-001 — Monorepo & app scaffold ✅ `9766d8c`

npm-workspaces monorepo: `apps/web` (Next 16 App Router, React 19, Tailwind 4, shadcn/ui), `packages/db` (Prisma 6 + Neon Postgres), root `tests/` (Vitest) and `e2e/` (Playwright + axe). CI runs lint, typecheck, unit tests, build, axe, and Lighthouse budgets (LCP < 2.5 s, CLS < 0.1).

**Decided:** root `.env.local` is the single source of truth, injected into every npm script by `dotenv-cli` so Next and Prisma read the same file; `.env.example` carries names only and a test fails if a value ever lands in it.

**Left behind:** `npm audit` reports advisories inherited from `next`/`eslint` version pins that cannot be overridden without an invalid dependency tree — reported in CI, not enforced.

### B-002 — Core data model & migrations ✅ `ec085f1`

19 entities, canonical names per master PRD §7.5, facility-scoped per §7.6. Money is `Int` cents throughout; all timestamps `Timestamptz(6)` UTC.

**Decided:** invariants Prisma's schema language can't express live as raw SQL appended to the migration and are pinned by name in `tests/schema-invariants.test.ts` — one active lease per unit (partial unique index), billing day 1–28, non-negative invoice totals, positive payment allocations, single-subject consent.

**Left behind:** `UnitType` carries flat `streetRateCents`/`webRateCents`; effective-dated rate history is B-011.

### B-003 — Auth foundation ✅ `475c202`

Auth.js v5, one install serving tenants and staff, separated by an `audience` claim on a 30-day JWT session.

**Decided:** passwords are nullable because magic-link sign-in is a permanent path (PRD 01 FR-5.1); hashing is `node:crypto` scrypt rather than bcrypt/argon2 — no dependency, no native build on Vercel; login throttling is DB-backed, no Redis; failures never enumerate accounts (same result and same KDF cost for unknown email, unset password, wrong password, disabled account).

**Left behind:** magic-link and reset emails print to the console and throw in production — the real sender is B-030. `/reset-password` has no UI until B-033.

### B-004 — RBAC roles-as-data & facility scoping ✅ `e482d66`

7 roles, 22 permissions, 64 grants, seeded idempotently from `packages/db/rbac-catalog.ts` — adding a role is a seed change, not a migration.

**Decided:** scoping helpers **fail closed** — a staff user with no assignments resolves to `{ facilityId: { in: [] } }`, never an unrestricted `{}`. Staff actors are re-read from the database per request so a revoked role takes effect immediately rather than at token expiry. The `system` actor used by jobs is not a superuser.

**Left behind:** monetary authority reports over-limit and finds the next approver, but the approval-request workflow itself is B-048.

### B-005 — Append-only audit log ✅ `8078f85`

`packages/core` created; `@storage/core/audit` is the only way to write an entry.

**Decided:** append-only is enforced by Postgres triggers, not convention — `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_log` all raise for every writer including psql. No in-band purge; the ≥7-year retention procedure requires dropping the trigger. Snapshots are diffed and *then* redacted — redacting first made two different passwords compare equal and silently dropped the change.

**Consequences, intended:** facility and staff rows with audit history cannot be hard-deleted (`onDelete: Restrict`); test suites cannot clean up audit rows.

### B-006 — Background jobs & event bus ✅ `53617fb`

Vercel Cron hitting `/api/cron` hourly behind a `CRON_SECRET`, per master §5's MVP option — no Inngest/Trigger.dev account.

**Decided:** hourly rather than nightly because per-facility jobs fire at a facility-**local** hour; the selection is DST-safe and tested against both US transition days. Delivery is **at-least-once** with idempotent consumers; claim exclusivity comes from a unique index on `(eventId, consumer)`, no advisory locks. Jobs are idempotent by constraint — `JobRun` unique on `(jobName, facilityId, businessDate)`.

**Left behind:** `CONSUMERS` and `SCHEDULED_JOBS` are deliberately empty. B-018, B-019, B-027, B-030, B-043 register themselves.

### B-007 — Admin shell & role-gated routes ✅ `e3a51da`

Global header with facility switcher, role-filtered left nav, facility dashboard on live queries. Plus `npm run db:create-owner` — the only way to create the first staff account.

**Decided:** two-layer gating — `proxy.ts` checks the JWT audience at the edge (no DB, since Prisma isn't Edge-compatible), then every layout/page re-checks real permissions. Nav visibility is UX; the server-side check is the gate.

**Found:** `UnknownEventError`'s constructor-parameter-property was named `name`, colliding with `Error.name` and silently discarding the event name on every throw. Auth.js's custom `jwt` callback had also replaced default field copying, so `session.user.name` was never populated.

### B-008 — Facility settings CRUD ✅ `af2852e`

Address/geo/timezone, weekly office and gate hours, effective-dated tax components and fee schedule. Gate hours exposed at `GET /api/facilities/[id]/gate-hours` for the hardware module.

**Decided:** tax and fee rows are **append-only and effective-dated** (FR-9) — changing a rate inserts a new row, so an already-generated invoice is never retroactively altered. The picking logic lives in `packages/core/facility-settings` for B-011 and B-056 to reuse. Tax rates are basis points (825 = 8.25%), the cents pattern applied to percentages.

**Left behind:** no facility-*creation* UI — US-3 configures an existing site; B-012's seed creates facilities directly.

### B-009 — Unit type management ✅ `16be6e5`

Per-facility unit types with dimensions, floor, climate/drive-up/power, and clone-to-facility.

**Decided:** door type stays on `Unit`, not `UnitType`, despite US-6's prose listing it as a type attribute — a physical unit's door can vary within a type, and duplicating it with no precedence rule creates two sources of truth. Flagged as an open question rather than settled either way.

**Found:** `tests/schema-invariants.test.ts` only ever read the *first* migration file, so every hand-written constraint added across five later migrations had zero regression protection. Now scans all migrations and pins 25 names.

### B-010 (1 of 2) — Unit inventory: rules layer ✅ `64d6e86`

Split into two sessions — the backlog sizes B-010 as M, but it is four distinct things. This session is the rules layer: derived status engine, unit CRUD, list + filters. Session 2 is the grid view, JSON layout import, and bulk edit with preview.

**Decided:** `Unit.status` stays the *effective* status (derived, queryable — the dashboard already filters on it), and a new `Unit.operationalStatus` holds the operator's *intent*. Two columns because effective status alone destroys intent: a unit marked `maintenance`, leased, then vacated must return to `maintenance`, not silently to `available`. The collapsing failure mode rents out a unit somebody deliberately took offline, so the test for that round trip is the one that matters most.

The derivation is pure and lives in `packages/core/inventory` so availability reads (B-014) reuse it rather than redefining "rentable". Precedence is `overlocked > occupied > reserved > intent`. `OCCUPYING_LEASE_STATUSES` deliberately mirrors B-002's `lease_one_active_per_unit` partial index (`status <> 'ended'`) — if those two ever disagree, a unit could hold two leases while the UI calls it vacant.

Everything that writes `Unit.status` goes through `recomputeUnitStatus()`; a direct `data: { status }` write anywhere else is a bug. B-018/B-026/B-040/B-057 must call it after changing lease, reservation, or delinquency state.

**Left behind:** `overlocked` has no source — the delinquency engine (B-057) and field ops (B-060) populate it, so the adapter passes `false` and no unit can currently be overlocked. Modeled now anyway because it outranks `occupied`, and retrofitting precedence later is how display bugs start. No reconciliation job either: nothing can currently cause drift, so one would be guarding against an impossibility.

**Found:** the drift check caught an index I wrote in raw SQL but never declared in `schema.prisma`. Now declared with an explicit `map:` pinning the migration's name.

### B-010 (2 of 2) — Unit inventory: views, import, bulk edit ✅ `952c339`

List and grid views at `/admin/units` (types moved to `/admin/units/types`), JSON layout import, and bulk edit with preview. Completes US-5/US-7/US-8.

**Decided:** one filter definition (`lib/admin/unit-query.ts`) backs the list, the grid, and bulk operations — that shared selector is what makes "select by filter → bulk edit" safe, because the rows the operator saw are provably the rows the operation considers. Preview and apply run the *same* evaluator for the same reason: two implementations would eventually disagree, and a preview that lies is worse than no preview. Apply re-evaluates rather than trusting a round-tripped preview, since a lease can be signed in between.

Bulk edits land as one audit entry anchored to the facility with per-unit detail inside (US-7's wording). Trade-off recorded: filtering the audit log by a single unit will not surface a bulk edit that touched it.

Layout import is all-or-nothing — if any row names an unknown unit type, nothing is written. A half-imported layout is worse than none because you cannot tell by looking which half landed. It never touches `status` or `operationalStatus`: a layout describes geometry, not occupancy.

Status colours follow the US-5 AC, but colour is never the only signal — every badge carries its label and `unrentable` gets its AC-specified hatch, so the six states survive WCAG 1.4.1.

**Left behind:** the interactive map with zoom/pan and the drag-to-place layout editor are P2 by the AC's own phasing; grid is the MVP fallback. No unit *detail panel* yet — the list exposes status changes inline, and the panel's richer content (tenant, balance, quick actions) needs entities that arrive with B-026/B-038. `occupancyFactsForMany` replaced an N+1 that would have run two queries per unit during a 500-unit bulk operation.

**Found:** a user-facing copy bug — the block message read "Unit has a active lease". Rephrased so no lease status can produce a wrong article.

---

### B-011 — Street rate management ✅ `8b548ed`

Effective-dated street and web rates per unit type, rate history, and a rates API. Completes US-9.

**Decided:** the flat `streetRateCents`/`webRateCents` columns on `UnitType` were **dropped**, not kept alongside the new history table. A denormalized "current rate" cannot stay correct — nothing fires an event when a future-dated rate's date arrives, so it would silently go stale, and US-9 requires the site to *always* show the current rate. Resolving at read time makes that true by construction, and volumes are trivial (tens of types × a handful of versions).

This is the opposite call from B-010's `Unit.status`, deliberately. Status changes are *event*-driven (a lease is created), so a denormalized column can be kept correct by recomputing on the event. Rate changes are *time*-driven, with no event to hook. Same-looking problem, different mechanics, different answer.

Reuses B-008's `effectiveAsOf`/`effectiveByGroup` rather than reimplementing effective-dating — one definition now serving tax components, fee schedules, and rates. B-056's delinquency timelines should use it too.

A type whose only rate is future-dated is **absent** from the resolved map rather than priced at zero, so nothing can mistake "unpriced" for "free". Creating a type writes its first rate in the same transaction; cloning copies the source's *current* rate as the clone's opening rate, not the whole history. `updateUnitType` ignores any rate posted to it — changing a price is publishing a row, never an edit.

Rate history state (`scheduled` / `current` / `superseded`) is resolved in the data layer against a single clock reading, not in the view. React's purity lint caught the first version reading `Date.now()` during render — which would also have let rows disagree with each other in one pass.

**Left behind:** `rates:street:propose` (which `manager` holds) has no propose→approve workflow; publishing needs `rates:street:change`, so managers currently cannot change prices at all. The public, unauthenticated pricing read with quote tokens is B-014 — `/api/facilities/[id]/rates` is staff-auth only.

**Found:** Prisma generated the migration with `DROP COLUMN` *before* the new table, which would have destroyed every existing rate. Rewrote it as create → backfill → drop, and proved the backfill by seeding a known $199.00/$179.00 type, running the migration, and confirming the values survived.

### B-012 — Seed & demo data ✅ `616bc57`

`npm run db:seed:demo` — two facilities, 40 units, 16 tenants, and every lifecycle state (lead, reserved, pending, active, delinquent, pending_auction, ended) at **both** facilities so scoping is demonstrable. Closes Milestone 1.

**Decided:** the seed writes **no audit entries**. Demo data is constructed state, not actions somebody took, so inventing audit history would make the log lie — and since `AuditLog.facility` is `Restrict`, audit rows would make the demo facilities permanently undeletable. That single choice is what makes the seed idempotent by teardown-then-create rather than upsert, which reproduces a known state exactly instead of layering onto whatever was there.

Unit statuses are never asserted into place — the seed calls `recomputeUnitStatus()`, so it exercises the real B-010 derivation rather than duplicating it.

**Left behind:** no invoices, payments, or ledger entries. The AC doesn't ask for them and B-044 owns invoice generation including gapless per-facility numbering; seeding invoices now would pre-empt that numbering scheme. The delinquent tenant therefore has a status but no balance — worth revisiting once B-044 exists.

**Found:** three real bugs, all surfaced by wiring the seed up rather than by reading code.

1. Importing the seed module **ran it** — `main()` executed at import, so the coverage test tore down and rebuilt demo data as a side effect of a test run. Now guarded behind a direct-invocation check.
2. `createOwnerAccount` counted owners belonging to **soft-deleted or suspended** staff, so deactivating a compromised owner would lock the system out with no way to bootstrap a replacement. Now ignores deactivated accounts, with a regression test.
3. The same function used an unordered `findFirst` across multiple owners, so the "an owner already exists (X)" message named an arbitrary one and differed between identical runs. Now ordered oldest-first.

**Also fixed:** test-fixture facilities were accumulating in the facility switcher — 117 of them — because any test touching an audited function makes its facility undeletable. Fixtures are now created `status: 'inactive'`, which the switcher already filters out. Existing rows are unaffected and still visible.

---

## Milestone 2 — First online move-in

### B-013 — Public site shell ✅ `11bfac8`

Mobile-first public site: persistent header (logo, Find storage, click-to-call, Pay bill), homepage search hero, and the static/legal pages FR-8.1 lists — FAQ, about, contact, terms, privacy, accessibility.

**Decided:** public pages live in an `app/(public)/` **route group**, not a path segment, so they keep clean URLs while `/admin`, `/login`, and `/api` stay outside and never inherit site chrome. Verified empirically, not just structurally: `/login` is a sibling outside the group and has no header, which is the same mechanism `/admin` relies on.

The homepage search submits by **GET** to `/storage/search?q=…` so the query lands in a shareable URL (US-101). That results page is a placeholder — geocoding and distance ranking are B-015 — but the URL shape is already the one the AC specifies, so it won't move under anyone later. A form pointing at a 404 would have been worse than a placeholder.

**WCAG 2.1 AA is verified, not claimed.** axe runs over every public route at two viewports and the route list is the contract; the skip link is asserted to be genuinely the first tab stop; the document is asserted not to scroll horizontally at 320px. `prefers-reduced-motion` is handled globally so a future animation can't forget it. Lighthouse: accessibility 100, SEO 100, LCP 2.3s, CLS 0.

**Legal text is an unreviewed draft and says so on the page**, in a visible notice rather than a code comment (D-10). The accessibility statement is written as a real claim and states what is *not* done yet — claiming conformance for flows that don't exist would be worse than admitting the gap.

**Left behind:** the size guide is B-017. Cookie consent and analytics (FR-8.2) belong with B-069's analytics work. There is no CMS — copy is in the components, which FR-8.1 leaves open between that and markdown-in-repo.

**Also fixed this session:** 110 test-fixture facilities were still showing in the facility switcher from before B-012's `status: 'inactive'` change. Marked inactive with a non-destructive status update — nothing deleted, and only the two demo facilities remain active. Confirmed `npm audit`'s remaining 16 advisories still have no non-breaking fix (npm's suggestions are downgrades to `next@9` and `eslint-config-next@12`), so the documented position stands.

---

### B-014 — Inventory & pricing read API with quote tokens ✅ `db019dd`

The public, unauthenticated read behind facility and search pages: `GET /api/public/facilities/{slug}/inventory` returns unit types with real availability counts, both rates, and a quote token per type. Keyed by slug because the slug is already the public identifier in `/storage/{state}/{city}/{slug}`; internal ids have no business in a customer-facing URL.

**Quote tokens are signed, not stored — the opposite of B-003's auth tokens, deliberately.** An auth token needs revocation, so it lives in a row that can be burned. A quote is the reverse: its whole purpose is to be honoured *even after the street rate moves*, so there is nothing to revoke and expiry is the only bound it needs. The signing key is derived from `AUTH_SECRET` via HKDF rather than reused directly, so a session signature can never be spent as a price — there is a test that signs a payload with `AUTH_SECRET` directly and asserts it is rejected. The payload binds facility + unit type, so a $69 locker quote cannot be redeemed against a $249 drive-up unit.

TTL is 30 minutes, matching FR-4.1's checkout unit lock. It is short on purpose: the token only bridges *seeing* a price to *committing* to one. Once a Reservation exists, `Reservation.quotedRateCents` is the durable record, so the token never needs to survive the 7-day hold.

**Staleness is bounded by `Cache-Control`, not `export const revalidate`** — and that changed mid-item because the build output disproved the first attempt. Route handlers are dynamic by default in Next 16: the segment config left the route marked `ƒ (Dynamic)` and cached nothing, so the ≤5-minute ceiling FR-2.1 promises would have been a claim with no mechanism behind it. `s-maxage=300` with **no** `stale-while-revalidate` is the honest expression of a *worst case* — SWR would let the edge serve past the ceiling. The 404 is explicitly `no-store` so a facility going live isn't hidden by a stale miss.

`liveAvailableCount()` is the separate always-live path FR-2.1 requires for checkout, and is deliberately not reachable from the cached read — a checkout trusting a five-minute-old count would sell the last unit twice.

**Decided:** unit types with no rate in effect are **omitted** from the public feed rather than published at a null price — a "Rent now" button with nothing to charge is worse than an absent listing. Inactive facilities 404 rather than returning an empty list. Only `status: 'available'` counts toward availability; `reserved`/`occupied`/`overlocked`/`maintenance`/`unrentable` are all unsellable. The response lists facility fields one by one instead of spreading the row, so a column added to `Facility` later cannot silently leak into an unauthenticated response.

**Left behind:** promotions (FR-2.3) are B-070 — the token payload is versioned so adding them is a v2 bump, and old tokens are rejected rather than migrated, which a 30-minute TTL makes cheap. Filtering and sorting (US-201) are client-side against this payload and belong to the facility page, B-016. This is a read: B-018 still has to decrement availability atomically when it creates a hold.

---

### B-015 — Location search ✅ `b1413bf`

`/storage/search?q=…` geocodes a zip, city, or "city, state", ranks active facilities by distance from that point, and shows each with its distance, address, amenities, and "units from $X/mo". Whole state lives in the URL, so every result view is shareable and the back button works.

**Geocoding takes no vendor — recorded as D-14.** OQ-6's two candidates (Google, Mapbox) both want a billed API key and a network call on the hot search path, for public data that changes about once a year. This follows D-4's precedent for undecided vendors: ship a real local implementation now. A bundled BSD dataset (`zipcodes`) resolves zip and city offline, which is also why `tests/geocode.test.ts` asserts real coordinates instead of mocking a provider. **OQ-6 is narrowed, not closed** — map rendering (B-016) and street-address autocomplete still need a vendor.

Ambiguity resolves rather than dead-ends: "springfield" returns Springfield, IL (most zip codes is a fair proxy for biggest) and puts the state in the echoed label so the user can correct it by typing "Springfield, MA". Cities outside Texas geocode deliberately — a searcher in Tulsa should land on "nothing within 25 miles, here are the closest" rather than "we couldn't find that", which are different problems needing different copy. Both are distinct outcomes in the code and both are in the axe route list.

**"Units from $X/mo" is the cheapest rate a renter could actually take today** — lowest current web rate among unit types with a unit *available*. A cheaper sold-out type must not set the headline price; that would be a truthfulness bug, not a rounding one, and there is a test for exactly that. Facilities with nothing rentable render "no units available, call us" rather than a price, and never $0. `lowestAvailableWebRateByFacility()` answers for every facility in two queries rather than fanning out per result.

**Decided:** search radius is 25 miles — the distance someone will drive with a car full of boxes. Facilities without coordinates are excluded from results rather than sorted to an arbitrary position in a distance-ordered list, and inactive ones are never advertised, matching B-014's feed. Typeahead uses a **native `<datalist>`** populated from our own facility list, not a hand-rolled ARIA combobox and not a national gazetteer: the browser supplies the keyboard model and screen-reader semantics for free, and every suggestion resolves to a real facility instead of confidently routing someone to a zero-results page. The whole search path works with JavaScript disabled — "Use my location" is the only client component and is purely additive — and there is an e2e test that runs the journey with JS off.

The demo seed now sets facility coordinates from the zip centroid; without them a facility is invisible to search. A real facility would carry surveyed coordinates for its gate.

**Verified:** 354 unit tests, 42 e2e (both new search outcome templates added to the axe contract), Lighthouse accessibility 100 on the homepage and the results page. Worth watching: LCP on the results page is ~2.5s, right at the asserted budget rather than comfortably under it. The homepage still prerenders (`○ Static`, 1h revalidate) despite now reading the facility registry for its typeahead.

**Found:** the first e2e run failed against a *stale* server — a leftover `next start` from the previous item still held port 3000 and Playwright reuses an existing server, so four new tests were being checked against the old build. Worth knowing: a green-looking local e2e run is only as current as whatever is on :3000.

**Left behind:** result cards don't link anywhere yet — the facility detail page and its `/storage/{state}/{city}/{slug}` URL scheme are B-016, and linking to a 404 would be worse than not linking. Map view and a richer "use my location" are B-081 (Phase 2). US-101's "typeahead after 2 characters" is the browser's native datalist behaviour, which starts filtering from the first character.

---

### B-016 — Facility detail page ✅ `32b6df3`

`/storage/{state}/{city}/{slug}` renders a facility's address, click-to-call, directions deep link, office and gate hours, live unit sizes with prices and real availability counts, amenities, and a map. Search result cards now link to it — B-015 deliberately left them linking nowhere.

**The URL scheme is canonical, not decorative.** The slug alone resolves the facility, so `/storage/ca/nowhere/{slug}` would render perfectly well. Anything that isn't the canonical spelling `permanentRedirect`s (308) to the one that is, so the index carries one URL per facility rather than one per spelling anybody links. `facilityPath()` is the single place that path is built, it is asserted idempotent (a non-idempotent one would be an infinite redirect), and `generateMetadata` declares the same path as `rel=canonical`. That required setting `metadataBase` on the root layout — without it Next emits a relative canonical that crawlers ignore, which Lighthouse caught as SEO 0.91 on this page. B-066 still owns the wider canonical/301 policy and the JSON-LD.

**Office hours and gate hours are two tables, one row per day, never collapsed.** §6.3 forbids conflating them. Collapsed ranges ("Mon–Fri 9–6") read better but guess at which days are equivalent, and the renter who drives out on the one day that differs has been misled by the nicer format. Each table carries both a `<caption>` (names it in the screen-reader table list) and an `<h3>` (puts the distinction in the document outline, where more people meet it). The en dash between times is `aria-hidden` with an `sr-only` "to" beside it — most screen readers don't speak the dash at default verbosity, so "nine AM, six PM" leaves the listener guessing which is opening. `10×20` gets the same treatment: U+00D7 announces as "ten times twenty" with the unit missing entirely.

**Decided: sold-out sizes stay on the page.** They were filtered out at first; that tells a renter looking for a 10x20 that we don't offer one, and they leave instead of calling. Available sizes lead, full ones follow under "Also here, currently full" with a call link. **Decided: one phone number per page** — the facility's own line if it has one, otherwise the org line labelled "our main line" so a renter knows they may be transferred. The first cut mixed the two, sending readers to a different number than the button above it. **Decided: `formatRate()` in `lib/format.ts` is the single customer-facing money format** ("$129", not "$129.00"); the search page had its own copy and the two surfaces rendered the same unit differently one click apart.

**The map embed is behind a native `<details>`.** Two problems, one fix. It put LCP at 2613ms against a 2500ms budget — ~140ms above the otherwise-identical homepage — and collapsed, the third-party document is never fetched at all (verified: zero OpenStreetMap requests). It also keeps the frame out of the tab order, so nobody has to traverse a map they cannot use to reach the directions link, which now precedes it. `<details>` rather than a button because the public path still works with JavaScript disabled. OpenStreetMap needs no API key, which is the same reasoning as D-14 — a required key would be a vendor dependency for a decorative panel.

**Degradation is real, not decorative.** The inventory read is the only call allowed to fail soft: it catches to a "call to confirm availability" notice while address, hours and directions still render (US-103). The profile read is not allowed to fail — a facility page with no address is not worth serving. `revalidate = 300` matches the inventory TTL, and `generateStaticParams` prerenders one page per active facility; without it the segment was on-demand only and the build output showed `ƒ (Dynamic)` with no revalidate window, i.e. the config was dead. That function catches its own database errors and returns `[]` so an unreachable database during a build degrades to on-demand rendering instead of failing the deploy.

**Found — CI never seeded demo data.** `npm run db:seed` seeds roles and permissions only, yet the e2e suite asserts against "Demo — Austin South" by name. Those assertions were being checked against the "we have no facilities listed yet" template and passing anyway. CI now runs `db:seed:demo` before the e2e step. Anything B-015's e2e run proved locally, it was not proving in CI.

**Found — axe reaches inside cross-origin iframes.** The a11y spec asserted only on `violations`, which silently reads "we could not test that" as "that passed". It now asserts on `incomplete` too, and that immediately surfaced four undecidable colour-contrast results — OpenStreetMap's own attribution text over map tiles. Content inside a third-party frame is exempt (we cannot restyle someone else's document); anything on our own page is not.

**Found — iCloud breaks `tsc` after every build.** iCloud Drive resolves its own sync conflicts by writing `file 2.ts` beside `file.ts`, and inside `.next/types` that duplicates every generated route type and fails typecheck with TS2300/TS6200. `apps/web/tsconfig.json` now excludes the `* 2.*` pattern rather than requiring a manual delete after each build.

**Verified:** 365 unit tests (11 new), 54 e2e (7 new, both viewports), Lighthouse accessibility 100 and SEO 100 on the facility page.

**Watch this:** the facility page's LCP is **2612ms against an asserted 2500ms budget** and reproducibly so — three clean runs at 2612/2613/2613 before the map was gated, one run at 2311 after. It passes today only because lhci's aggregation takes the most favourable run, which makes the gate flaky rather than green. The LCP element is a plain text paragraph — no image, no third party, nothing left to defer — so this is the cost of a text-heavy page under Lighthouse's 4× CPU throttling, and the homepage itself hit 2610ms on one run. **Whether the 2500ms budget is right for this project is an owner decision and is deliberately not resolved here**; it was not silently relaxed.

**Left behind:** the photo gallery US-103 asks for — nothing stores a photo yet, and **B-067** owns photo management *with required alt text*, so a gallery built here would either ship without alt text or duplicate that item. Filters, sort, web-vs-street rate comparison and the itemized "what you'd pay today" summary are **B-017** (the page shows the online rate only). Reserve and Rent CTAs are **B-018**/**B-020**, so today the page's only conversion action is a phone call. Search context is not carried into the page, so a comparer loses their zip on the way back — B-017.

---

### B-093 — Public-site accessibility & copy remediation ✅ `d09ef7e`

The first item generated by the review round rather than the original backlog: three reviewer agents audited everything through B-016, and this fixes the shipped public-site defects they found. B-094 does the same for admin.

**The focus indicator was the real finding.** `--ring` was `oklch(0.708)` — 2.59:1 against white, under the 3:1 that 1.4.11 requires — and it was applied through `outline-ring/50`, whose alpha composited it down to **1.54:1**. That included the skip link, the one control that exists solely for keyboard users. Worse, the mechanism was `* { outline-color }` recolouring the UA's `outline-style: auto` ring, which Chromium and Firefox honour and Safari largely ignores: the site's focus visibility was not weak, it was *undefined per browser*. Replaced with an explicit `:focus-visible { outline: 2px solid var(--ring) }` and `--ring` at `oklch(0.55)` (4.85:1).

**Verified in all three engines, not asserted.** Chromium, Firefox and WebKit each render `solid 2px lab(47.8 0 0)` on every focusable element. Worth recording: WebKit tabs only to the `<summary>` and skips every link — that is Safari's default "Press Tab to highlight each item" preference, not a site defect, and it means a WebKit-only tab-order test would silently cover almost nothing.

**`--border` and `--input` were the same value, and shouldn't have been.** `--input` is the boundary of anything the user *operates* — inputs, selects, outline buttons — and at `oklch(0.922)` it was **1.26:1**, so the homepage search field was a white box on a white page with an invisible edge. Now `oklch(0.62)` (3.64:1). `--border` stays where it was: card edges and table rules are decorative and exempt. The outline "Get directions" button and the map disclosure moved to `border-input`, since their border *is* their affordance.

**Decided: contrast is a unit test, not a scan.** axe checks text contrast only and has no opinion on control boundaries or focus rings — which is exactly why a 1.54:1 indicator passed every automated check we had. `tests/contrast-tokens.test.ts` reads the real token values out of `globals.css` and does the arithmetic. For achromatic oklch, relative luminance is exactly L³ (the oklab→LMS→linear-sRGB chain collapses at chroma 0, and both the cube-root and the luminance coefficients sum to 1), so contrast against white is `1.05/(L³+0.05)` and the 3:1 floor is L = 0.669. The test pins itself against the audit's independently-measured 2.59:1 and 1.26:1 so the shortcut can't rot.

**The search field opened a digits-only keyboard on a field that accepts "Austin, TX".** `inputMode="numeric"` on the mixed zip/city input gives iOS Safari a keypad with no route to letters, making the field's own hint impossible to follow on an iPhone — on the homepage hero, the single most important input on the site. Removed.

**`/login` was telling customers a backlog ID.** It rendered "The sign-in screen is built in backlog item B-033" and is the destination of the header's "Pay bill" button on every page — written as a placeholder for us, read by anyone who clicked. Rewritten in customer language per D-15, and `tests/no-internal-identifiers.test.ts` now fails on any `B-nnn` or `D-nn` reaching a customer-reachable route. Comments are stripped before scanning: a `// B-067 owns this` note never reaches the browser, and banning those would push useful provenance out of the code.

**The accessibility statement claimed four things the build didn't support** — a visible focus indicator, announced form errors, automated tests on "every page", and a manual screen-reader pass "before each release" that had never happened. Three are now true; the rest moved into "Where we fall short today", with a dated last-reviewed line. An overstated statement is the first document quoted in a demand letter, and it converts a fixable bug into an alleged misrepresentation.

**Found — the "use my location" live region could never announce.** `role="status"` was conditionally rendered, so it entered the DOM already populated; VoiceOver announces that unreliably and NVDA routinely misses it. The button also set `disabled` while locating, which blurs the focused element to `<body>` in Chromium — so a screen-reader user pressed Enter, lost their place, and heard nothing for up to ten seconds. Now a persistent empty region written into on state change, `aria-busy` instead of `disabled`, and the locating state is announced too.

**Decided: the FAQ answers the size question it was already being linked to.** Both the search and facility pages said "Not sure what size you need? Read the FAQ" and the FAQ had six answers, none about size. Rather than weaken the link, the answer was added (5×5 / 10×10 / 10×20 with real-world comparisons). The online-vs-in-store answer was also simply wrong — it said cheaper "when reserved online"; the online rate applies to *renting* online. Reserving changes nothing.

**Verified:** 395 unit tests (30 new), 122 e2e (68 new — reflow, 200% zoom and forced text spacing now run over every public route rather than the homepage alone, at both viewports), Lighthouse accessibility 100 and SEO 100 on all three pages. The duplicate homepage-only reflow test was deleted rather than left beside its replacement.

**Left behind:** the **VoiceOver pass has not been run** — it is not automatable and is genuinely a human task. The two things worth listening to first are on the facility page: whether the two hours tables are distinguishable by ear, and whether `10×20` reads sensibly now that it carries an sr-only "10 foot by 20 foot". Admin is untouched and carries the majority of the audit's blocking findings — no skip link, an auto-submitting facility switcher, no error handling in any server action, and append-only tax entry with no confirmation — all of which is **B-094**, next.

---

### B-094 — Admin shell accessibility remediation ✅ `7a45c3e`

The admin half of the review round. PRD 02 contained no accessibility text at all before this — no "WCAG", no "keyboard", no "contrast" — so every admin item had been built from a spec that never mentioned AA, which is why the staff-facing routes carried most of the audit's blocking findings. That section is now PRD 02 §5.5, and this is the code catching up to it.

**Admin had no skip link.** A keyboard or switch user tabbed the facility switcher, the search stub, the bell, the user menu, sign-out and every nav item — on every page load — before reaching content (2.4.1). The public layout has had one since B-013; admin was built first and never got it.

**The facility switcher changed context on input.** It submitted a server action and navigated on `change` (3.2.2). On Windows/Firefox, arrow-keying a `<select>` fires `change` on every option passed, so a keyboard user with four facilities navigated to three wrong ones on the way to the fourth, each a full page load that reset their focus. It now has a visible **Switch** button.

**Decided: server actions return error state; they never throw it.** A repo-wide grep found zero occurrences of `aria-invalid` in the app, because every admin action was `await doThing(...)` with no try/catch — a rejected value rendered Next's error boundary, which is a page, not a message beside the field that was wrong, and which tells a screen-reader user nothing. `lib/admin/form-state.ts` and `components/admin/form.tsx` are now the one place that behaviour lives, so B-021, B-038, B-039 and B-048 inherit it rather than each inventing a different half. `Field` is props-based rather than a render prop for a concrete reason: these pages are server components and a function cannot cross that boundary.

**3.3.4 on append-only money.** Tax components and fee rows cannot be edited or deleted (FR-9), so "Add rate" was one click from a rate every future invoice applies, forever. There is now a confirm step that echoes back what was parsed in the user's terms — "state tax of 8.25%, effective 2026-08-01, this cannot be edited or deleted" — plus a server-side range check. The old parse was `Math.round(Number(raw) * 100)` with no bounds, so a fat-fingered `825` became an 825% tax rate. The form input's `max` is not the guard that matters: a crafted POST skips it, which is why the check is server-side and unit-tested directly.

**Fourteen checkboxes all named "Closed".** The hours editor renders two schedules on one page, the day sat in a `<td>` rather than a `<th scope="row">`, and there was no way to tell Monday's office closure from Sunday's gate closure by ear. Same shape on the units table, where every row ended in a button named "Set" — a forms rotor listing "Set" 200 times.

**Found — the dashboard's "Failed payments" tile could never be cleared.** It counted `status: 'failed'` for all time with the hint "needs attention", so it only ever went up. A tile that can never reach zero trains the reader to skip the row. Now scoped to the business day and labelled with its window; a real resolution concept arrives with B-046. Added **"Available now"**, which is the counter's actual question and is not derivable from occupancy — reserved, maintenance and unrentable all sit in the gap between occupied and total. Tiles link to their filtered list (US-2). Dropped the permanent "Walkthrough status —" tile.

**The admin surface had never been scanned, and the reason was circular.** The axe run needs a session; nothing could create a staff user with a known password. `db:seed:demo` now creates one, and `e2e/sign-in.ts` posts to the same `password` provider the real screen will use — not a forged cookie. `/admin`, `/admin/units`, `/admin/units/types` and `/admin/settings` are now in the run, plus scans **after** an invalid submit, which is a state axe had never reached on any page.

**Decided: the demo staff account is scoped to the demo facilities, not all-facilities.** An all-facilities owner would make `createOwnerAccount()` report `owner_exists` and silently break `tests/bootstrap-owner.test.ts` for everyone afterwards — permanently in CI, where the demo seed runs before the unit tests. Two scoped assignments give the e2e everything it needs and are the more realistic shape anyway. D-12 is untouched: this is an ordinary role plus assignments, and owner + all-facilities remains the only unrestricted access.

**Found — an authenticated e2e run made the demo seed un-rerunnable.** `AuditLog.actorStaffId` and `AuditLog.facilityId` are both `onDelete: Restrict` and a trigger blocks `DELETE` on `audit_log` entirely (B-005). So the moment a test performs a real audited admin action, that staff user and that facility can never be deleted — and `db:seed:demo`, which is idempotent by teardown-then-create, failed forever after. The seed now upserts the facility shell and reuses the staff row. This will bite again the first time any other suite writes audited data; the fix is the pattern, not the instance.

**Verified:** 403 unit tests (8 new), 140 e2e passing at both viewports (19 new), typecheck, lint and build clean.

**Found — `npx prettier --write` is not this repo's tooling.** There is no prettier config and the source is hand-formatted, so running it reformatted five admin files away from house style (semicolons, double-quoted imports) and buried real changes under ~1,500 lines of churn. Reverted; the two files whose changes were small were restored and redone by hand. Don't reach for prettier here.

**Left behind:** **1.4.10 reflow is not finished for admin.** The shell is fixed — the fixed 192px side nav, a header that could not wrap, an unbreakable JSON example and two unwrapped hours tables all pushed the page sideways — and `/admin` now reflows cleanly. `/admin/units`, `/admin/units/types` and `/admin/settings` still overflow at 320px and are marked `test.fixme` in `e2e/admin.spec.ts` so the gap stays enumerated in the test output rather than living only here. Reflow was not in B-094's row; finishing it means reworking three data-dense layouts and wants its own item. Also outstanding: the units and unit-type pages' own forms still throw rather than returning field errors — only the settings page uses the new pattern — and the VoiceOver pass from B-093 is still unrun.

---

### B-017 — Unit browsing & transparent pricing ✅ `74de9dd`

Filters and sort on the facility page, both rates shown honestly, a "What you'd pay today" itemization, a size guide, and the search context carried through so a comparer can get back.

**The move-in cost calculation is the load-bearing part.** US-301 makes it a *release-blocking defect* for the total at unit selection to disagree with the total at checkout, so `packages/core/pricing/move-in-cost.ts` is deliberately the only implementation and B-020's stepper will call it. Zero I/O — callers hand over the effective rate, fee and tax rows — which is what makes it exhaustively testable, and the test asserts the itemization actually sums to the total it foots to rather than only checking the total.

**Decided: tax applies to rent plus the admin fee, rounded per jurisdiction.** Texas treats self-storage as a taxable service and the fee travels with it (D-10). Per-jurisdiction rounding matches how an invoice will list the lines later. Per-component taxability — a state that taxes rent but exempts fees — is B-044's to model; guessing the other way here would *understate* the estimate, and US-301's rule is that no fee may first appear at the payment step.

**Decided: no strike-through when the two prices are equal.** A struck-through price identical to the price charged is a fabricated discount. `savingCents` is `max(0, street − web)`, so a web rate accidentally set *above* street reports zero rather than rendering "−$20 off" — a data error is not a surcharge to advertise. The saving is also stated in words, because a line through a number is a visual-only signal (1.4.1).

**Decided: the protection plan is a named line with no amount.** US-301 says components not knowable before checkout are named and explained, never omitted. It renders as "chosen at checkout" rather than being left out, because discovering a required charge at the payment step is the exact surprise the story exists to prevent. Mid-month proration is named the same way.

**Filters do not auto-submit.** A plain GET form with an Apply button: arrow-keying a `<select>` fires `change` on every option passed on some platforms, so an auto-submitting filter walks a keyboard user through several reloads to reach one option (3.2.2) — the same defect B-094 removed from the admin facility switcher. It also means filtering works with JavaScript disabled, like the rest of the public path. The result count announces through a live region that is in the DOM on load, so the change is a mutation rather than an insertion.

**"Nothing matches those filters" and "this facility has nothing" are different states** with different next actions (§6.7) — one offers to clear the filters, the other offers a phone call. Unrecognised filter values in the URL degrade to "no filter" rather than to a blank page the visitor cannot explain.

**Found — adding filters silently killed the prerender.** Reading `searchParams` makes a route dynamic, so B-016's `generateStaticParams` and `revalidate = 300` stopped applying the moment this item touched the page — turning them back into exactly the dead configuration B-016 had found and fixed. Both were removed rather than left in place looking meaningful, and FR-2.1's ≤5-minute staleness ceiling moved onto the data read (`cachedPublicInventory`), where it still holds and additionally bounds database load to one query set per facility per window however many filter combinations are requested. **This made the page faster, not slower:** Lighthouse LCP went 2609ms → 2461ms, now under the 2500ms warn threshold rather than over it, because the render no longer waits on Postgres.

**Left behind:** no photographs on the size guide or the unit cards — nothing stores an image and B-067 owns photo management *with required alt text*, so illustrations here would ship alt-text-less or duplicate that item. The written comparisons are what a screen-reader user would get from a good alt attribute anyway. Promotion badges (US-301) are B-070. Reserve and Rent CTAs are B-018/B-020, so a phone call is still the only conversion action on the page. The size-estimator quiz stays dropped.

**Verified:** 423 unit tests (18 new), 168 e2e (12 new), Lighthouse accessibility 100 and SEO 100 on all four public templates. The size guide sits at 2611ms LCP — over the 2500ms warn, under the 3000ms error (D-19).

---

### B-018 — Free reservation service ✅ `f297961`

A no-card hold on a real unit, at a locked rate, cancellable from a link with no login (D-7, US-401, FR-3). The first item where two customers can collide over the same row.

**The concurrency story is `FOR UPDATE SKIP LOCKED`.** "Decrements availability atomically" (FR-3.1) really means "claims one available unit without two requests claiming the same one". A transaction selects one `available` unit of the type with `FOR UPDATE SKIP LOCKED` and attaches the reservation to it. Two renters racing for the last *two* units lock different rows and both succeed; two racing for the *last* unit produce one winner and one honest "sold out", with no retry loop and no advisory lock. Without `SKIP LOCKED` the loser would block until the winner committed and then claim a unit that was no longer free. Both races are tested with real concurrent transactions, not mocks.

**Decided: the database enforces the invariant, not the service.** `reservation_one_held_per_unit` is a partial unique index over `(unitId) WHERE status = 'held'`, so a future code path that skips the claim gets a rejected write rather than a quietly double-booked unit — the same posture as the lease and auth-token invariants. There is a test that bypasses the service to prove it bites. A second constraint, `expiresAt > createdAt`, immediately caught an existing fixture in `units-db.test.ts` that created a hold expiring *before* it was made; the constraint was right and the fixture was wrong.

**There is no availability counter.** The "decrement" is the unit's derived status becoming `reserved`, which is exactly what the public inventory read already counts (B-010's derived-status rule). Nothing to drift out of step with reality, and cancel and expiry are the same mechanism in reverse.

**Decided: holds expire at end of the facility-local day after the move-in date.** A renter moving in on the 8th keeps the unit through the 9th. The offset is read at the *target* instant rather than at the move-in date, so a hold spanning a DST change still lands on local midnight — there is a test for the 1 Nov 2026 fall-back specifically. The sweep job is per-facility at local hour 0 for the same reason: a single UTC hour would expire Texas holds either five hours early or nineteen late depending on the season.

**Decided: the duplicate guard updates in place and does NOT mint a new token.** Same email, facility and unit type within the window is one person changing their mind about a date, not two reservations. Minting a replacement token would invalidate the confirmation email they may be reading right now, so the existing link keeps working and the form says so.

**Decided: arriving at the cancel link cancels nothing.** The link in an email is a GET, and a mail client that prefetches links must not release someone's unit. The link renders the hold — what it is, what it costs, when it ends — and cancelling is a separate POST from that page (3.3.4). The hold is shown as an absolute local date and time, never a countdown: a ticking clock on a page a renter may leave open is a time limit they cannot pause (2.2.1), and it reads as pressure rather than information.

**Only the token hash is stored**, like the auth tokens in B-003, so a database leak hands over no working cancel links. An unknown token and an expired one render the identical page — a guesser learns nothing from the difference, and the renter's next step is the same either way.

**The admin form primitives turned out not to be admin-specific.** The reserve form and the cancel confirmation both use B-094's `AdminForm`/`Field`: they already carry error identification, a suggestion, a focused summary and a persistent live region, which is what PRD 01 §6.8.1 asks of customer-facing forms too. The checkout stepper (B-020) inherits the same behaviour rather than re-deriving half of it. The quoted rate is read server-side from current inventory and never from the posted form — a rate the browser sends is a rate the renter can choose.

**Found — a stale link can outlive its unit type.** The facility page is served from a cached read (B-017), so a size withdrawn in the last five minutes still appears on it. The reserve page does the uncached read, and now redirects back to the list with an explanation instead of 404-ing, which is what a renter following a slightly-stale link actually wants.

**Found — the e2e suite mutates real inventory.** These are the first tests that hold actual units, and the demo facility has six lockers; a test that keeps what it takes sells the size out after a few runs and then fails for reasons unrelated to the code. The reservation tests now cancel their own holds. Related: `unstable_cache` persists to `.next/cache` across dev-server restarts, so a destructive re-seed leaves the facility page serving unit-type IDs that no longer exist until the window ages out.

**Verified:** 444 unit tests (18 new, including both concurrency races and the DST boundary), 192 e2e (8 new), typecheck, lint and build clean. The reserve form and the bad-token reservation page are both in the axe contract.

**Left behind:** no confirmation email or SMS — US-401 lists them and they are **B-031**'s (comms is B-030). Today the confirmation screen is the only place the renter sees their link, which means a closed tab loses it; that is the single biggest gap in this item and it closes as soon as comms lands. "Complete move-in online" from the reservation is **B-020**. Reminder-before-expiry is **B-031**. The move-in window is a constant rather than the per-facility setting US-401 mentions, marked with a `ponytail:` comment. Promotions are not locked with the rate because they do not exist yet (B-070).

---

### B-019 — Stripe foundation ✅ `e48c963`

Customers, PaymentIntents, SetupIntents, a signature-verified webhook endpoint, idempotency keys, and reconciliation into the ledger. No money moves yet — nothing creates a lease or an invoice until B-021/B-044 — but the path money will take is now built and tested.

**The webhook endpoint is the security surface, and it is ordered accordingly.** It is public and unauthenticated, so without signature verification anyone who learns the URL can post `payment_intent.succeeded` and mark an invoice paid. Three rules in order: verify the signature against the **raw** body (`req.json()` would reserialise it and break the signature); claim the event id before doing any work; acknowledge what we cannot handle. That last one matters — a non-2xx makes Stripe retry, so erroring on an event type we never intended to process would generate load forever.

**Decided: fail closed when unconfigured.** With no `STRIPE_WEBHOOK_SECRET` the endpoint returns 503 rather than processing. An unverifiable delivery is indistinguishable from anyone else's POST, and being down is better than being wrong about money.

**Idempotency is designed in twice, at different layers.** Stripe delivers at-least-once and retries a non-2xx for days, so the same event *will* arrive twice. The outer guard is `StripeEvent`, keyed by Stripe's own `evt_...` id — a duplicate loses the insert race and returns 200 without touching the ledger. The inner guard is in each handler: a payment already `succeeded` is not re-posted, and a ledger entry already written for a payment is not written again. Both are tested by applying the same event twice and asserting one domain event and one ledger row.

On the outbound side, the Stripe idempotency key is derived from **what the money is for** (`charge:<reference>`), never from a timestamp or a random value. A fresh key on retry is precisely the double-charge idempotency exists to prevent, so the rule is written into the helper's doc comment rather than left to whoever writes the next caller.

**Decided: a payment with no lease is recorded, not invented.** `LedgerEntry.leaseId` is required and nothing creates a lease yet. Rather than attaching a payment to a lease it does not have, the `Payment` row is written and left unposted, and `unreconciledEvents()` surfaces the gap. PRD 01 §7.3 makes the ledger the tenant-facing source of truth, which is only defensible if the places it has drifted from Stripe are visible rather than papered over.

**Events arriving out of order cannot un-pay a payment.** A late `payment_intent.payment_failed` for something already seen succeed is ignored, with a test. Refunds compare Stripe's running `amount_refunded` against `amount`, so partial and full are the same comparison rather than a total we maintain ourselves and can get wrong.

**Verified without a Stripe account or a network call.** Signature verification is pure crypto and Stripe ships `generateTestHeaderString`, so the security-critical half is exercised for real — including a tampered payload, a wrong secret, and a **replayed capture of a genuine old delivery**, which the timestamp tolerance rejects. The reconciler is driven with event objects shaped the way Stripe sends them.

**Found — `StripeEvent` breaks the facility-scoping invariant, correctly.** `tests/schema-invariants.test.ts` requires every model to carry a `facilityId`; a Stripe account is org-level and the facility is whatever the referenced payment belongs to. Added to the exemption list with that reasoning, which is the point of keeping the list annotated rather than a bare array.

**Verified:** 461 unit tests (17 new), 192 e2e, typecheck, lint and build clean. PCI scope is unchanged and stays SAQ-A: card details go from the browser to Stripe directly, and nothing here ever receives a PAN.

**Left behind:** no Payment Element in the UI and no checkout — that is **B-025**, and **B-020** has to build the stepper first. `createChargeIntent` and `createSetupIntent` have no callers yet by design. Autopay enrolment writes `Tenant.stripeDefaultPaymentMethodId` from a SetupIntent, but nothing enrols yet (B-025). ACH and Link are Phase 2 (**B-081**). The reconciliation *report* is a function, not a screen; **B-042** owns admin reporting. No Stripe keys are configured anywhere, so `paymentsEnabled()` is false and any UI that lands on this must say "call us" rather than render a form that cannot submit.

---

### B-020 — Checkout session state machine ✅ `db0ae0b`

The machine a move-in runs on: a server-side resumable stepper, a 30-minute unit lock, the unit-lost fallback, and the price summary. The *content* of each step is B-021–B-025; what this owns is that they have somewhere to run.

**Decided: a checkout lock is not a reservation.** Reusing the `Reservation` row as the lock would have been less code — the derived status, the availability read and the partial unique index all already exist for it. It was rejected because it would make every abandoned checkout look like a reservation, silently corrupting the reservation→move-in conversion report that the whole funnel is judged on (and that the operator review called a daily-standup number). A hold someone *asked for* and a lock the system *took while they type* are different events. So `CheckoutSession` is its own model, and `deriveUnitStatus` gained a third fact, `activeCheckoutLock`, which renders identically to a reservation — to anyone looking at the unit, both mean "spoken for".

**The lock is the same concurrency primitive as B-018**, deliberately: `FOR UPDATE SKIP LOCKED` to claim one available unit, backed by a partial unique index (`one active session per unit`) so a future code path that skips the claim is rejected rather than double-booking. Both races are tested — two simultaneous checkouts take different units; two racing for the last one produce a single winner.

**Every transition is validated server-side.** A stepper whose position lives in the browser is a stepper a renter can skip, so the session row is the truth and the page renders whatever step it says. Posting step 4's form while the session says step 2 is refused as `out_of_order` — a stale tab or a forged request, and either way the server wins. Step data is merged across steps rather than replaced.

**Advancing renews the lock, and refusing to advance is the point.** A renter working through the steps never meets the warning. A lapsed lock refuses to advance and refuses to extend: the unit may already belong to someone else, and carrying on to a payment step for a unit we cannot deliver is the exact failure this machine exists to prevent.

**2.2.1 is handled with a control, not just a timer.** The warning appears at five minutes with a one-activation "keep it for another 30 minutes". It is an explicit control rather than a background heartbeat because a screen-reader user reading a long lease generates no interaction events — an idle-based heartbeat would drop precisely them. The unit-lost fallback keeps every answer already given and only changes the unit; when the size is genuinely gone it says so and offers a human.

**Decided: the price summary is this item's chrome.** It was scoped to B-025, which would have meant steps 1–4 shipping with no total — including the protection step, where the monthly figure moves most. A renter must never first meet a number on the screen that asks for their card. It renders from the same `calculateMoveInCost` as the facility page (B-017), which is what makes US-301's "a discrepancy is release-blocking" enforceable at all.

**"Rent now" is a POST, not a link.** Starting a checkout takes a unit off the market; as a page it would fire on every prefetch and every back-button visit, quietly locking units for people who only hovered.

**Found — a dangling foreign key, caught by a test.** `startCheckout` persisted the caller's `reservationId` even when the reservation did not exist or had lapsed, writing a bad FK for an unknown id and linking sessions to holds that held nothing. It now only keeps the id when the reservation is real and still live.

**Found — the e2e suite could not release what it locked.** Unlike a reservation there is no renter-facing way to give a checkout unit back, so each run cost the demo facility a unit until a size sold out and unrelated tests began failing. `e2e/global-teardown.ts` now releases them, scoped to checkout sessions because nothing in the seed creates one. The demo seed also had to delete sessions before unit types — `CheckoutSession.unitType` is `Restrict`.

**Also found:** the pure unit-status truth table passed unchanged after gaining a new fact, because vitest strips types rather than checking them and the root `tests/` directory is not in the app's tsconfig. The new fact had no coverage until it was added explicitly. Worth remembering: a green test run does not mean the fixtures still typecheck.

**Verified:** 486 unit tests (25 new), 206 e2e (3 new), typecheck, lint and build clean.

**Left behind:** every step renders a heading and a Continue control and nothing else — **B-021** (details and implicit account), **B-022** (protection), **B-024** (lease and e-sign) and **B-025** (payment) fill them in. The resume link is generated and stored but **not emailed**, so resumability is real server-side and unreachable in practice until **B-031**; FR-4.1 is explicit that a draft only surviving while the tab is open is not resumable, so this is the item's biggest gap. Provisioning (FR-4.5) and rollback (FR-4.6) belong to **B-026**. The expiry sweep is daily, which is enough because availability derives from `lockExpiresAt > now` rather than from the sweep having run.

---

### B-021 — Checkout steps 1–2 ✅ `5aecc5d`

"Your details" and unit confirmation, plus the implicit account FR-5.1 describes. The first code in the product that creates a customer identity from public input.

**Decided: an existing account's details are never overwritten from checkout.** This is the security property of the item. The form is unauthenticated, so without this rule anyone who knows an email address could rewrite that person's home address and alternate contact simply by starting a checkout — no password, no verification, by design. Blank fields are filled in, because that is strictly additive; anything already stored is left alone and the entered values stay on the checkout session for staff to reconcile at move-in. There is a test that tries the takeover and asserts every stored field survives.

Email is the identifier and matching is case-insensitive, so a returning renter is the same tenant across facilities (FR-5.3) rather than a second account. No password field exists anywhere in the flow and no verification wall stands in front of a move-in (FR-5.1) — asserted in e2e by counting password inputs on the page, which is the kind of thing that quietly reappears.

**Decided: no address-autocomplete vendor.** US-501 asks for "autocomplete via address API". D-14 settled that this product carries no geocoding vendor and narrowed the open question to map rendering and address autocomplete — both still want a billed key. The browser's own autofill does the same job for a returning renter from the `autocomplete` tokens (1.3.5), at no cost and without a third party in the middle of someone's home address. If a vendor is ever added, the tokens are already right.

**The SCRA flag is captured at step 1**, self-declared, with a sentence saying why anyone would tick it — an unexplained question about someone's military service is worse than no question. `null` means never asked, `false` means asked and answered no. B-096's `LeaseHold` is what acts on it; capturing it now means the flag exists before the first tenant does, which is the whole reason the operator review wanted it early.

**Step 2 confirms rather than assigns.** US-501 puts unit assignment at step 2; B-020 assigns at session start instead, because a lock that begins at step 2 leaves the renter filling in step 1 for a unit anyone can take. So this step shows the unit number, the locked rate and the move-in date and asks the renter to agree. The difference from the PRD is deliberate and noted here rather than silently absorbed.

**Validation carries suggestions, not just identifications** (3.3.3): every message says what to do, and the phone check accepts any punctuation a real person might use while rejecting nonsense — a trust boundary should turn away typos, not people with unusual formatting.

**Found — the e2e suite was competing with itself for inventory.** With `fullyParallel` across two browser projects, a dozen reservation and checkout tests take real units simultaneously, and they were sharing the Austin demo facility with its lifecycle fixtures. A size would sell out mid-run and unrelated tests failed for reasons that had nothing to do with the code. There is now a **`demo-e2e` sandbox facility** in Houston — 60 units of one type, no lifecycle states, far enough from 78704 not to disturb the search-ranking assertions. Inventory-consuming tests point at it. This is the third time this session that inventory contention has broken the suite; the sandbox is the fix that generalises.

**Verified:** 497 unit tests (11 new), 210 e2e (2 new), typecheck, lint and build clean.

**Left behind:** date of birth and vehicle details from US-501 step 1 are not captured — DOB is "if required by lease" and nothing generates a lease until **B-024**, and vehicle details are only for parking/RV unit types, which the data model has no concept of yet. Both are noted rather than guessed at. The move-in date shown at step 2 is today rather than a chosen date; a future-dated move-in is Phase 2 (**B-081**). Steps 3–5 still render a heading and a Continue — **B-022**, **B-024** and **B-025**. The resume link is still not emailed (**B-031**), so an account created here is reachable only while the tab is open.

---

### B-022 — Protection plan ✅ `e35d7c9`

The coverage catalog, the per-facility policy, and checkout step 3's choose-or-waive with a real waiver record.

**"Protection plan", never "insurance" — in copy, in the schema, and on the invoice.** Not pedantry: selling actual insurance generally requires a licensed agent, which is precisely why the industry sells a lease addendum instead. "Insurance" describes cover the tenant already holds somewhere else. The naming is enforced by the model names and carried through every string a renter reads. §10 Q5 (whether a full insurance *program* belongs in any phase) stays open by decision and is not a blocker — a program later replaces this catalog behind identical lease-facing behaviour.

**The waiver is a record, not a tick.** This is the whole point of US-44, and the failure it prevents is specific: the tenant waives by claiming their own cover, nobody ever sees the declaration page, the policy lapses eight months later, the unit floods, and the operator is in a coverage argument with nothing on file. So waiving requires carrier, policy number and an expiry date — and cover that has *already* lapsed is refused rather than accepted as a waiver that was dead on arrival. The expiry is what makes D-17's nightly lapse scan possible at all; without a date there is nothing to scan.

**Continue is never disabled.** US-501 says the step cannot be skipped silently, and the tempting implementation — grey out the button until the form is valid — is the one PRD 01 §6.8.1 explicitly forbids. A control that cannot be pressed, with no message, is invisible to someone who cannot see why. The step submits, fails, and names what is missing beside the field (3.3.1/3.3.3). The attestation checkbox is unchecked by default, because an attestation that arrives pre-agreed is not an attestation.

**The waiver fields are always in the DOM**, not revealed by JavaScript when the radio changes. The public path works with the bundle disabled, and a field that only exists after a click is a field a screen-reader user may never learn about.

**Decided: the mid-tier default is computed, not named.** US-501 asks for the mid tier preselected. Hardcoding `'standard'` breaks for an operator selling two tiers or four, so it is the middle of what is actually on sale — tested at one, two, three and four tiers.

**The catalog is effective-dated like every other price** (FR-9), grouped by a `tier` key rather than the display name so renaming a tier does not fork its price history. Adding one goes through the same 3.3.4 confirm-and-echo as tax and fees: it is money that bills monthly, forever, and the row cannot be taken back. The premium flows into the price summary as its own line, so the renter sees *which* number moved rather than a larger total to account for themselves (§6.4).

**Per-facility policy: required vs optional**, shipped defaulted to required-or-show-proof, which is Texas practice — labelled in the admin UI as configuration rather than law (D-10).

**Verified:** 510 unit tests (13 new), 212 e2e (1 new, walking the full four-step path), typecheck, lint and build clean.

**Left behind:** **D-17's auto-enrolment is not built** — the schema carries the expiry the scan needs and the decision is recorded, but the nightly scan, the 30-day notice and the enrolment itself are **B-043**/**B-050**. That decision also carries an explicit attorney-pass requirement before it runs against a real tenant (notice copy, the authorising lease clause, retroactivity), which is recorded in PRD 02 US-44 and not discharged here. The declaration-page upload has nowhere to go until **B-023**'s document store, so the waiver stores a `documentRef` that nothing writes; the manager-override path (`overrideReason`) is modelled but has no counter UI until **B-039**. Attach-rate reporting, including the per-staff coaching number, is **B-042**. The premium reaches `Lease.protectionCents` only when **B-026** creates the lease — until then it lives on the checkout session.

---

### B-023 — Document generation & store ✅ `fc043f8`

One document store (US-16) and a templating service that fails loudly (FR-6). The thing B-024's e-signature evidence chain rests on.

**Decided: the canonical rendered document is semantic HTML, not PDF — and that is a real deviation from the backlog row.** The row asks for *tagged* PDFs: heading structure, reading order, table headers, `lang`, `/Title`, real text not raster. That is not decoration; PRD 01 §6.8.1 lists it because an untagged lease PDF is the classic accessibility failure discovered years later, usually in a demand letter.

No JavaScript PDF library available here emits tagged PDFs. `pdf-lib`, `pdfkit` and `@react-pdf/renderer` all produce untagged output — tagging is a structure tree the encoder has to build and none of them expose one. The routes that work are a headless browser's print pipeline or a paid API, both a runtime or vendor decision this project has not taken, and Vercel's serverless runtime has no Chrome. So rather than ship an untagged PDF that fails the acceptance criterion silently, the service renders accessible HTML that carries exactly the properties the tagged-PDF requirement asks for, hashes and stores identically, and is what the signature will bind. The PDF encoder is a named seam with no adapter — the same posture D-4 took for gate vendors and D-14 for geocoding: implement well the thing we can do, and leave a seam rather than a bad version of the thing we cannot. **Whether to add a rendering runtime is an owner decision and is flagged below.**

**"Fails loudly on missing fields" is the requirement, and it is enforced before anything is written.** A lease that renders "Dear " is a document somebody signs — a legal artifact with a hole in it. A blank value counts as missing, because an empty string is how an absent value usually arrives from a form, and the error names every missing field rather than the first. There is a test asserting that a template with a hole stores nothing at all.

**Merged values are escaped.** A lease is exactly where someone would try, and a surname containing an ampersand must not be able to break the document either.

**One store, not one per feature.** US-16 is explicit about why: three URL columns on three entities is how the evidence chain acquires three retention policies, two of them wrong. Lease PDFs, notices, walkthrough and overlock photos, auction evidence and proof-of-insurance declaration pages all land in the same table, typed, with soft delete only.

**The SHA-256 answers the only question a dispute asks:** is this still the document that was signed? `verifyDocument` recomputes it, and there is a test that edits the stored row directly and asserts the mismatch is caught. It reports "no content" rather than a confident "ok" for uploaded files, whose bytes are not in the database.

**Found — the audit layer refused the delete.** `document.deleted` is on B-005's list of actions that cannot be recorded without a reason *code*, and the first implementation passed free text in the context instead. The invariant was right: evidence deletion is precisely where "why" must be captured at the moment it is known rather than reconstructed from a timestamp later.

**Verified:** 523 unit tests (13 new), typecheck, lint and build clean.

**Left behind and needing a decision:** **uploads have nowhere to put bytes.** `storageRef` exists and nothing writes it, because no blob store is configured and inventing a local filesystem path would not survive a serverless deploy. That blocks US-16's ID copies and insurance certificates, **B-022**'s declaration-page upload, **B-060**'s walkthrough photos and **B-062**'s auction evidence — the last of which is the lock-cut inventory that a wrongful-sale defence depends on. Generated documents are unaffected: they are text, they are small, and keeping them in the row means the hash and the content cannot drift apart. Also outstanding: no template *registry* — B-024 brings the first real template with it, and inventing a management UI before there is one document to manage would be scaffolding.

---

### B-024 — Lease template & e-signature ✅ `3072779`

The lease, the plain-language summary, and the signature evidence E-SIGN actually asks for.

**The lease text is a draft and is not legal advice**, stated in the file itself rather than left implicit. D-10 makes Texas the default and everything per-state configurable. Three things are named as outstanding before it is used against a real tenant: the lien and notice language (Texas Property Code ch. 59), the rate-increase notice period (PRD 01 §10, still open), and the protection clause D-17's auto-enrolment depends on. Generated text acquires authority by looking official; saying so in the source is the cheapest guard against that.

**Decided: signature evidence is consent, attribution and a hash — not a picture.** E-SIGN/UETA asks whether the signer agreed to transact electronically, whether the record is attributable to them, and whether it has been retained unaltered. So `DocumentSignature` stores the typed name, the consent as its own boolean, the IP and user agent as best-effort attribution, and **the hash of the document as rendered at the moment of signing**.

That last field is separate from `Document.contentHash` on purpose, and the difference is the whole point: a check against the document's own current hash is fooled by anyone who updates the content and the hash together. Comparing against the hash captured *at signing* catches it. There is a test that does exactly that — rewrites both fields — and asserts `altered_since_signing`.

**Consent is its own affirmative act**, unticked by default, with its own error message. It is never folded into the signature field and never expressed as a disabled button.

**The signature control is not gated on scrolling.** §6.4 is explicit that "scrolled to bottom" is hostile, and it is simply broken for a screen-reader user who never scrolls at all. The gate is that the plain-language summary has rendered — which it always has, because it is ordinary page content above the full text rather than a tooltip or a collapsed panel. The lease itself renders as normal scrollable content, not a fixed-height box with hidden overflow and not an image.

**Typed-name matching accepts a real signer and rejects a non-signature.** An included or omitted middle name passes; "AR", "yes" and "I agree" do not. Rejecting a genuine variant would send someone round a loop for no benefit; accepting "yes" would put a worthless mark on a legal document.

**The hash is re-read from the stored document, never taken from the form.** A hash passed through a form is a hash the signer could choose. Signing is also refused outright if the stored document has already drifted from its own hash — a signature over a document that changed beforehand is worse than no signature.

**Found — a stored document is not an embeddable fragment.** `renderDocument` produces a complete document (doctype, `<html lang>`, `<title>`, `<h1>`) because that is what gets stored, hashed, signed and emailed. Injecting that into a `<div>` leaves the markup in the DOM but unrendered — the headings were findable by role and invisible to `toBeVisible()`, which is a bug that presents as "the element exists but is not visible" and cost real time here. `RenderedDocument` now carries `bodyHtml` alongside `html`, with the distinction documented at the type.

**Also found — Playwright's `name` matcher is a case-insensitive substring.** `{ name: 'Continue' }` also matches "This is right — continue" and "Sign and continue", so a click intended for one step could re-fire the previous step's button. Every checkout step click is now `exact: true` with an awaited heading between steps.

**Verified:** 534 unit tests (11 new), 214 e2e (1 new, walking all five steps to payment), typecheck, lint and build clean. `DocumentSignature` joined the annotated facility-scoping exemptions — it is scoped through the document it signs.

**Left behind:** the signed lease is **not emailed** (FR-4.2 asks for it) — comms is **B-030**/**B-031**, which is now the missing piece for the fourth consecutive item. There is no lease-template management UI: the template is a constant, and PRD 02 US-15's admin-managed templates want a real editor plus versioning, which is its own work — a facility cannot yet vary its lease. The signature is recorded against the checkout session's document; **B-026** links it to the `Lease` row when one exists. The renter cannot download a copy from the page yet, and the PDF question from **B-023** stands.

---

### B-025 — Payment step ✅ `e7bb69a`

The Stripe Payment Element, the itemised review, and autopay default-on with the disclosure §6.9 requires. The step that finally connects B-019's foundation to a real charge.

**No Stripe keys are configured, so what actually renders today is the honest fallback**: "we can't take card payments online just now — call us, and your unit stays held." That is the shipped behaviour, and it is the one e2e asserts. A form that cannot submit is worse than a sentence that ends in a rented unit, and `paymentsEnabled()` existing since B-019 is what makes the choice cheap.

**The total is computed server-side from the session, never from the browser.** The protection premium comes from where step 3 recorded it — a premium the browser could supply is a total the renter could choose. There is a test that passes a nonsense premium through the session data and asserts the total does not move.

**The same calculation as the facility page**, asserted directly against `calculateMoveInCost` rather than against a number that happens to match today. US-301 makes a discrepancy release-blocking; that is only enforceable because there is one implementation and a test that compares them.

**The idempotency key is the checkout session id.** A renter who reloads, double-submits, or returns to the step gets Stripe's original intent rather than a second charge — the reason B-019 derived keys from *what the money is for* rather than from when it was asked for.

**Finalisation is webhook-driven, never the client redirect** (FR-4.4). `redirect: 'if_required'` and a reload; the webhook is what marks the payment succeeded, so a renter who closes the tab still gets their unit.

**A decline is mirrored out of Stripe's iframe.** Errors reported only inside the Element are frequently not announced at all, so the message is copied into a page-level `role="alert"` that is rendered empty on load and receives focus when it fills. The Element is also given an explicit `appearance` with 4.5:1 text and a 3:1 focus ring matching this project's own tokens — Stripe's defaults inherit exactly the weak borders B-093 had to fix, and the Element is a cross-origin iframe that axe cannot scan, so those values are the only contrast guarantee it gets.

**Autopay is default-on with the disclosure beside the control, not behind a link** (§6.9, D-11a): the amount, the day of the month, and the promise of a notice two days before every charge, tied to the checkbox with `aria-describedby`. Turning it off is one activation in the same tab sequence rather than a settings page to find later. That default is only defensible with the disclosure attached, which is why the two ship together and why e2e asserts the association.

**Verified:** 539 unit tests (5 new), 216 e2e (1 new, walking all six steps), typecheck, lint and build clean.

**Left behind:** provisioning is **B-026** — a successful payment currently records a `Payment` row and advances the step, and nothing yet creates the `Lease`, marks the unit occupied, opens the ledger or requests a gate code. **So the flow does not yet end in a moved-in tenant**, which is the milestone's whole point and the next item. Wallets (Apple Pay/Google Pay) come from the Element automatically on supporting devices but are untested without keys. ACH and Link are Phase 2 (**B-081**). The password-set step and the confirmation screen with the gate code (US-501 steps 6–7) are **B-026**/**B-029**. OQ-4's legal review of the autopay copy is still open, and the draft text is exactly that — a draft.

**Worth recording — the e2e suite is flaky under local parallel load.** Several runs this session failed a handful of tests that pass in isolation, always different ones, always dev-server-timing shaped. CI runs with `retries: 2` and a production build; locally it is `retries: 0` against `next dev`, which compiles routes on demand while two browser projects hammer it. Nothing has been changed for it, but a green local run currently means "green on the second try" often enough to be worth knowing.

---

### B-026 — Move-in provisioning & rollback ✅ `df322b8`

The flow now ends in a moved-in tenant: a paid checkout becomes a lease, an occupied unit, an opened ledger and a `lease.moved_in` event. **Milestone 2's golden path is closed end to end** — search → facility → reserve or rent → details → unit → protection → lease → payment → moved in.

**FR-4.6 shapes the whole design: a paid renter is moved in, whatever fails afterwards.** So provisioning splits in two. The part that must be atomic with the payment — lease, unit status, ledger, waiver and document re-parenting, reservation conversion — is one transaction that either all commits or none does. Everything after it is best-effort and *cannot* un-move-in someone who has paid. The provisioning call sits deliberately **outside** the payment transaction in the webhook: if it throws, Stripe retries and the money stays received rather than the payment rolling back.

**Idempotent, because it has to be.** Stripe delivers at-least-once, and a renter refreshing the confirmation page is the same problem. A second call returns the existing lease with `alreadyProvisioned: true` — tested by calling twice and asserting one lease and one rate-change row.

**The rate-increase clock starts here, and that timing is the entire point.** `LeaseRateChange` gets its first row at move-in with reason `move_in`. ECRI is the largest revenue lever in self-storage and needs two facts — when this tenant was last raised, and how far below street they sit — neither of which can be reconstructed afterwards. A lease created without this row is a tenant permanently ineligible for a rules-based increase. **B-076** builds the workflow; this is the clock it reads, started early on purpose because it cannot be backfilled.

**The unit becomes occupied by derivation, not assignment** — the lease is what makes it so (B-010), so there is no second source of truth to drift. Verified by asserting the public inventory read drops to zero available.

**A reservation that led here is marked `converted`, not left to expire.** That distinction is the whole basis of the reservation→move-in conversion report, and it is exactly why B-020 refused to reuse the reservation row as the checkout lock.

**The signed lease document is re-parented from the checkout session to the lease**, so the evidence chain points at something permanent rather than a transient session id.

**Found — a global outbox and parallel test files do not mix.** `dispatchEvents` claims any pending event matching a consumer's subscriptions, and the dispatch tests' consumer subscribes to `lease.moved_in` — which provisioning now emits. With vitest running files in parallel against one database, the dispatch tests were claiming another file's events mid-assertion, and the failure looked like an outbox bug rather than a fixture collision. Serialising files fixed it and cost **7×** — 22s to 164s — so instead `dispatchEvents` gained an optional `facilityId` scope. The scheduled drain passes nothing and behaves exactly as before; the tests pass their own facility. Suite back to 23s.

**Verified:** 548 unit tests (9 new), 216 e2e, typecheck, lint and build clean.

**Left behind:** the gate code is **not issued** — access control is **B-027**/**B-029**, so the confirmation screen says the code will be texted within 15 minutes and offers a phone number, which is true rather than a placeholder that looks like a code. US-501 step 7's full confirmation (code in large type with copy button, maps link, lock instructions) waits on that. No emails: **B-030**/**B-031**, now the outstanding dependency for the sixth consecutive item. Downstream failures should become `Task` rows (**B-095**) and currently emit an event with no consumer. The password-set step (US-501 step 6) is **B-033**. Invoicing the second month is **B-044** — this opens the ledger with the move-in charge and nothing schedules the next one yet.

**Also worth knowing:** the `.next/cache` window from B-018 bit again. The facility page renders from a 5-minute cached read, so immediately after a destructive re-seed it serves unit-type IDs the uncached rent route rejects — which presents as "Rent now" bouncing to `?unavailable=1`. Clearing `apps/web/.next/cache` after seeding is the fix; the redirect itself is correct behaviour for a genuinely withdrawn size.

---

### B-027 — Access control service ✅ `510a5c9`

The `AccessGrant` state machine, the gate-command outbox, and the simulated adapter. A move-in now issues a real gate code.

**The outbox exists because a gate controller is a box in a car park on domestic broadband.** It is offline sometimes and slow often, and US-501 is explicit that move-in success must not depend on its uptime. So nothing calls hardware inline: the service records what it wants to happen and returns, and a drain does the talking with backoff and dead letters. Access provisioning is a **consumer of `lease.moved_in`**, not a step inside B-026's transaction — if it throws, the event retries and the tenant stays moved in.

**Decided: the state machine is a table, not a switch.** FR-1 requires every transition recorded with a cause, and a table can be enumerated in a test where a switch has to be read. `revoked` is terminal: a tenant who comes back gets a new grant rather than a revived one, because the history of why access ended is evidence. `pending → suspended` is refused — suspending access that was never granted is a bug, not a state.

**A same-state move is a quiet no-op, not an error.** A delinquency run that fires twice should not tell the controller twice; the caller gets `changed: false` and nothing is enqueued.

**`opensGate()` is a function rather than an inline comparison**, because it is the question every access decision asks and a second site spelling it `!== 'suspended'` would let a pending or revoked grant open a gate.

**The gate code is returned exactly once and never stored.** SR-2 makes viewing a real code a separate audited permission, so the credential row holds a reference and the plaintext exists only in the return value and in what goes to the controller. A test asserts the code appears nowhere in the serialised credential row. Codes are server-generated and reject the obvious patterns — a keypad wears, and "123456" or six identical digits is what a stranger tries first; that generator is tested directly across 5,000 draws rather than through the database.

**Retryable and permanent failures are different.** A controller that is offline gets five attempts with exponential backoff; a rejected code or an unknown zone dead-letters immediately, because retrying will fail identically and only delays the staff alert that is the actual fix. Dead-lettering emits `access.sync_failed` — the tenant is already moved in and expecting a code, so it has to reach a human rather than sit in a table.

**Found — `randomInt` caps its range at 2⁴⁸.** The first credential reference asked for a 16-digit random and threw at runtime, not at compile time. Replaced with `randomBytes`.

**Found — a deleted credential could wedge the queue.** The drain used `update`, which throws when the row has gone; a command whose credential was removed underneath it would fail forever behind a `RecordNotFound`. `updateMany` no-ops instead — the command still succeeded, because the controller took it.

**Verified:** 565 unit tests (17 new), 216 e2e, typecheck, lint and build clean.

**Left behind:** the code still is not **delivered** to anyone — `provisionAccessForLease` returns it and B-026's confirmation screen still says "your gate code will be texted within 15 minutes", which remains true only because **B-030**/**B-031** will make it so. That is now the seventh consecutive item waiting on comms. The portal's "show gate code" (**B-034**) has nothing to show until a secret store exists — no backlog item owns one yet, flagged when B-028 turned out to be the simulator rather than that store — today the plaintext is genuinely unrecoverable after issuance, which is safe but not yet useful. Authorized-access holders are **B-029**: FR-1's "one grant per credential holder" is currently one grant per *tenant*, which is the same shape with a single holder. Per-facility code policy (length, banned patterns, zones) is a constant with a `ponytail:` marker. Real vendor drivers are **B-080**/**B-085**, one stub per D-18.

### B-028 — Gate simulator ✅ `26c6a71`

`SimulatedAdapter` gained real state, a mock vendor's own database, a signed webhook path, a virtual keypad dev page, and fault injection. The whole access lifecycle now runs with no hardware, proven end to end against B-027's real service.

**Decided: the mock vendor gets its own table, deliberately separate from `AccessCredential`.** SR-2 (B-027) means our own credential row never stores the plaintext code — it holds a reference. A real vendor's controller is the thing that actually knows the code. So `SimulatedGateCode` exists to play that vendor's part, and its own comment says so: a real integration would have no equivalent row on our side at all. Re-verified at this boundary with a test that the plaintext still never touches `AccessCredential` even once a "vendor" exists to hold it.

**The webhook signature is real HMAC, timestamped, checked in constant time — not a demo of the idea.** FR-8 asks for "the same webhook signature scheme as the design's real-vendor contract, so security code paths are exercised," and that only means something if a tampered payload, a wrong secret, and a replayed old capture are all genuinely rejected. They are, and by the same test shape B-019 used for Stripe: no network, no live route, pure crypto exercised directly.

**Decided: delivery is in-process, not a real self-fetch to our own route.** The route is real and is what a genuine vendor's webhook would POST to (B-085) — but having the simulator call it over an actual HTTP round trip to its own origin adds a URL-configuration and self-network fragility this doesn't need to take on for a dev tool. The full sign-then-verify pair still runs for real; only the transport is short-circuited. Marked with a `ponytail:` comment naming the corner and when to revisit it.

**Decided: an unset webhook secret gets a random per-process value outside production, rather than failing closed the way B-019's Stripe endpoint does.** The two secrets are not the same kind: Stripe's protects a boundary an external party can actually reach, so failing closed is the only honest choice there. Nothing external can reach `/api/hardware/webhook` yet — only this in-process simulator — so a generated secret still exercises real signing and verification without forcing a manual setup step before US-7's own "zero external dependencies" demo will run. Fails closed once a real secret is expected (production, or the env var explicitly set).

**Offline and webhook-failing are independent faults, both real.** `offline` fails every queued command retryable *without touching controller state*, which routes straight through B-027's existing retry/backoff/dead-letter machinery rather than reimplementing it — a UI checkbox now exercises that whole path for real. `webhookFailing` is the other direction: the gate still decides granted or denied from its own local memory (a real standalone keypad does not stop working because the network is down), but the resulting event sits in `SimulatedVendorEvent` until replayed. Verified with a browser walkthrough, not just tests: entering a real code while webhook-failing showed "event queued" and left the events table unchanged; replaying delivered it and the row appeared.

**A denial distinguishes "never existed" from "existed but is off".** `unknown_code` vs `inactive` — because FR-4's unknown-code retention is about a stranger trying codes at a gate, which is a different signal from a tenant using a code that was suspended yesterday, and a later anomaly flag (B-064) needs to tell them apart.

**Kept small on purpose.** FR-4's fuller event pipeline — cursor-based polling, admin event log, anomaly flags, gate-hours enforcement — is explicitly B-064's row, which depends on this one. `AccessEvent` here is the minimum that makes US-7 AC2 true: a real event, created through a real signed webhook, deduplicated by vendor event id. Everything past that is left for the item whose job it is.

**Verified:** 582 unit tests (28 new, including the full lifecycle through the real access service — issue, revoke, resume — driving the mock vendor's state correctly each time), and a real browser walkthrough against the demo facility: granted, denied, queued-under-fault, and replayed, with screenshots. `/admin/dev/keypad` joined the admin accessibility contract and passed outright, including the 320px reflow check that three denser admin screens still carry as a known `test.fixme` gap from B-094.

**Left behind:** the corrected note from B-027 stands — no backlog item yet owns a real secret store, so the portal's gate-code reveal (B-034) still has nothing to show. FR-9's reconciliation (nightly expected-vs-actual diff) is B-080. Per-facility code policy beyond the fixed 6-digit length is a `ponytail:`-marked constant. The dev page is reachable by URL only, not in the nav catalog — a deliberate choice for tooling framed as "developer/learner," worth revisiting if it turns out staff actually want it during a live demo.

---

### B-029 — Gate code issuance on move-in + confirmation screen, and the authorized-access list ✅ `71e745b`

Gate codes are now encrypted at rest and issued synchronously at payment, not just handed back once and forgotten. The confirmation screen shows a real code, address and today's hours instead of the "texted within 15 minutes" placeholder every prior item since B-026 had to leave in. `AccessGrant` widened to a real holder — tenant or a new named authorized person — with its own service, so US-9's list is staff-manageable end to end even though B-038 (the screen that will call it) does not exist yet.

**Found and fixed: "immediately" was actually "on the next cron tick".** US-501 wants the code the instant checkout finishes, but `requestDownstream` only emitted a second `access.granted` event with no consumer — the real consumer is `provisionAccessForLease` listening for `lease.moved_in`, and `dispatchEvents` only ever runs from `/api/cron/route.ts`. A renter's code was arriving up to a business-day late, silently, because nothing tested wall-clock timing end to end. `requestDownstream` now calls `provisionAccessForLease` directly; the event-driven consumer stays registered as an idempotent safety net for a redelivered webhook, not the primary path.

**Decided: the code is encrypted at rest, not merely referenced.** B-027/B-028's `AccessCredential.valueRef` held an opaque reference with no way back to the plaintext — safe, but nothing could ever show a code again, including the confirmation screen this item needed to build. `valueRef` now holds `enc:<iv>:<authTag>:<ciphertext>` (AES-256-GCM, `lib/access/secret.ts`) when `ACCESS_CODE_ENCRYPTION_KEY` is configured, or a distinguishable `unrevealable:<opaque>` tag when it is not — `decryptCode` tells the two failure modes apart so a caller can say *why* nothing is showing. This corrects B-027/B-028's PROGRESS notes, which described a "secret store" backlog item that does not exist; PRD 03's SR-1 secret store is about vendor API credentials, not tenant codes.

**Decided: no dev fallback for the encryption key, unlike the hardware webhook secret.** B-028's webhook secret can be an ephemeral per-process value outside production because it only has to agree with itself within one sign-then-verify call. This key has to decrypt codes written by a *previous* process, possibly a different serverless invocation entirely — an ephemeral key would make every code permanently unrecoverable the moment the process that wrote it recycled. Unset means reveal is unavailable, the same honest-degradation posture as an unconfigured `STRIPE_SECRET_KEY`.

**Decided: `codeHash` (SHA-256, facility-scoped, indexed) makes FR-2's uniqueness check an indexed lookup instead of a decrypt-every-active-credential scan.** Not a secret itself — a 6-digit keyspace is brute-forceable regardless of the hash — only a dedup key. `issueCredential` retries up to 20 times against a codeHash collision before giving up loudly; `generateUniqueCode` takes an injectable generator specifically so that retry-and-give-up path is testable without controlling `randomInt`'s output.

**Decided: one grant per holder, tenant or authorized person, via two nullable FKs and a raw CHECK constraint.** Prisma's schema language cannot express "exactly one of two columns is set," so `access_grant_exactly_one_holder` (migration `20260802110000_authorized_access`) is the backstop, proven directly with a test that inserts both-set and neither-set rows and watches Postgres reject each. `ensureGrantForHolder` enforces the same rule at write time; `ensureGrant` is now a one-line wrapper over it for the tenant case, so every existing caller and test needed no change.

**Decided: the authorized-access list is staff-managed with no UI in this item**, the same split B-096 used for lease holds — B-038 (the tenant/lease profile screen) does not exist yet, so `createAuthorizedPerson`/`revokeAuthorizedPerson` exist as a real, tested service with nothing to call them from except a future admin screen. `AuthorizedAccessPerson.accessHours` is modeled (reusing the validated `WeeklySchedule` shape) but unread — gate-hours enforcement is B-064's. `cascadeAuthorizedAccess(leaseId, to, cause)` exists as a seam for a lease-level suspension to reach every authorized person on it, but nothing calls it yet: delinquency-driven suspension of a tenant's *own* grant is not wired up either, anywhere in the codebase today.

**Two new permissions, `access:manage_grants` and `access:view_codes`**, granted to counter/manager/regional (owner inherits everything; bookkeeper and system deliberately do not get them). `revealCode()` is the staff-facing, permission-gated, audited path (`access.code_viewed`, reason required) — distinct from the confirmation page's own `codeForLease()`, which is gated by the checkout token that already controls that whole page, not a staff permission, since it is the renter reading the code just issued for them.

**Verified:** 603 unit/DB tests (21 new — encryption round-trip, uniqueness retry and give-up, the CHECK constraint from both illegal directions, the full authorized-access lifecycle including cap enforcement and per-person revocation, `revealCode`'s permission gate and audit write, and the confirmation page's `codeForLease`/`leaseIdForSession` lookups), 220 e2e passing (6 pre-existing skips, unrelated), typecheck, lint and build clean. The confirmation screen was checked in a real running dev server against two manually seeded sessions — one with a key configured and a credential issued (code, unit number, address, today's hours, directions link all render), one without (the honest "texted within 15 minutes" fallback renders, with no code or unit number) — not just asserted in a test.

**Left behind:** no e2e spec drives the real checkout flow through to the `provisioned` step — that flow was never e2e-reachable even before this item (Stripe's Payment Element runs in a cross-origin iframe and nothing in this repo simulates a completed PaymentIntent from a browser), so this item did not newly create that gap, it just means the confirmation screen's code reveal is proven by DB-backed tests and a manual pass rather than an automated browser spec. `AuthorizedAccessPerson.accessHours` is unenforced until B-064. The authorized-access admin screen is B-038's. `cascadeAuthorizedAccess` has no caller until delinquency-driven suspension exists. Comms (B-030/B-031) still owns actually texting/emailing the code — this item only makes the code *exist* and *appear on the page the renter is already looking at*, not send anything.

---

### B-030 — Comms core: the single outbound messaging service ✅ `0fdca2e`

The engine every other module has been emitting events at since B-019: one place that turns a domain event into a sent, logged, idempotent message. B-030 ships the pipeline and the data model, not the copy — the rules and templates that light it up are seeded by the items that own the content (B-031's move-in path next, billing/dunning later). Email-only (Resend); SMS is Phase 2. Nothing else in the codebase sends; producers emit, this consumes.

**The pipeline is the spec (FR-1), built stage by stage.** `processCommsEvent` runs: kill-switch check → resolve the rules mapped to the event → resolve the recipient → per rule: skip-condition (staleness) re-check → suppression/consent matrix → render → provider send → append-only `Message` log. Each stage ships the *mechanism* plus only the resolvers/predicates provable against what exists today; later items extend the registries without touching the engine. Recipient resolvers cover `Lease` and `Tenant` (what B-031 needs); the skip registry ships one predicate (`tenant_moved_out`); the merge-context builder assembles the FR-10 fields that don't need billing. A template that references a field not built yet fails loudly rather than mailing a blank — which is exactly why those templates aren't seeded until their data exists.

**Idempotency is the hard invariant, enforced three ways.** The `Message.idempotencyKey` — `sha256(eventId, ruleId, recipientId, channel)` — is a unique column, so a redelivered event, a retried delivery, or a restarted job all land on the same row instead of a second email. The row is reserved (`queued`) before the network call, and the same key is passed to the provider as *its* idempotency key (Resend honours it for 24h, like Stripe), so even a crash between our "sent" write and the provider's ack can't double-send. Tested by processing the same event twice and asserting one row, one provider call.

**Rules and templates are data (FR-2), with per-facility overrides.** A facility-specific rule beats the org default for the same template key; a facility template beats the org template, highest active version winning. Adding a rule is a row, not a deploy — which is why the `comms.dispatch` consumer subscribes to the full §5.2 event set now and no-ops the events that have no rule yet, rather than growing its `events` array every time content lands.

**The suppression matrix follows CAN-SPAM, not a blunt block.** A hard bounce or spam complaint blocks every channel (the address is dead or the recipient reported us); STOP blocks SMS only; unsubscribe/manual block marketing only — transactional mail still goes, which the transactional carve-out permits and a tenant expecting a receipt needs. Consent gating is wired for marketing/SMS but dormant in an email-transactional MVP. The shared `Suppression` list is org-wide by address (an opt-out spans facilities), which is why it's the one new model deliberately without a `facilityId` (exemption recorded in the schema-invariants test).

**Honest degradation, same posture as Stripe and the gate adapter.** With no `RESEND_API_KEY` the provider is log-only: it writes the full `Message` evidence row but puts nothing on the wire, so the pipeline is provable in dev/test without a real email escaping. The kill switch (`COMMS_KILL_SWITCH=on`) is an org-level emergency stop — nothing sends while it's on, and (documented sharp edge) messages suppressed during the pause are **not** replayed when it clears; that's the right shape for "stop mailing tenants now" and the wrong shape for a maintenance window, so a DB-backed operator toggle with replay is left to a later ops item. The sandbox redirect (FR-20) is the safety net: a real key outside production rewrites every recipient to `COMMS_SANDBOX_INBOX`, and if that's unset a stray key falls back to log-only — no preview deploy can reach a real tenant.

**Verified:** 622 unit/DB tests (19 new — pure render/idempotency, and a DB-backed pipeline covering the send, the no-double-send invariant, the suppression matrix in both directions, the kill switch, the sandbox redirect, render-fails-loud, skip-condition staleness, and both facility overrides), 220 e2e, typecheck, lint and build clean. No manual browser pass — B-030 has no UI; the delivery dashboard and preference center are later items.

**Left behind (deliberate, with owners):** the actual move-in templates and rules are **B-031** (this shipped zero seeded content on purpose). SMS end to end — Twilio, quiet hours, STOP/HELP/START, the SMS→email fallback pair, consent capture at move-in — is **B-032**/Phase 2; the schema and the consent/suppression checks are already shaped for it. Pay-now magic links (FR-12/13) belong with the pay flow (**B-035**). Provider status webhooks and the `message_status_event` table (FR-14/15) — so `Message` can advance past `sent` to `delivered`/`bounced` and a hard bounce can auto-suppress + raise a task — are a later item; today B-030 writes up to `sent`. The template editor with preview/test-send (CN-16), the delivery dashboard (CN-19), and the suppression-management UI (CN-20) are their own items; `suppress()` ships as the write path a bounce/STOP handler will call, without the screen. Per-facility sender identity (CN-17) is one org-level From for now. Time-sensitive sends (`payment.failed` <5 min, FR-6) ride the hourly cron like everything else; a synchronous nudge, if the median ever misses, is a later tuning, not a rebuild.

---

### B-031 — Move-in path transactional emails ✅ `b7e9c9d`

The first real content on B-030's engine: reservation confirmation and its 24h-before-expiry reminder, the move-in welcome (gate code, first charge), and the checkout resume link FR-4.1 has promised since B-020. Along the way, closed a real gap each of the three token-bearing sends exposed: a stale forward-reference in B-003's auth emails, a missing "complete move-in online" link on the reservation page itself, and — the actual bug — B-030's rule/template pipeline had no way to carry a one-time bearer token at all.

**Found and fixed: the rule/template pipeline cannot send a magic link, by design, and three real sends needed one.** FR-18 makes `processCommsEvent` re-read everything at send time — right for a gate code or a balance, wrong for a reservation's or a checkout session's raw token, which (same rule as B-029's gate codes) exists only once, in the call that minted it, and is never persisted. `sendDirectEmail` is the second, deliberately separate path this exposed: same suppression check, same provider, same `Message` log, but the caller composes its own content and supplies its own idempotency key instead of resolving a rule. Reservation confirmation, the checkout resume link, and now `sendAuthEmail` (see below) all go through it.

**Decided: two sends are synchronous, called directly from the mutation that creates their token, not through the event/rule pipeline at all.** `dispatchEvents` only runs off the hourly cron (the same fact B-029 found and fixed for gate-code issuance) — fine for a welcome email, wrong for "here is your hold" or "here is your resume link," both of which are exactly the message a renter is looking at their inbox for *right now*. `createReservation` and `submitDetailsAction` (checkout step 1) call `sendReservationConfirmation`/`sendCheckoutResumeLink` directly, wrapped so a comms failure can never fail the mutation that already committed — `sendDirectEmail` itself never throws on a provider error either, recording `failed` in the Message log instead, which is also why there is no retry queue for these two sends (left behind, below).

**Found and fixed: `sendAuthEmail`'s own comment named this item.** B-003's delivery seam explicitly said "wire this to the notification service in B-030" and — worse — threw in production the moment `RESEND_API_KEY` was set, because nothing had. Now routed through `sendDirectEmail` (a random idempotency key per request, not a stable one — a second magic-link request is supposed to mint and send a second, newer link, invalidating the first, which `requestMagicLink` already does on the token side).

**Found and fixed: the reservation confirmation screen never actually had "a link to complete move-in online"**, which US-401's AC promises and which the new reminder/confirmation emails also needed a real destination for. Added the button and its action (`completeMoveInFromReservationAction`), reusing `startCheckout({reservationId})` — already-built B-020 machinery with no caller until now — rather than inventing a second path. A plain `href` couldn't do this anyway: starting a checkout locks a unit, which "Rent now" (B-020) already treats as a POST-only, deliberate act, not something a mail client's link-prefetch can trigger.

**Decided: the 24h reservation reminder runs every cron tick, not through `SCHEDULED_JOBS`.** That mechanism fires a `scope: 'global'` job once every 24 hours (or once per facility-local day) — right for a nightly sweep, wrong for a window a reservation can enter at any hour. `sendExpiringSoonReminders` runs alongside `dispatchEvents` on every tick instead; `Reservation.expiryReminderSentAt`, not the event outbox, is what makes "once" true, since a fresh event id would mint on every tick a hold sits inside the window otherwise.

**Decided: the reminder carries no link.** The reservation's raw token, like the confirmation email's, does not exist by reminder time — only the confirmation email, sent once at creation, ever holds it. Rather than build a second token mechanism for a reminder, the email points back to "the link in your confirmation email" plus the facility phone number. A real fix (a short-lived reminder-specific token, the same shape as B-003's `AuthToken`) is a reasonable follow-up, not built here — noted below.

**Found a real footgun while building this: a broad test-cleanup filter deleted live reference data.** An early version of `comms-db.test.ts`'s `afterEach` matched `notificationRule` rows by `event: { startsWith: 'lease.' }` to clean up its own fixtures — which also matched the real seeded `lease_moved_in_welcome` rule the moment it existed, deleting it from the shared dev database as a side effect of a failing test run. Fixed by scoping the filter to `templateKey: { contains: suffix }` instead, and by decoupling B-030's own generic pipeline tests from any real event name (`test.lease_event` in place of `lease.moved_in`) so they can never collide with seeded content again. Worth remembering for the next comms test file: a cleanup filter keyed on anything less specific than "rows this test created" is a live hazard once real reference data shares the table.

**Verified:** 637 unit/DB tests (33 new — the reminder sweep's idempotency and window boundaries, the Reservation recipient resolver and its context extender against the real seeded templates, the move-in welcome's gate-code/no-code fallback and stale-lease skip, `sendDirectEmail`'s idempotency and suppression, both synchronous triggers end to end including "no resend on an update"), 220 e2e, typecheck, lint and build clean. Manually verified against the demo facility: a real reservation's confirmation email (checked in the `Message` table) contains the working link and correct hold time; the `/reservations` page renders the new "Complete move-in online" button. Browser automation was not available this session, so the button's own click-through was verified by code path (the same `startCheckout({reservationId})` route B-020's own "reuses the unit a reservation already holds" test already exercises) rather than driven live — noted rather than silently assumed.

**Left behind:** SMS (all of CN-1–CN-15's SMS columns) is still Twilio/B-032/Phase 2. The reservation reminder has no resume link — a short-lived reminder-scoped token (`AuthToken`-shaped) would close this. No retry queue for the two synchronous direct sends; a transient Resend failure records `failed` in the Message log and is not retried, unlike everything on the rule/template pipeline, which the hourly consumer redelivers. `billing.first_charge_line` reads `LedgerEntry` because nothing generates a real `Invoice` yet (B-044) — revisit the wording once invoices exist. The dunning ladder, delinquency-stage notices, and rate-increase notice are later items with their own billing-engine dependencies. Lease PDF as an actual downloadable attachment/link is B-037's (the portal document store); the welcome email states what's on file rather than linking to something not yet servable.

---

### B-032 — SMS consent capture at move-in ✅ `2985eec`

Two new consent records, captured at the two points in online move-in where they legally have to be: an unchecked-by-default SMS checkbox at checkout step 1 (right where the phone number itself is collected), and a distinct `notice_email` record at lease signing — not folded into `account_email`, per PRD 02 US-13's own reasoning that overloading the wrong channel destroys the ability to prove the specific agreement was made. First real writer of the `Consent` table D-8 reserved back at B-002.

**Decided: one shared `recordConsent` primitive in `packages/core/consent`, not two ad-hoc writes.** D-8 settled that the consent table belongs to neither PRD 04 (marketing) nor PRD 05 (transactional/SMS); this is the first module to actually write to it, so it's also the first chance to build the one function every future writer (marketing consent, portal preference changes, a future STOP handler) goes through rather than each hand-rolling a `prisma.consent.create`. Deliberately append-only in *usage*, not enforced by the schema: a later grant or revoke is a new row with a later `capturedAt`, so the history a dispute reads is never overwritten by whatever is currently true.

**Decided: SMS consent is recorded either way, not only when granted.** CN-15's own AC list — "Stored: timestamp, IP/terminal, disclosure text version, checkbox state" — names the checkbox state as evidence in its own right, not just a gate on whether a row exists. A declined checkbox proves the disclosure was shown and answered; silence proves nothing. `state: checked ? 'granted' : 'revoked'` on every step-1 submission is what makes that provable later.

**Decided: `notice_email` reuses the existing e-signature checkbox rather than adding a second one.** `ELECTRONIC_RECORDS_CONSENT` (B-024) already reads "...and to receive my lease, receipts and notices by email rather than on paper" — the same real-world act US-13 wants recorded as its own channel. Rather than present a second, confusingly similar checkbox next to it, the existing one now writes two things when checked: the `DocumentSignature.consentedToElectronicRecords` flag it always did, and a `notice_email` Consent row alongside it. `validateSignature` already refuses to sign without `consented: true`, so this row is always `granted` — there is no unchecked case that reaches persistence, unlike SMS.

**Found and fixed, in the course of testing this: `headers()` and `revalidatePath` are two different kinds of "outside a request scope" failure, and only one of them was worth fixing in the action itself.** Calling `submitDetailsAction`/`signLeaseAction` directly (the only way to verify the consent-writing wiring without e2e — see below) surfaced that `headers()` throws hard outside a real Next.js request. `clientIp()`/the new shared `requestMetadata()` was already framed as "best-effort attribution, evidence not identity" in its own comment — making it genuinely fail-soft (catch → return null) is a real correctness improvement independent of testing, since IP/user-agent were never meant to be load-bearing. `revalidatePath` is different: in production a Server Action is always invoked with a request scope, so a throw there is not a real failure mode worth silencing — that one stays as-is, and the tests swallow the one specific, expected, harmless error instead of changing production code to accommodate a test harness limitation.

**A2P 10DLC brand/campaign registration is explicitly out of code scope.** PRD 05 §6.3 is clear this is a Twilio Trust Hub registration requiring a real legal entity/EIN and review time — "not answerable from public docs," in the PRD's own words, same category as the open questions D-10 defers to an eventual attorney/business review. Nothing to build; recorded here as the operational action item it is, for whoever actually stands up SMS sending (B-032's own successor, once Twilio lands).

**Verified:** 646 unit/DB tests (9 new — `recordConsent`'s write/append/lead-instead-of-tenant/no-orphan-record behavior, and both actions' actual consent-writing wiring called directly with real FormData, not just the shared primitive), 220 e2e, typecheck, lint and build clean. The checkbox and its full disclosure text were checked rendering correctly against a real running dev server and a real checkout session (unchecked by default, positioned right after the phone field); the actual POST could not be driven through it since the checkout form uses React's encoded server-action submission, which isn't replicable via a raw HTTP request — the DB-backed tests calling the actions directly are what actually exercise the write path end to end.

**Left behind:** SMS sending itself — Twilio, quiet hours, STOP/HELP/START, the SMS→email fallback — is Phase 2/a later item; this ships only the consent record that has to exist *before* any of that can. A2P 10DLC registration is a real-world business action, not code, and is not started here (see above). No reader function for current consent state (`currentConsent`-shaped) yet — nothing in the codebase needs to check "is this tenant opted in" until something actually sends SMS, so it wasn't built ahead of that caller. Counter/walk-in move-in (B-039) doesn't exist yet, so this item is online-checkout-only; the same disclosure and recording need to land there too once it does.

---

### B-033 — Portal login ✅ `d6bd421`

The first working sign-in UI either audience has ever had — `/login` serves both, inferring which one from a `?from=` query param (`lib/auth/login-audience.ts`): a signed-out `/admin/*` visit lands here the same way a signed-out `/portal/*` visit now does (`proxy.ts` extended from staff-only to check `/admin` vs `/portal` against the JWT's `audience` claim and redirect to `/login?from=<path>` on mismatch), each with an explicit cross-link to the other. Password sign-in, an "email me a link instead" magic-link disclosure, forgot/reset password, a re-auth page for sensitive actions, and a minimal `/portal` landing page (placeholder content — B-034 replaces it) all built on B-003's existing `Tenant`/`StaffUser` auth primitives, none of which had a UI in front of them before this.

**Decided: re-auth freshness needs its own claim, not the JWT's `iat`.** US-701 wants sensitive actions (B-036/B-041, not built yet) to require a recent sign-in even inside a valid 30-day session. Auth.js silently refreshes a JWT's `iat` on every `session.updateAge` rollover with no real re-authentication involved, so it can't answer "was this session actually established recently." Added `authTime`, set only inside the `jwt` callback's `if (user)` branch — which only runs on a real sign-in — and left untouched on every subsequent refresh. `lib/auth/reauth-freshness.ts`'s `isFreshlyAuthenticated()` is pure (no next-auth import, table-stakes for testing it — see below); `reauth.ts`'s `checkFreshAuth()` wraps it with a real `auth()` call. No caller exists yet — B-036/B-041 are the first — so this ships as a primitive with tests, not a gate anything currently passes through.

**Decided: "emailed code" reuses the existing magic-link mechanism rather than a second, parallel one.** The AC language suggested a one-time numeric code, but a magic link *is* a one-time emailed credential with the same security properties (single-use, 15-minute TTL, `AuthToken` already built in B-003) — building a second token system side by side would duplicate `tokens.ts` for no security gain. `/login/magic` is a GET route handler (not POST+confirm like the reservation-cancel link): consuming it only signs someone in, never destroys anything, and the token is already single-use — nothing here needs a confirmation step.

**Found and fixed: `next-auth@5.0.0-beta.32` cannot be imported at all under Vitest**, not just called. `tests/reauth.test.ts` (originally importing straight from a single `reauth.ts` that also held `checkFreshAuth`) failed at collection time with `Cannot find module '.../next/server'` — next-auth's internals import `next/server` as a bare specifier, which Next 16.2.12's bundler resolves fine (no `exports` field to enforce strictness) but Vitest's own Node-strict ESM resolution refuses outright. This is a real, pre-existing gap between this dependency pair and this test runner — `tests/auth-flows.test.ts` (B-003) never hit it only because it never imports `@/auth` at all. Fixed by treating "does this file import `@/auth`" as a hard file-organization boundary rather than something to work around per-test: `reauth-freshness.ts` (pure) split from `reauth.ts` (next-auth-dependent); `login/actions.ts` (password sign-in, needs `signIn`) split from the new `login/magic-link-actions.ts` (magic-link request, doesn't) — a single shared file poisons Vitest's ability to import *either* export, since ES module imports resolve eagerly at the file level regardless of which export a test actually uses. `signInWithPasswordAction`/`reauthWithPasswordAction`/`reauthWithMagicLinkAction` remain permanently untestable under Vitest for as long as this dependency pair holds (documented in `login-flow-db.test.ts`'s header comment, not silently skipped).

**Found, while chasing the above: `signIn()` itself additionally requires a live Next.js request scope**, independent of the import problem. Running `signInWithPasswordAction` via `tsx` directly (bypassing Vitest to isolate whether the failure was resolution-specific) confirmed the import itself resolves fine outside Vitest, but execution then threw `'headers' was called outside a request scope` from inside next-auth's own `signIn()`. Unlike B-032's `requestMetadata()` fix, this isn't something to make fail-soft — a session actually being established is not a best-effort concern, it's the entire point — so the untestable-under-Vitest boundary was accepted rather than papered over. The underlying mechanism was instead verified with a real HTTP request: curl against `/login/magic` (the one auth entry point that's a plain GET, and so is the only one a raw request can drive — every form here is a React-encoded Server Action POST, the same limitation B-031/B-032 already ran into) proved cookie-setting, the audience-based redirect, and `/portal` rendering all work end to end, plus audience isolation (a tenant cookie correctly bounced away from `/admin`) via a second curl run with a cookie jar.

**Decided: `requestMetadata()` (IP/user-agent from `headers()`) moved out of checkout's private copy into `lib/http/request-metadata.ts`.** Login/reset/reauth all need the exact same best-effort attribution `checkout/actions.ts` already had; promoted rather than re-copied a third time.

**Verified:** 667 unit/DB tests (11 new: 4 pure freshness-boundary tests against `reauth-freshness.ts`, 7 DB-backed tests against the magic-link and password-reset actions — request/reject/complete/single-use-token, run through the actual actions rather than the primitives underneath), 220 e2e (no regressions — `e2e/admin.spec.ts`'s existing unauthenticated-redirect and return-path tests still pass against the widened `proxy.ts`), typecheck, lint and build clean. `signInWithPasswordAction`, `reauthWithPasswordAction`, and `reauthWithMagicLinkAction` could not be unit-tested for the next-auth/Vitest reason above; verified instead by a combination of (a) real curl requests against the GET-based magic-link path proving the underlying `signIn()`-to-cookie-to-redirect mechanism works, (b) next-auth's own documented `AuthError` catch pattern for the password path's error handling, and (c) the throttle-check and `signIn()` call being separately, independently proven correct. The wrong-password/lockout UI path specifically was not driven through an actual browser form submission this session — noted rather than silently assumed correct.

**Left behind:** No caller of `checkFreshAuth()`/`isFreshlyAuthenticated()` yet — B-036 and B-041 are the first sensitive actions that need it. `/portal` is a placeholder landing page only; B-034 replaces its content entirely. Staff password reset/forgot-password reuses the same tenant-facing pages and copy — a staff-specific tone pass, if ever wanted, is cosmetic and not blocking. No account lockout notification email (a lockout is shown in the UI in the moment; it doesn't also alert the account holder that it happened) — not required by any AC read for this item.

---

### B-034 — Portal dashboard ✅ `25abe40`

"What do I owe, when is it due, what's my gate code" (§6.5) — one card per occupying lease (`OCCUPYING_LEASE_STATUSES`, the same set units/inventory already treat as "occupied"), each showing size/rate, current balance, next payment and due date, autopay status (read-only), and the gate code behind a reveal button. All of it reads from data that was already real before this item — `LedgerEntry` for balance, `Lease.billingDay` for the next charge date, `Tenant.stripeDefaultPaymentMethodId` for autopay, `AccessGrant.state` for suspension — `lib/portal/dashboard.ts` is the first thing in the codebase that reads any of them back out.

**Decided: the past-due banner and the suspended gate-code panel are driven by real signals that already exist, not stubbed out.** The backlog row explicitly permitted treating "no delinquency signal yet" as a dependency to leave open (B-057's engine, B-098's suspension automation), but a genuine signal was sitting right there: a positive `LedgerEntry` sum *is* an unpaid balance regardless of what computed it, and `AccessGrant.state` is a real column regardless of what's setting it today (a human, and eventually B-098 — this file doesn't care which). Splitting the messaging on both signals independently, rather than only on lease status, produces three honest states instead of one over-claimed one: balance owed with access still working ("you have a balance, call to pay"), balance owed with access actually suspended (US-702's exact "past due... won't open the gate... Pay $X now" copy, plus D-16's restoration wording), and no balance. The alternative — showing the PRD's suspension copy whenever a lease's *status* was `delinquent` — would have been false today, since nothing currently suspends access automatically.

**Decided: "Pay now" is text, not a button.** US-703/B-035 (the actual payment flow) doesn't exist yet, so a past-due card points to the facility's own phone number (`tel:`, falling back to `SITE.phone` the same way `reservations/page.tsx` already does for a facility with no phone on file) rather than linking to a screen that isn't there. Same reasoning for autopay: shown read-only, no toggle — that's B-036.

**Found and fixed, building this: `empty:hidden` on a live region pulls it out of the accessibility tree while empty, which is exactly the failure mode §6.8 requires the region to avoid.** `GateCodePanel`'s "Copied" region was first written to match `AdminForm`'s own save-state region (`components/admin/form.tsx`) verbatim, including its `empty:hidden` Tailwind class. `hidden` is `display:none`, and an element with `display:none` is excluded from the accessibility tree entirely — not just visually collapsed — so a screen reader has nothing to attach to until the exact moment the click reveals it, which is structurally the same problem as never rendering the region until then, just one layer deeper. Caught because a Playwright `getByRole('status')` query (which respects the same exclusion) couldn't find the element during manual verification (below) even though it was present in the DOM. Fixed by dropping `empty:hidden` — an empty text node has no visible footprint on its own, so nothing was being bought by hiding it. `AdminForm`'s own copy of this pattern was left as-is (out of scope for this item, and its region does have visible padding/border state changes that `empty:hidden` is arguably doing real work for) but is worth revisiting if it's ever touched.

**Decided: the demo seed's one known-password tenant is the delinquent one, not a clean "everything's fine" one.** `dana@demo.example.com` / `demo-tenant-password` (mirroring `DEMO_STAFF_EMAIL`) is bound to the seed's existing `delinquentTenant`, which now also gets a real `LedgerEntry` charge (`rate + protectionCents`, the only ledger write anywhere in the demo seed) so the past-due banner and suspended gate-code panel have a genuine signal to render instead of an empty `$0`. One login now exercises both branches that matter most for accessibility review, the same way `DEMO_STAFF_EMAIL` covers admin. `e2e/sign-in.ts` gained `signInAsDemoTenant`, refactored alongside `signInAsDemoOwner` onto one shared `signInWithPassword` helper rather than duplicating the CSRF/POST dance a second time.

**Verified:** 674 unit/DB tests (7 new — `nextBillingDate`'s month-boundary and year-rollover cases, and `portalDashboardForTenant` against a real lease/ledger/grant: sums correctly, returns `[]` for a tenant with no occupying lease, reads autopay and suspension off real columns, degrades a missing `AccessGrant` row to "not suspended" rather than throwing), 226 e2e (`e2e/portal.spec.ts`: unauthenticated gate redirect, an axe scan of `/portal` on both viewports with the demo tenant's past-due/suspended content actually rendered — not an empty page, and a content assertion for the banner/suspended-panel copy), typecheck, lint and build clean. The gate-code reveal/copy interaction itself — `aria-expanded` toggling, the character-by-character `sr-only` text, the live region actually receiving "Copied" — is **not** covered by the committed suite: the one demo tenant with a known password is deliberately the suspended one, so `GateCodePanel` never renders for it, and no seeded credential is ever genuinely revealable regardless (`ACCESS_CODE_ENCRYPTION_KEY` is unconfigured everywhere in this project by design — `lib/access/secret.ts`'s own "no safe dev fallback" comment — so `codeForLease()` returns `null` for every demo lease as seeded). Verified instead with a real running dev server: a temporary local encryption key, a temporary real encrypted credential swapped onto one non-suspended demo tenant, a temporary password, and a real Playwright browser session signing in through the actual `/login` form, clicking reveal, reading the displayed code and its `sr-only` digit-by-digit text, clicking copy, confirming the live region updated, and confirming the OS clipboard actually held the code — then all of it torn down (temp scripts deleted, `.env.local` reverted, demo data reseeded to a clean state). This is the same gap the demo seed already had before this item (its gate credentials were never revealable either) — not something B-034 introduced, and not fixable without either configuring a real key somewhere or teaching the seed to issue real encrypted credentials, both bigger decisions than this item's scope.

**Left behind (B-035 has since closed the first of these):** "Pay now" is informational only — B-035 wires the actual payment flow. Autopay toggle/card management is B-036. No due-date invoicing engine exists (B-044), so "next payment" is derived from `Lease.monthlyRateCents + protectionCents` and `billingDay` directly rather than a real scheduled invoice — correct today because nothing else computes it either, but worth revisiting once B-044 exists so the two don't quietly disagree. Multiple leases per tenant render as independent cards with no aggregate "total owed across units" — never seen in any demo data, and US-702 describes a single glance per unit, not a rollup. No demo data exercises the "gate code isn't ready yet" (no credential, not suspended) branch specifically — every seeded occupying lease gets a credential at creation, so that path only shows for a lease that's occupying before move-in provisioning has run.

---

### B-035 — Portal one-time payment ✅ `0c3b336`

"Pay $161 now" on the dashboard lands on `/portal/pay` with the full balance already prepared, and confirming in the Payment Element is the second tap — two for the common case, three if the tenant changes the amount (US-703 asks for ≤3, §6.5 for ≤2 from the past-due banner). Behind it: `lib/portal/payment.ts` decides how much money moves, `/portal/pay/done` is the instant receipt, and the ledger is what both read.

**Found and fixed — the real bug in this item: a portal payment would have credited the wrong unit.** `postPaymentToLedger` (B-019) had no way to know which lease a payment was for, so it *guessed*: the tenant's most recently started non-ended lease at that facility. That was correct for every payment that existed until now — a move-in charge happens before its lease exists, and one lease per tenant per facility made the guess unambiguous. B-035 breaks both assumptions at once: the tenant picks which unit to pay, and a tenant with two units at one facility is ordinary. Without a fix, paying off unit A-1 would have credited B-2 purely because B-2 started later, leaving one unit still delinquent and the other in credit. `createChargeIntent` now carries an optional `leaseId` into Stripe metadata, and the webhook posts against it. Two tests lock this down together: one asserts the fallback really does pick the later lease (so the other test can't pass by accident), the other that an explicit lease id beats it.

**Decided: a lease id arriving back through Stripe is checked against the payment's own tenant and facility before any money moves.** It is our metadata and Stripe echoes it faithfully, but a value that has round-tripped through a third party is not something to post a ledger entry on unverified. A mismatch posts nothing and leaves the payment recorded-but-unposted, which the reconciliation report already surfaces — an unposted payment is visible, a misposted one is not.

**Decided: overpayment is refused, not banked.** US-703 allows "a chosen amount ≥ minimum due", but there is no minimum-due concept to compare against until invoicing exists (B-044), and a credit balance would have nothing to consume it and no wording on the dashboard. Refusing also catches the expensive typo — $1,610.00 entered for $16.10. The cap is enforced server-side against the ledger, never against the form: `?amount=999999` on a $161 balance prepares a charge for $161 and says why. Prepayment comes back with B-044.

**Decided: the amount is parsed as a decimal string, not through `parseFloat`.** `Math.round(parseFloat(x) * 100)` is the standard way this goes wrong, and money that rounds is money that is wrong. `validatePaymentAmount` is pure and carries the boundary tests — minimum, over-balance, nothing-owed, and every malformed input including `1e3`, `-5` and `1.2.3`.

**Decided: a one-time payment does not silently store the card.** `createChargeIntent` set `setup_future_usage` on every on-session charge, which is right for move-in (autopay is default-on there, with the §4.6 disclosure next to it) and wrong here — the tenant asked to pay a bill. The new `saveMethod: false` turns it off for this flow; a Stripe CustomerSession still surfaces cards *already* on file, so "saved method or a new one" works without this screen adding, removing or retaining one. Method management and autopay are B-036, with their own disclosure.

**Decided: the receipt reads our Payment row, not Stripe, and says "still confirming" when the webhook hasn't landed.** The webhook is what marks a payment succeeded (§7.3 — the ledger is the tenant-facing source of truth), and the browser can arrive a second after confirming. Asking Stripe directly would show a balance the rest of the portal disagrees with for as long as the webhook is in flight. So the screen has three honest states, and the pending one says the bank has taken it and the balance updates shortly, rather than claiming a payment nothing has recorded.

**Also fixed: a credit balance rendered as "$-39" on the dashboard**, which reads as an amount owed with a typo. Nothing writes a credit today (payments are capped at the balance), but a refund can, so it now renders as "$39 in credit".

**Verified:** 696 unit/DB tests (22 new — the full `validatePaymentAmount` boundary set including the float-rounding cases; `payableLease` refusing another tenant's lease, a nonexistent one and an ended one; `paymentReceipt` scoped so a payment id in a URL cannot read someone else's; and the four ledger-attribution cases above driven through `applyStripeEvent` with realistically-shaped events), 236 e2e (`/portal/pay` gated when signed out, reachable in one tap from the dashboard, axe-clean on both viewports, refusing a lease not on the account, and refusing a crafted over-payment), typecheck, lint and build clean. Manually verified against a real running dev server and the demo tenant: full balance, part payment, over-payment, junk input, below-minimum and someone-else's-lease all render the right amount and the right message, and the receipt screen shows its pending state correctly.

**What could not be verified, and why:** there is still no Stripe account or key anywhere in this project (`tests/checkout-payment-db.test.ts` has said so since B-025), so `paymentsEnabled()` is false and every screen here renders its "call us" fallback rather than a live Payment Element. That means the axe scan covered the fallback, not the Element; and the Element's own rendering, the CustomerSession surfacing a saved card, `confirmPayment`, and a real charge flowing Stripe → webhook → ledger have **not** been exercised against Stripe. The webhook-to-ledger half — the part that moves money in our own records — *is* covered, because `applyStripeEvent` is driven directly with event objects shaped the way Stripe sends them. What remains unproven is the Stripe-side round trip, and it stays unproven until this project has test keys.

**Left behind:** the emailed receipt (§4.8's payment-receipt row) is **B-050**, with the rest of the payment lifecycle notices; this ships the on-screen receipt US-703 calls "instant". Autopay toggle, add/remove/update card and default-method selection are **B-036**. Prepayment/credit balances wait on invoicing (**B-044**). Wallets and Link are whatever the Payment Element offers by default — untested here for the same reason as everything else Stripe-side. An abandoned attempt leaves a `pending` Payment row and an unconfirmed PaymentIntent, which is ordinary for Stripe and reconcilable, but nothing sweeps them yet. No re-auth gate on paying: US-701 scopes that to changing a stored card and move-out, which are B-036 and B-041 — the first real callers of B-033's `checkFreshAuth()`, still unused.

---

### B-036 — Payment methods & autopay management ✅ `5a3e52e`

`/portal/methods`: the cards on file, which unit charges itself, what the next charge will be and when. Recorded as **D-20**, because where autopay lives and what re-auth guards are both things a later item must not quietly reverse.

**Found and fixed — the renter's autopay choice was collected and then thrown away.** Checkout step 5 has shipped an autopay checkbox with its §4.6 disclosure since B-025, writing the answer into `CheckoutSession.data.autopay`. Nothing ever read it. `provisionMoveIn` pulls `protection` and `protectionPremiumCents` out of that same object and simply never looked at `autopay`, so the choice died with the checkout session. There was nowhere for it to go anyway: no lease or tenant column represented autopay at all. What the portal dashboard had been calling "Autopay: On" was `Boolean(tenant.stripeDefaultPaymentMethodId)` — *does this person have a card saved* — which is a different question and gave the wrong answer in both directions. A renter who deliberately opted out still saw On; a renter who opted in saw Off, because `stripeDefaultPaymentMethodId` is only ever set by a `setup_intent.succeeded` webhook, and **nothing in the codebase creates a SetupIntent** — `createSetupIntent` has been dead code since B-019. So no tenant could have been enrolled in autopay by any path, and the screen reporting it was reading an unrelated field.

**Decided (D-20): autopay is a per-lease flag, the card is a per-tenant fact, and both are required.** New `Lease.autopayEnabled`, defaulting false so any path that has not thought about autopay cannot silently enrol someone; `provisionMoveIn` now sets it from the renter's actual choice (`data.autopay !== false`, honouring §4.6/D-11a's default-on). Per lease rather than per tenant because billing runs per lease (B-045), the dashboard already reports it per unit, and a tenant with two units can want one enrolled and one not. Which card is charged stays on the tenant, because Stripe's saved methods belong to the customer.

**Decided (D-20): re-auth gates starting money, never stopping it.** US-701's "sensitive actions re-verify" now has its first real callers — B-033 shipped `checkFreshAuth()` with no consumer, and this is it. Adding a card, changing which card is charged, removing a card and switching autopay **on** all redirect to `/reauth` when the session is older than fifteen minutes. Switching autopay **off** does not, on purpose: requiring a fresh login to *stop* a recurring charge is the one direction where the gate harms the person it protects, since a tenant locked out of their own account would keep being billed. That asymmetry is the part most likely to be "tidied up" later, which is why it is in the decision log rather than only in a comment.

**Decided: the two states that would lie are refused rather than stored.** Turning autopay on with no card on file is rejected outright — otherwise the dashboard reads "On" and the billing day takes nothing, producing a delinquency the tenant did not earn. Removing the last card while any unit is enrolled is refused for the same reason, with the two ways out named in the message. Where a lease is *already* enrolled with no method (reachable today, since move-in enrols by default and nothing yet saves a card), both the dashboard and the methods page say so in as many words instead of showing a confident "On".

**Decided: "we couldn't ask" and "you have none" are different sentences.** `savedMethods` returns `null` rather than `[]` when Stripe is unconfigured, so the page says it can't show saved cards and offers the phone number, instead of asserting the tenant has none.

**Verified:** 709 unit/DB tests (11 new — autopay defaulting off, refusing to enable with no card, enabling and disabling once a card exists, disabling always permitted even with no card, refusing a lease belonging to someone else, the monthly figure including protection rather than rent alone, the dashboard's needs-a-card state, and explicitly that autopay is no longer inferred from a saved card; plus two in `provision-db.test.ts` proving the checkout choice now reaches the lease in both directions). One existing B-034 test was updated rather than worked around: it asserted the old "a saved card means autopay is on" contract, which this item deliberately reverses. 240 e2e (`/portal/methods` axe-clean with the per-unit amount and billing day rendered, and autopay refusing to turn on with no card). Typecheck, lint, build clean; migration applied. Manually verified against a real dev server: the methods page renders the unavailable-cards path, the per-unit autopay block with its amount and billing day, and the dashboard's new Change link.

**What could not be verified, and why:** still no Stripe key anywhere in this project, so `savedMethods`, `setDefaultMethod` and `removeMethod` — all three mostly Stripe calls — ran only down their unconfigured branch. The card list, the detach, the default-method write on Stripe's side and the last-card-on-autopay guard (which needs a real list of length one) are **unproven against Stripe**. Separately, the re-auth redirect itself is not exercised end to end: every e2e session is minted seconds earlier by the sign-in helper, so it is genuinely fresh and the gate correctly declines to fire — driving the stale branch needs either a >15-minute-old session or a forged `authTime`, and the decision it turns on is already covered directly by `tests/reauth.test.ts`. The first attempt at that e2e test asserted the redirect *would* fire and failed, which is how the fresh-session behaviour got confirmed rather than assumed.

**Left behind:** **adding** a card has no in-portal flow — the page tells the tenant to pay a balance with the card or call. Wiring `createSetupIntent` (still dead code) into a real "add a card" screen needs the Payment Element and therefore a Stripe key to be worth building or testing; it is the obvious first thing to finish once keys exist. Bank accounts/ACH (US-704 says "cards or bank accounts") are card-only here. The autopay pre-charge email (D-11a, "two days before") is promised in this page's copy but sent by **B-050**; the copy is a commitment that item has to keep. Nothing charges anything automatically yet — **B-045** is the nightly run, and D-20 records what it must read.

---

### B-037 — Portal documents & contact info ✅ `f1957be`

Three new portal screens — documents and payment history, contact details, and the address of record — plus `/confirm-email` for the one flow that has to work without a session. New `TenantAddress` model (**D-21**) and a new `email_change` token purpose.

**Decided (D-21): the address of record is an append-only history; the `Tenant` address columns become a cache of its newest row.** US-13 is explicit that the current address must be derived and never overwritten, and the reason is evidentiary rather than tidiness — on day 40 of a lien cycle, "which address did the notice go to" has to be answerable from records. Making the columns a pure derivation would have meant rewriting every existing reader in this item, so they are kept in step inside the same transaction, with the history authoritative. Each row holds the address as of that moment plus source and actor; the previous row *is* the old value, so an old/new pair per row was rejected as two things that can disagree about one fact. Existing tenants were backfilled with an `import` row in the migration so "newest row" is true from the first read. A no-op save writes nothing — re-saving the same address should not look like the tenant moved. Returned mail flags the row that came back without clearing the address: known-bad is not the same as unknown.

**Decided: the email-change link goes only to the new address, the notice only to the old, and nothing is written until the link comes back.** Changing the email changes what signs in, so this is an account-takeover path if done on trust. The pending address lives on the token and nowhere else. The link proves the requester can receive mail at the new address — sending it to the old one would prove nothing about the new. The old address instead gets a **linkless** notice: its value is that someone who did not ask finds out while the change still has not happened, and a one-click "cancel" control there would be equally usable by an attacker who already has that mailbox. Uniqueness is re-checked at confirmation as well as at request, because the link is good for 24 hours and the address can be taken in between — otherwise the unique constraint surfaces as a crash on a link the tenant was told to open.

**Decided: `/confirm-email` sits outside `/portal`, and that placement is the point.** `proxy.ts` gates `/portal/*` on a tenant session, but the person opening this link is proving mailbox control, which is a different claim from being signed in — requiring both breaks the ordinary case of opening it on a phone with no session. The token is the credential. The page also never names the account the link belongs to, so a leaked link does not disclose the address it was changing. It was first written under `/portal/contact/confirm` and moved once that contradiction was noticed.

**Decided: the portal shows only what the tenant is a party to.** The document store (B-023) is shared — the same leases carry lien evidence, notices and inspection photos, which are the operator's file, not the tenant's copy. `portalDocuments` filters to `lease` and `receipt` types, and `portalDocument` re-checks ownership by joining back through the tenant's own leases, because `Document.subjectId` is a loose string by design and cannot be constrained to a tenant any other way. A document id in a URL is never sufficient on its own, and there is a test for each half.

**Found and fixed: adding an enum value silently obligated an unrelated email.** `sendAuthEmail`'s `SUBJECT`/`INTRO` maps were typed `Record<AuthTokenPurpose, string>`, so introducing `email_change` made them incomplete — caught at compile time. The fix was to narrow that function to the purposes it actually fits (`magic_link`, `password_reset`) rather than invent copy for a purpose that sends two different messages to two different addresses. Adding a future purpose that does not belong there is now a compile error instead of a wrong email.

**Found and fixed: the contact forms reported success over stale data.** Neither action called `revalidatePath`, so saving an address showed the confirmation while the page around it still rendered the previous values — the previous-addresses list in particular did not appear until a manual reload. Caught by the e2e test asserting the history became visible, not by reading the code.

**Verified:** 735 unit/DB tests (18 new — address validation boundaries; history append/derive/no-op/actor/normalisation/returned-mail; the full email-change set including *not applied until confirmed*, taken-address at request and again at confirm, single-use, and an unissued token; and both document-scoping cases), 249 e2e (axe-clean on `/portal/documents` and `/portal/contact`, address history surviving a save, an email change not applying, and a bad confirmation link changing nothing). Typecheck, lint, build clean; migration applied and backfilled 56 rows. `tests/schema-invariants.test.ts` required a recorded justification for a model without `facilityId`, which `TenantAddress` legitimately is — an address belongs to a person, like the `Tenant` and `Consent` rows beside it.

**Found in the test environment, not the product: killed e2e runs leak inventory.** Ten checkout/reservation tests began failing on a facility whose 60 units all read `reserved` while zero reservations and zero leases existed. The cause was 60 `active` checkout sessions whose 30-minute locks had lapsed hours earlier: `globalTeardown` releases them, but it only runs when a suite completes, and several runs today were killed mid-flight (the dev server died under load). Locally nothing else sweeps — in production the hourly cron does, and `expireReservations`/`expireCheckoutSessions` both recompute unit status correctly, so this is harness debris rather than a defect. Released via the same `expireCheckoutSessions` call the teardown makes. Worth knowing for the next session: **if checkout or reservation tests start failing for no reason, check for lapsed active checkout sessions before suspecting the code.**

**Left behind:** documents are HTML, not PDF — B-023 settled that the canonical form is the markup whose hash was signed, so US-705's "download PDF" is a rendering step nobody has built; the UI says "view" rather than promising a download that arrives as a web page. **No receipt documents are generated at all** — the payments list is read from `Payment` rows, which is the honest version until **B-050** produces the receipt itself; monthly statements likewise. Insurance/protection tier changes and proof-of-insurance upload (also US-705) are not here — the first needs a billing-cycle effective date (B-044) and the second needs a blob store, which `Document.storageRef` is reserved for and nothing writes yet. Counter-side address edits and the returned-mail task are **B-038**/**B-095**; `recordAddressChange` and `flagReturnedMail` are the entry points they must use rather than writing the columns. The `import` source value exists for the backfill and has no importer behind it.

---

### B-038 — Admin tenant profile ✅ `e28f7a8`

"Any staffer can pick up any conversation": search by name/phone/email/unit number, then one profile — contact, address history, every lease and its balance, immutable notes, logged documents, and a shell of what has been sent. Counter-side address edits go through the exact same `recordAddressChange()` D-21 built for the portal in B-037, source `counter` instead of `portal`.

**Decided: `tenants:edit` is a new permission, separate from `tenants:view`.** The catalog had only `tenants:view`, which `bookkeeper` also holds — and bookkeeper's own description is "read-only... no ability to mutate anything." Reusing `tenants:view` for contact edits, notes, and document logging would have contradicted that role on day one. `tenants:edit` is granted to counter, manager, regional, and owner; bookkeeper and the system actor stay view-only. Authorization for both permissions runs through a single `assertTenantAccess()`: since `Tenant` itself carries no facility (a person can hold leases anywhere), "can this staffer see this tenant" is answered by intersecting the tenant's own lease facilities against the actor's assignments — a manager assigned only to Facility B gets a `ForbiddenError` for a tenant who has never leased there, even if they can guess the tenant id.

**Decided: "delinquency status, shown prominently" is the same honest ledger signal B-034 already established for the portal, not a fabricated status label.** `Lease.status` has a real `delinquent` enum value, but nothing in this codebase has ever set it — that's B-057's job, and grepping for `status: 'delinquent'` outside the demo seed confirms it. Labeling a lease "Delinquent" from a field nothing writes would be more confident than the system actually is. The profile instead sums the ledger across every lease the tenant holds and shows "Balance due: $X" when it's positive — real money, not a guessed stage.

**Decided: documents can be logged with no bytes, and that's not a placeholder — it's the honest ceiling.** `lib/documents/store.ts`'s own comment has said since B-023 that no blob store is configured and inventing a filesystem path wouldn't survive a serverless deploy — the same wall B-037 hit for the portal's document view. `logManualDocument()` records what a staffer actually has (type, title, a typed note — "TX DL ending 4821, verified in person") without pretending a file is attached. `storageRef` stays null; the UI says so ("nowhere to attach a file yet") rather than rendering an upload control that goes nowhere.

**Found and fixed: a full-name search would have returned nothing, ever.** The first version matched the whole query string against `firstName`/`lastName` independently via `contains` — so "Ada Renter" never matched anything, because neither column contains the two-word string; each only holds one word of it. Caught by the first test run of `searchTenants`, not by reading the code. Fixed by splitting the query on whitespace and requiring every word to match *some* field (name, email, phone, or unit number) rather than the whole query matching *one* field — which is also what makes a single-token phone or unit-number search keep working unchanged.

**Found and fixed: a `<form>` nested inside a `<p>` broke hydration.** The pin/unpin control sat inside the note's byline paragraph; a `<form>` is block-level and cannot legally nest inside a `<p>`, so the browser silently closed the paragraph early and re-parented the form, producing a client/server DOM mismatch. Caught by Playwright surfacing the hydration warning during e2e, not by axe (which only ever sees a settled DOM) or by reading the JSX. Fixed by making the byline a `<div>`.

**Verified:** 755 unit/DB tests (20 new — search scoping across facilities and the full-name fix above; profile access refused for a staffer with no lease-facility overlap; balance summed across two leases at two different facilities; contact/address mutations refused for a view-only bookkeeper and permitted for a manager, each audited or, for the address, recorded in `TenantAddress` with `source: 'counter'`; notes immutable-content-but-pinnable, sorted pinned-first, refusing to pin a note that belongs to someone else; and logged documents with no bytes, audited, appearing alongside real lease documents), 264 e2e (both viewports; unauthenticated gating; axe-clean search and profile pages; search-to-profile in one click; adding a note and seeing it immediately; a blank-title document log refused server-side — proven by a single space, which passes the browser's native `required` check but not the server's trim). Typecheck, lint, build clean; two migrations applied (`TenantNote`, plus the RBAC catalog re-seed).

**Environment note, not a regression:** the full e2e suite again failed en masse under Playwright's default parallelism — the same dev-server-dies-under-load pattern B-037's entry already recorded, this machine currently running several other projects' dev servers alongside this session. A clean, complete pass (264/264) at `--workers=1` confirms it's contention, not a defect; the recorded advice stands — check for that before suspecting the code.

**Left behind:** real file upload needs a blob store decision this project hasn't made (same gap B-037 already left open for the portal side) — `logManualDocument` is the honest interim, not a placeholder waiting on this item specifically. No leases list of its own; `/admin/leases` still falls through to the generic placeholder route, since every lease a staffer needs today is visible inline on the tenant profile. Communication history is read-only, exactly the "shell" the backlog asked for — no resend, no filter, no drill-in. Portal-side contact edits (B-037) remain unaudited to `AuditLog`; only the admin/counter path writes `tenant.contact_updated`, since a tenant editing their own record has no "who did this to someone else" question to answer. `LeaseHold`'s banner has nothing to render yet — B-096 owns both the model and wiring it onto this page.

---

### B-039 — Walk-in (POS) move-in + manual payments ✅ `ffd26ec`

The counter: record a cash, check or money-order payment against a tenant's unit, and start a walk-in move-in. Plus the cash-accountability block the backlog row put the emphasis on — attribution, gapless receipts, a manager threshold, and a printable daily deposit slip. Recorded as **D-22** for the numbering mechanism, because it is the kind of thing a later session would "tidy" into a sequence and silently break.

**Decided (D-22): gapless receipt numbers come from a per-facility counter row incremented inside the payment's own transaction.** Gapless is strictly stronger than unique, and the difference is the whole requirement: a Postgres sequence does not roll back, so an aborted transaction burns a number and leaves a hole an auditor will ask about. The counter is bumped by `INSERT … ON CONFLICT DO UPDATE … RETURNING` in the same transaction as the payment and the ledger entry — the row lock serialises concurrent staff, and a rollback returns the number to the pool. Three tests hold it down: numbering starts at 1 per facility, a transaction that fails *after* drawing a number leaves the counter untouched (and the next real payment takes that number), and five concurrent payments come back with five consecutive numbers and no duplicates.

**Decided: only counter-taken payments get a receipt number.** The online Stripe path leaves it null. Numbering web rentals into the same series would put holes in the counter's receipt book wherever a card payment landed — technically still unique, but not the thing "gapless" is for.

**Decided: attribution is read from the session actor and is impossible to supply from the form.** `Payment.receivedByStaffId` is set from `actor.staffUserId` for cash, check and money order, and left null for card — a card taken online genuinely has no one behind a counter, and requiring a name there would be a lie rather than a control. This is one of the four columns PRD 02 §6.1 flags as having to exist *before* the data does; it cannot be reconstructed later.

**Decided: a card cannot be recorded by hand.** US-32 lists card among the counter's methods, but there is no terminal integration and no Stripe key in this project — a hand-typed card payment would create a ledger entry with no money behind it. The screen says so plainly and points at the online payment path rather than silently accepting it.

**Decided: the manager threshold is a rank check, not a fourth `MonetaryAction`.** The existing monetary-authority machinery grades *giving money away* — waivers, refunds, credits — each with its own per-role limit column. Taking a large amount of cash is a supervision threshold, not an authority limit, so bolting it onto that enum would have meant new limit columns whose meaning did not match. It compares the actor's rank at that facility against `manager` (20) once `cashNeedsApproval` fires, and fires **at** the configured amount rather than strictly above it, so a $500 threshold catches a $500 note instead of being the one amount that slips through.

**Decided: the day's summary is a read over `Payment`, and the boundaries are facility-local.** D-1 keeps drawer sessions (float, close-out, over/short) in Phase 2 — B-078 — and the backlog row says so explicitly. Building a "close-out" here that reconciled against nothing counted would look like accountability without being it. The day window is computed from the facility's own timezone via `Intl`, not a fixed offset: a payment taken at 7pm in Austin belongs to that day's deposit, and a UTC boundary would file it under tomorrow. Tested across a real DST change, where the local day is 25 hours long.

**Decided: the walk-in move-in reuses the customer wizard rather than cloning it.** "Start move-in" quotes the in-store price (D-15's distinction from the online one), calls the same `startCheckout` the website uses, and hands off to `/checkout`. The lease, e-signature, protection choice and gate-code issuance already live there; a staff-only parallel flow would be a second set of rules to keep in step, and they would drift.

**Verified:** 782 unit/DB tests (27 new — the pure tender arithmetic including change, exact cash, under-tender, missing check number, non-integer and non-positive amounts, and the "never invent change for a cheque" rule; then against real rows: attribution from the session, ledger posting as a negative amount, refusing a lease at another facility, refusing an unassigned facility, refusing a hand-typed card, the threshold stopping counter staff and admitting a manager, cheques not gated by it, all three gapless properties, and the daily summary's totals, empty day and access check), 280 e2e (both viewports, axe-clean on both new screens; cash recorded with a receipt number and correct change; a check with no number refused; under-tendered cash refused; the deposit slip showing who took each payment). Typecheck, lint, build clean; migration applied.

**Found: the recurring e2e mass-failure has a cause and a fix.** B-037 and B-038 both recorded suites collapsing with `ECONNREFUSED` and blamed load. The dev server was in fact being **SIGTERM'd** (`code 143`) — killed between shell invocations rather than crashing. Two changes make it reliable: run against a **production build** (`npm run build && npm run start`), which has no HMR or on-demand compilation and uses far less memory, and start the server and run the suite **in a single shell invocation** so nothing reaps it in between. That combination produced 280/280 with **zero** connection errors at `--workers=2`, in 2.0 minutes — against 4.8 minutes and hundreds of failures for the dev-server path. Worth using for every future item: the previous advice ("check for lapsed checkout sessions") was a real but separate issue, and this is the one that was actually costing whole runs.

**Left behind:** no drawer session — no opening float, no close-out count, no over/short. That is **B-078** and D-1 keeps it in Phase 2; this item deliberately stops at a read over `Payment`. Card at the counter needs a terminal integration (and a Stripe key) that this project does not have. Printing is the browser's — the slip is styled with `print:hidden` on its controls, but there is no dedicated print stylesheet or PDF, and no emailed receipt (**B-050** owns the receipt document itself, as it has since B-035). Voiding a receipt is not built: the numbering discipline supports it — numbers are never reused and payments are never deleted, so a future void is a visible marked number rather than a hole — but the void action and its reason code belong with refunds in **B-048**. Merchandise sales (locks, boxes) are B-078's. `ach` is excluded from the counter methods on purpose: nothing in this system originates an ACH debit, so a hand-typed one would be a claim we cannot substantiate.

---

### B-040 — Admin move-out ✅ `de72721`

Ending a lease: preview the settlement, close it, release the unit to `maintenance`, revoke the gate, and send the CN-8 confirmation. Plus the former-tenant AR list and the "verified empty and clean" check that puts a unit back on sale.

**Decided: the settlement is computed once, in a pure function, and previewed before anything posts.** `settleMoveOut` takes every input explicitly — balance, rate, paid-through, move-out date, whether the facility prorates, the write-off threshold — and the screen renders exactly what the action re-runs. 3.3.4 (Error Prevention, Financial) asks for the figure to be reviewable before the act that commits it; computing it twice in two places is how the reviewed figure and the posted one drift apart. Proration rounds **down** in both directions on purpose: a refund never pays out a fraction we did not collect, a charge never bills a fraction of a cent, and because both use the same floor a reconciliation never finds a stray cent.

**Decided: three date fields, not one.** `noticeGivenAt`, `paidThroughDate` and `moveOutDate` answer three different questions that routinely disagree — when the tenant said they were going, the last day they had paid for, and the day they actually left. Collapsing them into `endDate` loses the ability to tell a proper notice from an abandonment, which is exactly the distinction a lien file needs later. `moveOutDate`/`paidThroughDate` are `@db.Date` (registered in the schema-invariants test): a move-out is a facility-local calendar day, and a timestamp would imply a precision the fact does not have.

**Decided: a short notice is reported, never blocked.** `noticeShortfallDays` surfaces "this is 6 days short of the notice the lease asks for" on the screen, and the move-out proceeds. Staff complete move-outs for tenants who gave no notice constantly, the lease's remedy is a charge rather than a refusal, and blocking the workflow would only teach people to back-date the notice field — which would destroy the very record the field exists to keep.

**Decided: the manager gate is on *closing a lease that still owes*, not on the write-off.** A residual at or below the facility's threshold can be written off by anyone with a reason code (audited as `balance.written_off`). Above it, the lease cannot be closed at all without a manager — because that balance does not disappear, it lands on the former-tenant AR list, and leaving a debt behind is the act that deserves supervision. A credit balance is never "written off": that would be keeping money we owe back, and there is a test that says so.

**Decided: the unit goes to `maintenance`, and only a separate human act makes it rentable.** Straight to `available` is how a unit rents on Saturday with the last tenant's padlock still on it. `markUnitReadyToRent` records the named "verified empty and clean" fact rather than a generic status override, and `/admin/units/ready` lists what is waiting. The general units screen can still change status with a reason code — this is the specific confirmation the AC asks for.

**Decided: access is revoked outside the move-out transaction, and only when it was the tenant's last lease at that facility.** PRD 03 US-2's AC1 exactly: someone with two units keeps their code for the one they still have. It runs after the commit for the same reason B-026's provisioning does — the lease *has* ended, and a slow or offline gate adapter must not roll that back.

**Found and fixed two real bugs in shared fixtures, both caught by tests rather than by reading code.** First: **the demo seed had stopped being re-runnable.** `TenantNote.tenantId` is `onDelete: Restrict` (B-038) and the seed's teardown never deleted notes — so the first time the note e2e test passed, the seed began failing forever, which is the worst possible moment for a fixture script to break. Second, and worse: **the seed wrote `Tenant.addressLine1` directly and created no `TenantAddress` row** — precisely the gap D-21 warns about ("a path that writes them directly leaves the history with a gap"). Every demo tenant had an address with no history behind it. Both fixed in the seed, which now records the address through a history row sourced `import`, like the migration backfill.

**Found and fixed, in my own work: an e2e test that quietly drained the demo tenant's balance.** B-039's POS test records a *real* $20 payment, and it was aimed at the past-due demo tenant that B-034, B-035 and B-038 all assert on. Nine runs later that $161 balance was **−$19**, and three unrelated suites started failing for reasons that had nothing to do with their own code. Fixed by adding `DEMO_POS_TENANT_EMAIL` — a separate demo tenant whose balance nothing else depends on — and pointing the money-moving tests at it. The rule this establishes: **anything in the suite that mutates money must aim at a fixture nothing else asserts on**, because unlike a reservation there is nothing that gives the money back.

**Verified:** 813 unit/DB tests (31 new — the pure settlement set including proration boundaries, month length, rounding, no-credit-when-they-overstay, threshold-exactly, never-write-off-a-credit and the notice-shortfall cases; then against real rows: preview writes nothing, the lease ends with the proration credit posted and the unit in `maintenance`, `lease.moved_out` emitted with the settlement, counter staff blocked over the threshold and a manager admitted, a write-off clearing the balance and refusing without a reason code, access revoked on the last lease but preserved while another remains, the ready-to-rent act, an abandonment that forgives nothing, and the AR list including only leases that still owe). E2e: 98 passing across every spec my changes touch (portal, tenant profile, POS, move-out, admin) and 193 across smoke and a11y, run in slices; typecheck, lint, build clean; migration applied and the CN-8 template seeded.

**On the e2e environment:** B-039's advice — production build, single shell invocation — held for slices but the *whole* suite in one go was still killed twice by `SIGTERM` from outside the run (`EXIT:143`, zero connection errors, tests passing right up to the kill). Running it in two slices is what completed reliably here. One smoke test (`reserving a unit holds it`) failed once under `--workers=2` and passed in 3.9s in isolation with 46 units free, so that one is parallel-load flake rather than availability.

**Left behind:** no refund is actually *paid* — a credit balance is computed and shown, and moving money back out is B-048's (refunds), which also owns voiding and after-the-fact write-offs. The move-out confirmation email is wired (template, rule, and a `billing.settlement_line` extender reading the event payload so the sentence cannot drift from what staff saw), but sending still depends on the hourly cron and a configured provider, like everything else on the comms engine. "Optional photo" on the empty-and-clean check needs the blob store this project still does not have. `paidThroughDate` is never *set* by anything — billing (B-044) is what will maintain it, so proration only has something to work with once that exists; until then the facility default of no-proration is also the honest one. The tenant-facing move-out *request* (with its own notice validation and cancellation) is **B-041**, which builds on this.

**Correction, found 2026-08-05 while starting B-041:** access is revoked **immediately** when the move-out transaction commits, not deferred to "the move-out date at facility close, in facility-local time" as this item's own backlog row and PRD 02 US-14's own AC both specify. Immediate revocation is the safe direction (a tenant loses access sooner, never later) and is not a security problem, but it is a real deviation from the written AC that this entry did not disclose at the time. Not fixed yet — noted here rather than silently, pending a decision on whether "facility close" should be a scheduled job (matching the `SCHEDULED_JOBS` pattern B-018/B-020 already use) or a same-day deferred check.

---

### B-095 — One task queue, not seven ✅ `0f6ec12`

The shared `Task` entity, built now rather than left as the gap it had been since B-026: one table, a loose `type` string resolved against a catalog for its label/required proof/audit sensitivity, idempotent creation on `(type, entityId, businessDate)`, a mobile-first "my day" list with text-based overdue escalation, a regional roll-up, and proof-gated completion. Recorded as **D-23**.

**Decided (D-23): built out of turn, ahead of B-041.** The backlog itself orders B-095 (row 25a) before B-026 (row 26), which already depends on it — it was skipped when B-026 shipped and every later item that needed it (B-046, B-054, B-059, B-060, B-065, B-097) noted the same gap in its own "left behind" rather than closing it. B-041 is the first item whose own description requires "a Task view" outright, not "an event with no consumer" — building around that again would have meant a third bespoke queue, exactly what this item's own name argues against.

**Decided: `type` is a string resolved against a data catalog, matching `Document.type`'s own precedent.** `packages/core/tasks`'s `TASK_TYPES` is the single place that says what a task means, what proof completing it needs, and whether completion gets audited — a new task type (B-059's tracking numbers, B-060's walkthrough photos) is a catalog entry, not a migration or a change to the completion logic.

**Decided: two real consumers were wired immediately, not left as an empty table.** Shipping infrastructure with nothing calling it is exactly the "fake capacity" this project has avoided everywhere else. `requestDownstream` (checkout provisioning) now creates a `move_in_provisioning_failed` task and *re-throws* on failure — both the task and Stripe's own webhook retry get a chance to resolve it, whichever comes first, closing the gap B-026's own comment named at the time: "a failure here becomes a Task (B-095) once it does." `flagTenantAddressReturned` (B-038, already reachable from a shipped button) now creates a `returned_mail_review` task, closing PRD 02 US-13's own AC ("creates a task... rather than sitting in a folder") that had shipped without it.

**Found and fixed: `missingProofFields` failed open for an unregistered type, the opposite of its own doc comment.** The first version computed `required = spec?.requiredProofFields ?? []` — for an unknown `type` string, `required` was empty, so nothing was ever "missing" and a task of a typo'd type could be completed with zero proof. Caught by a test asserting the documented fail-closed behavior and getting `[]` back instead of the expected required fields. Fixed with a `DEFAULT_REQUIRED_FIELDS = ['note']` fallback, so an unrecognised type still demands the universal floor rather than nothing.

**Decided: permissions reuse `tenants:view`/`tenants:edit` rather than a new `tasks:*` pair.** `nav.ts` already carried this exact call as a comment ("No Task entity yet (B-060) — gated the same as Tenants for now") — this item makes the entity real without deciding a permission shape ahead of the six more consumers still to land, several of which may want a materially different one (a maintenance ticket probably should not need `tenants:edit`).

**Found and fixed, twice, while writing the e2e coverage: two ways a shared, persistent demo fixture breaks a task-completion test.** First, the demo seed's teardown never deleted `Task` rows at all — since `Task.facilityId` is `Restrict` and the demo facility is never truly deleted once it owns any Restrict-blocking row (the same posture already established for `AuditLog`), every task ever created against a demo tenant became a permanent, unremovable-by-reseed row, accumulating forever across every future reseed and showing up as stale garbage next to whatever the current run created. Fixed by adding `Task` to the teardown's delete list. Second, `returned_mail_review`'s idempotency key (`type` + tenant id + business day — correct, and separately asserted with disposable fixtures in `tests/tasks-db.test.ts`) means the real UI flow that creates and completes one can only be driven once per calendar day against the one demo tenant with a known password, and mobile-chrome/desktop-chrome running that flow concurrently against the same shared row is a genuine race, not flakiness — whichever finishes first removes the task the other is still asserting on. Fixed by skipping the test on all but one project (with the reasoning in a comment, not just the skip) and replacing a bare `.click()` with an explicit wait for the button's own disappearance before navigating away, after the same race — this time against the rest of the suite's load rather than a sibling project — surfaced a step that had been resolving before its server action actually finished.

**Verified:** 839 unit/DB tests (26 new — the catalog's proof-gating and fail-closed behavior including the bug above; then against real rows: create/idempotent-redeliver/different-business-day/concurrent-race-safe, overdue computed correctly against a backdated task and not against today's, facility-scoped visibility and rollup counts excluding a facility the actor cannot see, complete refusing missing proof and a view-only actor, auditing a sensitive type and not an ordinary one, assign/unassign, and both real consumers exercised through their actual call sites — a mocked provisioning failure creating a task and still re-throwing, and the returned-mail flag creating one through the real admin function). E2e: the full suite clean at `--workers=2` after the two fixes above (one pre-existing flake in an unrelated smoke test, confirmed by isolation as parallel-load, not a regression); typecheck, lint, build clean; migration applied.

**Left behind:** no `cancelled` status is ever set by anything yet — the enum value exists for whichever future consumer needs to withdraw a task rather than complete it (a reversed move-in failure, say), and none has needed it yet. No UI for reassigning a task to someone other than yourself/no-one — `assignTask` exists and is tested, the list just does not expose a picker. The roll-up is counts only, no drill-in list per facility beyond the link back to that facility's own "my day" (which the switcher override makes reachable without losing your default). Overdue escalation is text-only, matching 1.4.1, but there is no sort-overdue-first toggle — the list is already ordered oldest-business-day-first, which puts overdue items at the top structurally rather than by a separate flag.

---

### B-041 — Portal move-out request ✅ `62bd5c2`

Pick a unit → pick a date → see what it settles to → confirm, gated by US-701's re-auth rule. Nothing here finalizes a lease — that stays entirely B-040's, behind a human actually verifying the unit is empty and clean. Recorded as **D-24**.

**Decided (D-24): no new schema.** A pending request is `Lease.status = 'active'` with `moveOutDate`/`moveOutReason`/`noticeGivenAt` set — the exact three columns B-040 already built for the *finalized* case. `status` alone tells the two states apart (`ended` = finalized, `active` with a date = pending), so cancelling a request is just clearing those same three fields back to null, symmetric with never having asked.

**Decided (D-24): the portal enforces the notice-days policy as a hard floor; the staff screen (B-040) still only reports a shortfall.** Deliberately asymmetric, not an oversight — staff route around real-world urgency (a tenant already gone, an abandonment with no notice at all) constantly, which is exactly why B-040 treats a shortfall as informational. A tenant scheduling ahead through self-service has no such urgency, so the date input simply refuses to offer a date the policy forbids, and `requestMoveOut` refuses server-side too if one arrives anyway.

**Decided: B-095's Task queue gets its intended first outside consumer, and its first real use of `cancelled`.** `requestMoveOut` raises a `move_out_request_review` task the moment the tenant confirms; `cancelMoveOutRequest` withdraws it via the new `cancelOpenTask` primitive rather than leaving staff a task about a request that no longer exists — B-095's own "left behind" named this exact gap (`cancelled` set by nothing yet) three items ago. Finalizing on the staff side (B-040's existing screen, enhanced to default its date picker to what the tenant already asked for and to show a "the tenant requested this" banner) completes that same task directly, because the real evidence that the request was handled is the move-out actually finishing — not a second proof-note staff would have to type for something they just did.

**Decided: the confirmation email says a date, not a dollar figure.** `lease.move_out_requested` (new event, new template, same rule/template pipeline B-030 built and B-040 already used for the finalized confirmation) tells the tenant their request was received and when they can expect their account to close — no settlement amount, because nothing is locked in until staff finalize, and a balance that changes between now and then would make the email wrong the moment it changed.

**Verified:** 855 unit/DB tests (14 new — minimum-date computed from the facility's own notice policy; preview settling against the tenant's own lease and refusing one that is not theirs; request scheduling the lease, raising the task, and emitting the event; refusing a too-soon date and a second request while one is pending; cancel clearing the fields, withdrawing the task, refusing when nothing is scheduled and once the date has already arrived; and the staff-side pickup — the preview showing the tenant's requested date, and finalizing completing the same task). E2e: gated route, axe-clean, and the notice-floor/preview rendering confirmed on the demo tenant — deliberately **read-only** against that fixture (see below); full suite otherwise clean (one pre-existing parallel-load flake, confirmed by isolation, unrelated). Typecheck, lint, build clean. No migration — see D-24.

**What the e2e suite does not cover, and why:** the actual request→task→cancel round trip is not driven through the browser against the shared demo tenant. That tenant's lease balance and status are asserted on directly by B-034, B-035, and B-038's own e2e specs — scheduling a real move-out against it would change `Lease.status`-adjacent state those suites depend on, the same class of shared-fixture mistake B-039's POS test made against this exact tenant's ledger balance two items ago. The full transactional behavior — including the parts a browser session can't easily observe, like the task's business-date idempotency — is covered directly and repeatably in `tests/move-out-request-db.test.ts` against disposable fixtures instead.

**Left behind:** the "unit vacant and clean" verification itself is still a person walking over and looking — there is no photo-upload or checklist attached to the task beyond the free-text note every task type carries, same gap B-040 already left open pending a blob store. No SMS confirmation, only email — matching every other transactional send in this project, which is email-only until a provider is configured. A tenant cannot change the date on a pending request without cancelling and re-requesting; an "edit" path was considered and skipped, since cancel-then-request is the same number of taps and reuses the identical validation rather than a third code path for "change." Staff have no button to schedule a move-out *for* a tenant through this flow — that is what B-040's own screen already does, deliberately kept separate per D-24.

---

### B-042 — MVP reporting ✅ `f0f8b7b`

The shared `metrics` module, the portfolio dashboard, the rent roll (which doubles as the rate-variance worklist), the move-in/move-out report US-39 called orphaned, and CSV export. Recorded as **D-25**, because the definitions are the deliverable — the screens are a thin rendering of them.

**Decided (D-25): six judgement calls, each stated rather than inferred, each with a failure it prevents.** `rentable` excludes `unrentable` and *includes* `maintenance` — excluding it would flatter occupancy by exactly the units an operator is slowest to turn around. `overlocked` counts as **occupied** — nothing produces it until B-057, but an occupancy that forgot it would silently *drop* as tenants went delinquent, reading as units emptying when nobody moved out. Economic occupancy is collected ÷ gross potential **at street, across every rentable unit** — measuring against occupied units only lets a site read "97% economically occupied" with a third of its tenants not paying. `daysPastDue` anchors to the **oldest unpaid invoice's original due date** — the AC is emphatic and the reason is concrete: retries land on +1/+3/+5 (US-20), so anchoring to an attempt resets the clock every retry, and a 40-day delinquency would report as 2 days and never reach the day-6 access suspension or any lien step. AR buckets put exactly 90 in `d61to90`, so no day belongs to two buckets or none. And roll-ups **sum the components and recompute the ratio** rather than averaging ratios.

**The roll-up AC is a test, not a sentence.** §4.11 asked for "roll-up equals the sum of the facility reports with no double counting — asserted in a test, not stated in a document." `tests/metrics.test.ts` asserts a rolled-up result equals the same units computed as one set, field by field, and separately that a 100%-occupied 4-unit site rolled up with a 50%-occupied 400-unit site gives 50.2% rather than the naive 75% average.

**Decided: the adapter fetches and shapes; it never computes.** `lib/admin/reports.ts` reads rows and hands them to the core module — every ratio, bucket and count comes back from `@storage/core/metrics`. The rent roll's *sort order* comes from `rateVariance` too, because "sorted by gap" is part of the rate-variance definition (§4.11) rather than a choice a page makes.

**Decided: the CSV is generated from the identical call as the screen.** US-39's "CSV export matching on-screen data exactly" is enforced structurally — same function, same arguments, same rounding helpers — rather than by a second query shaped close enough. An e2e test reads the roll-up percentage off the rendered table and asserts the exported row carries the same figure.

**Found while writing it: the CSV escaper was open to spreadsheet formula injection.** A tenant whose name begins `=`, `+`, `-` or `@` would be interpreted as a live formula the moment staff opened the export in Excel — a real attack against a file staff are told to trust. Guarded by prefixing a tab; the first version left the guarded value *unquoted*, which a spreadsheet may trim on import and hand the formula straight back, so guarded values are now always quoted. Both behaviours are tested.

**Found and fixed: a latent timezone bug in B-095's own test suite, three items old.** `tests/tasks-db.test.ts` asserted a task's `businessDate` against **UTC's** today while `createTask` stamps the **facility-local** one. Those agree for most of the day and diverge after 7pm Central, once UTC has rolled over — so the test passed every time it had been run before this evening and failed the first time the suite ran late. The bug was in the assertion, not the code; it now uses the same `businessDateFor` the implementation does.

**Verified:** 908 unit/DB tests (53 new — 33 pure metric tests covering every boundary above plus the roll-up property; 8 CSV tests including the injection guard; 12 adapter tests against real rows: maintenance counted rentable and unrentable excluded, collected read off the ledger as a positive magnitude, payments outside the period excluded, roll-up equalling the sum of its rows, a facility the actor cannot see never appearing, and the rent roll's gap against the current street rate). E2e: 314 passing, including axe-clean report screens and the CSV-matches-screen assertion; one pre-existing parallel-load flake in an unrelated smoke test, confirmed by isolation. Typecheck, lint, build clean. No migration.

**Left behind, and visible on the screens rather than hidden:** **AR ageing has no data.** `daysPastDue` is built and tested because it is the shared definition every later consumer must use, but it needs `Invoice` rows and nothing creates them until **B-044** — so every lease reports 0 days past due. The screen shows real outstanding *totals* and says in plain words that the buckets need invoices, rather than rendering an all-current ageing that would look plausible and be meaningless. **Move-ins have no source attribution**: nothing on `Lease` records an acquisition channel, and both the public checkout and B-039's counter walk-in run through the same `startCheckout`, so there is no derivation to write — only a column nobody has added. **B-097** is the item that captures source and is where carrying it through reservation → move-in belongs; everything reads `unknown` until then, because attributing it all to `web` would credit the channel this report exists to evaluate. Reservation conversion uses `updatedAt` as a stand-in for a converted-at timestamp (approximate for a reservation whose status changed twice); a dedicated column belongs with whichever item next touches the reservation lifecycle. Reports 4–6 (delinquency detail, revenue, deposits) are **B-055**/**B-078** as the backlog assigns them. No trend/point-in-time history — occupancy is measured now, and month-end snapshots are the P2 close process (US-40).

---

### B-043 — Billing scheduler ⏳ PARTIAL — catch-up only `4c30a6a`

**Not a completed item.** One part of B-043 shipped and is fully tested; three remain. Marked partial in the backlog rather than ✅, and written up here so the next session starts with the scope straight rather than rediscovering it.

**Found and fixed: catch-up after downtime was specified, built, and never wired.** `missedBusinessDates` shipped with B-006 — tested, documented, and with **zero callers**. The cron route only ever ran facilities whose local clock was *at* the target hour on that tick, so any facility whose nightly hour elapsed during an outage was skipped and never revisited: silently, permanently, and with no error anywhere to notice. For a scheduler that will shortly be generating invoices and running autopay, a missed night that never comes back is the failure mode that matters most. The route now reads the last successful run per (job, facility), asks `missedBusinessDates` what was missed, and runs each date oldest-first before today's.

**Decided: catch-up runs unconditionally, not behind an "are we behind?" check.** `runJob`'s idempotency is the unique constraint on `(jobName, facilityId, businessDate)`, so a date that already ran is skipped rather than repeated. On the normal path `missedBusinessDates` returns exactly today and the behaviour is identical to before — which means the catch-up path is exercised every single tick rather than only during the rare outage it exists for, and cannot rot unnoticed.

**Decided: a `partial` run counts as history and is not re-run.** A run that finished with some failed items recorded those items; re-running the date would duplicate the ones that succeeded. Catching up resumes from the day *after* the last attempted date, not the last flawless one.

**Verified:** 914 unit/DB tests (6 new, driving the exact shape the route uses against real `JobRun` rows: today-only with no history, four missed days run oldest-first, an already-succeeded date not re-run, two ticks in the same hour being a no-op the second time, a year-long gap capped rather than attempting 365 jobs in one request, and resumption from a `partial` run). Typecheck, lint, build clean. The 30-day cap test asserts boundedness rather than an exact count — the first caught-up date depends on how a stored `DATE` lands once shifted into the facility's timezone, and pinning it would assert an implementation detail rather than the property that matters.

**Still open in B-043, for the next session:** the Billing Runs screen, the card-expiry scan, and the insurance-proof scan with D-17's auto-enrolment. All three shipped in the entry below.

---

### B-043 — Billing scheduler ✅ completed `8e615a7`

The three parts left open above: the Billing Runs screen, the card-expiring scan, and the proof-of-insurance scan with D-17's enrolment on lapse. Recorded as **D-26**, because how the last of those *ships* is a decision, not an implementation detail.

**What it built.** `/admin/billing` is the Billing Runs screen — every `JobRun`, newest first, with per-item outcomes behind a native `<details>` disclosure, the run's error if it had one, and a Re-run button per row. Two new nightly per-facility jobs at 2am local: `billing.scan-expiring-cards` and `billing.scan-protection-proofs`. Two Facility columns, `autoEnrolProtectionOnLapse` and `defaultProtectionTier`, edited from the existing protection block in Settings. Three new events (`payment_method.expiring`, `protection.proof_expiring`, `protection.auto_enrolled`), one task type (`insurance_proof_lapsed`, sensitive), and one audit action (`lease.protection_auto_enrolled`).

**Decided (D-26): D-17's auto-enrolment ships built but switched off, per facility.** D-17 chose auto-enrolment and it is implemented and tested. What ships `false` is the switch, and unset is the tier — so a lapsed proof raises a high-priority task and charges nothing until someone deliberately turns it on. The reason is D-17's own text: it records that this charges a tenant for a term the lease may not have captured, and that the behaviour "warrants an attorney pass before it runs against a real tenant." A default of `true` would have started charging the instant a facility was seeded, before that pass could happen. This does not re-open D-17 — it defers only the moment it first bills someone, and the owner throws the switch. Two refusals guard it: Settings will not enable auto-enrolment with no tier chosen, and the scan will not enrol into a tier that is no longer on sale, leaving the task for a person rather than guessing a premium.

**Decided: the record of "already told them" is the event outbox, not a column.** Both scans dedupe by querying `DomainEvent` for what they have already emitted, keyed on entity, a *subject*, and the reminder stage. The subject is what makes suppression-on-replacement fall out for free rather than needing its own branch: for a card it is the payment-method id, so a replaced card is a new id that is not expiring and never scans into a notice; for a proof it is the expiry date, so a tenant who renews on the same waiver row gets next year's notice instead of being silently treated as already told. A flag on the lease would have needed resetting by hand on every renewal, which is the version that rots.

**Decided: the scans emit, they never send.** PRD 05 CN-3's rule ("comms react to billing events, never a comms-side calendar") applied a ladder early. The notices are B-050's rules and templates; all three events are already subscribed by `comms.dispatch`, so B-050 is data rather than another edit to the consumer list.

**Decided: two jobs, not one "pre-emptive scans" job.** A `JobRun` row per scan is what lets the Billing Runs screen say which of the two failed. Same reason the runner records per-item outcomes at all.

**Decided: re-run is gated on `facility:settings`, not on what shows the screen.** Reading is `reports:financial` or `payments:take` (the nav's own gate); re-running a billing job re-does work that may charge money, and counter staff hold `payments:take`. Global runs — the ones with no facility — are visible and re-runnable only to an actor with all-facilities access, since "at this facility" cannot be asked of them.

**Two small correctness calls inside the card scan.** A card is valid through the **end** of its expiry month, so the scan uses the last day of that month; treating `exp_month` as the day would fire every notice a month early and tell a tenant with a working card that it had run out. And an unconfigured Stripe records a *successful* run with the message "skipped — Stripe is not configured" rather than a failed one: a red run every night for a missing key trains people to ignore the screen that exists to be noticed.

**Found along the way: the returned-mail e2e test's once-per-day guard had a hole.** `admin-tasks.spec.ts` documents that it can only drive flag→task→complete once per calendar day against the shared demo tenant, and guards on B-038's flag button still being visible. But `portal-contact.spec.ts` gives the same tenant a fresh address of record, which clears `returnedMailAt` and brings the button back — while the task remains idempotent per (type, tenant, business day), so the second flag correctly produces no new open row and the spec failed on an assertion about designed behaviour. It now skips at that point with the cause named. The trade-off is stated rather than hidden: a genuine break in task creation would skip here instead of failing, which is acceptable only because `tests/tasks-db.test.ts` asserts flag→task directly against disposable fixtures.

**Verified:** 931 unit/DB tests (17 new — 10 DB tests driving the proof scan against real rows: nothing said outside the 30-day window, the notice emitted once rather than nightly, a renewed policy noticed rather than suppressed, one high-priority task on lapse and not a second the next night, nothing charged with the switch off, enrolment writing the plan and premium with a system-actor audit entry and the premium on the event, no second enrolment, the refusal when the tier is not on sale, and ended or already-planned leases left alone; 7 unit tests on `daysBetween` and `reminderStage` covering every threshold boundary including already-expired and a DST transition). E2e: 320 passing, including an axe-clean `/admin/billing`. Typecheck, lint, build clean. One migration (`20260805170000_protection_lapse_policy`).

**Left behind.** The **card scan is not verified end to end** — it needs Stripe to know an expiry date and this project has no key outside production, the same constraint B-035/B-036 documented. Its day-maths is unit-tested and its dedupe is the same code path the proof scan's DB tests exercise, but nothing has watched it read a real card. The Billing Runs e2e is deliberately **read-only**: pressing Re-run would execute a real nightly job against the shared demo facility that other specs assert on, so the re-run path's permission gate is covered in code rather than through the browser. There is **no portal path for a tenant to upload replacement proof** — US-44's AC names one, and the notice B-050 sends will have nowhere to link until a blob store exists (the same gap B-040 and B-041 left). The **lapsed-proof flag does not render on the tenant profile** yet; the task is the only staff-facing surface. Auto-enrolment sets `Lease.protectionCents` and stops there, which is correct today because **B-044** owns invoices — the premium starts appearing when there is an invoice to put it on. Attach rate (US-44's per-staff coaching number) is not reported anywhere; it belongs with the reporting depth in **B-084**.

---

### B-044 — Recurring invoice generation + proration ✅ `0d21bed`

The billing engine's first half: `packages/core/billing` (periods, proration, invoice lines, numbering), the nightly `billing.generate-invoices` job, and the due-date reminder events. Recorded as **D-27**, because the billing policy and what the billing day is anchored to are decisions a later session must not silently reverse.

**Decided (D-27): anniversary is the default, and the billing day is the facility-local day the lease started.** The alternative — everyone on the 1st — forces a prorated partial period on every single move-in, which is the most error-prone invoice a system produces and the one tenants query most. Anniversary makes the ordinary case a full month that never goes near a division. `first_of_month` is built and selectable per facility.

**Found and fixed: `billingDay` was hardcoded to `1` at move-in, and would have double-charged every renter.** Checkout charges a full month on the day they move in. With a billing day of 1, the nightly run would have invoiced that renter again on the 1st — eleven days later for a 20th-of-the-month move-in, for a period they had already paid for. Nothing had caught it because nothing generated invoices until now. `provisionMoveIn` derives the day from the facility's policy.

**Found and fixed, in the same area: the day was read from UTC.** `new Date().getUTCDate()` at 10pm in Texas is already tomorrow, so a renter moving in on the evening of the 20th would have been given the 21st as their anniversary — and carried it for the life of the lease, on every invoice. It now goes through `businessDateFor(now, facility.timezone)`, the same helper the scheduler uses. The e2e suite caught this one: `smoke.spec.ts` asserted the autopay disclosure said "day 1", and fixing the assertion to the real anniversary day is what exposed that the real day was wrong too.

**Found and fixed: the lease document promised proration that anniversary billing does not do.** §2 of the generated agreement read "if you move in part-way through a month, that first payment is prorated for the days you actually have the unit." Under anniversary that is false — the first payment buys a full period starting that day. This is a **signed** document, so the sentence was a term the operator would have had to honour against its own billing engine. It is now a `firstPaymentSummary` merge field that states what the facility's policy actually does, in all three cases.

**Decided: rounding is at line level, and a full period never divides.** US-18's AC specifies the formula; the test that matters asserts the consequence. $129.00 over 31 days is 4.16129…/day — round the daily rate first and multiply by 19 and you get $79.04 where the answer is $79.06, systematically in the operator's favour, every prorated line. And a complete period returns the monthly rate directly rather than `rate × 31/31`, so a full month can never bill a cent under because it passed through a division.

**Decided: `charged + refunded === the full period`, asserted rather than assumed.** `unusedRemainder` subtracts the charged amount from the whole instead of prorating the complement, because two independent roundings do not reconcile. The test walks every day of a 31-day month and asserts both the cents and the day counts add up. This is the property a move-out refund argument turns on, and B-077's transfer wizard inherits it.

**Decided: idempotency is `(leaseId, periodStart)` as a database constraint, not a check-then-insert.** The nightly run is re-runnable by admin (B-043's screen) and catches up missed business dates after an outage, so "already billed" has to be unforgeable. A run that loses the race rolls back and returns its invoice number to the pool — which is why numbering is the same row-lock counter as receipts (D-22) and not a Postgres sequence: a sequence is unique but not gapless, and US-17 asks for gapless.

**Decided: tax applies to the rent line only.** `calculateMoveInCost` had to assume a single taxable base before real invoices existed and said so in its own comment, naming B-044 as the item to model it. A protection plan is not rent and is not taxed as it; per-component taxability per state is now one `taxable` flag per line, which is the seam a second state needs (D-10). Rates are read effective **as of the business date being run**, so a catch-up run for last Tuesday bills last Tuesday's rate (FR-9).

**Decided: the due-date reminders are emitted by the billing job, not a comms job.** PRD 05 CN-3 requires the ladder be driven by billing-engine events rather than a comms-side calendar. `invoice.due_soon` and `invoice.due_today` come off the invoice's own due date in the same run that generated it — a separate job would have made the reminder depend on which of two `JobRun`s executed first.

**Already delivered, not rebuilt:** the backlog row also asks for "the rate-variance query B-042's report and the Phase-2 rate-increase worklist both read". B-042 built it — `rateVariance` and `wholeMonthsBetween` in `packages/core/metrics`, consumed by the rent roll, which doubles as the worklist. Nothing to add.

**Verified:** 985 unit/DB tests (54 new — 19 on billing periods including a property test that twelve consecutive periods tile a year with no day counted twice and none missed, leap February, and the billing-day boundary; 19 on proration and invoice building including the line-level rounding case, the reconciliation property across every day of a month, per-jurisdiction tax and the prorated day-range label; 16 DB tests driving the real generator: the move-in period never re-billed, the lead-time window opening and not before, idempotency across three runs, a three-month outage catching up as three separate invoices, line items and the ledger charge agreeing with the total, the effective-dated tax rate, gapless numbering across three leases, `invoice.created`'s payload, first-of-month policy overriding the lease column, move-out skip and prorate/no-prorate both ways, and an ended lease left alone). E2e: 320 passing. Typecheck, lint, build clean. One migration (`20260805190000_recurring_invoices`).

**Left behind.** **Nothing pays these invoices yet** — `amountPaidCents` stays 0 and no invoice moves off `open` until autopay (**B-045**) and partial payments (**B-048**) land. B-042's AR ageing now has real `Invoice` rows and real due dates, so `daysPastDue` and the buckets start reporting; the screen's "needs invoices" caveat can come down when someone confirms it against seeded data. **The three new facility columns have no settings UI** — `billingPolicy`, `invoiceLeadDays` and `prorateOnMoveIn` are configurable in the database only. That follows the existing precedent (`prorateOnMoveOut`, `moveOutNoticeDays` and `writeOffThresholdCents` are all the same today) and the shipped defaults are right for every facility, so nothing is unreachable that needs reaching; a billing-settings block belongs with whichever item next touches that screen. **Under `first_of_month` with `prorateOnMoveIn`, checkout still charges a full first month** — the nightly engine handles that policy correctly, but the checkout side is unbuilt and only reachable by a facility that switches away from the default. **No recurring fees**: `FeeSchedule` holds one-time fees, so an invoice is rent + protection + tax; recurring fee types arrive with **B-047**. Late fees, partial payments and refunds are all their own items and none of them exist yet.

**Note on the e2e suite, not a code defect:** three full Playwright runs in one evening exhausted the demo-e2e facility's 60 units — checkout locks accumulated faster than `global-teardown` drained them, and unrelated tests then failed with "no unit available". Releasing the stale locks restored it. Worth knowing before diagnosing a red suite as a regression; the teardown takes ~19 seconds, which is the part that makes it skippable under load.

---

### B-045 — Autopay run ✅ `be48a33`

The nightly `billing.autopay` job, the settlement that makes it safe, and two latent defects in the shared payment path that only became reachable once something charged a card without a person watching. Recorded as **D-28**.

**Decided (D-28): "never double-charges" is four layered guards, and one of them is load-bearing in a way that is easy to undo by accident.** `JobRun`'s uniqueness on (job, facility, business date) is what serialises the run against itself, so the read-then-charge below is safe rather than merely unlikely. The query excludes any invoice with a payment attempt already pending or succeeded. Stripe's idempotency key is derived from the invoice **and** the business date — so a forced admin re-run tonight is deduplicated, while B-046's retries on +1/+3/+5 are genuinely new attempts rather than Stripe replaying the first decline. And `createChargeIntent` now recognises a deduplicated intent instead of colliding on it.

**The load-bearing part: the `PaymentAllocation` is written before Stripe is called, not after.** If Stripe charges the card and the process dies before the webhook lands, the allocation already exists — so the next run sees an attempt in flight and skips, instead of charging a second time. Writing it after the call would leave a window in which a real charge is invisible to the guard that exists to notice it. A pending allocation counts toward nothing, because the paid total sums *succeeded* payments only, so this cannot make an unpaid invoice read as paid.

**Found and fixed: a succeeded card payment never settled its invoice.** The webhook posted to the ledger and stopped there. `Invoice.amountPaidCents` stayed 0 and the status stayed `open` — so autopay would have charged the same invoice again the following night, and every night after that. `settleNamedInvoice` writes the allocation and recomputes the paid total; **recomputed, never incremented**, because Stripe redelivers and an increment applied twice is precisely the bug redelivery causes. Both properties are asserted directly.

**Found and fixed: Stripe's idempotency window would have thrown on a retried charge.** `createChargeIntent` writes its pending `Payment` row before calling Stripe. Stripe deduplicates by idempotency key for 24 hours and returns the *original* intent — which another `Payment` row already points at, and `stripePaymentIntentId` is unique. The update then threw, leaving the caller with a half-written charge that had in fact already been made. It now discards the duplicate row and returns the original payment with `deduplicated: true`, which the run reports as skipped rather than counting as a charge. Unreachable before this item because every previous caller was interactive.

**Found and fixed: a Stripe error left an orphan `pending` payment forever.** If the intent creation threw, the row written a moment earlier was never touched again — it sat in the tenant's history as pending, counting against nothing and reconciling to nothing. It is now marked `failed` with the reason before the error is rethrown.

**Decided: an off-session decline is recorded by the run, not waited for.** A confirmed off-session charge declines **synchronously** — Stripe throws, and there is no `payment_intent.payment_failed` webhook coming, because the confirmation happened inside the request. So the run emits `payment.failed` itself, carrying Stripe's decline code, the invoice and the lease. B-046 reads that code: `expired_card` short-circuits the retry schedule (US-20), because retrying a card that has expired three times just annoys the tenant three times.

**Decided: a declined invoice stays collectable.** The failed attempt's allocation must not read as in flight, or one decline would permanently exempt an invoice from every future run and B-046 would have nothing to retry. The in-flight query filters to `pending` and `succeeded`; a test asserts the second night charges.

**Decided: invoices due on or before the business date are collected, not only those due exactly today.** An invoice whose due date passed while the scheduler was down must still be collected on the catch-up run, rather than silently becoming a delinquency the tenant did not earn.

**Decided: skips are named, not counted.** US-19's AC is "succeeded / failed / skipped **with reasons**" on the Billing Runs screen. "Skipped: 41" tells an operator nothing, so each one records which of the four it was — autopay off, no saved card, attempt in flight, nothing outstanding.

**Fixed a test-harness defect that cost three separate diagnoses this evening.** Repeated full Playwright runs exhausted the demo-e2e facility's 60 units: every run leaks a few 30-minute checkout locks, `global-teardown` takes ~27 seconds against the remote database, and a teardown cut short as the dev server shuts down never releases them. What that looks like from the outside is a dozen unrelated tests failing with "no Reserve for free link" — which reads exactly like a code regression and is not one. There is now a `global-setup` that releases stale locks **before** the suite, which is the end that is guaranteed to happen; the teardown stays. Two consecutive full runs then passed, which is what "repeatable" means and was not true before.

**Verified:** 1002 unit/DB tests (17 new — the run charging the outstanding amount rather than the total, collecting an overdue invoice, ignoring one not yet due, all four named skips, a decline recorded as failed with the code on the event, a declined invoice still collectable the next night, one card failing not stopping the next tenant, the deduplicated charge reported as skipped, and the same invoice never charged across two runs; plus settlement driven through `applyStripeEvent` with real event shapes — allocation written, invoice paid, ledger posted, idempotent under redelivery, partial payment landing as `partially_paid`, and a metadata-supplied invoice belonging to another tenant refused). E2e: 320 passing, twice in a row. Typecheck, lint, build clean. No migration.

**Left behind.** **No real off-session charge has ever been made** — this project has no Stripe key outside production, so the run's selection, skip, decline and settlement logic are tested against a mocked `createChargeIntent` and real event shapes, but nothing has watched Stripe actually decline a card off-session. That is the same wall B-035, B-036 and B-043's card scan documented, and it is the one thing a staging key would close. **ACH is not supported** — US-19 says "card/ACH" and only card is built; `PaymentMethod` has the enum value and nothing creates one. **Failures do not retry yet**: the run emits `payment.failed` and stops, which is B-046's cue — there is no schedule, no attempt counter and no failed-payments queue until then, so today a decline is visible on the Billing Runs screen and nowhere else. **Nothing enforces a lease hold**: B-096's `LeaseHold` would halt autopay for a bankruptcy or SCRA tenant, and it does not exist, so a held lease would still be charged. **No receipt is sent** for a successful autopay charge — PRD 05 CN-6 is B-050's.

---

### B-046 — Failed-payment retry ✅ `58f8b99`

US-20's schedule, the card-expired short-circuit, the failed-payments queue as a `Task` view, and the `daysPastDue` consumer wiring the backlog assigned here. No new decision number — the anchoring rule this turns on was already settled as **D-25**, and this item is the second consumer of it.

**Found and fixed: B-045 shipped a retry schedule of "forever, nightly".** The autopay run collected any unpaid invoice on every pass, so a declining card was charged again every single night, indefinitely — four times the intended attempts in the first week and no end at all. It was correct for the item it shipped in (collect what is owed) and wrong the moment US-20 defined what "retry" means. `retryDecision` in `packages/core/billing` now gates it.

**Decided: every retry offset is measured from the invoice's original due date, never from the last attempt.** Measuring from the previous try slides the whole schedule forward on each decline — a +1/+3/+5 schedule becomes a 9-day one after four failures, and the tenant drifts further past due while the system believes it is being patient. This is the same anchoring rule `daysPastDue` is built on (D-25), and stating it in one place twice is deliberate: the two would otherwise be free to disagree, and the disagreement would be invisible.

**Decided: a terminal decline stops the schedule wherever it is, and is reported ahead of exhaustion.** US-20 names the expired card; eight sibling codes behave identically (`stolen_card`, `invalid_number`, and so on) — declines no amount of waiting changes. When a card has expired *and* the retries are used up, the reported reason is the expiry, because "the card has expired" is something a person can act on and "we ran out of retries" is not.

**Found and fixed: the decline code was never stored.** B-045 kept Stripe's prose in `failureReason` and put the code only on an event payload. Deciding "has this card expired?" by matching on a provider's wording is a bug waiting for Stripe to reword something, so `Payment.failureCode` now holds it, written on both failure paths — the synchronous off-session throw and the webhook.

**Decided: one task when the schedule finishes, not one per failed attempt.** Four rows in front of staff for one tenant is how a queue becomes noise nobody reads. The task is raised by the run rather than at the moment of the last decline, because that decline can arrive on a webhook hours later and the run is the one place that knows the schedule is finished. It is **withdrawn**, not completed, when the invoice is paid — nobody did the work, the reason went away — which also means staff are never chasing a tenant who has already paid.

**Wired up: AR ageing now reports for real.** B-042 built and tested `daysPastDue` before there were invoices to feed it, and the reports screen said so in plain words rather than rendering an all-current ageing. B-044 created the invoices; this item takes the caveat down and renders the 0–10 / 11–30 / 31–60 / 61–90 / 90+ buckets the PRD asks for, with a line explaining that the count is from the oldest unpaid invoice's original due date rather than the last retry — which is exactly the property this item exists to preserve.

**Found and fixed: a pre-existing test asserted something the code does not promise.** `admin-tenants-db.test.ts` searched for "Ada Renter" and asserted its own fixture was in the results — but `searchTenants` caps at 25 rows ordered by name, and twenty DB suites create a tenant with that exact name. It passed on luck and stopped passing the moment this item added another suite. The fixture is now suffixed so the multi-word-search assertion is about multi-word search, which is what it was for.

**Verified:** 1021 unit/DB tests (19 new — 13 on the schedule itself: four attempts and no more, offsets that do not slide, an attempt whose day passed while nothing ran still made, holding until the day arrives, the terminal short-circuit taking precedence over exhaustion, an ordinary decline still retried, a facility that retries once, and a facility that does not retry at all; 6 driving the real run across business dates: waiting for the retry day rather than charging nightly, the whole +1/+3/+5 sequence then stopping, an expired card stopping after one attempt with a high-priority task, one task rather than one per night, the task withdrawn when the invoice is paid, and the no-retry facility). Full suite run twice to confirm the parallel-load fix. E2e: 320 passing. Typecheck, lint, build clean. One migration (`20260805210000_payment_retry`).

**Amended the same day (D-29) `d7fd6a5`, on the owner's instruction: flag the manager at 2 declines, and message the tenant daily for 3 days.** Both changed what B-046 had just shipped, so they are recorded here rather than as a separate item.

The `failed_payment` task now fires on the **second decline** instead of at the end of the schedule — six days of nobody looking was the wrong trade against a late fee that a phone call usually prevents — and it is high priority whichever trigger raised it. The retry schedule keeps running afterwards; a person and a retry are not alternatives, and a test asserts the third attempt still happens after the flag.

The tenant cadence is `payment.retry_reminder`, one a day for three days **from the first decline**, and deliberately not one per retry attempt: retries land on +1/+3/+5, so attempt-driven messages would arrive on days 1, 3 and 5 with silence between, and day 2 — the day after a tenant first hears, when they are most likely to act — would say nothing. It runs as its own pass rather than inside the charge loop precisely because day 2 has no charge to hang a message off. Idempotency is the event log, two guards: a per-(invoice, business date) key so a re-run of tonight cannot send twice, and a hard count of three so a catch-up walking a fortnight cannot send fourteen. Both are tested.

**Stated plainly: this is an email today, not a text.** MVP comms is email-only (PRD 05 FR-4) and the SMS channel with its quiet hours and STOP/HELP handling is **B-074**. Because the message is an event and the channel is a rule, it becomes a text when that item lands with no change at the emit site — and **until B-050 writes the rule and template, nothing is sent at all**: the event fires and no rule consumes it. That is the honest state, and it is the same gap the "left behind" note below already names.

**Fixed while verifying it: the e2e sandbox had no headroom, which had been misread as three separate bugs.** A full run takes about 52 units in 30-minute checkout locks plus a handful of reservation holds — roughly 60 — and the sandbox facility had exactly 60. The suite passed or failed on which tests happened to finish first. Yesterday's `global-setup` fixed the leak between runs but not this, and it surfaced again immediately: releasing the stale holds freed enough units for the reservation tests to succeed, which then consumed the last of the margin and failed eighteen checkout tests instead of three. The setup now releases stale reservation holds at the sandbox too (scoped by slug; nothing reads a pre-seeded hold), and the sandbox seeds **250** units rather than 60, so a full run has four times the room it needs and cleanup stops being load-bearing. Two consecutive full runs then passed.

**Verified after the amendment:** 1028 unit/DB tests (7 more — the manager flagged on the second decline and not the first, retries continuing after the flag, the three-day cadence including the day with no retry attempt, one reminder per day however often the run is re-run, never more than three across a fortnight-long catch-up, reminders stopping when the invoice is paid, and nothing said to a tenant whose card never declined). E2e: 320 passing, twice.

**Left behind.** **The tenant is not told.** `payment.failed` carries the decline code and B-050 owns the notice — so today a tenant whose card expired finds out by noticing, and US-20's "notify the tenant to update the card (deep link to portal)" needs B-050 for the message and B-051 for the link. That is the single most valuable thing left in this area: the retry schedule exists to buy time for a tenant to act, and nothing currently tells them to. **The failed-payment task has no dedicated screen** — it appears in the ordinary `/admin/tasks` list, which is what US-41 asks for ("every later queue is a filtered view of this list"), but there is no filter control to show only failed payments; that arrives with B-059's queue filtering. **Still no real off-session charge has been made** — the schedule is tested against a mocked `createChargeIntent`, so nothing has watched a real Stripe decline carry a real code into the branch that reads it. A Stripe test-mode key remains the one external thing that would close this, B-043's card scan and B-045 together. **Retries do not respect a lease hold** (B-096) or quiet periods, and there is no cap on how long a terminal-decline task sits open before it escalates — escalation is the delinquency engine's, B-057.

---

### B-050 — Payment lifecycle notices ✅ `297b52b`

**Pulled forward past B-047 on the owner's instruction**, because B-046 had just built a retry schedule whose whole purpose is to buy a tenant time to act, and nothing was telling them to. Its dependencies (B-030, B-043, B-044, B-046) were all shipped, so nothing was jumped.

Eight rules and eight templates, the two recipient resolvers billing events needed, and two skip predicates. No migration and no new engine — B-030 built the pipeline and the deliverable here is content plus the seams it plugs into.

**Found and fixed: every billing event this project emits resolved to nobody.** `resolveRecipient` handled `Lease`, `Tenant` and `Reservation`. `invoice.due_soon`, `invoice.due_today`, `payment.succeeded` and `payment.failed` all name an `Invoice` or a `Payment`, so each one fell through and returned null — a silent no-op with a `Message` row that never existed. B-044 and B-045 had been emitting into that hole for two items. Both resolvers now exist, and a `Payment` reaches its lease through the allocation it settled, falling back to the tenant's occupying lease for a payment that named no invoice (a move-in, a counter payment).

**Decided: the autopay skip needs BOTH halves of autopay to be true.** `autopay_covers_it` skips the due-soon and due-today reminders only when the lease is enrolled **and** the tenant has a saved card — the two facts live in two places by B-036's design, and a lease enrolled with no card on file will not be charged. That tenant is exactly the one who needs telling, and a naive `autopayEnabled` check would have silenced them. Asserted directly, because it is the difference between a reminder that is helpful and one that is actively wrong.

**Decided: the receipt has no autopay skip.** A receipt is precisely what an autopay tenant should get — for most of them it is the only thing that tells them the charge went through at all.

**Decided: `invoice_paid` is re-evaluated at send time, not trusted from the event.** FR-18's staleness rule, and the concrete case is ordinary: a counter payment this morning, or an autopay run that beat the dispatcher. Without it a tenant who has already paid gets chased.

**Decided: the tenant never sees the provider's decline wording.** Stripe's message is written for a developer — "your card was declined: do_not_honor" tells a tenant nothing they can act on. The template says either "the card we have on file has expired" or "your bank declined the payment; that is usually a temporary block or a limit", chosen from the decline code B-046 stored. A test asserts the raw code never appears in the body.

**Decided: the card-expiring notice names no unit.** A saved card belongs to the tenant, not a unit (B-036), so that event names a `Tenant` and its recipient has no lease to read a unit number from — and a tenant renting two units should get one email rather than two naming different doors. Found by the render failing loudly on the missing merge field, which is FR-9 working as intended.

**House style, applied deliberately and worth keeping.** Amount and date in the first two lines; exactly one link per action; never a consequence that has not happened. These go to people who are paying on time far more often than not, and a due-date reminder that reads like a collections letter is how an operator teaches good tenants to stop opening their email — after which the dunning ladder (B-052) has nobody listening. The card-expiring notice says outright "nothing is wrong with your account, and no payment has failed", because a three-year on-time tenant reading a payment email assumes the worst.

**Two catalog invariants are now tested rather than hoped for.** Every seeded rule points at a template that exists (a rule with no template is a silent no-send), and every template declares each merge field its body actually uses (FR-9 fails the render otherwise, so an undeclared field means the message never goes out). Both would have caught the card-expiring mistake above before it reached a test run.

**Verified:** 1044 unit/DB tests (16 new, driven against the REAL seeded catalog rather than test-local rules — the deliverable is the content, and a test that seeded its own would prove only that B-030's engine works: the reminder sent to a hand-paying tenant, skipped for autopay, still sent when autopay has no card, skipped for an invoice paid in between, skipped after move-out; the receipt with its ledger-read balance and the receipt an autopay tenant still gets; the decline notice naming the cause in plain words with both fix links and no raw code; the escalation on the last of the three daily reminders; the card notice reading as a heads-up at 30 days and sharpening at 7; and D-17's two notices, including the premium in the subject line the owner's decision requires). E2e: 320 passing. Typecheck, lint, build clean. No migration.

**Left behind.** **`links.pay_now` points at `/portal/pay`, which requires a login** — US-20's "fix path ≤5 min" is met by a tenant who knows their password and not by one who does not. **B-051**'s magic links are what make that a single click, and they are the next thing worth doing in this area. **Still email-only**: every one of these is a text the moment B-074 configures the channel, and until then a tenant who gave only a mobile number gets nothing. **No per-facility overrides and no editor** — these are org-level defaults (`facilityId: null`); the template editor with preview and test-send is B-053, so changing a word today means changing this file and re-seeding. **A move-in sends two emails** — the welcome (which already states what was charged) and a receipt. Both are defensible on their own and the overlap is one day, so it is left rather than papered over with a heuristic that would go wrong later. **Nothing is scheduled by these rules**: every send is driven by an event a billing job already emits (PRD 05 CN-3), so a notice for something no job emits yet — a late fee, a delinquency step — arrives with B-047 and B-052.

---

### B-051 — Pay-now magic links ✅ `70b411e`

The one-tap way to pay from a reminder, which is what B-050's `links.pay_now` was standing in for. Recorded as **D-30**, because what the link grants is the whole design and a later session must not "simplify" it into a portal session.

**Decided (D-30): a pay link is not a session.** CN-4 asks for a link that authenticates a tenant "into the tenant portal's payment screen ... without a password", and the literal reading — mint a portal session — is the dangerous one. `/portal/*` reveals gate codes (PRD 03 SR-2), lets a tenant change their address of record, and lets them detach the card autopay runs on. These links travel in email: forwarded to a family member, sitting in a shared inbox, read over a shoulder.

Scoping by a session flag would mean every portal page had to remember to check it — fail-**open**, and wrong the first time somebody adds a page. So the link is not a session at all: it grants exactly one route, `/pay/<token>`, for exactly one lease, and nothing else in the application knows the token exists. Every other route sees an anonymous visitor. The e2e suite asserts that directly — visiting a pay URL and then `/portal` still redirects to the login.

The screen that falls out of that shows no gate code, no other unit, no contact details and no way to remove a card. That is the point rather than an omission. The deviation from CN-4's wording is deliberate and written at the top of `lib/portal/pay-links.ts`.

**Decided: deliberately multi-use, unlike every `AuthToken` in this project.** Magic links are single-use with a 15-minute life; this is multi-use for seven days. CN-4 wants the balance "as of page load, not as of send", which only means something if the link can be re-opened — and a tenant who opens it, gets distracted, and comes back an hour later must not find a dead link, since that is the precise failure the item exists to remove. It is safe to be long-lived *because* it is not a session: the worst a stale one does is show a balance and offer to pay it. It is still 256 bits (CN-4 asks for ≥128), still stored only as a SHA-256, and still revoked on move-out — in the same transaction as the lease ending, so a rolled-back move-out does not kill links it should not have.

**Decided: the update-card link stays password-gated.** The failed-payment notice carries both a pay link and an update-card link, and only the first is one-tap. Changing the card autopay charges from then on is more than this token is scoped to grant, so that one asks the tenant to sign in. Asserted in a test, because it is the kind of inconsistency a later "make it all one-tap" tidy-up would remove without noticing what it was for.

**Decided: attribution is recorded when the attempt is raised, not when it succeeds.** "This link produced an attempt" and "this link produced money" are different questions and PRD 05 §7 wants both, so `paymentId` is written as the PaymentIntent is created. The link carries the `eventId` rather than a message id, because it is minted while the body is being rendered and the `Message` row does not exist yet — the send log joins on `Message.eventId`.

**Decided: one live link per event, not per lease.** One event can fire several notification rules and those are one message from the tenant's point of view, so they share a link; two different events get different links, because a shared one could not say which message earned the payment. Re-minting for the same event revokes the previous row rather than leaving two live links for one message — the plaintext is unrecoverable by design, so a re-render cannot hand back the original.

**Verified:** 1062 unit/DB tests (18 new — 256 bits of entropy and the plaintext absent from every stored row, uniqueness across mints, the seven-day default, a live link accepted, the same link accepted three times running, click counting with `firstClickedAt` set once, expired and revoked and never-existed all refused identically, a lease that ended refused even with nothing revoked, revocation reporting its count and being idempotent, payment attribution with the event id, one live link per event, different links per event; plus two in the comms suite asserting a real `/pay/<token>` reaches the reminder body while the update-card link stays on the portal). E2e: 328 passing, including that a pay URL never opens the portal and that the expired-link landing is axe-clean. Typecheck, lint, build clean. One migration (`20260806090000_pay_link`).

**Left behind.** **No e2e drives a valid token end to end** — minting one needs a real lease with a balance, and the lifecycle fixtures are shared with the admin and portal specs, which is the class of mistake B-039 and B-041 both recorded. The valid path is covered against disposable rows instead; what the browser tests is the boundary, which is the part that is about security rather than arithmetic. **Expiry is a constant, not a per-facility setting** — CN-4 says "configurable (default 7 days)" and 7 is hardcoded in `PAY_LINK_TTL_DAYS`; there is no facility column and no UI, the same posture as `prorateOnMoveOut` and friends. **No staff-facing revocation** beyond move-out: nothing lets a manager kill a link they know was forwarded, and there is no screen showing which links are live. **The attribution is not reported anywhere** — the data is captured (clicks, first click, payment) but PRD 05 §7's ROI figure needs the delivery dashboard, which is **B-075**. **Rate limiting**: `/pay/<token>` has none of its own; a 256-bit token is not brute-forceable, but a flood of guesses still costs a database lookup each, and the login throttle does not cover this route.

---

### B-047 — Late fee schedule ✅ `463a5d8`

Back on backlog order after the B-050/B-051 detour. The ladder, the wider fee catalogue, automatic nightly assessment, and the waiver. No new decision number — the two calls worth recording are consequences of **D-25**'s anchoring rule rather than new choices.

**Decided: the cap applies AFTER the greater/lesser choice, not before.** US-21 asks for "$X or Y% (greater/lesser)" respecting "configurable caps", and the order is not cosmetic. "The greater of $20 or 10%, capped at $15" on a $900 balance is $15. Capping each side first gives `max($20, $15)` = $20 — which *breaches the cap the operator configured*, and does it silently on exactly the large balances a cap exists to bound. Asserted with the case that distinguishes them, not just the case where both orders agree.

**Decided: a late fee is its own invoice, and fees are never charged on fees.** `Invoice.kind` is now `rent` or `fee`, and assessment reads **rent** invoices only — for the base amount *and* for the days-past-due anchor. Without that split an unpaid fee invoice would itself age past the threshold and earn another fee, and a balance would compound with nobody having decided it should. It is its own invoice rather than a line appended to the rent invoice for two reasons: an invoice the tenant has already been sent must not change totals after the fact, and autopay collects *invoices* — a fee posted only to the ledger would never be charged automatically, so it would sit on the balance uncollected until someone paid by hand.

**A pleasant consequence: idempotency came free.** The fee invoice uses the day it was raised as its `periodStart`, so `Invoice`'s existing `(leaseId, periodStart)` unique constraint makes it one fee invoice per lease per business date — the same guarantee B-044 built for rent, reused rather than rebuilt. Two steps that come due on the same night land on one invoice with two lines, in step order.

**Decided: a facility with no configured ladder is charged nothing.** No rules is a real operator choice, not a reason to fall back to a default nobody agreed to. `DEFAULT_LATE_FEE_STEPS` exists in core as Texas practice for seeding, and a test asserts every shipped default is **capped** — an uncapped percentage is the one shape that can run away.

**Decided: a waiver is a credit and a `void`, never a deletion and never `paid`.** The charge stays, the credit that cancelled it sits next to it, and the invoice reads `void` rather than `paid` because nobody paid it — which is what lets the revenue report tell forgiven money from collected money. Three gates, all US-21's own words: the `fees:waive` permission at that facility, the amount within the actor's monetary limit (an over-limit refusal names the rank that can approve it, per RBAC-2), and a reason code — enforced here *and* by `recordAudit`, since `fee.waived` is `requiresReason: true` in the catalog. Two guards because the money moves before the audit write and refusing early is the cheaper failure.

**Extracted while building it: one invoice-numbering counter, not two.** B-044's gapless counter was a private function inside the recurring-invoice module. Late fees raise invoices too, and a second copy would have produced two series interleaving into one with holes — the exact thing D-22's counter exists to prevent. It now lives in `lib/billing/numbering.ts` and both paths call it.

**Verified:** 1096 unit/DB tests (34 new — 16 on the arithmetic: each basis, the cap-ordering case that distinguishes before from after, never charging more than is owed, a credit balance producing nothing, half-up rounding, a negative configured amount treated as zero rather than a discount, and the step ladder including the catch-up case where a lease aged past both thresholds; 18 against real rows: nothing before the threshold, the fee raised on day five with its ledger charge agreeing, no second charge for the same step on later nights, idempotent on a re-run, both steps on one invoice after an outage, **no fee on a fee** with the rent settled and the fee left to age, nothing once the rent is paid, nothing with no ladder configured, the rule in force on the business date being run rather than today's, and the full waiver matrix — void plus credit with both entries visible, the audit row with its reason code, refusals for no reason code, no permission, over limit, already waived, and a rent invoice). E2e: 328 passing. Typecheck, lint, build clean. One migration (`20260806110000_late_fees`).

**Left behind.** **No UI at all** — the ladder is configured by inserting `LateFeeRule` rows and a waiver is a function call. US-3's facility settings screen is where the ladder belongs and the tenant profile is where the waive button belongs; both are real gaps and both are screens, not logic. This is the same posture the other billing settings are in (`paymentRetryDays`, `billingPolicy`), and it is now the largest cluster of "configurable in the database only" in the project. **The six new fee types have no consumers**: `lock_cut`, `cleaning`, `damage`, `transfer`, `certified_mail` and `auction_cost` exist in the enum and in `FeeSchedule`, but nothing charges them — move-out is where lock-cut and cleaning belong (B-040 shipped before they existed), transfer is **B-077**, and the certified-mail and auction ones are the Phase 2 lien pipeline. The enum entries are what let those items post a fee rather than invent one. **Late fees are not taxed** — correct for Texas (D-10) and wrong for a state that taxes them; the seam is the per-line `taxable` flag `buildInvoice` already takes. **No notice** tells a tenant a fee was charged: `invoice.created` fires for the fee invoice and no rule consumes it, so B-050's catalog needs a template whenever the owner wants one. **Nothing halts assessment for a lease on hold** — B-096's `LeaseHold` would stop fees for a bankruptcy or SCRA tenant, and it does not exist yet.

---

### Billing settings, given a screen ✅ `1721979`

**Not a backlog item** — a gap-fill the owner called for after B-047's write-up flagged it. Five items had each shipped a defensible database column with no way for an operator to reach it, and together they had become the largest cluster of developer-only configuration in the project. A setting only a developer can change is one an operator has to ring someone about.

**What it closed, and which item left it.** `billingPolicy`, `invoiceLeadDays`, `prorateOnMoveIn` (**B-044**), `paymentRetryDays` (**B-046**), the late-fee ladder (**B-047**), and the fee-waiver action (**B-047**). `prorateOnMoveOut` came along with them — it had been column-only since **B-040**, which predates all of this.

**Decided: one form for the whole billing policy, not five saves.** The five settings are read together and they interact — anniversary billing makes `prorateOnMoveIn` unreachable, and the invoice lead time decides when a due-soon reminder fires. Splitting them across separate saves would let a facility end up in a combination nobody looked at as a whole. The `prorateOnMoveIn` field says on its face that it only applies under first-of-month billing, rather than being hidden, because a hidden control is one an operator later swears they set.

**Decided: an uncapped percentage late fee is refused, not warned about.** A percentage with no cap is the one shape that can run away — 10% of a balance three months deep is a fee nobody intended to set. The form refuses to publish it and says what to enter instead. A warning would be dismissed; this is 3.3.4's error prevention on something that charges tenants automatically at 2am.

**Decided: the retry schedule is typed as "1, 3, 5" and validated as increasing.** The offsets count from the invoice's original due date (D-25), not from the last attempt, so a decreasing list is not a faster schedule — it is one whose third attempt is already in the past when its second fires. The refusal explains that rather than only rejecting it (3.3.3), because the rule is genuinely non-obvious.

**Decided: the late-fee ladder is append-only with a confirm step, like every other price here.** Adding a step echoes back what was parsed — the step, the trigger, the amount in words ("the greater of $20.00 or 10%"), the cap, the effective date — and asks for agreement before writing (3.3.4). It cannot be edited or deleted afterwards; changing it is another row with a later date (FR-9), so a fee already assessed is never retroactively a different amount.

**The waive control reuses B-047's domain function rather than reimplementing its gates.** Permission, monetary limit and reason code all stay in `waiveFeeInvoice`; the action only translates its refusals into sentences. The over-limit message names the actor's limit and says to ask a manager, because RBAC-2 routes over-limit to the next role up and a manager reading "not allowed" cannot tell what to ask for. Reason codes come from the audit catalog's vocabulary with a free-text note beside them — the code is what keeps the log filterable, the note is what explains this particular case.

**Also fixed: the fee-type dropdown still offered four types.** B-047 added six more to the enum — `lock_cut`, `cleaning`, `damage`, `transfer`, `certified_mail`, `auction_cost` — and the settings form had not caught up, so the fees that item existed to make chargeable were unreachable from the screen that sets their amounts. They now list with readable labels rather than raw enum keys.

**Verified:** 1104 unit/DB tests (8 new on the retry-schedule parser: separators, empty meaning no retries, the increasing rule with its explanation, non-integers and out-of-range values, the length cap, and the offending value named so a person can find it). E2e: 334 passing, including three new specs — the policy form rendering, the out-of-order retry schedule reporting beside the field *and* in the summary, and the uncapped percentage refused — plus the existing axe sweep over `/admin/settings`, which now covers all of it. Typecheck, lint, build clean. No migration.

**Left behind.** **The waive control has no axe coverage in the browser** — it only renders when a tenant has an outstanding fee and the demo tenant has none, so the a11y sweep never reaches it. It is built from the same `AdminForm`/`Field` primitives every audited screen uses, but "same primitives" is an argument, not a test. **No edit or delete anywhere**, by design (FR-9) — a mistyped late-fee step is corrected by adding another row dated today, and there is no UI that explains that beyond the hint text. **The ladder shows only what is in force today**, not its history; the tax and fee tables have the same limitation. **Settings still missing a screen**: `authorizedAccessCap`, `cashApprovalThresholdCents`, `writeOffThresholdCents` and `moveOutNoticeDays` were left out of this pass to keep it to the cluster the owner named. **Closed immediately after B-098, on the owner's instruction** — they are now an "Operations policy" section, kept apart from billing because they are not billing: they are the limits a facility puts on its own staff and tenants, and someone looking for "how many people can be on a lease" would never find it under invoicing. With that, **every `Facility` column is reachable from a screen.**

---

### B-096 — Lease holds ✅ `a8b8ec1`

Built ahead of B-098, which needs it: the day-6 access suspension must never fire on a servicemember or a debtor under a stay, and there was nothing to ask. Recorded as **D-31** for the one effect added beyond US-42's list.

**The gap this closed was older than the item.** US-25 said the delinquency pipeline halts on "payment/move-out/hold" and nothing anywhere defined a hold. B-052's row says the same. Every automated money path built since — late fees, autopay, the retry ladder — has been running with no way to stop it for a tenant who is legally protected from it.

**Decided: effects are declared per type in a catalog, and no consumer switches on the type.** US-42 is explicit — "a new hold type is a configuration row, not six code changes" — so `packages/core/holds` holds seven types, each declaring its effects, whether lifting needs a manager, and whether it needs an estate contact. Consumers ask `leaseHasEffect(leaseId, 'halt_late_fees')`. Adding a type is an entry; changing what `bankruptcy` stops is one line, in one file, with the tests that already cover it.

**Decided (D-31): a sixth effect, `halt_autopay`.** Every effect US-42 lists stops us *asking* — dunning, fees, suspension, auction, marketing. None of them stops us *taking*. An automatic stay under Chapter 7 makes a charge against a debtor a violation, and charging a dead person's card is its own problem; halting the chasing while continuing to help ourselves to the balance on the same lease would be the worst of both and would look deliberate. Carried by `military_scra`, `bankruptcy` and `deceased`. Deliberately **not** by `dispute` — a disagreement about one charge is not a reason to refuse a payment the tenant chose to make — nor by `do_not_contact`, which is a channel instruction rather than forbearance.

**Decided: concurrent holds union their effects.** US-42 says each is evaluated independently, so a narrow hold sitting beside a broad one can never weaken it. A test asserts the inverse too: when the broad one is lifted, the narrow one does not inherit its reach.

**Decided: placing is counter-level, lifting is where the restriction lives.** US-42 restricts lifting `military_scra` and `bankruptcy` to manager-or-above and says nothing about placing — correctly, because the staffer who takes the call from a deploying servicemember is exactly the person who should be able to stop collections that night. Making placement managerial would mean the protection waits for someone to be free. The manager gate is declared per type in the catalog rather than checked against a hardcoded pair, so a later type that needs it says so.

**Decided: a lifted hold stays lifted, whatever its end date says.** `holdIsActive` checks all three of not-yet-started, expired and lifted. The bug that guards against is concrete: a manager lifts a hold early, someone had also set an end date next year, and the hold comes back to life.

**Decided: an unknown type contributes no effects rather than all of them.** Failing closed sounds safer and is wrong here — a typo would silently freeze an account with no explanation on any screen. The catalog is code rather than user input, so the typo is caught at the placement boundary, which refuses an unrecognised type outright.

**The banner is the first thing under the tenant's name.** US-42 wants it before any control that could act on the account — "a manager must never be able to approve a sale without the hold in view". It carries the type, the reason given, who placed it, the estate contact where there is one, and **what it stops in plain words** ("collections chasing, late fees, gate suspension, auction, marketing, automatic card payments") rather than the effect keys. Never colour alone (1.4.1): the label and the note carry it.

**Verified:** 1135 unit/DB tests (31 new — 17 on the catalog and evaluation: every type declaring effects, the two US-42 protects, auction blocked wherever a sale would be the unrecoverable mistake, the dispute type kept narrow, do-not-contact stopping the sending and not the owing, the union across concurrent holds, a lifted hold staying lifted against a future end date, and an unknown type contributing nothing; 14 against real rows: the audit row carrying the type as its reason code, counter staff placing but not lifting an SCRA hold, the estate contact enforced for `deceased`, two concurrent holds, lifting refused twice and without a reason, **late-fee assessment actually halting**, the effects B-098 and B-052 will ask about, and a hold on one lease not leaking to the same tenant's other unit). E2e: 334 passing. Typecheck, lint, build clean. One migration (`20260806130000_lease_hold`).

**Left behind.** **The banner is on the tenant profile only.** US-42 also wants it on the delinquency queue row and on **every** notice-generation and auction-approval screen — none of which exist yet (B-059, B-061, Phase 2). The data is there and each of those items has to render it; nothing enforces that they do, and that is the AC most likely to be quietly missed. **`block_auction` and `halt_access_suspension` have no consumers yet** — B-098 is the first, which is why this went first. **Supporting documents are a column, not an upload**: `documentId` exists and there is no way to attach the deployment order or the bankruptcy notice, because the blob store still does not exist (the same gap B-040, B-041 and B-043 all left). **Nothing warns when a hold is about to expire**, so an `effectiveTo` set six months out lapses silently and collections resume with no one told. **The `deceased` type does not yet make portal access staff-only** — US-42's last AC — because that decision lives in the access path B-098 and B-058 own.

---

### B-098 — Gate access suspension & restore on non-payment ✅ `b33d9c8`

D-16's single threshold, moved forward out of the Phase-2 pipeline. No new decision number: D-16 settled the behaviour and this implements it.

**Decided: the rule is evaluated per TENANT, not per lease.** `AccessGrant` is one row per (facility, tenant) by PRD 03 FR-1's design, and that matches the physical reality — a shared gate either opens for someone or it does not, and there is no way to admit them for unit A while refusing unit B. So the decision reads the **highest day count** across that tenant's leases at the facility and the **sum** of their balances. Suspending on any one delinquent lease would lock a tenant out of a unit they had paid for; requiring every lease to be delinquent would let them hold the gate open indefinitely by keeping one cheap unit current. A hold on any one lease blocks the whole grant, because the grant cannot be partially suspended and that is the safe direction.

**Decided: suspension needs the day count AND an outstanding balance.** A lease showing days-past-due with a zero balance is a rounding artefact or a credit. Locking someone out over it is the version of this feature that produces a complaint instead of a payment, and it is a single `&&` away at all times.

**Decided: the hold check runs first, and a hold does not restore.** First, so no later branch can be reached past it and a hold placed mid-cycle takes effect on the very next evaluation rather than after the next payment. And a hold holds a *suspended* grant where it is rather than letting it back in — a hold is not a payment, and restoring on one would make it a free pass. Both asserted.

**Decided: restore is inline, and the nightly pass is only the net.** US-45 wants restore "within ~2 minutes of a qualifying payment, with no staff action", which a 4am job cannot do. `restoreAccessIfSettled` is called directly from the two paths that settle money — the Stripe webhook and the counter payment — inside the same request, so a tenant who pays at the counter can reach their unit before they have walked back to the car. Both calls are best-effort and outside the money transaction: a gate controller being unreachable must never roll back a payment already taken. The 4am pass catches a balance that reached zero some other way — a credit, a waiver, a write-off.

**Decided: the nightly pass runs last, at 4am.** After invoices (1am), late fees (2am) and autopay (3am), so the balance it reads is tonight's settled figure. A tenant whose autopay succeeded an hour earlier must not be suspended for a balance that no longer exists.

**Found and fixed: a restore emitted the wrong event, so CN-11's restore notice could never have fired.** `transitionGrant` chose `access.granted` for any transition into `active`, including suspended→active — even though it correctly distinguished `resume_access` from `grant_access` for the hardware command three lines above. The event catalog has had `access.restored` since B-006 and the comms consumer has subscribed to it since B-030; nothing ever emitted it. Fixed at the source rather than worked around, and a test asserts the restore emits `restored` and not `granted`.

**Also fixed: this item nearly shipped a duplicate notification.** The first draft emitted its own `access.suspended` alongside the one `transitionGrant` already emits, which would have told the tenant twice. The events are now emitted in exactly one place and the figures the notice needs — the day count and the balance — are recomputed at send time (FR-18) rather than carried on the event, so a tenant who paid between the suspension and the dispatch sees what is true now.

**The copy is the hardest in the catalog and was written deliberately.** It tells someone they cannot reach their own property. It leads with what is safe ("your belongings are safe and nothing has been sold or moved"), says exactly what makes it stop, gives the one-tap pay link from B-051, and offers a phone number for "if that is wrong". It does not moralise — the tenant already knows they are behind, and a lecture makes the payment less likely.

**Verified:** 1164 unit/DB tests (29 new — 15 on the pure decision: the threshold boundary either side, the balance requirement, the disabled rule, pending and revoked grants left alone, the hold blocking both directions, restore on zero and on a relaxed threshold and on a credit balance, no restore on a partial payment, and US-45's exact sentence including the singular day; 14 against real grants: nothing at five days, suspension at six with the sentence verbatim, the audit entry carrying the triggering invoice and day count, a real `suspend_access` command enqueued rather than a column flipped, one notification and not two, `access.restored` rather than `access.granted`, no second suspension on the following night, the hold block, restore both nightly and inline, no restore on a partial, no action for a tenant never suspended, the disabled rule, and — the one that matters most for B-047's interaction — **a fee invoice alone never ages the clock**, so nobody is locked out over a $20 fee raised this morning). E2e: 334 passing. Typecheck, lint, build clean. One migration.

**Fixed immediately after, on the owner's instruction** `54e3069`**:** the two new settings are **not** column-only. `accessSuspendDaysPastDue` and `accessRestoreAtOrBelowCents` are in the billing policy form, in the same save as everything else that turns on the days-past-due clock — which is also where D-16 puts the restore threshold, "alongside the partial-payment allocation policy". Zero days disables the rule and the confirmation says so in words rather than echoing a number that reads like a threshold of nought. The form carries one line of prose about what suspending actually does, because it is the only setting on that page that stops a tenant reaching their own property.

**Left behind.** **No staff override**: a manager cannot restore access manually from the profile for a tenant they have made an arrangement with — the honest path today is placing a `payment_plan` hold, which is arguably the better record anyway, but it is not the same thing as "let them in now". **The suspension is not surfaced on the delinquency queue** (B-059) or anywhere but the tenant profile. **`daysPastDue` is read per lease and maxed**, which is right, but a tenant with leases at two facilities is evaluated independently at each — correct, and worth knowing. **Nothing tests the ~2-minute SLA end to end**: the inline call is asserted directly, but no test drives a Stripe webhook through to a gate command, because that needs the Stripe key this project still does not have.

---

### B-048 — Partial payments and refunds ✅ `ffa77cd`

US-22's configurable allocation order and US-23's refunds. No new decision number — D-28 already settled the settlement direction and this generalises it.

**Found and fixed: counter payments were never allocated at all.** B-039 posted a `payment` ledger entry and stopped there, so however much cash came across the desk, every invoice stayed `open`. The balance moved and the invoices did not — which is the exact split that makes autopay re-charge an invoice a tenant paid in person, and makes AR ageing report money that is already in the till. It had been true since B-039 and became reachable the moment B-044 created invoices. Counter payments now allocate inside the same transaction as the payment.

**Decided: the order is a permutation of four fixed categories, edited as four selects.** Free text would invite a typo that silently demotes a category to last. And a category genuinely left out is paid **last rather than never** — a misconfigured order should degrade to a worse sequence, not turn money uncollectable.

**Decided: within a category, oldest first, then by invoice id.** The tiebreak is not fussiness: two invoices due the same day must allocate identically on every run, or a receipt reprinted tomorrow disagrees with the one the tenant was handed today.

**Decided: an over-payment is reported, never placed.** Where surplus money goes — refuse it, hold it as a credit, refund it — is a decision, and the allocator does not make it silently. Money allocated to "the oldest thing" is how it ends up somewhere nobody can explain.

**Decided: an explicitly named invoice still wins.** Autopay raises a charge *for* one invoice (B-045), and settling a different one would leave the invoice autopay believes it paid still open — so the next night's run charges the card again. The named invoice is still checked against the payment's own tenant and facility first, because it arrives through Stripe metadata.

**Decided: a refund is its own `Payment` row, never an edit of the original.** The original is a fact — money arrived on a date, against a receipt number a tenant is holding — and editing it would make the receipt disagree with the record. The card refund is made **before** the local write: a refund we recorded and Stripe never made would tell a tenant they had their money back when they did not.

**Decided: cash and cheque refunds are recorded `pending` — a payable.** The money has not left until somebody opens the drawer or writes the cheque, and marking it succeeded would put a refund in the books that has not happened. Cheques require a number so the payable can be reconciled against the bank.

**Decided: refunding unwinds the allocation.** An invoice left reading `paid` on money that went back is uncollected forever and invisible to every ageing report. The allocation rows are trimmed and the invoice totals recomputed, so the invoices reopen exactly as far as the refund went.

**Decided: refunding a card payment as cash is allowed, and audited as a changed method.** It is a real counter case — the card is closed and the tenant wants cash — and it is also the shape an internal fraud takes. The log says it happened rather than leaving it to be inferred.

**Found by a test I wrote, and fixed: a partial refund zeroed the invoice.** `recomputeInvoices` summed allocations on `succeeded` payments only. The moment a partial refund flipped the original payment to `partially_refunded`, the money the tenant had **not** been given back stopped counting, and an invoice they had part-paid snapped to `amountPaidCents: 0`. The allocations are the truth; the payment's status is a summary of the payment, not of what it settled. `partially_refunded` and `refunded` now count — a fully refunded payment has no allocations left and contributes zero either way.

**Also fixed: three of my own audit assertions were passing on luck.** `audit_log` is append-only and never cleaned between tests, so several tests in a file leave rows on the same lease or grant. An unordered `findFirstOrThrow` returned an arbitrary one — `holds-db` failed on roughly one run in three, and two siblings in `holds-db` and `access-suspension-db` had the same latent fragility. They are now scoped to the specific hold via the audit context, or ordered newest-first. Two consecutive clean full runs after.

**Verified:** 1198 unit/DB tests (34 new — 16 on the pure allocator: the default order paying tax then fees before rent, oldest-first within a category, stability across input order, a configured order honoured, a missing category paid last, splitting, never over-allocating a claim, the over-payment reported, and the sum-back property; 18 against real rows: a partial payment splitting across categories, an older invoice cleared before a newer, a fee cleared before older rent under the default order, a facility that puts rent first, idempotency on reapply, a waived fee never resurrected, the cash refund as a payable, the ledger entry that increases what is owed, full and partial unwinding, the audit with its changed-method flag, and the five refusals — no reason, no permission, over limit, over the original across several refunds, and a payment that never succeeded). E2e: 338 passing. Typecheck, lint, build clean. One migration.

**Left behind.** **No portal-side allocation display** — US-22 wants it "at payment time and on the receipt", and the counter path returns it but the POS screen and the portal receipt do not yet render it; the data is there and it is a rendering job. **No credit balance**: an over-payment is refused at the portal (B-035's existing rule) and reported as unapplied at the counter, but there is nowhere to bank it — prepayment needs a credit concept nothing has built. **`refunds:request` is unused**: US-23 distinguishes requesting from approving, and only the approve path exists — an over-limit refund tells the actor to ask a manager rather than creating an approval request, which is the workflow B-079's org hardening would carry. **No card refund has been made against real Stripe**, the same wall every payment item has hit. **A cash refund payable has no settlement step** — nothing marks it paid when the drawer opens, so it sits `pending` forever; that belongs with B-078's drawer sessions.

---

### B-049 — Tenant ledger screen ✅ `dac5527`

The first screen that renders what the last eight items have been writing. US-24's chronological ledger, its totals, its reconciliation, and a CSV export.

**Decided: the reconciliation is a function with a test, not a sentence in a document.** US-24's AC is "ledger totals always reconcile to invoice totals and reported AR", and that is the whole item. A ledger a tenant reads and an AR figure a manager reports have to be the same number arrived at two ways; the moment they drift the operator stops trusting both — the failure D-25 recorded for the metrics module, in a different place. So `reconcile()` lives in core beside the running balance, and the screen states the result rather than assuming it.

**Decided: a discrepancy is reported with its likely cause, and the two directions read differently.** Too much ledger means something was charged without an invoice behind it; too much invoice means a payment is posted against the wrong lease, or an invoice was raised without its ledger charge. A manager needs to know which before they ring anyone, and "does not reconcile: $29.00" tells them neither.

**Decided: a charge with no invoice behind it reconciles rather than alarming.** B-026 posts the move-in charge before the billing engine exists, by design. A reconciliation that called that a discrepancy would cry wolf on every tenant who ever moved in, and an alarm that is always on is not an alarm. Both the charge and anything settling it are counted, so a move-in paid at the counter nets to zero rather than reading as a discrepancy in the other direction.

**Decided: entries are never re-signed.** A payment stays −$50.00 in the row, because the ledger is append-only (FR-8) and a screen that flipped signs to make a column look tidy would be presenting something other than the record. The *summary* turns them round — payments, credits and write-offs as positive magnitudes — because "Payments: −$129.00" reads as a payment that went the wrong way. The balance is still computed from the signs, so the two cannot disagree, and a test asserts the summary's balance equals the last running-balance line.

**Decided: ordering breaks ties on id.** A charge and the payment settling it are routinely written in one transaction with identical timestamps. Without a stable second key the running balance renders one way today and the other tomorrow — and a tenant can hold two statements up and show that they disagree. Tested by feeding the same rows in both orders.

**Decided: an adjustment sits in neither summary column but inside the balance.** It can go either way and bucketing it as a charge or a credit would be a guess; what it must not do is fall out of the number that has to reconcile.

**The export is generated from the identical call as the screen** — the structural guarantee B-042 established, rather than a second query shaped close enough — and it is `private, no-store`: per-tenant money has no business in a shared cache. The e2e asserts the closing balance on the page equals the last balance in the file.

**Verified:** 1223 unit/DB tests (25 new — 16 pure: accumulation in date order, the id tiebreak proving a reprint is identical, signs preserved, a settled lease ending at zero, reductions summarised as positive magnitudes, a refund still an increase, the summary balance agreeing with the last line, an adjustment in the balance but not the columns, and every reconciliation branch including the credit balance; 9 against real rows: order and running balance, the invoice number named, a matching lease reconciling, the uninvoiced move-in charge reconciling both before and after payment, a real discrepancy reported with the right cause, and three authorization refusals). E2e: 342 passing, including an axe-clean ledger and the CSV-matches-screen assertion. Typecheck, lint, build clean. No migration.

**Left behind.** **No PDF.** US-24 says "CSV/PDF" and only CSV exists — there is no document renderer in this project, and the first one arrives with **B-061**'s notice generation. **The ledger is per lease, not per tenant**: a tenant with two units has two ledgers, which is right (the ledger is the lease's record and the balance that ages is per lease) but means there is no single statement for a tenant with several units. **No date filtering or paging** — a lease five years old renders every row; fine now, and a filter belongs with **B-084**'s reporting depth. **Nothing links to it from the delinquency or billing screens**, only the tenant profile. **The reconciliation is computed on read and not recorded**: nothing alerts on a lease that stops reconciling, so a discrepancy is only seen by whoever happens to open that ledger — a scheduled check belongs with the monthly close in B-084.

---

### B-052 — Past-due dunning ladder ✅ `aa421bc`

CN-3's ladder, CN-5's halts, and the tone escalation as content. Everything it needed was already built — B-050 owns the template pipeline, B-096's holds already declare `halt_dunning`, B-051 supplies the one-tap link, and `daysPastDue` has been the shared clock since D-25. This item is mostly the wiring, and that is the point.

**Decided: there is no scheduler in comms, and that is the whole architectural constraint.** CN-3 is explicit — steps are driven by the billing engine's day events "not by an independent comms-side calendar, so comms can never disagree with billing about what day a tenant is on". The nightly `billing.dunning` job computes the day count from the same `daysPastDue` every other consumer reads and emits one event per step; comms react through the ordinary rule pipeline. A second calendar here is exactly what would let a tenant be told they are on day 10 while billing believes day 5.

**Decided: at-most-once is keyed on the anchor invoice, and on the DAY rather than the position.** The day count is measured from the oldest unpaid invoice's original due date, so that invoice is what the ladder is about — and when it is cleared and a later one becomes the anchor, the ladder starts again for that invoice. That is what "at most once per invoice per step" asks for, and a test drives it: a tenant who clears September and falls behind on October is chased about October. Keying on the day rather than the position means an operator inserting a step between two existing ones does not re-fire the ones already sent.

**Decided: the settled-balance halt is checked on the money, not the day count.** CN-3 says "a payment at 11:58pm must suppress the midnight step", and that only works if the balance is what is checked — the day count is a historical fact about when someone fell behind and does not decrease when they pay. The other two halts, move-out and a hold, are checked *before* the arithmetic, in the order a person would.

**Decided: a lease with nothing due yet is not a halt.** Distinct states with distinct meanings: nothing has stopped, the ladder simply has not reached a rung. Reporting it as a halt would put a line on the Billing Runs screen for every current tenant every night and drown the two that matter.

**Decided: tone escalation is one template, not four.** CN-3 requires the escalation be content rather than code, and the mechanism is two merge fields chosen from the step's position. One rule and one template is what B-053's editor will hand an operator; four templates would be four things to keep in step with each other. A position beyond the four written rungs reuses the firmest rather than rendering an empty paragraph.

**The copy was written to the same rule as B-050's, and it matters more here.** These reach people who are behind, not people who are dishonest. Day 1 says "it happens, and it is quick to put right". Day 10 warns about gate access — which it can, because B-098 genuinely suspends it. Day 30 says "we would have to begin the formal collection steps our lease and state law allow" and deliberately **names no date**: the lien pipeline is Phase 2, and a threat with a date we cannot keep is worse than saying less. A test asserts no date appears in that rung.

**Decided: the hold check is in both places.** The emitter skips a held lease, and the notification rule carries `lease_on_hold_dunning` as well. Not redundancy for its own sake — an event emitted before a hold was placed can still be sitting in the outbox when it is, and the send-time check is the one that catches that.

**Verified:** 1255 unit/DB tests (32 new — 16 pure: the default ladder, sorting and discarding nonsense days, at-most-once, catching up missed rungs in order, the day-keyed insert case, all three halts with move-out and hold checked before the money, the credit balance, and "nothing due yet" distinguished from a halt; 13 against real rows: nothing before the first rung, day 1 on the first day, no repeat on later nights, idempotent on a re-run, a month-long catch-up emitting all four in order, the settled halt mid-ladder, the hold and move-out halts with their reasons, a fee invoice never anchoring the ladder, the ladder restarting for the next invoice, the position carried for the template, a facility with different days, and one with no ladder at all; 3 in comms: the tone escalating across rungs, the last rung naming no date, the pay link present, and a held lease skipped at send time). E2e: 342 passing. Typecheck, lint, build clean. One migration.

**Left behind.** **No per-step channel or template override.** CN-3 says each step defines "channels, email template, SMS template, and skip conditions"; today every step uses one template and one channel, and the step's identity reaches it only as a position. Splitting is a rule-per-step change once **B-053**'s editor exists to manage them. **SMS is still absent** (B-074), so the whole ladder is email. **CN-3's "restart ladder" option on partial payment is not built** — the default (re-render the remaining balance in later steps) is what happens, and the alternative has no setting. **CN-5's promise-to-pay pause is a `payment_plan` hold** rather than the P2 "pause dunning N days" control, which is arguably the better record but is not the same thing. **The deferral to lien-stage notices** (CN-5's last AC — no chirpy reminder the same day as a lien notice) has nothing to defer to yet; it belongs with **B-063**.

---

### Integration pass — the money loop against real Stripe ✅ `a4c65c4`

**Not a backlog item.** Nine nightly jobs had been built over one session, each tested alone against disposable fixtures, and the chain had never run. Every genuine defect found this session lived at a seam — `billingDay` hardcoded where checkout meets billing, billing events resolving to no comms recipient, `access.granted` emitted on a restore, counter payments never allocated — and none of them was findable by a unit test. This is the test shaped like those bugs.

**Prerequisite closed:** Stripe test-mode keys are configured for the first time. Six items had shipped on the strength of mocks (B-035, B-036, B-043's card scan, B-045's autopay, B-046's decline codes, B-048's refunds); none had ever made a real call.

**What it drives.** One seeded lease across eight phases and roughly six weeks of business dates, with a live `stripe listen` forwarding real webhooks to the dev server:

1. September rent generated five days ahead
2. A **real off-session charge** on `pm_card_visa` — and the ledger stays open until the **webhook** comes back and settles it
3. October **declines for real** on `pm_card_chargeCustomerFail`, with Stripe's own code on `payment.failed`
4. The second decline flags a manager; retries land on +1 and +3 and **not** on +2
5. A late fee on day 5, on its own invoice, at the greater of $20 or 10%
6. Access suspended on day 6, with a real `suspend_access` command enqueued to the gate
7. The dunning ladder chasing on days 1, 5 and 10
8. A good card clearing rent **and** the fee, every invoice closing, the ledger returning to zero, and access restoring with nobody deciding to act

**All eight passed on the first run**, which was not the expected outcome and is worth stating plainly rather than dressing up: the seams held. Verified independently against Stripe's own API rather than trusting the assertions — six PaymentIntents, three `generic_decline`s and three successes, matching the run log exactly.

**One false alarm, checked rather than assumed.** Stripe's API reports `off_session: false` on every intent. It is not a defect and not a field Stripe returns — `off_session` is request-only. The real evidence the charges were off-session is that they succeeded with no browser, no client confirmation and a stored `payment_method` set at create.

**Found and fixed: the suite's default 5-second timeout was too tight for the DB tests.** Four failed in one afternoon — three in `autopay-db`, one in `cron-catchup-db` — every one passing in isolation, every one a `Test timed out in 5000ms` rather than a failed assertion. They make dozens of sequential round-trips to a **remote** Postgres, and a multi-night billing walk legitimately takes six or seven seconds; adding a dev server and a webhook listener holding connections tipped them over. `testTimeout` is now 20s and `hookTimeout` 30s — headroom rather than indulgence, still far below anything a genuine hang would need. Two consecutive clean full runs after.

**The test is opt-in.** `npm run test:integration`, gated behind `RUN_LIVE_INTEGRATION=1`, because it makes real Stripe calls and needs two background processes. A test that fails for reasons unrelated to your change is one nobody trusts, and a red suite nobody trusts is worse than no suite.

**Left behind.** **The webhook signing secret is per `stripe listen` session** — it reissues on every start, so `STRIPE_WEBHOOK_SECRET` goes stale whenever the listener restarts and every webhook then fails signature verification silently from the app's side. That is a footgun for the next session and is written into the test's own header. **No refund is exercised** — B-048's card refund path still has never run against real Stripe. **The portal and checkout payment screens are not driven**: this pass goes through the job layer, so the Payment Element itself is still only covered by the e2e "call us" fallback. **One tenant, one facility, one card**: no multi-unit tenant, no partial payment, no hold interrupting mid-ladder.

---

### B-053 — Template editor + per-facility sender identity ✅ `4cfbc3e`

CN-16's editor and CN-17's identity. The item that makes every word written across B-050, B-052 and B-098 changeable without a deploy.

**Decided: one field schema, in core, serving three consumers.** The picker, the preview's sample data and the publish gate all read `packages/core/comms` — because three separate lists of "what fields exist" is three lists that drift, and the one that drifts silently is the gate. Before this, the only statement of what a template *could* use was the `requiredMergeFields` array saying what it *did*; publishing was unguarded.

**Decided: publishing is blocked, not warned.** A template referencing a field its event cannot supply fails at **send** time — inside a job, hours later, with the tenant simply never hearing from us and nothing on any screen saying why. That is the failure CN-16's gate exists to prevent, so it refuses the save. A known-but-*undeclared* field is reported and allowed: a line that renders empty is a legitimate choice, and the render guard already refuses to mail a surviving placeholder.

**Decided: the preview renders through the same `renderEmail` a real send uses.** A lenient preview is worse than none — it would tell an operator the template is fine when it is not. Anything that would fail at 2am fails here instead, in front of the person who can fix it.

**Decided: saving is append-only.** A new version, the previous deactivated, never an edit in place — because `Message` records the version it sent, and that is what lets a message from last Tuesday be reproduced exactly as it went out after three subsequent edits. A lien file may depend on that.

**Decided: test-send goes to the actor's own signed-in address, never a typed one.** A test-send that accepted an arbitrary address is an open relay wearing an admin screen: anyone with settings access could mail anyone, from the facility's authenticated domain, with content they wrote. It also runs through the real provider selection, so the sandbox rules and the kill switch apply exactly as they do to a tenant send.

**Decided (CN-17): the display name is per facility; the address is not.** Every facility sends from the one authenticated domain, because SPF, DKIM and DMARC are configured there — giving each site its own sending address would need a DNS setup per facility, and until that was done its mail would fail authentication and land in spam. CN-17's own wording puts the facility identity in the *name* and routes the human reply to `replyTo` for exactly this reason. The **postal footer is appended by the pipeline**, not written into each template, because it is a CAN-SPAM requirement and a template author forgetting it is the failure that rule exists to catch.

**Found and fixed — a real bug, latent since B-035 and invisible until Stripe was configured this afternoon.** `createChargeIntent` derived its Stripe idempotency key from the stable `reference` but put the **freshly-created local `Payment` id** in the request metadata. Same key, different parameters on every call — which Stripe rejects with `StripeIdempotencyError`. In practice: **reloading the portal pay screen returned a 500**, and two tenants could never be on it at once. It had been unreachable for the project's entire life because no Stripe key existed; it surfaced within ninety minutes of one arriving, via the e2e suite, one item later. Nothing ever read that metadata — the link exists in the other direction on `Payment.stripePaymentIntentId`. Verified the corrected shape is genuinely idempotent by issuing two identical requests under one key against real Stripe and confirming the same intent came back. The key is namespaced `v2` because Stripe remembers a key's parameters for 24 hours, so the old shape would otherwise keep conflicting until it aged out.

**Also fixed: three e2e tests encoded "Stripe is not configured" as the expected state.** True for the whole project until this afternoon, false the moment a key arrived. One asserted the "call us" fallback rather than the control that charges; one broke on a strict-mode violation because the Payment Element renders an alert region of its own; one used a selector for an element that lives inside a Stripe iframe. All three now assert the behaviour rather than the environment — the itemisation before the charging control, whichever control that is.

**Also fixed: a running dev server holds a stale Prisma client.** Adding the two CN-17 columns and regenerating left the server returning `Unknown field emailFromName` while every unit test passed, because vitest reloads the client each run and a long-running dev server does not. Added to `CLAUDE.md` as a third hard-won rule, since it will cost the next session twenty minutes otherwise.

**Verified:** 1291 unit/DB tests (36 new — 27 on the schema and gate, including a parameterised guard that **every one of the 15 seeded templates passes its own publish gate**, which is what catches the catalog drifting from what the service actually supplies; 9 against real rows for listing, preview, the two refusals, override-without-touching-the-default, append-only versioning, and the audit). E2e: 348 passing, including an axe-clean editor and the publish gate refusing from the browser. Typecheck, lint, build clean. One migration.

**Left behind.** **No SMS half** — CN-16 asks for an SMS body with a segment counter and a 160-character warning; there is no SMS channel until **B-074**, so the editor is email-only. **No version history UI**: old versions are kept and a `Message` can still name one, but nothing shows them or offers a revert — the data is there and it is a screen. **No diff or draft state** — saving publishes immediately; there is no "save without publishing", which CN-16 does not ask for but an operator will. **The picker does not insert** — it lists fields with descriptions rather than clicking them into the body at the cursor, which needs client-side state this server-rendered form does not have. **Test-send always renders sample data**, never a real tenant's, so it proves the wording rather than the merge.

---

### B-054 — Delivery events, the suppression list, and the send log ✅ `fecf25a`

FR-14's provider webhook, FR-15's consequences, CN-18's message history and CN-20's suppression screen. Until this, `Message.status` stopped at `sent` — meaning "we handed it to Resend", which is not the same claim as "the tenant received it". A send log that says `sent` for an address that hard-bounced eight months ago is worse than no log: it asserts something untrue about service of notice.

**What it built.** `/api/comms/webhook` verifying Resend's Svix signature against the raw body, with a five-minute replay window. A normalised status state machine in `packages/core/comms/delivery.ts`. The bounce consequence chain — suppression, tenant flag, `Task` — in `apps/web/lib/comms/delivery.ts`. CN-18's message history expanded from four fields to the full shape, with the rendered body in a native `<details>`. CN-20's suppression screen at **Settings → Suppressions**: search, manual add, and lift-with-a-reason where lifting is allowed.

**Decided: idempotency comes from the status ranking, not from a table of seen event ids.** FR-14 asks that "provider retries must not duplicate status rows"; a `processed_events` table would deliver that and nothing else. Ranking statuses so one never moves backwards delivers it *and* handles the case an id table cannot — **events arriving out of order**, which providers do routinely. A `delivered` webhook regularly lands before the `sent` it followed, and a handler that wrote whatever arrived would leave the log claiming less than we know. `suppressed` and `cancelled` outrank everything: those are decisions we made before sending, and a provider callback has no standing to revise them.

**Decided: only a hard bounce and a spam complaint carry consequences.** A soft bounce — full mailbox, temporary server failure — deliberately does nothing. Suppressing on one would silently cut a paying tenant off from every notice this system sends, on the strength of a mailbox being full on a Tuesday.

**Decided: a complaint is recorded as `delivered`, and raises no task.** It arrived; the recipient reported us. Its real consequence is a suppression CN-20 forbids removing. No task, because the tenant asked not to hear from us and a staff task saying "call them about it" is the opposite of honouring that. A hard bounce is the reverse — it raises a **high-priority `no_reachable_channel` task**, because email is the only channel this system has until B-074, and "we cannot reach this tenant at all" is not something to leave in a queue nobody is told about.

**Decided: lifting a `hard_bounce` suppression is the only way the tenant flag comes off.** The primary email is the login identity and is not editable from the admin side, so there is no "they gave us a new address" path that could clear it. Leaving it set forever would put a permanent red banner on the profile, and a banner that is always there is one nobody reads.

**Decided: no `svix` dependency.** The scheme is one `createHmac`. The verifier lives in `apps/web/lib/comms/webhook-signature.ts`, split out of the route for the same reason B-028 split the hardware one — it is the entire security boundary of a public unauthenticated endpoint and deserves tests that do not need a running server. A forged `email.bounced` is a quiet denial of service against exactly the person a lien notice has to reach.

**Verified:** 1326 unit/DB tests (35 new — 17 on the state machine, event mapping, consequences and masking; 9 on the signature and replay window, including a genuine signature accepted, a tampered body rejected, and rotation-style multi-signature headers; 9 against real rows for the bounce chain, its idempotency under redelivery, the two refusals CN-20 requires, and the flag clearing on lift). Typecheck and lint clean. One migration.

**Left behind.** **Unexercised against real Resend** — `RESEND_API_KEY` is unset, so no live delivery event has ever hit this route; the signature scheme is verified against payloads this repo signs itself. Same constraint Stripe had until B-053's afternoon. **No SMS half**: `email.*` events only, and `no_reachable_channel` currently means email — there is no SMS channel until **B-074**. **`filtered` is unmapped** — FR-14 names it as a terminal state but Resend has no corresponding event, so nothing produces it. **No dashboard**: rates, detectors and the dead-letter surface are **B-075**, which is why the failure queue here is a `Task` and not a screen. **History is capped at 20 messages** with no paging, and the CSV export a lien file would want is not there.

---

### B-055 — Revenue and delinquency-aging reports ✅ `485aa97`

US-39.4 and US-39.5, the last two MVP reports. Both are money, and both had a specific failure mode the PRD names rather than leaves to be inferred.

**What it built.** `/admin/reports/revenue` — billed vs collected by category (rent, fees, protection, tax) with discounts given, write-offs and refunds, over a picked date range. `/admin/reports/delinquency` — every lease carrying a balance, aged, with tenant detail, per-facility buckets, dunning-step distribution and total exposure. CSV for both, from the same functions the screens call. `REVENUE_CATEGORIES`, `billedByCategory` and `collectedByCategory` in `packages/core/metrics`.

**Decided: collected-by-category replays the allocation order, it does not split proportionally.** `Invoice` stores one paid total, not a paid amount per line, so the per-category figure has to be derived. A $30 payment against $10.64 tax + $25 fee + $129 rent reports as tax $10.64 and fee $19.36 — because that is what `allocatePayment` actually did with the money. A proportional split would report $2, $4.55 and $23.45: tidier, and contradicting the tenant's own ledger the first time anyone checked. `collectedByCategory` calls `allocatePayment` rather than restating the rule, so a facility that reorders its categories gets a report that follows.

**Decided: the split is computed on a running total, not per payment.** An invoice paid $30 in March and $50 in April cannot have April's categories worked out from April alone — the order had already consumed the tax. April's share is `split($80) − split($30)`, which means the report reads every allocation on a touched invoice including the ones outside the range. Verified against exactly that case.

**Decided: billed is accrual, collected is cash, and the gap is the point.** Billed is what invoices *issued* in the range charged; collected is what payments *received* in the range settled. A facility whose collected trails its billed month after month is not having a bad month, it is accumulating AR — the same money the aging report is looking at from the other end, which is why the two screens link to each other.

**Decided: refunds are informational, not a subtracted line.** A refund unwinds the original payment's allocation rows (B-048), so collected is *already* net of it. Showing it again as a deduction would double-count, so it sits in its own tile saying so. A consequence worth knowing: **re-running last month's revenue report after a refund shows less collected than it did before.** That is what the data says, and US-39 defers frozen month-end snapshots to P2 explicitly.

**Decided: an ended lease with a balance stays in the aging report.** US-14's AC in its own words, and the report filters on the *balance*, never on the lease status — with `Moved out` shown as a column so a former tenant is visible as one rather than absent. A move-out is when a balance is least likely to be paid and most likely to be forgotten; a `status: 'active'` filter would write off every former tenant's debt by omission. There is a separate former-tenant exposure figure beside the total for the same reason.

**Found and fixed: the AR aging tiles were readable with only `reports:operational`.** The permission catalog's own description of `reports:financial` is "Revenue, AR, and delinquency aging", but `delinquencyReport` (B-042) used a check that passed on *either* reporting key — so a counter agent, whose role holds only the operational one, could read the portfolio's receivables from the reports page. Added `financialFacilities`, which filters rather than throwing: a regional manager can legitimately hold financial access at one site and operational at another, and throwing would deny them the whole report instead of showing the half they are entitled to. Both new reports and the existing tiles now scope through it.

**Verified:** 1355 unit/DB tests (29 new — 11 on the category split including a property test that no cent is lost at any payment amount, 6 on the half-open range parser, 12 against real rows for both reports, the cross-period running total, the roll-up rule, the ended-lease AC and the permission scoping). Typecheck, lint and build clean. No migration.

**Left behind.** **No merchandise category** — US-39.5 names one and nothing in the system sells merchandise, so an always-zero column would suggest a number is being tracked when nothing produces it; it arrives with retail POS. **No trend or comparison** — each report is one range, with no prior-period column, which is the first thing an owner will ask for. **No month-end freeze**: figures move when a refund or a backdated payment lands, deferred to P2 by US-39 itself. **Aging is point-in-time only** — there is no "as of last month end", which a close process needs. **Report 6, deposits reconciliation, is still unbuilt** and belongs to **B-078** with the drawer. **Unapplied money is a single figure**, not a list of which payments are sitting unallocated.

---

### Golden path 2 — demo checkpoint ✅ `9d94742`

The backlog's second demo checkpoint, placed after B-055: *nightly run invoices a seeded lease → due-soon reminder → simulated failed payment → dunning step 1 → magic-link payment halts the ladder.* Run, and **kept** as `tests/golden-path-2-db.test.ts`.

**Decided: the checkpoint is a test, not a script.** A demo that ran once proves the flow worked that afternoon. This one drives the real `SCHEDULED_JOBS` registry — every per-facility job in `localHour` order (invoices 1am, fees 2am, autopay 3am, access 4am, dunning 5am), with the event outbox drained between nights — so it fails a pull request the day somebody breaks the chain between two links. Only Stripe and the clock are substituted, and the clock only because the runner takes a business date as an argument anyway.

The night-by-night narrative it prints, and every step of it is asserted:

```
27 May · invoices raised for June — 000001 $129.00 due 1 June (+ 1 more)
27 May · due-soon reminder sent — "Rent for unit M-e745 is due Sunday, May 31"
27 May · no reminder to the autopay tenant — FR-18: autopay covers it
 1 Jun · autopay declined (card_declined) — tenant told, balance still $129.00
 2 Jun · one day past due — dunning step 1 sent
 2 Jun · retry one declined; 3 Jun · nothing scheduled, card untouched
 4 Jun · retry two declined
 6 Jun · five days past due — dunning step 2, retry three declined
 6 Jun · retries exhausted — a failed_payment task is raised for staff
 7 Jun · paid $129.00 through the emailed link — balance $0.00, invoice settled
8–12 Jun · ladder silent, card untouched — a paid tenant is left alone
      — access never suspended: paid on day 6, threshold is 6 (D-16)
```

**The golden path as written needs two tenants, not one.** The first run surfaced this: FR-18's premise check deliberately *cancels* the due-soon reminder for an autopay tenant, with `skipped: autopay_covers_it`. Telling somebody to go and pay a bill the system is about to collect itself is precisely the noise that rule exists to stop — so a single autopay tenant cannot produce both a due-soon reminder and a failed autopay. The checkpoint now seeds a second, manual-pay lease at the same facility, and asserts the cancellation on the autopay one as a behaviour rather than working around it. This is a facility's night, not one tenant's.

**Found and fixed — a real robustness bug in the event dispatcher.** `dispatchEvents` ends its catch block with the comment *"One bad event must not stop the rest of the batch"*, and the implementation had a hole in exactly that promise: the bookkeeping `prisma.eventDelivery.update()` inside the catch throws when the row has gone, and that throw escapes the loop and aborts the whole tick — leaving every remaining event undelivered until the next one. Both bookkeeping calls are now `updateMany`, which matches zero rows and moves on. Only reachable today when a delivery row vanishes mid-flight (cascade from a deleted `DomainEvent`, which nothing prunes in production, but which a parallel test suite does), and closed anyway because the cost is one word and the failure mode is a silently skipped batch of tenant notifications.

**Found and fixed — a test that failed about one run in three.** `bootstrap-owner.test.ts` deactivated the owners it had created and then asserted a fresh bootstrap succeeds *without* `--force` — which only holds if no live owner exists **anywhere** in the shared database, a precondition another parallel suite can invalidate at any moment. It now accepts both outcomes and asserts the one thing it actually cares about: that whatever blocked the bootstrap, it was not one of the owners it had just deactivated. The third hard-won rule in `CLAUDE.md`, met again.

**Verified:** the checkpoint's 10 assertions, plus **two consecutive clean full-suite runs** — 1365 tests, 102 files — because a suite that passes once has not been shown to be repeatable. Typecheck and lint clean.

**Left behind.** **No live Stripe** — the decline is the same mock every billing suite uses; the real-money version of this arc is `npm run test:integration`, which was run against Stripe test mode during B-053. **The pay-link payment goes through the portal's functions, not its HTTP route** — `mintPayLink` → `checkPayLink` → `applyPayment` → `attributePayment`, which is everything but the request handler; the browser half is covered by e2e. **No late-fee step**: the seeded facility has no fee ladder configured, so the 2am job runs and correctly does nothing. **Access suspension is asserted as absent**, not exercised — the tenant pays on day 6 and the threshold is 6, so the arc that leads to a suspended gate is still only covered by its own suite.

---

### B-064 — Gate hours enforcement and the access event log ✅ `7bf86ae`

PRD 03 US-4 and US-5. The schedule data and the settings form already existed from B-008; nothing enforced them, nothing propagated them, and no screen showed what happened at the gate.

**What it built.** DST-safe schedule evaluation in `packages/core/access/gate-hours.ts`. A `set_time_window` gate command, propagated to every grant on a settings save and on provisioning. `AccessGrant.extendedHours` — the 24-hour add-on — with its control on the tenant profile. Anomaly flags computed at ingestion. `/admin/access`: a filterable gate log with flag counters. Recent gate activity on the tenant profile. A new `access:events` permission.

**Decided: the UTC offset is never stored or derived.** Every evaluation asks `Intl.DateTimeFormat` what the wall clock reads in the facility's zone at that instant. The bug this avoids is specific: a facility on `America/Chicago` is UTC-5 in July and UTC-6 in January, so any code that subtracts a cached offset is correct for eight months and locks every tenant out an hour early for the other four — and gets both transition days wrong in both directions. Six tests pin the two 2026 transitions from both sides.

**Decided: an unconfigured schedule means OPEN, not closed.** A facility that has never filled the form in has not opted into enforcement. Defaulting the other way would have locked every tenant out of every unconfigured facility the moment this shipped.

**Decided: the window lives on the controller's row, not read from `Facility` at keypad time.** `SimulatedGateCode.windowSchedule` holds what the vendor was last *told*. Peeking at our own database instead would have been fewer lines and would have made one failure impossible to reproduce — hours edited, command dead-lettered, fence still running last week's schedule. That is the failure the whole propagation path exists for, so the simulator has to be able to exhibit it.

**Decided: propagation is a queued command per grant, not a write.** Same outbox, retry, backoff and dead-letter path as every other gate instruction (FR-3). Saving hours to a column changes nothing at the fence, and a direct write would "succeed" while the gate disagreed. The settings save now returns how many commands it enqueued.

**Decided: flags are computed at ingestion and stored, never derived on read.** Two reasons, and the second is the one that matters: `denied_repeated` is a property of a window of neighbouring events, so deriving it while rendering a filtered list means re-reading neighbours per row per page; and the flag is *evidence* — what the system thought at the time is what a manager is later asked about, and recomputing under today's thresholds would quietly rewrite it. A redelivered webhook explicitly does not recompute, or a replayed backlog (US-7 AC3) would re-count its own denials and invent a `denied_repeated` that never happened at the gate.

**Decided: an event carries every flag that applies, not the most severe.** A suspended tenant trying an old code at 3am for the sixth time is four separate observations, and collapsing them would hide three from the filter somebody is using to find exactly that pattern. `denied_repeated` counts facility-wide rather than per credential: five denials across five different codes at one gate is a stranger working through numbers, which is the more alarming version and the one a per-credential count would miss.

**Decided: `access:events` is its own permission.** A gate log says where a named person physically was and at what hour — a sharper fact than their billing history, and one somebody should be given deliberately. Granted to the three roles that already hold `access:view_codes`.

**Verified:** 1405 unit/DB tests (40 new — 19 on schedule evaluation including both 2026 DST transitions from either side, 10 on the flag rules, 11 against real rows for the full loop: hours saved → command queued → controller told → 3am denial → flagged event → filtered log, plus the 24-hour override and the permission refusal). Two consecutive clean full-suite runs. Typecheck, lint and build clean. One migration, and a re-seed — `rbac-db.test.ts` correctly caught the new permission being in the catalog but not in the database.

**Left behind.** **No holiday exceptions** — FR-5 names them; the weekly schedule has no date overrides, so a facility closing on Christmas has to edit that weekday. **No per-gate or per-zone hours**: US-4 says "and optionally per gate/zone" and there is one gate per facility in the model. **No `long_dwell` flag** — it needs entry/exit direction data the simulator does not produce, and AC3 says to degrade gracefully where the vendor cannot distinguish in from out. **No manager notifications on a flag** (AC4): PRD 03's own phasing puts "full anomaly flags + manager notifications" in Phase 2, and this shipped the MVP subset. **The log shows times in UTC**, not facility-local, which is wrong on a screen and is the next thing to fix. **No CSV export** for the gate log. **Overnight windows are impossible** — `DaySchedule` requires `open < close`, so a gate open 22:00–06:00 cannot be expressed; 24-hour access is the override rather than a schedule.

---

### B-065 — The ManualAdapter work queue ✅ `5998c56`

PRD 03 US-6. A site with a legacy keypad nobody can integrate, or a vendor mid-outage: every access change becomes a task with the exact buttons to press, instead of a command to a controller that is not listening.

**What it built.** `Facility.gateAdapter` (`simulated` | `manual`) with its control in facility settings. A `GateCommandStatus.awaiting_manual`. Instruction generation in `apps/web/lib/access/manual-adapter.ts`. Business-hours arithmetic in `packages/core/access/business-hours.ts`. `/admin/access/queue`, the list a manager works from. `gate_manual_action` in the task catalog. Adapter switching that re-routes the queue.

**Decided: a parked command gets its own status, not `pending` and not `dead_lettered`.** The retry loop exists to re-send to a controller; pointing it at a human would produce five tasks for one keypad trip. And nothing has gone wrong, so dead-lettering would fire the staff alert FR-3 reserves for genuine failure. `awaiting_manual` is the third thing that is actually true: handed over, waiting.

**Decided: the instruction is derived at render time, never stored on the task.** `Task.proof` is what staff supply on completion, and completing *replaces* it — an instruction parked there would be overwritten by the note saying it was done. The task points at its `GateCommand` through `entityId`, so the queue re-derives from the command. Nothing to keep in step, and rewording an instruction improves every open task rather than only the next one.

**Decided: overdue is measured in business hours, against `officeHours`.** AC2 says "4 business hours" and the distinction is the whole point: a change raised at 6pm on Friday is not four hours late on Friday night, because nobody was there. Wall-clock hours would escalate every after-closing task every day, and a queue that shouts on every overnight item is one staff learn to scroll past. Counted against office hours (when a human is at the desk), never gate hours (when a tenant can reach their unit) — different schedules for a reason. The general task-overdue rule is untouched: only `gate_manual_action` uses the tighter SLA.

**Decided: no escalation job.** Overdue is computed when the queue is read, so it cannot go stale and there is no nightly pass to fall behind. An unset office schedule counts every hour rather than none — the silent-failure direction would be a queue where nothing ever escalates.

**Decided: switching adapters moves the queue and nothing else.** Grants and credentials are the record of who is entitled to what and no adapter owns them (AC3). Switching back to the controller returns parked commands to `pending` and **cancels their tasks** — leaving them open would have staff keying in a change the controller is about to make. `attempts` is deliberately not reset: a command that already failed three times has not earned a fresh five. A dead-lettered command stays dead, because it gave up for a reason somebody has already been alerted about.

**Decided: the suspend instruction says "do not delete".** On some legacy panels suspend and delete are the same button, and deleting loses the code history US-3 AC3 requires be kept. The wording is tested.

**Verified:** 1437 unit/DB tests (32 new — 20 on business-hours arithmetic including a weekend skip, a DST crossing and the instruction wording; 12 against real rows for the full loop: command → task → parked → completed → settled, plus the SLA, the re-route, grant preservation and the dead-letter rule). Two consecutive clean full-suite runs. Typecheck, lint and build clean. One migration.

**Left behind.** **No per-command retry from the queue** — a task completed in error has to be fixed by re-triggering whatever raised the command; there is no "put this back". **The plaintext code is rendered on the queue screen**, which is unavoidable (somebody has to key it in) but is the one place outside the audited reveal path where a code appears, and it is not itself audited — worth revisiting with SR-2. **No notification when a task escalates** (AC2 says "escalate in the dashboard", which it does; a push to a manager is Phase 2 with the rest of US-5's notifications). **`ManualAdapter` is a facility-level switch, not per gate or zone.** **Switching to manual does not sweep already-`failed` commands into tasks immediately** — they arrive on the next drain, which is correct but means the queue can look empty for up to an hour after the switch.

---

### B-066 — SEO infrastructure ✅ `2513de6`

PRD 04 FR-SEO-1 through 7. The facility page has been server-rendered and canonical-tagged since B-016; what was missing was everything that makes a crawler able to find it, trust it, and keep finding it after somebody edits a city name.

**What it built.** `packages/core/marketing`: NAP formatting, meta templates, `SelfStorage`/`FAQPage`/`ItemList`/`BreadcrumbList` JSON-LD, URL canonicalisation, and generated facility FAQs. A `UrlRedirect` table with auto-recording on facility moves and retirements. `sitemap.xml` and `robots.txt` generated from the records. Canonical enforcement in `proxy.ts`. An FAQ block on the facility page. A Lighthouse gate on the facility template.

**Decided (D-32): the URL stays `/storage/…`.** PRD 04 US-1 AC1 says `/storage-units/…`; PRD 01 US-103 says `/storage/…`, which is what shipped. Two PRDs disagreeing on a detail neither argues for, resolved toward the one already indexed and linked. Recorded as a decision rather than silently followed.

**Decided: canonicalisation is pure string work on the edge; the redirect map is not.** `proxy.ts` handles casing, trailing slashes, doubled slashes and tracking parameters without touching a database, because it runs on every request. The renamed/retired-slug lookup needs a query, so it lives on the 404 path in the facility page — only requests that were already going to fail pay for it.

**Decided: tracking parameters are an explicit strip-list, never a keep-list.** `?q=`, `?size=` and `?sort=` change what the page shows; stripping them to tidy the address bar would redirect a search for 78704 to an empty results page, which is worse than any duplicate-content problem. Remaining parameters are sorted, so `?a=1&b=2` and `?b=2&a=1` are one URL.

**Decided: 308, not 301.** Unlike 301, it is guaranteed to preserve the method. A POST to a URL with a stray trailing slash — which a hand-typed form action produces — must not silently become a GET, or the form appears to submit and does nothing.

**Decided: structured data is generated from the record, never hand-authored.** Schema that contradicts the visible page is what gets penalised, and the only way to guarantee it cannot is for both to read the same source through the same formatter (FR-SEO-7). Concretely: `priceRange` is derived from the cheapest live rate, `makesOffer` lists only sizes with `availableCount > 0`, and every price carries `unitCode: 'MON'` — without which a crawler reads "$129" as a one-off purchase price, a much better-sounding offer than the one being made.

**Decided: absent and empty are different claims.** `prune` drops undefined values and empty arrays recursively, because `"telephone": null` positively asserts the business has no phone and `makesOffer: []` says it rents nothing. Tested in both directions.

**Decided: `renderJsonLd` escapes `<`.** Operator copy reaches this function; a description containing `</script>` would otherwise close the tag early and drop the rest into the document as markup — an XSS hole wearing a structured-data hat.

**Decided: no `aggregateRating`, ever, until there are real reviews.** US-6 AC3 gates it, and a fabricated one is the fastest available route to a manual action against the whole domain. Asserted as absent in a test so nobody adds one by accident.

**Decided: FAQs are generated from the facility record.** US-1 AC2 wants five facility-specific FAQs and there was no FAQ block at all. Generated ones cannot contradict the hours table above them; B-067 lets a marketer replace any of them. `faqPageJsonLd` refuses to mark up fewer than two questions — a single Q&A dressed as a page-level FAQ is the shape that gets ignored.

**Decided: the sitemap's `lastmod` is the facility's `updatedAt`, not the build time.** Stamping every URL with "now" on every deploy tells crawlers every page changed every deploy, which trains them to ignore the field.

**Decided: a facility move records redirects for its sub-pages too, and first write wins.** A renter with `/…/reserve` bookmarked is further along than one on the landing page. And a slug renamed twice leaves `a → b` alone rather than rewriting it to `a → c`: two hops resolve fine, and blind rewriting is how a rename cycle becomes a redirect loop.

**Found: the `facilityId` schema invariant caught the new table**, correctly. `UrlRedirect` is exempted with a stated reason — a URL is a site-wide address, and the lookup happens on a request before anything knows which facility it was for, so a `facilityId` could not be supplied at the only moment it would be read.

**Verified:** 1496 unit/DB tests (59 new — 18 on canonicalisation and noindex prefixes, 32 on NAP/meta/JSON-LD including the script-tag escape and the absent-vs-empty rule, 9 against real rows for the redirect map). E2e 325 passing. Checked live against a running server: 308s for casing, trailing slash, tracking params and doubled slashes; `X-Robots-Tag` on `/login` and `/checkout` and absent on `/storage/search`; `robots.txt` and `sitemap.xml` rendering; and all three JSON-LD blocks present on the facility page. Two consecutive clean full-suite runs. Typecheck, lint and build clean. One migration.

**Left behind.** **City pages do not exist** — `/storage/{state}/{city}` is a valid redirect target and a retired facility now points at it, but **B-071** builds the page; until then that redirect lands on a 404, which is a worse outcome than the 404 it replaced for those specific URLs and is the first thing B-071 fixes. **No per-facility meta overrides** (US-2 AC1) — the templates are in place and B-067 adds the editable fields, the character counters and the duplicate-description warning. **No images in the schema**: `image: []` until B-067's photo management, and `SelfStorage` without a photo is a weaker rich result. **One flat sitemap** — FR-SEO-5 wants segmentation above 1,000 URLs and we are two orders of magnitude away; the trigger is noted in the file. **No IndexNow ping** (FR-SEO-5 calls it nice-to-have). **The redirect map has no admin screen** — entries are created automatically and readable only from the database.

---

### B-067 — Facility marketing profile editor ✅ `239c98e`

PRD 04 US-2 and US-5. B-066 generated a title, a description and five FAQs for every facility from its record; this is where a marketer replaces any of them without a deploy.

**What it built.** Four nullable copy fields on `Facility`, plus `FacilityFaq` and `FacilityPhoto` tables. `/admin/settings/marketing`: copy editor with character guidance and a duplicate-description warning, photo management with required alt text, per-facility FAQs, a readiness checklist, and US-5's GBP card with a copy-paste NAP block. The public page renders hero copy, long-form description, a photo grid and the facility's own FAQs.

**Decided: every field is optional and falls back to the generated default.** That is the design, not a convenience — "the marketer has not got to this site yet" must never mean "this page is broken". Saving an empty title stores `null` rather than an empty string, so clearing a field is a real action that restores the generated one.

**Decided: a facility's own FAQs replace the generated set outright, never append to it.** A marketer who has written four answers has decided what the page says; padding back to five with boilerplate would put words in their mouth. US-1 AC2's "at least five" is why the generated set remains the fallback at zero.

**Decided: character guidance warns, it does not block.** ~60 and ~155 are what a result renders, not limits an engine enforces; a marketer who wants 70 characters has a reason, and refusing would move the copy into a spreadsheet. Only the hard maxima (90 / 200) refuse, and the message names what they really are — a paste that ran on.

**Decided: `alt` is a NOT NULL column, not a nullable one with a lint rule.** WCAG 1.1.1 is an acceptance criterion on customer-facing work here, and a photo set where three of eleven have alt text is the normal outcome of making it optional. The save also rejects whitespace typed to get past the field.

**Decided: duplicate detection is trigram similarity at 0.8, not exact match.** The real case is somebody pasting Austin's description into Dallas and changing the city, which an exact-match check misses entirely. 0.8 rather than 0.95 because two genuinely different storage descriptions still share a lot of vocabulary — the floor has to sit above ordinary shared language and below a copy-paste. Computed against **every** facility, not just the ones the editor can see: a collision between two sites they cannot both access still cannibalises both.

**Decided: the launch gate is reported, not enforced.** The backlog asks for "at least one exterior photo per active facility". Blocking a facility from going active over a missing photo would take a rentable unit off sale to fix a marketing problem, so it is a checklist a person clears.

**Decided: no file upload.** There is no blob store (the same gap `Document.storageRef` carries), so a photo is a URL an operator pastes plus required alt text. When an upload path exists it writes the same column, and nothing else changes.

**Decided: revalidation is immediate, and the path is looked up rather than posted.** US-2 AC2's "within 5 minutes" is a ceiling; `revalidatePath` is instant. The facility path is resolved server-side from the id, because a form field naming which path to purge is a field somebody can point at another facility's page.

**Found and fixed — a test that had bitten twice.** `bootstrap-owner.test.ts` assumed it owned the global owner state: its first test expected `created: true` without `--force`, and two others asserted *which* email was the incumbent. A run of this suite that is interrupted leaves a **live** owner behind, and from then on every subsequent run of that first test fails — permanently, until somebody deletes the row by hand. That is exactly what happened here (one leaked fixture from an interrupted run, since removed). The first test now forces, because it is about the shape of what gets created rather than the refusal; the refusal tests assert the refusal without pinning the incumbent; and teardown now sweeps by email shape as well as by id, because the id list is what an interrupted run loses. The file carries a comment saying why, since this is the second fix in two items.

**Verified:** 1535 unit/DB tests (39 new — 22 on character guidance, duplicate similarity, the readiness gate and the GBP staleness rule; 17 against real rows for the fallback behaviour, the alt-text refusal, cross-facility delete scoping and the checklist dating). E2e 328 passing. **Two consecutive clean full-suite runs with nothing else touching the database** — the earlier noisy runs were my own build competing for it, and are not evidence of anything. Typecheck, lint and build clean. One migration.

**Left behind.** **No file upload, no image optimisation** — photos are external URLs rendered through a plain `<img>`, so FR-SEO-6's responsive `srcset` and modern formats do not apply to them; the aspect-ratio box reserves space so they cost no CLS. **No reordering** — photos and FAQs append at the end, and changing the order means removing and re-adding; positions are sparse so a drag handle is a screen, not a migration. **No per-facility review entry** (US-6) and therefore still no `aggregateRating`. **The duplicate check runs at read time over every facility's description** — fine at this scale, a query to revisit in the hundreds. **The GBP checklist is six booleans and a date**; nothing verifies any of it, which US-5 AC2 states plainly as the MVP position.

---

### B-097 — Phone and counter inquiry capture ✅ `c25c923`

PRD 02 §4.8 US-43. "Do you have a 10x10 and how much?" is a ninety-second call that converts often, and until now there was nowhere to put it — the web forms are a marketing item, the reservation flow is customer-facing, and the counter move-in assumes the person is standing there with a card. The consequence was a lead-to-rental report showing only web leads and looking excellent.

**Sequencing note.** This was found outstanding while starting B-068: a parser slip in an earlier count had it reading as done. It sits at position 39a, ahead of B-068, and its own backlog line says B-068 builds the *web* forms later — so it was built first. MVP now has three items left: B-068, B-069, B-070.

**What it built.** `New inquiry` in the admin header, reachable from any screen. `/admin/leads` with the capture form and the open list; `/admin/leads/[leadId]` with the quote and the hold. `Reservation.source`, `Lease.acquisitionSource`, `Lead.targetMoveInDate`/`contactedAt`/`createdByStaffId`, `Facility.leadFollowUpHours` with its settings control. A `lead_follow_up` task type and an 8am job that raises it.

**Decided: the capture form lives in the header, not behind a link.** The phone rings while somebody is halfway through a move-out. If capturing the call costs a navigation first, it goes on a sticky note instead — which is the entire failure this item exists to fix.

**Decided: phone is required and email is not — the inverse of the web form.** Somebody on a call gives a number without hesitating and spells an email badly. A lead with a wrong email is worse than one with none, because the follow-up looks sent.

**Decided: `web` and `unknown` are not offerable to a staffer.** A person at the counter is by construction not the website, and a mis-click that credited `web` would corrupt the one report this capture exists to feed. `unknown` is what history reports, never something anyone selects. A test asserts every staff-selectable source is also a `MOVE_SOURCES` member — the failure would otherwise be silent, and would surface only when the channel split was being used to decide whether to keep answering the phone.

**Decided: the hold goes through `createReservation`, not a parallel path.** A second reservation path would need its own copy of the `FOR UPDATE SKIP LOCKED` unit claim, its own expiry sweep and its own availability rules, and would be the one that eventually double-books a unit. `ReserveInput` grew a `source` field defaulting to `web`, which is the one case where defaulting is a fact rather than a guess.

**Decided: `Lease.acquisitionSource` is denormalised.** The chain that knows the answer — lease → checkout session → reservation → lead — is three joins long and every link is nullable, so a report walking it would silently under-count exactly the channels it measures. Stamped at move-in from the reservation. Null means the lease predates capture and reports as `unknown` rather than being folded into `web`. **This closes the placeholder B-042 left in `movesReport`**, which had been reporting every move-in as `unknown` and said in a comment that B-097 was where the fix belonged.

**Decided: the follow-up is a real `Task`, not a computed view.** The opposite of B-065's keypad SLA, and for a stated reason: an overdue keypad task is read off a queue somebody already has open, while an uncontacted lead has to reach the one list a part-timer checks on a Saturday (US-41). Raised at 8am local rather than overnight — a task created at 2am sat there six hours before anyone could act on it. Priority `normal`, not `high`: levelling a four-hour-old prospect with a gate that will not open for a paying tenant is how a queue stops sorting.

**Decided: `contactedAt` is stamped once and never moved.** It is what the follow-up window measures against, so re-stamping on every status change would let a lead be nudged out of overdue without anyone calling.

**Found: two schema invariants earned their keep.** The `@db.Date` check caught `Lead.targetMoveInDate` as an undeclared calendar-date field — correct, since "the 14th" is what a caller says and a timestamp would imply an hour nobody gave. And a `billingDay` spacing mismatch meant my `Lease.acquisitionSource` edit silently did not apply to the Prisma schema while the migration had already added the column to the database; the typecheck caught the divergence immediately.

**Verified:** 1552 unit/DB tests (17 new — capture validation and permissions, both prices through the same calculator the public page uses, the hold carrying `source` and marking the lead reserved, sold-out handling, follow-up raising/idempotency/exemption, the stamped-once rule, and the shared-vocabulary guard). **Two consecutive clean full-suite runs.** Typecheck, lint and build clean. One migration.

**Left behind.** **No dedup** — FR-LEAD-1's "unique per (email/phone, facility, 30-day window)" belongs with **B-068**, which is where the web forms create the volume that makes duplicates likely; two calls from the same person today make two leads. **No confirmation email or manager notification** — US-8 AC2 is a web-form requirement and comes with B-068; a counter lead is taken by the person who would receive the notification. **No promotions in the quote**, stated on the screen rather than silently omitted, until **B-070**. **A caller with no email gets a placeholder address** on the reservation so the hold can be created — the hold is real, the confirmation and expiry-reminder emails are not, and the follow-up task is what covers it. **No lead → move-in conversion attribution beyond the source column**: the reservation records which lead it came from, but nothing reports lead-to-rental rates yet.

**A flake worth recording, not hidden.** Across five full-suite runs during this item, one run failed `manual-adapter-db.test.ts` entirely (20 skipped, i.e. `beforeAll` threw) and two others failed on the concurrent `npm run build` I had started against the same database. Both suites pass alone and together, and the two runs that bracket the flake are clean at 1552. The database is remote and the suite is now 1560 tests; treat a whole-file `beforeAll` failure as connection noise rather than as a signal, but it is noise worth watching if it recurs.

---

### B-068 — Lead capture and attribution ✅ `0b2a4a9`

PRD 04 §3.5 US-8, US-10, FR-LEAD-1..3. B-097 built the counter half — a staffer taking a call. This is the same `Lead` entity reached by an anonymous stranger over the public internet, which changes exactly three things: nobody is authenticated, the input is hostile, and the same person will submit twice.

**What it built.** A quote/callback form on the facility page. `packages/core/marketing/attribution.ts` — channel derivation, the 90-day first/last-touch cookie, and dedup keys. `apps/web/lib/marketing/lead-capture.ts` with honeypot, per-submitter rate limiting and FR-LEAD-1's dedup. A `LeadActivity` table. Attribution cookies written at the edge. A `lead.created` consumer raising a high-priority task.

**Found and fixed — B-066 was silently eating every ad click.** The canonical-URL policy strips `utm_*` and `gclid` as tracking parameters and 308s. That meant a genuine ad click *always* arrived as a non-canonical URL and left as a redirect, and the cookie was only written on the non-redirect branch — so **100% of paid traffic would have recorded as `direct`**, which is precisely the misattribution the channel derivation exists to prevent. Attribution is now captured on the redirect response, before the parameters are stripped. Caught by checking the running server rather than by a test, which is the argument for doing that.

**Also fixed: the cookie was double-encoded.** `encodeTouch` percent-encoded and Next's cookie API encoded again — correct on the round trip only because two layers cancelled, and unreadable to anything else (`%257B`). Now plain JSON, with the decoder tolerating both shapes so a visitor carrying a 90-day-old cookie does not lose their first touch.

**Decided: a gclid outranks every other signal.** It is only ever set by an ad click, and trusting a stripped `utm_medium` over it files paid traffic as organic — the most expensive single misattribution available here.

**Decided: paid vs organic is read from `utm_medium`, not `utm_source`.** `utm_source: google` says nothing about whether money changed hands.

**Decided: aggregators get their own channel.** PRD 04 §2 names SpareFoot and Storable as charging per completed move-in. Letting the most expensive channel there is hide inside `referral` would understate exactly the cost the module exists to make visible.

**Decided: search hosts are a list, not a heuristic.** `researchgate.net` contains "research" and is not a search engine; a substring rule would inflate the organic number this is meant to protect.

**Decided: first touch is written once and never overwritten.** The ad that closed somebody and the search that found them are different spend. The proxy also skips writing entirely on an internal click — no campaign tags and a referrer that is us — because otherwise the second page of every session overwrites a genuine last touch with `direct`, which is the most common way this kind of cookie ends up useless.

**Decided: rate limiting keys on a keyed hash of the IP, never the address.** It answers exactly one question — "five in ten minutes?" — which a one-way digest answers just as well. Keyed with `AUTH_SECRET`, because the IPv4 space is small enough to enumerate against a plain SHA-256: an unkeyed hash of an IP *is* an IP. With no address the limit disables rather than bucketing every visitor under one constant hash, which would lock the form for everybody.

**Decided: the honeypot returns the success page.** Telling a bot it was detected is how it learns to try again without filling that field. The field is hidden from assistive technology too — `aria-hidden` plus `tabIndex={-1}` — because a blind visitor who filled it would be silently discarded.

**Decided: dedup re-checks the phone match exactly.** The indexed query is a coarse `contains` on the last four digits; without the exact re-check, somebody whose number merely ends the same way would be folded into a stranger's lead.

**Decided: the "dashboard inbox" is `Task`.** US-8 AC2 asks for email plus a dashboard inbox in real time. §4.9 US-41 is explicit that every queue reads the one task entity, and a separate lead inbox would be the eighth screen that item exists to prevent. Raised at `high`, higher than a counter lead's follow-up, because nobody has spoken to this person at all.

**Verified:** 1591 unit/DB tests (39 new — 22 on channel derivation, cookie round-tripping and dedup keys; 17 against real rows for validation, honeypot, rate limiting, dedup including the near-miss phone case and the 30-day boundary, first/last-touch separation, and the event → task hand-off). E2e 326. **Two consecutive clean full-suite runs.** Checked live against a running server: an ad click through the canonical redirect now stores `{"s":"google","m":"cpc","c":"spring","ch":"paid_search"}`, and an internal click leaves it alone. Typecheck, lint and build clean. Two migrations.

**Left behind.** **No email to the manager** — US-8 AC2 asks for one, and the comms pipeline resolves tenants only: `resolveRecipient` has no notion of a staff recipient, and bolting one on would route around the suppression list and the kill switch. The dashboard task is real and immediate; the email needs staff-recipient support in the comms service and is worth its own item. **No form on city pages** (they arrive with **B-071**) and none on the home page. **No CAPTCHA escalation path** — AC4 explicitly makes it the escalation, and there is no trigger that would turn it on. **The rate limit trusts `x-forwarded-for`**, which a determined attacker sets freely; it is a brake on naive floods, not a gate. **No confirmation email to the prospect** (AC2's other half) — same comms gap, and it also wants marketing-consent capture from **B-072**. **`moved_in` is not a lead status**: US-10 AC2 lists it, the enum has `converted`, and nothing yet moves a lead there when its reservation becomes a lease.

---

### B-069 — Analytics, the funnel, and the consent banner ✅ `0559b21`

PRD 04 §3.8 US-15, FR-AN-1..4, and PRD 01 §6.8.1's row for the consent banner.

**What it built.** `packages/core/analytics` — the event vocabulary, the funnel definition and FR-AN-4's UTM registry. An `AnalyticsEvent` table and a `track()` wrapper. Events fired at the real moments: `page_view`, `quote_form_submit`/`callback_request`, `reservation_started`/`reservation_completed`, and `move_in_completed` from inside the move-in. `/admin/reports/funnel`. A cookie consent banner with six e2e tests.

**Decided: the server log is the source of truth, and the vendor is optional.** FR-AN-2 says so and the reason is quantitative — between a fifth and a third of visitors block third-party analytics, and that share correlates with the channel. A client-side funnel would under-count *unevenly*, so an owner comparing channels would be comparing numbers biased by how technical each channel's audience is. Everything shipped here works with no vendor configured, forever. US-15 AC1's vendor choice is still an open question in the PRD and did not need answering to build the report.

**Decided: the funnel counts distinct sessions per step, not events.** One person reloading a facility page six times is one session. Counting events would make the top wide and every rate below it look terrible.

**Decided: conversion from the step above comes before conversion from the top.** "Half the people who started a hold finished it" is a fixable problem; "0.3% of sessions moved in" is a statistic. Both are shown, in that order.

**Decided: no data reports as null, never 0%.** A zero implies a measured failure, and "no sessions yet" is not one.

**Decided: `track()` never throws.** Analytics must not be able to break the thing it is measuring. Every call site is mid-transaction on something that matters more, and a failed insert has to leave the checkout, the form or the move-in untouched.

**Decided: the property bag is sanitised by value type, and anything containing `@` is dropped.** A property bag is where PII arrives by accident — somebody adds `{ email }` to a form-submit event because it was to hand. Half an email address is still an email address, so those are dropped rather than truncated.

**Decided: `move_in_completed` fires after the transaction commits, not inside it.** US-15 AC3 wants it server-side, and it is literally unobservable from a browser — the tab that started the checkout may have been closed for ten minutes while Stripe confirmed. Inside the transaction, a failed analytics insert would roll back a completed, paid move-in.

**Decided: the session cookie is minted at the edge and is NOT the attribution cookie.** Thirty minutes versus ninety days: a session is a visit, and merging the two would silently turn a short pseudonymous id into a long-lived one — a different privacy claim than the banner makes. It is also not gated on consent, because US-15 AC5 is explicit that first-party pseudonymous funnel events are the fallback *when consent is declined*.

**The consent banner, criterion by criterion.** §6.8.1 calls these "the most common source of shipped keyboard traps", so each is asserted in e2e rather than claimed in a comment:
- `role="region"`, **not** `dialog` — a modal dialog *requires* a focus trap, which is the exact defect named. A test tabs past both buttons and out.
- **It does NOT move focus on appearance** — see the correction below; the first version did, and it was wrong.
- Dismissal moves focus to `<main>` rather than dropping it: the button just pressed has left the DOM, and a keyboard user would otherwise be silently returned to the top of the document.
- **Reject comes first in the tab order** and is styled identically. A ghost-styled reject beside a filled accept is the dark pattern the criterion forbids.
- In normal document flow, not fixed to the viewport. Asserted at 320px: the banner starts below the main content and the page has no horizontal overflow.
- Both buttons are ≥44px.

**Corrected after CI caught it: the banner must not take focus on load.** The first version focused its heading on appearance, following §6.8.1's "focus moved into it on appearance". That broke a stronger and more specific criterion — WCAG 2.4.1 requires the skip link to be the first tab stop, and it no longer was. It passed locally and failed in CI because it is a race with hydration: the server snapshot hides the banner, so a Tab that lands before hydration sees the skip link and one that lands after does not. §6.8.1's wording is written for a banner that appears in response to something a user did; this one is present at page load, where taking focus is also disorienting in its own right. What the criterion protects is kept in full — reachable, dismissible by keyboard, and focus placed deliberately on dismissal rather than lost.

**Found: the ESLint rule caught a cascading render.** The banner initially synced the cookie into `useState` inside an effect. Rewritten around `useSyncExternalStore` with the cookie as the store — which is also better: mirroring browser state into component state is what creates the window where the two disagree, and the server snapshot means the banner never renders into the HTML and cannot flash before hydration.

**Verified:** 1612 unit/DB tests (21 new — 13 on the vocabulary, funnel arithmetic and UTM registry; 8 against real rows for distinct-session counting, the full walk, channel filtering, the half-open range, permission scoping and the PII strip). E2e 334, including 12 new consent-banner assertions across desktop and mobile, and the existing axe scan still clean with the banner on every public page. **Two consecutive clean full-suite runs.** Typecheck, lint and build clean. One migration.

**Left behind.** **No vendor adapter** — US-15 AC1's GA4-or-alternative is still Open Question Q1, and the wrapper exists precisely so answering it later is a file rather than a refactor. **The consent banner therefore gates nothing yet**; it records a real choice that the first vendor adapter must honour, and shipping it now means that adapter cannot be added without one. **`promo_applied` and `review_request_click` are declared and never fired** — they belong to **B-070** and the review flow. **No `page_view` outside the facility page**: the search page and the home page do not fire one, so the funnel's top step under-counts sessions that never reached a facility. **No client-side `track()`** — FR-AN-1 says "web + server" and only the server half exists; nothing currently needs the client half, since every funnel step happens during a server render or a server action. **Sessions are counted per facility**, so a visitor comparing two sites appears in both funnels.

---

### B-070 — The promotions engine ✅ `15ff40f`

PRD 02 US-10, PRD 04 §3.6 US-11/US-12, FR-PROMO-1..5. **The last MVP item.** Held mid-build at the owner's request while PRD 10 was written, then resumed; the partial is at `0a8fed0`.

**What it built.** `packages/core/promotions` — the discount schedule and the eligibility evaluator. `PromoCode` and `PromoRedemption` tables. An atomic redemption claim. Discount support in `buildInvoice`. The carry-through from facility page → checkout session → move-in → invoice. Badges on unit cards. `/admin/settings/promotions`.

**Decided: tax is computed on the discounted base, not the gross.** The single most consequential line in the item. Computing tax on the full rent and then subtracting the discount collects a state's sales tax on money nobody paid — on every discounted invoice, silently, forever. `buildInvoice` shrinks the taxable base before the tax loop, and a test pins $100 rent with $50 off at 8.25% producing $4.13 rather than $8.25.

**Decided: the subtotal stays gross and the discount is its own positive line.** B-055's revenue report reads "billed" from the line items and "discounts given" separately; netting them in the builder would make a promotion invisible in the one report that exists to price it. The discount line carries positive cents that the total subtracts, which is also what B-055 already expected.

**Decided: the cap is one raw SQL statement, not a read followed by a write.** `redemptionCount < maxRedemptions` is a column-to-column comparison Prisma's `where` cannot express, so `redeemPromotion` issues a conditional `UPDATE`. Postgres evaluates the predicate against the row it locks, so of five transactions racing for the last two redemptions exactly two update a row. **Tested with five genuinely concurrent transactions**, which is the only way to see the difference — a check-then-write passes every serial test ever written.

**Decided: redemption happens at completed, paid move-in — not when the promo is shown, and not when checkout starts.** A redemption claimed earlier would consume a capped promotion for somebody who abandoned at the payment step, and the cap is the scarce thing the atomic claim exists to protect.

**Decided: the schedule is snapshotted, and billing reads the snapshot.** A percentage of a rent that later changes would silently change what was promised; a promo edited or ended next quarter must not rewrite what a tenant already agreed to. Tested by ending the promotion and changing its value, then confirming the invoice still discounts the original amount.

**Decided: `appliedPeriods` is append-only on the redemption.** The nightly run is re-runnable and catches up missed dates (FR-4), so without it a caught-up week would apply the first month's discount seven times. Marked inside the invoice transaction, so a rolled-back invoice never leaves a promotion looking spent.

**Decided: a code-gated promo is invisible without its code.** Showing it as a badge makes the code pointless. And a typed code that does not work says *why* — wrong facility, wrong size, expired, new customers only — because watching the total not change is worse than being told.

**Decided: new promotions are created as drafts, always.** FR-PROMO-1 lists the statuses, and a promo that went live the instant somebody pressed Create is the one that publishes with a typo in the percentage. Activating a code-gated promo with no codes is refused outright: it can never be redeemed by anyone, and nobody notices until the campaign is over.

**Decided: the discount can never exceed the rent.** A $500-off promo on a $129 unit is $129 off. Otherwise the promotion pays the tenant, and the generated terms text is capped to match so a badge cannot promise what the invoice will not do.

**Found: a real shape bug, caught by the DB test.** `PromoRedemption.schedule` stores the periods *array* while `discountForPeriod` expects a `{ periods }` object — reading one as the other yields `undefined.periods` and a discount of zero, which is indistinguishable from a promotion that quietly never applies. Now named and array-checked at the boundary rather than loosely cast.

**Verified:** 1645 unit/DB tests (33 new — 24 on schedule arithmetic, terms wording, eligibility and the discounted-tax rule; 9 against real rows including the five-way concurrency race, the per-code cap rollback, the snapshot's immunity to a later edit, and double-application). E2e 337. **Two consecutive clean full-suite runs.** Typecheck, lint and build clean. Two migrations.

**Left behind.** **No promo entry field at checkout** — the carry-through works and `CheckoutSession.promotionId` is set by the facility page's automatic promos, but there is no box for a prospect to *type* a code during checkout; a code-gated promo is currently only reachable if the code is applied before the session starts. That is the first thing to finish. **`minStayMonths` is stored and unenforced** — the column exists per FR-PROMO-1 and nothing claws a discount back on an early move-out. **No stacking** — one promo per lease, per FR-PROMO-4's MVP rule; PRD 10 §5.5 explicitly wants referral rewards to stack with promotions, which needs a second redemption slot. **The facility page evaluates promos per unit type on every render** — correct but N queries; fine at this scale, worth a single batched read when a facility has thirty sizes. **No ROI report beyond the admin screen's per-promo total.**

---

### B-056 — Delinquency timeline configuration ✅ `7d982ab`

PRD 02 §4.6 US-25/US-29. **The first Phase 2 item**, and the one D-1 deferred out of MVP. Configuration only — B-057 is the engine that runs it.

**What it built.** `packages/core/delinquency` — the action catalog, validation, and the example timeline. A versioned `DelinquencyTimeline` per facility with `Lease.delinquencyTimelineId`. `/admin/settings/delinquency`, with US-29's disclaimer as a permanent fixture.

**Decided: a facility with no timeline runs no pipeline.** `activeTimeline` returns null and B-057 must treat that as "do nothing". Falling back to the example would be the worst available default — a lien pipeline nobody configured, driven by a table copied out of a PRD, running against a real tenant's property. The screen says so in as many words, so the absence reads as a decision rather than a bug.

**Decided: versions are append-only and the old one survives intact.** Saving deactivates the previous version and inserts a new one, exactly as message templates and tax components do. The reason is US-25's own AC — "the lease records which timeline version governed it" — and a lien file whose timeline has been rewritten since is one that cannot be defended. Tested by superseding a version and confirming its day numbers and qualifying rule are unchanged, with the governed lease still pointing at it.

**Decided: the automated-action list is closed.** Five actions, each wired to real code in B-057. Free text would let a timeline name an action nothing implements — a configuration screen that silently does nothing on day 30, which on a lien timeline means a notice that was never sent.

**Decided: validation refuses rather than warns, and every rule earns its place.** Two steps on the same day leave the order between a fee and a notice quoting the balance undefined. A notice with no delivery method is generated, filed, and never reaches the tenant — the exact failure a lien file cannot survive, and it looks like success on every screen. A staff task with no required proof means "done" means nothing later.

**Decided: US-29's disclaimer is persistent and its own constant.** Not dismissible, not a tooltip, at the top of the screen and rendered from one place so every surface says the same words — because the person approving a sale eight months from now is not the person who configured this. The facility's state is read and named beside it. The example is called `EXAMPLE_TIMELINE_LABEL` = "Example configuration — not legal advice", and a test asserts the constant's own name carries that.

**Decided: the example is offered, never seeded.** Loading it is a separate action and saving it is another, so no facility ends up running a timeline nobody read. A test confirms the example passes its own validation unchanged — a default that could not be saved would send an operator hunting for a problem in a file they cannot edit.

**Decided: auction eligibility is never reached automatically.** The example's day-60 step flags the lease but carries a staff task and a required proof, so the flag is a queue entry rather than a sale.

**Verified:** 1674 unit/DB tests (29 new — 20 on validation, ordering, firing and the US-29 guardrails; 9 against real rows for versioning, the one-active invariant, the governed-lease link surviving supersession, and the permission refusal). **Two consecutive clean full-suite runs**, the first clean on the first attempt. Typecheck, lint and build clean. One migration.

**Fixed before moving on — and it was worse than first flagged.** `noticeTemplateKey` was free text, so a typo produced a step whose notice could not be found. Looking properly, **the shipped example itself named `pre_lien_notice` and `lien_notice`, neither of which exists** — those templates belong to B-063 and are unwritten. So the example was not merely permissive about typos, it *was* the typo: an operator loading it would have activated a timeline whose two most consequential steps read as "sends a notice" on every screen and sent nothing at all. On a lien timeline that is the gap between a defensible file and a wrongful sale.

Three changes: `validateTimeline` now takes the facility's real template keys and refuses an unknown one; the save path always supplies them, so a hand-edited form cannot smuggle one past the UI; and the field is a `<select>` over templates that exist. The example's pre-lien and lien steps now carry **no template and no `send_notice`** — they are staff tasks that still require a tracking number and a delivery date, which is what actually happens today. A test asserts the example never names a template that does not exist, so this cannot come back when B-063 lands and somebody edits the list.

**Left behind.** **Nothing executes any of this** — B-057 is the engine, and until it lands a configured timeline is a document. **No drag-to-reorder**: steps are sorted by day, so ordering is implicit and re-ordering means changing a number; the form shows four blank rows and works without JavaScript. **No per-state presets** beyond the single example, which D-10 says should eventually vary. **No preview** of what a timeline would do to a specific lease, which is the thing an operator will actually want before activating one.

---

### B-057 — The delinquency engine ✅ `3c00546`

PRD 02 FR-5, US-25. B-056 made the timeline configurable; this is what runs it, nightly at 6am local — last in the night, after the access rule at 4am and the dunning ladder at 5am, so the day count and balance it reads are tonight's settled figures.

**What it built.** A pure `evaluate` in `packages/core/delinquency/engine.ts`. A `DelinquencyStepRun` history table. `runDelinquencyTimeline` executing automated actions and queueing staff tasks. `delinquency.stage_changed` alongside the existing `day_reached`. Cure handling. A `delinquency_step` task type.

**Decided: three things this engine deliberately does not do**, because something else already owns each and two owners of one behaviour is how a tenant is charged twice or told twice:
- **Access suspension is B-098's**, reached through the same `transitionGrant` with the same `system:delinquency` cause — so a suspended gate looks identical however it was reached, and the profile banner, the audit entry and the restore path all still key off it. That is what "inherits the access rule" means.
- **Late fees are B-047's ladder.** A step naming `assess_late_fee` is the *trigger*; the amount and schedule stay with the fee ladder, which has its own steps and its own idempotency. The step records the delegation rather than silently doing nothing.
- **The CN-3 dunning ladder stands down** for any facility with an active timeline. Both would otherwise chase on day 1 — US-25's example opens with "Late: late fee #1, email reminder" and `dunningDays` defaults to `[1,5,10,30]` — and the tenant would get two emails for one missed payment. The timeline wins because it is the more specific configuration and the one reviewed with a lawyer.

**Decided: the step is claimed before its side effects, not after.** `executeStep` inserts the run row first and returns false if the insert loses. Claiming afterwards would send the notice twice and record it once, which is the version of this bug that is invisible until somebody reads the send log.

**Found and fixed in my own code before committing: `cure()` deleted the step history.** The first cut removed the runs so a later delinquency could start over — destroying the evidence US-28 requires an auction to be defensible from, which is the entire reason the table exists rather than an event payload. Rows are now **superseded**, not deleted: they stay, stop counting as executed, and the idempotency key became a **partial unique index** scoped to the open episode (`WHERE "supersededAt" IS NULL`) — the same device and the same reason as `reservation_one_held_per_unit`. A plain `unique(leaseId, dayOffset)` would have let a lease be chased exactly once in its life. Both halves are tested: the history survives a cure, and a cured lease that falls behind again starts at day 1.

**Decided: cure cancels open staff tasks rather than completing them.** Nobody applied the overlock, and a proof-less "completed" in the history an auction is defended from is worse than no record at all. Overlock *removal* is raised only if an overlock was actually applied — a lease that cured on day 2 never had one, and a task to remove a lock nobody fitted is how a queue stops being trusted.

**Decided: the timeline pin is set on the first step and cleared on cure.** Pinning at move-in would freeze a configuration a tenant may never encounter; clearing on cure means a future delinquency is governed by whatever is current then. Nothing is lost — each `DelinquencyStepRun` carries its own `timelineId`, so the history knows which version was in force when each notice went out even after the lease's pin moves on.

**Verified:** 1701 unit/DB tests (21 new — 11 on the halt order, catch-up and stage arithmetic; 10 against real rows for the no-timeline no-op, idempotency, version pinning, task raising, gate suspension through B-098's path, `stage_changed`, cure keeping the history, re-entry after cure, and the hold). Two consecutive clean full-suite runs. Drift check clean, lint and build clean. Two migrations.

**Left behind.** **No delinquency queue screen** — US-26's "today's due steps grouped by type" is its own item; the tasks exist and land in the one task list, but there is no grouped view. **No generated notices**: `send_notice` emits `delinquency.day_reached` with the template key, and the pre-lien and lien templates themselves are **B-063**. **`flag_auction_eligible` sets `pending_auction` and stops there** — the auction pipeline is B-059. **Delivery methods are recorded, not acted on**: a step naming `certified_mail` emits it in the payload and nothing prints or posts anything. **No stage on the tenant profile** — the engine emits `stage_changed` and nothing renders it yet.

---

---

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.

## B-058 — Overlocks: the status that had no producer

`fd446c9`

**What it built.** The physical half of PRD 03 US-3. `overlocked` has been in
the unit status enum since B-010 with nothing setting it —
`occupancyFactsForMany` said so in a comment naming this item. Now a
`UnitOverlock` row carries the whole life of a lock: requested, applied,
removed, each with a staff id and a timestamp, and the unit's derived status
follows it. B-057's engine raises a typed `overlock_apply` task for a timeline
step that means "go and fit a lock", and `releaseOverlock` on cure either
queues the removal or withdraws a request nobody actioned. Ten new DB tests.

**What it decided.**

- *Requesting a lock does not overlock a unit — fitting one does.* The status
  flips on task completion, not on the engine raising the task. A unit reading
  `overlocked` while the lock is still in the office is a lie an auction file
  cannot survive, and staff would have no way to correct it.
- *The apply task requires a photo.* US-25's table calls the photo optional;
  US-28's evidence rules for the sale it leads to do not. A lock nobody
  photographed is a lock a tenant can say was never fitted, so
  `requiredProofFields` on `overlock_apply` is `['note', 'photo_reference']`
  and `completeTask` refuses without it. This deliberately tightens US-25.
- *Idempotency is a partial unique index, not a code check.*
  `unit_overlock_one_live_per_unit ON ("unitId") WHERE "removedAt" IS NULL` —
  so a replayed stage event (AC4) cannot produce a second lock or a second
  task, and history still permits a fresh lock after an earlier one came off.
- *A request that was never fitted is withdrawn, not removed.* Raising a
  "go and take the lock off" task for a lock nobody ever put on is how a queue
  stops being trusted. `releaseOverlock` cancels the open apply task instead.
- *Overlock steps are recognised by label, via one exported predicate.*
  `isOverlockStep` lives in core beside the timeline rules, so the engine and
  its tests share one rule. The alternative — a seventh automated action —
  was wrong: an overlock is not automated, it is a person with a padlock.
  A test asserts the example configuration still matches it, because a rename
  there would silently degrade to a generic task with no record behind it.
- *Removal keeps the row.* `removedAt` is stamped, nothing is deleted —
  "was this unit locked on the day of the sale" is a question US-28 turns on.

**What it left behind.** The ≤2-minute restore SLA is asserted as "the restore
is an inline call on the settling payment, not a nightly sweep" rather than by
timing a clock — B-098 already owns that path and this item did not rebuild it.
No admin screen specific to overlocks: they surface as unit status on the units
board and as tasks in the existing queue, which is where staff already look.
Lien and auction consumption of this history is B-061/B-062.

**A note on the tests.** Two B-057 tests used a step labelled "Overlock" to
exercise the *generic* staff-task path. Since this item that label routes
elsewhere, so they were repointed to a certified-letter step; the overlock path
has its own file.

## B-059 — Delinquency queue

`65bb8e6`

**What it built.** US-26's screen: "today's due steps grouped by type
(overlocks to apply/remove, notices to mail, proofs to record), so nothing is
missed." `delinquencyQueue` filters `facilityTasks` down to the three
delinquency-related types and groups them in that order — no new query, no new
table, per US-41's AC that every later queue reads the one `Task` list. Lives
at `/admin/delinquency`, the nav destination that already existed pointing at
the generic `[section]` placeholder, gated on the `delinquency:execute_step`
permission that was already in the catalog.

**What it decided.**

- *A generic-task bug in B-058 surfaced while wiring the form.* The plain
  `/admin/tasks` list only ever collected a `note`, so completing an
  `overlock_apply` task from there would always fail proof validation for
  the missing photo — nobody would have hit it until an operator tried. Fixed
  by threading `requiredProofFields` onto `TaskRow` (computed from the
  catalog) and rendering a conditional photo field on both the generic list
  and this one, off the same data rather than each screen guessing.
- *Escalation is text, matching B-065's keypad queue rather than inventing a
  second convention*: an `role="alert"` count banner plus a per-row "Overdue"
  label, never colour alone (1.4.1).

**What it left behind.** Assignment and reassignment already exist on the
generic queue (`assignTask`) and were not duplicated here — this screen is
about completing today's steps, not managing who owns them. FR-22's table
semantics (`scope="row"`, `aria-sort`) don't apply: like the two queues it
follows, this is a card list, not a data table.

## B-060 — Field ops: overlock reconciliation, the daily walkthrough, maintenance tickets

`dd93511`

**What it built.** The three US-35/36/37 stories, each as thin as the backlog
line asked for: "all as `Task` types and views, not new queues."

- *US-36, overlock reconciliation* (`/admin/overlocks`). A pure classifier
  (`classifyOverlock`, packages/core/delinquency) reads a live `UnitOverlock`
  row plus whatever open `overlock_remove` task belongs to its lease and
  states which of three things is true: awaiting apply, awaiting removal, or
  confirmed and steady. Mismatch is a flag, not a fourth state — over 24h in
  either non-steady state, per the AC. No new table: the whole view is a join
  over rows B-058 already writes.
- *US-35, the daily walkthrough* (`/admin/walkthrough`). One `Task` (type
  `daily_walkthrough`) per facility per day, raised at 7am local by a new
  `SCHEDULED_JOBS` entry, standing for "did anyone walk the property" as a
  completable fact. Its page assembles the real per-unit work from lists that
  already exist — B-059's overlock groups, and B-014's `/admin/units/ready`
  count-and-link — plus a "report a finding" form that creates a
  `MaintenanceTicket` directly. Nothing here is a new queue; it is one task
  type and a page that reads three existing sources.
- *US-37, maintenance tickets* (`/admin/maintenance`, + a "Report issue" link
  per row on the units board). A real `MaintenanceTicket` entity — the master
  PRD names it beside `Task` in §7, unlike the walkthrough — with status
  (open/in_progress/blocked/done), priority, an assignee, and its own
  `blocksAvailability` flag. `UnitOccupancyFacts` gained
  `blockingMaintenanceTicket`, and `canSetManualStatus` refuses `available`
  (only `available` — `maintenance`/`unrentable` stay reachable) while one is
  open, naming the ticket the way it already names a lease or a reservation.

**What it decided.**

- *A blocking ticket only narrows `available`, nothing else.* "The paint is
  chipped" and "the roof leaks" can both be open tickets; only the flag says
  which one should stop a unit renting out from under a contractor.
- *Opening a blocking ticket sets `maintenance` intent; closing one does not
  revert it.* Matches the precedent move-out already set for the same column —
  intent is a deliberate act, not an inference from whatever the last event
  was.
- *No new Task type for "recently vacated, needs a lock check."* B-014's
  `/admin/units/ready` already is that queue — it has existed since move-out
  got its own item, just never described as part of a "walkthrough." Building
  a parallel `Task`-based version would have duplicated a working screen the
  AC's own principle argues against. The walkthrough page links to it and
  shows a live count instead.
- *"Skipped days are visible" needed no extra code.* An uncompleted
  `daily_walkthrough` task from a prior business day simply stays open and
  reads as overdue through the same rendering every other queue already uses.

**What it left behind.**

- *Fixed in passing*: `UnitOverlock.removedTaskId` had existed on the schema
  since B-058 and was never written. `releaseOverlock` now sets it — and the
  reconciliation view's whole reason to exist is exactly that join, so this
  was found while building the thing that needed it, not gone looking for.
- No per-unit detail page exists yet, so "create from the unit page" (US-37's
  AC) is the units board's new "Report issue" link into `/admin/maintenance`
  rather than a dedicated screen — there is nowhere else for it to live until
  one is built.
- The walkthrough's photo attachment (US-35's AC) rides on the same
  `photo_reference` proof field every other task type uses; there is still no
  blob store behind it, a gap B-058 already noted and carries forward.

## B-061 — Pre-lien and lien notice generation

`ab148d6`

**What it built.** US-27's generated notices, with US-13's evidence chain
attached. A `NoticeTemplate` (versioned, per-facility, org-default fallback)
holds the text; `generateNotice` renders it through the existing document store,
so the notice is stored, hashed and verifiable by `verifyDocument` like every
other generated document. `/admin/settings/notices` is where an operator and
their attorney write the text; the tenant's per-lease Notices screen is where
staff preview, generate and record service. 74 new tests (52 pure, 22 DB).

**What it decided.**

- *A notice cannot be generated when the ledger and the invoices disagree.* Not
  a warning — a refusal, with the reason on screen. US-27 asks that the claim
  "reconciles to the ledger at generation time"; if the two sources of truth
  disagree then nobody knows what the tenant owes, which is exactly the moment
  to stop rather than to bake the discrepancy into a legal document and mail it.
  `claimForNotice` reuses B-049's `reconcile` verbatim so the ledger screen and
  the notice can never disagree about whether a lease reconciles.
- *The claim itemizes payments too, not only charges.* A claim listing charges
  and quoting a net total overstates the debt by exactly what the tenant paid —
  the first thing an attorney checks. `buildClaim` also asserts its own lines
  sum to its own total, which is unreachable-by-construction and checked anyway.
- *A separate table from `MessageTemplate`, deliberately.* Reusing it would have
  been less code and was wrong three ways: a statutory notice is a served
  document rather than an email; B-063's courtesy email supplements would share
  the key namespace with the thing they explicitly are not; and B-056's
  `validateTimeline` resolves `noticeTemplateKey` against `MessageTemplate`, so
  a notice template living there becomes selectable as a `send_notice` target —
  emailing the statutory notice through a path with no consent check and no
  delivery proof. The schema comment records all three.
- *`notice_email` consent is checked in the service, not the screen*, and
  `account_email` does not satisfy it. US-13 is explicit that overloading the
  two destroys the ability to prove agreement. Never-asked and consent-withdrawn
  give different messages because they need different fixes from whoever is at
  the counter.
- *The rendered address is snapshotted on the `Notice` row, not joined.* A
  tenant who moves on day 40 must not retroactively change where an already
  served notice says it went. `tenantAddressId` keeps the provenance chain back
  to the history row.
- *A correction is a new document.* `correctsNoticeId` forward, `supersededAt`
  back; the original's bytes and hash are untouched, and delivery cannot be
  recorded against a superseded notice.
- *No template means no notice.* A facility that has not written its text
  generates nothing, rather than silently mailing the unedited example — the
  same posture B-056 took for an unconfigured timeline, for a stronger reason.
- *Every delivery method requires proof*, and a notice posted on a unit requires
  a photo: the claim a tenant most easily denies.

**What it left behind.**

- *A shared-renderer change worth flagging.* `renderTemplate` escapes every
  merge value, correctly — which double-escaped the itemized claim table into
  visible markup. Fixed with a narrow `rawFields` parameter naming the merge
  fields whose value is markup this application built (one: `claimTable`).
  A template cannot opt itself in — the list comes from calling code — and
  `claimTableHtml` escapes every record-derived string it embeds. Four tests
  in `documents-db.test.ts` pin the blast radius.
- *B-056's example timeline said the pre-lien and lien templates "belong to
  B-063 and are unwritten".* That was the wrong reason even when written; the
  right one is that those keys name email templates and these notices are
  documents. Comment and step labels corrected; the labels now point staff at
  the notices screen. The invariant test was renamed to state the real rule.
- The deadline is `DEFAULT_DEADLINE_DAYS` (14) with a per-notice override, not
  a facility setting. Deliberate: the lawful figure is statutory and differs by
  stage, and a configurable field here would imply the system knows which value
  is compliant. The timeline (B-056) is where the schedule is encoded.
- Still HTML rather than PDF, per B-023's standing decision — no tagged-PDF
  encoder exists in this runtime, and the hash and evidence chain work
  identically. Certified-mail API integration is B-083; today staff type the
  tracking number.

## B-062 — The auction pipeline

`5e92979`

**What it built.** US-28 end to end: `AuctionCase` (one live case per lease, via
a partial unique index) with its advertising runs, the hard-blocked scheduling
gate, the lock-cut inventory as a hashed document, the buyer record, the
system-computed proceeds waterfall posting real ledger entries, and surplus
tracked as a liability until somebody records where the money went.
`/admin/auctions` lists cases and outstanding surpluses; the case screen carries
US-29's disclaimer and the pinned timeline summary. 131 new tests (97 pure, 34
DB), including a swept identity check over the waterfall.

**What it decided.**

- *The waterfall accounts for every cent, and asserts it.* `distribute` returns
  costs-recovered, applied-to-lien and surplus, and throws if they do not sum to
  gross proceeds. Unreachable by construction; checked anyway, because money
  falling out of the waterfall is the failure the file exists to prevent. A
  swept range test covers ~200 combinations.
- *The surplus is never posted to the lease ledger.* Sale costs post as a
  charge and the recovered amount as a payment, so the lease nets to zero (or
  to a real deficiency). Posting the surplus as a credit would make it read as
  discharged the moment it was recorded — exactly how a surplus gets quietly
  retained. It is a liability against the case, and it stays on the auctions
  screen until dispositioned.
- *A surplus starts `held`, never `no_surplus`*, and `no_surplus` cannot be
  chosen by a person. Otherwise a real surplus could be closed out by declaring
  it never existed.
- *Every blocker is reported at once, not the first.* A manager fixing one
  blocker per round, discovering the next each time, is how a deadline gets
  missed and a corner gets cut.
- *A vehicle blocks approval as well as scheduling.* Approving a case that can
  never be scheduled would leave a signed-off record of a sale nobody may run.
- *A served lien notice is a scheduling precondition*, joined to B-061:
  `status: delivered` and not superseded. Generated-but-never-served does not
  count — a sale with no served notice behind it is the commonest wrongful-sale
  claim there is.
- *Approval requires rank ≥ 30 (regional).* A site manager cannot approve the
  sale of their own site's tenant.
- *The lock-cut inventory is written once*, requires a photograph per line, and
  refuses an empty list — "no items of value" is itself a line that has to be
  written down. It renders through `storeGeneratedDocument`, so it is hashed and
  verifiable like a notice.
- *The buyer's government ID is a REFERENCE, never the number.* Enough to find
  the record, not enough to become a breach-notification liability.
- *`surplusHoldDays` is a facility setting with its control shipped in this
  item*, per the repo rule. US-28's own note says the duration needs an attorney
  pass under D-10, so the field is labelled a placeholder rather than a legal
  figure.

**What it left behind.**

- Two schema invariants correctly caught the new fields and were extended with
  reasons rather than loosened: four calendar dates (`@db.Date`), and
  `AuctionAdvertisement` as scoped through its parent case.
- The sale releases the unit to `maintenance` and ends the lease, reusing
  B-040's path — so a sold unit cannot go back on sale before somebody has
  opened the door.
- Online auction platform listing is B-083, still P2. Nothing here talks to an
  external marketplace; the advertising record is what staff type.
- Cancelling returns the lease to `delinquent` and lets the delinquency engine
  decide from there, rather than asserting the tenant paid — if they really did,
  the engine's own cure path runs.

## B-063 — Comms delinquency-stage notices and pre-lien/lien courtesy supplements

`959af72`

**What it built.** CN-11's remaining stage pair (overlock applied/removed) and
CN-12's pre-lien/lien courtesy supplements, on B-030's existing engine —
templates, notification rules, merge-field schema entries, and the event
wiring to fire them. The access-suspended/restored pair already shipped with
B-098; this closes out the rest of PRD 05's delinquency-stage list. 22 new
tests (14 pure copy/wiring checks, 8 against the database and the real seeded
catalog).

**What it decided.**

- *Two catalog event names had been reserved and never used.* `overlock.required`
  and `overlock.cleared` sat in packages/core/events/catalog.ts since B-057's
  planning with nothing emitting them. `confirmOverlockApplied` and
  `confirmOverlockRemoved` (B-058) now emit them in the same transaction as the
  state change — found while building the thing that needed them, not gone
  looking for.
- *The courtesy supplement quotes the notice's own snapshot, never a live
  balance.* `notice.generated`'s payload carries the claim total and deadline
  exactly as B-061 stored them on the `Notice` row. Recomputing at send time —
  the pattern every other rule in this catalog uses — would risk the email
  disagreeing with the mailed document it describes, which is worse for a
  courtesy message than a stale figure would be for a reminder.
- *One event, two templates, filtered by a skip condition each.* `notice_type_not_pre_lien`
  and `notice_type_not_lien` reuse the same device the catalog already needed
  for anything scoped narrower than its event — exactly one of the two fires
  per generated notice.
- *The courtesy language is tested as content, not trusted as prose.* Both
  supplement templates are checked for "courtesy", "not the formal notice",
  "by mail", and "lease and state law" — and checked to contain NONE of several
  phrasings that would read as the email being service of process. The same
  discipline B-056 applied to the timeline's own disclaimer.
- *FR-18 staleness gets a new predicate for the overlock notice*
  (`overlock_already_cleared`): a tenant who paid and had the lock removed
  between the event and the dispatch must not receive "we've locked your
  unit."

**What it left behind.**

- *SMS is out of scope, matching the existing architecture.* CN-12 asks for
  "email (and SMS if consented)"; B-030 shipped email-only (FR-4) and no SMS
  provider is wired in this codebase yet. Both supplements are email; the SMS
  half is a gap B-030 already carries, not a new one from this item.
- *A real bug in the test harness, not the product*: the seed script only runs
  when explicitly invoked — a schema change alone does not populate
  `NotificationRule`/`MessageTemplate` rows into either database. Re-running
  `db:seed` and `db:migrate:test` was what made the new templates actually
  sendable; a session that edits `comms-catalog.ts` without reseeding will see
  every new rule silently match nothing.
- No new admin screen: the existing per-facility template editor (B-053, CN-16)
  already reads `MessageTemplate` generically, so all four new templates are
  editable there with no further work.

## B-071 — Reviews: manual entry, facility-page display, review-request email

`e3e4ec9`

**What it built.** FR-REV-1/2/3 and US-6/US-7 end to end. A `Review` entity
(immutable content, hide-not-edit per FR-REV-2, same convention as
`TenantNote`), manual entry and visibility management at
`/admin/settings/reviews`, the average-plus-N-most-recent block on the
facility page, and a per-facility scheduled job that raises a one-time
review-request email N days after move-in (default 7, its own settings
control shipped in this item). 88 new tests (52 pure, 36 against the
database and the real seeded catalog).

**What it decided.**

- *`aggregateRating` never gets fed by manual reviews — recorded as D-33,
  closing PRD 04's own Open Question Q3.* Google's structured-data policies
  for review snippets require the rating be independently verifiable as
  collected by the site marking it up; a staff transcription of a rating
  authored and verified on Google itself is republished third-party data, not
  this site's own collection of it. The stakes are asymmetric with the upside:
  one facility's star rating against a manual action that can suppress
  rich-result eligibility **sitewide**. `qualifiesForSchemaMarkup` encodes
  "every review source is `google_api`" rather than a flag someone could
  enable early, so it is false by construction until FR-REV-4 (Phase 3) ships
  a real source. This was already anticipated at B-066 — `selfStorageJsonLd`'s
  `aggregateRating` parameter has carried the exact warning in its own comment
  since before `Review` existed.
- *The review-request delay is a per-facility scheduled job, not an
  event-driven wait.* "N days after X" needs something that ticks nightly and
  asks whether enough time has passed — the same shape B-043's expiry scans
  and B-097's follow-up sweep already use. `reviewRequestDue` uses `>=`, not
  `===`, so a catch-up run (or a facility that only just configured its review
  link) still raises every tenancy that already cleared the delay.
- *A facility with no Google review link never sends, and is never stamped
  for having tried.* A review ask with nowhere to leave the review is worse
  than not asking. Because eligibility is `>=`, the moment an operator sets
  the link, the next run catches up every tenancy that was already waiting —
  no lease is ever silently skipped forever for a gap that gets fixed later.
- *`reviewRequestSentAt` is stamped in the SAME transaction as the emit*, the
  same device `Reservation.expiryReminderSentAt` uses — the outbox only
  dedupes an event that already exists, so "once per tenancy" is the
  producer's job.
- *Classified `marketing`, not `transactional`.* This is a solicitation, and
  the suppression matrix only honours an unsubscribe/manual block for that
  classification — real protection even before B-072 builds explicit
  marketing-consent capture. `lease_on_hold_marketing` (already existing) is
  reused verbatim as the operator's manual-exclusion path AC2 asks for,
  needing zero new mechanism.
- *A suppressed send still counts as the one request.* AC2's "max 1 per
  tenancy" is used up by a suppressed attempt (moved out, on a marketing
  hold), not retried once the condition lifts — matches how every other
  once-per-something guarantee in this codebase behaves.

**What it left behind.**

- *Open/click tracking is explicitly NOT built.* AC3 asks for it; nothing in
  this codebase does open-pixel or click-redirect tracking for ANY template
  today, and building it narrowly for one new email would be backwards — every
  other message (dunning, payment failures) would benefit from it more. Send
  tracking (the `Message` row + status, identical to every other template)
  and a per-facility sent/suppressed/failed count on the settings screen are
  built; genuine open/click needs a general mechanism, which belongs with
  B-054's delivery dashboard or a dedicated item, not bolted onto reviews.
- Same seeding gotcha as B-063, hit again and fixed the same way: editing
  `comms-catalog.ts` needed `db:seed`/`db:migrate:test` re-run before the new
  template/rule existed in either database — the tests failed with zero sends
  until that ran.

## B-072 — Marketing consent + lead drip

`8826b4c`

**What it built.** FR-MSG-1 through 5 and US-13/US-14: an explicit,
unchecked-by-default `marketing_email` consent checkbox on the lead-capture
form; a real, working, signed one-click unsubscribe link on every marketing
email (nothing linked to `/unsubscribe` before this item, though the
suppression table and its `unsubscribe` reason already existed from B-054);
FR-MSG-5's quiet-hours (9pm-8am facility-local) and max-1-marketing-email/day
caps, enforced centrally rather than per-rule; and the three-step lead drip
(quote recap → value email → conditional promo nudge) as one new domain
event, three templates, and both an immediate consumer (step 1) and a
day-counted per-facility job (steps 2/3). 88 new tests (39 pure, 49 against
the database and the real seeded catalog).

**What it decided.**

- *`review_request` (B-071) is NOT retroactively gated on the new consent
  requirement — recorded as D-34.* FR-MSG-4 lists lead drip, abandoned
  reservation and review request together as the three sequences US-13's
  consent rule governs, and a literal reading would gate all three. Rejected
  for review_request specifically: tenants have no consent-capture point yet
  (this item's checkbox lives on the anonymous LEAD form), so gating
  retroactively would have silently stopped every review request the day
  this shipped, for every existing tenant, with no way for an operator to
  turn it back on. What DOES apply universally — the unsubscribe link, quiet
  hours, the daily cap — costs nothing and closes a real gap, so those are
  enforced centrally for every `marketing`-classified send regardless of
  which item shipped it, retroactively covering review_request too.
- *Quiet hours and the daily cap are enforced centrally, not as an opt-in
  skip condition.* The same reasoning the postal footer already uses ("an
  edited template cannot drop a CAN-SPAM requirement") — a future marketing
  rule that forgot to list the skip condition would silently violate
  FR-MSG-5, so the check lives in `deliverForRule` itself, gated on
  `classification === 'marketing'`.
- *The daily cap is a rolling 24h window, not a facility-local calendar
  day.* Simpler, and the stricter reading — a calendar-day boundary would
  let two sends land three minutes apart across midnight and still call
  that "once a day."
- *Unsubscribe tokens are signed, not stored*, mirroring `quote-token.ts`'s
  precedent exactly, for the same reason: the token's whole purpose is to
  keep working long after it was sent, so there is nothing to revoke.
  Unlike a quote, it never expires — opened six months later, it still has
  to unsubscribe on the first click. Confirmation is a POST behind a button,
  not a bare GET, so an email client's link-prescan can't silently
  unsubscribe someone who never clicked anything.
- *`currentConsent` (B-061) was generalized* from tenant-only to
  `{tenantId} | {leadId}`, matching `recordConsent`'s existing shape — a
  lead has no tenant id to read consent by, and this is the read half of the
  same table.
- *Step 3's promo nudge is genuinely conditional*, not sent-with-nothing-to-
  nudge-about: the job checks for a live promo before ever raising the
  event, and simply does not raise it when none applies.

**What it left behind.**

- `marketing_sms` stays unbuilt, matching every prior item that touched
  SMS — B-030 shipped email-only (FR-4), no Twilio integration exists until
  B-074, and this item's own consent capture only writes `marketing_email`.
  The schema and the classification checks are already shaped for it per
  B-030's original note.
- Templates are per-brand and operator-editable through the existing CN-16
  editor (B-053) — no new UI needed, since the three new templates are just
  more `MessageTemplate` rows. "Not sequence logic" (AC2) holds: the three
  steps, their delays and the promo condition are fixed in
  `packages/core/leads/drip.ts`, not configurable.
- Same seeding gotcha as B-063/B-071, hit and fixed the same way: the seed
  script only runs on explicit invocation, so the new templates/rules did
  not exist in either database until `db:seed`/`db:migrate:test` re-ran.

---

## B-073 — Abandoned-checkout follow-up

`9a7d284`

**What it built.** US-9/FR-LEAD-4's three-step sequence: a `CheckoutSession`
that sits unfinished for 1/24/72 configurable hours (per-facility
`abandonmentFollowUpHours`, reachable from Operations policy — the repo's
own "a new column gets its control in the same item" rule) gets an email
carrying the exact unit and quoted price, a signed resume link, and — on the
final step only — a live promo's terms when one applies. Consent-gated both
at raise time and again at send time, the same two-layer device B-072's
lead drip uses. A new checkbox at checkout step 1 (`marketing_email`
consent, unchecked by default) is the only capture point, since a checkout
session has no earlier one. Recovery is attributed in the funnel report
(AC4): `provisionMoveIn`'s `move_in_completed` event now carries
`recoveredByAbandonment`, and the funnel page shows the resulting count.
26 new DB tests (against real rows and the real seeded catalog) plus the
17 pure-function tests already covered in the design pass.

**What it decided.**

- *`CheckoutSession`, not the separate `Reservation` entity, is FR-LEAD-4's
  "reservation started event."* The PRD's own US-9 wording ("unit selected,
  contact info captured") describes checkout step 1, and the free-hold
  `Reservation` model has no such multi-step form to abandon. Recorded here
  rather than re-litigated: a later item reading "reservation" in this PRD
  section should read it as "checkout."
- *`CheckoutStatus.abandoned` is deliberately never written.* The enum value
  exists but a dedicated `abandonmentSequenceStep Int` counter (0–3) tracks
  progress instead — the same shape `Lead.dripStep` (B-072) uses. Setting
  `status: 'abandoned'` would risk mutating a session out from under a
  renter who is simply slow, and nothing downstream (the checkout page's own
  `relock` fallback) distinguishes `abandoned` from `expired` anyway.
- *A lapsed 30-minute lock (`status: 'expired'`) is NOT an exit condition* —
  only `completed` is. By the time the first follow-up can fire (60+
  minutes in), an expired lock is the ordinary case, not evidence the
  renter is gone; the existing `relock` UI already lets them recover the
  unit (or another one) the moment they click back in.
- *The resume link is a second, separate signed-and-unstored token*
  (`resume-token.ts`, mirroring `quote-token.ts`/`unsubscribe-token.ts`),
  not the session's own token. The live session token is minted once at
  step 1 and only its hash is ever stored, so there is nothing left to
  re-send days later. Visiting the link mints a FRESH real session token
  (`reissueCheckoutToken`) and redirects into `/checkout?token=...`, so
  `advance`/`extendLock`/`relock` see exactly the shape they already
  handle — no new state machine.
- *Step 3's promo line is required-but-not-gated at the rule level*, the
  same device `lead_drip_promo_nudge` (B-072) uses: with no live promo the
  render throws on the missing field and the send is logged `failed` — a
  deliberate no-op, not a promo-less repeat of steps 1/2.

**What it left behind.**

- `checkout.abandonment_step`'s templates are operator-editable through the
  existing CN-16 editor, same as every other B-072-era template — no new UI
  needed beyond the merge-field entries this item added.
- Recovery attribution lives on the funnel report as a single count/rate,
  not a dedicated dashboard — AC4 only asks that recovered move-ins be
  "attributed... in funnel reporting," and a fuller breakdown (by step, by
  facility) can build on the same `properties.recoveredByAbandonment` flag
  without a schema change.
- Same seeding gotcha as every comms-catalog item before it: `db:seed` and
  `db:migrate:test` both re-ran after adding the three templates/rules, or
  the new sequence would have matched nothing in either database.

---

## B-074 — SMS channel live

`202ae29`

**What it built.** FR-5/FR-7/FR-8 and CN-13/CN-14: a second delivery channel
alongside B-030's email pipeline. `NotificationRule`/`MessageTemplate` were
already channel-keyed (B-030's own design); this item is what actually reads
`channel`/`channelPolicy` rather than hardcoding `email` everywhere. A new
`deliverSmsForRule` (Twilio, REST, no SDK — same convention as
`resendProvider`) sits beside the untouched `deliverForRule`: SMS consent
(`account_sms`, TCPA requires it for every classification, not just
marketing), phone normalization to E.164, quiet hours (8am-9pm
facility-local, configurable, applied to every classification unlike
email's marketing-only window), and a preference-center gate all sit in
front of it, falling back inline to the sibling email `MessageTemplate` of
the same key when SMS is not viable — one shared idempotency key per
(event, rule, recipient) for `sms_preferred_email_fallback` rules, so
exactly one channel's `Message` row ever settles. Quiet-hours SMS neither
sends nor falls back — it `defer`s (a new `MessageStatus` value) and the
hourly cron sweeps it once the window reopens, re-checking staleness
best-effort against the original event first. Five templates got real SMS
bodies (`invoice_due_soon`, `invoice_due_today`, `payment_retry_reminder`,
`payment_method_expiring`, `access_suspended`); a sixth channel a facility
never configures (`smsMessagingServiceSid` null) degrades every one of them
to email-only, silently, the same honest-degradation posture as an unset
`RESEND_API_KEY`. Inbound STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, HELP and
START/UNSTOP land on `/api/comms/sms-webhook` (hand-rolled Twilio signature
verification, no SDK) and reply via TwiML; the same `applySmsStop`/
`applySmsStart` functions are what the portal's "turn off text messages"
button calls, so the two entry points can never drift. A new
`/portal/notifications` page is CN-13's preference center: three categories
(payment reminders, receipts, operational notices) × two channels, plus a
read-only SMS consent state display. 68 new tests (23 pure, 6 signature,
39 against the database and the real seeded catalog).

**What it decided.**

- *`dunning_step` (the delinquency-stage ladder) and both lien-notice
  supplements NEVER get an SMS variant, permanently* — recorded as D-36. The
  backlog line's "SMS variants of all reminder/dunning templates" and CN-13's
  "legally significant messages... are email-mandatory and cannot be toggled
  off" name the same template in opposite directions; the PRD's explicit
  carve-out wins. `access.suspended` DOES get one — a consequence of
  non-payment, not a delinquency stage itself, and exactly the kind of thing
  a tenant wants to know about the moment it happens.
- *One `NotificationRule` row per templateKey, never two.* A rule that gets
  an SMS variant has its existing row's `channel` flipped from `email` to
  `sms` (plus `channelPolicy`), not a second parallel rule — `applicableRules`
  dedupes by templateKey alone, so two active rows for one key is exactly the
  ambiguity that dedup exists to not have. The seed script's identity for
  "which row to update" changed from `(event, templateKey, channel,
  facilityId)` to `(event, templateKey, facilityId)` for this reason — the
  old identity orphaned the email row under its old channel instead of
  updating it, and shipped as a real bug mid-item (caught by the seed
  count going 26→31 templates but 26→31 *rules* instead of staying at 26;
  fixed before the DB carried it into a real facility).
- *`deliverSmsForRule` is its own function, not a parameterized
  `deliverForRule`.* The two channels diverge enough (phone vs email,
  consent gate, quiet-hours scope, no HTML/postal-footer/unsubscribe, an
  inline fallback) that threading `channel` through the existing 200-line,
  well-tested function would have cost more clarity than the duplication it
  avoided. `applicableRules`/`effectiveTemplate`/`suppressionFor`/
  `writeMessage` DID generalize (a `channel` parameter, defaulted so every
  existing email call site needed zero changes) — those were mechanical and
  low-risk; the delivery function itself was not.
- *SMS requires `account_sms` consent for EVERY classification*, not just
  marketing — TCPA's prior-express-consent requirement is about the channel,
  not the content, unlike PRD 04's marketing-consent carve-out for
  transactional email. No `marketing_sms` rule is seeded (B-072 never built
  that capture flow), so this item's consent check is the only one that
  matters yet.
- *Twilio Advanced Opt-Out (the provider-level half of CN-14's "provider +
  app level") is an operator console setting, not code* — this item builds
  and controls only the application-level layer (`Suppression`, checked at
  every send regardless of what Twilio's own list says), the one thing this
  codebase actually owns. The settings screen's own copy says so.
- *`processCommsEvent`/`deliverSmsForRule` take an optional `now`*, defaulted
  to the real clock. FR-8's quiet-hours check needs a fixed instant to test
  deterministically, the same reason `raiseAbandonmentFollowUps`/
  `sendExpiringSoonReminders` already take one.

**What it left behind.**

- The async fallback trigger FR-15 also names — a provider-reported
  "undelivered/carrier filtered" status arriving later via Twilio's delivery
  webhook — has no consumer. This item only catches the SYNCHRONOUS failure
  (a network error, an immediate 4xx from Twilio's own API). The webhook
  itself (FR-14's SMS status callback) is unbuilt; B-054's delivery
  dashboard is the natural owner of both.
- HELP/an ordinary inbound reply that is not STOP/START gets acknowledged
  with no action and no reply. A tenant texting back a real question has
  nowhere for it to go — a two-way inbox is explicitly B-090 scope (Phase 3),
  not this item's.
- `NotificationRule.delayMinutes` stays unread — FR-3's "send-time offset the
  comms service owns" has no consumer yet; nothing in this item needed it.
- Portal re-enabling SMS after a STOP has no button — only the inbound START
  keyword lifts a stop-reasoned suppression. CN-13's own AC only asks for
  the portal to match STOP's effect (revoke), not START's; a portal
  re-consent flow is a real gap but not one this AC covers.
- `facilityContactForPhone` (the HELP reply's "identification + support
  contact") is best-effort by phone match — a prospect who never rented, or
  two tenants sharing a household number, gets a generic identification line
  with no facility-specific phone. No per-number-to-facility index exists;
  Twilio Messaging Services route by pool, not by a mapping this schema
  keeps.
- CN-16's template editor (segment counter, 160-char warning for SMS) was
  not touched — the editor still assumes email. The five new SMS bodies are
  short enough to have shipped without it, but a future SMS template edited
  through that screen has no length feedback.

---

## B-075 — Delivery dashboard + alerting

`659f72f`

**What it built.** CN-19's reporting half (the AC's own sentence — "hard
bounce or invalid number auto-flags the tenant record and creates a task" —
already shipped with B-054) and all of FR-19. A new `/admin/reports/
deliverability` page: overall and per-(template, channel) delivery/bounce/
SMS-failure rates, a by-day trend, the failure queue (a count linking into
`/admin/tasks` filtered to `no_reachable_channel` — the same "filtered view
of the one list, not a table of its own" device `failed_payment`'s own
catalog comment already named), and a dead-letter list finally reading
`deadLetters()` (exported by B-054's own predecessor, wired to nothing until
now). Three rate functions in a new `packages/core/metrics/comms.ts` are
the one place `deliveryRate`/`bounceRate`/`smsFailureRate` are defined, same
rule as every other report in that directory. Three silent-failure
detectors, each dropped exactly where its own condition is already known
rather than re-derived: a new daily per-facility `SCHEDULED_JOBS` entry
checks yesterday's failure rate against FR-19's >2% line; `billing.dunning`'s
existing handler now also calls a detector with the `DunningResult` it just
produced (a new `eligible` counter on that result — leases the ladder
actually evaluated as due a step — is what makes "delinquent tenants exist"
answerable from the ladder's own decision rather than a second, possibly-
disagreeing definition); and the hourly cron tick now also checks every
comms consumer for events over 15 minutes stale, via a new
`staleDeliveryCount` export sitting beside `deadLetters()` in
`packages/core/events/dispatch.ts`. All three alert through one new
`alertOwner()` (`apps/web/lib/comms/alerts.ts`), which reuses `sendDirectEmail`
rather than inventing a second notification path — deduplication is that
function's own idempotency key (`alert:<kind>:<scope>`), not a new table, so
a detector re-checking an ongoing problem sends nothing a second time today.
29 new tests (16 pure rate/threshold, 13 against the database and the real
seeded `owner` role).

**What it decided.**

- *"Alert to owner" is an email to whoever holds the `owner` role*, found the
  same way D-12's "no superuser bypass" already treats that role as the
  single unrestricted identity — not a new alerting channel, dashboard
  banner, or on-call rotation. If nobody has been bootstrapped into `owner`
  yet (a fresh dev/test database), the detector reports nothing sent rather
  than erroring, the same honest-degradation posture `commsEnabled()`/
  `selectProvider()` already use for an unconfigured environment.
- *FR-19's "day's sends fail" reads as bounced-or-failed, not `failed` alone*
  — a bounce and an outright provider rejection are the same operator
  problem (a bad list, a broken template, a provider outage) and nobody
  triaging a 2am alert cares which `MessageStatus` bucket caused it.
- *`DunningResult` gained a field (`eligible`) rather than the detector
  re-querying "which leases are delinquent" itself.* A second definition of
  delinquency computed outside the ladder could disagree with the ladder's
  own — an operator halted for `on_hold` or already fully stepped would
  read as "silently failed" under a naive re-derivation, which is exactly
  the false alarm a silent-failure detector must not raise.
- *SMS failure rate excludes `suppressed`* (no consent, opted out) —
  tracked as a distinct fact from a delivery failure, not folded into the
  same rate. CN-19 asks for both an "SMS failure rate" and an "opt-out
  rate" as separate figures; conflating them would make neither number mean
  one thing.
- *Opt-out rate is NOT built.* `Suppression` carries no `facilityId` by
  design (CN-20: the shared list is org-wide by address), so a genuinely
  per-facility opt-out rate cannot be computed from it, and attributing an
  address-scoped fact to the facility an admin happened to have selected
  when they added it would be a number that looks precise and is not. Left
  as a documented gap rather than a misleading figure — the page says so,
  and points at Suppressions (CN-20) for the address-level list instead.
- *The "alert if a dunning run sends zero" detector runs inside
  `billing.dunning`'s own handler, not as a separate scheduled job* — the
  `DunningResult` it needs only exists inside that call, and a second job
  re-running the ladder's logic to get it would be the exact duplicate-
  definition risk the decision above already rejected.

**What it left behind.**

- The failure-queue count on the dashboard is genuinely cross-facility (the
  same `reportableFacilities` scoping every other report uses), but its
  "open task" link lands on `/admin/tasks`, which is single-facility by
  design (B-095) — the link carries whichever facility the report was
  filtered to, or none, in which case the tasks screen falls back to its own
  switcher default. A true cross-facility failure-queue LIST (not just a
  count) has no screen; building one is `/admin/tasks`'s own scope, not this
  item's.
- FR-15's async SMS fallback trigger ("undelivered/carrier filtering" from
  Twilio's own delivery-status webhook) still has no consumer — B-074 left
  this behind and B-075 does not close it either. `smsFailureRate` on this
  dashboard is therefore a floor: it counts every SYNCHRONOUS failure
  correctly, but an SMS Twilio accepted and later marked undelivered is
  invisible to it until that webhook exists.
- Dead letters are read-only. There is no retry/requeue button — matching
  `GateCommand`'s own precedent (a dead-lettered command needs the
  ManualAdapter's human intervention, not a generic "try again"), a
  dead-lettered `EventDelivery` needs someone to read `lastError` and decide
  whether replaying it is even safe, which a button cannot judge.
- The `>2%` and `15 minutes` thresholds in FR-19 are constants
  (`dailyFailureRateExceeds`'s default parameter, `CONSUMER_LAG_MS`), not a
  facility setting — unlike every other number this codebase's own rule
  says needs a form field, these configure an internal alarm rather than
  tenant-facing behaviour, which is the distinction B-062's surplus-hold-days
  precedent draws the same way.

---

## B-076 — Tenant rate increases

`d8d53b8`

**What it built.** US-11 end to end, and the first use of two things reserved
long before this item: the `rates:tenant_increase` permission and the
`rate.tenant_increased` audit action, both defined and unreferenced since
B-004/B-005. A new `TenantRateIncrease` model carries the lifecycle
(pending → approved → notice sent → applied, plus cancelled); the
append-only `LeaseRateChange` history it eventually writes gains only a
nullable `rateIncreaseId`, which is US-11's own "notice-sent reference
(nullable until this story ships)". Scheduling comes two ways — one-off
(this tenant, this rate, this date) and rule-based (US-11's own example:
≥9 months since the last change and ≥$15 below street, raised to street) —
both refusing an effective date that breaks the facility's new
`rateIncreaseNoticeDays` (default 30, with its own settings control).
Approval is regional-or-owner with a required reason code, matching the
auction bar. Two new nightly jobs: notices go out at 10am local on the
notice date (emitting `lease.rate_increase_scheduled` into the ordinary
comms pipeline, with a new template quoting all four of CN-9's merge
fields), and increases apply at hour 0 — deliberately BEFORE
`billing.generate-invoices` at hour 1, which is what makes "the first
invoice on/after the effective date" true without `invoices.ts` needing an
effective-dated read of its own. A new `/admin/rate-increases` screen is
US-11's review screen: pending increases with the projected monthly revenue
delta, the rule's current worklist, and approve/cancel per row or per batch.
69 new tests (39 pure, 30 against the database and the real seeded catalog).

**What it decided.**

- *The workflow row is a new model, not a status column on `LeaseRateChange`
  — recorded as D-37.* That table is what a billing dispute reads to answer
  "which rate applied on this date"; a mutable status on it would make the
  history editable, and a cancelled increase would leave a history row for a
  change that never happened. PRD 02 §5 already names `TenantRateIncrease` as
  its own entity.
- *The notice is email only; the postal/`Notice`-document path is not built —
  also D-37.* CN-9 scopes itself to "the electronic copy" and hands the mail
  queue and the legal-sufficiency call to PRD 02, and the per-state "requires
  written notice" flag it would key off is exactly what D-10's unfinished
  attorney pass governs. `NoticeType.rate_change` already exists in the enum
  for whenever that lands.
- *`applyRateChange()` is now the ONLY way `Lease.monthlyRateCents` moves*,
  which is US-11's schema AC finally enforced ("written only through the
  function that writes the history row — the same discipline as
  `recomputeUnitStatus()`"). Until this item there was one hand-rolled
  inline writer (move-in) and no such function. Exported so B-077's
  transfers and any later promo-expiry path use it rather than touching the
  column.
- *An increase is applied only from `notice_sent`, never from `approved`.*
  That one guard is what makes "no tenant is charged more without having
  been told" true by construction rather than by the two jobs happening to
  run in the right order.
- *An increase whose lease rate moved after approval is REFUSED, not
  applied.* The approver signed off on a delta from a specific figure; the
  run records a failed item naming both rates rather than quietly applying
  the increase to a number nobody agreed to.
- *`notice_sent` is still cancellable.* The case that matters most is an
  operator who changes their mind after the letter went out — telling the
  tenant it is cancelled is a phone call, not a reason to make the charge
  unstoppable.
- *`rateVariance` (core metrics) was made generic* rather than duplicated, so
  the worklist and the rate-variance report cannot disagree about which
  lease is most worth raising.

**What it left behind.**

- **No mid-cycle proration.** US-11's AC allows for it ("with proration if
  mid-cycle billing anniversary rules require it"); this applies the new
  rate to the first invoice GENERATED on or after the effective date and
  never re-rates a period already invoiced. Under D-27's anniversary billing
  each lease's period starts on its own billing day, so an operator
  scheduling to a period boundary gets exactly what they expect — scheduling
  mid-period means the increase lands on the following period rather than
  splitting it. A real simplification, documented rather than hidden.
- **No percentage cap on a rule-based batch.** The rule raises to street,
  full stop. A softer step (cap at +10%, say) is a real feature the AC does
  not ask for, and a guessed cap would quietly become the thing every batch
  does.
- **The one-off form takes a lease ID typed by hand** rather than a tenant
  picker. The rule-based worklist is the path the AC actually describes
  ("the rate-variance report... is the worklist the Phase-2 rate-increase
  workflow runs from"); the one-off form is the escape hatch beside it, and
  a search-and-select control belongs with the tenant-picker work that has
  no item yet.
- **The notice period default (30 days) is still legally unverified.**
  PROGRESS.md has listed it open since B-056 and D-10's attorney pass has
  not happened; the setting, the screen and the email all say so rather than
  asserting a figure.

---

## B-077 — Unit transfer wizard

`8957896`

**What it built.** US-14's transfer: `/admin/tenants/[tenantId]/transfer`, one
screen with a GET-recalculate preview and a single confirmation, reached from
a per-lease link on the tenant profile. Behind it,
`apps/web/lib/admin/transfer.ts` closes the old lease and opens a new one in
**one transaction** — both units' statuses recomputed inside it, which is
US-14's "both units' statuses update atomically" taken literally. Both sides
of the billing period are prorated by calling B-044's `unusedRemainder` and
`prorate` once each, which is exactly what that module's header predicted
("a transfer is a prorated move-out and a prorated move-in on the same day,
so it calls this twice"). Four things reserved long ago finally got used: the
`lease.transferred` event, the `leases:transfer` permission (manager and
above), `LeaseRateReason.transfer`, and `FeeType.transfer`. 18 new DB tests.

**What it decided.**

- *A transfer is NOT `completeMoveOut` + `provisionMoveIn`.* Both were
  considered and neither fits: `completeMoveOut` unconditionally releases the
  unit to `maintenance`, revokes pay links and emits `lease.moved_out` —
  which fires CN-8's "your account is settled" email at a tenant who has not
  gone anywhere; `provisionMoveIn` is welded to a `CheckoutSession` it reads
  and completes. What IS reused is the money, which is the part US-14 and
  US-18 actually mandate. A test asserts `lease.moved_out` is never emitted.
- *`MoveOutReason` gained a `transfer` value* rather than reusing
  `tenant_request`. The former-tenant AR list and the move-out report both
  read this field, and counting a transfer as a departure would show a
  move-out and a move-in for somebody who never left.
- *The new lease is created at the OLD rate, then moved to the new one
  through `applyRateChange`.* That is what makes the `LeaseRateChange` row
  read `previous = what they paid on the old unit, new = the new unit's rate,
  reason = transfer` — creating it at the new rate directly would leave a
  history row claiming the rate had never changed. It also keeps B-076's
  write-through the only writer of `Lease.monthlyRateCents`, which was the
  whole point of building it.
- *`billingDay` is carried over, not recomputed from the transfer date.* The
  tenant keeps their billing anniversary, which is what makes the two
  prorated halves add up to one unbroken period rather than leaving a gap or
  an overlap.
- *The old unit returns to `available`, not `maintenance`.* A move-out holds
  the unit for a "verified empty and clean" check; a transfer happens with
  the tenant on site handing it back in the same visit, so a maintenance hold
  would be theatre. Staff can still mark it from the unit screen.
- *One screen, not a multi-step wizard.* The codebase's only comment about
  wizards (`admin/pos/actions.ts`) argues against building a second stateful
  flow, and this needs none — a GET form recalculates server-side, so the
  arithmetic never happens in the browser and the confirmed figure is the
  posted one, the same discipline the move-out screen established.

**A real bug found and fixed along the way (D-38).** Move-out's proration
divided by the days in the **calendar month**, where US-18's AC says "days in
billing period". Under D-27's anniversary default those differ. Worse, its
day-count did not tile with the charge side: a 1 Aug–1 Sep period with a
15 Aug move-out refunded 16 days while the charge covered 14, so one day of
every prorated move-out was billed to nobody and kept. `proratedCredit` now
delegates to B-044's `unusedRemainder`; a regression test asserts
`charged + refunded === the full period` across all 31 days. **Refunds on
anniversary-billed move-outs get slightly larger.** Fixed rather than worked
around because B-077 would otherwise have shipped a transfer whose two halves
used different arithmetic — and because US-14 and US-18 both already claimed
this math was "built once", which it now genuinely is.

**What it left behind.**

- **Same-facility only**, per US-14's own wording ("another unit in the same
  facility"). A cross-facility move is a move-out and a move-in, and the
  screen refuses one with that reason named.
- **No payment is taken at transfer time.** The net lands on the new lease's
  ledger and is collected by the ordinary billing path. Taking a card at the
  counter is POS work (B-039's surface), not this screen's.
- **The customer-side transfer flow is not built** — that is B-090 (Phase 3)
  and PRD 01 §9 explicitly puts "transfer-unit flow (upsize/downsize online)"
  out of MVP. This is the staff-side one US-14 asks for.
- **A failed gate-credential issue is swallowed**, deliberately: the transfer
  has committed and the tenant has the unit, so a slow controller must not
  roll it back. It surfaces through the same gate queue and
  `move_in_provisioning_failed` path B-026 built, but there is no
  transfer-specific task for it.

---

## B-078 — POS depth: cash drawer + merchandise

`604160a`

**What it built.** US-33's drawer session and US-34's merchandise sales, plus
the deposits reconciliation US-39.6 asks for.

- `packages/core/pos/drawer.ts` — `expectedDrawer`, `varianceOf`,
  `varianceNeedsNote`, `closeProblem`, `depositSlip`. Pure arithmetic over a
  list of tender movements.
- `packages/core/pos/merchandise.ts` — `priceSale`, `saleProblem`,
  `isLowStock`, `margin`.
- `DrawerSession`, `Product`, `MerchandiseSale`, `MerchandiseSaleLine`;
  `Payment.drawerSessionId` so every counter payment is attributable to the
  session that took it; `Facility.drawerVarianceThresholdCents` (default 500)
  with its control on the facility settings screen.
- `/admin/pos/drawer` (open with a counted float, close with a blind count),
  `/admin/pos/merchandise` (sell, adjust stock, low-stock list),
  `/admin/reports/deposits` with a CSV.
- Two permissions: `drawer:manage` (counter, manager, regional) and
  `merchandise:manage` (manager, regional) — 28 permissions, 87 grants.
- Four audit actions: `drawer.opened`, `drawer.closed`, `merchandise.sold`,
  `merchandise.stock_adjusted`.

**What it decided.**

- *Card and ACH never touch the drawer.* `expectedDrawer` ignores them
  entirely. The single most common way a till reconciliation gets built wrong
  is counting the day's card takings into the expected cash, which makes every
  drawer look over by exactly that amount. Cheques and money orders are
  counted, but on their own line — they are banked, not spendable as change.
- *A cash movement counts `amountCents`, and the change is deliberately NOT
  subtracted.* `settleTender` defines change as `tendered − amount`, so the
  drawer takes in the note and hands the change straight back out: net
  movement is `tendered − change`, which is `amount`. Subtracting change again
  double-counts it. `depositSlip` still reports `changeGivenCents` because
  staff want to see it — but it is already netted, not deducted twice.
- *Only one drawer session may be open per facility at a time*, enforced by a
  hand-written partial unique index (`drawer_session_one_open_per_facility`),
  the same mechanism `checkout_session_one_active_per_unit` uses. Prisma
  cannot express a partial index, so it is appended raw to the migration.
- *The close is blind.* The screen asks for the counted cash and cheques
  without showing the expected figure first. A count taken against a number
  already on screen is not a count.
- *A variance past the facility threshold requires a note before the session
  will close*, and an overage is treated exactly like a shortage — an
  unexplained overage usually means a payment was never recorded, which is the
  same failure seen from the other side.
- *A merchandise sale is its own entity, not an invoice line (D-39).* It has
  no billing period, no proration, and no delinquency consequence, and forcing
  it through `Invoice` would put it in the AR ageing of a tenant who owes
  nothing. `REVENUE_CATEGORIES` therefore stays at four, and the existing test
  asserting a `merchandise` line contributes nothing to rental revenue stays
  true.
- *`DrawerSession.businessDate` is a `@db.Date`.* A session opened at 8am and
  closed at 6pm is one facility-local day; a timestamp would turn "which day
  was this" into a timezone question, which is exactly what the deposits
  report groups by.

**A real bug the tests caught.** The first `expectedDrawer` subtracted
`changeCents` from `amountCents`, so a $60 bill paid with a $100 note read as
$20 in the drawer instead of $60. Every close-out that gave change would have
looked short by the change given. The implementation was fixed, not the test.
Two smaller things went with it: `SellResult.changeCents` was typed `number`
where `settleTender` returns `number | null` (null for cheque and money order,
by design — widened rather than cast), and `sellMerchandise` returned
`'no_product'` for a missing tenant, which now has its own
`'tenant_required'` code.

**What it left behind.**

- **No cash-count denomination breakdown.** The close takes one cash total,
  not a tally of twenties and fives. Operators who want a denomination sheet
  count on paper; adding it is a form change, not a model change.
- **No mid-shift drop or paid-out.** Everything that moves cash moves it as a
  `Payment` or a refund. A safe drop would need its own movement type.
- **No purchase orders or supplier records.** `Product.stockCount` is adjusted
  by hand with an audited reason. Receiving stock against a PO is out of MVP
  scope entirely.
- **Deposits are reported, not banked.** The report tells staff what to take
  to the bank; there is no bank-deposit record to reconcile against, and no
  bank feed.

---

## B-079 — Staff MFA + org-level defaults

`d654876`

**What it built.** Two halves of PRD 00 §7.1 and PRD 02 US-4.

*TOTP MFA for staff.*

- `packages/core/auth/totp.ts` — RFC 4226 (HOTP), RFC 6238 (TOTP) and RFC 4648
  (base32) implemented directly, plus `otpauthUri` and recovery-code shaping.
  `tests/totp.test.ts` runs every published vector from all three RFCs.
- `apps/web/lib/auth/totp-secret.ts` — AES-256-GCM at rest, keyed by HKDF from
  `AUTH_SECRET` with its own `info` string.
- `StaffUser.totpSecret / totpConfirmedAt / totpLastStep`, `StaffRecoveryCode`.
- `/mfa` — enrolment, and the recovery codes, shown once.
- The admin layout gate, and `/admin/settings/staff` for an owner to see who is
  enrolled and reset a lost second factor.
- Four audit actions: `mfa.enrolled`, `mfa.recovery_code_used`,
  `mfa.recovery_codes_regenerated`, `mfa.reset_by_admin` (reason required).

*Org-level defaults (US-4).*

- `OrgDefault` (one row per scope: fee schedule, late-fee ladder, delinquency
  timeline), `packages/core/org/defaults.ts` for the comparison, and
  `/admin/settings/org` to edit, compare and push.
- New permission `org:defaults` (owner, regional) — 29 permissions, 89 grants.
- Two audit actions: `org_default.updated`, `org_default.pushed` (per facility).

**What it decided.**

- *MFA is mandatory, with no toggle (D-40).* §7.1 states it as a property, not a
  setting. A toggle would be a column whose only correct value is `true`, plus a
  code path for `false` that exists to be a hole.
- *Verification is at sign-in; enforcement is at the admin surface.* An
  unenrolled staff member authenticates normally and then reaches `/mfa` and
  nothing else. Blocking the sign-in would leave a new hire unable to ever
  enrol, and would break `system` integration accounts that authenticate but
  never browse the admin. The gate reads the database on every admin request
  rather than a JWT claim, so an administrator's reset takes effect at once
  instead of after the remaining thirty days of a session.
- *There is never a half-authenticated session.* No JWT is issued until the
  second factor has passed, so no "MFA pending" state exists for anything to
  forget to check.
- *Staff magic links are refused at both ends (D-40).* A link that signs
  somebody in on possession of their inbox IS a second factor; offering it
  beside a mandatory TOTP prompt would let every enrolment be walked around
  with one click. `requestMagicLink` will not mint one and the credentials
  provider will not spend one — both, because links minted before this shipped
  are still sitting in inboxes.
- *The second factor is verified BEFORE the login attempt is recorded.*
  Recording a success on a correct password and failing MFA afterwards would
  clear the throttle counter on every attempt, leaving a six-digit code free to
  brute-force. A wrong code is now a failed attempt, throttled at five per
  fifteen minutes like any other.
- *A TOTP code may be spent once* — `totpLastStep` rejects any step at or below
  the last accepted one, claimed with a conditional `updateMany` so two racing
  requests cannot both win. Without it a shoulder-surfed code stays valid for
  about ninety seconds across the drift window.
- *An unreadable secret fails closed.* A rotated `AUTH_SECRET` makes every
  stored secret undecryptable; treating that as "no second factor configured"
  would turn a key rotation into a silent MFA bypass across every staff account
  at once.
- *Recovery codes are SHA-256, not argon2* — the opposite of the usual
  reasoning. They are 50 bits of machine entropy, so there is nothing to
  brute-force, and verification means testing against every unused code the
  person holds; ten argon2 runs per attempt would be a self-inflicted denial of
  service.
- *The login form always shows the code field for staff*, rather than revealing
  it after a first submit. A reveal would have to answer "does this account have
  MFA?" before anyone had authenticated — account enumeration — and would make
  every staff sign-in two round trips.
- *Org defaults are pushed, never resolved at runtime (D-41).* A push writes
  ordinary effective-dated rows into the receiving facility's own tables, so
  invoicing, the late-fee job and the delinquency engine keep reading exactly
  one place. A runtime fallback would change what a facility charges the moment
  somebody edited a central record, with no effective date and nothing in that
  site's history saying what happened.
- *"Overridden" is computed, not stored (D-41).* A boolean would be a second
  source of truth that goes stale the first time anyone edits a facility fee
  directly. The comparison also names what diverges — "overridden: admin fee,
  late step 2" — because "Overridden" alone sends an owner to inspect twelve
  sites, which is the work the screen exists to save.
- *A facility that already matches is skipped, not rewritten.* These tables are
  append-only, so pushing unconditionally would file an identical row at every
  site every time the button was pressed.
- *Push access is checked per facility*, against `facility:settings` at that
  facility, not once for the batch — the ids arrive from a form, and a regional
  manager must not reach a site they hold no assignment for by adding its id to
  the POST. Editing the default itself is checked org-wide, which only an
  all-facilities assignment satisfies.
- *Notice templates get no push (D-41).* `MessageTemplate` already resolves
  org-level → facility override at render time, so the org default is already
  live everywhere that has not diverged; pushing would turn every inheriting
  site into an override of the thing it was tracking. What was missing was the
  visibility half, which is what shipped.
- *There is no second timeline editor.* The org timeline default is ADOPTED from
  a facility's active timeline, because `/admin/settings/delinquency` already
  validates every step against the notice templates that exist — and a second
  place for a lien timeline to be wrong is not worth having.

**What it changed elsewhere.** The e2e suite now signs in once per run through a
Playwright setup project and replays the saved session, instead of once per
spec. Forced rather than chosen: a TOTP code is single-use, so twenty
fully-parallel specs signing in inside the same thirty-second window would have
had nineteen correctly rejected as replays. The demo owner is enrolled with a
published demo secret (`demo-credentials.ts`, same guard as the demo password —
`seed-demo.mts` refuses to run with `NODE_ENV=production`), so the suite
exercises the real second factor. **There is no test-only MFA bypass anywhere**,
which was the point.

`FormState` gained an optional `details?: string[]` on the success variant,
rendered by `AdminForm` as a list outside the live region. Recovery codes are
what it exists for: a list somebody must read, copy or print cannot be a single
run-on utterance announced once and left behind by the focus.

**A real bug found and fixed in B-078's deposits report.** It bucketed payments
by `receivedAt`'s **UTC** day while a drawer session carries the facility-LOCAL
one (`businessDate`), and a comment asserted the two matched. They do not: 6pm
in Chicago is 23:00 UTC the same date, but 7pm is 00:00 UTC the *next* one — so
every drawer counted after the office shut landed on a different row of the
report from the cash it was counting, each showing a variance against an empty
column. Now bucketed by the facility-local day on both sides, through the same
`businessDateFor` the session itself uses. The regression test constructs an
explicit late-evening payment rather than trusting the clock, because the bug
was invisible for nineteen hours a day and B-078's own runs happened to fall
inside those hours — it surfaced only because this item's verification ran after
7pm.

**A repo hazard found along the way**, now recorded in CLAUDE.md: appending
hand-written SQL to an already-applied migration (which B-078 did for its
partial index) changes the file's checksum, and the next `prisma migrate dev`
offers to reset the development database. `prisma migrate status` does not catch
it, so it stayed invisible until this item. Repaired by recomputing the hash into
`_prisma_migrations`, not by resetting.

**What it left behind.**

- **No QR code on the enrolment screen.** The secret is shown grouped in fours
  for manual entry, with an `otpauth://` link that opens an authenticator app
  directly on a phone. A QR needs Reed–Solomon encoding — not "a few lines" —
  so it would mean a dependency; add `qrcode` if desktop-to-phone enrolment
  friction turns out to matter.
- **No WebAuthn / passkeys.** §7.1 names TOTP specifically.
- **Rotating `AUTH_SECRET` invalidates every enrolment** and requires every
  staff member to re-enrol. That is the correct blast radius, but there is no
  re-encryption migration path — the `v1.` prefix on the stored ciphertext is
  what would make one possible later.
- **No "remember this device for 30 days".** Every staff sign-in asks for a
  code.
- **A pushed default cannot REMOVE an extra ladder rung** a facility added
  locally. The comparison reports it (`step 3 (extra)`), but effective-dated
  rows have no tombstone, so removing it is a manual edit on that facility's own
  settings screen. Pre-existing, not introduced here.
- **Org defaults cover three scopes, not every setting.** Billing policy,
  protection plans and gate hours are still per-facility only.

---

## B-080 — Gate hardening: reconciliation, contract suite, one vendor stub

`9772d98`

**What it built.** PRD 03 §8 Phase 2's operational hardening, in six parts.

- **Reconciliation (FR-9).** `packages/core/access/reconciliation.ts` is the
  pure diff; `apps/web/lib/access/reconciliation.ts` builds the expected side
  and records a `GateReconciliationRun` per facility per day. Nightly at 3am
  facility-local, plus an on-demand button. Raises a `gate_drift_review` task
  and a `gate.drift_detected` audit entry.
- **The port gained a read side.** `GateAdapter.snapshot()` — required, not
  optional (D-42).
- **Adapter contract suite** (`tests/adapter-contract-db.test.ts`): one set of
  assertions run against the simulated adapter, the vendor stub and the manual
  adapter.
- **One vendor stub (D-18/D-43):** `pti-emulator.ts` is a fake vendor with a
  deliberately different shape; `pti-cloud.ts` is our driver for it. Selected
  per facility by `gateAdapter = 'pti_cloud'`.
- **Webhook secret rotation (SR-4):** per-facility `GateWebhookSecret` with a
  24-hour dual-secret window, a partial unique index for "exactly one active",
  and a prune once the window closes.
- **Camera links (FR-10)** and a **gate health dashboard** at
  `/admin/access/health`.

**What it decided.**

- *`snapshot()` is required of every adapter, and "cannot verify" is not "no
  drift" (D-42).* An optional method would make every caller ask whether an
  adapter supports reading back; the honest answer for the manual adapter —
  "nothing at this site is verified" — is exactly what the report must be able
  to say. A facility that could not be checked is still recorded, because a
  site that silently drops out is one nobody notices has been unverified for
  six months.
- *Drift is matched by credential id, not by code.* Matching by code would
  report a rotation as a missing credential plus an unknown one — two findings
  for one fact, and every rotation looking like a break-in.
- *Findings carry hashes, never codes.* They land on a screen, in a job log and
  on a task; SR-1 keeps codes out of all three. A test asserts the stored
  findings contain neither the old nor the new code.
- *Each drift says whether the gate ended up MORE permissive than intended.*
  That is the distinction a manager needs at 7am: a code that opens when it
  should not is somebody in the building, while one that fails to open is
  somebody on the phone. Only the first makes the task high priority.
- *A revoked credential the controller has forgotten is NOT drift.* That is the
  system working, and reporting it would make every move-out generate a
  finding.
- *An offline controller reports "not verifiable", never an empty entry list.*
  An empty list would read as "the controller holds nothing" and flag every
  credential at the site.
- *One task per facility per day, not one per finding.* A controller restored
  from a backup produces dozens at once.
- *The emulator was written to be inconvenient (D-43)* — its own ids, one call
  that sets PIN and status and window together, numbered time zones instead of
  schedules, HTTP-ish codes the driver must classify. A stub shaped like our
  own port would have proved nothing.
- *Rotation keeps the old secret for 24 hours.* A vendor cannot switch keys at
  the same instant we do, and a single-secret rotation drops every gate event
  in flight while somebody pastes a value into a portal.
- *The new signing secret is shown once and never again.* An admin screen that
  could display every site's signing key is what SR-1 exists to prevent.
- *Camera links only, no iframes — settling OQ-8.* A viewer that refuses to be
  framed renders a blank box, and staff cannot tell that from a dead camera.
  URLs are https-only and rejected if they carry embedded credentials; the
  audit entry records the host, not the path, because a viewer path can carry a
  camera token.

**What the vendor stub found.** The port survived three of the four frictions
unchanged. The fourth is real and is written down rather than papered over:
`set_time_window` accepts an arbitrary weekly schedule and this vendor can only
express "always" or "site hours". The adapter degrades honestly — the window
fingerprint reports what the gate is *actually* enforcing — and reconciliation
compares like with like per adapter, so a PTI site does not report drift on
every credential forever. Second friction worth naming: because the vendor sets
PIN and status in one call, the driver must read grant state before pushing a
code, or rotating a suspended tenant's code silently restores their access. The
contract suite now asserts that for every adapter.

**A second test defect found and fixed: three suites only passed during the
working day.** The full run at 22:00 reported eight failures in
`checkout-abandonment-db`, `lead-drip-db` and `review-request-db` — all of the
shape "expected [] to have a length of 1". None of them were caused by this
item; stashing every B-080 change reproduced them exactly. The cause is that
each of those suites sends a MARKETING message, and `deliverForRule` refuses
marketing during quiet hours (FR-MSG-5: before 8am or from 9pm, facility-local)
against the **real wall clock**. The production behaviour is correct — nobody
should be emailed a promo at ten at night — so the fix is in the tests, which
now pin `Date` to midday Central. They previously meant something different
depending on the hour they ran, and would have failed in CI on any runner whose
clock put America/Chicago outside 08:00–21:00. Only `Date` is faked; faking
timers wholesale hangs the Prisma round trips these suites are built from.

**A test-coverage hole found and closed.** Six of the rotation assertions —
the whole encrypted-at-rest half of SR-4 — skipped themselves locally and in
CI, because `ACCESS_CODE_ENCRYPTION_KEY` was unset and every affected code path
takes a degraded branch without one. `vitest.config.ts` now sets a fixed
test-only key, so the ENCRYPTED paths are the ones under test. A security
feature whose tests quietly opt out is worse than one with no tests, because
the green run says otherwise. The suites that need the *unconfigured* behaviour
delete the variable themselves and restore it.

**What it left behind.**

- **No real vendor driver.** D-4 and D-18 both stand: this is a driver against a
  fake vendor, and B-085 (Phase 3, contingent on a partner agreement) is the
  first real one. The emulator must never be pointed at a live site.
- **No nonce replay cache.** SR-4 names one alongside the timestamp tolerance;
  the ±5-minute window shipped with B-028 and the cache did not. Nothing
  external can reach the endpoint yet, so a replay needs a captured in-process
  request — but this is a genuine gap in SR-4, not a resolved one.
- **Drift is reported, never auto-repaired.** The reconciliation raises a task
  and stops. Re-pushing automatically would mean a nightly job writing to gate
  hardware unsupervised on the strength of a comparison that has just told you
  the two sides disagree.
- **No drift trend over time on any screen.** The rows carry the history
  FR-9's "metrics" asks for; the dashboard shows only the latest run.
- **Camera links are unordered in practice** — `sortOrder` exists on the model
  and there is no UI to set it.

---

## B-081 split → B-102–B-107, and B-102 — monthly statements centre

`ed5479c`

**The split first (D-44).** B-081 bundled six unrelated features behind one
number. Backlog note 8 always intended these tail bundles to be split when
reached; B-078 and B-080 were each built whole because their parts shared a
schema and a screen, and B-081's do not — a mapping vendor, a payment method, a
statements read model, an insurance workflow, a gate-access surface and a
rewrite of the checkout core touch six PRD sections and six tables. It is now
B-102 (statements), B-103 (ACH + Stripe Link), B-104 (insurance tier change +
proof upload), B-105 (portal authorized-access self-service), B-106
(future-dated + multi-unit checkout — the only one that changes checkout's core
assumptions) and B-107 (map view, **blocked** until §10 OQ-6 has a maps vendor,
and ordered last for that reason). The dropped size-estimator quiz stays
dropped.

**What B-102 built.** PRD 01 US-705's "monthly statements".

- `packages/core/billing/statements.ts` — `buildStatement`, `reconciles`,
  `statementMonths`, `monthBounds`, all pure.
- `packages/core/jobs/schedule.ts` gained `zoneOffsetMinutes` and
  `zonedMidnight` — the inverse of `businessDateFor`, which did not exist.
- `apps/web/lib/billing/statements.ts` — the read model, plus the staff-side
  gate.
- `/portal/statements` and `/portal/statements/[leaseId]/[period]`; the same
  document for staff at `/admin/tenants/[id]/ledger/[leaseId]/statements`,
  through one shared `StatementView` component.

**What it decided.**

- *A statement is derived, never stored.* `LedgerEntry` is append-only, so a
  month recomputes to the same figures forever. A stored copy would be a second
  source of truth that could disagree with the ledger the business runs on. A
  later reversal appears in the period it was made — which is what an accountant
  expects — rather than silently rewriting a month already sent.
- *The closing balance is opening + movement, never a second independent sum.*
  Two sums that should agree are two things that can disagree, and the one
  thing a statement may not do is fail to add up.
- *A statement that does not reconcile throws.* `reconciles()` is called by the
  read model, not only by tests. Rendering it anyway puts a document in front of
  somebody's accountant that is wrong in a way nobody noticed.
- *Month boundaries are facility-local midnight, not UTC.* A payment taken at
  8pm on the 31st belongs to that month. This is the same mistake B-078's
  deposits report shipped with, caught this time before it shipped — a DB test
  files a 01:00 UTC payment into the previous local month, and a pure test
  asserts consecutive months have no gap and no overlap.
- *Months with no activity are listed.* "Nothing happened in March" is an
  answer a bookkeeper may need, and a gap in a numbered list reads as a missing
  document.
- *Ended leases keep their statements.* A moved-out tenant still needs last
  year's, which is most of why persona P5 wants this screen at all.
- *Staff see the identical document, gated exactly like the ledger*
  (`assertFacilityAccess` + `tenants:view` at the lease's own facility). Two
  implementations of a financial summary is two chances for them to disagree in
  front of a tenant; a different URL must not be a way around the ledger's own
  scoping.
- *Still HTML, not PDF.* B-023's standing decision holds — no JavaScript PDF
  library available to this project emits tagged PDFs, and an untagged statement
  is exactly the §6.8.1 accessibility failure. The browser's print dialogue
  makes a paper copy.

**What it left behind.**

- **No PDF and no emailed statement.** Both wait on the same unbuilt PDF
  encoder port. There is no "email me this statement" action.
- **No statement-level tax breakdown.** Line descriptions carry what each charge
  was; §3's "taxes itemized" is satisfied at the invoice, not summarised as a
  tax total per month.
- **No cross-lease consolidated statement.** A tenant with three units gets
  three lists. Consolidated billing is explicitly Phase 3 (§9, "business
  accounts").
- **No paging.** A tenant with six years of history gets 72 links on one page.

---

## B-103 — ACH bank debit + Stripe Link

`7dbc517`

**What it built.** PRD 01 §3's remaining payment methods, and the settlement
state ACH forced.

- `packages/core/billing/payment-methods.ts` — `methodsFor(surface, policy)`,
  the pure decision about which methods each surface offers.
- `PaymentStatus.processing`, `Facility.achAtCheckoutEnabled` (default off),
  and the `payment.processing` domain event.
- `payment_intent.processing` in the Stripe reconciler, plus `methodOf` — the
  first moment the real payment method is knowable.
- `leasesWithSettlingPayment` and its three callers: late fees, dunning and
  gate suspension.
- A `settling_payment_failed` task for a debit that bounces after acceptance.
- Portal copy (dashboard panel, receipt page), and the facility settings
  toggle.

**What it decided (D-45).**

- *`processing` posts nothing to the ledger and settles no invoice.* Money that
  has not arrived must not make an invoice read paid, and must not let a
  delinquent tenant's gate access auto-restore under D-16. It also means a
  bounce needs **no reversing entry** — there is nothing to reverse — which
  removes the entire class of correction bugs the alternative would have
  introduced. A test asserts the ledger is untouched after a bounce for exactly
  this reason.
- *The tenant is left alone anyway.* Late fees, dunning and gate suspension all
  skip a lease with a debit in flight. The money has left their account and
  nothing they can do makes it arrive faster.
- *Suppression is scoped by tenant-at-facility, not by invoice.* A portal
  payment does not always name an invoice, so an allocation-based lookup would
  miss the commonest case. The cost is that a tenant with two units at one site
  gets both left alone for a few days — an error in their favour, bounded by the
  settlement window.
- *The move-in does not wait for settlement.* Four business days for a unit
  somebody has paid for is not a product. The risk is real, which is why ACH at
  checkout is **per facility and off by default**, and why a late bounce raises
  its own task.
- *A bounced debit is its own task type, not `failed_payment`.* A card decline
  means nobody was ever told the money arrived. This tenant has a receipt, may
  have been let through a gate on it, and is about to start getting dunning
  letters. Different conversation, different urgency.
- *`Payment.method` is corrected on the processing event.* `createChargeIntent`
  writes every row as `card` because it cannot know what the payer will pick in
  the Element; the deposits report, the receipt and the tenant's own history all
  read this column, and a bank debit filed as a card is wrong on all three.
- *Payment method types are stated explicitly rather than left to the Stripe
  dashboard's automatic methods.* Bank debit at checkout is a per-facility
  decision this code has to make, and an off-session autopay charge must never
  be offered `us_bank_account` as a fresh method — there is nobody there to
  authorise a debit.
- *The portal shows settling money BESIDE the balance, never netted off it.*
  Subtracting it would make the portal disagree with the ledger and with every
  staff screen; saying nothing produces the support call this state exists to
  prevent.

**A latent robustness bug found during verification.** A full parallel test run
aborted `completeMoveOut`'s transaction mid-flight, while the same suite passed
alone and on the next run — the signature of a wall-clock limit under load
rather than a defect in the work. Prisma's default interactive-transaction
timeout is 5 seconds, tuned for a database on the same machine; this one is Neon
over the network, and that transaction makes eight or nine round trips. Raised
to 20 seconds (maxWait 10s) on the client. **This was never only a test
problem** — the same limit would abort a move-out during any production latency
spike and surface as an opaque Prisma error to whoever was standing at the
counter. Diagnosed from one observed failure rather than a reproduction, and
the fix makes the failure mode impossible rather than merely unlikely.

**What it left behind.**

- **Microdeposit verification is not handled.** A bank account Stripe cannot
  verify instantly leaves the intent in `requires_action`, and nothing here
  drives that flow — the renter would be stuck on the Payment Element. Instant
  verification covers the common case; this is a real gap for the rest.
- **No ACH-specific retry.** B-046's retry schedule is built around card decline
  codes. An `insufficient_funds` bounce raises a task and stops; it does not
  re-present the debit the way a card retry would.
- **Autopay still charges the stored default method**, whatever it is. Nothing
  yet lets a tenant say "use my bank account for autopay but my card for
  one-offs".
- **No separate settlement report.** Money in flight is visible per tenant in
  the portal and per lease to the jobs that skip it, but there is no
  facility-level "what is settling" view.

---

## B-104 — Insurance tier change + proof of own cover

`8f515b2`

**What it built.** The other half of PRD 01 US-705, at `/portal/protection`.

- `packages/core/billing/protection-changes.ts` — `effectiveDateFor`,
  `changeProblem`, `scheduledNotice`. Pure.
- `ProtectionChange`: a scheduled tier change waiting for its billing cycle.
- `apps/web/lib/protection/changes.ts` — schedule, cancel, submit proof, and
  `applyDueProtectionChanges`.
- A nightly `protection.apply-changes` job at local hour 0.
- The portal screen, and an `insurance_proof_review` task type.

**What it decided.**

- *A change is scheduled to the start of the next billing period, never applied
  today* — and not today even when today IS the billing day, because that
  period's invoice may already have been raised this morning. A protection
  premium is a flat monthly charge, so changing it mid-period means prorating
  one, and a prorated premium is a coverage question rather than an arithmetic
  one: was the unit covered to $2,000 or $5,000 on the 14th? Nobody wants to
  answer that after a fire. It also stops a tenant upgrading the morning after a
  break-in and having it apply to the month just gone.
- *The job runs at hour 0, before `billing.generate-invoices` at hour 1.* Same
  ordering constraint as B-076's rate increases and for the same reason: the
  other way round, every change would arrive a full month after the date the
  tenant was promised.
- *Dropping a paid plan requires current, unexpired proof.* An expired policy is
  not cover, and letting one justify the drop is exactly the gap D-17 exists to
  close. A test asserts the expired case is refused.
- *A repriced tier is applied at the new price rather than refused* — the
  opposite of B-076's rate-increase rule, deliberately. There an approver signed
  off on a specific delta; here the TENANT asked for a named level of cover and
  should get it at whatever it now costs. The audit entry carries both figures.
- *A superseded request is cancelled, not deleted.* "They asked to drop cover
  and then changed their mind" is precisely what a coverage dispute asks about.
- *Re-selecting the same plan at a NEW price is allowed, not a no-op.* An
  operator can reprice a tier, and treating it as a no-op would leave the tenant
  no way to accept the new premium.
- *Switching to own cover sets `protectionWaivedAt`*, which D-17's scan and the
  move-out settlement both read.
- *"Protection plan" and "insurance" stay separate words throughout the copy.*
  What we sell is a lease addendum; selling actual insurance generally needs a
  licensed agent. Copy that blurs the two claims something untrue.

**What it left behind — and one is the headline.**

- **No file is uploaded, because there is no blob store.** US-705 says "submit
  proof", and `Document.storageKey` has been waiting for a storage vendor since
  B-023. An upload control here would be a button that either loses the file or
  lies about keeping it. What ships instead is the part the system actually
  uses: carrier, policy number and — the substantive one — the expiry date that
  D-17's nightly lapse scan reads, plus a staff task to check them against the
  declaration page the tenant emails or brings in. **This is a real gap, not a
  resolved one**, and it stays open until somebody picks a storage vendor.
- **No staff-side review screen of its own.** The task lands in the existing
  queue and a manager reads the details on the tenant profile; there is no
  "approve this proof" button that changes anything, because accepting it is
  already what recording it does.
- **No notification when a change is scheduled or applied.** The portal says so
  on the screen; nothing emails it. The comms rules exist and adding one is a
  catalogue entry, but no template was written for it.
- **A tenant cannot change cover on a lease that has ended**, which is correct,
  but there is also no way to see what cover a past lease had from the portal.

---

## B-105 — Portal self-service for the authorized-access list

`PENDING`

**What it built.** PRD 03 US-9 AC4's Phase 2 half: `/portal/access`, where a
tenant adds, sees and withdraws their own named people.

- `AuthorizedAccessPerson.createdByStaffId` became nullable, with
  `createdByTenantId` / `revokedByTenantId` alongside.
- `createAuthorizedPerson` and `revokeAuthorizedPerson` now take a tenant actor;
  one shared `actingParty` decides who may touch a lease.
- `GrantCause` gained a `tenant:` prefix.
- `apps/web/lib/portal/authorized-access.ts` plus the screen and its actions.

**What it decided.**

- *The tenant and the counter call the same functions.* A second path to a
  working gate code is a second place for the cap, the audit entry and the
  suspension state to be wrong.
- *`tenant:` is its own cause prefix, not folded into `staff:`.* The gate log is
  evidence, and after a theft claim "the tenant let this person in" and "a
  manager did" are different facts.
- *A tenant may withdraw somebody a manager added.* It is their unit; making
  them ring the office is how a person keeps access they should not have over a
  weekend.
- *The code is shown in the portal*, the same posture already taken with the
  tenant's own code — the tenant is the person expected to pass it on. An
  unreadable one degrades to "call the office" rather than throwing.

**Two defects found and fixed, one of them serious.**

- **US-9 AC2's delinquency cascade had never been wired up.**
  `cascadeAuthorizedAccess` was written in B-029 and described in its own
  comment as "a seam, not yet wired to a caller" — and no caller ever arrived.
  So when D-16 suspended a delinquent tenant's gate access, everyone that tenant
  had authorised kept working codes: the suspension was real for exactly one of
  the people it was meant to cover, and every gate event attributed correctly to
  somebody whose access should have been off. Now driven from both
  `applySuspend` and `applyRestore` — the restore half matters just as much,
  since restoring only the tenant would leave everyone they authorised locked
  out permanently with nothing on any screen explaining it.
- **A person added while the tenant was suspended got working access.** They now
  start suspended. Found by writing the test for it: a locked-out tenant could
  otherwise add somebody from the portal and be back in the building ten minutes
  later on a code the system issued. The fix has to transition through `active`
  first, because `pending → suspended` is not a legal edge — and
  `transitionGrant` REFUSES rather than throwing, so getting it wrong left the
  grant sitting in `pending` with no error anywhere and a credential nobody
  noticed did not work. That silent-refusal shape is worth remembering.

**What it left behind.**

- **No per-person access hours from the portal.** `accessHours` exists on the
  model and is still unread by anything (B-064 owns enforcement); the portal
  does not offer it rather than collecting a preference nothing honours.
- **No notification to the person being added.** They get a code from the
  tenant, by whatever means the tenant chooses. Texting it would need their
  consent, which nothing captures.
- **No edit.** A wrong phone number means withdraw and re-add, which mints a new
  code. Fine at three people per lease; annoying at the cap.
- **Withdrawn people are hidden, not shown as history.** The row and its audit
  entries survive, but the portal shows only the live list — "who used to have
  access" is an admin question and stays on the admin side.
