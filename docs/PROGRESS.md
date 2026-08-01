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

### B-017 — Unit browsing & transparent pricing ✅ `PENDING`

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

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.
