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

### B-040 — Admin move-out ✅ `<pending>`

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

---

---

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.
