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

`95249b1`

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

---

## B-104 follow-up — the blob store, and the proof upload it was blocking

`8470637`

**Why this exists.** B-104 shipped the insurance half of US-705 with one gap
named loudly: "submit proof" collected the insurer, policy number and expiry but
could not keep the declaration page, because `Document.storageRef` had been
waiting for a storage vendor since B-023. This closes it.

**What it built.**

- **Vercel Blob**, chosen because the app deploys on Vercel: one token rather
  than a second cloud account, a second IAM policy and a second set of
  credentials to rotate. `@vercel/blob` is the only new dependency.
- `packages/core/documents/upload.ts` — pure validation: magic-byte sniffing, a
  10 MB cap, storage paths, and filename sanitising.
- `apps/web/lib/documents/storage.ts` — store and read, with the uploader
  injectable so the flow is testable without a bucket.
- Authenticated download routes for the tenant (`/portal/documents/[id]/file`)
  and for staff (`/admin/documents/[id]/file`).
- The file input on the proof form, and links from both document lists.

**What it decided.**

- *The stored type comes from the BYTES, never from the upload.* A declared
  `Content-Type` is attacker-controlled. A file claiming `image/png` and
  containing HTML is refused, which is the case the whole check exists for —
  a browser sniffing an upload as HTML and running it from a URL the uploader
  can share is stored XSS.
- *SVG is not an image.* It is a document format that can carry script, and it
  is deliberately off the accepted list.
- *The blob URL never reaches a browser, and the routes never redirect to it.*
  Vercel Blob serves public objects to anyone holding the URL, and a
  declaration page carries a name, an address and a policy number. The path is
  a UUID treated as a secret; the bytes are proxied. A redirect would put that
  URL in the address bar, in history and in every referrer after it.
- *Two download routes, not one.* The tenant route asks "is this tenant a party
  to it"; the staff route asks "does this staffer hold this facility". One
  route taking either kind of actor is how one of the two checks eventually
  gets skipped.
- *`readUpload` does no permission checking at all*, by design, and says so.
  One half-check plus another half-check is how bytes reach the wrong person.
- *Uploaded files never populate `Document.content`.* That column is what the
  portal viewer renders with `dangerouslySetInnerHTML` — its own comment
  already warned that anything storing tenant-authored markup there must
  sanitise first, and the answer here is that nothing tenant-authored goes in
  it. A test asserts it.
- *A rejected file never loses the policy details.* The waiver is written
  first, and the action reports the file problem while confirming the details
  were kept. The expiry date is what stops D-17 auto-enrolling the tenant into
  a paid plan; discarding it because a photo was a HEIC would be the far worse
  failure.
- *The uploader's filename is never part of the storage path.* "policy for 12
  Oak Street.pdf" in a URL is a privacy leak on its own, quite apart from what
  a path separator in it would do. It survives only as a display title, with
  quotes and control characters stripped — that string ends up in a
  `Content-Disposition` header, where a stray CR/LF lets the uploader write a
  header of their own choosing. There is a test for that specifically.
- *No blob token still degrades honestly.* Uploads are refused with a message
  saying the details were kept — the same posture an unconfigured Stripe key or
  encryption key takes — rather than silently dropping the file.

**Three things fixed alongside it.**

- **A deployment blocker nobody had hit yet.** `packages/db/generated/` is
  gitignored — correctly, it is build output — and nothing ran `prisma
  generate` on a clean install. Any build from a fresh checkout (CI on a cold
  cache, or a first Vercel deploy) would have failed with "Cannot find module
  ./generated/client". Added a `postinstall`, then verified by deleting the
  directory and running `npm install` from clean.
- **A real performance defect shipped in B-079.** `compareFacilities` ran one
  query PER FACILITY, and the org-defaults screen is a portfolio screen — the
  one place that shape goes unnoticed, because it is correct and it is fine at
  three sites. Against a database with a few hundred facilities the tests went
  from about a second to ten or twenty, and then started timing out. Now a
  fixed number of queries regardless of portfolio size; the same suite runs in
  about a second per test again.
- **Text-based SMS opt-in, made real — and made a DOUBLE opt-in.** A campaign
  registration that declares "consent collected by text" needs the system to
  actually do it, and it did not: `applySmsStart` only lifted a previous STOP,
  so a tenant who gave us their number at move-in and never switched texts on
  could text JOIN all day and stay unsubscribed.

  The flow is now two steps, which is what a carrier campaign review asks to
  see: `JOIN`/`SUBSCRIBE` records `pending` and asks for confirmation and
  **subscribes nobody**; only a reply of `YES` grants consent. A bare YES with
  nothing pending subscribes nobody either — otherwise the second step is
  theatre and "they replied YES" is evidence of nothing. `START`/`UNSTOP` stay
  a one-step immediate resume, because carriers require that and somebody who
  already opted in once is not somebody to ask twice.

  `ConsentState` gained `pending` for this. Every existing reader compares
  against `granted`, so a pending row counts as not-consented everywhere by
  construction; the one place that tested for `revoked` specifically
  (`notices/delivery.ts`, legal notice by email) now names it explicitly rather
  than letting a pending consent fall through as permission.

  Both outbound messages carry the five things an audit looks for — who is
  texting, what they will get, how often, that rates may apply, and both HELP
  and STOP. **A number we cannot place is told so rather than confirmed**: a
  confirmation with no consent behind it is precisely the message an audit
  would read as proof of consent.
- **A public text-message policy page** (`/messaging-policy`), which an A2P
  10DLC campaign registration asks for by URL and which the portal's own consent
  control now links to. Written from the code rather than from a template: the
  keyword sets, the 8am–9pm window and the consent record it describes are the
  ones `sms-keywords.ts`, `Facility.smsQuietHours*` and the `Consent` row
  actually implement. A policy page that promises something the system does not
  do is the document a regulator reads when somebody complains.

**What it left behind.**

- **No virus scanning.** A PDF that is a real PDF and also malware is stored and
  served to staff. Mitigated by `attachment` + `nosniff` + a sandbox CSP, which
  stops it executing in our origin, but not by anything that inspects content.
- **No deletion path for an uploaded file.** `Document.deletedAt` soft-deletes
  the row; the blob stays. A real retention policy needs a sweeper.
- **HEIC is not accepted**, which is what an iPhone produces by default unless
  the user has changed a setting. The message says PDF or JPG/PNG; in practice
  iOS converts on upload for `accept=` types, so this may not bite — but it is
  the most likely real-world rejection.
- **10 MB is a guess**, not a measured limit. A phone photo of a page is well
  under it; a scanner set to 600 dpi may not be.

## B-109 — Stale copy, dead references and enum identifiers on staff screens

`5a9b5d8`

**Built:** the D-15 "no internal identifier renders" guard now scans `/admin` as well as the customer routes, and everything it found is fixed. A shared `packages/core/labels` turns unit, lease and lead statuses into words for every select, badge and chip. Bulk edit's Reason is a `<select>` of the audit reason catalogue with an optional free-text note beside it, and the layout importer got the same treatment. The homepage's size question now links to the size guide rather than the FAQ.

**The one that mattered:** `/admin/leads/[leadId]` told the counter agent *"No promotions engine yet (B-070), so nothing here is discounted"* — and it was right, because `quoteForFacility` never asked. `promotionsAvailable` was a **hardcoded `false`** from B-039 and stayed that way through B-070 shipping the whole engine, so the public facility page advertised a discount that the phone quote for the same unit did not apply. A caller quoted on the phone and the same person on the website saw different numbers, and the tenant found out at the counter. The quote now calls the same `offerFor` the public page calls, with the same arguments, and shows the promotional first-period price in the Due-today cell rather than in a footnote; `promotionsAvailable` is computed from the lines so it cannot drift from what the table shows.

**Decided:** admin may use industry words, it may not use enum identifiers. "Overlocked" and "unrentable" stay — a manager asks for the overlock list by name, and translating operator vocabulary would make the software harder to use for the people whose job it is. `pending_auction` and `overlock_apply` never reach a screen. `delinquent` is the single deliberate rename, to "Past due". The label maps are exhaustive `Record<Union, string>` rather than `Record<string, string>`, so a status added to the schema fails the build here instead of shipping its raw identifier to a screen — that typing is the whole point of the module.

**Also decided:** the reason on a bulk edit is a chosen code *plus* an optional note, not free text pre-filled with `management_approval`. The old field put a schema identifier in front of an operator as the thing to type, and because nobody edits a default, the audit log filled with one value meaning "somebody pressed the button" — on an operation that can rewrite the status of every unit at a site. US-38 wants the log filterable; a field with one de-facto value is not. The note lands in the audit `context`, so `reasonCode` stays filterable.

**Found — a test that defended the bug.** `inquiries-db.test.ts` asserted `promotionsAvailable === false` under the name *"says plainly that it knows nothing about promotions"*. It stayed green through B-070 because it pinned the placeholder rather than the behaviour. Replaced with one that creates a live promotion and asserts the quote prices it; reverting the fix fails it.

**Left behind:** `/admin/maintenance`, `/admin/auctions/[caseId]`, `/admin/settings/promotions`, `/admin/settings/staff` and the tenant page's message rows still render their own status enums raw. They are not backlog IDs so the guard does not catch them, and each needs its own vocabulary decision rather than a mechanical map — B-117 owns the admin surface sweep. The `capitalize` class was removed only from the unit badge.

**Not reproduced:** the first full-suite run after these changes had one failure that did not recur across three subsequent full runs (2767 passing each) or across repeated runs of the promotion-adjacent suites. The filename was not captured. The most likely candidate is the new test's live promotion being visible to a concurrently-running suite, since `candidates()` reads promotions globally and scopes by `facilityIds` afterwards.

## B-110 — Checkout dynamic state

`9e7d6d6`

**Built:** the checkout stepper now tells you when it has moved. A `CheckoutAnnouncer` sits above everything conditional on the page, holds the one live region, and is driven by the server's own props rather than by a form result — which is what makes it work at all, because `revalidatePath('/checkout')` unmounts the step on the same render that would have announced it. On a transition it writes the destination in the progress indicator's own words ("Your unit — step 2 of 6") and moves focus to `#step`, the heading that has carried `tabIndex={-1}` since B-020 and had never once been focused. The same component covers the two other transitions that had the identical bug: extending the hold and being re-locked onto another unit.

The T-5-minute hold warning moved to a client timer (`LockWarning`). The server's verdict is the initial state, so it still renders with the bundle disabled and hydration has nothing to disagree about, and it announces once when it becomes due rather than restating the countdown every minute.

Both payment submits — checkout's and the portal's — swapped `disabled` for `aria-busy` plus an `inFlight` ref, with a pre-mounted "Taking payment. This can take a few seconds." region. `bodyOf()` in `lib/documents/render.ts` is now the single answer to "the embeddable part of a stored document". `Field` gained `checkbox` and `radio`, and a new `FieldSet` carries a group's error on the `<fieldset>`. The lease summary template's `<h2>` got the `id` its `aria-labelledby` had been pointing at since B-024.

**Decided:** the announcement is derived from props, not plumbed out of `AdminForm`. Threading a `FormState` across the unmount would have meant every step's form knowing about the page's live region; comparing previous props to current is client state that survives by construction. It also means the three transitions share one mechanism instead of three.

**Decided:** the group error lands on the `<fieldset>` and `FieldSet` takes the error key separately from the inputs' `name` — `validateChoice` reports `protection` while the radios are `tier`. `aria-invalid` is a global ARIA attribute, so `role="group"` carries it.

**Found — a hydration race that is also a real behaviour.** Before the announcer hydrates, Continue submits as a plain form post and does a full document load, so nothing announces and nothing moves focus. That degrades acceptably (the browser loads a new page and a screen reader reads it), but "the region is attached" and "the region will announce" are different facts. The announcer's effect now sets `data-live`, and the test waits on that — without it the test passed on a warm server and failed on a cold one, which is exactly the flake that gets deleted rather than understood.

**Found — six checkout e2e specs were already red.** `getByLabel('Email')` is a substring match, and the marketing-consent checkbox's label contains the word "emails", so every spec that filled the email address died on a strict-mode violation. Fixed with `{ exact: true }` in all twelve places. Unrelated to this item; it had simply not been noticed.

**Found — the e2e suite could not start at all.** `e2e/sign-in.ts` used `import.meta.dirname`; the root `package.json` declares no `"type": "module"`, so Playwright transpiles the specs to CommonJS and the `setup` project failed to load with *"Cannot use 'import.meta' outside a module"*. Resolved from `process.cwd()` instead, the same way `testDir: './e2e'` already resolves.

**Found — the local e2e database had never been created.** `.env.test` moved to local Postgres on 2026-08-14, but only the `storage_test` *schema* (which is what `vitest.config.ts` redirects to) had been migrated. Playwright reads `DATABASE_URL` directly, so it wanted `public` in the same database, and that was empty. Migrated and seeded. Worth knowing for the next session: `npm run db:migrate:test` does **not** cover the e2e database.

**Left behind:** `Field as="radio"` exists and nothing uses it — the protection radios keep their bordered-card labels, because routing them through `Field` would have moved the border to a wrapper and shrunk the tap target below the card. The group requirement is met by `FieldSet`. Autopay, the SMS and marketing consents, and the lead form's controls stay as plain inputs: none of them can carry a validation error, so there is nothing for `Field` to attach.

**Left behind:** the accessibility statement's remaining checkout gap is the no-JavaScript hold countdown, which cannot tick without a client timer. Four of its six "where we fall short" bullets were the defects this item fixed and were removed against the code that closed them.

**Test verification, honestly.** Unit suite green (2,769 passing). The eleven checkout e2e specs pass repeatedly against a cold server, including the two new behavioural assertions this item owes — focus lands on `#step`, and a region captured before the action has non-empty text on the same handle after. One complete e2e sweep ran green; a second showed three failures outside checkout (`admin-move-out`, `admin-tasks`, and a reservation spec), each of which passes in isolation and each of which consumes a seeded fixture — the suite is not repeatable without a reseed, which is a pre-existing property of it. Later full sweeps degenerated into mass `ERR_CONNECTION_REFUSED` because the Next dev server was being starved by another project's Playwright run on the same machine; those runs carry no signal either way.

## B-111 — Checkout goes both ways, and the price says what changed

`10ddbb4`

**Built:** `goBack(token, to)` in the checkout state machine, and two ways to reach it — a Back control below Continue on every step that has one behind it, and the completed entries in the progress indicator, which are now submit buttons styled as links. Both post the same action, so there is one set of rules about what may be returned to rather than two that can disagree. Nothing is unwound: the data stays, the signed lease stays signed, the unit stays held, and the hold is renewed because correcting an answer is activity. Back is refused once the session is no longer `active` — the state `provisionMoveIn` commits alongside the lease and the ledger — and the payment step additionally withdraws the control the moment its own `Payment` row leaves `pending`, so "nothing has been charged yet" is never printed next to a charge that is settling.

`PriceSummaryProps.changeNote` is finally passed by somebody. It rides on the session rather than on a form result, because B-110 established that a step's own return value is rendered by a component `revalidatePath` has already unmounted. `advance` writes it and — the half that matters — clears it on every transition that does not set one, so it always describes the step just taken. The summary lost `sm:static`: on a single-column page that resolved to "the last element on the page", which is not a persistent summary on any reading of §6.4.

**Decided:** completed steps in the progress indicator are `<button>`s, not `<a>`s. They look like links because that is what they behave like, but going back moves the machine, and a GET that mutates is one a prefetch, a crawler or a middle-box can fire.

**Decided:** `goBackAction` returns a success state with an **empty message**. It is the one transition whose form survives it — the progress indicator does not unmount when the step below it changes — so any message there would be a second live region announcing the same move as `CheckoutAnnouncer`, half a second later.

**Found — the biggest one, and it was not in this item's scope.** Every live region in the product was styled `empty:hidden`. That is `display:none`, which takes the element out of the accessibility tree right up until the moment it has text — the exact "region that appears with the event" failure the pre-mounting exists to prevent, moved from *not in the DOM* to *in the DOM but not exposed*. `AdminForm` carried it, so every form in the product was affected, including the sentence in the public accessibility statement claiming successful saves are announced. `gate-code-panel.tsx` diagnosed this in B-105, wrote four lines explaining it, and named `components/admin/form.tsx` as the offender; nothing changed it. Fixed in all five places (`AdminForm`, the price summary, both payment components' busy regions, and checkout's decline `alert` — which is also focused on error, and `display:none` cannot take focus). The e2e suite found it: an assertion on the region came back "element(s) not found".

**Found — back navigation lost the address.** `DetailsStep` prefilled four fields and not the other seven, so returning to step 1 rendered an empty street, city, state and zip, and Continue then refused the form the renter had already filled in. "Back navigation never loses data" is not a property of the machine alone; a field that does not render what the session holds loses it just as thoroughly. Every field now carries its `defaultValue`.

**Found — a signed lease could not be walked past.** Going back to the lease step and pressing Sign hits `signDocument`'s `already_signed` refusal, so a renter would be told their own lease cannot be signed, with no way forward. The step now renders a signed state with the date and a plain Continue.

**Left behind:** going back and forward again walks the steps one at a time rather than jumping to the furthest reached. Every form is prefilled so nothing is re-asked, but a renter correcting an email at step 4 presses Continue three times to get back. A `furthestStep` column would fix it; it is not worth a migration until somebody asks.

**Left behind:** the Back control sits below Continue rather than beside it. A form cannot nest inside a form and every step's Continue already owns one, so a genuinely side-by-side pair would mean either a `formAction` override that bypasses `useActionState` or restructuring all five steps. Same height, same width behaviour, next in the tab order.

**Left behind:** there is a residual window where a card has cleared and the webhook has not yet landed, in which `Payment` is still `pending` and Back is still offered. Going back there costs nothing but confusion — `provisionMoveIn` reads the session, not the step, and Stripe deduplicates by reference — so it is a display gap, not a money one.

**Test verification:** unit suite green (2,776 passing, seven new — `goBack` against a completed, unreached, lapsed and ordinary session, and the change note's write-and-clear). Three new e2e specs pass: back from both controls with the email and address intact, the change note appearing with a stated cause and clearing on the next step, and the sticky summary clearing the payment step's lowest control at 360×640. The public, portal and admin suites were run after the `empty:hidden` fix — 124 and 57 passing — and three assertions that had been resolving `getByRole('status')` against a region the bug was hiding were rescoped to the form that actually spoke.

## B-112 — Checkout step 1 down to the field cap, and consumer-sized controls

`e5d1f77`

**Built:** step 1 went from fourteen visible fields to seven, plus one read-only line, above the primary action. City and state are derived from the zip through D-14's bundled dataset and shown as text, not as inputs — they were two free-text boxes beside the field that already determines both, and `state` accepted exactly two characters, so a renter typing "Texas" was rejected after submitting by a rule the form invented for itself. A closed `<details>` keeps a way to type them by hand, which is not a rare case: the dataset does not know every zip, a PO box is not where anybody lives, and the refusal for an unknown zip says how to get past it rather than just saying no. The alternate contact and the active-duty declaration moved to the lease step. The two consent boxes moved below Continue.

`CONTROL_CLASS` was `h-9` — 36px — on every form in the product. It now reads its height from `--control-h`, defaulting to 44px, with the admin layout opting down to 36px. The default is the consumer size deliberately: a surface that forgets to opt in should be accessible, not the other way round, and nothing between a layout and an `<input>` has to know which it is.

**Decided:** the density is a CSS variable set by the layout, not a prop or a context. `Field` is used by admin, portal and public alike; threading a `density` prop through every call site would have been a hundred-line diff to express one fact about where you are.

**Decided:** city and state stay on `DetailsInput` as optional rather than being removed. They are still accepted and still validated when typed — the disclosure is a real path, not a fallback nobody takes.

**Found — the row's stated reason for moving the active-duty declaration was wrong.** It said to move it "to the lease step, where the SCRA sentence they trigger actually appears". No SCRA sentence appears there: `LEASE_TEMPLATE` has ten clauses and none mentions military service, and the only SCRA machinery in the codebase is the staff-side `military_scra` hold in `packages/core/holds/catalog.ts`. The move is still right — a legal declaration belongs with the agreement, not with "who are you" — so it was made, and the explanatory sentence was put on the step beside the control rather than into the signed document. **Adding a clause to a lease is not a thing to do silently**: the template's own header lists what is outstanding pending attorney review, and an SCRA clause would be a new term tenants sign. Flagged to the owner rather than decided here.

**Left behind:** the derived city and state appear only after the first submit, because the dataset is server-side and shipping it to the browser would cost far more than the field it saves. Before that the line reads "From your zip code". Live derivation as the renter types would need a small API route; it is not worth one until somebody asks.

**Left behind:** consent checkboxes and protection radios are still native-sized boxes. WCAG 2.1 AA has no target-size criterion — 2.5.8 is 2.2 — and their labels are full-width click targets, so this is §6.2's own rule rather than the standard's. Not claimed on the accessibility statement either way.

**Test verification:** unit suite green (2,782 passing, six new — locality derivation, the unknown-zip refusal and its escape, the typed override, the half-typed pair, and the alternate-contact validation). The full e2e suite is green on both projects for the first time this session: 187 passing on desktop-chrome and 187 on mobile-chrome. The field cap is asserted by name and by count so the next item cannot quietly re-add, and the 44px is asserted on the *rendered* height, because the token now resolves through a CSS variable and a broken variable would still compile. Ten checkout specs had their city/state fills removed, and three that checked `getByRole('checkbox').first()` were given the consent box by name — positional was fine until this item put a second checkbox on the lease step, and checking the wrong one refuses the signature for a reason the test cannot see.

The accessibility statement was re-read: nothing it claims changed.

## Defect fix — the advertised price and the charged price disagreed by the promotion

`17566d1`

**Not a backlog item.** Found while answering a question about what the promotions engine actually reaches, between B-112 and B-113, and fixed immediately because it was a live customer-facing money defect.

**What was wrong.** The facility page evaluated `offerFor` per unit type and rendered the badge, the plain-language terms and a discounted first-period price. `Rent now` then called `startCheckout({ quotedRateCents: unitType.webRateCents })` — the **undiscounted** rate — and passed no promotion at all. `checkout_session.promotionId` and `promoCodeId` were columns that had existed since B-070 and that **nothing ever wrote**. So:

- the unit card said "50% off your first month" and the price summary, the amount due and the PaymentIntent all said full price;
- `provisionMoveIn`'s redemption block is guarded on `if (session.promotionId)`, which was always false, so **no `PromoRedemption` row had ever been written by a real move-in** — for a code promo or an automatic one;
- `PromoCode.usesCount` had no path to increment, and promo ROI reporting read an empty table.

US-301 makes a disagreement between the browse estimate and the checkout total a release-blocking defect. It was only enforceable because there is one implementation of `calculateMoveInCost` — and the bug was that the browse estimate applied a promotion that one implementation had never heard of.

**The fix.** `calculateMoveInCost` learned about promotions: a `promo` line carrying the promotion's own terms as its label and a negative amount, a reduced total, and a reduced **taxable base** — tax is owed on what is actually charged, not on the price before a discount. The recurring total is deliberately untouched, because "then $X/mo" has to be what the tenant will keep paying. A discount is clamped to the rent it discounts, so a misconfigured promotion cannot turn a move-in into a payout.

`startCheckout` now takes a `PromoSnapshot`, evaluated **server-side** at "Rent now" and at reservation conversion — never a value the browser posted, because a promotion the client can name is a discount the client can choose. `promoDiscountOn(session)` is the single reader used by the price summary, the amount due and the redemption alike.

**Decided:** the offer is **locked**, not re-derived. `provisionMoveIn` used to re-evaluate at redemption on the reasoning that "the rate could have moved" — but `quotedRateCents` is locked on the session, so the only thing a re-evaluation could change is the promotion itself, and then the redemption would disagree with what the renter was charged. An operator pausing a promo between "Rent now" and the card clearing must not turn a discounted checkout into a full-price lease. The cap is still enforced atomically inside `redeemPromotion`, which is what FR-PROMO-5 actually asks for. A test pins it.

**Also fixed:** `formatRate` rendered a negative as `$-64.50`. The sign now goes outside the dollar mark. It reads as a typo on exactly the lines where being unambiguous matters — a discount, a credit, a refund.

**Left behind, both now filed:** **B-122** — no surface passes a `code` to `offerFor`, so a code-gated promotion still cannot be redeemed by anybody. **B-123** — every promotional message goes by email; there is no `marketing_sms` lane at all, and the trap to avoid is sending a promo down the transactional one because the marketing one does not exist.

**Tests:** five arithmetic tests on the cost model (the line and its label, the taxable base, the untouched recurring total, no line when there is no promo, and the clamp), and three against the database — the offer reaching the session and the charged total matching the advertised one, the lock surviving an operator pausing the promotion mid-checkout, and a plain checkout attaching nothing. Full suite green: 2,790 unit tests, 187 e2e on each project.

## B-113 — Admin dashboard drill-through and an "All facilities" that rolls up

`b2f8b2d`

**Built:** every dashboard tile links to the list behind it, and `href` is now a **required** prop rather than an optional one — a tile without a destination is a type error. Five of seven had none, including both of the two that mean somebody has to act: "Failed payments today: 3 · needs attention" with nowhere to go teaches the reader to skip the row, which is the exact failure that tile's own rewrite was meant to prevent.

The delinquency tile counted `Lease.status = 'delinquent'`. Nothing writes that status until B-057, so the one screen an owner opens to find out whether anybody is paying showed **0 next to real receivables**. It now reads `delinquencyReport` — the same call the Delinquency report renders — and shows money owed in dollars with the window on the tile ("$X over 30 days"). It is omitted, not zeroed, for a role without `reports:financial`: a zero is a claim, and a manager who cannot see AR must not be told there is none.

"All facilities" rolls up on the dashboard, Units, Delinquency and Inquiries, in the shape `/admin/tasks` arrived at in B-095 — now one shared `FacilityRollup` component with `/admin/tasks` refactored onto it. Each row links into that facility with `?facility=`, without changing the switcher's persistent choice. **New inquiry** opens with a facility selector as its first field instead of refusing, because the screen exists so a ringing phone costs one click and "pick a specific facility above" spent that budget before the caller finished their sentence.

**Decided:** `moneyOwedRollup` calls `delinquencyReport` rather than summing anything itself. That is D-25's rule — the metrics module owns every figure — and it is what makes "the tile and the report agree" a property rather than a coincidence. A test pins that the roll-up's rows and the report's rows are the same list, in the same order, with the same totals.

**Found — the switcher and the pages disagreed about who may see "All facilities".** The pages resolved with `canSeeAll`; the switcher resolved with `canSeeAll && pathname === '/admin'`, under a comment saying the dashboard was the only roll-up screen "before B-042's portfolio report" — stale since B-042. A persisted "all" cookie therefore rendered a roll-up on `/admin/reports` under a switcher displaying a single facility's name. Now one shared `ROLLUP_ROUTES` list, used by both.

**Found — nothing in the suite could reach "All facilities" at all.** The demo staff account holds two facility-scoped assignments, deliberately: `createOwnerAccount()` refuses to bootstrap when a usable all-facilities owner exists, so a demo account with `facilityId: null` would have broken `bootstrap-owner.test.ts` permanently in CI. That reasoning is sound and is untouched — but it also meant the four roll-up screens this item built had no path to them from any signed-in session. The seed now adds **one additional all-facilities assignment under `regional`, not `owner`**. The bootstrap refusal is scoped to the owner role specifically, so it is unaffected; `regional` already carries `reports:financial` and `reports:rollup`, so the money-owed roll-up renders; and `resolveSelectedFacility` still falls back to the first facility, so every existing spec lands on a single site exactly as before.

**Left behind:** the move-in and move-out tiles link to the Reports page's own move section rather than to a list of the leases involved — B-114 builds the tenant list they should point at, and a link to a screen that exists beats a link to one that does not.

**Test verification:** unit suite green (2,793 passing, three new: the tile's figure against the AR aging report, the roll-up against the report's own rows, and a role without financial reporting getting nothing rather than a zero). Four new e2e — every tile carries an `/admin/` href, the tile's dollar figure appears unchanged in the report it links to, "All facilities" renders a roll-up whose rows link into one facility, and New inquiry opens with its facility selector. Full e2e green: 190 desktop, 191 mobile. One pre-existing assertion in `admin-reports.spec.ts` was rescoped — `getByText('All facilities')` started matching the switcher's new hidden `<option>` before the report's own roll-up row.

**Not reproduced:** a full desktop sweep failed `reserving a unit holds it, for free, with no account`, which passes in isolation. It is the sandbox inventory exhaustion `global-setup.ts` documents at length and **B-120** owns — a full run consumes roughly 52 of the sandbox's 60 units in checkout locks.

## B-114 — The Tenants screen lists tenants

`f01ba78`

**Built:** `/admin/tenants` answers a question before you ask one. It was a heading, a search box and nothing else until you typed, so the one screen named after tenants answered none of "who are my tenants", "who owes me money" or "who moved in this week", and every past-due question routed through Reports. It now opens on a list scoped to the switcher's facility, newest lease first, paginated at 25 with "Showing 1–25 of 143" in a `role="status"` region. Columns: name (the row's `<th scope="row">`, linking to the profile) · facility and unit(s) · lease status in plain words · balance · days past due. The five filters — All · Past due · Moved in this month · Ending soon · Former tenants — are `<Link>`s carrying `?filter=`, not client state, because FR-22 wants a view somebody can send to a colleague. A past-due cell reads "40 days past due" in words beside the amber, never the amber alone (1.4.1).

**Decided — past due means owing money AND being late, not either one.** A balance on its own is an invoice raised yesterday; the filter that an operator works from has to be the one where somebody is actually behind. `daysPastDue` comes from `@storage/core/metrics` (D-25) rather than being recomputed here — it anchors to the *oldest unpaid invoice's original due date*, and a subtly different version on one more screen is exactly how a tenant reads as current on one page and 40 days late on another.

**Decided — one tenant, several leases, one row.** The balance sums across their leases, the days-past-due is the worst of them (60 days late on one unit and current on another is 60 days late), and the status label takes the most serious of `pending_auction › delinquent › active › pending › ended`. "Ended" beside a tenant who also holds an active unit answers a question nobody asked. `former` means nothing occupying *anywhere in scope*, so ending one lease while holding another does not make somebody a former tenant.

**Found — the demo seed had a tenant who owed money and was not late.** The lifecycle state the seed calls `delinquent` wrote a `LedgerEntry` charge and no invoice, and there were no invoices anywhere in the demo data at all. Since every aging figure in the product reads `daysPastDue` from the oldest unpaid *invoice*, the delinquency report bucketed the entire portfolio at 0–10 days, B-113's new money-owed dashboard tile had no age behind its figure, and the past-due filter this item built could never have matched a row. The seed now writes the unpaid, overdue invoice behind that charge, dated to match it. This is a seed defect, not a code one — but it made the delinquency half of the product undemonstrable, and it is why the e2e assertion for the past-due filter is meaningful rather than vacuous.

**Found — the search silently capped at 25 and said nothing.** `searchTenants` has taken 25 since B-038. Twenty suites in this repo seed a tenant called "Ada Renter", which is to say the one somebody is looking for is exactly the one past the limit. The limit is now exported and the screen says it is capping, with what to add to narrow it down. The cap itself is unchanged.

**Left behind:** `listTenants` aggregates in memory over the leases in scope. The two columns that matter most are not columns — a ledger sum and an invoice age cannot be ordered or filtered by the database without materialising them or writing the aging as SQL — so pagination slices after the aggregate rather than in the query. A `ponytail:` comment names the ceiling: fine at a few thousand leases, denormalise the balance onto `Lease` past that.

**Left behind:** "Moved in this month" and "Ending soon" measure against UTC month start and a flat 30 days. `Lease.startDate` is a `Timestamptz`, so a facility west of UTC can put a lease starting on the 1st in the wrong month by a few hours. Thirty days rather than each facility's own `moveOutNoticeDays` is deliberate — this is a browsing filter, not a compliance window, and a list whose meaning changes per facility cannot be a portfolio view.

**Test verification:** unit suite green (2,800 passing, 8 skipped, 0 failed), six new against the database — the list rendering without a query, the balance from the ledger and the age from the metrics module, past-due needing both conditions (an invoice created and torn down inside the test, so the shared database is left as found), a tenant with a live lease never counting as former, the total being the total rather than the page size, and the switcher narrowing an actor's scope without ever widening it. Four new e2e, green on both projects: the list appearing unasked with both money columns, the filter chips being links whose URL survives a copy-paste, a past-due row carrying the words, and an uncapped search claiming nothing.

Full sweep: **387 passed, 8 skipped, 1 failed of 396** — the one failure being B-125's dev-server CSS artifact, which passes in isolation and on a restarted server. An earlier sweep was killed at 219/396 with no summary while the rental-business project ran its own sweep concurrently (memory available 35%, pressure 493); its three failures were discarded rather than diagnosed, because a killed run is not evidence. Re-run on a quiet machine, the reconciled totals are the ones above.

**Found — three tests that were green without testing what they claimed.** None is B-114's doing; the seed change and one locator fix exposed all three.

- `admin-pos.spec.ts`'s deposit slip asserted on a payment taken by a *sibling* test, which `fullyParallel` never orders. It had been passing on payment rows accumulated by earlier runs — that file's own header says payments there are real and never rolled back — and re-seeding wipes them. It now takes its own payment.
- Two `smoke.spec.ts` assertions used `getByRole('heading', { name: 'Payment' })`. Playwright matches an accessible name by case-insensitive **substring**, so on the payment step it resolved to two elements (B-025's "Automatic payments") and violated strict mode, and on the lease step it matched the lease's own **"4. Late payment"** clause heading. The second is the serious one: `the lease shows a summary first and signs with a typed name` was green while never reaching the payment step at all. Both now pass `exact: true`.
- That same test then drove three submits through a form that empties itself on every error (B-124). Reliable alone, it failed about one run in three under parallel checkout load. Reduced to one error round-trip, which still asserts that an empty submit names **both** missing fields rather than stopping at the first.

**Found — a validation error discards everything typed on the step (filed as B-124).** `FormState` carries `status`, `message` and `fieldErrors` and no echo of what was submitted, so every server action in the product re-renders its form empty after a field error. On the lease step that is not an inconvenience: mistype your signature and the re-render clears the **e-sign consent tick and the typed name**, so the next press is refused with "Tick the box to agree to sign electronically" for a box the renter did tick, on the last screen before payment. The three declarations above it clear too. B-094 got the error *reporting* right and value *retention* was never part of it. Not fixed here — the fix belongs in the shared contract every action returns, not in one form, or it gets done four times and missed everywhere else.

**Left behind:** the name-mismatch assertion on the lease step. It cannot be driven deterministically while a field error discards what was typed, so B-124 owns restoring it — that is the item that can test it honestly.

The accessibility statement was re-read. Its staff-screens paragraph — "long lists are not paginated" — still holds: `/admin/tenants` and the funnel report are the only two admin screens that paginate, and Units, Tasks, Leads and Delinquency still do not.

## B-124 — A validation error no longer discards what was typed

`7ee46d3`

**Built:** `AdminForm` writes the submitted values back into the form's own controls whenever the action comes back `error` or `confirm`. Every form in the product inherits it; not one of the 156 actions that return `fieldError` changed.

**Found — nothing in this codebase was clearing those fields. React 19 was.** A `<form action>` is reset by the framework once its action resolves. That is right after a success and wrong after a failure, and it is why the diagnosis written into B-124's own row was wrong: the row prescribed echoing submitted values through `FormState` and consuming them as `defaultValue`/`defaultChecked`, which **could not have worked** — the inputs never remount, so a changed `defaultValue` is inert. The row has been corrected rather than left to mislead the next reader.

**What it cost as a customer-facing defect.** On the lease step — the last screen before payment — mistyping your signature cleared the **e-sign consent tick and the typed name** along with it. The renter fixed the one thing the error named, pressed Sign, and was refused with "Tick the box to agree to sign electronically" for a box they had ticked thirty seconds earlier. The three declarations above it went the same way. WCAG 3.3.3 is not satisfied by an error that names a field the form has just emptied.

**Decided — at the form, not in `Field`.** `Field` already reads the form state and would have been the smaller change, but the protection step's radios are raw `<input>`s inside a `FieldSet` and `Field` never sees them; so would every future raw control be. Restoring from the submitted `FormData` against `form.elements` covers every control type in every form, including ones not yet written.

**Decided — four kinds of control are deliberately skipped.** Passwords, because putting a credential back into the DOM after the framework cleared it is the opposite of a favour, and `/login`, `/reset-password` and `/reauth` all use this component. Hidden fields, which are rendered from server props and were never lost. File inputs, which cannot be set programmatically. And **buttons** — the first version of this fix blanked the confirm-and-echo step's named `confirmed=yes` button, which would have quietly disarmed the control that publishes an append-only tax row. `form.elements` contains buttons, and a restore pass that does not know it will find that out expensively.

**Left behind:** this runs on the client, so a form submitted with JavaScript disabled still comes back empty. Fixing that needs the server action itself to echo, which is the `FormState` change this item found it did not need — worth doing only if a no-JS path is ever a stated requirement. Nothing in the suite exercises one on a form; `smoke.spec.ts` covers no-JS for search, which is a GET.

**Test verification:** unit suite green (2,800 passing, 8 skipped, 0 failed — unchanged, this is client behaviour). Full e2e green for the first time this session: **388 passed, 8 skipped, 0 failed of 396**, on both projects. B-114's give-up is reversed — the lease step's name-mismatch assertion is restored, and a new assertion pins the fix itself: the consent tick must survive the refusal. Run as a negative control with the restore disabled, that assertion fails exactly where it should, so it is a test rather than decoration. The four highest-risk specs for a change at this level all pass: the append-only tax rate confirmed before it publishes, an invalid settings submit reporting next to the field, the retry schedule refused in the wrong order, and the late-fee ladder refusing an uncapped percentage.

The accessibility statement was re-read and one clause added: it already claimed a rejection message is tied to its field, which was true and hollow while the field it pointed at had just been emptied. It now also says what you entered is still there.

## B-125 — e2e runs against a production build, not the dev server

`ffbe20a`

**Built:** `build:test`, `start:test` and `e2e:server` in the root `package.json`, and `playwright.config.ts` now starts `npm run e2e:server` — a real build, served — instead of `npm run dev:test`. `E2E_DEV=1` keeps the dev server for debugging one spec, where the error overlay and source maps are worth more than fidelity. Both paths use the `:test` env variants, so the server under test reads the same database as the specs.

**Why, beyond the flake that raised it.** The dev server is not the artifact we deploy: it compiles lazily, skips minification and bundle splitting, serves an error overlay in place of our real error boundaries, and caches differently. A suite that only ever ran against it had never exercised what a renter gets, and every dev-only difference was a defect class the suite was structurally blind to. That is not hypothetical here — this repo has already shipped a green build whose every runtime query threw.

**The flake it closes.** Under a full parallel sweep, Turbopack served the checkout a stylesheet that did not yet carry `h-(--control-h,2.75rem)`, so the zip field rendered at its content height of **21px** and failed §6.2's 44px assertion. It passed in isolation, passed on a freshly restarted server, and failed intermittently across three sweeps in one session — reading exactly like a broken tap target. The value was the tell: 21px is the height rule being **absent**, not wrong.

**Decided — `reuseExistingServer` is false on the production path.** Playwright adopts whatever is already listening, so a dev server left running on 3000 would be tested *instead of* the build, silently, which is the entire defect class this item exists to close. It is now `!!process.env.E2E_DEV && !process.env.CI`: refusing to bind is a loud failure, and a silently wrong server is not.

**Decided — the `webServer` timeout goes from 120s to 300s.** 120s was sized for a dev server, which is ready in under a second and compiles on demand. A cold build takes longer than that on its own, and a timeout here would look like a hung suite.

**Found — Playwright suppresses `webServer` stdout by default**, so the build produces no output in the run log and it is easy to believe no build happened. The `[WebServer]` lines this repo's logs already carried were stderr. Confirm a build ran by the timestamp on `apps/web/.next/BUILD_ID`, not by reading the log.

**Measured, same suite, same machine, only the server moved:**

| | dev server | production build |
|---|---|---|
| full 396-test sweep | 1.8 min | **50 s** |
| the 21px flake | intermittent across three sweeps | did not recur |

**Left behind:** most pages here are statically prerendered and query the database at BUILD time, so the build bakes them from the test database as it stands when it runs. Nothing in the suite depends on that today — 388 passed on the first attempt with no prerender breakage — but a future spec that seeds a record and then asserts it on a *static* page will fail for that reason and not an obvious one. `npm run db:seed:test` before `e2e:server` is the fix if it ever bites.

**Test verification:** full e2e green against the build on the first run — **388 passed, 8 skipped, 0 failed of 396**, on both projects, in 50s. The `E2E_DEV=1` fallback was exercised separately and still starts the dev server and passes. Unit suite untouched at 2,800 passing.

## B-115 — Tasks and delinquency cards name and link their subject

`0f3d975`

**Built:** `resolveTaskSubjects` (new: `apps/web/lib/admin/task-subjects.ts`), called once inside `facilityTasks` — the shared read both `/admin/tasks` and `/admin/delinquency` sit on (B-095's rule: the queue has one implementation). Every `TaskRow` now carries `subject: { label, href }`. A card used to say "Fit an overlock / Lease · Aug 12 / Unassigned"; it now says "Fit an overlock / Unit B-14 — Ada Renter [linked] / Aug 12". The delinquency queue additionally carries `balanceCents` and `daysPastDue` per task, read from `@storage/core/metrics` (D-25) rather than recomputed — the figure that queue exists for, rendered in words next to the amber (1.4.1: "40 days past due", never colour alone). The `/admin/tasks` type filter chip now reads the catalog label ("Payment failed — autopay has stopped retrying") instead of the raw `Task.type` key, per B-109's rule that admin may use industry vocabulary and may not render enum identifiers.

**Decided — batched by entityType, one query per type in play.** Sorted the same way `tenant-list.ts` batches ledger balances: group the page's tasks by `entityType`, one `findMany({ where: { id: { in: [...] } } })` per type, never one query per row. Seven entity types are in play across the fifteen catalog task types — `Lease`, `Tenant`, `Invoice`, `Payment`, `Lead`, `GateCommand`, `Facility` — and every one resolves to a name and, where a destination exists, a link:

| entityType | resolves via | links to |
|---|---|---|
| Lease | tenant + unit | tenant profile |
| Tenant | tenant | tenant profile |
| Invoice | its lease's tenant + unit | tenant profile |
| Payment | the tenant who paid | tenant profile |
| Lead | name, or phone, or email | `/admin/leads/{id}` |
| GateCommand | its credential's or grant's tenant | tenant profile, or unlinked if the grant is for an authorized person rather than the tenant |
| Facility | — | "Facility-wide", never linked — `gate_drift_review` and `daily_walkthrough` are the whole site's business, not one tenant's, and the page header already names the facility |

**Decided — a deleted subject renders unlinked, not broken.** The row's own requirement. `resolveTaskSubjects` returns a `Map` that simply has no entry for a row `findMany` didn't return; `fallbackSubject(entityType)` supplies a plain-words line ("This lease no longer exists.") rather than a raw id or a dead link. Exercised directly: `facilityTasks` given a task pointed at a tenant id that does not exist still returns a row, with that fallback as its subject.

**Decided — `gate_manual_action` mirrors `manual-adapter.ts`'s own lookup order rather than reimplementing it differently.** That file already resolves "who is standing at the gate" to build the keypad instruction (credential's grant first, the command's own `grantId` only when there is no credential) — the subject resolver reads the same two tables in the same order, so the name on the task card and the name in the instruction can never disagree.

**Test verification:** unit suite green (2,812 passing, 12 new — one per entity type, the deleted-subject fallback, an unrecognised entityType, `facilityTasks` carrying a subject on every row, and the delinquency queue's balance/days-past-due against real ledger and invoice rows). Full e2e green: **396 passed, 8 skipped, 0 failed of 404**, on both projects. `/admin/tasks` and `/admin/delinquency` joined `ADMIN_ROUTES` in `admin.spec.ts` — this item is the one that checks their layout at 320px rather than leaving it to B-116, and both pass. `admin-tasks.spec.ts`'s existing returned-mail flow gained an assertion that the card links to "Dana Delinquent" while that task is genuinely open.

**Left behind, honestly:** that last assertion did not execute in this session's verification runs — the returned-mail task is idempotent per (tenant, business day) and every run today (this item's own sweep and the B-114/B-124/B-125 verification sweeps before it) had already completed it, so the demo database held zero open tasks by the time this item's e2e ran. It will run for real on the next calendar day, or against a fresh seed. The subject resolution it exercises is the same code path two DB-level tests already prove directly against a real `Tenant` row — `resolveTaskSubjects` returning the exact `{label, href}` shape, and `facilityTasks` wiring it onto a real row — so this is a coverage gap in *when* the e2e assertion runs, not in whether the feature works.

## B-116 — 320px reflow on the three admin routes that fail it, and the unit list's volume

`e1db355`

**Built:** `/admin/units`, `/admin/units/types` and `/admin/settings` all reflow cleanly at 320px now — `REFLOW_PENDING` is deleted from `e2e/admin.spec.ts`, not repointed, and its `test.fixme` is gone. `listUnits` paginates at 50 with a "Showing X–Y of Z" count line and page state in the URL, reusing `tenant-list.ts`'s shape rather than inventing a second one. Below `sm`, the units table becomes a card per unit — the same "one legible card instead of a horizontally-scrolled sliver of a six-column table" treatment B-115 gave task cards. "Add a unit" and "Import layout" moved to a new `/admin/units/setup` tab, off the screen worked from every day. Occupied rows — table and card alike — name the tenant and link to their profile: "who is in B-14?" no longer means leaving for Tenants and searching.

**Found — the three routes shared ONE real cause, not three.** All three already wrapped their wide tables in `overflow-x-auto`, correctly and independently scrollable — `wrapper.scrollWidth` vs `clientWidth` proved it. Yet `document.documentElement.scrollWidth` still read the table's full unclipped width at 320px. Bisected by hiding sections of a live page one at a time rather than guessing from the JSX: Chromium's root-level `scrollWidth` walks into a descendant's own scroll region when computing the page's overflow, even though that region visually clips its content on its own. `contain: layout` on `<main>` (`admin/layout.tsx`) makes it an independent containing block, which stops that walk at its boundary — confirmed by toggling the property on a live page and watching `scrollWidth` drop from 585 to 320 with nothing else touched. Two smaller, genuinely separate bugs rode along: `/admin/units/types`'s two tables never had the `overflow-x-auto` wrapper the units table has always had, and `CONTROL_CLASS` (every admin `<select>`/`<input>`, `admin/form.tsx`) had no `max-width`, so a native select sized itself to its longest option — `protectionRequired`'s "Required — a plan, or proof of the tenant's own cover" ran the settings control out to 341px on its own, no table involved at all.

**Decided — reflow and pagination fixed together rather than separately, deliberately, because they turned out to share infrastructure.** The row bundled them as one M item; building the units table's `hidden sm:table` / card pair alongside its pagination meant writing the row-rendering logic once for both card layouts instead of twice.

**Decided — the mobile card list is list-view only.** Grid view's tiles are already card-shaped; giving them a second, redundant mobile-only alternative would be two representations of the same eleven fields for no reason. Grid view does inherit pagination, since both views now read the same `listUnits` page — a building split across two pages is an accepted trade-off of one shared data source over two.

**Decided — bulk edit reads `list.total`, never the page's row count.** Bulk edit was never paginated and still is not (US-7: it applies to everything the filter matches, not just what's on screen) — but its own "Applies to the N units currently filtered above" line used to equal the true count by coincidence, because there was no pagination yet. Left reading `rows.length` after adding `take`, it would have silently started under-reporting what an Apply click actually touches. Caught before shipping, not after.

**Test verification:** unit suite green (2,816 passing, 6 new — pagination reporting the true total across two disjoint pages that together cover every match, and the occupant lookup naming a tenant while leaving a vacant unit `null`). Full e2e green: **410 passed, 2 skipped, 0 failed of 412**, on both projects, including all three previously-`fixme`'d reflow assertions now genuinely passing. Ten new specs: the setup relocation, an axe scan of the new route, an occupied unit's tenant link (checked without depending on table-vs-card markup, since the assertion has to hold on both), and pagination against the e2e sandbox facility's 250 seeded units — the one demo facility deliberately sized past a single page, with Austin and Dallas kept under 50 on purpose so the default view stays unpaginated.

**Left behind, and said so in the accessibility statement:** Tasks, Leads and Delinquency are still unpaginated. The statement's staff-screens line dropped its now-false reflow claim and named the lists that are actually still long.

## B-117 — Navigation hierarchy, admin and portal

`7716178`

**Built:** the admin left nav is grouped into four labelled sections — **Today** (Dashboard, Tasks, Inquiries), **Property** (Units, Walkthrough, Maintenance, Overlocks, Gate Activity, Keypad Queue, Gate Health), **Money & tenants** (Tenants, Billing, POS, Delinquency, Rate Increases, Auctions, Reports), **Admin** (Settings) — instead of twenty destinations in one undifferentiated column. Below `sm`, only Today renders as the horizontal strip; the rest sit behind a native `<details>` "More" disclosure, open by default when the current page lives inside it, so arriving at Settings by a bookmark does not read as "lost the nav." **Leases** and **Audit Log** are deleted from the catalog, not hidden — both resolved only to the shared "built in a later backlog item" placeholder, and a nav promising two destinations it does not have reads as unfinished to the person being asked to trust it with rent. Leases stay reachable from the tenant profile.

The portal's nine account links go from one flat row (which wrapped to four lines above the balance at 360px) to four ordered by actual frequency — Overview · Payment methods · Statements · Documents — with the other four (Who can get in, Protection, Contact details, Notifications) behind a **Manage** disclosure, and **Move out** set apart by a visual divider as the one irreversible destination in the list.

**Decided — group lives on the item, not in a second list.** `NavItem.group` is a field on the same row that already carries `label`/`href`/`anyOf`, and `groupedNavItems()` partitions `visibleNavItems()`'s existing output by it. A parallel `NAV_GROUPS` array mapping keys to item lists was the other option; rejected because it is a second source of truth that can silently drift from the catalog the moment someone adds an item and forgets the second list.

**Decided — kept the `[section]` placeholder route and `navItemForSection`, deleted only the two catalog rows.** After removing Leases and Audit Log, nothing currently points at the placeholder — but the mechanism is exactly what the NEXT nav item needs before its own screen ships, per the file's own header comment, and deleting working infrastructure to satisfy a moment where it happens to be unused is not what "delete unused code" means. `/admin/leases` now genuinely 404s rather than rendering the placeholder, which is the correct behaviour once nothing names it.

**Decided — an empty group renders nothing, not a bare heading.** `groupedNavItems` drops a group with zero visible items after RBAC filtering (a counter with none of Property's four gating permissions sees Today and Money & tenants only) rather than showing "Property" with nothing under it.

**Test verification:** unit suite green (2,821 passing — nav catalog integrity, RBAC visibility per group, empty-group dropping, and display order held independent of `NAV_ITEMS`' own array order). Full e2e green: **418 passed, 2 skipped, 0 failed of 420**, on both projects. New coverage: the four group headings render at desktop width (explicit viewport, not the project default, since mobile-chrome's 412px sits below the `sm` breakpoint that switches the markup); Leases/Audit Log are absent from the nav AND 404 by direct URL; Tasks is reachable in the mobile Today strip without opening anything, and Settings is not reachable until More is opened; the portal's four frequent links are visible immediately, the other four are absent from the accessibility tree until Manage opens (a closed `<details>` removes its content entirely, not merely hides it), and Move out stays reachable without opening Manage at all.

**Left behind:** the row's portal ask ("separate Move out visually") was read as a divider plus its own position, not a warning colour — nothing else in the product marks an irreversible action with colour alone, and the portal's own move-out flow (B-041) already carries its own confirmation step.

## B-118 — Facility page: hero photo, sticky rent CTA, and the hold window stated before the form

`101430f`

**Built:** the first 1–3 photos move above the fold — directly under the facility name, above the contact block — as the LCP element, with explicit `width`/`height` (a 4:3 pair matching the display box, not the source image's own unknown dimensions), `fetchPriority="high"` on the first photo only, and `loading="eager"`. The rest of the gallery stays at its original position, `loading="lazy"`, never repeating what the hero already showed. A facility with no photos renders neither section — no placeholder, no empty frame. The stale header comment claiming the gallery was "missing on purpose" (true before B-067, false since) is deleted. Below `sm`, a sticky "Rent now" bar appears once the units section scrolls past — pure CSS (`sticky bottom-0`, the same technique `price-summary.tsx` already uses for the checkout stepper), no JavaScript. It names the cheapest available size in the visitor's own current filter and carries both a real "Rent now" (POSTs to the same `/rent` route every unit card uses) and a "Reserve free" link.

**Found — D-7 was never built.** The row's own example trust-line text was `"Free to hold for 7 days"`, matching D-7's stated default. But B-018 shipped something else entirely: `holdExpiryFor` expires a hold at end of day *after the renter's own chosen move-in date* — not a fixed 7 days, and not configurable per facility at all. Displaying "7 days" literally would have been false for most renters, on exactly the question the trust line exists to answer honestly (a renter picking the maximum 14-day-out move-in holds a unit up to 15 days; one moving in today holds it 2). Filed as **D-50 / B-126** rather than resolved unilaterally — whether the product should build the window D-7 promised, or D-7 should be corrected to match what shipped, is the owner's call. The reserve page's trust line now states the real rule: "Free to hold through the day after your move-in date."

**Found — three of my own test bugs, each instructive.** `getByText(...).toHaveCount(0)` does not respect `display:none` the way `getByRole` does — a `sm:hidden` element stays in the DOM and `getByText` still counts it, so an assertion meant to prove the sticky bar is absent above `sm` was passing regardless of whether the CSS actually applied. Fixed to `toBeHidden()`. An existing "click-to-call visible without scrolling" test's own comment said "on mobile" but its assertion ran unscoped on both projects — the hero photo legitimately pushes the fold past 720px on a desktop viewport while staying inside a real phone's, so the test now says what it always meant. And the axe scan on the redirected reserve page surfaced a genuine, checked-by-hand-not-a-defect: axe's contrast checker cannot resolve an effective background for an element it detects spatially overlapping another, which a `sticky bottom-0` bar does by design once scrolled to. Exempted by axe's own failure-summary wording for that specific limitation (not by a CSS target path, which shifts), joining the existing iframe exemption in `a11y.spec.ts`.

**Found — a real bug, then ruled out.** The sticky bar's checkout POST redirected to `?unavailable=1` against a fresh reseed. Root cause, confirmed by clearing it and re-testing clean: `.next/cache` persisted across my own repeated manual reseed-then-rebuild cycles this session, so `unstable_cache`'s 5-minute-TTL inventory read served unit-type IDs from a deleted, regenerated seed generation. Not a product defect — a normal CI run (checkout → seed once → build once → test) never hits this, since there is no stale cache to begin with. Left as a note for the next session that reseeds mid-stream rather than a backlog item, since the fix is "clear `.next/cache`," not a code change.

**Decided — the seed needed real photos to test the thing this item built.** Every demo facility had zero `FacilityPhoto` rows, so "renders no placeholder and no empty frame" was accidentally the ONLY case any demo data could exercise. Austin (the facility already carrying the a11y/reflow sweep) gets four seeded photos — three for the hero, one left over for the gallery, so the dedup assertion has something real to fail against if it were wrong. Dallas and the e2e sandbox stay at zero on purpose, keeping the empty case real too. Photos are `data:` URIs, not a third-party image host — this project does not point its own test suite at a network dependency it does not control.

**Also fixed:** devdash (the user's local dev-server dashboard, outside this repo) labelled every plain `kill` from outside its own UI as "exited — cause unknown" forever, even after checking for an OS memory-pressure kill and a crash report and finding neither. It now says so when both checks come back clean, rather than leaving the alarming-sounding placeholder in place.

**Test verification:** unit suite green throughout (2,821 passing, unchanged — this item is entirely presentational/client markup). Full e2e green: **424 passed, 6 skipped, 0 failed of 430**, on both projects. Ten new specs cover the hero's LCP attributes and fold position, the priority hint on the first photo only, gallery dedup, the zero-photos case, the sticky bar's price/actions/absence-above-`sm`/real checkout start (split across Austin, read-only, and the e2e sandbox, real-POST — the sandbox's 250-unit pool is what makes a real click-through safe under parallel load, matching why that facility is sized the way it is).

## B-119 — The accessibility scan contract

`5900834`

**Built:** `PUBLIC_ROUTES` in `e2e/a11y.spec.ts` now genuinely is the contract it claims to be — added `/messaging-policy`, `/login`, `/forgot-password`, `/reset-password` and `/unsubscribe/not-a-real-token`. A new `ADMIN_ROUTES` list in `e2e/admin.spec.ts` grew from 7 routes to the full ~42-route enumeration of every static `apps/web/app/admin/**/page.tsx`, plus `/mfa` and `/reauth` scanned signed-in, with a header comment naming exactly what stays out (dynamic per-entity routes already owned by their own topic spec files) and why. `e2e/portal.spec.ts` gained the same treatment — a `PORTAL_ROUTES` list covering all nine portal pages except `/portal/pay`, whose existing test drives a real lease rather than a bare `goto` and was kept instead of duplicated. Admin and portal both gained the 200%-zoom and forced-text-spacing loops that only public routes had before. `e2e/smoke.spec.ts`'s move-in walk now calls `assertNoAxeViolations(page)` after every `advance` — steps 1 through 5 of checkout, confirmed clean at each. The existing focus/live-region test (B-110) was extended to check a second step transition, not just the first, so "focus moves and the live region's text changes" is now asserted more than once per suite run rather than trusted to generalise from one sample.

**Found — two real, pre-existing defects, both invisible until this item's routes were finally scanned.** `scrollable-region-focusable`: 33 occurrences of `<div className="overflow-x-auto">` across 21 admin/portal files (units, settings, reports, POS, overlocks, access, leads, ledger, keypad, statements) had no keyboard stop, so a sighted mouse user could scroll a wide table and a keyboard user could not reach it at all. Root-caused with a live Playwright script checking `scrollWidth > clientWidth` per element rather than guessing from the JSX — on pages with two `.overflow-x-auto` regions, only the one that actually overflowed needed the fix, and the first pass grabbed the wrong one and produced a false negative. Fixed with `tabIndex={0}` alone; verified live that no additional `role`/`aria-label` was needed. `definition-list`: `/admin/reports/revenue` and `/admin/reports/delinquency` each nested an explanatory `<p>` as a third sibling of `<dt>`/`<dd>` inside a `<div>` under `<dl>` — invalid per the HTML spec, which permits only dt/dd pairs there. Fixed by moving each `<p>` inside its own `<dd>`, which is valid flow content and keeps the note attached to the figure it explains.

**Found — a typecheck blind spot, documented rather than silently worked around.** `npm run typecheck` never caught a missing `AxeBuilder` import in `e2e/smoke.spec.ts` — it only surfaced as a runtime `ReferenceError` under Playwright. Cause: `apps/web/tsconfig.json`'s `include` is `apps/web/**` only, so the repo-root `e2e/*.ts` directory is invisible to `npm run typecheck` entirely. Not fixed — widening that tsconfig's scope or adding a second typecheck pass for `e2e/` is a real but separate improvement, out of this item's scope, and left here so it isn't lost.

**Decided — consolidate scattered axe coverage into one route-contract list per surface, rather than leaving hand-written one-off tests where they landed.** Portal's pre-existing standalone `/portal/documents`/`/portal/contact` axe loop was deleted once `PORTAL_ROUTES` covered the same ground — two competing tests of the same page is how coverage quietly drifts out of sync with itself.

**Left behind — the five manual passes automation cannot replace, named rather than implied, the same way B-093's were:**
1. **VoiceOver + Safari over the full checkout** — not run this session.
2. **VoiceOver + iOS over the portal past-due state** (the persistent balance banner is `role="alert"`, which the row itself flags as not what `alert` is for) **and the gate-code reveal** — not run.
3. **NVDA + Firefox over the admin error summary, the tax confirm-and-echo, and a facility switch** — not run. B-094's row claims a facility switch announces the new context; nothing in this session's source reading found a live region that would do that, so the claim stays unverified rather than assumed fixed by a later item.
4. **Keyboard-only tab-stop count on `/admin/units` at 290 units** — not run.
5. **A focus-indicator sweep across Chrome, Firefox and Safari** — not re-run since B-093, despite six months of new components since.

None of these were skipped for lack of trying — I cannot physically operate a screen reader. They stay open, owned by whichever future item next touches the screens they cover, the same way B-093 left them.

**Also corrected:** `apps/web/app/(public)/accessibility/page.tsx`'s "How we check" section named `/messaging-policy`, the sign-in/account-security pages, and checkout's working state as outside the automated run — true when B-093 wrote it, false as of this item. Replaced with the one gap that is still real and structural: the checkout confirmation screen only renders after a genuine Stripe redirect, which cannot be simulated outside Stripe's own iframe, so it stays unscanned. `LAST_REVIEWED` moved to match.

**Test verification:** unit suite green, unchanged (2,821 passing — this item is entirely e2e and markup). Full e2e green: **847 passed, 5 skipped, 0 failed of 852**, on both projects, up from 424/6/430 before this item — the growth is almost entirely the new route coverage doing its job.

## B-120 — The e2e suite is not repeatable, and it does not notice when it is testing the wrong application

`111b9b2`

**Built, two of three:** `apps/web/package.json`'s `dev` and `start` scripts now pin `-p 3000` explicitly instead of letting Next.js pick the port. Verified directly, not assumed: with a dummy listener genuinely holding port 3000 (bound IPv6, matching how Next itself binds — an IPv4-only dummy listener does not collide with it at all, which is what a first pass at this test got wrong), `next dev` with no `-p` prints "Port 3000 is in use... using available port 3001 instead" and keeps running; `next dev -p 3000` against the same occupied port throws `EADDRINUSE` and exits. Traced to Next's own source (`start-server.js`): the auto-retry is gated on `allowRetry = portSource === 'default'`, so an explicit port is the whole fix — one flag, no Playwright-side workaround needed, and it protects `npm run dev` too, not just e2e. `next start` (production) never retried regardless of the flag — `isDev` gates the retry — so B-125's production-build convention had already closed this for every normal `test:e2e` run; the explicit port matters for `E2E_DEV=1` debugging, which still runs the dev server.

Added `db:migrate:e2e`, migrating and seeding the `public` schema of the `storage_test` database — what Playwright's own process, `global-setup.ts`, and the built app under test all read directly, since none of them load `vitest.config.ts`'s schema redirect. `db:migrate:test` only ever touched the separate `storage_test` SCHEMA vitest redirects to; `public`, in the same-named database, had never had a script of its own; it had been migrated at some earlier point by hand, undocumented, which is exactly the gap the row named. CLAUDE.md gets a new bullet spelling out the two-schemas-one-database split, since the existing `db:migrate:test` bullet reads as if it covers the whole suite and does not.

**Found, on inspection rather than assumed from the row's two-day-old description: the third problem (fixture mutation across an un-reseeded second run) does not currently reproduce.** Two full sweeps run back-to-back against the same server with no reseed between them, exactly the shared-state discipline this file's own "run it twice" rule asks for: **847 passed / 5 skipped / 0 failed**, then **846 passed / 6 skipped / 0 failed**, both of 852. The one skip that moved is accounted for by name: `admin-tasks.spec.ts`'s returned-mail flow is written to detect its own already-flagged/already-completed state and self-skip rather than fail, and the second run hit exactly that branch because the first run had just completed it — the code doing precisely what its own comment says it does. Reading each spec the row named turned up why the other two examples no longer apply: `admin-move-out.spec.ts` never clicks "Complete move-out" — it only asserts the preview renders — so there is no mutation to leak between runs; and `global-setup.ts` already expires every checkout lock and reservation hold unconditionally at the start of every run, which is exactly the reservation-exhaustion fix the row was asking for, already built (its own header comment dates the reasoning to before this row was written). None of this was true by luck — B-115 through B-119 and the original `global-setup.ts` design each landed a piece of it without this row's own text catching up.

**Decided — write the policy down rather than leave it to be inferred from five files that happen to agree.** The row's own instruction was "pick one and say which, because doing half of each is how it got here" — and the honest answer is the codebase already runs a coherent split, just an unstated one: shared *disposable* state (checkout locks, reservation holds) is `global-setup`'s to reset unconditionally; shared *named-entity* state a spec creates is either scoped to a fixture nothing else asserts a fixed value against (`admin-pos.spec.ts`'s dedicated `DEMO_POS_TENANT_EMAIL`) or genuinely idempotent with a self-skip once its target state has already moved (`admin-tasks.spec.ts`). Named as a new CLAUDE.md bullet so the next spec against shared demo data has three known-good patterns to fit into rather than a fourth to invent.

**Left behind:** the two-run verification here is not a standing check — it was run once, by hand, for this item. Making a second sweep run automatically (or asserting on the specific skip-vs-fail distinction) was not something the row asked for and would cost real CI minutes for the same answer this item already established.

**Test verification:** unit suite green, unchanged (2,821 passing — no application code touched, only scripts, docs and a port flag). Typecheck clean. Full e2e verified **twice, back to back, no reseed**: 847/5/0 then 846/6/0, both of 852 — the standard this item exists to name.

## B-121 — The active-duty declaration reaches the delinquency pipeline

`3b29a71`

**Built:** `Tenant.activeDutyMilitary` now does something. `lib/tenants/active-duty.ts`'s `syncActiveDutyHolds` places a `military_scra` `LeaseHold` on every non-ended lease the tenant holds, and it is called from two places: inside `provisionMoveIn`'s transaction, so a web move-in by a servicemember is protected before the lease can be dunned by anything; and from a new **Military service** control on the tenant profile, so a declaration taken at the counter or on the phone does the same. The tenant profile shows the declaration as a three-state fact — yes, no, and *nobody has ever been asked*, which is a different thing and now reads as one.

**The gap, stated plainly, because it is the reason the row exists.** `military_scra` had carried the right restrictions since B-096 and was raised **only by hand**; the declaration had been collected at the lease step since B-112 and read by **nothing**. So a renter who ticked the box was overlocked, dunned and auctioned exactly like anybody else, and the file recorded that we had asked and been told. 50 U.S.C. §3958 restricts enforcing a storage lien against a servicemember's property during service without a court order — asking the question and ignoring the answer is worse than never asking, because it leaves evidence we knew.

**Found — `block_auction` was declared and enforced by nothing at all.** The effect has sat in the holds catalog since B-096 on four hold types (SCRA, bankruptcy, deceased, litigation) and no code path read it: not `auctionReadiness`, not `approveAuction`, not `scheduleSale`. What hid it is the ordering — the nightly engine halts on `halt_dunning` before it can ever *open* a case, so every case that exists was opened before its hold went on, and nobody hit the state where the effect mattered. The state is reachable the way it actually happens: the case exists, then the tenant deploys. A regional manager could approve, and schedule, the lien sale of an active-duty servicemember's unit with the SCRA hold in force and the banner on the profile saying "do not sell". Closed in both places — a new `on_hold` blocker in `auctionReadiness` (ahead of the vehicle carve-out, being the one blocker where proceeding is federal rather than a state lien-law defect) and a refusal in `approveAuction`, checked on the **effect** and never the hold type, per US-42.

**Found — the checkout silently discarded a genuine declaration.** `recordLeaseDeclarations` merged additively as `existing ?? input`, and a returning renter who had NOT ticked the box the first time has `false` on file, not null — so `false ?? true` is `false`. Their new declaration was validated, written to the checkout session, and dropped on the floor. That is precisely the renter this item exists for: rented once as a civilian, deployed, came back. Additive now means "only ever towards protection" — `true` wins whichever side it is on, and an unauthenticated form still cannot clear a flag already on file.

**Decided — the hold is a real row, not an effect derived from the boolean.** Deriving it needs no migration and was the first thing tried. It is wrong: a declaration is not proof, a tick can be a mistake, and service ends — and US-42 requires a manager to lift a `military_scra` hold, which a derived effect makes impossible for anyone. A tenant who ticked the wrong box would be locked out of autopay permanently with no path back. A row can be lifted, by a manager, with a reason, audited.

**Decided — `LeaseHold.placedByStaffId` becomes nullable rather than pointing at a fake "system" staff user.** There is no person at a web move-in, and inventing one would put a fictional employee in the staff list and in the audit log — the one record whose entire value is that it does not contain fiction. The banner names it as "Automatically, from the tenant's declaration" rather than leaving a blank a manager would lift to find out about.

**Decided — the protection deliberately outruns the acting staffer's facility scope.** `syncActiveDutyHolds` covers every lease at every facility, so an Austin-only counter staffer recording the declaration protects the tenant's Dallas lease too. Refusing would leave half a servicemember protected, and the SCRA does not care about our facility boundaries. The permission check sits on recording the *declaration* (`tenants:edit`, via `assertTenantAccess`), which is the act a person performs; the protection that follows is a system consequence, and it is system-attributed for exactly that reason.

**Decided — recording "no" never lifts a hold.** The asymmetry is the point: US-42 makes lifting manager-only, so letting anyone with `tenants:edit` undo the protection by unticking a box would route straight around the one restriction that matters. The screen says so where the control is, and the success message repeats it.

**Decided — `syncActiveDutyHolds` reads the flag itself rather than trusting its callers.** Both call sites checked it; the function is now self-guarding anyway. Every move-in in the product runs this, and a third call site that forgot would place an SCRA hold on a civilian and freeze their autopay behind a manager-only lift. The guard belongs where it cannot be skipped.

**Decided — a new audit action, `tenant.active_duty_recorded`, rather than reusing `tenant.contact_updated`.** It started on the latter. The question an SCRA claim asks is "when did you know?", and filed under contact details the answer is one unremarkable row among every phone-number correction ever made.

**Left behind:** the SCRA lease clause is still not written — D-49 defers the wording to the attorney pass that already owns the Texas Property Code ch. 59 lien and notice language, and this item deliberately did not pre-empt it. No demo tenant is seeded as active-duty: seeding one would place holds that halt dunning on shared demo data and quietly change what several other suites are asserting against, which is the B-120 discipline applied rather than ignored.

**Test verification:** unit suite green, **2,834 passing** (up 13 — twelve in a new `tests/active-duty-scra-db.test.ts`, one for the auction blocker), and **run twice** with identical results per the shared-state rule. Typecheck, lint and the schema-drift check all clean. Full e2e green: **848 passed, 6 skipped, 0 failed of 854**, both projects; the two extra skips against the previous sweep are `admin-tasks`' documented once-per-day self-skip firing because an earlier sweep the same hour had already completed it. The new e2e spec records "**No**" and never "Yes" — deliberately, and the comment says why: recording no writes the flag and places no hold, so a sweep leaves the shared past-due demo tenant exactly as dunnable as it found her, while a "Yes" would halt collections on the tenant the portal banner, delinquency queue and dunning specs all depend on being chased. The placing side is proved against disposable fixtures instead.

**Accessibility statement:** re-read before committing. Nothing shipped here made a claim false — the new control is on a staff screen, and the tenant profile's existing axe scan covers it and passes. `LAST_REVIEWED` already read 15 August 2026 from B-119 earlier the same day, so it stands.

## B-122 — A renter can actually enter a promo code

`b0b4140`

**Built:** a code box on the facility page and a second one at the checkout price summary, both re-evaluating server-side. The facility page's is a GET form, so the code lands in the URL — shareable, survives a reload, works with the bundle disabled, and rides the same query-string pattern the filters and sort already use; the filters, sort and size travel with it as hidden inputs so applying a code cannot silently clear them. The code carries into the "Rent now" POST, which **re-derives** the offer rather than accepting anything the form said, and onto the checkout session's existing `PromoSnapshot` — the same snapshot the summary, the amount due today and the redemption row all read, so there is still exactly one place the discount is decided. The checkout's box posts to a server action instead, and is deliberately absent from the payment step: the total there has been authorised (§6.4) and `provisionMoveIn` is about to redeem the schedule the session locked.

**The gap, and it was total.** `offerFor` has taken a `code` argument since B-070 and **no surface passed one**. A code-gated promotion could be created in admin, was correctly hidden from the badges, and could then never be redeemed by anybody — `PromoCode.usesCount` had no path to increment anywhere in the codebase, so a partner allocation of 100 uses was in practice unlimited, and `REJECTION_MESSAGES`' seven carefully distinguished refusals had never been displayed once.

**Decided — `Evaluation.rejection` becomes `Evaluation.codeOutcome`, which has three cases rather than two.** A rejection covers only two fates of a typed code, and the missing one is not an edge case: FR-PROMO-4 forbids stacking, so a valid code worth less than the automatic promotion already on the unit is *correctly* ignored — and a renter who typed a real code, got no rejection and watched the total not move has been told nothing at all. `superseded` is that case, said out loud ("We kept your better offer — …"), and deliberately not framed as a failure, because the renter is better off than the code would have made them. Replaced rather than added beside `rejection`, so there is one source of truth about what happened to a code rather than two that can drift.

**Found — two controls named "Apply" on the same page.** The unit-filter form already had one. A screen-reader user tabbing the facility page met "Apply, button … Apply, button" with nothing to tell them apart (WCAG 2.4.6). Surfaced as a Playwright strict-mode violation, which is the same ambiguity measured a different way. The code button is "Apply code" now. The checkout had the same shape in miniature — the form's accessible name and its field's label were both "Promo code", announcing "Promo code, form — Promo code, edit text" — so the form is "Add a promo code".

**Found — two live regions announcing the same sentence.** The promo action first wrote its outcome into the price summary's `changeNote` *and* returned it as the form's success message, so a screen reader said "Code applied — half off your first month" twice, from two regions a few pixels apart. The action now clears `changeNote` instead of writing it: every other step writes one because the control that moved the total is elsewhere on the page, and this control is directly under the total. §6.4's "a total that moves must state its cause" is still met, and more durably than a note — the discount is a named line in the summary's own itemisation, which survives a reload.

**Decided — the seeded demo promotion is code-gated and scoped to the e2e sandbox facility.** Both halves are what make it safe to seed at all: an automatic promotion changes every advertised price on the facility it touches, and the smoke suite asserts real totals against Austin. A gated one is invisible until a test types the code, and the sandbox is already the facility sized for tests that take real units. This is the B-120 discipline applied rather than cited.

**Left behind:** the code entry is not on the reserve form. A reservation carries no promotion today (`offerFor` is called there for the quote only), so a box that accepted a code and then dropped it at conversion would be worse than none — that belongs with whatever item makes a hold carry its offer. Nothing here touches the clawback path for `minStayMonths`, which is still unbuilt and still noted on the model.

**Also found — an existing spec that this item's own button broke, and the reason is worth keeping.** `getByRole`'s `name` option is a SUBSTRING match, so the moment "Apply code" existed, the filter spec's `{ name: 'Apply' }` matched two buttons; and the promo box's deliberately pre-mounted, deliberately empty live region became a second `role="status"` on the same page. Neither is a defect — a page may have two live regions and two buttons whose labels share a word — so both locators were narrowed rather than the page changed. The spec's own neighbouring comment already recorded this lesson once, from B-068's lead form adding a second control mentioning "Size"; it has now happened three times on one page.

**Test verification:** unit suite green, **2,839 passing** (up 5 — two in the core evaluator for the applied/superseded split, three DB-level walking a gated code from `offerFor` to a session to `usesCount`). Typecheck, lint and the schema-drift check clean. Full e2e green: **866 passed, 6 skipped, 0 failed of 872**, both projects. Seven new specs: a code applying and showing its terms, a refusal naming *which* rule refused it (the seeded promo is facility-scoped, so the same code at Austin is a real `not_for_this_facility`), an unknown code discounting nothing, the code surviving "Rent now" into the checkout total, and entry at the summary mid-checkout. The refused state joins the axe route list as its own entry — different markup from the resting one, and an error message that fails contrast is an error message nobody reads.

**Accessibility statement:** re-read before committing. Nothing shipped here made a claim false — the new controls have real labels, tie their errors to the field, keep what was typed on a refusal and announce success, which is what the "What is true today" list already says. Both surfaces were already inside the axe sweep (the facility page by route, the checkout by B-119's per-step scans), and the refused state was added to it.

## B-123 — Marketing SMS: the lane, built and deliberately dark

`7c11133`

**Owner decision first (D-51).** The row was explicitly build-or-decide, and the owner chose to build. The lane exists end to end and **nothing sends on it**, because the two remaining blockers are not code: PRD 04 AC3's disclosure copy is awaiting the legal review Open Question Q5 names, and A2P 10DLC needs a **marketing** campaign registered separately from the transactional one (PRD 05 §6.3). D-51 records the choice, the reasoning and both blockers.

**Found — the trap was real and structural, not hypothetical.** `smsConsentGranted` checked `account_sms` for **every** classification, with a comment explaining that this was fine because no marketing SMS rule existed. That was true and load-bearing on nobody ever adding one: the first marketing rule wired to SMS would have sent a promotion under **transactional** consent, which is exactly the compliance failure PRD 05's two-lane split exists to prevent, with nothing in the code to stop it. The gate now picks the lane from the classification, so a marketing text with no `marketing_sms` consent is refused.

**Found — a second, opposite hole in the email fallback.** `sendEmailFallback` is deliberately simpler than the email path (its own comment says so) and skips the marketing quiet-hours, daily-cap and unsubscribe-link branches *and* the `marketing_email` consent check. So a marketing SMS that could not be sent would have arrived as a marketing **email** that passed none of the marketing gates, to somebody whose only recorded consent might have been for texts. A marketing SMS now never falls back across lanes, whatever the rule's `channelPolicy` says; if a campaign should also go by email, that is a rule row.

**Built:** `marketing_sms` consent captured at checkout as its own fourth unchecked box with its own disclosure and version (`v1-draft`, named that way because it *will* change when legal reviews it), and in the portal with the disclosure shown at the point of granting — express written consent is consent to the words the person was actually shown, and a bare "on" switch is consent to nothing in particular. FR-MSG-5's once-a-day marketing cap now applies to texts as well as email, keyed on the address like the email one. SMS variants of the two marketing templates are seeded, so the 10DLC campaign registration can cite real message samples, which is what a carrier review asks for.

**Decided — the portal's marketing switch is consent-only and never touches suppression.** CN-13's existing "turn off text messages" is deliberately `applySmsStop`, which suppresses the number globally — the right answer to "stop texting me" and the wrong answer to "stop texting me about sales". Suppression is address-keyed and would take the gate code with it. Turning marketing off writes a consent row and nothing else; a global STOP still stops both lanes, because that is enforced a layer up.

**Decided — templates ship, rules do not.** The lane is complete and inert. A test asserts no org-level marketing SMS rule exists, so if a later item turns the lane on, that test fails and whoever did it has to come and read D-51 first. The marketing-lane tests build their own rule and their own template rather than using a seeded one — which is how you prove the gate without shipping a live campaign.

**Also corrected:** the messaging policy told tenants their only way to stop offers was STOP, which also costs them their gate code. It now points at the marketing-only switch, since one exists.

**Also fixed, from B-122 the same day:** an `eslint-disable-next-line` in `promo-code-step.tsx` stopped covering its target when a later edit inserted a comment between the directive and the line it suppressed — so the `any` it was hiding became a lint error. Typed the action properly (`(state: FormState, formData: FormData) => Promise<FormState>`) and deleted both the cast and the directive, which is what should have been there first.

**Left behind:** no marketing SMS sends until legal clears the disclosure and the 10DLC marketing campaign is registered — both tracked in D-51, neither a code change. The drip and abandonment sequences still run on email only; wiring them to the SMS lane is a rule row plus a copy review, and is deliberately not done here.

**Test verification:** unit suite green, **2,848 passing** (up 9 — seven new marketing-lane tests in `sms-delivery-db.test.ts` covering the refusal, the send, both directions of lane independence, the no-cross-lane-fallback rule, the daily cap, STOP still winning over consent, and the assertion that no seeded rule dispatches marketing SMS). Typecheck and lint clean — lint is back to its four pre-existing warnings with zero errors. Full e2e green: **867 passed, 5 skipped, 0 failed of 872**, both projects; the checkout control-list spec now pins four consent boxes and asserts every one is unchecked by default, which is the property that makes the record mean anything.

## B-126 — The reservation hold window: D-7 corrected, and the configurable half built

`6735c28`

**Owner decision.** The row was build-or-decide and the framing turned out to be sharper than it read. **PRD 01 US-401 has always said** holds expire "default: end of day after scheduled move-in date; **configurable**" — which is exactly what `holdExpiryFor` has implemented since B-018, with the code comment quoting that line. So D-7's "7 days" contradicted the feature PRD *and* the shipped code, not one of them: it was the outlier, not the spec. Building it literally would have been the defect, because US-401 lets a renter pick a move-in up to 14 days out and a booking-anchored 7-day window would have taken the unit back a week before the day they reserved it for. The owner chose to correct D-7 and build the one half genuinely missing.

**Built:** `Facility.reservationHoldGraceDays`, default 1 — so behaviour is unchanged at the default and every existing row keeps exactly the window it had. `holdExpiryFor` takes the grace as a parameter defaulting to the same constant, `createReservation` reads the column, and the admin operations-policy form gets its control in the same item, which is this repo's own rule about columns that configure behaviour. `0` is legitimate and means the hold dies at the end of the move-in day itself; the form caps at 30 because a grace longer than the 14-day booking window would hold a unit off the market for six weeks on one form submission. Negative is refused by the form and clamped in the function as a backstop — a hold expiring before the date the renter chose is never a deliberate configuration.

**Decided — the reserve page's trust line is generated, not written.** B-118 shipped it as fixed prose because there was no setting to read, and that item is the evidence for why generating it matters: it found the sentence and the function had already drifted apart. `holdWindowSentence` lives beside `holdExpiryFor` in the same file, so the two halves of one promise — what the code does and what we tell the renter it does — cannot be changed independently. An operator who sets 0 gets a sentence that says so without anyone remembering to come back.

**Decided — three cases, not one template with a plural `s`.** To somebody deciding whether to hand over their phone number, 0 and 1 are not "0 days" and "1 day"; they are "the day you picked" and "the day after".

**Documents corrected:** D-7 now describes the per-facility window and carries the correction inline with why the "7 days" figure was wrong on both halves. D-50, which B-118 opened and which deliberately deferred this, is closed out with the resolution.

**Test verification:** unit suite green, **2,856 passing** (up 8 — the default proving nothing changed for anyone who does not configure it, grace 0, a longer grace across a month boundary, the negative clamp, three for the generated sentence, and a DB-level test that `createReservation` genuinely reads the column and produces a shorter expiry than the default would have). Typecheck, lint and the schema-drift check clean. Full e2e green: **867 passed, 5 skipped, 0 failed of 872**, both projects — unchanged from before this item, which is the point: the default preserves every existing hold window exactly.

## B-100 (part 1) — Referral program: the engine

`792af15`

**NOT COMPLETE. The backlog row is deliberately left unticked.** B-100 is an L item and this entry covers the half that is built and tested; the rest is named at the bottom and is the next session's work. Recording it this way rather than marking the row ✅ because a row ticked on a feature nothing can trigger is exactly the kind of claim `PROGRESS.md` exists to prevent.

**Built — the engine, end to end and tested:**

- **`packages/core/referrals`** — the rules, pure. The 8-character alphabet (§5.1) excludes `0/O/1/I/l` as the PRD requires and `U` as well, because "V" dictated over a phone is heard as "U" and that is the same failure the PRD's own exclusions exist to prevent. `evaluateReferral` judges all seven fraud rules from a facts object and returns the FIRST failing one — a referral that breaks three rules is still one conversation, and listing all three buries the one the tenant can act on.
- **The refusal vocabulary is a closed set with a written sentence per reason**, which the row states as an acceptance criterion rather than a nicety: "a refusal that does not say what would have qualified is a 3.3.3 failure and a support call." A test asserts no message contains "not eligible", that each is a real sentence, and that each names its rule.
- **`ReferralInvite` + `Referral`** with the seven facility columns the PRD lists, plus `referralCrossFacility` — §5.4 describes cross-facility as an operator opt-in and §6.1's column list omits it, so it is added rather than hardcoded.
- **`lib/referrals/service.ts`** — minting (with the open-invite cap, and expired invites deliberately not counted against it), `/r/{code}` lookup, and qualification with every §5.4 rule evaluated against real rows.
- **The single-use guarantee is atomic**, per §6.1: a conditional `updateMany ... where redeemedAt IS NULL` decides the winner when two friends complete a move-in in the same instant. A DB test drives both concurrently and asserts exactly one earns, the invite is spent once, and **the loser is recorded as refused rather than dropped** — §5.4's "a refused referral never silently drops".
- **`/r/{code}`** sets a 90-day first-party cookie and 302s to the facility page. FR-REF-3's canonical-redirect trap is closed **by construction**: the destination comes from `facilityPath()`, which builds the canonical path from the facility record, so the facility page has no reason to redirect again. The cookie carries the invite id, never the referrer's name — the referee learning which friend gets paid for them is a conversation neither asked for.
- **A dead code never shows a stranger an error.** §5.1's AC is explicit about this, and `usableInvite` returning null is an ordinary outcome routed to `/storage/search`, not an exception.
- **Eight settings controls in the same item as the eight columns** — the repo's first hard-won rule, which PRD 10 §6.1 cites by name. `referralEnabled` defaults **false**: the program pays real money on a rule set the attorney pass has not reviewed (§9), so an operator turns it on knowingly.

**Found — `/r` was not in `NOINDEX_PREFIXES`.** A referral link is a single-use bearer token worth $50, and indexing one publishes it — the coupon-site exposure the single-use design exists to bound, with a search engine doing the posting. Added, which also covers crawlers that ignore robots.txt since the middleware stamps `X-Robots-Tag` from the same list.

**Decided — the self-referral check matches on what this build actually has.** §5.4 says "email, phone (last 10 digits) and payment fingerprint". The card fingerprint is not stored and cannot be: the browser talks to Stripe directly to keep the integration in SAQ-A. Email, normalised phone and the tenant id are what is matched, and the code says so rather than implying a check it does not perform.

**Still to build, and none of it is started:**
1. **The trigger.** Nothing calls `qualifyReferral` yet. §4 fires it on the `move_in_completed` signal gated on the payment having cleared — `provisionMoveIn` is where that goes.
2. **The discount hand-off (§6.2).** Rewards are recorded as owed and reach no invoice. They must go through B-070's structured-discount path, not a second mechanism.
3. **Attribution into leads and reservations (§5.3)** — the cookie is set and read by nothing, so no `referral_tenant` channel is recorded yet. The channel value itself is added.
4. **The portal invite control (§5.1 AC)** — minting has no UI, so no tenant can share anything.
5. **Comms (§6.3)** — four transactional templates.
6. **Clawback (§4.1)** — the refund and minimum-stay reversals.

**Test verification:** unit suite green, **2,898 passing** (up 42 — 22 pure-rule tests including the "never says just 'not eligible'" assertion, and 20 DB-level covering minting, the caps, case-insensitive lookup, every fraud refusal, snapshotting, and the concurrent single-use race). Typecheck, lint and the schema-drift check clean. Full e2e green: **867 passed, 5 skipped, 0 failed of 872** — unchanged, as it should be for an engine nothing calls yet.

## B-100 (part 2) — Referrals: the trigger and the money

`fdfb49e`

**Still not the whole row.** Part 1 built the engine; this makes it run and pay. What remains after this is the portal invite control, lead/reservation attribution, comms and clawback — listed at the bottom, and the backlog row stays unticked until they land.

**Built — the trigger.** `provisionMoveIn` calls `qualifyReferral` after its transaction commits. That is §4's signal exactly: "a referral qualifies when the referee's move-in is complete AND their first payment has cleared", and provisioning is the one point where both are true. Outside the transaction and unable to fail it, per FR-4.6 and §5.4's "a refused referral never silently drops — the referee's move-in completes at the standard rate with the reason logged."

**Decided — the referral rides on the checkout session, not the cookie.** `provisionMoveIn` runs from the Stripe webhook as often as from the browser, and a webhook has no cookies. Reading the cookie at provisioning time would have attributed referrals only when the renter still had the tab open, which is the subset of move-ins least likely to need it. The `/rent` route reads the cookie once — the one point with both a request and the session about to exist — and snapshots the invite id, exactly as it already snapshots the promotion.

**Built — the money, through the existing path.** `lib/referrals/billing.ts` is deliberately the same shape as `lib/promotions/billing.ts`: answer what comes off this invoice, and record that it was applied inside the caller's transaction. §6.2 is explicit that there is no second discount mechanism. `buildInvoice` gained `extraDiscounts`, so a promotion and a referral reward each keep their **own line** — §5.5 makes that an acceptance criterion ("two separate discount lines with distinct descriptions, not one merged figure"), and each discount is capped by what is left after the ones before it, so the stack can never exceed the rent.

**Found — a real defect, and it was mine.** `generateInvoiceForPeriod` skipped any invoice whose **total** was zero. A referral reward larger than one month's rent takes the total to zero legitimately, so the invoice was skipped, `markReferralRewardApplied` never ran, and the reward would have been re-applied **in full, every month, forever**. The skip now tests the **subtotal**: a lease with nothing to charge is still skipped, but a lease with real charges that a credit happens to cover in full gets its invoice — which is also the invoice the tenant should be able to see, saying they owe nothing this month *because* of a credit. Found by the stack-cap test, which is the only place a discount legitimately equals the charges.

**Found — the trigger was imported and never called.** The insertion silently no-oped on a mismatched anchor, so `provisionMoveIn` imported `qualifyReferral` and did nothing with it. `npm run lint`'s unused-import warning caught it; the typecheck did not, and neither did any test, because nothing had asserted the trigger fires. There is now a test in `provision-db.test.ts` that drives a real session to provisioning and asserts the referral is earned and the invite consumed — the test that would have caught it.

**Test verification:** unit suite green, **2,903 passing** (up 5 from part 1 — four for the billing hand-off, one for the trigger), **run twice with identical results** per the shared-state rule. Typecheck and lint clean, back to the four pre-existing warnings. Full e2e green: **867 passed, 5 skipped, 0 failed of 872**, both projects.

**Still to build:** the portal invite control (§5.1 AC — minting has no UI, so no tenant can share anything yet), lead and reservation attribution (§5.3 — the cookie is set and read only by `/rent`), the four comms templates (§6.3), and clawback (§4.1).

## B-100 (part 3) — Referrals: the tenant's side, attribution, and the events

`32b724d`

**The backlog row is now ticked.** Parts 1–3 together cover everything the row lists. Two things from PRD 10 that the row does not list are deliberately left, and are named at the bottom with the item that should own them.

**Built — attribution (§5.3).** A lead captured while the referral cookie is present records the channel as **`referral_tenant`**, distinct from `referral` (a link from another website) because the two have completely different costs and the report exists to tell them apart. Applied *after* the ordinary derivation and unconditionally, which is FR-REF-3's "last-touch does not overwrite a referral" — a friend who clicks a tenant's link and later clicks an ad still pays the tenant, because the tenant did the work and the alternative teaches tenants the program does not work. The referral rides in its **own** cookie for exactly this reason: the touch cookie is rewritten every session by design, so storing the code there would have deleted the claim on the friend's second visit.

**Built — the tenant's side (§5.1, §5.2).** `/portal/refer` lists outstanding invites, each as **selectable text with its link**, plus the plain-language terms; minting is a form post, so the page works with the bundle disabled. `ShareInvite` layers §5.2's three-step degradation on top — native share sheet (which opens Messages on a phone), then clipboard, then the text that was already on the page.

**§5.2 is a permanent non-goal, and the code is shaped so it stays one.** There is no recipient field anywhere in this feature and there must never be: a "give us your friend's number and we'll text them" field makes *this business* the sender of an unsolicited commercial message to somebody who never consented — CAN-SPAM liability attaches to the sender, not to whoever typed the address, and as SMS it is a TCPA problem with statutory damages **per message**. The component carries that reasoning in full, because the field is the obvious next feature request and the comment is what should stop it.

**Built — the events (§6.3).** `referral.qualified` and `referral.refused` are in the catalog and emitted, the qualified one inside the transaction (an event for a referral that rolled back would tell two people about money nobody owes). The refusal carries the refusal **key**, not a rendered sentence, so the eventual message and the staff record can never disagree about the same refusal. A test pins both payloads.

**Decided — the four templates are NOT wired, and the reason is architectural rather than time.** The comms core resolves **one recipient per event** and then runs every applicable rule against it (`processCommsEvent`). §6.3 needs one referral to tell *two different people two different things*, which needs a recipient per **rule**, not per event. That is a change to the comms core, not a catalog entry, and doing it badly — two rules both resolving to the referrer — would send the referee's message to the wrong person. The events fire and no rule consumes them, which `processCommsEvent` handles as a clean no-op: it returns before resolving a recipient when no rule matches.

**Left behind, with the item that should own it:**
- **The four comms templates (§6.3)** — needs per-rule recipient resolution in the comms core first, as above. Natural home is **B-101**, which already opens the referral surfaces.
- **Clawback (§4.1)** — the refunded-payment reversal and the minimum-stay rule. `referralMinimumStayDays` is stored and has its control; nothing reads it yet. Not in the row's cited sections (§5.1/§5.3/§5.4/§5.5/§6), which is why it is not blocking the tick, but it is real money and should be its own row.

**Test verification:** unit suite green, **2,905 passing**. Typecheck and lint clean — six warnings, all the pre-existing `_prev`/`_formData` shape that every other server action in the codebase already carries. Full e2e green: **867 passed, 5 skipped, 0 failed of 872**, both projects.

## B-101 — Referral visibility, and the comms B-100 deferred

`a2947ab`

**Built — the four §6.3 templates, and a better answer than the one B-100 flagged.** B-100 left these deferred, saying the comms core needed per-**rule** recipient resolution. It does not. `processCommsEvent` resolves one recipient per **event**, so the fix is one event per recipient: `referral.qualified` to the referrer, `referral.reward_granted` to the referee, `referral.refused` to the referrer — each naming a `Tenant`, each reaching the existing resolver, each with exactly one rule. No change to the comms core at all, and it reads as a better model rather than a workaround, because they *are* three different facts. The clawback template has no trigger to fire it and is not seeded; clawback itself is still unbuilt (§4.1).

**Found — the merge-field registry caught a real gap.** `EVENT_MERGE_FIELDS` declares which fields each event can supply, and `checkPublishable` fails a template using one its event cannot. The three new templates used `referral.reward_line` and `referral.refusal_reason` before either was registered, and the build-time gate caught it — which is exactly the failure that would otherwise have surfaced as a send failing in production. The registry's own comment already said a field added to the extenders belongs there too; now it is.

**Found — a fixture without a phone number.** The refusal template requires `facility.phone` ("call us and we will go through it with you" is the point of that message), and FR-9 fails a render loudly rather than sending one with a hole in it. The test facility had none. That is the guard working; the fixture was wrong.

**Built — the portal list (§5.6).** A real `<table>` with `<th scope>`, which the row states as an acceptance criterion rather than a preference: a `<div>` grid gives a screen-reader user no way to associate a cell with its column, and this table's entire content is "which friend, what state, when". Every state is carried **in words** — never a coloured pill alone (1.4.1).

**Decided — the privacy shaping lives in the query, not the component.** §5.6 is emphatic that "the referee's identity beyond first name and initial is never shown — the referrer knowing their friend's unit number, balance or move-in date is a privacy leak the friend never agreed to." `referralsForTenant` selects the first and last name and nothing else, so the page cannot render what it was never given. A page that received the whole tenant row and displayed part of it is one refactor away from leaking the rest.

**Built — the staff view (§5.7)** on both tenant profiles, showing which side this tenant is on, the reward state, and **the rule that refused it** — the refusal sentence for reading aloud, and the rule's key beside it for matching against the PRD. The AC behind it is "a tenant asking 'why didn't I get my $50' must be answerable at the counter in one screen."

**Built — the revenue split (§5.7).** Referral rewards come out of the promotional-discount figure and get their own tile. "One is acquisition cost and the other is a price decision" — merged, neither question is answerable, and the referral number is specifically the one compared against the aggregator fee it displaces. Both are the same line *type* deliberately, because to billing they are the same thing: money off. The split is a reporting question, so it is done in the report, matched on a description prefix both the writer and the reader import from one place rather than two strings that can drift.

**`referral_tenant` in the funnel report** needed no change: the channel filter is derived from the data rather than a hardcoded list, so it appears as soon as a lead carries it — which B-100 wired.

**Left behind:** clawback (§4.1) — the refunded-payment reversal and the minimum-stay rule. `referralMinimumStayDays` is stored and has its control; nothing reads it. It is real money and belongs in its own row rather than smuggled into this one.

**Test verification:** unit suite green, **2,912 passing**, run twice with identical results. Typecheck, lint and the schema-drift check clean. Full e2e green: **867 passed, 5 skipped, 0 failed of 872**, both projects.

## B-108 — Staff MFA: a QR, a way to keep the recovery codes, and a sign-in that works from a bare /login

`f2a087f`

Three findings from the 2026-08-12 reviews, all in a shipped auth flow.

**(1) The QR.** `/mfa` showed a 32-character base32 key to type by hand. The `otpauth://` URI already existed as a link, but that only helps when the enrolling device *is* the phone — the ordinary case is a key on a laptop and an authenticator in a pocket. The same URI now renders as a QR beside the key.

**Decided — generated server-side and inlined, never fetchable.** The QR *encodes the shared secret*, and that one fact decides the shape: an endpoint that renders a QR for a pending enrolment hands out somebody's TOTP seed to whoever can guess the id, and puts it in access logs and CDN caches besides. It is computed during the render of the page that already holds the secret, never stored, never logged, and dies with the enrolment by construction. Inline SVG rather than a `data:` URI so it needs no `img-src data:` in the CSP.

**Decided — `alt=""`, and the criterion is 1.1.1 Level A rather than the AA the row first claimed.** The QR carries nothing the adjacent key does not — it *is* the key, in a form a camera reads — so the key is the text equivalent and the image is decorative. `alt="QR code"` would announce information it does not carry; `alt={uri}` would put the shared secret into the accessibility tree, into AT logs and into extension dumps, which is the exact surface the rest of this keeps it off.

**And the typed key was not yet an adequate equivalent.** `formatSecretForDisplay` groups base32 into pronounceable four-character blocks that VoiceOver reads as words, and `I`/`1`, `O`/`0`, `S`/`5` are indistinguishable by ear. It now pairs the grouped form (`aria-hidden`) with a character-separated `sr-only` reading, matching `gate-code-panel.tsx`. Without that the QR would have helped sighted staff and nobody else, inverting the reason for adding it.

**Decided — `qrcode-svg` over `qrcode`.** Zero dependencies against yargs, pngjs and dijkstrajs. On a surface that renders a shared TOTP secret, a smaller supply chain is worth more than a package shipping its own types; the type declaration is fifteen lines and declares only the options actually passed.

**Found, by writing the test rather than assuming:** two of my own claims were wrong. The "no fetchable URL" assertion tripped on the SVG's own `xmlns`, which is an identifier and not a request — narrowed to `href`/`src`/`xlink:href`, which is the property that actually matters. And the inlined SVG is ~41KB, not the ~12KB asserted: `join: true` does take it from 140KB to 41KB, and the rest is the honest price of not having a fetchable endpoint. Acceptable *here specifically* — `/mfa` is an admin-adjacent page a staff member sees once, not a public route with a performance budget — and the bound is now a regression guard against `join` being dropped rather than a target.

**(2) Recovery codes now have a way to be kept.** The copy said "this is the only time they are shown" and the screen offered no copy-all, no download, no print and no acknowledgement gate, while the codes lived in a client component's `useActionState` — a refresh, a Back or a stray click lost them permanently, and the recovery path from there is an administrator reset on a product with one owner account. Copy-all, download and print, with "Copied" announced from a pre-mounted region, and an "I have saved these codes" checkbox that gates the way onward. Identical treatment on regenerate, which is the path somebody reaches having *already* lost a set.

**Decided — the download is a Blob built in the page.** A "download" that round-tripped through the server would put ten working credentials in an access log, which is the failure the whole screen exists to prevent. Nothing here logs a code.

**Decided — `detailsAs` opts a form in rather than changing every form returning `details`.** Most of them show a summary nobody needs to save; recovery codes are the one case where the list is a credential.

**(3) The sign-in form inferred its audience from `?from=`.** The second-factor field keyed off `audienceFor`, which defaults to **tenant** when there is no hint — so an enrolled staff member reaching a bare `/login` (a bookmark, a typed address, a sign-out) got no code field, submitted without one, and was refused. That is the "correct password rejected" symptom D-47 exists to kill, arriving by a different route.

**Decided — always render it, which is the shape the row offered and this is the one taken.** The field shows unless `?from=` positively says tenant. The alternative — a two-step "email, then code" — would turn every sign-in into two round trips, which B-079's own comment already rejects. It leaks nothing: the form is identical whether or not the address exists, is staff, or has MFA enrolled. *Reveal-on-demand* would have been the enumeration risk, which is why that is not what "always render" means here.

**And the magic-link disclosure now states the rule as a general fact (D-40).** It is offered at a bare `/login`, so a staff member who used it was told a link was on its way that `flows.ts` will never mint. The sentence is true of staff accounts as a class and says nothing about whether the address in the box is one.

**Accessibility statement:** re-read. Nothing went stale — its staff-screens paragraph is still accurate, and its WCAG 2.1 AA claim already subsumes the 1.1.1 Level A obligation this item is held to.

**Test verification:** unit suite green, **2,917 passing** (up 5 — the QR's security properties, its one-path collapse, and that the grouped key is not an adequate spoken equivalent). Typecheck and lint clean.

## B-106 (part 1 of 2) — Future-dated move-ins

`c557926`

**Half the row, and the backlog row stays unticked.** B-106 bundles future-dating with multi-unit checkout; the owner chose to take them separately because multi-unit restructures the basket, the lock and provisioning all at once and every intermediate state of that is on the path that takes money. Future-dating is genuinely separable — one nullable column, no basket changes — so the checkout stays coherent at every commit. Multi-unit is next and is the larger half.

**Built:** a checkout can now be scheduled for a future date. The unit step's move-in date was fixed text reading "today"; it is an `<input type="date">` bounded by the facility's own window, and `provisionMoveIn` and the signed lease both honour it.

**Decided — a separate setting from the free-hold cap, not a shared number.** `Facility.maxCheckoutStartDaysAhead` (default 60) sits beside B-126's `reservationHoldGraceDays` and deliberately does not share it. The two limits exist for opposite reasons: a free hold ties up a rentable unit for nothing, so its horizon is short and bounds the exposure; a future-dated checkout is **paid**, so nothing is being held for free and the business carries no risk by scheduling further out. One number would force the cautious limit onto the case that does not need it. Its control ships in this item, per the repo's own rule.

**Decided — D-27 is what makes this simple rather than a proration problem.** Under anniversary billing the move-in payment buys a full period *starting that day*, so a future start just moves which day that is: the renter pays now for a month beginning later, and every invoice after it anchors to the same anniversary. No proration branch was needed.

**Found — a real off-by-one I would have shipped.** `requestedStartDate` is stored as UTC-midnight of the facility-local day, which is the same convention `businessDateFor` *returns*. Passing it through `businessDateFor` again is a second conversion, and for any facility west of UTC it lands on the previous day — a renter picking the 20th at a Chicago site got a lease billing on the **19th, every month, for the life of the lease**. Caught by the test asserting the billing anniversary, which is the only place the off-by-one is visible; the lease's own `startDate` looked right.

**Found — the same class of bug in the signed lease.** `leaseValuesFor` hardcoded `new Date()`, so a future-dated checkout would have produced a **signed contract stating the wrong start date and the wrong first-payment period** — on the one artefact whose entire purpose is recording what the tenant agreed to. It now reads the chosen date, and renders it in UTC rather than the facility timezone, because a calendar day stored at UTC-midnight prints as the day before when projected into a western zone.

**Decided — every refusal names the date to use (3.3.3).** The row states it as an acceptance criterion, and `judgeStartDate` returns a `suggested` date on every failing branch — too early, too late, and unparseable. A message saying only "that date is not allowed" leaves the renter bisecting their way to a boundary they cannot see, on the screen before payment. A test asserts the suggestion is always inside the window, so acting on the message always resolves the error rather than producing the other one.

**Decided — manual text entry is judged, not assumed.** The row requires typing to work, so `min`/`max` on the picker are a convenience and never the enforcement; the server judges every submission, including something that is not a date at all.

**Also found — adding any dependency breaks esbuild in this repo.** `npm install qrcode-svg` (B-108) left `npm test` dying inside vite's config bundler with a stack that names neither cause; the real line, several frames down, claims esbuild was installed for another platform, which is false. `allowScripts` gates the postinstall that puts the platform binary where the JS wrapper looks. `npm rebuild esbuild` fixes it in seconds — now recorded in CLAUDE.md, since it cost this item its first ten minutes and will recur for the next person adding a package.

**Left for part 2:** multi-unit rental in one checkout — the basket, one lock/warning/extension covering it, per-unit itemisation and change notes naming which unit moved the total, per-unit `<fieldset>` grouping so N "Remove" controls do not share an accessible name, and N leases at provisioning.

**Test verification:** unit suite green, **2,928 passing** (up 11 — nine for the window and its suggestions, two for the date reaching the lease and its anniversary). Typecheck and lint clean. Full e2e green: **871 passed, 5 skipped, 0 failed of 876**, both projects.

## B-106 (part 2 of 3) — The checkout basket, with one line in it

`cf24da6`

**A refactor that changes no behaviour, and that is the whole point.** Multi-unit needs a basket, a lock covering it, per-unit pricing, per-unit UI and N leases at provisioning. Landing those together would put an untested multi-unit path on the route that takes money. So this part introduces the basket, migrates every read onto it, and keeps **exactly one line per session** — behaviour identical to before, provably, because the full sweep is unchanged. Part 3 makes N > 1 possible, which is then a UI change on a foundation the suite already exercises.

**Built:** `CheckoutSessionUnit` — which type, which physical unit, what rate was locked, per line. A table rather than more columns because those three things have to vary *together*: a basket of two 10x10s at different rates is unrepresentable otherwise. `startCheckout` creates the line with the session; `amountDueToday` sums the basket instead of reading the session's single rate.

**Decided — the migration backfills every session, not just live ones.** A completed session is the historical record of what somebody rented, and code reading the basket has to find the same answer there as the old columns gave, or a confirmation page for last month's checkout shows an empty basket. The backfill was written into the migration **before** applying it, per this repo's own rule about appending SQL to an already-applied migration.

**Decided — the session keeps `unitId`/`unitTypeId`/`quotedRateCents` for now.** Redemption and reporting join on those columns. Keeping them in step with the single basket line is what makes this a no-behaviour-change refactor; retiring them belongs in the part that makes N > 1 possible, where every reader has to be revisited anyway.

**Decided — `toView` falls back to a line built from the session's own columns.** Not defensive padding: `advance` and `goBack` update and return the row without re-selecting relations, so a basket that vanished on a step transition would empty the price summary mid-checkout. The fallback reconstructs the same single line the backfill wrote, so it can only ever agree with it.

**Decided — the admin fee is charged once for the checkout, not per unit.** The fee is for opening an account, not for each door; a two-unit rental paying two account-opening fees is not what any facility means by it. Tax follows the summed rent, which `calculateMoveInCost` already handles. Both are pinned by tests that price a two-line basket.

**Found — the repo-root typecheck blind spot cost something again.** `tests/checkout-payment-db.test.ts` builds a `CheckoutSessionView` by hand and was missing the new required field; `npm run typecheck` did not notice, because `apps/web/tsconfig.json`'s `include` covers only `apps/web/**` and the root `tests/` directory is outside it. Documented in B-119 as a known gap and still unfixed — it is now the second item to pay for it, and the fixture's basket derives from its own rate so a test overriding one cannot end up asserting against a figure no real session could produce.

**Found — a schema invariant caught the new table.** Every facility-bound model must carry `facilityId`; `CheckoutSessionUnit` does not, and correctly so — it is scoped through the session that owns it, and a copy on each line could disagree with it. Added to the exemption list *with its reason*, which is the convention that list exists to enforce.

**Left for part 3:** the UI and the rest of the money path — adding and removing units, one lock/warning/extension covering the basket, per-unit itemisation in the price summary with a change note naming **which** unit moved the total, per-unit `<fieldset>` grouping so N "Remove" controls do not share an accessible name, N leases at provisioning, and a lease document covering the basket.

**Test verification:** unit suite green, **2,930 passing** (up 2 — the basket summing to more than one line, and the admin fee not multiplying). Typecheck, lint and the schema-drift check clean. Full e2e green: **871 passed, 5 skipped, 0 failed of 876** — identical to part 1, which is the assertion that matters for a refactor.

## B-106 (part 3 of 4) — Provisioning N leases

`820dd5a`

**The money path can now complete a multi-unit checkout; the UI still cannot start one.** That ordering is deliberate and is the reason this is its own part: a UI that lets a renter build a two-unit basket against provisioning that creates one lease would charge for two units and hand over one, with no record of the second and no way back. Provisioning goes first, proven by tests that build a two-line basket directly.

**Built:** `provisionMoveIn` creates **one lease per basket line**, in one transaction. All or nothing, deliberately — "paid for two, holds two" or "paid for nothing" are the only outcomes, because the alternative leaves somebody charged for something they do not hold and a reconciliation that means reading a payment against a basket nobody recorded. Each lease carries the rate **its own line** locked, which is the whole reason the basket holds a rate per line. Every unit's status is recomputed, not just the first — a unit that missed it stays `available` and the public site keeps selling a rented door.

**Decided — idempotency is checked across the whole basket.** "Does this tenant already hold a live lease on ANY unit in this basket" rather than on the first: if provisioning ran, every line has one, and if it half-ran the transaction rolled it all back, so there is no partial state a redelivered webhook could find.

**Decided — the move-in charge is apportioned, not dumped on the first lease.** Each lease's ledger carries its own rent; the costs charged once for the transaction — admin fee, tax, protection — sit on the first. The parts still sum to exactly what was paid, and a test asserts that against `amountDueToday` rather than trusting the arithmetic. The alternative leaves a second lease with **no opening charge at all**: its ledger says it owes nothing for a period the renter has already paid for, and its first invoice arrives next month against a balance that never recorded the first.

**Named, not solved — protection on a multi-unit checkout.** The premium is chosen once and recorded against the first lease only. Charging one premium and recording it against every lease would misstate what each unit is covered for; charging N would bill for cover the renter never agreed to. Neither is right, and which one is depends on a product decision nobody has made — the protection step asks about "your things", not "each unit". It is harmless today because no UI can produce N > 1, and it is the first thing part 4 has to settle.

**Also unresolved for N > 1, and named for the same reason:** the signed lease document, the `lease.moved_in` event and the gate code all attach to the first lease. For a one-unit checkout — still every checkout the UI can produce — that is exactly what they meant before. For a basket they need a decision each: one document listing every unit or one per lease, one welcome naming all the units or N of them.

**Test verification:** unit suite green, **2,932 passing** (up 2 — a two-line basket producing two leases at their own rates with both units occupied and the ledger conserved, and idempotency holding across the basket). Typecheck and lint clean. Full e2e green: **870 passed, 6 skipped, 0 failed of 876**; the extra skip against part 2 is `admin-tasks`' documented once-per-day self-skip, not a regression.

**Left for part 4:** the UI — add and remove units, one lock/warning/extension covering the basket, per-unit itemisation with a change note naming which unit moved the total, per-unit `<fieldset>` grouping so N "Remove" controls do not share an accessible name — plus the protection and lease-document decisions above.

## B-106 (part 4 of 5) — One plan per unit, and access for every lease (D-52)

`e44c36a`

**The owner decision part 3 refused to guess at.** D-52: the protection tier a renter picks applies to **each** unit — N premiums, N coverage limits, one plan recorded against every lease. Each plan promises to cover "up to $X of your things" and a unit is the thing being covered; three units behind one $5,000 limit is under-cover the renter would discover at claim time, which is the worst possible moment. The alternative — one premium against the first lease — also left the other leases showing no protection at all on their own screens, so the record disagreed with what was sold.

**The cost of that decision is a price that multiplies**, so §6.4 makes disclosure a requirement rather than a nicety: the protection line names the multiplication (`Protection plan — 3 units × 12.00`) instead of leaving a renter to divide the number themselves. Rejected for now, and recorded as re-openable: a tier chosen *per unit*, which is more accurate still but adds a decision to the step B-112 deliberately shortened, for a case no renter can reach until the basket UI ships.

**Found — the renter could not have opened the second unit.** Access credentials are per **lease**, and `requestDownstream` was called with the first lease only. A renter who paid for two units would have had a gate code for one — the same defect as not creating the second lease at all, arriving later and harder to diagnose. `provisionMoveIn` now returns every lease it created and both reconciler call sites issue access for each. The redelivery path returns the full list too, so a first attempt that committed and then failed downstream still gets every credential on the retry.

**Decided — `leaseId` stays alongside the new `leaseIds`.** The primary lease is what every single-lease consumer means — the confirmation page, the welcome message — and it is unchanged for a one-unit checkout, which is still every checkout the UI can produce. Adding the list rather than replacing the field keeps those honest instead of making each one pick an element.

**Still left for part 5, and unchanged from part 3's list:** the signed lease document, the `lease.moved_in` event and the gate-code message all attach to the primary lease. Each needs its own decision for a basket — one document listing every unit or one per lease, one welcome naming all of them or N.

**Test verification:** unit suite green, **2,933 passing** (up 1 — both leases carrying the tier and the premium, and every lease id returned). Typecheck and lint clean. Full e2e green: **870 passed, 6 skipped, 0 failed of 876** — unchanged.

**Left for part 5:** the UI. Add and remove units, one lock/warning/extension covering the basket, per-unit itemisation with a change note naming which unit moved the total, and per-unit `<fieldset>` grouping so N "Remove" controls do not share an accessible name.

## Chore — `tests/` and `e2e/` were typechecked by nothing

`1e64444`

**Not a backlog row.** A gap that two items had already paid for, closed before it charged a third.

**Found:** `apps/web/tsconfig.json` lives in `apps/web`, so its `include` covers `apps/web/**` and stops there. The repo-root `tests/` and `e2e/` directories — 55 test files and every spec — were outside every TypeScript program in the repo. `npm run typecheck` did not read them, so neither did CI. Vitest and Playwright each transpile a file at a time without checking types *across* files, which is why a green suite proved nothing about them: a test could import a name that did not exist and only fail at runtime, if that line ever ran.

**It had already cost two items.** B-119 shipped a spec missing its `AxeBuilder` import, which surfaced as a runtime `ReferenceError` under Playwright rather than as a compile error. B-106 part 2 shipped a fixture silently short a newly-required field. Two separate items paying for the same missing check is what made it worth its own config rather than a third patch.

**Built:** `tsconfig.tests.json` at the repo root, covering `tests/`, `e2e/`, `scripts/` and the app's ambient type declarations, wired into `npm run typecheck` so CI enforces it. Deliberately a second project rather than a widened `include` on the app's — pulling tests into the Next.js program would put them in the build graph, and that config carries Next-specific plugins and `.next/types` globs that mean nothing here.

**Turning it on found 28 errors already in the tree.** Most were one mechanical shape: `permissions: new Set(...)` inferring `Set<string>` where `Assignment` wants `Set<PermissionKey>`, across 51 files. Three were not mechanical, and are the reason this was worth doing:

- **A step demanding a proof field that does not exist.** `tests/active-duty-scra-db.test.ts` built a delinquency timeline whose overlock step required `lock_serial` — never a member of `PROOF_FIELDS`. It survived because the field is stored as JSON and nothing at runtime checks membership. Harmless in that test only because the SCRA hold halts the engine before the step runs; a test that *did* reach it would have asserted against proof the product cannot collect. Now `photo_reference`, matching the product's own default overlock step.
- **An `Actor` fixture reaching through a union it had not narrowed.** `assignments` exists on one branch of `Actor`; the helper declared the whole union and every call site indexed into `.assignments[0]` anyway. Fixed at the helper — `Extract<Actor, { kind: 'staff' }>` — rather than at each call site.
- **Three tests asserting on properties of a branch they had not checked.** `verifyTotp(...).reason`, `fieldError(...).message` and `bootstrapOwner(...).existingEmail` each read a field that exists on only one arm of a result union. Narrowed rather than cast: asserting `reason` without first asserting `ok === false` is how a test keeps passing if the function starts *succeeding* on malformed input.

**Decided — narrow, never cast.** Every fix above asserts the branch it then reads. A `as` would have made the same 28 errors disappear in a fraction of the time and left the tests exactly as blind as they were, which is the whole thing this config exists to stop.

**Also removed:** a `status: 'inactive'` field two `facility-settings-db` tests passed to `FacilityDetailsInput`, which has never had that field and whose updater has never written one. Both tests assert a `ForbiddenError`, so the field was inert — checked before deleting, rather than assumed.

**Test verification:** unit suite green, **2,933 passing, 8 skipped of 2,941** — identical to the count before, so no test was lost or disabled to make the types pass. Typecheck clean across both projects; lint 0 errors.

Full e2e green against a production build: **870 passed, 6 skipped, 0 failed, 0 flaky of 876** — unchanged from B-106 part 4, which is the point: this closed a hole in the checking, it did not change what the code does.

**Left behind:** `apps/web/tsconfig.json` and `tsconfig.tests.json` now state their compiler options separately rather than sharing a base. Two small duplicated blocks beat a third config for two consumers; if a third program ever appears, extract the base then.

## B-106 (part 5 of 5) — The basket becomes editable, and three decisions land (D-53, D-54, D-55)

`1104766`

**The last part of the invasive row.** Parts 1–4 built the machinery — a start-date window, a basket table, per-line leases, per-unit protection — with no UI able to produce more than one unit. This gives it one, and settles the three questions parts 3 and 4 deliberately refused to guess at.

**Built — add and remove units, on the step that already confirms one.** `addUnitToBasket` claims a unit the same way a reservation does (`FOR UPDATE SKIP LOCKED`) and prices it from the **published** `UnitTypeRate`, never from the form: a price the browser can name is a price the browser can choose. `removeUnitFromBasket` puts the unit straight back on sale and refuses to empty the basket. Both renew the session's single lock, because **one lock covers the whole basket** — the row is explicit that N independent countdowns cannot satisfy 2.2.1 in any usable way, and the lock has lived on the session since B-020, so this was already true and is now asserted.

**Decided — D-54, one gate code per tenant per facility.** `AccessGrant` has been keyed `(facilityId, tenantId)` since PRD 03, so B-106 part 4's per-lease credentials minted three PINs against one grant: three codes opening the same gate with identical permissions and identical hours. The idempotency check moved from the lease to the grant. `codeForLease` now resolves through the lease to the tenant's grant, because the portal calls it per lease and a second unit would otherwise show "your code will be texted to you" for a code already in the renter's hand. **This part is smaller than part 4 — the fix removes code.**

**Decided — D-53, one agreement per unit, one signature.** The enforceable object here is the `Lease` row and it is per unit: delinquency, overlock, lien notices and auction all key on a lease. A single combined agreement would mean auctioning one unit cites a document covering the units the tenant still rents. Documents are keyed on the basket LINE (`subjectType: 'CheckoutSessionUnit'`) rather than the session, so removing a line and adding another does not inherit the removed unit's agreement, and `signLeaseAction` signs every one of them in a single action — treating `already_signed` as success for the set, so a renter who signed two of three and hit a transport error can press the button again instead of being told their lease is already signed with one unit unsigned.

**Decided — D-55, one welcome naming every unit.** Provisioning already emitted ONE `lease.moved_in` for the checkout, so the shape was right and the message was wrong: it named only the primary unit. A `unit.number_list` merge field reads "A-12" for one unit and "A-12, B-04 and C-11" for three. It resolves through the BASKET rather than through the leases, because a `Lease` carries no checkout id — `CheckoutSessionUnit` is the only record of which units were bought together.

**Found — a basket-held unit stayed on sale.** `occupancyFactsFor` read `checkoutSession.unitId`, which is the session's ONE primary unit. Every unit added to a basket was invisible to it, so it stayed `available` and the public site went on selling a unit somebody was part-way through paying for — the overselling failure the 30-minute lock exists to prevent, arriving through a door the lock did not cover. Fixed at `occupancyFactsFor` rather than at the call site, so every caller — availability, the unit list, `claimUnit` — gets it. Caught by an assertion that both units leave the shelf, not by review.

**Found — two elements sharing one accessible name, in this item's own new markup.** The "Add another unit" form and its size `<select>` both answered to that name. That is the same 4.1.2 defect the row calls out for the Remove controls, introduced while fixing it. The axe scan in the new e2e spec caught it; the select is now "Size to add".

**Found — the per-unit itemisation was invalid list markup.** The first version nested a `<dl>` inside a `<dl>` and put a `<p>` directly in one. axe named both. The breakdown is now further `<dt>`/`<dd>` groups in the same list, indented, so a screen-reader user meets the rent total and then its parts rather than two unrelated lists of numbers.

**Decided — the price summary takes the LINES, not a pre-summed total.** It was handed the session's single `quotedRateCents` and one unit's street rate, so a two-unit basket would have advertised one unit's rent one screen before charging for two. It now derives both totals from the same list `amountDueToday` sums, and multiplies the protection premium itself — so D-52's "× N" disclosure and the figure it explains cannot come apart. US-301 makes that disagreement release-blocking, which is why the summary derives rather than receives.

**Accessibility, on the criteria the row names.** Each unit is a labelled region and each Remove control's VISIBLE text carries its unit number — not an `aria-label` saying more than the button reads, which is what breaks voice control (2.5.3). The remove control is withheld, not disabled, when one unit is left, and the server refuses it too. One move-in date for the basket, not one per unit. The change note names WHICH unit moved the total (§6.4), and it is the same string the action returns, so what a screen-reader user hears and what a sighted user reads under the total are one sentence.

**Also fixed — a fixture that had been incoherent since before this item.** `checkout-consent-db`'s lease fixture repointed `CheckoutSession.unitId` at a hand-made unit while the CLAIMED unit stayed in the basket. `unitId` is unique, so the next `claimUnit` picked a unit an older session still named and the insert collided. Invisible until the occupancy fix stopped handing out basket-held units.

## B-107 — The search results grow a map, and the list stays the product (D-56)

`b4b40a2`

**The map is decoration over a page that already worked.** PRD 01 §6.8 asks for "map views have list equivalents"; the row asks for the inverse emphasis, and that is what shipped — the list is the view, the map is a collapsed `<details>` underneath it, and a renter who never opens it is served a page identical to yesterday's.

**Built — one component, one condition, no new surface.** `components/site/results-map.tsx` renders nothing unless BOTH `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` are configured, which today they are not: production has no key, so the search page is byte-for-byte what it was. That absence is the intended degraded state and it is written down in `.env.example` as such, not left to be inferred from a blank screen. `use-my-location.tsx` was reused exactly as the row demands — it needed no change, because it was already on this page.

**Decided — D-56, `AdvancedMarkerElement` and the second public value it costs.** The deprecated `google.maps.Marker` would have saved an environment variable and cost all three of the row's marker criteria at once: its `label` is the vendor's own text box, so a price bubble drawn that way cannot be a link, cannot be given a contrast ratio we choose, and cannot enter the tab order. `AdvancedMarkerElement` content is ordinary DOM, so each bubble is simply an `<a>` — 1.4.11, 2.1.1 and the no-hover rule are satisfied by the platform rather than by a workaround. The map ID is public, is not a secret, and is created in the same console as the key.

**Decided — the vendor script loads on first open, never on page load.** It is billed per load and it is third-party. Nobody who leaves the map collapsed should pay for either, and a closed `<details>` keeps it out of the tab order at the same time — the same two-reasons-one-fix argument the facility page's embed already makes.

**Accessibility, on the criteria the row names.** `gestureHandling: 'cooperative'` is 2.1.2 in practice: a plain wheel scroll pages the document as it always did, and zooming takes a deliberate ctrl/⌘ or two fingers. The tile style is stated (`mapTypeId: 'roadmap'`, `mapTypeControl: false`) rather than left to the vendor, because a satellite or terrain background is arbitrary imagery no marker colour can be guaranteed against. The bubbles use fixed `#1f2937` on white, not theme tokens — the tiles stay light in dark mode, so a bubble painted with `--foreground` would invert itself against a background that never moved. Pan and zoom announce the visible count from a region rendered at page load and sited OUTSIDE the `<details>`, because one that is `display:none` until it has text is announced about as reliably as one inserted with it.

**Found — the failure message was being said twice.** The first version rendered it as a paragraph inside the disclosure AND wrote it into the live region, so a screen-reader user would hear the sentence announced and then read it again. Caught by a strict-mode violation in this item's own new spec, not by review. The live region carries it alone now, and the empty grey box is hidden on failure rather than left looking like it is still loading.

**Found — an existing accessibility assertion covered one live region on a page that now has two.** `a11y.spec.ts`'s "live region exists before it has anything to say" used `page.locator('[role="status"]')`, which was unambiguous only while the search page had exactly one. Widened to assert every region on the page is attached and empty, rather than scoped to the first — scoping it would have silently exempted every region added after it, which is the opposite of what that test is for.

**Also changed — `FacilityResult` keeps the coordinates it ranked by.** They were selected, used for the distance, and then dropped. Re-reading them for a second consumer is how a map and a list start disagreeing about where a facility is, so the map plots the same rows the list rendered and a unit test asserts they survive ranking.

**The public accessibility statement was re-verified, and the first draft of this item's own edit overstated it.** It claimed the search map's price markers are "ordinary links you can reach with the Tab key" — what the code intends, and what nobody has watched happen, because the map needs a key that is not configured and the e2e deliberately blocks the vendor script. That is precisely the sentence a demand letter quotes. It now says the map exists, says which half is ours, and records the live assessment as outstanding. `LAST_REVIEWED` moved to 17 August 2026; the rest of the page was checked against the build and is unchanged.

**Test verification:** unit suite **2,942 passing, 8 skipped of 2,950**; typecheck clean across both projects; lint 0 errors; `prisma migrate diff` reports no drift. Full e2e against a production build: **878 passed, 6 skipped, 0 failed, 0 flaky of 884** — reconciled, not just exit 0. The suite grew by 6 from HEAD's 878, which is three new specs across two device projects. Three new e2e specs cover our half of the map and nothing else — the toggle is present and collapsed with the list complete beside it, an aborted vendor script leaves the results intact (D-46's requirement), and axe finds nothing on the opened disclosure. All three abort `maps.googleapis.com` at the network layer or never need it, so no spec in this suite can go red for a firewall.

**Left behind:** the map has never been seen rendering. No key exists, so `fitBounds`, the marker bubbles, the cooperative gesture handling and the pan/zoom announcement are asserted by construction and by nothing else. The first session with a real key owes a manual pass, and these four specifically: keyboard-reach a price bubble and confirm it is a real tab stop; pan the map and confirm the count announcement fires; check bubble contrast against live tiles in both themes; and **close the disclosure and reopen it** — a Maps instance whose container was `display:none` is the classic source of grey tiles, and the modern API is supposed to self-heal via its own resize observer, which is a claim nobody here has watched hold. A guard was deliberately NOT written for it: untestable code for an unverifiable case is worse than a named gap. `@types/google.maps` was added as a devDependency so a wrong option name is a typecheck error rather than a silent no-op, which is the only substitute available until then.

**Found — the e2e suite could report a failed staff sign-in as a pass, and then blame 87 innocent specs.** This surfaced as a second full sweep going from 2 failures to 87, across admin, portal and POS specs that this item cannot reach, every one a 30-second timeout on an unrelated locator. The environment was ruled out on evidence rather than assumed: server alive on :3000, 48% memory available, `vm.memory_pressure` 0, and **no `JetsamEvent` file existed at all**. What the page snapshots actually showed was the sign-in page, and `e2e/.auth/owner.json` held three cookies with no session among them while the tenant's file held four.

**Cause: a TOTP code is single-use, and every code inside one 30-second window is the same code.** Two runs started inside one window present a code the first already spent, and the second is correctly rejected — the product working exactly as designed. `signInWithPassword` then let the rejection through, because it threw only on `status() >= 400` directly beneath a comment explaining that a rejection does not produce one. `storageState` saved the logged-out jar, and every spec that replayed it landed on `/login`.

Measured before the fix, four setup-only runs: `11:17:03` HAS_SESSION, `11:17:23` **NO_SESSION**, `11:17:52` HAS_SESSION, `11:18:19` HAS_SESSION — the only failure is the only run inside a predecessor's window, and it reported ✓✓.

**Fixed in two halves, because either alone is worse than useless.** The helper now asserts the outcome — the `storage.session` cookie is in the jar — rather than a status line that says the same thing for both outcomes; `SESSION_COOKIE` is exported from `auth.config.ts` so the name has one definition. And `establishOwnerSession` catches a rejection once, waits to the next window boundary, and presents the next code. A loud failure with no retry would just convert 87 confusing failures into a hard stop every time the sweep is run twice quickly, which is the normal local rhythm.

**Verified by forcing the collision, not by hoping for one.** Six consecutive cold runs all passed but all took ~29s, which is server startup — none of them actually collided, so they proved nothing about the retry. Against an already-running server the runs take seconds and collision is guaranteed: run 1 took **1s**, run 2 **14s**, run 3 **30s**, all three HAS_SESSION. Those two longer durations are the wait-to-the-next-boundary arithmetic; before the fix they would have been silent failures.

**One correction to the record.** B-106 part 5 reported the e2e total as "876, unchanged from B-106 part 4". The tree at that commit actually holds **878** — the number was carried forward rather than re-measured, which is exactly the failure mode a recorded count exists to prevent. Verified by listing the suite against a stashed working tree, not inferred from the delta.

## B-082 (part 1 of 6) — Marketplace attribution: the channel that bills per move-in stops reporting as organic (D-57)

`2a4a84d`

**B-082 is six deliverables and size L, so it is split.** Part 1 is the marketplace integration plumbing, chosen first for one reason: it is the only part whose absence corrupts data retroactively. City pages and a content hub can be built any week; a move-in credited to the wrong channel cannot be reconstructed later, because the evidence was never written down.

**The bug, found live in `provision.ts`.** `acquisitionSource: reservationSource ?? 'web'`, under a comment arguing the default is "a fact rather than a guess". It is — for the axis it measures. The problem was that there was only one axis. `acquisitionSource` answers **how the deal was taken** (web, phone, walk-in); nothing recorded **where the renter came from**. So a SpareFoot rental and an organic one were both `web`, and the only channel in this industry that charges *per completed move-in* was invisible in the report an owner uses to decide where to spend. The vocabulary to say it has existed since B-068 — `MARKETING_CHANNELS` contains `aggregator` and `AGGREGATOR_HOSTS` already detects SpareFoot and Storable referrers — nothing carried it past the `Lead`.

**Built — a second column, not more values in the first.** `Lease.acquisitionChannel` plus `acquisitionUtmSource/Medium/Campaign`, mirroring `Reservation.utm*`. Both axes are stamped at provisioning, and both are denormalised for the reason the original column already documents: the chain that knows the answer is three nullable joins long, so a report walking it under-counts exactly what it exists to measure.

**Decided — D-57, the lead's channel beats the checkout's cookie.** A renter who arrives from an aggregator, enquires, and returns a week later via Google is credited to `aggregator`. Last-touch is the usual default and it is wrong here for an industry-specific reason: aggregators invoice on *their* record of having delivered the renter. Crediting organic would mean paying SpareFoot out of a budget line saying SpareFoot produced nothing — the report and the invoice would disagree every month and the report would lose. With no lead the checkout's cookie is used; with neither the column is **null**, which reports as `unknown`. `organic` would be a fabricated answer, and fabricating credit for the channel under evaluation is the whole failure this item exists to prevent.

**Also fixed — the funnel event and the lease read attribution twice.** `trackingContext()` was called once before nothing and again after the transaction. Now read once, before, and used for both, so the channel on `move_in_completed` and the channel on the lease cannot disagree. That is a smaller diff than the shape it replaced.

**Found — the moves report computed a split nobody could see, on a screen that denied the data existed.** `bySource` has been returned by `moveCounts` since B-097 and rendered in exactly zero places, while `/admin/reports` carried a paragraph reading *"Move-ins aren't broken down by source yet — nothing records how a rental was acquired, so every one would read as unknown."* Untrue for months, on the screen where an operator decides what to keep paying for. Both splits are now rendered as two tables — deliberately two, because they are different questions and a reader who takes them for one breakdown will double-count — and the paragraph is gone. This is the same "a claim about the codebase goes stale on merges" failure the accessibility statement keeps catching, in a place nobody was checking.

**Built — the availability feed, where rate parity is structural.** `GET /api/public/marketplace/availability` lists every active facility from `publicInventoryForFacility`, the exact function that renders the facility page and answers the public inventory API. There is no second price to reconcile, so there is no parity job to write and none to forget to run: a rate cannot reach the feed without also being on the website. Unauthenticated on purpose — everything in it is already public — and it drops the quote token `PublicUnitType` carries, because a feed polled every few minutes would mint thousands nobody redeems.

**Built — lead attribution in, with the channel decided by the key.** `POST /api/public/marketplace/leads` resolves the partner from **which key authenticated**, never from the request body: attribution is what an aggregator invoices against, so a body that could name its own channel could name a competitor's. Keys compare in constant time over a digest, and the loop checks every candidate after a match rather than returning early — an early return puts back the timing oracle the constant-time compare removes. A missing or malformed `MARKETPLACE_LEAD_KEYS` authenticates nobody, rather than degrading to an empty key every caller matches. `captureLead` does the writing, exactly as for the public form, so dedup, consent, the drip sequence and every validation rule apply identically; a second lead-writing path is how two paths drift.

**Decided — the public form's per-IP rate limit does not apply to an authenticated partner.** Every lead from a marketplace arrives from one address, so the form's five-per-ten-minutes would reject the sixth genuine lead of any burst — silently losing rentals from the channel that charges most for them. The limit is an anti-bot measure for a public form; a partner is already bounded by holding a key we issued and can revoke. A test sends seven in a row.

**Test verification:** unit suite **2,958 passing, 8 skipped of 2,966** — reconciled as +16 on the previous 2,950: four metrics tests, two provisioning tests and ten marketplace tests. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift. The metrics tests include one asserting both splits total `moveIns` through a roll-up (a second accumulator is exactly where a total drifts) and one asserting `MOVE_CHANNELS` covers every `MARKETING_CHANNELS` value — `moves.ts` restates that vocabulary to stay dependency-free, and that duplication is only legitimate while a test proves the two agree. The provisioning test asserts the two axes **disagree** on a marketplace rental, which is the information a single column could not carry.

Full e2e against a production build: **883 passed, 5 skipped, 0 failed, 0 flaky of 888** — reconciled as +4 on B-107's 884, being two new specs across two device projects. Both go through real HTTP rather than calling the library: these are the routes a partner integrates against, and a handler that throws on a bad export is invisible to a unit test that imports the function directly. One asserts the feed's rate equals the public inventory API's for the same facility — parity proven end to end, not just by shared authorship — and one asserts the leads endpoint answers 401 identically to a missing key and a wrong key.

**Left behind:** parts 2–6 of B-082, listed on the row and unstarted — city pages, the MDX content hub, funnel reporting v2, Search Console, duplicate-content warnings. The feed does one inventory read per facility in parallel (~1.5s portfolio-wide behind a 5-minute edge cache), marked `ponytail:` with the upgrade path named as batching inside `publicInventoryForFacility` and explicitly **not** giving the feed its own query — that is how two prices start to differ. `MARKETPLACE_LEAD_KEYS` is an env var rather than a table because this is a handful of contract-negotiated partners; when an operator needs to self-serve one it earns a model, a screen and a permission.

## B-082 (part 2 of 6) — City pages: a URL that has been a 301 target and a 404 at the same time since B-066

`e77b611`

**The gap, found in `paths.ts`.** `/storage/{state}/{city}` has existed in the codebase since B-066 and has never rendered anything. `recordFacilityRetirement` points every retired facility's page at it (US-3 AC4's "301 to the nearest city page"), the facility page's `BreadcrumbList` names it, and `paths.ts` carried a comment reading *"B-071 builds the page itself"* — B-071 shipped **reviews**. Nothing caught it because nothing a person browses links there: it is reachable only from a redirect that has never fired and from structured data no human reads. The sitemap had the same shape a level down — it computed the city list, held it in a `Map`, and returned `[...staticEntries, ...facilityEntries]`, throwing the cities away with a comment explaining that listing them "would be inviting a crawl of a 404". That comment was correct and it stayed correct for months.

**Built — one page, two reads it already had.** `/storage/{state}/{city}` lists every active facility in the city with its starting price and its review average. Both come from batched helpers rather than a fan-out: `lowestAvailableWebRateByFacility` is the one the search results already use, and `visibleRatingsByFacility` is new beside it — one query for the whole list, averaging through `aggregateRating`, the same function the facility page rounds with. Two pages one click apart showing 4.8 and 4.75 for one facility is the drift that reuse prevents. Cheapest-first, with nothing-rentable last rather than hidden: a full site is still a site to call, and dropping it tells somebody the city has fewer locations than it does.

**Decided — D-58, the intro copy is generated, and there is no `City` model.** AC1 asks for "unique intro copy per city" and the obvious reading is a text field. The house rule cuts the other way and has already been paid for twice — the facility page's FAQs and its JSON-LD are generated *because* copy typed once drifts from the hours, the prices and the amenities it describes. Every sentence here is derived from the facilities: the count, the names, the price floor, the amenity set. What it costs is that the wording is templated, so this is thin-content protection at the floor and not a marketing asset. The alternative was a model, a migration, an admin screen and a permission — and a nullable `cityCopy` column reachable only from a database client is exactly what this repo's own rule about behaviour-configuring columns forbids.

**Decided — D-59, no distance, because there is no origin.** AC1 lists distance beside price and rating. A city page is reached without anybody naming a location, so the only way to print one is to measure from a centroid the renter has never heard of — a number that looks measured, and is wrong for every reader by a different amount. The list is ordered by price instead, which is the question somebody who has already chosen the city is asking, and the page carries the same `FacilitySearchForm` the homepage uses. Distance is honest one click away, where the renter supplied the point.

**Found while reading the rendered page — the amenity section was the card's own pills, printed twice.** With one facility in a city, "What you will find in Austin" reproduced the three pills from the card twenty lines above it. That is padding, and padding is the thin content the unique-copy requirement is about; the section now renders only above one facility. Caught by looking at the real HTML, not by a test — every assertion passed either way.

**Structured data is built from the array the page renders**, not from a second query: the `ItemList`'s items are the facility links, and an e2e spec parses the JSON-LD out of the DOM and asserts every URL in it is a visible link in `<main>`. Markup describing a list the reader is not looking at is the specific failure that gets penalised, and shared authorship is not proof against it.

**AC1's "indexable only when ≥1 facility exists" is a 404, not a `noindex`.** A city with no facilities has nothing to say; a 200 with nothing on it is the shape a crawler judges the rest of the site by. The sitemap and the page both read `citiesWithFacilities`, so the sitemap cannot advertise a URL the page refuses — and an e2e spec walks every city URL in the live `sitemap.xml` and asserts a 200, which is the pairing rather than either half.

**The public accessibility statement was re-read and needed no change.** This item ships a customer-facing page, so the check ran: the city page is keyboard-operable with no new interaction pattern, carries no map, reuses the search form verbatim, and — the part that matters for the "automated tests run on every change" claim — it was added to `a11y.spec.ts`'s `PUBLIC_ROUTES`, whose own comment says a page not on that list is a page nobody checks. Every sentence on the statement was already true of it, which is the only reason it was left alone.

**Test verification:** unit suite **2,985 passing, 8 skipped of 2,993**. Reconciled as +27 on the previous 2,966, and the baseline was **re-measured against a stashed tree rather than carried forward** — 14 copy tests, 11 database tests, and **2 the tree generated on its own**: `no-internal-identifiers.test.ts` enumerates customer-reachable page files, so a new page adds a backlog-ID scan and a decision-ID scan without anybody writing them. Typecheck clean across both projects, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **900 passed, 6 skipped, 0 failed, 0 flaky of 906** — reconciled as +18 on part 1's 888, being five new smoke specs across two device projects plus four a11y checks (axe, reflow, 200% zoom, text spacing) across two. The extra skip is `admin-tasks`' returned-mail flow self-skipping on both projects rather than one, which is the documented idempotent-per-day behaviour, not a regression.

**Left behind:** parts 3–6 of B-082, listed on the row and unstarted. **The multi-facility city page has never been rendered** — the demo seed has exactly one facility per city (Austin, Dallas, Houston) and adding a second to Austin would perturb the 78704 search-ranking assertions the seed's own comment warns about, so the plural intro copy, the pooled amenity section and the cheapest-first ordering are covered by unit tests against fixtures and by nothing in the browser. `facilitiesInCity` reads every active facility in the state and filters by slug in JS rather than in SQL, because only `citySlug` knows how to turn "Fort Worth" into "fort-worth" and a hand-written `ILIKE` would be a fifth opinion about that; at a few hundred facilities that is one indexed read, and the upgrade — a stored slug column with a unique index — is worth taking when the state query stops being small. There is still no `/storage/{state}` page, so the state segment is a path component nobody can land on.

## B-082 (part 3 of 6) — The guides content hub, and two ways a carried filter was about to disappear

`af69ef6`

**Owner decision taken before any code: MDX, as PRD 04 specifies.** PRD 04 names it twice — US-4 AC2 and the non-goals line, *"the Phase 2 content hub is a simple markdown/MDX-backed system, not a headless CMS integration"* — while this repo's convention runs the other way, since `size-guide`, `defaultFacilityFaqs` and `GBP_CHECKLIST` are all content-as-typed-data with no dependencies. Overriding written PRD text needs a D-number rather than a unilateral call, so it was asked. Three dependencies (`@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`) and `npm rebuild esbuild` after, per the trap this file's own CLAUDE.md documents.

**Built — prose in MDX, everything a machine reads in TypeScript.** `content/guides/*.mdx` holds the words; `lib/guides/catalog.ts` holds the headline, description, both dates, the CTA filter and the FAQ. That split is the whole design: frontmatter lets a guide ship without the fields `Article` needs and fail silently as *absent markup*, whereas a missing field in the catalog is a build error. `pageExtensions` is deliberately not extended with `mdx` — a `.mdx` under `app/` would become a route on its own, and a guide is not just its prose.

**Decided — D-60, the size guide stays at `/storage/size-guide`.** AC2's launch set is five and the fifth already existed. Both ways of making the set look uniform are worse than the asymmetry: copying its text creates two indexable pages with the same content — the duplicate-content problem this row's own part 6 exists to detect, self-inflicted, on the page in the set most likely to rank — and moving it means a 301 on a URL in the sitemap and linked from every facility, search and city page, to buy a tidier URL nobody will notice. That is the identical trade D-32 already refused. An e2e assertion pins the hub's href to `/storage/size-guide` so a later session cannot "fix" the inconsistency by copying the text.

**Found — the search form would have dropped the filter it had just promised to carry.** AC3's CTA sends a reader to the search holding `?features=climate`. The search box is a GET form, and **a GET form replaces the whole query string** — so typing a zip and pressing Find storage discarded it, silently, one click after the page said it was being carried. This is the same trap B-122's promo box documents on the facility page, in a component nobody had had reason to look at. `FacilitySearchForm` now takes `carry` and renders it as hidden inputs; `UseMyLocation` takes it too, because that button builds its destination from scratch and would otherwise have dropped it as well — two routes to the same results page behaving differently is worse than either behaviour alone.

**Found — the filter was travelling invisibly.** The e2e for the CTA chain failed at first for the right reason: the CTA cannot know where the reader is, so it lands on an *empty* search, and nothing on that page mentioned climate again until a facility opened with a checkbox mysteriously ticked. The page now says which filter it is holding and what it will do with it. The fix was to the page, not to the test.

**Corrected — part 2's claim that this app has no middleware, which is wrong.** It has `apps/web/proxy.ts`, Next 16's name for it, and it already lower-cases the path, strips trailing slashes and sorts query parameters site-wide. Two consequences. The comment in the city page was false and is rewritten to say which layer catches what. And part 2's `a non-canonical city URL redirects to the canonical one` was **passing for the wrong reason** — `/storage/TX/AUSTIN` never reaches the page at all — so it now also asserts `/storage/tx/austin--`, which the proxy passes through untouched and only the page can catch. Found by curling a URL and getting a 308 nobody had predicted.

**AC3's CTA points at the search, not a facility**, for the same reason the city page prints no distance (D-59): "nearest" needs a location a guide page does not have. `GuideFilter` is typed against `SIZE_BANDS` and `FEATURE_FILTERS`, so a CTA cannot name `?size=extra-large` — a URL that renders a facility page with the filter silently ignored, which is indistinguishable from a working link until somebody counts conversions.

**Accessibility, and why the public statement did not change.** The MDX component mapping renders no `h1` at all — the page frame owns the only one — and a unit test asserts no guide's markdown starts a heading with `#`, because all four guides share one mapping and a second `h1` would break every outline at once. `/guides`, `/guides/climate-control` and `/guides/packing-tips` are all in `a11y.spec.ts`'s `PUBLIC_ROUTES`, whose comment says a page not on that list is a page nobody checks; the third is the same template with the FAQ and the filter label absent, which is where a heading is most likely to be orphaned. The `Guides` header link is deliberately not `sm:`-only — a nav item that vanishes on reflow is the thing 1.4.10 is about, and the header is already `flex-wrap` for exactly this. The statement itself was re-read and left alone: the guides introduce no new interaction pattern, no map and no form, so every sentence on it was already true of them.

**Test verification:** unit suite **3,011 passing, 8 skipped of 3,019** — reconciled as +26 on 2,993: 22 guides tests and 4 the tree generates on its own, `no-internal-identifiers.test.ts` adding a backlog-ID and a decision-ID scan for each of the two new page files. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **934 passed, 6 skipped, 0 failed, 0 flaky of 940** — reconciled as +34 on part 2's 906, being five new smoke specs across two device projects and three new a11y routes at four checks each across two. The CTA spec walks the whole chain in one test — guide → search → facility — because each of the three holds a third of AC3 and all three passing separately would still let the middle be broken, which is precisely what happened.

**Left behind:** parts 4–6 of B-082 — funnel reporting v2, Search Console, duplicate-content warnings. No remark or rehype plugins are configured; every guide is written in this repo by somebody who can read the rendered page, and a plugin chain is machinery for content arriving from somewhere you cannot see. **Nobody outside this repo can publish a guide**: MDX buys prose-as-prose and the possibility of editing through GitHub's web UI, not a CMS, and PRD 04's non-goals say that is the intent. The four guides are unillustrated for the same reason `size-guide` is — nothing in this product stores an image with required alt text outside `FacilityPhoto`, and an `Article` naming an image that 404s is worse than one with no image. `dateModified` is typed by hand, so a guide edited without touching its `updated` field reports a stale date; that is the deliberate alternative to stamping build time, which trains crawlers to ignore the field.

## B-082 (part 4 of 6) — Funnel v2: a breakdown that foots, two sequences, and what each discount actually bought

`a48c41f`

**Found first — the source/medium filters had no controls, and had not since B-069.** `funnelReport` has accepted `utmSource` and `utmMedium` for as long as it has existed; `/admin/reports/funnel` passed only `channel`. This is the repo's own "a field that changes behaviour ships with its control" rule broken in a report rather than a form, which is why nothing caught it: no migration, no column, nothing to notice.

**Built — the funnel split by source/medium, and D-61 is why it can be trusted.** Every session is attributed ONCE, from its earliest event inside the range, and every step then classifies that session by the same answer. The alternative — attributing per event — double-counts: a session fires a tagged page view and later an untagged one, because the tags are on the landing URL and not on every request, so the same person appears under `google/cpc` in the sessions row and under untagged in the move-ins row. **A breakdown that does not foot is not a breakdown, it is a second set of numbers to reconcile**, and an owner deciding budget from it will quietly trust whichever half is larger. Both the unit test and an e2e assert the rendered columns add up to the funnel above them. First touch over last touch for the same reason D-57 chose the lead's channel over the checkout's cookie: the campaign that paid to bring somebody in is the one being evaluated.

**Built — sequence attribution as a catalog, not a second flag.** B-073 shipped one boolean on the move-in event and one sentence under the funnel. Part 4 makes it a list, adds the lead drip beside the abandonment follow-up (`dripStep` read on the lead query `provision.ts` already runs, not a second one), and renders every entry including the ones at zero — a missing row reads as "we do not measure that", a zero reads as "it did not work", and only one of those is true. **They are deliberately not mutually exclusive and the page says so in words**: one renter can be chased by the drip, abandon a checkout, and be brought back by the abandonment sequence, so the rows legitimately sum to more than the move-in total. Forcing one answer would mean inventing a precedence nobody asked for.

**Built — promo ROI, reading the record rather than the log.** `/admin/reports/promotions` reads `PromoRedemption`, which is the opposite of the funnel beside it and deliberately: the funnel measures *behaviour* and every step must come from one measurement, while this measures *money*, where the record is the truth. `PromoRedemption.totalCents` carries a comment saying it was denormalised "so ROI reporting does not have to walk the JSON of every redemption" — this is that reporting, and it uses it.

**The two-column split is the whole report.** Discount **given** is what has come off an invoice; **still to give** is what these redemptions promised and have not yet discounted. A "first month free, then half off two" promo commits three periods the day it is redeemed and realises one if the tenant leaves after five weeks. Reporting them as a single figure either overstates the cost of every short tenancy or understates the exposure of every promotion still running; both are true and neither alone is. Redemptions that never reached a lease are counted as redemptions and nowhere else — they cost nothing and bought nothing, and counting them as move-ins is the easiest way to make a promotion look better than it was. Only `active`, `delinquent` and `pending_auction` leases count as still renting: a `pending` lease has not started and lumping it in would flatter every promotion redeemed this week.

**Found and fixed — a filter applied by URL silently reported itself as unset.** The dropdowns are built from the values present in the range, so `?source=google` with no Google events in the window rendered as "Every source" **while the report underneath it was still filtered** and showed almost nothing. The control and the data disagreed, and the control is the half a person believes. It was already true of the `channel` filter B-069 shipped, so a bookmarked or shared filtered report has been lying since then. The applied value is now always in the options; picking "Every source" is how you clear it.

**Found, and fixed one part later — B-127, a deadlock on the referral race.** *(Recorded here as "not fixed" when part 4 shipped; part 5 fixed it after it reproduced again. See that entry.)* One full-suite run failed with `40P01 deadlock detected` in `qualifyReferral`, in code this item does not touch. It opens a transaction that INSERTs a `referral` — taking a shared FK lock on the `referral_invite` — and only then UPDATEs that same invite to claim it; two concurrent qualifications each hold the shared lock and each wait for the other, so **both roll back** and neither friend gets the invite. It reproduced once in four full-suite runs and zero times in three isolated ones, which is exactly the shape this codebase has learned to distrust: a race that "passes alone and on the next run" is the production bug as well as the flake. The fix is an ordering change — claim the invite first, create the referral second — and it is a money path in a different module, so it is B-127 with its own race test rather than a passenger on a reporting change.

**Also seeded — one redeemed promotion, `ended` and code-gated.** The ROI report had no populated table anywhere, so its columns were rendered by nothing and asserted by nothing. The demo seed now carries a past campaign with one of its two periods applied, which makes given and still-to-give both non-zero. Both halves of `ended` + `displayMode: 'code'` matter: an ACTIVE auto promo would put a badge and a changed price on the Austin facility page the smoke suite asserts totals against, which is the exact reason B-122's own seeded promo is code-gated, and no `PromoCode` row is created so there is no code a test could type to revive it.

**Test verification:** unit suite **3,038 passing, 8 skipped of 3,046** — reconciled as +27 on 3,019: 12 ROI arithmetic tests, 6 ROI database tests, 7 funnel tests, and 2 the tree generates for the new report page. **Run four times, not once**, because of the deadlock above: three consecutive clean runs after the one failure, and the baseline was measured on a stashed tree rather than carried forward. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **953 passed, 5 skipped, 0 failed, 0 flaky of 958** — reconciled as +18 on part 3's 940, being five new report specs across two device projects and one new admin a11y route at four checks each across two. One fewer skip than part 3, not one more test: `admin-tasks`' returned-mail flow ran instead of self-skipping, because re-seeding the e2e database for the ROI fixture put that flag back in its pre-action state — which is the self-skip working as documented rather than a test appearing from nowhere.

**Left behind:** parts 5–6 of B-082 — Search Console integration and duplicate-content warnings. **`promo_applied` and `review_request_click` are still fired nowhere**: both are in `ANALYTICS_EVENTS` from B-069 and neither has ever been emitted, so two of AC2's eight standard events are dead vocabulary. ROI deliberately does not use `promo_applied` — it would answer "how many people engaged with a promo", which is a different report — but the gap is B-069's and it is still open. The breakdown reads one extra row per session per range, marked `ponytail:` with a session dimension table as the upgrade and the trigger named. The ROI report has no CSV export, unlike the revenue and delinquency reports beside it; nothing has asked for one yet.

## B-082 (part 5 of 6) — Search Console: what Google has actually indexed, and the deadlock that stopped being deferrable

`40c8657`

**Scoped to indexation, not ranking.** PRD 04's Phase-2 line is "Search Console integration for **indexation monitoring**", and that is the narrower and more useful question: a facility page that is in our sitemap, returns 200 and is not in Google's index earns nothing, and there is no way to notice that from inside our own logs. Impressions and clicks are a different report; IndexNow and sitemap-ping automation stay Phase 3 (B-087).

**Built — three parts, and the URL list is not one of them.** The site-verification token goes in the root layout, a service-account client talks to `urlInspection.index.inspect`, and `/admin/reports/indexation` renders the result. The URLs come from calling `sitemap()` itself: this report exists to answer "has Google indexed what we told it to index", and asking about a different set would answer a question nobody has.

**Decided — no `googleapis`.** A service-account JWT is a signed JSON blob, and `node:crypto` signs it in fifteen lines. Pulling in a ~50MB dependency carrying every Google product to make two HTTP calls is the trade this repo's rules exist to refuse.

**Decided — deliberately no simulator, and this is the opposite of the gate hardware.** D-4 says gate work runs against a simulated adapter, and that is right, because a simulated gate is a device we control. A simulated *index status* is a claim about what **Google** has done with our pages, rendered on a screen an operator makes budget decisions from. Unconfigured shows no verdicts at all and names the three missing environment variables — the degraded state D-46 chose for the map, not the one D-4 chose for the gate. An e2e asserts the disconnected page contains no table and no "Indexed" text, because that is the state that actually ships.

**Decided — the verdict enum, never the English sentence.** Google's `coverageState` is free text it rewords without warning ("Submitted and indexed", "Crawled - currently not indexed"). Switching on it would break this report silently the next time somebody at Google edits a string, so the DECISION comes from `verdict`, which is an enum, and the sentence is kept verbatim for display — an operator searching Google's own documentation for the exact phrase should find it, which a paraphrase would prevent. `NEUTRAL`, `PARTIAL` and `FAIL` all collapse to "not indexed": they need the same action, and five shades of "not really" is a report nobody reads to the end. A failed page *fetch* is separated out, because that one is ours to repair.

**An empty verification tag is a failed verification, not an absent one.** `GOOGLE_SITE_VERIFICATION` unset emits no meta tag at all rather than `content=""` — the kind of thing somebody chases for an afternoon.

**Fixed — B-127, the referral deadlock, one part after deciding not to.** Part 4 found it and filed it as its own item on the grounds that it is a money path in another module. That judgement changed when it reproduced a second time: **two failures in six full-suite runs** would redden CI at random and made it impossible to report any suite honestly green, so the deferral was costing more than the fix.

`qualifyReferral` inserted the `referral` row — taking a **shared** FK lock on the `referral_invite` it points at — and only then updated that invite to claim it, wanting an **exclusive** lock. Two friends qualifying in the same instant each held the shared lock and each waited for the other to drop it: `40P01 deadlock detected`, and **both transactions rolled back**. Neither friend got the invite, and a $50 reward vanished with nothing recorded to explain it — exactly the outcome §6.1's conditional update exists to prevent, arrived at from the other side. Claiming first means both transactions take the same locks in the same order, which makes the deadlock impossible rather than unlikely. The loser is now created `refused` outright instead of created `earned` and downgraded a statement later, which also removes a moment where a $50 referral was visible inside the transaction.

**The race test went from two contenders to four, and that is the part worth keeping.** At two it caught this about one full-suite run in three and never in isolation; a guard that passes two times in three is not a guard. It now asserts one earned row, three refusals each with the honest reason, and that the invite's back-reference points at the winner. Strengthening it immediately failed on an assertion further down the same test that still expected a single loser — which is the test being right about the new shape, not the product being wrong.

**Test verification:** unit suite **3,054 passing, 8 skipped of 3,062** — reconciled as +16 on 3,046: 14 indexation tests and 2 the tree generates for the new report page. Run **seven times** across the fix, not once: 2 failures in 6 runs before, 0 in 7 after, plus 12 isolated runs of the referral suite. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **966 passed, 6 skipped, 0 failed, 0 flaky of 972** — reconciled as +14 on part 4's 958, being three new report specs across two device projects and one new admin a11y route at four checks each across two. The run took 4.6 minutes against the usual 1.6 on a machine at 40% available memory and non-zero pressure, with no stray runner and nothing on :3000 — slow, not sick, and checked before it was assumed.

**Left behind:** part 6 of B-082, duplicate-content warnings — and worth naming for whoever takes it: `similarity` and `findDuplicates` already exist in `packages/core/marketing/profile.ts` from B-067, wired only into the facility meta-description editor, so that part is mostly a matter of reaching the pages that now exist. **The live Search Console path has never run.** No service account is configured anywhere, so the JWT signing, the token exchange, the inspection call and every response mapping are asserted by unit tests against recorded shapes and by nothing else — the same position B-107's map is in. The first session with real credentials owes a manual pass, and specifically these: that the property URL form (`sc-domain:` versus `https://`) is the one Google expects, that a 403 really does mean "add the service account as a user", and that the PEM un-escaping produces a key `createSign` accepts. `INSPECT_LIMIT` is 40 with the truncation stated on the page rather than silent; the upgrade is storing verdicts with timestamps and refreshing the oldest slice, and the trigger is the sitemap outgrowing that number.

## B-082 (part 6 of 6) — Duplicate content, and the report immediately flagged our own city pages

`862993a`

**B-082 is complete with this part.**

**Built — the half B-067's check structurally could not see.** B-067 warns a marketer, at the moment they type, when a facility's meta description matches another facility's. That is the right warning in the right place; it covers one field, at edit time, on the page being edited. `/admin/reports/duplicate-content` covers the rest: every prose field the site publishes, compared against every other of the same kind — facility meta descriptions, opening lines and long descriptions, city page intros, guide descriptions. The two collisions the edit-time warning cannot reach are **long-form descriptions**, which are the largest block of text on a facility page and therefore the biggest thin-content lever there is, and **generated copy, which no editor ever opens**.

**Compared within a kind and never across kinds.** A 155-character meta description scored against a 600-word long description comes out low for reasons of length rather than content, and the pairs that did surface would be noise — which is how a report like this gets ignored and then deleted.

**The corpus is read from the functions the pages render from**, never a second copy: city intros through `cityIntro`, guide descriptions from the guide catalog, facility copy from the facility record. A corpus assembled any other way would be checking text that is on no page, which is worse than not checking, because it produces confident warnings about nothing.

**Found — the report's first run flagged B-082 part 2's own output.** The three demo city intros score **0.82, 0.835 and 0.854** against each other, against this codebase's own 0.8 threshold. D-58 chose to generate that copy from the facility records rather than add a `City` model, on the explicit footing that it is thin-content protection at the floor and not a marketing asset. There is now a measured second opinion: by the project's own check, the city pages are duplicate content. **That is the check working**, and it is exactly why the report covers generated text instead of only what somebody typed. Filed as **B-128** for the owner: build editable per-city copy, or record that generated intros are permanent and exclude generated-vs-generated pairs so the report stops reporting a state nobody intends to change. D-58 now carries the measurement.

**Deliberately not done: raising the threshold.** It would silence this finding and, in the same move, silence it for authored copy — which is the case the check exists for. B-128 says so explicitly, because a threshold nudge is the obvious cheap fix and it is the wrong one.

**Found while writing it — the guidance was about to send somebody hunting for a field that does not exist.** The first draft told every flagged pair to "write real copy for either page". For two pasted facility descriptions that is right. For two generated city intros there is no city description to edit — that is what D-58 decided — so it was an instruction nobody could follow. Generated pairs now say the pages are alike because the records are alike, and that changing it is a product change rather than a copy change. An e2e asserts that row does **not** contain the rewrite advice.

**Authored collisions sort above generated ones whatever the score**, including above a perfect 1.0 between two generated pages. Somebody pasting is both more surprising and more likely to be a mistake than two templated pages resembling each other, and burying the first under the second is how the urgent case gets missed.

**Singletons are reported, not hidden.** "No duplicates in guides" and "there is only one guide" are different statements, and a report that renders the first when the second is true has told somebody their site is fine when nothing was compared.

**Test verification:** unit suite **3,068 passing, 8 skipped of 3,076** — reconciled as +14 on 3,062: 12 duplicate-content tests and 2 the tree generates for the new report page. Run twice. One test failed on first write, asserting a made-up 0.1 similarity floor between two unrelated sentences; it is now calibrated against the pair's own measured score, with a comment saying why, because two genuinely different sentences share fewer trigrams than intuition suggests. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **982 passed, 6 skipped, 0 failed, 0 flaky of 988** — reconciled as +16 on part 5's 972, being four new report specs across two device projects and one new admin a11y route at four checks each across two.

**Also noticed, not acted on — the vitest schema has heavy fixture leakage.** Running the corpus against `storage_test` returned a city intro naming **4,266 facilities in Austin**, left behind by suites that create facilities and do not delete them. It affects no product code and no assertion (every suite scopes to its own suffix), and the report only ever runs against `public`. It is written down because CLAUDE.md's "test isolation is not free on a shared database" note is about exactly this, and the count has grown far enough to be worth someone's attention.

**Left behind:** the check is O(n²) within each kind, marked `ponytail:` with a minhash/LSH prefilter as the upgrade and "this report takes long enough that somebody notices it loading" as the trigger; at a few hundred pages it is tens of thousands of trigram intersections. Facility titles and the generated FAQ answers are not in the corpus — the generated defaults are templated by design across every unedited facility, and including them would flag every facility against every other and bury the one case where somebody actually pasted. Guide *prose* is not compared either, only guide descriptions; four hand-written essays on different subjects are not a plausible collision, and the MDX would have to be read off disk at request time to include them.

## B-128 — City pages get copy somebody can write, and the seed that stopped being idempotent

`16076f1`

**Decided by the owner (D-62): build the editable copy, keep the generated intro as the fallback.** B-082 part 6 handed this over as a genuine choice, and the alternatives were rejected on the record: raising the 0.8 threshold silences the finding for authored copy too, which is the case the check exists for; excluding generated-vs-generated pairs concedes that city pages are permanently a thin-content floor; and widening what the generator varies on fixes the number without fixing the category, since two genuinely similar cities still collide.

**Built — D-58 completed rather than overturned.** D-58 refused a `City` model on the footing that derived copy cannot drift, and that reasoning is exactly why the generated intro is still what renders when nobody has written one — which is every city on the day this shipped. What changed is a measurement D-58 did not have: the site's own duplicate-content report scores the three generated intros at 0.82–0.85 against each other, over this codebase's own 0.8 threshold, so pages built to rank were duplicate content **with no field anybody could edit to fix it**. `cityIntro` now takes an optional authored intro and it wins outright when present — never half-generated, because a templated sentence somebody did not choose sitting in the middle of a landing page they did is the duplication still on the page.

**The `City` row carries prose and nothing else** — no name, no state name, no coordinates — and is keyed on the URL slug rather than the stored spelling. Every one of those omitted fields would be a fact that can disagree with the facilities the page lists, which is the failure mode D-58 was protecting against; a table that holds only words cannot become a second opinion about where a city is.

**The permission is new, and asked for with a null facility.** `marketing:city_copy`, the same shape as `org:defaults`: a city page lists every facility in the city, so `facility:settings` at one site would let a manager at one Austin location edit the page that also lists the two they do not run. Granted to regional and owner. Roles are data, so no migration — the seed carries it (29 permissions to 30).

**The editor shows what each page says today, not an empty box and a hint.** "Clear it to go back to generated" is a claim the screen makes to an operator; rendering the generated paragraphs in place is what makes it something they can check rather than something they have to believe. The city list comes from the FACILITIES, never from the `city` table, so the screen cannot become a way to publish copy about a place we do not operate in — and a save for a city with no active facility is refused for the same reason, since that URL 404s under AC1's indexability rule.

**The duplicate-content report reads which intro actually rendered.** `origin` is taken from whether authored copy was used, not assumed to be `generated` — so writing copy for a city moves it to `authored`, and two authored cities that are *still* alike are reported as "somebody wrote both" rather than as a product gap. The advice for a generated pair now links to the editor instead of saying there is no field to edit, which was true when B-082 part 6 wrote it and stopped being true here.

**Found and fixed along the way — a real bug: the demo seed had stopped being idempotent, and the fix that broke it was written for real data.** `seed-demo.mts` spared any demo promotion that had a redemption, on the reasoning that "a redeemed promo is evidence a move-in happened". That is true of a real promotion and was never true of a demo one. B-082 part 4 then began seeding an ROI promotion *with* a redemption on every run, so it outlived every reset and the next run created a second promotion with the same name. What that looks like is `admin-reports.spec.ts` failing on a Playwright strict-mode violation — two rows matching "Spring — half off two months" — which reads as a broken report and is a seed that no longer resets. `db:migrate:e2e` is the documented fresh-machine step, so the first person to run it twice hits it; it surfaced here because this item ran it. Demo redemptions are now deleted with the codes, scoped by the same `demo-` name prefix, so a real redemption is still untouchable. Proved by seeding twice and counting: one promotion per name.

**Test verification:** unit suite **3,082 passing, 8 skipped of 3,090** — reconciled as +14 on B-082 part 6's 3,076: 4 pure tests for the authored intro, 8 database tests for the editor, and 2 the tree generates for the new admin page. Run twice, identical both times. `tests/schema-invariants.test.ts` failed first — correctly, on `City` having no `facilityId` — and the allowlist entry says why a city page has no single facility to scope to, which is the same sentence that justifies the null-facility permission check.

Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **997 passed, 5 skipped, 0 failed, 0 flaky of 1,002** — reconciled as +14 on B-082 part 6's 988: three new city-copy specs across two device projects (6), and one new admin route which the `ADMIN_ROUTES` loop turns into **four** checks each — axe, 320px reflow, forced text spacing and 200% zoom — across two projects (8). One existing duplicate-content spec was renamed rather than added, because its assertion about there being no field to edit had become false.

**Left behind:** the editor writes one field, so a city page's `<title>` and meta description are still generated even where the intro is authored — deliberate, because those are the derived-from-facts fields D-58 is about (the count and the price floor), and a hand-typed title going stale against the price under it is the exact drift that decision refuses. No per-city photo, heading override or FAQ set; the facility page has all three and a city page is a list rather than a location, so none of them has a caller yet. The screen is one section per city with no pagination — bounded by how many cities the portfolio operates in, not by rows that grow, so it is not the unpaginated-list gap the accessibility statement names. **The accessibility statement was re-read and needs no change:** this item added `<p>` paragraphs on an existing public page and one staff screen, closed no gap it lists and opened none.

## B-083 — Certified mail for lien notices, and the auction half split out

`c9b953b`

**Scope narrowed by owner decision (D-63), and the reason is older than this row.** US-30 asks for two integrations. The auction-platform half is blocked on **master PRD §11 open question 9** — live on-site auctions versus online — which has never been answered, and on a partner agreement with no publicly published API. Writing a marketplace driver would have answered OQ-9 by building for it. It is now **B-129**, with the block and the no-simulator rule recorded in advance so the next session does not re-derive them. OQ-9 itself is marked as blocking in the master PRD rather than left as a bullet nobody reads.

**Built.** `mailNoticeCertified` posts the stored notice document by USPS certified mail through Lob's documented `POST /v1/letters` — hand-rolled with `fetch` and no SDK, the same call B-082 part 5 made for Search Console — and records the returned tracking number as proof of service. The mailed bytes are the stored `Document.content`, not a re-render, so what goes in the envelope is what `documentHash` covers.

**There is deliberately no simulator, and this is the strongest case in the repo for that rule.** The project has decided this twice in opposite directions and the distinction is what settles it: a simulated gate is fine (D-4) because a simulated gate is a device we control; a simulated Search Console verdict was refused because it is a claim about what a third party did. Certified mail is the second case and worse — a fabricated tracking number is a claim about what the **postal service** did, sitting in the evidence chain that defends a lien sale under Texas Property Code ch. 59. It would not be a bad screen; it would be a document produced in litigation. Unconfigured is therefore the shipped state, and it is what every dev, CI and preview environment is in: the button is not offered, the screen names `CERTIFIED_MAIL_API_KEY`, and staff post the notice and type the tracking number exactly as before.

**The provider key is refused in both directions, and the second one is the point.** A `live_` key outside production would put real paper in a real mailbox from a laptop or a preview deploy — and unlike email (FR-20's sandbox inbox) post has no redirect, because a collected letter cannot be recalled, so the refusal is absolute. A `test_` key **in** production is the quieter, worse failure: the provider accepts the letter, returns a well-formed tracking number, mails nothing, and the system writes that number down as proof of service. That is fabricated evidence produced by a configuration mistake — the same outcome the no-simulator rule exists to prevent, reached through the back door.

**Every refusal happens before the provider is called.** The one thing this path must never do is put paper in the post and fail to write down that it did, so the config check, the status checks, the address checks and the document check all run first. The single remaining window — the provider accepts and the database write then fails — returns the **tracking number inside the refusal**, so the number is on screen for a person to record by hand rather than lost in a log. And the request carries the notice id as an **idempotency key**, so a staff member pressing send again after a timeout gets the original letter back instead of posting a second copy of a legal notice with a second tracking number and no way to say which was served.

**Delivery is recorded through `recordNoticeDelivery`, never by writing the `Notice` row here**, so B-061's `notice_email` consent gate and proof requirements still run on this path. A second way to mark a notice served is exactly how one of those gets skipped.

**`deliveredAt` is the mailing date, deliberately.** Service by certified mail is complete on mailing; a refused or unclaimed letter does not undo it. That also means the auction pipeline's served-notice precondition (US-28) unlocks on the same footing a court would use, and it matches what staff already do by hand — they record delivery when they post it.

**The address comes from the notice's own snapshot (US-13), never the tenant's current one.** A tenant who moved between generation and posting must not silently redirect the envelope away from what the document says it was sent to. An incomplete snapshot is refused with the missing parts named and the instruction to generate a *correction*, not to quietly use a newer address.

**Found and fixed on the way — a real defect, small and live.** Both admin notice screens carried their own two-entry `TYPE_LABELS` map while the database enum has six members, so a late notice, an auction notice, a rate-change notice or a move-out notice printed as the raw enum value — `late_notice` — on screen. Hoisted to one total `noticeTypeLabel` covering the whole enum, which is what the certified-mail letter description needed anyway; the alternative was a third copy of a wrong map.

**Also found — and this one is a genuine coverage hole, filed as B-130.** Adding the first e2e for the notices screen turned up that **no demo lease can generate a lien notice: 0 of 14**, measured with the product's own `previewNotice` rather than a re-derivation (a hand-written reconciliation query disagreed with the screen, so it was discarded in favour of the real function). Twelve leases refuse with `nothing_owed` and one is in credit — both correct — and the fourteenth is the **delinquent** lease this screen belongs to, refusing with `ledger_does_not_reconcile`. The lease seeded specifically to be delinquent is the only one that ought to be able to state a claim and the only one that cannot. B-061's refusal is doing its job; the seed is wrong. The consequence is that notice generation, notice service and now this item's send button have **no e2e path at all** — every one is asserted against disposable fixtures and by nothing a browser touches. Not fixed here on purpose: making that lease reconcile changes what it owes, and the past-due portal banner, the delinquency queue, the dunning specs and the auction pipeline all assert against it, so it is a seed change with a blast radius rather than a tail-end edit. The new spec asserts what is genuinely reachable — that the refusal reaches the screen with its reason instead of an error boundary — and says in as many words why it cannot assert more.

**Also found: an e2e comment claiming coverage that did not exist.** `admin.spec.ts` justifies leaving dynamic routes off its list by asserting each "already has its own axe scan in its topic file". The per-lease notices sub-route had no scan in any file. It has one now, added by the item that put a new form on that screen, and the comment says plainly that it was an overstatement — a comment asserting coverage goes stale exactly the way the accessibility statement does.

**Test verification:** unit suite **3,112 passing, 8 skipped of 3,120** — reconciled as +30 on B-128's 3,090: 17 pure tests and 13 database tests. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift (this item adds no column).

**Every database test here asserts a refusal, and that is the design rather than a gap.** What is left on the far side of the send is the provider's own HTTP behaviour, which needs credentials this project does not have — the same honest position B-082 part 5 took, and the reason there is no simulator. No test reaches the network; if one ever does, it means a refusal moved to the wrong side of the send.

Full e2e against a production build: **1,003 passed, 5 skipped, 0 failed, 0 flaky of 1,008** — reconciled as +6 on B-128's 1,002, being three new notices-screen specs across two device projects. The unit suite was run twice, identical both times.

**The first sweep went red on two of those three new specs, and the cause was mine.** The unconfigured message was rendered inside the per-notice block, so on a lease with no generated notices it appeared nowhere — and it was the wrong place regardless: whether a mail provider is connected is a fact about the install, not about one notice, and an operator asking "can this post my notices for me?" should not have to generate one to find out. It is now stated once, in the section header, whether or not any notice exists.

**The accessibility statement needs no change and was checked:** this item touched no customer-facing page, added no unpaginated list, and closed no gap the statement names.

**Left behind — and the first item with real credentials owes a manual pass, the same debt B-082 part 5 recorded.** The entire HTTP path is asserted against recorded response shapes and by nothing else. Specifically unverified against the real provider: that the `Idempotency-Key` header does what the retry story assumes; that `extra_service: 'certified'` returns `tracking_number` on the create response rather than only on a later webhook; that an HTML string is accepted in `file`; and that the error body's shape is what `providerMessage` unwraps. **There is no delivery-status refresh and no webhook** — proof of *mailing* is what a lien file needs and what the send response carries, so tracking a letter to its doorstep is information rather than evidence; the trigger for adding it is an operator wanting to see whether a notice was actually collected. **There is also no cost control**: every press posts a letter that costs real money, with no per-facility cap, no monthly ceiling and no dry-run preview of the envelope. That is acceptable while the button sits behind `delinquency:execute_step` on a per-notice screen, and it would not be if anything ever mailed in bulk.

## B-084 part 1 of 4 — The monthly close, and what "frozen" actually means

`17a7694`

**Split into four parts by owner decision, 2026-08-18.** The row is four deliverables and two of them are correctness-critical. The ordering is not cosmetic: a management pack or an accounting export cut from **live** data silently disagrees with itself between runs, so the frozen close lands first and the other two read from it. Parts 2–4 are the QuickBooks journal export, the scheduled report emails (the first item that has to meet PRD 05 FR-9a) and the management summary pack.

**Two owner decisions were taken by precedent rather than asked, and both are recorded rather than left implicit.** **D-64**: the "monthly PDF" US-40 names ships as semantic HTML, because B-023 found that no JavaScript PDF library in this runtime emits *tagged* PDFs and an untagged one is a screen-reader dead end — recorded as a D-number now because this is the second place PRD text asks for a PDF, and a precedent living only in a PROGRESS entry is one the next session re-derives. **The chart of accounts** for part 2 will be configurable with its own form, per this repo's own rule that a field configuring behaviour ships with its control; guessing an operator's account names was never an option.

**Built, and the whole feature turns on a distinction §8 does not make (D-65).** "Frozen month-end snapshots" is one line in the PRD. Working through it produced the finding that decides the design: **some figures can be recomputed for a past month and some cannot, and they need opposite treatment.**

- **Only knowable at the time.** `occupancyForFacility` reads `Unit.status` — current status, no date filter, nothing in this system records what it used to be. `delinquencyReport` takes **no date parameter at all**. Both answer "as of now" whatever range they are handed, so a July figure is observable only in July. These are frozen because the filed copy is the only record that will ever exist, and they are **never drift-checked** — recomputing one does not reproduce it, it answers a different question with the same name.
- **Derived from dated rows.** Billed, collected, discounts, referral rewards, write-offs, refunds, unapplied, economic occupancy and the move counts all come from rows carrying their own dates. These are frozen **and** re-run on view, and any difference is reported as drift — a voided invoice, a backdated adjustment, a corrected move-out.

**Conflating them fails in both directions**, which is why it is worth this much care: comparing occupancy would flag every closed month forever over changes with nothing to do with that month, and not comparing revenue would hide exactly the post-close edits an accountant needs told about. The split is **enforced by types, not discipline** — `periodDrift` takes `PeriodDerivedFigures`, so a point-in-time field cannot be passed to it at all. Ratios compare with a 1e-9 tolerance, because a drift report that fires on floating-point noise is one nobody reads.

**Every figure comes from the existing report functions, never from queries written here.** §8's first principle is "one shared metrics-definition layer", and a close that computed its own economic occupancy would be a second definition of the number the whole product is measured on. The cost is that each of those functions computes every facility the actor can see and this throws most of it away; a close is a person pressing a button once a month, so that is the right trade rather than something to optimise into a private query.

**Month bounds are the same `monthBounds` a tenant statement uses**, so a statement and a close for one month cover exactly the same days rather than nearly the same ones — local midnight at both ends, because a payment taken at 8pm on the 31st belongs to that month. The resolved UTC window is **stored on the row**, so a later timezone correction on the facility cannot silently re-slice a month that is already filed, and the drift check re-runs against the window as filed rather than as `monthBounds` would resolve it today.

**Guards.** A month cannot be closed before it has ended in the facility's own timezone — freezing half of August under a name claiming all of it makes every figure wrong in the same direction, which is worse than not filing because it looks like a record. Closing twice is refused and points at reopen. Reopening **requires a reason**, clears the snapshot rather than leaving withdrawn figures on display as though still authoritative, and writes them to the audit log — which is append-only and is the only place they survive.

**The permission is new: `accounting:close`, at regional and above.** Deliberately not granted to `manager`: closing a period fixes the figures the site is measured on, which is the same reasoning that stops `auctions:approve` at regional.

**Found and filed as B-131 — a real defect in a shipped report.** The occupancy report takes a date range, uses it for the collected figure and the street rate, and **does not apply it to the occupancy figure at all**. Asking for July's occupancy in December returns December's unit statuses under July's heading, on a screen with a date picker on it. This close freezes around that rather than fixing it; historising unit status is a table, a write at every status change, and every occupancy read moving to an as-at query — not a tail-end edit. B-131 says explicitly that doing neither is the bad outcome, because a date range that changes some figures on a page and not others is the shape that gets a number quoted in a board pack and defended.

**Found before it fired, unlike last time.** `AccountingPeriod.facility` is `onDelete: Restrict`, so a demo month somebody closed would have made the next `seed-demo.mts` run fail on a foreign key instead of resetting — the same footgun the promotion cleanup carried until B-128, caught here by asking the question rather than by a red sweep.

**Test verification:** unit suite **3,139 passing, 8 skipped of 3,147** — reconciled as +27 on B-083's 3,120: 13 pure tests, 12 database tests, and 2 the tree generates for the new admin page. `tests/rbac-db.test.ts` failed first and correctly — the test schema had been seeded before the new permission existed, which is `db:migrate:test` doing its job. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **1,017 passed, 5 skipped, 0 failed, 0 flaky of 1,022** — reconciled as +14 on B-083's 1,008: three new close specs across two device projects (6), and one new admin route which the `ADMIN_ROUTES` loop turns into four checks each — axe, 320px reflow, forced text spacing and 200% zoom — across two projects (8). The unit suite was run twice, identical both times.

**The accessibility statement needs no change and was checked:** this part touched no customer-facing page. The close screen's status is carried by the word "Closed"/"Open", never by colour alone, and the drift table has `<th scope>` on both axes with a caption.

**Left behind:** the period list is a fixed 24-month window with no paging, marked `ponytail:` — the upgrade is a year selector and the trigger is somebody needing to look back further, which is roughly when a period stops being restatable in practice. Drift is computed for the three most recent closed months only, because each one re-runs the whole report layer. **There is no portfolio-level close** — a month is filed per facility, since each keeps its own books on its own timezone; the roll-up view of "which sites have filed August" is worth building when there are enough facilities for it to be a question. And nothing yet *reads* a filed period: parts 2 and 4 are what make the freeze pay for itself.

## B-084 part 2 of 4 — The QuickBooks journal, and two omissions that look like bugs

`c26b29f`

**Built.** `/admin/reports/journal.csv` cuts a balanced general-journal entry for one facility and one **closed** month, from that month's frozen figures. It refuses an open month — which is what turns the ordering argument behind the four-part split from advice into something enforced: an export re-derived at click time disagrees with the one taken yesterday, and an accountant who has already posted the first has no way to tell which is right.

**PRD 02 §2 says we are not the accounting system of record**, and that makes exactly one property non-negotiable: **the entry balances.** `buildJournal` asserts its own balance before returning and throws `UnbalancedJournalError` otherwise — unreachable by construction, since each of the three sub-entries balances on its own, and checked anyway for the same reason B-062's proceeds waterfall asserts it accounted for every cent: the failure would land in somebody else's general ledger, where nothing points back here. A swept test covers **100+ combinations** of discounts, referral rewards, write-offs and unapplied money.

**Two omissions that read as bugs and are the whole point.** Both were found by reading what the revenue report already documents about itself rather than by writing code and testing it afterwards:

- **Refunds are not journaled at all.** `refundsCents` is informational — a refund unwinds its original payment's allocation rows, so `collectedCents` is *already* net of it. A refund entry would take the money out twice **and balance while doing it**, which is precisely the error a trial balance cannot catch.
- **Referral rewards are taken OUT of the discount figure, not posted beside it.** They are a subset of `discountsCents`, not a sibling — the same invoice line type, split by description. Posting both in full would double the reduction and also balance.

Both are asserted by name in the tests, because in each case the correct behaviour looks like something missing, and a later reader would reasonably try to "fix" it.

**The snapshot gained a category split, and version 1 is refused rather than guessed.** A journal credits rental income, fee income, protection income and sales tax payable to four different accounts, and part 1 stored only totals — a total cannot be taken apart afterwards. `CLOSE_SNAPSHOT_VERSION` is now 2, and a month filed under version 1 is **refused with an instruction to reopen and re-close**, which says explicitly that the figures themselves will not change. Exporting it would mean inventing which part of a total was rent and which was tax, and posting that invention to a real ledger.

**Drift now covers the category leaves too**, which came out of the same change: a rent-to-fee reclassification that leaves the total unchanged is exactly the restatement worth flagging, and the shape part 1 shipped — comparing top-level numbers only — would have reported nothing at all.

**The chart of accounts is per facility, and ships with its form** (D-66). Ten named accounts, matched by NAME because that is what QuickBooks Online's journal import matches on; any field left blank falls back to a conventional name, so an operator who has never opened the form still gets a file that imports and one who has renamed two accounts only says so twice. Per facility rather than org-wide because separate books per site is ordinary in this industry. An account name containing a comma or a line break is refused at the field, since both break the import in a way that surfaces as a mangled row rather than an error. A test asserts there is a form field for **every** account the journal can post to — the repo's own rule, checked rather than trusted.

**The CSV is QuickBooks' own shape**, asterisks included, because the import matches on header text. A line carries a value on exactly one side and a blank on the other, never `0.00`: QuickBooks treats a zero as a value, and a row with both reads as an error in the import preview.

**A negative amount flips sides rather than being written as a minus.** Not defensive tidying — discounts can genuinely exceed the gross billed in a credit-heavy month, which makes the receivable movement negative, and a negative debit is not something a journal may contain.

**Test verification:** unit suite **3,160 passing, 8 skipped of 3,168** — reconciled as +21 on part 1's 3,147: 14 pure journal tests, 6 database tests, and 1 more drift test for the reclassification case. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift.

Full e2e against a production build: **1,023 passed, 5 skipped, 0 failed, 0 flaky of 1,028** — reconciled as +6 on part 1's 1,022, being three new specs across two device projects. No new `ADMIN_ROUTES` entry this time: `journal.csv` is a route handler rather than a page, so it has no rendering to scan. The unit suite was run twice, identical both times.

**The first sweep went red on two of my own new specs, and the cause was a test bug worth naming.** Both used Playwright's bare `request` fixture, which carries no session, so the route refused on authentication rather than on the thing the test was about — the server log said `ForbiddenError: Authentication required` while the assertion complained about a status code. Every other CSV spec in this file uses `page.request`, which shares the browser context's cookies; these now do too, with a comment saying why.

**Observed while fixing it, not fixed:** an unauthenticated request to any CSV route returns **500** rather than a redirect or a 401 — `requireStaffActor()` throws and nothing catches it. That is repo-wide and pre-existing (every `.csv` route is built this way), and it refuses correctly, so it is a poor response rather than a hole. Worth a row if somebody ever links a CSV export from an email.

**The accessibility statement needs no change and was checked:** this part touched no customer-facing page.

**Left behind:** the journal is **per facility per month, one file at a time** — no portfolio export and no multi-month range, because an operator posting to QuickBooks does it monthly per set of books and a combined file would need a Location or Class column this does not populate. **Nothing reconciles the journal against the ledger**: the entry balances internally, and whether its receivable movement agrees with the sum of `LedgerEntry` rows for the period is a check nobody runs — worth building, and it belongs with part 4's management pack rather than here. **No IIF export** for QuickBooks Desktop; the CSV is the Online shape. And the export is untested against a real QuickBooks import — the column names come from Intuit's documented template, not from a file anybody has successfully imported, which is the same debt B-083's certified-mail driver carries and should be paid the same way.

## B-084 part 3 of 4 — Scheduled report emails, and the first email that had to be accessible

`325603a`

**Built.** `ReportSubscription` per facility — a report, a cadence and a recipient list — sent by a `reports.email` job at **6am facility-local**. The hour is not arbitrary and the screen says why: it lands after the overnight billing and delinquency sweeps, so an operator reading it at 8am is reading figures that already include last night's invoices and late fees. One job for every cadence rather than three, because `runJob` already dedupes per facility per business date and each subscription decides for itself whether today is its day — so a weekly and a monthly on one site cannot race, and there is one place to look when an email did not arrive.

**This is the first email in the product that nobody wrote by hand, which is what FR-9a was written for.** PRD 05 gained that clause in August on the explicit reasoning that it is "cheap to state now and expensive once templates exist, are versioned, and have rendered snapshots stored against thousands of message rows". Every clause is now **a test**, not a reviewer's checklist:

- `lang` on the root element;
- a real `<h1>` then `<h2>`s **in order with nothing skipped**, asserted by walking the heading levels rather than by eye;
- `<th scope>` on **columns and rows** — the row header is the half people forget, and without it a screen reader reads "$900.00" with nothing saying which measure it belongs to;
- a `<caption>` on every table;
- **no `<img>` at all**, which settles the alt-text clauses and "no text rendered as an image" together — a report needs no pictures;
- link text that names its destination, asserted by rejecting "click here", bare "here", and anything under nine characters;
- **no colour anywhere** that could carry meaning, asserted by the absence of `color:` and `bgcolor`;
- and a text part built from the **same document object** rather than by stripping tags, asserted by checking it contains no markup at all and still carries every heading, caption and figure — including that the table columns stay aligned rather than running together into a sentence of numbers.

**Two decisions, recorded as D-67.**

**There is no `lastSentAt` column.** The send is keyed `report:{subscription}:{period}:{recipient}` and `sendDirectEmail` already refuses a repeat, so the message log *is* the record of whether a period has gone out. A second column tracking the same fact is a second thing that can disagree with it, and the one that disagrees silently is always the one nobody checks. Proved by running the job twice in a day and counting two messages, not four.

**The job does not invent an actor, and that took a refactor rather than a shortcut.** The report functions funnel through `facilityAccess`, which correctly gives the **system actor nothing** — the RBAC catalog says in as many words that the system actor is not a superuser. The two shortcuts were both worse than the fix: widening `facilityAccess` for system would make every facility-scoped query in the product permissive for background work, and fabricating a staff-shaped actor would put a person's identity on something nobody did. So the reporting layer gained facility-explicit variants — `occupancyForFacility`, `facilityRevenue`, `agingForFacility`, `movesForFacility` — called after authorization has already happened at subscribe time. **That also removed real waste this repo had already noticed:** part 1's own comment records that its close computed every facility the actor could see and threw most of it away.

**A monthly report says whether its month has been closed**, and this is the link that makes part 1 pay for itself: an email showing numbers that quietly differ from the filed ones is exactly the confusion the close exists to remove. Closed says "filed and will not change unless somebody reopens the month"; open says "read live and can still change — close the month to fix them".

**A bad recipient address is refused, not dropped.** Silently ignoring one is how a report goes to three people when somebody meant four, and nobody finds out until a month-end question goes unanswered.

**Classified `operational`, not marketing.** A staff report about a business carries no tenant consent question — but sending it as marketing would put it behind a consent gate that does not apply and a suppression lane that does not fit. A hard-bounced address is still suppressed like any other.

**The worst bug in this part was mine, and nothing would have caught it.** The scheduled job was **never registered**. Every other piece was built and tested — the model, the renderer, the schedule logic, the send, the screen, thirty-nine passing tests — and none of it would ever have run, because the edit that wired the handler into `SCHEDULED_JOBS` aborted on a failed assertion and silently wrote nothing. It surfaced only from reading `git status` before committing and noticing that `registry.ts` was not in the diff. A full unit suite and a full green e2e sweep had both passed over a feature that could not execute. **There is now a test asserting the registration itself** — that `reports.email` is in `SCHEDULED_JOBS`, at 6am, per facility — because a feature that is fully tested and never invoked is the failure mode a unit suite is least likely to notice. The e2e sweep was re-run afterwards, since the first one had built an application without the job in it.

**Two more bugs found in my own tests, both worth naming because each would have passed for the wrong reason.** The `<th scope>` check `/<th(?![^>]*scope=)/` also matched `<thead>`, which has no scope and correctly should not have one. And the text-table alignment check found the intro sentence — which also begins with the word "Billed" — instead of the table row; it is anchored to a whole line now. A test that passes against the wrong string is worse than no test.

**Test verification:** unit suite **3,202 passing, 8 skipped of 3,210** — reconciled as +42 on part 2's 3,168: 24 pure tests, 16 database tests (one of them the registration guard added after the miss below), and 2 the tree generates for the new admin page. Run twice, identical both times. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift. The refactor's blast radius was checked by running the existing reporting suites first, before the new ones were written.

Full e2e against a production build: **1,038 passed, 6 skipped, 0 failed, 0 flaky of 1,044** — reconciled as +16 on part 2's 1,028: four new specs across two device projects (8), and one new admin route which the `ADMIN_ROUTES` loop turns into four checks each (8). Skipped moved 5 → 6, which is `admin-tasks.spec.ts` finding its returned-mail flow already in the post-action state and self-skipping — the documented B-120 behaviour, not a new gap.

**The accessibility statement needs no change and was checked:** this part touched no customer-facing page. It is worth noting that the statement's claims are about *pages*, and this item shipped the first accessible *email* — if the product later makes a claim about email accessibility, FR-9a and this renderer are what would back it.

**Left behind:** the recipient list is free text with no link to `StaffUser`, so a person who leaves keeps getting reports until somebody edits the subscription — the fix is picking from staff accounts, and the trigger is the first time that happens. **There is no unsubscribe link in the email itself**, only a link to the settings screen, which is correct for an operational message to staff but would not be for anything a tenant received. **No preview** — an operator cannot see what a report will look like before scheduling it, which is the obvious next convenience. And the four reports are a hardcoded catalog: adding one is a code change, which is honest at four and would not be at twenty.

## B-084 part 4 of 4 — The management pack, and what a number is worth

`44d7cae`

**B-084 is complete with this part.**

**Built.** `/admin/reports/pack` — the whole month on one page, organised as the five questions an owner actually asks rather than as the four reports the system happens to have: how full it was, what it earned, what it gave away or lost, what was owed, who came and went. **HTML, not the monthly PDF US-40 names** (D-64).

**Built as an `EmailDocument`, and that is reuse with a reason rather than convenience.** A management pack is a thing an owner both *opens* and is *sent*. Building it as one document means the page and the email cannot say different things about the same month — and part 3's FR-9a renderer then makes the emailed version accessible for free. It is subscribable through part 3's catalog, **monthly only**: a weekly pack would have nothing filed to read and would quietly fall back to live figures, which is the exact confusion the close exists to remove, so that combination is refused with a sentence saying why.

**It reads the FILED figures when the month is closed**, which is the payoff of the four-part ordering the owner chose at the start. A pack cut live changes between the day it is read and the day it is quoted. This one keeps saying what was filed, and a database test proves it: void a May invoice after May is closed, and the pack still quotes the filed $1,000 while telling the reader what no longer matches.

**The provenance sentence leads the page, never trails it**, and has three genuinely different forms — asserted as three, because collapsing them is how a live number gets read as a final one:

- *not closed* — "every figure here was read live and can still change. Close the month to fix them."
- *closed, clean* — "these are the filed figures, and nothing dated inside the month has changed since."
- *closed, drifted* — names the figures that no longer match and calls the difference **"a restatement to explain, not an error in this pack"**.

These numbers get quoted in a board meeting. "Can this still change?" is the question that decides whether they should be, so it is answered before the first figure rather than in a footnote.

**Details that are judgement rather than layout.** Promotional discounts are separated from referral rewards — the same reasoning as D-66 and the revenue report, one being a price decision and the other acquisition cost. Tax is labelled *"held for the state, not income"*, because a summary that folds it into revenue overstates what the business earned. Refunds are labelled *"already deducted from collected"*, because the one thing a reader will do with that number otherwise is subtract it again. Discounts and write-offs sit in one section, because a discount figure read without the write-offs beside it is half the story about why collected is below billed. The over-90 bucket carries the words **"needs attention"** rather than a colour (FR-9a, and it is the row somebody has to act on). Occupancy says it was measured at a moment and not averaged over the month (D-65), which is what an owner comparing two months needs to know.

**Finished the conversion part 1 admitted to.** `figuresFor` is now facility-explicit and takes no actor, so the close, the drift check and the pack all read one facility instead of computing every facility the actor can see and throwing the rest away. Part 1's own comment recorded that waste; part 3 built the per-facility variants; this is where the comment stops being true. The pack itself follows D-67's split — an actor-checked entry point for the screen, a facility-explicit builder for the job that was authorized at subscribe time.

**Reading a pack is gated on `reports:financial`, not `accounting:close`.** Reading a summary is not the same authority as filing one, and a bookkeeper who may see revenue should be able to read the pack without being able to close the books. Asserted both ways in one test.

**Test verification:** unit suite **3,223 passing, 8 skipped of 3,231** — reconciled as +21 on part 3's 3,210: 13 pure pack tests, 4 database tests on the close suite, 2 on the subscription suite, and 2 the tree generates for the new admin page. One test bug of my own: I asserted `$700.00` for a figure that is `$70.00`, which passed nothing and failed loudly — corrected to a figure the pack actually contains. Typecheck clean, lint 0 errors, `prisma migrate diff` reports no drift (this part adds no column).

Full e2e against a production build: **1,059 passed, 5 skipped, 0 failed, 0 flaky of 1,064** — reconciled as +20 on part 3's 1,044: six new pack specs across two device projects (12), and one new admin route which the `ADMIN_ROUTES` loop turns into four checks each (8). The unit suite was run twice, identical both times.

**The accessibility statement needs no change and was checked:** this part touched no customer-facing page.

**Left behind, and worth naming now that B-084 is done:** the pack is **per facility** — there is no portfolio roll-up, because a month is closed per facility on its own timezone and a combined pack would have to explain which sites had filed and which had not; that is a real feature and it is not this one. **Nothing reconciles the filed figures against the ledger** — the journal balances internally (part 2) and the pack quotes what was filed, but whether the receivable movement agrees with the sum of `LedgerEntry` rows for the period is still a check nobody runs; it was noted as part 4's job in part 2 and is honestly deferred rather than quietly dropped. **No printing stylesheet**, so "print this page" produces the screen with its navigation. And the month picker shows twelve months with no year selector, the same fixed window the close screen carries.

## B-130 — The lien-notice path had no e2e, because of one missing foreign key

`f8c05b2`

**Taken ahead of B-085, which has no buildable content.** B-085's gate driver needs a partner agreement and PRD 03 OQ-5 says the vendor choice "requires sales conversations; not answerable from public docs"; its kiosk half is settled by **D-3** — Phase 3, default no, "an evaluation item only". B-129 is blocked the same way. So the queue was three blocked rows deep, and the owner chose this finding instead.

**The cause was one missing field, and the check that caught it was right all along.** B-114 added the demo delinquent lease's INVOICE beside a ledger charge that already existed, and never linked the two — the charge carried no `invoiceId`. `reconcile` counts the ledger balance against invoices-outstanding **plus charges no invoice accounts for**, so the same $161 was counted twice and the lease reported as short by exactly the amount owed. `generateInvoices` links every charge it raises; an unlinked one genuinely is a charge with no invoice behind it. The seed now creates the invoice first and gives the ledger entry its id.

**What that cost, and why it was invisible.** US-27 refuses to generate a notice from sources that disagree — deliberately, because baking a discrepancy into a legal document is worse than stopping. So **0 of 14 demo leases could generate a lien notice**, which meant B-061's generation, its service, and B-083's certified-mail send had **no end-to-end path between them**. Nothing failed. Every suite was green over a legally-loaded flow no browser had ever walked.

**A second refusal was waiting behind the first.** With the arithmetic fixed the lease refused with `no_template` — B-061's other deliberate rule, that a facility which has not written its text generates nothing rather than silently mailing the unedited example. The demo now seeds **both** notice templates for the primary facility, written directly rather than through `saveNoticeTemplate` because that records an audit entry and this script's own contract is that it writes none. Both types, not just the lien one: the pre-lien notice is the first step of the arc the demo exists to show, and a facility that can only produce the second demonstrates the end of a process without its beginning. Measured after: **1 of 14**, which is the one that should.

**The e2e that had never existed.** It generates a notice, asserts the stored document's 64-character hash is on the row (US-16's evidence chain, not merely a rendered page), then records certified-mail service with a tracking number and asserts the notice reads as served. That is the flow an unconfigured install uses, and the one B-083's send button sits beside.

**Repeatability, by B-120's third discipline.** Generating a notice is deliberately **not** idempotent — a notice is a served document, so the product creates a new row rather than rewriting one — which means the spec would find three notices on the third run and assert against a list it did not build. `global-setup.ts` now clears demo notices at the start of every run. That qualifies as genuinely disposable state on the same footing as the checkout locks and reservation holds already there: nothing in the suite reads a pre-existing notice, and the seed itself deletes them on re-run. Documents go first, because `Notice.document` is `onDelete: Restrict`.

**Found while verifying that — and it invalidated my own first check.** Running `npx playwright test` **bare** skips global setup entirely: `test:e2e` wraps the run in `dotenv`, the bare command does not, so `DATABASE_URL` is unset in Playwright's own Node process and `global-setup.ts` returns at its first line. The app under test still gets its env from `webServer`, so **everything passes** — what is lost is silent. My first repeatability check ran twice, went green twice, and proved nothing; the notices were quietly accumulating 1 → 2 → 3 underneath it, which is what counting the rows rather than trusting the green showed. Re-run properly through `npm run test:e2e --`, it holds at one notice per run across consecutive runs. **This is now a rule in CLAUDE.md**, because the failure mode is a green result that invites exactly the wrong conclusion, and the only tell is the absence of an `[e2e setup]` line.

**Test verification:** unit suite **3,223 passing, 8 skipped of 3,231** — unchanged, which is correct: this item changed demo seed data and e2e coverage, and the unit suites build their own fixtures. Typecheck clean, lint 0 errors, no schema drift, no migration.

Full e2e against a production build: **1,061 passed, 5 skipped, 0 failed, 0 flaky of 1,066** — reconciled as +2 on B-084 part 4's 1,064, being one new spec across two device projects (the replaced refusal spec is net zero). **Run twice back to back with no reseed**, which is the check this item is actually about: the second sweep was 1,060 passed, 6 skipped, 0 failed of the same 1,066, and its log carries `[e2e setup] cleared 2 lien notice(s) from a previous run` — two because each device project generates one. The skipped count moving 5 → 6 is `admin-tasks.spec.ts` finding its returned-mail flow already in the post-action state and self-skipping, which is the documented B-120 behaviour. Zero failures on the first sweep is also the blast-radius result for the seed change: the portal past-due banner, the delinquency queue, the dunning specs and the tenant list all read the lease whose invoice now carries a ledger link, and none of them moved.

**The accessibility statement needs no change and was checked:** this item touched no customer-facing page.

**Left behind, and it is the same class of gap this row was:** the other three demo leases marked `delinquent` or `pending_auction` **have no invoices and no ledger entries at all** — they owe nothing, so Dallas's "delinquent" tenant is delinquent in name only and the `pending_auction` lease at Austin could never have a served notice behind it, which is the auction pipeline's own scheduling precondition. Fixing that means giving those leases real financial state, and the blast radius is the portal past-due banner, the delinquency queue, the dunning specs and the auction specs — the reason it is not folded into this item. It deserves a row of its own before anybody trusts a demo of the auction arc.

## B-131 — Unit occupancy is historical, and the report stops answering a different question from the one its date picker implies

`b08176e`

**What the bug was, exactly.** `occupancyForFacility` took `periodStart` and `periodEnd`, used them for the collected figure and for the street rate in force, and then read `unit.status` with **no date filter at all**. Ask it for July's occupancy in December and it returned December's unit statuses under July's heading — on a screen with a date picker on it, beside an economic-occupancy figure that genuinely did cover July. B-084 part 1 found this and froze around it (D-65); the close was a workaround, not a fix.

**`UnitStatusHistory`, written by a database trigger.** `Unit.status` is derived, and it has two application writers — `recomputeUnitStatus` and the bulk status operation's pre-evaluated `to` — plus the roles seed and the demo seed, plus whatever the next item adds. A history that depends on each of them remembering to append is a history with holes in it, and **a hole here is indistinguishable from "the status did not change"**: the as-at read cannot tell them apart. That makes a partial history not a weaker version of this feature but a wrong one, which is why the append is structural rather than a call each writer makes. `AFTER INSERT` and `AFTER UPDATE OF status` on `unit`; psql, a future migration and a caller nobody has written are all covered. The trigger returns early when the new status equals the old, because `UPDATE OF status` fires for same-value writes too and every unrelated edit that touched the column would otherwise log a change that did not happen.

The cost is real and is stated rather than hidden: a trigger is invisible in `schema.prisma`, so the model carries a comment naming the migration, and one test creates a unit through plain `prisma.unit.create` and asserts a row appeared **without the application asking**. If that test ever fails, the guarantee the table rests on is gone.

**The gap is stated, never papered over.** History begins at the migration, which backfilled one row per existing unit. `audit_log` was considered as a backfill source and rejected: it carries only the HUMAN status changes (`unit.status_overridden`, `unit.updated`), never the derived recompute that moves a unit to `occupied` on move-in. A reconstruction from it would be **confidently partial**, and a wrong past presented as a recorded one is worse than an honest gap because nothing downstream can detect it.

So a period older than the history returns today's figures flagged `followsPeriod: false`, and every surface says so. Four reasons are **carried rather than re-derived** from a bare false — `as-at-period-end`, `period-not-ended`, `before-history`, `no-units` — because "the month is older than the history" and "the month has not finished yet" are different sentences to a reader and both were reachable from the same flag.

**One sentence, three surfaces.** `unitOccupancyNote` is written once and printed by the report screen, by the scheduled occupancy email, and — as an `as at` date column, the machine-readable form of the same fact — by the CSV. That is the argument `@storage/core/metrics` already makes about the figure, applied to the caveat: a reader who sees two wordings of one qualification trusts neither. On the screen it is a paragraph the table points at with `aria-describedby`, so a reader who jumps straight to the table by table navigation still gets it rather than only a linear reader.

**Three things the as-at read had to get right.** A unit with no history row at or before the instant **did not exist yet**, so it drops out of *both* numerator and denominator — a building opened in August is correctly absent from July's denominator, where a current-status read would have counted it empty and depressed the figure. Economic occupancy is measured over the **same** unit set, because a change that made one figure historical and left the other current would reintroduce the exact disagreement the metrics module exists to prevent. And the portfolio total makes the **weakest** claim any row makes, with facilities that have no units dropped rather than allowed to vote `false` — an empty site has nothing to say about whether July is answerable, and letting it speak would put a caveat on every portfolio total forever.

`DISTINCT ON` in raw SQL rather than fetch-and-dedupe in Node: the history grows without bound while the unit count does not, and Postgres finds the last row per unit from the `(facilityId, effectiveFrom)` index instead of shipping five years of changes over the wire.

**What it decided: D-65 stays shut, deliberately.** Unit occupancy is now reproducible for any period after the history begins — which is precisely the condition D-65 said did not hold, so the door is genuinely open. It stays closed anyway, for one reason: drift-checking a filed month means comparing a stored figure against a recomputed one, and for every month **already filed** the recomputation runs against a history that does not cover it and reports drift on every one of them, forever. Moving occupancy into the drift-checked half is a decision for a later item that can also decide what to do about months filed before this one. Doing it as a side effect of building the history table would have broken the close's existing output on the way past.

**Test verification:** unit suite **3,235 passing, 8 skipped of 3,243** — +12 on B-130's 3,223, being this item's new suite. Typecheck clean across app and tests, no schema drift, one migration applied to dev, `storage_test` and the e2e `public` schema. The new suite backdates its own history rows by hand, because the trigger stamps `now()` — correct in production and useless for asserting what July looked like — and it proves the read is genuinely as-at rather than current by leaving one unit occupied *only* in the present: June reports 1 of 2, today reports 2 of 2, from the same rows.

**The accessibility statement needs no change and was checked:** this item touched admin reporting only, nothing a customer sees.

**Left behind.** Unit **type** is not historised, so a retyped or resized unit carries today's square footage into a past month's figure; rare enough that it is a second table if it ever matters, and the code says so where it reads. The **management pack** still reads filed point-in-time figures and its provenance sentence is unchanged — adding an as-at field there is a snapshot version bump, which D-66 already made expensive, and the pack's existing "filed / can still change / restated" sentence is not made wrong by this item. And the months **already filed** carry occupancy that was as-of-close-time; nothing here restates them, which is the same fact D-68 gives as the reason the drift check stays as it is.

## B-132 — The demo leases that were delinquent in name only now owe real money

`b81aa8f`

**What was wrong.** Three of the four demo leases carrying a delinquency label had **no invoices and no ledger entries whatsoever**. Only the primary facility's `delinquent` lease — the one B-114 and B-130 had already worked on — had any financial state at all. Dallas's "delinquent" tenant owed nothing, and BOTH `pending_auction` leases owed nothing, which made the status a word on a row rather than a state the product could have reached.

**Two consequences, and the second is the one that mattered.** Every multi-facility aging figure in the product was carried by one lease at one site, so a portfolio delinquency demo was a single row wearing three hats. And a `pending_auction` lease that owes nothing can never have a served lien notice behind it — a served notice being the auction pipeline's own scheduling precondition (B-062) — so the auction arc could not be walked end to end, for exactly the reason the notice arc could not before B-130.

**The fix is B-130's shape, extracted.** `seedUnpaidRent` creates the INVOICE first and gives the ledger charge its `invoiceId`, which is the whole lesson of B-130: `reconcile` counts invoices-outstanding **plus** charges no invoice accounts for, so an unlinked charge is counted twice and the lease reports as short by exactly what it owes — which US-27 then correctly refuses to state a claim from. One month for each `delinquent` lease, **three** for each `pending_auction` one, oldest first and a month apart, because every aging figure reads `daysPastDue` from the oldest unpaid invoice's original due date (D-25). Three months is what puts a lease past a lien timeline rather than merely late.

**Measured with the product's own `previewNotice`, not a re-derivation** — the same discipline B-130 used after a hand-written reconciliation query disagreed with the screen. Lien-notice eligibility across the 14 demo leases went **1 of 14 → 2 of 14**, and the two are the leases that should be able to: Austin's `delinquent` lease and Austin's `pending_auction` one.

**Dallas's two now refuse with `no_template`, and that is the right answer rather than a shortfall.** B-130 seeded notice templates for the primary facility only, deliberately, because B-061's rule is that a facility which has not written its text generates nothing instead of silently mailing the unedited example. With the money fixed, Dallas's refusal moved from `nothing_owed` to `no_template` — so the demo now carries one facility that is configured and one that is not, which is a more useful demonstration of that guard than two identical sites. Left as it is on purpose.

**The auction case, because the status without it is unreachable state.** `flag_auction_eligible` opens an `AuctionCase` on the way to `pending_auction` (B-062), so a lease sitting in that status with no case behind it is something the product itself cannot produce. The seed now calls the product's own `openAuctionCase` — which writes no audit entry, so the script's contract that it writes none still holds. `AuctionCase.lease` and `.unit` are both `onDelete: Restrict`, so the teardown gained a delete or the **next** re-seed would fail on a foreign key rather than reset; confirmed by re-running the seed against a database that already had the cases.

**What is deliberately NOT seeded: a generated or served lien notice, and any advertising record.** Both are claims about documents that were served and advertisements that ran, and fabricating either is precisely what D-63 refused for this arc. The demo leaves them walkable through the product instead, the same way B-130 left notice generation to the e2e rather than to the seed.

**Test verification:** unit suite **3,235 passing, 8 skipped of 3,243** — unchanged from B-131, which is correct: this item changed demo seed data only, and the unit suites build their own fixtures. Typecheck clean across app and tests, lint 0 errors, no schema drift, no migration.

Full e2e against a production build: **1,061 passed, 5 skipped, 0 failed, 0 flaky of 1,066** — unchanged from B-130's total, since this item added no spec. **That zero is the blast-radius result**, and it is what the item was actually about: the portal past-due banner, the delinquency queue, the tenant list, the dunning specs, the aging report and `/admin/auctions` all read leases whose financial state changed, and none of them moved. **Run twice back to back with no reseed**, which is the check a shared-fixture change actually has to survive: the second sweep was **1,060 passed, 6 skipped, 0 failed of the same 1,066**, and its log carries `[e2e setup] cleared 2 lien notice(s) from a previous run` — the `[e2e setup]` line being the tell that global setup genuinely ran (B-130's trap). The 5 → 6 skip is `admin-tasks.spec.ts` finding its returned-mail flow already in the post-action state and self-skipping, which is the documented B-120 behaviour and the same shift B-130 recorded.

**The accessibility statement needs no change and was checked:** this item touched demo seed data and admin-only surfaces, nothing a customer sees.

**Left behind.** `/admin/auctions` now has rows, and `/admin/auctions/{id}` still has no axe scan — `admin.spec.ts`'s route list holds static strings only and cannot carry a demo id, which is the reason it names that route as covered "in its topic file" when no topic file covers it. There is now a real case id to scan against for the first time; it belongs to whichever item next touches the auction screens. Nothing here walks the auction arc end to end either — the money and the case are in place so that a spec *can*, but generating and serving a notice against shared demo data is the unscoped mutation B-120 warns about, so it needs the scoped-fixture discipline rather than a tail-end edit.

## B-091 part 1 — The escalation guard and the record, with nothing yet able to render as somebody else

`f82223c`

**Taken because it is the only Phase 2 row left.** B-129 and B-085 are blocked on partner agreements, B-086–B-090 are Phase 3, and the internal-tooling block says in as many words that it is *not* in top-to-bottom build order and is buildable at any point with the Phase column as a recommendation.

**The split, and the constraint that produced it (owner, two parts).** The backlog tells L items to split at the start. The one rule that shaped where the line falls: **no commit may ship "a session can start" before "writes are blocked and the banner shows."** So part 1 builds no actor swap — nothing in this commit makes a request run as the subject, which means nothing here is reachable and no unsafe intermediate state exists. Part 2 lands the actor swap, the service-layer write blocks, the banner and the start UI together, so impersonation becomes possible and blocked in the same commit.

**The guard is one function, and it is deliberately not a `can()` branch.** PRD 09 §3 says that if an implementation finds itself adding a branch to `can()` to make impersonation work, that implementation is wrong — D-12's no-superuser-bypass rule is not reopened. `canImpersonate` never touches `can()`; it *asks* `can()` questions about the impersonator, like any other caller.

**FR-7 and FR-8 collapse into one expression, and the stronger reading is the correct one.** The scope rule is implemented as "does the impersonator hold the impersonation permission **at** every facility the subject reaches", not as a subset of facility ids. The difference is a real hole rather than pedantry: an actor who is `owner` at A and `counter` at B passes a bare subset test for a tenant with leases at both, and would then read that tenant's facility-B history through a role granting no impersonation there at all. Asking `can()` per facility is also how the rest of the codebase decides scoping, so there is no second definition of "scoped" to drift. FR-8 then falls out for free: an all-facilities subject is checked with a **null** facility, and `can()` already treats null as "only an all-facilities assignment satisfies this".

**An empty subject scope fails closed.** A tenant with no lease reaches no facility, and the scope rule cannot confine them — so a facility-scoped impersonator is refused rather than passing a trivially-true subset test. That matches FR-1 ("the subject is always an entity the actor can already see under normal facility scoping" — the tenant list is driven by leases, so a lease-less tenant appears in nobody's) and matches `facilityScope()`, which returns "matches nothing" rather than "matches everything" for an actor with no assignments.

**What the rank rule gets for free:** the `system` role is rank 100, so no human can impersonate it. Not a special case, just the rule.

**The audit change is two nullable columns, and the actor deliberately stays the subject.** FR-24's point is that both questions have to be answerable from one table: a log filtered to a tenant still shows what happened to their account, and a log filtered by impersonator shows everything a staff member did while wearing someone else's identity. Overwriting the actor would answer the second by destroying the first. Purely additive is also what keeps it compatible with the append-only triggers — no backfill, no row rewrites.

**Expiry is enforced on read, and there is no sweep job and no second column.** `validateImpersonationSession` stamps `endedAt` the first time anybody notices, so an active-session list (B-092) must filter `expiresAt > now` **as well as** `endedAt IS NULL` — a session nobody has touched since it expired is expired, not active. That is a query, not a column, and the code says so where a later item would be tempted to add one.

**FR-3's "per-org configurable" is deliberately NOT built, and that is this repo's own rule rather than a shortcut.** A column that configures behaviour ships with its control or does not ship — `billingPolicy`, `invoiceLeadDays`, `prorateOnMoveIn`, `paymentRetryDays` and the late-fee ladder all shipped reachable only from a database client and took two clean-up passes to close. The safety-bearing half (a short, server-enforced TTL) is a constant here; the knob belongs to whoever builds a control for it, and the code names FR-3's 8-hour hard maximum as what such a config must clamp to.

**SR-7's throttle reuses the session table rather than adding a mechanism.** "How many did this person start in the last hour" is one indexed query against rows we are required to keep for seven years anyway. The existing DB-backed throttle is `LoginAttempt`, which is keyed on email and failure — shoehorning session starts into it would have meant a second meaning for the same rows.

**A real cross-suite bug, found by the full run and worth naming.** The first green single-suite run was not the truth. `alertOwner` resolves its recipient with `findFirst({ assignments: { some: { role: { key: 'owner' } } } })` and no ordering, so *which* owner it picks depends on what else is in the database — and `comms-observability-db.test.ts` asserts the alert reached the owner it created. This suite's fixture originally took an assignment to the seeded `owner` role, which broke that suite on the first full run and would have broken it on **every** run afterwards, because the staff row can never be deleted (audit entries reference it with `onDelete: Restrict`). The fix was to give this suite **its own role** — not in the `ROLES` catalog, so `rbac-db.test.ts`'s catalog comparison ignores it, and `isStaffRole: false`, so `nextApproverRole` cannot start proposing it as a monetary approver in whatever suite runs alongside. The same reasoning removed a second hazard from the FR-9 test, which had been granting the seeded `manager` role a permission for the duration of one assertion. **The underlying non-determinism in `alertOwner` is left as it is** — "alert an owner" is what it means, and changing which owner gets platform alerts is a product decision, not a test fix.

**`ImpersonationSession` has no `facilityId`, and the schema invariant caught it before a human did.** A session is about a subject, and a subject spans facilities — a tenant with leases at two sites, or an all-facilities staff user, belongs to no single one. What the row carries instead is `facilityScopeSnapshot`, the impersonator's reach at the instant it started, which is the fact an investigation actually asks for and is a set rather than a column.

**Test verification:** unit suite **3,271 passing, 8 skipped of 3,279** — +36 on B-132's 3,235, being 21 adversarial guard tests and 15 database tests. **Run twice**, because this suite writes to shared state that cannot be cleaned up. Typecheck clean across app and tests, lint 0 errors, no schema drift, one migration applied to dev, `storage_test` and the e2e `public` schema. Full e2e against a production build: **1,061 passed, 5 skipped, 0 failed, 0 flaky of 1,066** — unchanged from B-132, which is the expected result for an item that adds no reachable surface. It was run rather than skipped because the RBAC seed changed: four new permissions now exist and the e2e `public` schema was reseeded with them, and the admin nav and every permission-gated screen read that catalog.

**The accessibility statement needs no change and was checked:** this item ships no UI at all. The banner and the start control are part 2, and both carry FR-15's announcement requirement.

**Left behind, deliberately and by name.** No actor swap, no write blocks, no banner, no start control — part 2, together. `impersonation:write` is seeded but nothing sets `read_write`; PRD 09 OQ-2 asks whether that path should ship at all, and the honest move if no concrete need appears by the time B-092 lands is to delete the permission rather than carry an unused write path. FR-3's per-org TTL has no control and therefore no column. And **PRD 09 OQ-1 is untouched**: the lease and privacy-policy language this feature implies is drafted by nobody yet, and §10 says attorney review is required before real staff view real tenant accounts — that is a legal dependency, not a design choice, and it belongs to part 2 or later, whichever first puts a real staff member in front of a real tenant's account.

## B-091 part 2 — Enforcement, banner and UI: the support session becomes possible and blocked in the same commit

`22c53c5`

**The constraint the split existed to honour, honoured.** Part 1's rule was that no commit may ship "a session can start" before "writes are blocked and the banner shows". Part 1 therefore built no actor swap and nothing reachable. This commit lands the swap, the write block, the banner and the start controls together, so impersonation becomes possible and constrained in the same change.

**The actor swap is one function, and that is the whole design.** `currentActor()` in `lib/rbac/session.ts` is where every screen and every service in this app already resolves who is asking — so returning the subject's actor there makes an impersonated request run as the subject *everywhere at once*, rather than in the places somebody remembered to change. The subject's authority is loaded through the ordinary `loadStaffActor()` / tenant path, so it is exactly theirs and never the impersonator's widened. `can()` is untouched, which is PRD 09 §3's own test of whether an implementation is wrong.

**Read-only is enforced by HTTP method at the edge, and FR-12's hard-block list is deliberately not built as a list (D-70).** Every non-GET request is refused while the session cookie is present, with two exempt path prefixes: `/api/impersonation/` (the way out) and `/api/auth/` (sign-out). The reason it is a method rule and not an action list is arithmetic: this repo has **53 files of server actions**, every one of them POSTs to the page that rendered it, and a list is a thing a new screen can be missing from — silently, with the failure being that the write goes through. SR-2 asks that a page which forgets to hide a button still be safe; a method rule also covers pages nobody has written yet. The list itself is not built because `impersonation:write` is in neither part of B-091, so today the rule is simply "block everything" — and a classification of blocked-versus-allowed mutations, in a build where every mutation is blocked, is code that cannot be exercised and therefore cannot be trusted the day it finally is.

**The one member of FR-12's list that is not a mutation IS built.** "Revealing an unmasked gate code" is on that list because PRD 03 SR-2 makes revealing one a separate, individually audited permission — so an impersonated portal that rendered it would launder exactly that permission, and no write block catches it, because reading a portal page is a GET. The code is dropped from the data rather than hidden in the markup: `GateCodePanel` is a client component, so a hidden code would still be serialised into the HTML.

**The session id travels in its own httpOnly cookie, not as a JWT claim (D-69), and the asymmetry is what makes that safe.** PRD 09 §6.1 names a claim, and its own argument against trusting the token — "a JWT cannot be revoked, and FR-9/FR-18 both require server-side termination mid-session" — is the reason the claim buys nothing: the row is re-read and the guard re-run on every request either way. Auth.js can only add a claim by re-minting the token, which would be needed at *both* ends, and a failed re-mint on the way out would leave a claim the row no longer backs. What replaces the signature is a binding check: `currentImpersonation()` refuses any row whose `impersonatorStaffId` is not the staff user the JWT already authenticated. A forged cookie therefore impersonates nobody, while its mere presence still trips the write block — it can only ever **reduce** access, never widen it, which is what entitles the edge layer to act on a cookie it cannot verify.

**"Return to my account" is a route handler, and that is a consequence rather than a preference.** A server action POSTs to whatever page rendered it, so it has no stable path for the exemption list to name — the way out would have been refused by the thing it ends. The same handler answers GET, because a session that expiry or FR-9 ended leaves an **inert cookie that still blocks writes for up to its remaining TTL**, and a Server Component cannot delete a cookie. Both shells detect that state and redirect through the handler, which can. Safe as a GET for the two properties the usual objection needs: it can only end the caller's own session, and it is idempotent.

**PRD 09 OQ-1 is answered, in draft, on the public privacy notice.** §10 says drafting the disclosure is in scope for whoever builds Phase A, and part 1 named part 2 as "whichever first puts a real staff member in front of a real tenant's account". The new text says what a session is, that it is read-only, that it expires by itself, that it is recorded — and **that we do not notify you**. That last sentence is the uncomfortable half and it is the one that matters: not telling somebody is a choice a policy can disclose, whereas a policy silent about it has simply not been written. It remains draft-only; §10's attorney review is a legal dependency this item cannot discharge, and the page carries its `draftNotice`.

**A real gap found by the item's own e2e, and named rather than papered over.** The gate-code masking **cannot be observed end to end in this project at all**: `ACCESS_CODE_ENCRYPTION_KEY` is unconfigured everywhere by design (`lib/access/secret.ts` — "no safe dev fallback"), so `codeForLease()` returns null for every demo lease and the panel never renders for anybody, impersonated or not. `portal.spec.ts` already records the same gap for the panel's own reveal interaction. The first sweep failed on an assertion for it, and the correct fix was to delete the assertion, not to make it pass — an assertion that holds whether or not the masking exists is worse than none, because it would read as coverage of the one item on the hard-block list that is not a mutation. The spec now says so in place of asserting it. The demo tenant is also the seeded delinquent one, whose **suspended-access branch correctly wins ahead of the masking branch**: what she sees is the explanation of why the gate will not open, which is both correct view parity and the thing a support call is actually about.

**A graceful per-form refusal was designed, tested against the codebase, and rejected on evidence.** Wrapping each shell's children in a `<fieldset disabled>` is a native one-liner that would disable every control in the subtree with correct assistive-technology semantics — except that `/portal/pay` and `/portal/move-out` each carry a `method="GET"` filter form, and the admin carries many more. Disabling those breaks exactly the read-only browsing the feature exists for. Per-form disabling is the 53-file list D-70 refuses. So a blocked submit returns a 403 naming impersonation as the reason, and the banner states read-only in the first line a screen reader reaches.

**Two real defects found by running the suite more than once, and the second is the one worth keeping.**

The first is mine and was in the new action: every guard refusal was returned as `fieldError({ subjectId })`, and on the tenant profile `subjectId` is a **hidden input** — so the rank rule, the scope rule and the throttle each rendered nowhere, and the form reported only "There is a problem with one field" about a field nobody can see. None of those refusals is about a field anyway; they are statements about the request. They are now the form's summary, which is what a screen reader reaches and what the e2e can read.

The second is a genuine B-120 violation in the new spec, and it took three sweeps to surface because that is exactly how long it takes. Impersonation writes nothing to the demo tenant — the session is read-only by construction, which is the strongest form of discipline (1) — but it does consume one piece of shared state: **SR-7's throttle, ten session starts per impersonator per hour**, against a suite whose only impersonator is the demo owner. Two tests across two Playwright projects is four starts per sweep, so the third consecutive sweep inside an hour hit the ceiling exactly and both desktop tests failed on a URL assertion, which reads like a broken feature and was the throttle correctly refusing. **Measured rather than inferred**, the same discipline B-130 used after a hand-written query disagreed with the screen: `select count(*) from impersonation_session where "startedAt" > now() - interval '60 minutes'` returned precisely **10**, all within a six-minute span, because three sweeps back to back is the normal local rhythm.

**Three changes came out of it, and the spec now fits B-120 rather than being an exception to it.** The arc is ONE test, so a sweep spends two starts instead of four. `e2e/global-setup.ts` gained a fourth reset beside the checkout locks, reservation holds and lien notices, on the identical argument — nothing in the suite reads a pre-existing session, and the only thing that creates one is this spec — and it is **scoped by `auditLogs: { none: {} }` for a reason that is not defensive padding**: `AuditLog.session` is `onDelete: Restrict`, so the day `impersonation:write` ships, entries written during a session would make an unscoped delete fail every run. And when the throttle does refuse, the test self-skips naming it, which is discipline (2), because the alternative is a future session debugging an impersonation bug that does not exist.

**A third, smaller race, worth naming because the fix reads as the obvious code.** The first rewrite waited with `expect.poll(() => page.url()).toMatch(/portal|tenants/)` — which matched the tenant profile it was *already on* and returned microseconds after the click, reporting a refusal whose text was the pristine form. Only the success has something to wait for; the refusal is what is left when it does not arrive. It waits for the redirect and treats the timeout as the refusal.

**Test verification.** Unit suite **3,279 passing, 8 skipped of 3,287** — +8 on part 1's 3,271, being the write-block predicate's own suite, including the trailing-slash case that keeps `/api/authorized-access` from being exempt by prefix. Typecheck clean across app and tests, lint 0 errors, **no migration and no schema drift** — part 1 carried the whole schema change, which is what the split was for.

Full e2e against a production build, **run twice back to back with no reseed between them** — the check a shared-fixture change actually has to survive, and the one that found the throttle defect in the first place. Both runs: **1,062 passed, 6 skipped, 0 failed, 0 flaky of 1,068**, identical, where 1,068 is B-132's 1,066 plus one new test across two Playwright projects. The second run's log carries `[e2e setup] cleared 2 support session(s) from a previous run` — the new reset acting on the two rows the first run genuinely left behind, rather than on a hypothesis. The 5 → 6 skip against earlier items is `admin-tasks.spec.ts` self-skipping its returned-mail flow, the documented B-120 behaviour and the same shift B-130 and B-132 both recorded. Every sweep carries its `[e2e setup]` line, which is B-130's tell that global setup genuinely ran.

**The zero elsewhere is the result that mattered.** This item changed `currentActor()`, which every authenticated screen in the product resolves through, and added an edge-layer refusal in front of every non-GET request in the app. A regression there would not have been subtle, and the 1,062 — twice, unchanged — is the blast-radius answer.

**The accessibility statement needs no change and was checked.** The banner ships into the tenant portal, but it renders only during an impersonated session — which no tenant can ever be in — so no customer-facing surface changed for a customer. The public **privacy** notice did change, and its claims were checked one by one against the build: read-only, thirty minutes, a stated reason, and a record that cannot be edited are each true of what shipped. An earlier draft said everything done during a session is attributable to a real person as well as to the account; that is a capability the columns support and nothing currently exercises, so it was cut rather than published.

**Left behind, by name.** A blocked submit is a 403 rather than a message beside the field — D-70 records the two graceful alternatives and why each was refused, and it belongs to whoever next has reason to open those forms. The gate-code masking is unverified end to end for the reason above, and will stay so until something configures a real encryption key in a test environment. `impersonation:write` is seeded and nothing sets `read_write`; OQ-2's honest move if no concrete need appears by the time B-092 lands is still to delete the permission. FR-3's per-org TTL still has no control and therefore no column. And **B-092 is now the whole of the oversight story** — FR-21 says in as many words that with no tenant notification (D-13a) the reporting is the only channel through which misuse becomes visible, which makes "Phase A only, indefinitely" the one resting state PRD 09 §8 explicitly calls unsafe.

## B-092 — Impersonation oversight: the only channel through which misuse becomes visible

`2e8cf30`

**Why this is not a nice-to-have, in the PRD's own words.** D-13a removed tenant notification, so nothing in the product tells anybody their account was opened. FR-21 draws the conclusion explicitly: oversight is therefore "load-bearing rather than nice-to-have", and §8 calls "Phase A only, indefinitely" the one unsafe resting state. B-091 shipped Phase A on 2026-08-19; this ends that state the same day.

**What it built.** `/admin/impersonation`, gated on `impersonation:oversee` and owner-only at seed: sessions running right now with a one-click force-end (FR-18), the filterable record with a CSV that reads the same query string through the same function (FR-19), and the frequency flags (FR-20). Nav entry in the Admin group beside Settings rather than under Reports — it is an oversight surface for whoever owns the business, not a figure anybody works from daily.

**The active list filters on two conditions, and the second is the one a later reader will drop.** B-091 part 1 wrote it down as "a query, not a column", and this is the query: `endedAt IS NULL` **and** `expiresAt > now`. Expiry is enforced lazily — `endedAt` is stamped the first time anybody touches the row — so an impersonator who closed their laptop leaves a row that is unended on paper and expired in fact. Filtering on `endedAt` alone lists it as running and offers a force-end button that ends nothing. It has its own test, which creates exactly that row (the product cannot produce one on demand).

**Force-end authorises by "you can only end what you can see".** The id has to be in `activeSessions(actor)`, which already applies both the active filter and the facility scoping — one rule rather than two that can drift. The day `impersonation:oversee` is widened to a regional (D-13b's expected path, a seed change), they can force-end at their own sites and nowhere else without this function changing. Refusals for "no such session", "not yours" and "already ended" are one message on purpose: the first two must not be distinguishable, and the third is what a second click produces.

**FR-19 names a surface to mirror that does not exist.** PRD 09 says the report should mirror PRD 02 US-38's audit-log screen. `findAuditEntries` has been in the codebase since B-005 **with no consumer outside tests** — the audit viewer was never built. So this follows the `/admin/reports` convention instead: filters in the query string, a `.csv` sibling re-reading the same string through the same function, which is the only way US-39's "export matching on-screen data exactly" can be true.

**Three decisions, each recorded because a later session would otherwise reverse them silently.**

**D-71 — `impersonation:write` is deleted, not deferred** (owner). PRD 09 OQ-2 asked at Phase A whether the write path should ship at all, and said the honest move — if no concrete need had appeared by the time Phase B landed — was to delete the permission. None appeared. What made deferring worse than deleting is that the permission was **grantable**: an owner could see it on a role, and granting it did precisely nothing, because nothing sets `read_write` and D-70 deliberately did not build FR-12's hard-block list. A permission that can be granted and has no effect is not a placeholder, it is a promise the product does not keep — and the person most likely to grant it is somebody who has just read §5.3 and believes it will be enforced. The `ImpersonationMode` enum keeps `read_write`: dropping it is a migration that erases the record of a decision, and a session row still has to state its mode rather than leave a reader to infer it from the absence of an alternative.

**D-72 — "filterable by facility" resolves through the SUBJECT.** The session row deliberately has no `facilityId` (part 1: a subject spans facilities). The owner's question is "who looked at accounts at my Dallas site", which is about whose account was opened; `facilityScopeSnapshot` answers what the impersonator *could* have reached, which is evidence about the guard and the wrong filter for this screen. The same resolution doubles as the facility scoping, which is asserted even though owner-only seeding makes it a no-op today. It is "as at now", and the screen says so in words rather than letting a reader assume it is historical.

**D-73 — FR-20's threshold is a named constant of 5, not a column.** OQ-3 wants a real N and there is no observed usage to tune against: owner-only at seed, ten starts an hour. Tuning a number against no data by putting a box on a screen is not configurability, it is a guess with a form field — and this repo's rule is that a field configuring behaviour ships with its control or does not ship, which part 1 already applied to the TTL. **Distinct subjects, not session count**, is the substantive half: five sessions against one tenant across a morning is somebody debugging one problem; five different tenants is a pattern.

**A real gap in the seed, found by deleting the first permission this repo has ever retired.** The seed upserted catalog permissions and pruned stale role GRANTS — its own comment says "removing a permission from the catalog actually revokes it" — but it never deleted the `Permission` row. So `rbac-db.test.ts`'s catalog comparison failed against every database seeded before the removal, which is the drift check doing exactly its job. The seed now prunes retired permissions after the role loop and reports how many, and both the dev schema and the vitest `storage_test` schema were reseeded to prove it (`Removed 1 retired permission(s).`).

**Two bugs in this item's own e2e, both mine, both about parallelism.** Both Playwright projects run the spec against one database. A fixed reason string put two identical rows on the record and the assertion failed on a strict-mode violation; more seriously, "Running right now" legitimately contains the *other* project's session, so ending the first card on the page reached across and killed it — the two projects would have failed each other in a way that reads like a broken force-end. Both are fixed by making the reason carry the project name and locating the card by it. Separately, the force-end test clicked and immediately navigated the other context, asserting against a session that was still running: it now waits for the card to disappear first. That is the same class of race as B-091 part 2's `expect.poll`, and the same lesson — only one outcome has something to wait for.

**An intermittent failure elsewhere, named rather than explained away.** `gate-simulator-db.test.ts`'s offline fault-injection test failed once during a full parallel unit sweep, and passed in isolation and on the next two full runs with identical code. Intermittent means it is not a deterministic consequence of anything here, and nothing in this item touches gate access decisions. It is not diagnosed: `evaluateKeypadEntry` has three ways to deny — `outside_hours` against the real wall clock, `inactive`, `unknown_code` — and the test asserted only `result`, so the one observation cannot say which. It now asserts `reason` as well, a one-line change that turns the next occurrence into a diagnosis rather than a mystery. Recorded here because a flake nobody wrote down is one the next session rediscovers from scratch.

**Test verification.** Unit suite **3,296 passing, 8 skipped of 3,304** — +17 on B-091 part 2's 3,279, being seven frequency-flag tests against plain values, seven database tests for the two queries, and three catalog assertions including one that fails if a later session re-adds the retired permission. Run three times, because this item both writes to shared state and changes reference data. Typecheck clean across app and tests, lint 0 errors, no schema drift, **no migration** — deleting a permission is a seed change by construction, which is the property §4 relies on for widening one too.

Full e2e against a production build, **run twice back to back with no reseed between them**: both **1,072 passed, 6 skipped, 0 failed, 0 flaky of 1,078**, identical. 1,078 is B-091 part 2's 1,068 plus one new test across two projects and the new route entering the four `ADMIN_ROUTES` loops (axe, reflow, 200% zoom, forced text spacing) across two projects. The second run's log carries `[e2e setup] cleared 4 support session(s) from a previous run` — the reset B-091 part 2 added, acting on what the first run genuinely left.

**The accessibility statement needed a change, in the understating direction.** This item adds a **fourth** unpaginated staff-facing list, and the page named exactly three (Tasks, Leads, Delinquency) — a sentence naming three specific screens implies the fourth is fine. Support sessions is now named alongside them, and `LAST_REVIEWED` moved to 19 August 2026. Named rather than paginated: the list is small by construction, owner-only at seed and throttled to ten sessions an hour, and claiming less is that page's own rule. B-091 part 2 was re-checked at the same time and needed nothing — its banner renders in the tenant portal but only during a session no tenant can ever be in.

**Left behind.** An owner can see **that** an account was opened, by whom, why, for how long and how it ended — but not **what** was looked at inside it. That is not an omission this item could close: read-only means no audit entries are written during a session, so there is nothing to show, and FR-24's dual-attribution columns stay unexercised. D-71 has just decided against the write mode that would produce them, so the honest position is that "what was looked at" is out of scope until somebody reopens that question. The report is also unpaginated (above), and the facility filter is as-at-now (D-72).

## B-088 part 1 — Revenue-management aids: a price change made a decision rather than a reflex

`5f54871`

**Taken after the owner chose it from a Phase 3 fork.** Phase 2 finished with B-092, and everything left is Phase 3 or blocked: B-129 needs master PRD OQ-9 answered and a marketplace partner, B-085 needs a gate-vendor agreement. Of the buildable rows this was the only fully unblocked M — no credentials, no partner — and it extends the metrics work B-084 and B-131 had just finished.

**Split, per the backlog's own rule for bundled rows.** The two halves of B-088 share no screen, no data and no PRD section. Part 1 is the revenue-management aids; part 2 is the owner KPI dashboard, and it is deliberately not built blind — `/admin` already ships B-042's portfolio dashboard and B-084 ships the close, the pack and the revenue/occupancy reports, so what an *owner* view adds beyond them is a scoping question rather than a build.

**The rule is pure, and it lives beside its dangerous twin on purpose.** `packages/core/pricing/street-rate-suggestion.ts` sits next to `rate-increase.ts` because the rate a **new** tenant is quoted and the rate an **existing** tenant is raised to are different prices with different consequences, and the failure mode is somebody conflating them. Nothing in this item reads or writes `Lease.monthlyRateCents`; the screen's first sentence says so and links to `/admin/rate-increases`, which is where raising a sitting tenant happens and has a statutory notice period.

**Occupancy is the metrics module's, per unit type, never recomputed.** D-25's rule ("no screen, tile, or export computes any of these inline") exists because a rate screen and an occupancy report disagreeing about the same unit type is how an owner stops trusting both. A test pins it by exercising the module's two judgement calls through this surface: `maintenance` counts as rentable, `unrentable` does not — a screen computing it inline would almost certainly have dropped maintenance and reported 100% where the truth is 90%.

**Increases only, and three guards before anything fires (D-74).** The ladder is US-12's own 92% example plus one step above it (≥92% → +4%, ≥95% → +8%). It never proposes a cut: a lower street rate reprices the type for every future tenant indefinitely, whereas B-070 already built the promotions engine, which discounts temporarily and expires on its own. Offering both as one-click actions side by side would make two very different decisions look symmetrical.

**The cooldown is the guard that matters, and "one-click apply" is exactly what invites the failure it prevents.** Occupancy does not fall the day a rate rises — a tight type stays tight for weeks — so a rule that re-suggests on every visit would have an operator applying +8% weekly and compounding a 50% rise inside a quarter, each click individually defensible. The suggestion goes quiet for 90 days after a change and says why. Beside it: a 5-unit floor, because three units at 100% is one move-out from 67%; and silence when `/admin/units/types` already has a rate queued, because applying on top of a scheduled row moves the price twice for one decision.

**A real bug the tests caught before any screen existed, and it was in the rounding.** The first draft rounded suggestions up to the nearest **$5**. That turns +4% on a $100 rate into +5%, and on a $37 rate into +8% — so the rounding was quietly rewriting the band the operator was reasoning about, by more than the band itself in the second case. It rounds to the whole **dollar** now, where the distortion is under a dollar on any rate, and a test sweeps 2,000–60,000 cents asserting the result never exceeds its own band by more than that. Up rather than nearest, so a raise can never round back to the price already being charged.

**Applying reuses `publishUnitTypeRate` and adds no second write path.** The permission (`rates:street:change`), the audit entry, the effective-dating and the guarantee that no in-flight lease is touched all live there already. The form is **pre-filled with the suggestion but editable** — one click should not mean the operator may only accept arithmetic they cannot alter — and it runs through the same `parseScaled` every other money field uses, so a fat-fingered "825" is refused rather than becoming an $825 rate. Viewing is gated on `rates:street:propose`, which a manager holds and which makes the existing propose/approve split meaningful: a manager can see a type is tight without being able to reprice it.

**The projected uplift states what it is.** Applying every suggestion is worth its figure per month **only once the units concerned turn over**, because a street rate is what the next tenant pays — so the total counts occupied units and the screen says the caveat rather than letting a reader read it as next month's money.

**Test verification.** Unit suite **3,320 passing, 8 skipped of 3,328** — +24 on B-092's 3,296, being fifteen tests of the rule against plain values and seven of the assembly against a database. Run twice, identical. Typecheck clean across app and tests, lint 0 errors, no schema drift, **no migration** — the rate history, the apply path and the permissions all existed; this item added a rule and a screen.

Full e2e against a production build, **run twice back to back with no reseed**: both **1,080 passed, 6 skipped, 0 failed, 0 flaky of 1,086**, identical. 1,086 is B-092's 1,078 plus the new route entering the four `ADMIN_ROUTES` scan loops (axe, reflow, 200% zoom, forced text spacing) across two projects — a price-change surface nobody scans is one nobody has checked.

**The accessibility statement needs no change and was checked:** this item ships an admin-only screen, and the sentence it could have affected — the list of unpaginated staff screens — does not apply, because the rates table is one row per unit type and a facility has tens.

**Left behind.** Part 2, the owner KPI dashboard, with the scoping question above still open. The ladder, the cooldown and the 5-unit floor are constants rather than per-facility settings, the same position D-73 took for the frequency flag and part 1 of B-091 took for the session TTL: there is no observed usage to tune against, and this repo's rule is that a field configuring behaviour ships with its control or does not ship. `rates:street:propose` still has no propose-then-approve workflow — the permission exists, this screen honours it as a read gate, and the approval queue it implies is nobody's item yet.

## B-088 part 2 — The owner KPI dashboard, built from what was filed rather than what can be re-derived

`8ec230a`

**The scoping question part 1 left open, answered.** `/admin` already ships B-042's portfolio dashboard and B-084 ships the close, the management pack and the revenue/occupancy reports, so the risk was building a second dashboard that says the same things. What none of them answers is **time**: the dashboard says "how are we doing now", every report says "how did we do in that period", and neither says "is it getting better" — which is the only question an owner who is not running the counter actually asks. So this is a trend and nothing else.

**It reads the FILED month-end snapshots and never recomputes a past month (D-75).** That is correctness before it is speed. D-65 settled that point-in-time figures cannot be observed twice — `Unit.status` had no history before B-131, `delinquencyReport` still takes no date parameter at all, and D-68 deliberately left occupancy out of the drift-checked half — so re-deriving a past month answers a *different question under the same name*, which is precisely what B-131 exists to stop a report doing. The close already froze the right answer.

**The speed argument points the same way, which is how you know the shape is right.** Twelve months across a portfolio, recomputed, is a dozen `occupancyForFacility` calls per facility, each carrying its own `DISTINCT ON` over the status history — comfortably over a hundred round trips to a remote database to render one page. Reading what was filed is one query.

**A gap is never a zero, and that is the most important line on the screen.** A month nobody has closed is named in words as not closed; it is not plotted at zero, because a zero there is a collapse that did not happen and it would be shown to the person who acts on it. The same reasoning covers a partially-filed month: when one site of three has closed, the totals cover that site alone, and the page says so — otherwise a portfolio "losing two thirds of its revenue" is indistinguishable from a manager who has not done the books.

**Ratios are recomputed from components, never averaged, in both places that trap hides.** `sumOccupancy` already documents the first: a 100%-occupied 4-unit site and a 50%-occupied 400-unit site average to 75% and roll up to 50.5%. The second is economic occupancy, where the snapshot stores only a ratio with no components beside it — so it is weighted by rentable units rather than meaned, and said out loud, because there the type system cannot catch the mistake. Both are asserted.

**It deliberately does NOT refuse an old snapshot the way `buildJournal` does.** That refusal is correct there and would be wrong here: a journal filed before v2's category split cannot be posted at all, whereas occupancy, collected, receivables and moves mean exactly the same thing in v1 and v2. Refusing by version would blank a year of history to guard a field nothing on this page reads. What it refuses instead is a missing **number**, field by field, because an absent value and a zero are indistinguishable once rendered.

**Test verification.** Unit suite **3,331 passing, 8 skipped of 3,339** — +11 on part 1's 3,320, all of them the roll-up maths against plain values. Run twice, identical. Typecheck clean across app and tests, lint 0 errors, no schema drift, **no migration** — `AccountingPeriod.snapshot` already held every figure this reads, which is the point of the decision.

Full e2e against a production build, **run twice back to back with no reseed**: both **1,088 passed, 6 skipped, 0 failed, 0 flaky of 1,094**, identical. 1,094 is part 1's 1,086 plus the new route entering the four `ADMIN_ROUTES` scan loops across two projects. The demo database has no closed months, so what the sweep actually scanned is the empty state — which is the state a real owner meets on day one, and the one most likely to be built carelessly.

**The accessibility statement needs no change and was checked:** admin-only, and the trend table is one row per month against a 12-month window, so the unpaginated-lists sentence B-092 extended does not gain a fifth entry.

**Left behind.** The current, unclosed month is absent rather than computed live — deliberate, because mixing a live figure into a row of filed ones would put two different kinds of number under one heading, and `/admin` already answers "now". There is no chart, only a table: a sparkline is worth adding when somebody asks for one, and a table is what a screen reader can actually read. The window is a constant twelve months with no control, the same position D-73 and D-74 took. And **B-088 was the last buildable Phase 3 row that needed no outside dependency** — what remains is B-086 and B-089 (both L, both needing a split), B-087 (half of it blocked on Google credentials), B-090 (XL, must be split first), and B-129/B-085, which are blocked on decisions rather than code.

## B-087 part 1 — IndexNow, structured-data monitoring, and half a PRD line that no longer exists

`317b522`

**The row was split along its blocker, not along a screen (owner, 2026-08-20).** B-087 bundled four features and two of them need Google API access this build does not have: the GBP write API is only open to an approved application, the same partner gate B-085 carries, and reviews ingestion silently answers PRD 04 Q3 — the moment one review carries `source = google_api`, `qualifiesForSchemaMarkup` starts emitting `aggregateRating`, which is a claim to Google that this site collected the ratings itself, and the cost of getting it wrong is a manual action against the whole domain rather than one page. Those two are now **B-133**. The other two need no credential at all and are this part.

**"IndexNow/sitemap ping automation" describes two mechanisms, one of which is dead (D-76).** Google retired `/ping?sitemap=` in 2023 and Bing retired its own in favour of IndexNow, so what shipped is IndexNow alone: one nightly POST to the shared endpoint, reaching Bing, Yandex, Seznam and Naver. Google is unaffected by it entirely — the sitemap plus B-082 part 5's indexation report remain the whole story there. That is a real reduction against what the PRD line promises, and it is written into D-76 and the PRD rather than left for a reader to assume the Google half shipped.

**Only changed URLs are submitted, and that constraint is what `pageKind` exists for.** IndexNow's premise is that a submission means something happened, and a daily resubmission of everything is the pattern that gets a host throttled. The job takes the sitemap and keeps the URLs whose `lastModified` falls on or after that business date — but `sitemap.ts` stamps static routes with the request time, so they would qualify as "changed" every night while never having changed. `pageKind` classifies a path as facility, city, guide or static from the path alone, and static is excluded. Both new features read it, which is why it lives in `packages/core/marketing/urls.ts` rather than in either of them.

**The submitter refuses to run without `NEXT_PUBLIC_SITE_URL`.** Same `hasCanonicalDomain` gate the canonical tag uses, for a worse reason: the failure available here is asking four search engines to crawl the `.vercel.app` twin of the real site.

**The key file is served under a fixed segment, not at the host root.** The protocol's default location is `/{key}.txt`, which in this router means a dynamic catch-all directly under `/` shadowing every future top-level path. `keyLocation` in the payload exists precisely to allow another path, so it is `/indexnow/{key}.txt` and nothing at the root is claimed. It 404s for any path but the configured key's own, including when nothing is configured — serving the key from whatever path was requested would let anyone claim ownership of this host by choosing their own key, which is the entire attack the file exists to stop.

**The structured-data monitor reads the SERVED page, and that is the whole point.** Calling `selfStorageJsonLd()` from the monitor would prove the function works, which the unit tests already prove. What can only be checked over HTTP is whether the page is still calling it, still passing it real data, and still rendering the result into the document — and this failure is silent by construction, because structured data is invisible in a browser. The first signal otherwise is a rich result disappearing weeks later, with no way to say which deploy did it.

**There is no Rich Results verdict, deliberately.** Google publishes no API for it, and a verdict scraped from a testing UI would be the same fabricated claim B-082 part 5 refused for the index status. What is checked is checkable without asking anybody: does the page still emit its contracted nodes, do they parse, and do they still carry the fields that make them eligible.

**Two rules in the checker are judgement calls worth naming.** `makesOffer` is **not** required on `SelfStorage` — a fully rented facility legitimately offers nothing, and a monitor that alarms every time a site fills up is one that gets muted in its first busy month. The address is checked **field by field** rather than as "has an address", because `prune` drops undefined values: a facility whose postal code was cleared emits an address object that is present and useless, and the coarse check passes it. `FAQPage` is absent from the contract entirely, since `faqPageJsonLd` returns null below two entries by design.

**The alert is `alertOwner`, and that was forced rather than chosen.** `createTask` requires a `facilityId`, and a guide page and a city page belong to no facility. Splitting findings so the facility ones became tasks and the rest an email would be two channels for one problem, and the half nobody watches is always the one that matters. Keyed on the business date, so a persistent break alerts once a day and a new day's identical break still gets through — the same contract the comms detectors use.

**Test verification.** Unit suite **3,354 passing, 8 skipped of 3,362** — +21, the new file. Typecheck clean across app and tests, lint 0 errors (7 pre-existing warnings, none in these files), **no migration and no schema change**, so no drift surface. E2E: the four new specs pass **10 of 10** across both projects, and `admin.spec.ts` — the file the new route joins — is **486 passed, 0 failed, 0 flaky**, with `/admin/reports/structured-data` clearing all four scan loops in both projects. The full sweep is CI's, per the standing rule.

**Two bugs the tests caught, both in the new code.** `pageKind` had the segment counts wrong — `/storage/{state}/{city}/{slug}` is four segments, not three — so every facility page classified as static and the monitor would have checked nothing while reporting no problems. The e2e then caught the second: the "N of N intact" assertion is what proves the monitor checked anything at all, and its first version used `\b`, which has nowhere to sit in an element's concatenated text (`Intact10 of 10With problems`). Both were the assertion doing its job — a monitor that checks zero pages and a monitor that finds zero problems render identically.

**The accessibility statement needs no change and was checked.** Nothing customer-facing shipped: one staff-only report, already covered by the standing caveat about admin screens, and one machine-facing text route with no UI. The report's table carries the `tabIndex={0}` scroll container B-119 established, and the new route passes all four admin scan loops — axe, 320px reflow, 200% zoom and forced text spacing. `LAST_REVIEWED` is deliberately not bumped: no claim changed, and moving the date without a review is exactly the overstatement that rule exists to prevent.

**Left behind.** A **price-only change does not trigger a submission** — `lastModified` for a facility is `Facility.updatedAt`, which does not move when a rate on one of its unit types changes. That is `sitemap.ts`'s existing limitation rather than one introduced here, and the fix belongs with the sitemap: a derived last-changed date taking the newest of the facility row and its rate records, not a second date column maintained beside it. Both new jobs carry **fixed caps with no rotation** (500 URLs submitted, 60 pages checked) and both say out loud when they truncate; the upgrade in each case is stored per-URL state and a least-recently-done slice, and the trigger is the sitemap approaching those numbers. The monitor asserts **presence and eligibility, never correctness** — it cannot tell that a facility's markup names the wrong city, only that it names one. And **B-133 owns the rest of B-087**: until it is unblocked, review entry stays manual, the GBP checklist stays a checklist, and `qualifiesForSchemaMarkup` keeps returning false by construction rather than by a flag anybody could flip early.

## B-089 — Per-city/size landing pages, and a duplicate detector promoted from report to gate

`2073e91`

**Three quarters of the row was already settled when it was reached.** B-089 listed four things. A/B testing of offers and marketplace channel evaluation were both already marked do-not-build by the owner on 2026-07-31, and the **referral program shipped as B-100/B-101** under PRD 10 — the row was written before PRD 10 existed and nobody went back to it. What was actually left was per-city/size landing pages, which makes this an M, not the L it was sized as. Recorded rather than quietly built, because a row that looks like an L is a row that gets deferred.

**The page.** `/storage/{state}/{city}/size/{dimension}` — `/storage/tx/austin/size/10x10`. It exists where priced inventory of that size exists in that city and 404s otherwise, the same rule US-4 AC1 puts on a city page. The query it targets is "10x10 storage austin", which is high intent and is genuinely not the query the facility page targets.

**The literal `size` segment is load-bearing.** Without it the dimension sits in the facility page's `{slug}` position, sharing a namespace with every slug an operator can type — and Next.js resolves that collision silently, in favour of whichever route matches first. One extra segment buys a namespace that cannot be walked into.

**D-77 is the substance: the duplicate detector became a gate.** B-082 part 6 built it as a report somebody reads afterwards, which is right for pages a person wrote — a human pasted, a human un-pastes. It is not enough for pages the product generates by the dozen: by the time the report is read the thin pages are indexed, and the damage from thin content is to the *domain* rather than to the page. So each page's intro is scored against every sibling size's intro before render, and a page at or over the existing 0.8 threshold is served `noindex, follow` and left out of the sitemap. `follow`, not `nofollow` — the page links to facilities, and those links are worth crawling whatever this page is worth.

**The gate costs no extra queries, and that is why the shape of the data layer is what it is.** Every sibling size in a city derives from the same facilities, the same unit types and the same rates, so `sizesInCity` loads the whole city once and every intro is then a pure function over it. Loading per size would have meant N loads to render one page, and a gate that expensive is a gate somebody eventually turns off.

**The numbers are measured, not asserted, and both are pinned as tests.** The seven standard sizes — all describing one facility, at one price, in one city — score **0.738** against each other at their worst pair (10×15 vs 10×30), clear of 0.8 with real margin. Two sizes the guide catalogue does **not** cover score **0.940**, because an unlisted size gets the measurement sentence and nothing else. Both of those are gated, correctly, and that is the honest limitation this item ships with.

**What makes the standard sizes clear the gate is content that already existed.** The size guide's catalogue — the comparison ("About half a standard garage"), what fits, and who typically rents it — moved from inside `size-guide/page.tsx` to `packages/core/marketing/unit-sizes.ts`, and both pages now read the one copy. **D-60 is unweakened and the distinction is the whole point:** that decision forbids re-publishing the guide, and a landing page takes two sentences about its own size and links to the guide for the rest. It reproduces neither the seven entries nor the comparisons of sizes it is not about.

**The sitemap honours the gate.** A sitemap entry carrying `noindex` asks a crawler to fetch a page and then tells it the fetch was pointless. Only pages that passed are advertised, and an e2e asserts every advertised size URL returns 200 — the failure `citiesWithFacilities` was built to prevent, which the gate adds a second way to get wrong.

**One accessibility defect found and fixed while checking the statement, in code this item wrote.** `×` is a multiplication sign: a screen reader announces "10 × 20" as "10 times 20", with the unit missing entirely. The size guide had already solved this — compact form `aria-hidden`, spoken sentence visually hidden — and the new page had not. Both now call one `dimensionSpoken` helper instead of the guide's inline `label.replace(' × ', ' foot by ')`, so a third treatment of the same problem cannot appear. The e2e asserts the accessible *name*, which is what caught it being wrong in the first place.

**Test verification.** Unit suite **3,373 passing, 8 skipped of 3,381** — +19 on B-087's 3,362: 18 new in `city-size-pages.test.ts` plus 2 that `no-internal-identifiers.test.ts` adds automatically per new file, less one. Typecheck clean across app and tests, lint 0 errors (7 pre-existing warnings, none in these files), **no migration and no schema change** — deliberately, see below — so no drift surface. E2E: `smoke.spec.ts` + `a11y.spec.ts` **352 passed, 4 skipped, 0 failed, 0 flaky**, with `/storage/tx/austin/size/10x10` clearing all four public scan loops — axe, 320px reflow, 200% zoom and forced text spacing. Full sweep is CI's, per the standing rule.

**The accessibility statement needs no change, and this time that was a real check rather than a formality** — this is the first customer-facing page shipped in several items. Nothing on it goes stale in either direction: the new route is genuinely in the automated scan, so "automated tests run on every change" is not overstated by it; it uses no map, needs no JavaScript, and adds no unpaginated list, so no line in "Where we fall short today" gains an entry. `LAST_REVIEWED` is deliberately not bumped — no claim changed, and moving the date without a review is the overstatement that rule exists to prevent.

**Left behind, and the first one is a real gap rather than a nicety.** **A portfolio with non-standard unit types gets pages that can never be indexed** — an 8×12 and an 8×16 score 0.940 against each other and both are gated, with nothing an operator can do about it, because there is no authored override for a size page the way B-128 added one for a city. That is **B-134**, deliberately not built here: an authored field is a column, a migration and a form, and building it before a real portfolio has tripped the gate is guessing at a control nobody has needed. Its trigger is concrete — a "City/size page intros" pair appearing on `/admin/reports/duplicate-content`, which now lists every size intro precisely so the gated pages are visible — and its cheaper half-fix is usually just adding the missing size to `UNIT_SIZES`. Beyond that: **the gate is silent to a visitor by design**, so the duplicate-content report is the only place an operator learns a page they expected to rank is not being offered to an index. **A facility with two unit types of the same dimensions** (a climate 10×10 and a drive-up 10×10) folds into one row at the cheaper rentable price with the counts summed — the page is about the size, and listing one address twice would be worse — which means the page cannot express "climate 10×10 from $X, drive-up from $Y". And the pages are **not linked from the city page**, only from each other and the sitemap; whether a city page should carry a size index is a content decision nobody has asked for yet.

## B-090 part 1 — Waitlists, and the demand signal this product never had

`4821522`

**The split first, because three quarters of the row needed deciding rather than building.** B-090 listed seven things and an audit found **none of them built** — the only shipped slice was a staff-placed `payment_plan` hold, which is a forbearance switch, not a plan. The row was not stale in the "someone quietly built it" direction either: B-074, B-077 and B-102 had each deferred their half here explicitly and said so in-line. Six parts remain; **two of the seven were answered instead of built (D-78)**.

**PWA push and the two-way SMS inbox were never commitments, and building them would have made them ones.** PRD 00 gates the PWA on "*if metrics justify*" and nothing in this product counts portal engagement, so the condition cannot even be evaluated. PRD 05 says the inbox is to "(evaluate)". Same conditional shape as the kiosk (PRD 03's default answer is "no") and B-089's marketplace evaluation, and the same treatment: a decision, not a row.

**The inbox evaluation found a real defect wearing a feature's clothes, which is the useful part.** The argument for an inbox is "a tenant texted us and nobody saw it" — and that is true today: `sms-webhook/route.ts` handles STOP, HELP, START and YES and **silently drops every other inbound message**. A tenant replying "I paid yesterday" is answered by nothing, and no screen records that they wrote. That is **B-135**: route an unrecognised inbound SMS to the `Task` queue staff already work. No threading, no `direction` column, no second queue to staff. If its volume proves an inbox is warranted, that is the number to reopen D-78 with — which is exactly the evidence PRD 05 asked for and nobody had.

**Then part 1. A sold-out size dead-ended in a phone number.** `checkout/actions.ts` told the renter to call and captured nothing, so demand at the moment of highest intent was lost *and never counted*. Now every fully-rented size carries a collapsed "email me when one is free" form.

**It is its own model, not a `Lead`, and that was correctness rather than taste (D-79).** A waitlist entry looks exactly like a lead, and reusing `Lead` breaks two things that already work. `raiseLeadFollowUps` raises a task for every uncontacted `new` lead — and a waitlist entry is precisely the case where there is nothing to call about, so every entry would become uncallable work on the one list a part-timer checks on a Saturday. And B-082 part 4's funnel counts leads as its denominator, so every entry would quietly dilute the conversion rate an operator prices against. That is B-131's defect again: a report answering a different question under the same name, with nothing on screen to say it had changed.

**The one rule with a wrong answer is how many people get told.** Tell everybody and eleven of twelve drive over to find the unit gone, which is worse than never writing; tell one and say nothing more, and somebody who changed their mind blocks the queue forever. So it is **availability minus the claims already outstanding**, FIFO, with a 72-hour claim window — long enough to span a weekend, because a Friday-evening mail should still be good on Monday. A notified person holds a slot even though nothing in the database reserves the unit, which is what stops the next tick, ten minutes later, offering the same unit to the next person.

**The mail is transactional and email-only (D-80).** The recipient asked to be told about one named size at one named facility and this is the single message answering that — a genuinely different case from B-073's abandonment mail, which this repo classified conservatively as marketing. Classifying it marketing would put it behind the FR-MSG-5 quiet-hours window, so somebody who asked to be told about a free unit would not be told for nine hours while another person rented it. **No SMS, and that is consent rather than scope:** a phone number typed into a notify-me box is not TCPA consent to text it, so the column exists for staff to call and nothing sends to it.

**The database enforces one live entry per address per size, not the service.** A partial unique index over `('waiting','notified')` on `(unitTypeId, lower(email))` — the same device as `reservation_one_held_per_unit`, and for the same reason: the service reads before it writes, and a double-submitted form passes that read twice. The service has deliberately **no** findFirst fast path in front of it, so the constraint is the code path a double-click actually takes.

**`/admin/reports/waitlist` exists because a waitlist is the only demand signal this product has for inventory it does not have.** B-088 part 1's rate suggestions read occupancy, which can only ever say a site is full; this says *how* full — nine people waiting on a 10×20 is the number behind a rate rise, a conversion, or a decision to build. Waiting and notified are counted separately, because a notified person is work in progress rather than demand and mixing them would overstate the case.

**Three bugs found, and only one was in code I wrote.**
1. **A `'use server'` file can only export async functions.** A stray `export const WAITLIST_IDLE` broke the production build — invisible to typecheck and to the whole unit suite, caught only because e2e builds for real. This repo's own note that a green build proves less than it looks was earned the other way round; this is the same lesson from the other side.
2. **The demo data had no sold-out size at all**, so the facility page's "Also here, currently full" branch had never rendered in a test. Adding one (Austin's 5×15, `count: 0` — a size with no units rather than occupied units with no leases behind them, which the rent roll would have had to explain) immediately broke two *pre-existing* specs: their `getByRole('main').getByRole('link', {name: /^Call/})` locators had only ever been unique because no page had a second call link. Fixed properly rather than worked around — the fixture is realistic and those locators were fragile.
3. **A collapsed `<details>` is invisible to axe.** The form's fields sit inside one, so the route scan walked straight past every one of them — a scan silently covering none of a form, which is exactly what the incomplete-assertions rule exists to stop, on a page the accessibility statement makes a public claim about. There is now a dedicated test that opens every disclosure on the page first, and it opens *all* of them because an `id` collision between two instances only appears with more than one on screen.

**And that third test immediately earned itself, on code this item did not write.** Opening every disclosure exposed a **pre-existing WCAG violation in the "What you'd pay today" cost breakdown** — `definition-list` and `dlitem`. Its `<dl>` put each `<dt>`/`<dd>` inside a second nested `<div>` with the line note as their sibling, so a screen reader was not reading the money breakdown as a term/value list at all. It had never been scanned because it, too, lives behind a collapsed disclosure, and the route scan only ever sees the closed state. Fixed here rather than deferred — it is six lines, it is on the money path, and it is a page whose conformance this repo publishes a claim about: the group is now a two-column grid holding `<dt>` and `<dd>` directly, and the note became a second `<dd>`, which is what it always was. **The general lesson is the one worth keeping: every route in the public scan list has only ever been scanned in its collapsed state**, and this page had two disclosures hiding content from it.

**Test verification.** Unit suite **3,401 passing, 8 skipped of 3,409** — +27 on B-089's 3,382 (11 core rules, 12 against real rows, 4 that `no-internal-identifiers.test.ts` adds per new file). The db suite was **run twice, identical**, per the shared-state rule. Typecheck clean across app and tests, lint 0 errors. **One migration**, applied to dev and to the test schema, and `prisma migrate diff` reports no drift — the partial unique index does not register, which is what the six existing ones in this tree already demonstrated. E2E: `smoke.spec.ts` + `a11y.spec.ts` + `admin.spec.ts` at **856 passed, 4 skipped, 0 failed, 0 flaky** once the locator fixes landed, then `smoke` + `a11y` again at **366 passed, 4 skipped, 0 failed** with the `<dl>` fix and the opened-disclosure scan. Full sweep is CI's, per the standing rule.

**The accessibility statement needs no change and this was a real check** — a customer-facing form shipped. Its claims hold: `<details>`/`<summary>` and the fields are natively keyboard-operable; the label is a real `<label>`; the error is tied to the field with `aria-invalid` and `aria-describedby`; success is announced in a `role="status"` region; and what was typed survives an error, because the input is uncontrolled and React reconciles the same DOM node rather than remounting it. `LAST_REVIEWED` is deliberately not bumped — no claim changed.

**Left behind.** **No SMS channel** — see D-80; adding one means an explicit opt-in with disclosure at capture, the shape PRD 04 US-13 already specifies. **The prospect is never told their position in the queue**: `waitlistPosition` exists and is tested, and nothing renders it, because showing "you are 7th" to somebody who just joined is as likely to lose them as keep them, and that is a content decision nobody has taken. **No attribution on an entry** — a waitlist join records no UTM or landing page, so B-082 part 4's funnel cannot yet say which channel produced a waiter; the columns are the same ones `Lead` already carries and copying them was deliberately not done before anybody asked the question. **Entries never expire**, so somebody who joined a year ago is still notified; the honest trigger for a policy is the first list long enough that its tail is obviously stale. And **the claim window is a constant, not a per-facility column** — the position D-73 and D-74 both took, because there is no usage to tune against and a field configuring behaviour ships with its control or does not ship.

---

## B-090 part 2 — Tenant self-service transfer, built as a request rather than a commit

`09548c8`

**What it built.** `/portal/transfer`: a tenant picks any available unit at their own site — each row carrying its rate and the **monthly difference** against what they pay now — picks a date, sees the swap priced, and asks. Staff finish it in B-077's wizard, which is unchanged apart from knowing what was requested. Also shipped: `lease.transfer_requested` and a confirmation email, a `transfer_request_review` task type, and a cancel path.

**The whole design decision is that it asks (D-81).** `lib/admin/transfer.ts` has been able to do this since B-077 and nothing customer-facing reached it, so the temptation was a portal button on `completeTransfer`. That would be wrong, and not for a money reason — the arithmetic is identical and the tenant sees it before they ask. **A transfer moves physical goods between two units.** The instant the old lease closes, its unit derives to `available` and is rentable to a walk-in while the tenant's things are still in it. Only a person on site can say the old unit is empty. US-707 settled exactly this argument for move-out; this is settled the same way on purpose, not differently.

**The target unit is held by a `Reservation`, and no table was added (D-82).** B-090's own audit said business accounts were the only part needing a schema change, and that survived. A hold is what `Reservation` already is: it derives the unit to `reserved`, it has an expiry sweep, and `reservation_one_held_per_unit` is already the real guarantee against promising one unit twice. Three consequences were bought deliberately with it, and a later session should not undo any of them casually:

1. **`previewTransfer` and `transferTargets` gained exactly one exception** — a unit `reserved` for the same tenant reads as available *to that tenant*, and to nobody else. Without it the request blocks the transfer it exists to set up. It requires the status to be `reserved` specifically, never "anything but available", so a stale hold on a unit that has since been let still refuses.
2. **`reserveUnit`'s duplicate guard is scoped to non-transfer holds.** It folds "the same person asking for the same size again" into one row; a tenant with a live transfer request who then reserves that size on the public site is not that person, and folding them would have quietly repointed their transfer request into a move-in checkout.
3. **The `tokenHash` is minted, hashed and discarded.** A prospect's hold is reachable by signed deep link; this one must not be, so no URL resolves to it.

**The proration was split, not copied.** `previewTransferFor` was lifted out of `previewTransfer` — load-and-authorize on one side, arithmetic on the other — so the tenant's screen runs the admin module's own math. Two prorations would be two answers to "what will this cost me", and the tenant's copy is the one nobody reconciles. A test asserts the two previews are `toEqual`.

**The confirmation quotes no dollar figure**, for the reason `lease_move_out_requested` quotes none: the total depends on the day staff actually complete it, and a number in an email reads as agreed.

**Two real bugs found, one pre-existing and one my own to prevent.**
1. **`tests/dunning-db.test.ts` had a latent ordering flake, and only a full parallel sweep showed it.** `daysEmitted()` ordered by `occurredAt` alone; the catch-up case emits every missed rung in one tight loop, so all four rows land in the same millisecond and Postgres is free to return them in any order — which it did, once, as `[1, 10, 5, 30]`. The file passed alone and on a clean tree, which is exactly what makes this class of failure read as "something you just broke". Fixed with an `id` tiebreaker (cuid is timestamp-then-counter, monotonic within a process) and a comment saying why.
2. **A lapsed transfer hold would have left its task open.** The tenant's screen is derived from the hold and self-corrects; the task is not. `expireReservations` now cancels the `transfer_request_review` task when a transfer hold expires — a queue holding items about requests that no longer exist is how staff learn to stop trusting it.

**Test verification.** Unit suite **3,418 passing, 8 skipped of 3,426** — +17 on B-090 part 1's 3,401 (14 new against real rows, plus the dunning fix). New e2e `portal-transfer.spec.ts`, **12 passing**. Typecheck clean across app, `tests/` and `e2e/`; schema drift check clean (no migration).

**The e2e spec deliberately submits nothing.** A transfer request mutates shared demo state twice — it takes a unit off the board and adds a task to the queue `admin-tasks.spec.ts` counts — and none of B-120's three disciplines would make that safe without inventing a fixture nobody else uses. It does not need to: the picker and the priced preview are both reachable by GET, because the preview form is `method="GET"` precisely so the arithmetic stays server-side. The mutation is covered in `tests/portal-transfer-db.test.ts`, where the database is disposable.

**The accessibility statement needed no prose change, and that was the finding rather than a formality.** The page's coverage claim names exactly one exception — the checkout confirmation screen. Shipping a second unscanned customer-facing page would have made that sentence false in the overstating direction *by merging rather than by editing*, which is precisely the drift this repo has been caught by twice. The scan was extended rather than the sentence weakened. `LAST_REVIEWED` is deliberately not bumped: the coverage claim was re-checked against the build, the rest of the page was not, and the date is a claim about the whole page.

**Left behind.** **The quote is not honoured — B-136**, and it is the one thing here a reader should not mistake for finished. The portal shows a figure and stores it on the hold as `quotedRateCents`; `completeTransfer` re-reads the current street rate when staff commit. That is right for a staff-initiated transfer and wrong for one a tenant was quoted, and the number they agreed to is sitting unused on the row. Not fixed here because the fix is a policy question — does a request lock a rate, for how long, and does it survive a reschedule — which is D-7/B-126's question for reservations, answered there by anchoring to the move-in date. **Also left:** the request task links to the tenant profile like every other `Lease` task rather than deep-linking the prefilled wizard (`resolveTaskSubjects` keys on `entityType`, not task type); the wizard's own banner covers it instead. **Still unbuilt in B-090:** parts 3–6 — payment plans, broadcast sends, business accounts, Spanish.

---

## B-135 — An inbound text nobody sees, routed to the queue somebody already works

`2071c3e`

**What it built.** `sms-webhook/route.ts` handled STOP, HELP, START and YES and answered everything else with `<Response/>`. A tenant writing *"I paid yesterday"* or *"the gate won't open"* got **no reply, no record, and nobody told** — from a number we had texted them from first. An unrecognised inbound now emits `sms.inbound_received` carrying the words, raises an `inbound_sms_review` task at the tenant's own facility, and answers the sender that a person has it.

**Still not an inbox, and that is D-78 rather than a shortcut.** No threading, no `direction` column on `Message`, no second queue for a part-timer to remember to open. The evaluation was that at 2–10 facilities the volume does not justify one; if the resulting task volume proves otherwise, *that is the number to reopen D-78 with* — which is exactly the evidence PRD 05 asked for and nobody had.

**Where the words live is the decision (D-83).** Not `Message`: it is outbound by construction — `eventId`, `ruleId`, `templateKey` and an idempotency key over all three are required columns, and an inbound text has none of them. Adding `direction` is the inbox D-78 declined, arriving one column at a time. Not `Task.proof`: that is completion evidence, and a body sitting there would satisfy the type's own note requirement and let a staffer close the task **without reading it**. It goes in the domain event, and the task points at it — `entityType: 'DomainEvent'` with `sourceEventId` set, the relationship `Task` has carried since B-095 and the shape `gate_manual_action` already uses.

**One task per MESSAGE, never per tenant per day**, and this is the line a later session should not tidy. `createTask` dedupes on `(type, entityId, businessDate)`. Keying the task on the tenant — which reads like better queue hygiene — would make two questions in one afternoon a single task, and the second one's words would be nowhere at all. There is a test whose only job is to fail if someone changes it.

**Three smaller calls.** The task is created `high`: everything else in this queue is work the business found for itself, and this is the only type where a person is standing somewhere with no idea whether anyone received them. The message goes **on the card**, truncated to 80 characters, so nobody opens a task to find out whether it is urgent — B-115 removed that click everywhere else and this would have reintroduced it. And the reply gives the tenant **their own site's phone number**, not the shared SMS line, because the counter that can open a gate is at that facility.

**A number we cannot place gets an honest answer rather than a receipt.** `Task` requires a facility and this SMS number is site-wide, so `To` cannot supply one and there is no honest facility to raise it at. The event is still written — the message is never simply gone — and the sender is told we may not be able to reply, with a number to call. Confirming "we have passed this on" would have been a claim about a queue nobody was going to work.

**The fixture bug this found in itself, which is worth recording because it nearly shipped green.** The first version of `tests/sms-inbound-db.test.ts` passed, then failed twice on re-run, then passed repeatedly — and I could not reproduce the failure once the database was clean, so the cause is **not confirmed**. What the investigation did surface is a real hazard the fixture had regardless: `senderOf` matches on the **last 10 digits across every tenant in the database**, and the fixture varied only four characters of a fixed `512555` prefix, so any other suite's phone ending the same way would match it. The `afterAll` also deleted its own facility, which this repo already knows can throw once anything audits it (`audit_log` RESTRICT-references it) — and a throwing `afterAll` leaves the *whole* fixture behind for the next run's phone lookup to find. Both are fixed: all ten digits now derive from the run's uuid, and the facility stays like every other suite here. It passes four consecutive runs.

**Test verification.** Unit suite **3,425 passing, 8 skipped of 3,433** — +7 on B-090b's 3,418, all against real rows. Typecheck clean across app, `tests/` and `e2e/`; lint 0 errors; schema drift clean (no migration).

**No accessibility statement change, and this was checked rather than assumed.** B-135 ships nothing a customer opens in a browser — the only customer-facing surface is an SMS reply — so the page's coverage claim is untouched. Worth stating explicitly because the rule that page is under is about *merges* making it stale, not edits.

**Left behind.** **The unmatched-number case raises no task** (above), which is a real gap and not a rounding error: a prospect texting "do you have a 10x20?" is a lead, and the event records it where nothing reads it. Giving it a home means either a per-facility SMS number or a facility-less lead queue, and both are bigger than this row. **No `To`-based routing** for the same reason. **Nothing marks the tenant's own record** — a staffer looking at a tenant profile does not see that they texted; the task is the only surface, which is D-78's point but is the first thing to revisit if volume argues for the inbox.

---

## B-136 — A transfer quote that nothing honoured

`d7bd8a6`

**What it built.** B-090 part 2 shipped a portal transfer that quotes the tenant a rate, holds the unit, and writes the figure onto the hold as `quotedRateCents` — and then `completeTransfer` re-read the current street rate when staff committed. A rate rise between the ask and the completion charged the tenant something other than the number they agreed to, silently, while the number they agreed to sat on the row. `previewTransferFor` now honours the hold's quote when the hold is on the unit being previewed, and everything downstream inherits it: the staff preview, the tenant preview, the ledger charge, and the new lease's `monthlyRateCents`.

**Fixed in the one place both callers route through.** `previewTransferFor` is the shared arithmetic B-090 part 2 deliberately split out so the tenant's figure and staff's figure could not diverge, and it is also what `completeTransfer` re-runs before posting. One `??` there covers the staff wizard, the portal, and the commit. Patching `completeTransfer` alone would have left the two previews disagreeing with what posts.

**Flat, in both directions, and that is the decision (D-84).** A street rate that *falls* between the ask and the completion still settles at the quote. `min(quoted, street)` was considered and refused: a `CheckoutSession` and a prospect's `Reservation` have both always locked their quote flat, and giving a transfer a floor nothing else has would make it the one pricing rule in the codebase nobody could predict from the others.

**The window is the hold's own expiry, not a second clock.** `transferHoldFor` already filters on `expiresAt`, so an expired hold is no hold and the rate re-quotes with no new state — which reuses D-7/B-126's answer (anchored to the move-in date, plus `reservationHoldGraceDays`) rather than competing with it. A tenant who wants a different date cancels and re-asks, and is re-quoted, because `requestTransfer` refuses a second live request.

**A staff-initiated transfer is unchanged.** No hold, so no quote, so it re-reads the street rate — correct for it, because nobody was told a number. The second test exists only to fail if that ever stops being true.

**Both screens say the figure is locked, rather than only applying it.** The staff wizard's "the tenant asked for this" note now names the quoted rate and says it is what the settlement uses while the hold lives; the tenant's pending-request page names it as "the rate we quoted you, held for this request". A settlement quietly below street rate reads to staff as a bug, and a rate the tenant was never shown again is a promise they cannot check. Both unit lists (`transferTargets`, `transferOptionsFor`) price the held unit at the quote for the same reason — a dropdown saying $260 above a settlement saying $200 is worse than either number alone.

**Test verification.** Unit suite **3,427 passing, 8 skipped of 3,435** — +2 on B-135's 3,425. The lock test was verified to FAIL with the fix removed and the no-hold test to pass either way, so the pair actually separates the behaviours. Typecheck clean across app, `tests/` and `e2e/`; schema drift clean (no migration — `quotedRateCents` already existed).

**No accessibility statement change.** The only customer-facing edit is one sentence of prose on `/portal/transfer`, a page B-090b already added to the axe sweep (`e2e/portal-transfer.spec.ts`). No new page, no new control, so the coverage claim naming exactly one exception stays true.

**Left behind.** **The lock is invisible in the audit trail** — `lease.transferred` records `newRateCents` but not that it came from a quote rather than today's street rate, so a later reconciliation cannot tell a locked settlement from a coincidence. **Nothing alerts staff when the two diverge**: an operator who raises rates does not learn that three live holds are still settling at the old figure. Both are small and neither has bitten; the first is one audit context key when something needs it.

---

## B-137 — A transfer must carry the tenant's protective state, not just their rate

`b33454b`

**What it built.** `completeTransfer` copied rate, autopay, protection, billing day and `paidThroughDate` onto the new lease and stopped there, so every `LeaseHold` was left behind on the lease the transfer had just ended. An active-duty tenant who changed units came out with `activeDutyMilitary = true` and no `military_scra` hold, the delinquency engine's `onHold` check passed, and the ladder ran on a servicemember whose own file records that we were told. The same for `bankruptcy`, `deceased` and `litigation`. Separately, `OCCUPYING_LEASE_STATUSES` includes `pending_auction` and the tenant-facing transfer scoped on it, so a tenant whose goods were being prepared for sale could move them into another unit by clicking twice. Both are closed.

**Holds are copied onto the new lease, not re-pointed.** The old lease keeps its own, so the record of what was in force while it ran stays true, and `effectiveFrom` is carried unchanged — an automatic stay started when it started, not on the day somebody changed units. Type, reason text, both effective dates, the supporting `documentId`, `placedByStaffId` and the estate contact all move; each copy is audited as `hold.placed` naming the hold and lease it came from, and `lease.transferred` gains `carriedHoldTypes` so the move is answerable from one record.

**"Still in force" is deliberately wider than `holdIsActive`.** A hold whose `effectiveFrom` is in the FUTURE is a commitment already recorded, and evaluating in-force-ness at the transfer date would silently drop it. Only lifted holds and holds whose `effectiveTo` has already passed are left behind. Fail-safe is the correct direction here: the cost of carrying one hold too many is a manager lifting it, and the cost of carrying one too few is the ladder running on a protected tenant.

**The declaration re-syncs through the same path a move-in uses.** `syncActiveDutyHolds` is called inside the transaction rather than the flag being read a second time — the guard `active-duty.ts` documents ("reads the flag ITSELF rather than trusting the caller") is the reason there is no second reading. It is idempotent, so the SCRA hold carried above satisfies it and nothing is placed twice; it earns its keep on a lease whose hold was lifted, or that predates B-121, where the declaration stands and the new lease would otherwise open bare. Its reason line is a new `transfer` source rather than a reuse of `checkout` — nobody signed anything that day, and the staffer reading the banner needs to know where the declaration came from.

**The portal refusal is a narrowed status list, not a check bolted onto the shared arithmetic (D-85).** `PORTAL_TRANSFERABLE_STATUSES` is `OCCUPYING_LEASE_STATUSES` minus `pending_auction`, and only `lib/portal/transfer.ts` uses it. `previewTransferFor` is untouched on purpose: **D-85 settled the staff side the other way** — staff MAY transfer a lien-pipeline lease — so a refusal in the shared function would have blocked the wizard the decision deliberately allows.

**Two places deliberately still use the wide list.** `requestTransfer` finds the lease on the wide set and then refuses it by name as `lien_pipeline`, because a `not_found` would tell a tenant we cannot see a unit they are standing in and send them nowhere; the copy names the lien process and points at the office, which is the only route D-85 allows. And `cancelTransferRequest` stays wide: a tenant who asked for a transfer and then entered the pipeline must still be able to withdraw it, or the hold strands a unit nobody can rent.

**The lease is listed, not hidden.** `tenantTransferLeases` carries a `transferable` flag rather than filtering the row out — a tenant with one unit would otherwise be told "we don't see an active unit on this account", which is false and a dead end. The chooser renders it as text with the office's number instead of a link, and selecting it renders a refusal panel instead of the picker.

**Test verification.** Unit suite **3,437 passing, 8 skipped of 3,445** — +10 on B-136's 3,427, all against real rows: five on hold carrying (open, future-dated, lifted, expired, and the SCRA no-double-place) and five on the lien pipeline (refusal by name, no options and no preview, still listed as not transferable, the staff wizard still able to do it, and cancel still working). **Run twice, identical both times**, per this repo's rule for a suite that touches shared state — the SCRA cases mutate a suite-owned tenant's `activeDutyMilitary` and restore it in a `finally`. Typecheck clean across app, `tests/` and `e2e/`; schema drift clean (no migration — `LeaseHold` already existed).

**No accessibility statement change, and the page was re-read rather than assumed.** B-137 adds a customer-facing STATE, not a page: `/portal/transfer` is already in the axe sweep, and the refusal panel is a heading, a sentence and a back link. Scanning that state specifically was considered and refused — it renders only for a `pending_auction` lease, whose one demo tenant has no portal credential, and minting one to scan a paragraph is a fixture nobody else needs. **B-156 owns the general gap** (data-dependent and post-interaction states are scanned almost nowhere) and is where this should close.

**What it decided, and a later session must not silently reverse.** Holds are COPIED and the old lease keeps its own. In-force-ness for carrying is wider than `holdIsActive`. The lien-pipeline refusal lives in the portal module only, because the admin wizard is meant to reach it.

**Left behind.** **The staff half of D-85 is not built and is now B-157** — staff may transfer a `pending_auction` lease today with `leases:transfer` alone, which satisfies Option A's authority level by accident but records no reason code and asserts nothing about the lien clock. **Collections still stop on a transferred tenant who owes money** — the arrears sit on the lease this item just ended; that is B-138, the permissive half, deliberately shipped second per B-091's rule. **A carried `deceased` hold brings its estate contact but nothing re-checks it**, and **`documentId` is carried by reference**, so two leases now point at one document — correct, and worth knowing if retention ever deletes by lease.

---

## B-138 — Collections must survive a transfer

`0063e42`

**What it built.** The permissive half of B-137's split, second by B-091's rule. A transfer ends the old lease, so the delinquency engine halted it as `moved_out` while the new lease had no invoices and 0 days past due — **collections stopped entirely on a live tenant who owed money and had never left the property**, and asking for a unit swap was a way to age out of the ladder. Per D-86 the arrears now move with the tenant: the unpaid invoices are re-pointed at the new lease, the balance follows them, the ladder resumes at the step it was on, and the late-fee ladder does not charge its steps a second time.

**Which invoices move, and why the part-paid one has to.** `open` and `partially_paid` — the same two statuses `leaseLedger` already calls outstanding, so the ledger screen and the transfer cannot disagree about what is owed. `uncollectible` and `void` stay: one has been written off and the other never existed, and carrying either would resurrect a claim somebody already closed. The partially paid one moves because allocation is oldest-first, so the part-paid invoice **is** the `daysPastDue` anchor (D-25) — leaving it behind would reset the clock to the next invoice's due date, which is the defect in miniature.

**The balance follows as a pair of `adjustment` entries per invoice, not one lump sum — and that is the whole design.** Each half carries the invoice's id, so `leaseLedger`'s reconciliation counts it against that invoice. A single lump-sum entry has no invoice behind it, lands in the "uninvoiced charge" term both reconciliation callers compute, and would make **every transferred lease report a discrepancy exactly equal to its arrears**. Nothing already posted is edited: the original charge stays on the old lease, where it was raised, and the old lease's arrears net to zero.

**What deliberately does NOT move, and the new column that made that possible.** `Lease.transferredFromLeaseId` (migration `20260821163335_lease_transfer_link`). Two pieces of collections state are not invoices: a `DelinquencyStepRun` — evidence that a notice went out on a date, against a lease that names a unit, where re-pointing the row would make the record of a served notice name a unit it never named — and a **paid** late-fee invoice, which is settled history recording that step N was already charged. Both stay put; `apps/web/lib/billing/transfer-chain.ts` walks the link and the two ladder readers use it. That is D-86's own recommended shape ("A with B's audit trail bolted on"): every money reader — ledger, aging, statements, notices, autopay, dunning — is unchanged, and only the two readers whose state is evidence learned about the link.

**The late-fee re-charge was created by this item and fixed in it.** Before B-138 the new lease had no unpaid invoices, so `assessLateFees` saw `overdue <= 0` and skipped. Moving the arrears gives it the full age with no record of the steps already charged, and it would have charged step 1 through N again on the new lease for the same delinquency. Both new ladder tests were verified to FAIL with their chain read removed, so the pair actually separates the behaviours.

**The dunning ladder needed nothing, and that is worth recording.** `runDunning` keys `alreadySent` on the **anchor invoice's id**, not on the lease, and loads every lease at the facility regardless of status — so the moment the invoice moves, its ladder position moves with it. Invoice-keyed state survived the change for free; lease-keyed state did not. That is the distinction to check first for any future reader.

**The new lease carries the tenant's standing, not a fresh `active`.** `pending` becomes `active` because a transfer completes a move; `delinquent` and `pending_auction` carry, along with the `delinquencyTimelineId` pin. A lease that opened `active` beside three unpaid invoices would read as current on the tenant list, the dashboard tile and the AR screen while the ladder ran on it. The timeline pin carries for the same reason the step history is read through the chain: an episode that began under timeline v3 stays governed by v3.

**Test verification.** Unit suite **3,447 passing, 8 skipped of 3,455** — +10 on B-137's 3,437, run twice with identical totals. Typecheck clean across app, `tests/` and `e2e/`; lint 0 errors; **schema drift clean** with the new migration applied to dev, `storage_test` (`db:migrate:test`) and the e2e `public` schema (`db:migrate:e2e`).

**One unexplained failure, recorded rather than explained away.** `tests/manual-adapter-db.test.ts > escalates one that has sat past the SLA` failed once, mid-way through this item, with `manualQueue` returning an empty list where the test's own `beforeEach` had just created the task. It passed alone immediately after and in four subsequent full runs, and nothing in this item touches the gate queue, `drainGateCommands` or `Task` outside `type: 'delinquency_step'`. **The cause is not confirmed.** It is written down because a one-off green re-run is exactly how a real intermittent bug gets closed as noise.

**No accessibility statement change.** Nothing customer-facing was added: what a tenant sees differs (a transferred lease now shows the balance that came with them) but it is data rendered by screens already in the scan.

**What it decided, and a later session must not silently reverse.** Money state follows the tenant by moving the row; evidence state stays where it happened and is read along the link. The balance carry is per-invoice so reconciliation keeps working. `pending` is the only status that does not carry.

**Left behind.** **An overlock still outlives the transfer** — `releaseOverlock` is called with the curing lease's id, and the lock was fitted to the old unit under the old lease; that is **B-151**, which owns overlock release on lease end, and this item deliberately did not widen it. **The auction case stays on the old lease** when staff transfer a `pending_auction` lease, so the lien clock is not yet demonstrably continuous — **B-157**, which owns D-85's staff side, including that guarantee. **`reconcile`'s "uninvoiced" term already mis-counts a partial payment** against an invoiced charge (it treats every payment entry as uninvoiced), which is pre-existing and unrelated to the move but is the reason the per-invoice pairing mattered enough to test. **The transfer chain is capped at ten hops** — a deeper chain reads its oldest steps as unexecuted, which is the pre-B-138 behaviour rather than a new failure.

---

## B-139 — The accessibility statement was overstating, and its exception list was hand-written

`942a4ad`

**What it built.** The public accessibility page named exactly one coverage exception — the checkout confirmation screen — while `/portal/refer`, a static page linked from the portal nav on **every** portal page, was in no axe scan and disclaimed by nothing. That sentence was false in the overstating direction. Four more routes were unscanned and unstated. The exception list is no longer written on the page: it is rendered from `apps/web/lib/a11y/scan-coverage.ts`, where the scan lists the e2e specs loop over now also live, and `tests/a11y-scan-coverage.test.ts` fails when a route under `apps/web/app` appears in neither.

**Why the lists moved rather than the sentence being corrected.** Correcting the sentence would have bought about twelve days. The page has now gone false in **both** directions inside that window, and both times the cause was structural rather than careless: the page describes work that lives in three spec files, so it goes stale on a **merge** rather than on an edit, and nothing fails. Coupling the two is the only fix that survives the next merge.

**Four routes joined the scan set rather than the exception list.** `/portal/refer`, `/portal/pay/done`, `/confirm-email`, and `/checkout/resume/not-a-real-token`. The bar for an exception is that scanning is genuinely blocked, not that it is awkward — `/portal/refer` was awkward. All four pass axe, 320px reflow, 200% zoom and forced text spacing on both the desktop and mobile projects: **34 e2e checks, all green**, run before the scan set was claimed to be clean.

**The test asserts four things, not one**, because the failure mode is symmetrical. Nothing uncovered; **no exception for a route that no longer exists** (the overstatement in the other direction — telling a visitor a page is unchecked two releases after it was deleted); no scanned URL the app does not serve; and every route recorded as "scanned by its own spec" still has a file that runs axe against it. That last one is the anti-rot check for a claim that had already rotted once: `admin.spec.ts` carried a comment asserting every dynamic admin route was covered elsewhere, and it was an overstatement for months until B-083 noticed the per-lease notices route had no scan anywhere.

**A dynamic pattern is not satisfied by a static URL.** `/admin/units` must not count as coverage of `/admin/[section]`, or the placeholder catch-all reads as scanned when nothing ever rendered it — the same "covered by something nearby" mistake the item exists to stop. The matcher excludes any URL that is itself a static route.

**It is a unit test, deliberately.** No browser, no database, so it runs in the **fast CI lane on every push** rather than in the 30-minute e2e lane that only runs on merges to `main` and on ready PRs. The thing it guards against is a missing list entry, not a broken page.

**`LAST_REVIEWED` is still not bumped, and that was the harder call.** The date is a claim about the whole page, and the "where we fall short" list — the JavaScript-less hold countdown, the unpaginated staff lists, the two maps — was not re-verified by this item. The coverage claim no longer needs a date because a test now checks it continuously; those three still do, and dating them off the back of this work would be the understating failure this page has also already made.

**Test verification.** Unit suite **3,453 passing, 8 skipped of 3,461** — +6 on B-138's 3,447, one new file. The coverage test was verified to FAIL with `/portal/refer` removed from the scan list, naming that exact route, so it separates the behaviour it claims to. Typecheck clean across app, `tests/` and `e2e/`; lint 0 errors; schema drift clean (no migration). Targeted e2e: 34 checks on the four new routes and 10 on the rewritten `/accessibility` page plus two admin routes, confirming the three edited specs still load their lists through the new import.

**One infrastructure failure in four full runs, recorded rather than smoothed over.** Run 2 of 4 failed `tests/marketplace-db.test.ts > gives an absolute URL` with `Timed out fetching a new connection from the connection pool` inside `availableCountsByUnitType`. That is a Prisma pool timeout under parallel load against the remote database, not a logic failure, and this item adds only a filesystem-only test file. Runs 1, 3 and 4 were green with identical totals. It is written down because the repo has one other unexplained intermittent (B-138's manual-adapter case) and two of them is the point at which a pattern is worth watching rather than dismissing.

**What it decided, and a later session must not silently reverse.** The scan lists and the exception list live in one module and the page renders from it — a route added to a spec's own array instead is a route the page will not mention. An exception needs a reason written for a visitor, and the test enforces that it reads as a sentence rather than a route.

**Left behind.** **Post-interaction states and parameterised routes are still not systematically scanned** — FR-25 parts (1) and (2), owned by **B-156**; this item built part (3) only, and its `SCANNED_BY_OWN_SPEC` list is the manual bridge until then. **The page still says the automated tests "run on every change"**, which is true of everything that reaches `main` but not of every push to a draft PR, where only the fast lane runs; left as written because the sentence is about what ships, but it is the next thing to look at if the lane split moves again. **`/portal/pay/done` is scanned only in its not-found state** — its four receipt outcomes need a real payment, and that is a state gap, not a route gap.

---

## B-140 — A transfer hold was emailed a move-in reminder for a move-in that was not happening

`0bde0aa`

**What it built.** `sendExpiringSoonReminders` selected every `status: 'held'` reservation with no `source` filter, so a transfer hold (D-82, `source: 'transfer'`) got the same `reservation.expiring_soon` email as a prospect's own hold — copy that says "use the link from your original confirmation email to complete your move-in online," a link D-82 deliberately ensures never exists for a transfer, and never states when the hold actually expires. The sweep now branches on `source` at the point it emits: a transfer hold fires a new event, `reservation.transfer_hold_expiring_soon`, wired to its own template (`transfer_hold_expiring_soon`) that names the unit, the absolute facility-local expiry time (PRD 01 §6.8.1 — never a countdown), and sends the tenant to the office rather than a link. A web hold is unaffected — same guard (`expiryReminderSentAt`), same window, only the emitted event's name differs. The context extender that supplies `reservation.expires_at` is shared between both events (`reservationExpiresAtContext` in `apps/web/lib/comms/service.ts`) since both read the same recipient shape.

**Every other reader of `Reservation.status: 'held'` now carries a comment declaring which sources it serves**, per CN-23's acceptance line — `expireReservations`'s own sweep (serves every source deliberately: expiry is the same fact regardless of what made the hold), the unit-status board's held-reservation query (`admin/units.ts`, serves every source: a unit is genuinely held either way), and the facility-moves report (`admin/reports.ts`, serves every source: an aggregate count, not a message). `reserveUnit`'s duplicate guard already excluded transfer holds with its own comment from B-090 part 2 — left untouched.

**What it decided.** One sweep, two events, branching only at the `emitEvent` call — not two separate sweep functions — because both events share the same dedup guard and window, and `expireReservations` already established the pattern of branching on `source` inside a single loop rather than splitting the query.

**Test verification.** Full unit suite **3,456 passing, 8 skipped of 3,464** — +3 on B-139's 3,453 (two new `reserve-db.test.ts` cases asserting a transfer hold gets exactly `reservation.transfer_hold_expiring_soon` and a web hold gets exactly `reservation.expiring_soon`; the third is `merge-fields.test.ts`'s existing `it.each` over `COMMS_TEMPLATES` automatically picking up the new template). Typecheck clean, lint 0 errors (7 pre-existing warnings, unrelated), schema drift clean (no migration — no schema change).

**Left behind.** Nothing new opened. B-140 was itself opened by the operator review that found this gap; no further gap surfaced while building it.

---

## B-141 — "Complete" on `/admin/tasks` silently did nothing when the note was empty

`8f009f8`

**What it built.** `completeTaskAction` discarded `completeTask`'s `{ ok: false, missingFields }` refusal — its own signature was `Promise<void>`. The note input on `/admin/tasks` had no `required` while all three sibling queues (delinquency, access queue, walkthrough) did, so a blank submit hit the service's refusal branch every time, and nothing told anyone: the button was pressed, the page re-rendered identically, and the task stayed open. `completeTaskAction` now returns `FormState` (the FR-19/FR-20 apparatus B-094 built) instead of `void`, mapping `missingFields` to field-level messages. A new shared client component, `TaskCompleteForm` (`components/admin/task-complete-form.tsx`), wraps `AdminForm`/`Field` — one instance per task card, since each card's completion is its own independent submission — and replaced the four near-identical hand-rolled `<form>` blocks across `/admin/tasks`, `/admin/delinquency`, `/admin/access/queue` and `/admin/walkthrough`, all four of which share this one action. Every card's submit button now carries an `aria-label` naming its subject (e.g. "Complete: Returned mail — contact info may be stale, Dana Delinquent") instead of the bare, identical "Complete"/"Done at the keypad"/"Walked" a rotor would otherwise read once per row with no way to tell them apart (2.4.6, 4.1.3).

**What it decided.** One shared component across all four queues rather than fixing `/admin/tasks` alone — the backlog row scoped the *bug* to one screen (the missing `required`), but the PRD's own AC text ("every queue view over this list...") and the fact all four already shared the one broken action meant the accessible-name and live-region fix reaches every queue for the same diff.

**Test verification.** Full unit suite unaffected (`completeTaskAction` imports `@/auth` via `requireStaffActor`, so it is untestable under Vitest — same B-036 constraint `portal/transfer/actions.ts` documents — its coverage is e2e only). Added a new e2e case to `e2e/admin-tasks.spec.ts`: submitting a whitespace-only note (passes the `required` attribute, fails the server's trimmed check) surfaces a `role="alert"` naming what's missing, focuses it, and leaves the task open. Full targeted e2e run: **17 passed, 3 skipped (idempotent-per-day self-skips, not failures — the new test and the existing "flagging returned mail" test both self-skip when the demo queue has nothing open, per B-120's convention), 0 failed.** Typecheck clean, lint 0 errors, schema drift clean (no migration).

**Left behind.** Nothing new. B-156 (already queued, ordered after this item for exactly this reason) is the systematic version of the check this item's e2e test hand-writes once.

---

## B-142 — The portal transfer screen swallowed failures, stated no expiry, and had no date ceiling

`8f009f8`

**What it built.** Four merged findings, all in the tenant-facing transfer flow:

1. **A failed preview re-rendered byte-identical.** `page.tsx` kept only `previewResult.preview` and dropped `.problem` on the `ok: false` branch. Now captured and rendered as `role="alert"` with the same `TRANSFER_PROBLEM_COPY` the admin wizard already used — moved to a new exported `PORTAL_TRANSFER_PROBLEM_COPY` in `lib/portal/transfer.ts` (a `'use server'` file may only export async functions, so the dict that used to live in `actions.ts` couldn't stay there once the page needed it too).
2. **No date ceiling.** Neither a `max` on the input nor a server-side check existed. `requestTransfer` now enforces the same `MAX_MOVE_IN_DAYS_AHEAD` window the public reserve page has always enforced, refusing with a new `date_too_far_out` problem. Built as UTC day math (matching the function's own existing `date_in_past` check and `transferDate` itself, always minted as UTC midnight) rather than copying `createReservation`'s local-time version verbatim — the first attempt did copy it verbatim and failed its own boundary test under this machine's non-UTC local timezone, which is exactly the drift UTC math avoids.
3. **The hold expiry was never stated, and the admin wizard actively misstated it.** `TransferHold`/`PendingTransferRequest` now carry `expiresAt` (plus `facilityTimezone` where needed); the portal's pending screen and the admin wizard's banner both name the absolute facility-local expiry. The admin wizard's "that unit is held for them until you complete or cancel it" was replaced — it was false, the hold also lapses on its own, D-84/B-136's own precedent.
4. **The raw `×` inside the radio's accessible name, and a pending transfer/move-out invisible on `/portal`.** The unit-size text now uses the two-span `aria-hidden`/`sr-only` pattern already shipped on the public reserve page and the portal dashboard itself. `portalDashboardForTenant` gained `pendingMoveOutDate` and `pendingTransfer` fields (the latter reading the same `Reservation` hold `lib/portal/transfer.ts` does), and `/portal`'s `LeaseCard` renders a `role="status"` block for either, linking to the screen that manages it — both were two taps behind the portal nav's "Manage" disclosure with no way to tell "did that go through" without opening it.

**What it decided.** The date ceiling and the false-claim fix both needed the hold's real `expiresAt` threaded further than the bug report implied — `TransferHold` (shared by admin and portal) gained the column-backed field rather than each site computing it separately, so the admin wizard and the portal screen now read the same fact rather than two independent guesses at it.

**Test verification.** New unit tests: `tests/portal-transfer-db.test.ts` (date-ceiling refusal and its boundary-day acceptance), `tests/portal-dashboard.test.ts` (pending move-out and pending transfer both surfaced, both null otherwise). Targeted suite (`portal-transfer-db`, `transfer-db`, `portal-dashboard`, `reserve-db`, `merge-fields`): **60 + prior passing, 0 failed.** Full unit suite: **3,458 passing, 8 skipped of 3,466** — +2 on B-141's baseline. Targeted e2e (`portal.spec.ts`, `portal-transfer.spec.ts`, run alongside B-141's `admin-tasks.spec.ts`): **135 passed combined, 0 failed**, including WCAG scans of `/portal` and `/portal/transfer` with the new live regions and status blocks in place. Typecheck clean, lint 0 errors, schema drift clean (no migration — `expiresAt` was already a column, only the select/type surface changed).

**Left behind.** No admin-side e2e spec exists for `/admin/tenants/[tenantId]/transfer` — its false-claim fix is covered only by `tests/transfer-db.test.ts` (the underlying data) and by reading the rendered copy in this session; a future accessibility or UX pass over the admin transfer wizard should add one. The `/portal` pending-transfer/move-out panels reuse `formatDueDate`'s existing date-only formatter for the "asked to move on" line and a new `formatExpiry` for the hold's own absolute time — two formatters doing adjacent jobs on the same card, left as two rather than merged, because one names a plan and the other names a deadline and collapsing them would blur which is which.

---

## B-156 — The scan contract II: post-interaction states, parameterised routes, and a control that does nothing

`9a6d580`

**What it built.** The three structural gaps PRD 02 §5.5 FR-25 named, all reasons `/admin/tasks` shipped a dead button green even after B-119/B-139 made the scans cover the routes they claimed to:

1. **Post-interaction states.** `smoke.spec.ts`'s checkout walk now opens the promo box's `<details>`, submits an invalid code, and scans the refused state — B-122's promo box had never been scanned open at all, only its resting state riding along on the routes around it. Used the existing mechanism (`assertNoAxeViolations`, already called after every wizard-step `advance`) rather than inventing a second one — the gap was that it was never called on THIS interaction, not that the mechanism didn't exist.
2. **Parameterised routes.** `/admin/tenants/[tenantId]/transfer` was in `SCAN_EXCEPTIONS` claiming it "needs a live tenant and an available unit" — the same requirement `/admin/tenants/[tenantId]/move-out` has always met by reaching it through a real click-through. The reviewers named this one specifically as "in no scan at all." New `e2e/admin-transfer.spec.ts`, modeled directly on `admin-move-out.spec.ts`: scans the wizard reached from Dana Delinquent's profile, and a second test that picks a unit, recalculates, and scans whichever real state comes back (priced settlement or refusal — both are real post-interaction states worth scanning, and either confirms the round trip happened rather than silently doing nothing). Moved from `SCAN_EXCEPTIONS` to `SCANNED_BY_OWN_SPEC`; `tests/a11y-scan-coverage.test.ts` needed no changes — it already verifies `SCANNED_BY_OWN_SPEC` entries the same way it verifies everything else.
3. **A control that does nothing.** New `e2e/a11y-helpers.ts`: `expectPreexisting`/`expectAnnounced`, generalizing B-110's one-off "captured before, asserted after" pattern into something other specs can import. Applied to `/portal/contact`'s address-save test (already existed; retrofitted to assert the live region was attached and empty *before* the submit, not just populated after).

**What it decided, and why the scope stopped where it did.** `expectPreexisting` only works on a region that is unconditionally mounted. `AdminForm`'s success `role="status"` paragraph is (empty at idle, always present, B-111's own fix); its error/confirm summary is **not** — it is conditionally rendered only once `state.status` becomes `'error'`/`'confirm'`, which means the very first failure on any admin/portal form inserts that live region into the DOM already populated, the exact failure FR-20's own comment in `form.tsx` warns against. This was found while building this item, not assumed: the first draft of the "control that does nothing" demonstration used `/admin/tasks`'s task-completion flow, which is the actual B-141 bug class, but that flow also removes the completed task's card from the list on the same update — an actual risk that the success text might never get a chance to render before its container unmounts, not merely an inconvenient test target. Rather than fix `AdminForm` blind — it is the shared component behind essentially every admin/portal form in the product, and making its error region unconditionally mounted the same way as success means giving it a permanent bordered box that would show empty on every idle form site-wide, a real visual cost across dozens of screens with no way to verify it from a text-only session — the demonstration moved to `/portal/contact`'s address save, a success case that keeps its form mounted, and the `AdminForm` gap is left named rather than silently worked around or silently ignored.

**A real bug found and fixed along the way, unrelated to the three findings above.** The first version of the promo-box test used `page.getByLabel('Promo code')`, which resolved to two elements — the input AND the `<form aria-label="Add a promo code">` wrapping it, because Playwright's accessible-name matching is a case-insensitive substring match by default and "Add a promo code" contains "Promo code". Fixed with `exact: true`, the same fix this same file already carries a comment about for the Payment-step heading — a second instance of the identical footgun class, not a new one.

**A pre-existing flakiness class surfaced, not caused, while verifying this item.** `smoke.spec.ts`'s checkout walk failed twice under the default 2-worker run — once with "That size isn't available here any more" (the two projects racing for the same specific demo unit) and once, on the unmodified baseline code, with a Prisma unique-constraint violation on `email` (the two projects' `Date.now()`-based "unique" emails colliding under the same millisecond). Confirmed via a stashed-changes baseline run that both failure modes exist independent of anything in this item — the baseline run without any of B-156's edits failed the identical way. Every verification run after that used `--project=desktop-chrome --workers=1`, which is not how this suite runs in CI or in a normal sweep; **the suite as configured today can flake on this specific test under 2-worker parallelism**, for reasons that predate this item and are not fixed by it.

**Test verification.** `tests/a11y-scan-coverage.test.ts`: 6 passed (unchanged pass/fail shape, now covering the transfer wizard's new spec entry instead of its old exception). Full unit suite: **3,458 passing, 8 skipped of 3,466** — unchanged from B-142's baseline; this item added no unit tests, only e2e. Targeted e2e, isolated to rule out the parallelism issue above: `smoke.spec.ts`'s full file, single-worker, single-project — **69 passed, 0 failed**. Combined multi-worker pass over every other touched spec (`admin-tasks`, `admin-transfer`, `portal`, `portal-transfer`): **134 passed, 0 failed**. Typecheck clean, lint 0 errors, schema drift clean (no migration — no schema touched).

**Left behind.** **`AdminForm`'s error/confirm live region is not pre-mounted**, unlike its success region — a real FR-20 gap affecting every admin/portal form in the product, found by this item and deliberately not fixed by it (see above). Fixing it safely needs a visual check this session couldn't do, not just a code change. **The 2-worker race in `smoke.spec.ts`'s checkout walk** (shared demo-unit contention and a colliding email-uniqueness scheme) is pre-existing and unrelated to this item's edits, but was directly observed while verifying it and is worth a future item's attention — right now a `desktop-chrome`/`mobile-chrome` run of just this one test can fail for reasons that have nothing to do with the code under test. **No general enumerable mechanism exists for "post-interaction states are scanned"** the way `SCANNED_BY_OWN_SPEC` enumerates routes — an interaction has no URL a filesystem walk can discover, so this item closed the one concrete gap named (the promo box) using the existing `assertNoAxeViolations` pattern rather than building a completeness-checker for an unenumerable set; a future flow that opens a disclosure or shows a refusal state still needs someone to remember to scan it, the same as before, just with one fewer known gap.

---

## B-143 — An inbound text is readable in full where its task links

`3239353`

**What it built.** B-135 routed an inbound SMS to the task queue and put its first 80 characters on the card. The rest of the message went nowhere: `sms.inbound_received` had an emit site (`apps/web/lib/comms/sms-inbound.ts`) and a catalog entry, and **no read site anywhere in the codebase** — verified by grep before touching anything. A tenant's third sentence, the one with the unit number in it, was in the database and reached no human.

The card's `href` has always pointed at `/admin/tenants/{tenantId}`, so the fix put the words there rather than inventing a screen:

- `tenantProfile` (`apps/web/lib/admin/tenants.ts`) gained an `inboundSms` array, read from `sms.inbound_received` events matched on `entityType: 'Tenant'` / `entityId: tenantId` — the pair `routeInboundSms` already sets and the `[entityType, entityId]` index already covers. Added to the existing `Promise.all`, so the profile costs the same number of round trips it did before plus one, in parallel with the rest.
- The phone is masked with `maskAddress` (CN-18), the same function the outbound `toAddress` already uses. The whole number stays on the event, which is the record.
- The tenant profile's **Communication history** section now renders inbound and outbound as one list, sorted newest-first, rather than two stacked lists.
- The false comment in `task-subjects.ts` is corrected and now says what happened, so the same gap is not re-created by a future truncation.

**What it decided.** **One interleaved list, not a separate "Inbound texts" section.** Two stacked maps were the first draft and were wrong for a reason worth recording: they would have put every inbound text above every outbound one regardless of date, which is a worse lie than the truncation being fixed. A conversation split across two lists is not a conversation, and US-13's "any staffer can pick up any conversation" is the acceptance criterion this section exists to meet.

**Inbound bodies render open; outbound stay behind `<details>`.** The outbound collapse is deliberate and stays — twenty full template bodies on one page is unreadable, and the send log is evidence rather than something anyone reads front to back. An inbound text is the opposite: the words are the reason the staffer is on the page at all, and one more click to reach them is the defect this row names. Direction is carried in words ("Text from this tenant"), not only by the left border colour (1.4.1).

**No new table, no `direction` column, no second queue.** D-78 declined the two-way inbox and D-83 chose the domain event as the home for the words; this item reads what D-83 wrote and adds no storage. `Message` is still outbound by construction.

**A note on what "correct the false comment" meant.** The comment claimed a screen that did not exist, and the correction is not a deletion — it now records that the claim was false, for how long, and what makes it true, so the pairing (truncate here / render in full there) is visible to whoever next edits either side.

**Test verification.** One new test in `tests/sms-inbound-db.test.ts` — it follows the exact `href` the neighbouring B-135 test pins, sends a >80-character body, and asserts the full text comes back from `tenantProfile`, that it contains the part the card could never show, that the row's id is the one the task names (so a staffer arriving from the queue reads the message they clicked and not merely the tenant's most recent), and that the phone is masked. File: **8 passed**, run twice for repeatability per this repo's shared-database rule. Full unit suite: **3,459 passed, 8 skipped of 3,467** — one more than B-156's baseline, which is this item's single test. Lint 0 errors, `prisma migrate diff` reports no difference (no schema touched), production build clean.

**Correction, made while building B-144.** The line above originally claimed "typecheck clean (including `tests/` via `tsconfig.tests.json`)". That claim was false as shipped. Typecheck was run **before** the new test was written and never re-run afterwards, and the test imported `PermissionKey` from `@storage/core/rbac` — a module that has never existed; the neighbouring suite reads it from `@storage/db/rbac-catalog`. It went undetected because `import type` is erased at transpile, so Vitest ran the file and passed it. Fixed in B-144's commit and confirmed the check does catch it: restoring the bad path reproduces `TS2307` on that exact line, so this was a missed step and not a hole in `tsconfig.tests.json`. The rule this repo already learned in B-119 — that the test directories are only covered because that config includes them — holds; it just has to be run **after** the last edit, which is the part that failed here.

**Left behind.** **An unmatched number's message is still readable only in the database.** `routeInboundSms` writes the event with `entityId: 'unmatched'` and deliberately raises no task, because `Task` requires a facility and there is no honest one to pick — so there is no card, no tenant profile, and nothing this item's read path can hang off. That is unchanged from B-135 and is a real gap: somebody texting "do you have a 10x20?" from a number we do not hold is a lead, and it reaches nobody. It wants a facility-wide or site-wide surface, which is a decision about which screen owns unattributed inbound, not a rendering change. **No reply path.** Staff can now read the message; answering it still means picking up a phone. That is D-78's settled position (the volume does not justify an inbox at 2–10 facilities) and this item does not reopen it. **The list is capped at the last 20 inbound events**, matching the existing 20-message cap beside it, with no paging on either — fine at current volumes, and the cap is in one obvious place when it stops being.

---

## B-144 — A promotion can carry a minimum stay, and say so

`e3aadcb`

**What it built.** `Promotion.minStayMonths` shipped with B-070 and had, at the start of this item, **zero references outside `schema.prisma`** — re-verified by repo-wide grep before anything was touched. Nothing could set it and nothing read it, so "first month free with a six-month minimum" could not be expressed at all: the operator gave the month away unconditionally or did not run the promotion. This is the row that gives it a control; the recapture is B-145.

- **The form field.** `/admin/settings/promotions` gains a "Minimum stay" number field (0–24, default 0), parsed with the same `parseScaled` every other number on that form uses. The promotion list line now names the minimum beside the existing "new customers only" and date range.
- **The validation.** `createPromotion` refuses a minimum shorter than the discount duration. "First three months free, one-month minimum" gives away three months and holds the tenant to one — a condition that protects nothing and that B-145 could never recover from. Refused at the form rather than discovered on a final statement.
- **The minimum on the checkout summary.** New `withMinStay()` in `packages/core/promotions/schedule.ts`, applied in `eligibility.ts` at the single point the terms string is produced. Every surface that already reads `terms` gets it for free — the facility-page badge, the checkout price-summary discount line, the "code applied" sentence, and the operator's own list.
- **The minimum on the lease.** `LEASE_TEMPLATE` §3 and the plain-language summary both hardcoded a sentence saying there is **"no penalty for leaving"**. That is a signed document flatly contradicting the condition the discount was given under, in the tenant's favour, on the one artefact that decides who is right. Both now render a `termSummary` merge field, filled in `lease/build.ts` from the promotion the checkout is running under.

**What it decided.** **The minimum is appended AFTER the terms string, not folded into `describeTerms`.** This is the load-bearing choice. `termsText` lets an operator write their own wording and it *wins* over the generated sentence — so a condition living inside `describeTerms` would vanish the instant somebody typed "First month FREE!" into the box, silently dropping a term the renter is held to and that B-145 charges money on. Appending at the one point terms are produced makes it survive the override. There is a test named for exactly that regression.

**The lease states the condition and not a consequence.** The sentence says the promotional rate "is offered on the basis that you keep this unit for at least N months" and stops there. It does **not** say the discount will be clawed back, because today nothing does that and B-145's per-facility recapture policy defaults to `none` — a signed sentence promising a charge the operator does not make is the same trap B-044's proration sentence fell into. When B-145 lands it extends this sentence; `build.ts` carries a comment saying so.

**`termSummary` is a merge field, not a second template.** `render.ts` is explicit that a template needing a conditional clause gets two templates, and this deliberately does not: the default text is byte-identical to what shipped before, so the ordinary no-promotion lease is unchanged. A blank value was never an option — `renderTemplate` throws on an absent *or empty* value (FR-6), so both branches say something.

**The minimum shows on the facility-page badge too**, which the row did not ask for and which follows from putting it in `terms`. Left in deliberately: a badge advertising "first month free" that omits the six-month condition is the misleading half of the same problem.

**Test verification.** Five pure tests in `tests/promotions.test.ts` (no minimum, generated wording, the `termsText`-override survival case, unchanged unconditional promo) and three in `tests/promotions-db.test.ts` — one walking the whole path the new field feeds (offer → session snapshot → the label `amountDueToday` puts on the promo line → `leaseValuesFor`'s `termSummary`), one pinning the unchanged default lease wording, one on the validation refusal including that nothing was written. Full unit suite **3,467 passed, 8 skipped of 3,475** (was 3,459/3,467 — the eight new tests). `promotions-db` run twice for repeatability per this repo's shared-database rule. Typecheck clean, lint 0 errors, `prisma migrate diff` no difference (the column already existed — no migration), production build clean.

**Accessibility page re-read** per the repo rule, since this touches customer-facing text. No change needed and none made: this item adds no route, no interaction state and no new component — a longer string in an existing label and an existing `<p>` in the lease — so the coverage claim `customerFacingExceptions()` renders is unaffected.

**A correction to B-143, made here.** B-143's entry claimed typecheck was clean including `tests/`. It was not: typecheck ran before that item's test was written and never after, and the test imported `PermissionKey` from `@storage/core/rbac`, which does not exist. `import type` is erased at transpile, so Vitest passed the file regardless. Fixed in this commit, B-143's entry above is corrected, and the check was confirmed to catch it — restoring the bad path reproduces `TS2307`. A missed step, not a tooling gap.

**Left behind.** **The clawback — B-145 owns it.** Today the minimum is stated on the offer, the summary and the lease, and leaving early costs nothing. That is a deliberate half, but it is the half that makes the other half honest: a column recording a term nothing enforces reads as enforced, which is why the lease sentence was written to claim no consequence. **No edit path for a promotion.** `createPromotion` and `setPromotionStatus` are the only writes there have ever been, so a minimum typed wrong means ending the promo and making a new one — pre-existing, unchanged, and now one field larger. **`minStayMonths` is not snapshotted onto the redemption.** The promo snapshot on a checkout session carries the discount *schedule*; the minimum is read live from the `Promotion` row. Fine while nothing can edit a promotion, but B-145 should snapshot it at redemption for the same reason the schedule already is — an operator changing the minimum must not retroactively change what a signed tenant agreed to.

---

## B-145 — Recapture when a promoted lease ends before its minimum stay

`93d4207`

**What it built.** B-144 gave `minStayMonths` a control, a place on the checkout summary and a sentence on the lease. Nothing enforced it — US-10's own parenthetical is "min stay implied by **recapture rules**" and there were none, which is worse than no column because it reads as enforced.

- **`Facility.promoRecapturePolicy`** (`none` / `full` / `prorated`, **default `none`**), migration `20260822030043_b145_promo_recapture_policy`, with its control on `/admin/settings` beside `prorateOnMoveOut` — the other money rule that only ever fires on the way out. Shipping the column without the control would have repeated exactly the mistake B-144 was raised to fix.
- **`packages/core/promotions/recapture.ts`** — pure: `monthsServed()` (completed months, with the anniversary day itself completing one) and `recaptureFor()`, which returns the amount, the months unserved, and **the sentence saying why**.
- **`recaptureForLease()`** in `lib/promotions/billing.ts` — the only place that reads all three rows the answer depends on: the redemption, the promotion's term, the facility's policy.
- **`settleMoveOut` takes `recaptureCents`** and adds it to the net balance, so it moves `amountDueCents`, `refundDueCents`, `canWriteOff` and `needsManagerOverride` exactly as a rent arrear would.
- **Both previews and both screens** — `/admin/tenants/[id]/move-out` and `/portal/move-out` — show the amount and the reason before anything is confirmed. `completeMoveOut` posts it as a `charge` ledger entry dated to the move-out, carrying the same sentence.

**What it decided.** **The recapture is computed from `appliedPeriods`, never from `totalCents`.** This is the load-bearing choice and it is the difference between a charge and a fabrication. A six-month 50%-off promo on a tenant who leaves in month two has *promised* six discounted periods and *delivered* two; `totalCents` is the promise. Billing the promise back would invent money nobody ever saved. `appliedPeriods` already exists for a different reason (it is what makes the nightly run re-runnable without paying a promotion twice) and is the honest record of what was actually given.

**The ledger description is the same string the screen showed.** One sentence, produced once in core and carried through the preview, the screen and the ledger row. A tenant who disputes the charge and a staffer who reads the ledger are looking at the same words — a description composed separately at the write site is how those two come to disagree, and there is a test pinning them equal.

**`none` is the default, and that is the decision, not an omission.** A facility that has not chosen a recapture rule must not start billing former tenants because a column appeared. Labelled as configuration per D-10 — no statute governs this and the lease term B-144 writes is what makes it collectable at all.

**A transfer recovers nothing — recorded as D-89.** The `MoveOutReason` enum's own comment already says "a transferred tenant is still a tenant". Implemented as an optional `reason` on `previewMoveOut`: the screen leaves it unset (a preview is asked before a reason is chosen, and a real departure is what it previews) and only `completeMoveOut`, which knows why, suppresses it. D-89 names the cost rather than mitigating it — see *Left behind*.

**The lease sentence was NOT changed to promise the clawback.** B-144 deliberately wrote it to state the condition and no consequence, because the policy defaults to `none`. That reasoning still holds per facility: a lease signed at a `none` facility must not promise a charge that facility does not make, and a single template cannot say both. So the sentence stays as B-144 wrote it and the recapture is disclosed where it is actually decided — on the move-out preview, before the tenant agrees.

**Test verification.** 23 new tests. 13 pure in `tests/promo-recapture.test.ts` (month-boundary arithmetic including the anniversary day and a back-dated abandonment; each policy; term met; no minimum; nothing given; the never-more-than-given cap; whole-cent rounding; the exact reason sentence). 4 in `tests/move-out-settlement.test.ts` proving the recapture reaches `amountDueCents`, eats into a refund rather than being collected beside one, can push a close over the write-off threshold into a manager, and is absent by default. 6 DB tests in `tests/move-out-db.test.ts` — applied-vs-promised, proration, the default policy, the served term, the ledger row matching the previewed sentence *and* the ledger sum equalling the previewed `netBalanceCents`, and the transfer exemption. Full unit suite **3,490 passed, 8 skipped of 3,498** (was 3,467/3,475). `move-out-db` run twice for repeatability. Typecheck clean, lint 0 errors, schema drift clean, production build clean. `db:migrate:test` run.

**One assertion I got wrong and corrected.** The first version of the ledger test asserted the lease closed owing $129.00. It closes owing −$181.00: the fixture is paid through August, so a March move-out earns a $310 proration credit that outweighs the recapture. The assertion was wrong, not the code — and the replacement is a better check than the original, pinning the post-close ledger sum to the previewed `netBalanceCents`.

**Accessibility page re-read.** No change needed. The new row is a `<dt>`/`<dd>` pair in an existing `<dl>` on an already-scanned route — no new route, no new component, no new interaction. It *is* a data-dependent state (it renders only for a promoted tenant leaving early), which the page's own comment block already discloses as a general gap named by B-137, so no claim on that page became false in either direction.

**Left behind.** **A transfer is an avoidable-charge path (D-89).** A tenant inside a minimum stay can transfer to the cheapest unit on site and leave the next lease owing nothing — the redemption stays on the ended lease and the new one carries no promotion. Closing it means deciding whether a promotion *follows* a tenant through a transfer, which also governs whether the remaining discounted periods survive the move; that is a bigger question than recapture and B-157 is the natural home. **`minStayMonths` is still read live from the `Promotion` row, not snapshotted at redemption.** Flagged in B-144 and still true. Safe only because nothing can edit a promotion; the moment an edit path exists, an operator changing the minimum would retroactively change what signed tenants agreed to. **Nothing recovers a discount on a lease that ends by auction or abandonment differently from one that ends by request** — the policy applies to all of them, which is the simple reading and may not be the operator's intent for a lien sale. Not guessed at; it wants an operator saying so. **No recapture appears on the lien-pipeline or auction settlement paths** beyond the ordinary balance, since those close a lease through their own code, not `completeMoveOut`.

---

## B-146 — A payment that came back

`37634a2`

**What it built.** `LedgerEntry.reversalOfId` had existed since B-002 carrying a schema comment citing FR-8 and was written by **no code**. `FeeType.nsf` had been configurable per facility since B-047 and was read by **no code**. So a bounced cheque or an ACH return left the money recorded as collected, the invoice reading `paid`, and the arrears invisible to `daysPastDue` — forever.

- **`apps/web/lib/billing/reversals.ts`** — `returnPayment()`. One transaction: the reversing ledger entry through `reversalOfId`, the allocations deleted, `recomputeInvoices` re-opening what the money had settled, the payment moved to a new `returned` status, and the configured NSF fee.
- **`PaymentStatus.returned`** (migration `20260822…_b146_returned_payment_status`) — its own state, not `failed`.
- **The NSF fee is raised as its own `kind: 'fee'` invoice**, the same shape `raiseFeeInvoice` uses for late fees. That is what makes it "waivable like any other fee" (US-21) for free — `waivableFees` lists fee invoices and `waiveFee` voids them — and collectable by autopay, which collects invoices and would never see a ledger-only charge.
- **The existing `settling_payment_failed` task**, not a new queue.
- **A control on the tenant profile**, beside the refund form and explicitly distinguished from it, plus `payment.returned` in the event and audit catalogs (`requiresReason`).

**What it decided.** **A returned payment is its own status, and every historical-cash query keeps counting it.** This is the load-bearing decision and it is the row's own warning arriving through a different door. The row warns that `refundPayment` pulls cash from the open drawer, so recording a bounce that way makes the till short by money that never left it. A new status has exactly the same trap: `drawerView` recomputes movements **live from payment status, for closed sessions too**, so if `returned` were merely excluded everywhere, a cheque that bounced on Thursday would silently drop off Monday's deposit slip and make a session somebody had already counted and signed off read as short. Each filter was therefore decided one at a time:

- **Included** (`returned` counts): the drawer's movements and cheque list, the deposits report, the POS day's takings, and the tenant's own payment list. These answer "what was in the till / what was banked / what crossed the counter", and a bounce is a later fact about money that really was there.
- **Excluded** (`returned` deliberately absent): `SETTLING_STATUSES` in allocation — nothing may read as paid on money that went back — and the **revenue report**, because D-25's economic occupancy is collected ÷ gross potential and a bounced cheque was not collected.
- **Excluded for free**, which is why the status earns its keep: `refundPayment`'s own guard and `refundablePayments` both test for `succeeded`/`partially_refunded`, so a returned payment becomes un-refundable with no new code. Giving back money the bank has already reclaimed would pay the tenant twice.

**`refunds:approve`, but NOT the refund monetary limit.** The permission is the existing "move money backwards" gate and is manager-and-above, which is right for something that re-opens invoices and charges a fee. The *limit* is deliberately not applied: a refund limit exists because a staffer chooses the amount, and here the bank chose it. Refusing to record a $2,000 returned cheque because it exceeds somebody's limit would leave it recorded as collected, which is the defect this row exists to fix rather than a control.

**The task type deviates from the row's literal wording, and the reason is in the row's own rule.** B-146 asked for the existing `failed_payment` task. `failed_payment`'s catalog entry is labelled *"Payment failed — autopay has stopped retrying"* and its comment scopes it to a card decline "where nobody was ever told the money arrived" — which reads wrong on a bounced cheque. `settling_payment_failed` already exists (B-103) and its own comment describes precisely this conversation: "a tenant who has a receipt, may have been let through a gate on it, and will now start getting dunning letters." Using it honours US-41's actual rule — one queue, not a new type per source — better than the literal type name would. Its label was widened from "A bank payment bounced after it was accepted" to "A payment bounced after it was accepted", since it now covers cheques and lost disputes too.

**`adjustment`, not `refund`, for the reversing entry.** A `refund` entry means money we handed back, and the revenue report reads it as money out. Nothing left the building. The sign is positive because the tenant owes it again, and `reversalOfId` carries the precise meaning.

**What B-103 already covered, which the row's "no returned-payment path at all" slightly overstates.** `reconcile.ts` handles an ACH accepted and then failed *before* settling: the payment sits at `processing`, which is outside `SETTLING_STATUSES`, so nothing was ever marked paid and — as its own comment says — "the balance is already correct". That case needs no reversal and still does not get one. The gap the row names is real and is the other case: a payment that reached `succeeded`, posted a ledger entry, settled invoices, issued a receipt number and for a counter cheque sat in a drawer that has since been counted.

**The tenant is told on their own screen.** `/portal/documents` lists the returned payment rather than dropping it, marked in words (not colour or a strikethrough, 1.4.1): "Returned unpaid by the bank. This amount is owed again — please call us." Hiding it would leave a tenant holding a receipt, receiving a dunning notice for the period it paid, with nothing on the one screen that is theirs to explain it.

**Test verification.** 11 new tests in `tests/refunds-db.test.ts`: the reversal leaves the original entry untouched and re-opens the invoice **with its original due date** (D-25's ageing anchor, so arrears reappear with the age they had rather than restarting today); the NSF fee as a waivable fee invoice; no fee when none is configured (the shipped state); the waive path recorded as a *choice* in the audit `after` rather than inferred from an absent fee; the existing task type; "is not a refund" — no second `Payment` row, no drawer session, no `refund`-type entry; double-return refused; reason required; a never-settled payment refused; the permission required and the limit *not* applied; and the returnable list dropping it afterwards while `refundablePayments` also stops offering it. Full unit suite **3,501 passed, 8 skipped of 3,509** (was 3,490/3,498). `refunds-db` run twice for repeatability. Typecheck clean, lint 0 errors, schema drift clean, build clean, `db:migrate:test` run.

**A real bug found and diagnosed along the way — now B-158, not fixed here.** The first full sweep failed on `gate-simulator-db.test.ts`'s offline case. Confirmed pre-existing by stashing every change and reproducing it, and it passes in isolation and on a re-run — the same intermittent failure the test's own comment records as unexplained from 2026-08-19. That comment had added a `reason` assertion specifically so the next occurrence would be diagnosable, and it paid off: the reason came back **`unknown_code`**, which rules out the `outside_hours` wall-clock theory it had hedged on. The code never reached the simulated vendor at all. Cause: `GateCommand.nextAttemptAt` defaults to Postgres `now()` while `drainGateCommands` filters `nextAttemptAt <= now` against a **Node-side `new Date()`** — two independent clocks, with the database remote — so a command inserted just before a drain can carry a timestamp later than the drain's own cutoff and be passed over. **Not test-only:** in production it self-heals on the next cron tick, which for a move-in gate code means a tenant standing at a keypad that does not work until then. Raised as **B-158** rather than fixed inside B-146: it is a different subsystem, and a fix to an intermittent failure I cannot reproduce on demand is exactly the confident-wrong-fix worth not making.

**Left behind.** **Nothing detects a return automatically.** This is the manual path — a staffer with a bank notice in their hand. `charge.dispute.*` is **B-147**, which the backlog already has queued next and which the row explicitly says should ride on this primitive rather than inventing a second one; an ACH `charge.failed` after settlement would come the same way. **No partial return.** A bounced cheque and an ACH return come back whole, so `returnPayment` reverses the full amount and refuses anything else by construction; a partially-disputed card charge would need the allocation-trimming loop `refundPayment` already has. **A payment with no lease ledger entry is refused** (`nothing_posted`) rather than handled — that is a merchandise sale, whose reversal belongs with merchandise, not on a lease ledger. **The NSF fee is assessed at today's configured amount, not the amount in force when the payment was taken.** Deliberate: the fee is for the return, which is happening now. **No dunning suppression window.** The re-opened invoice is immediately past due by its original date, so the ladder may chase a tenant the same night their cheque bounced, before anyone has rung them. The task is `high` priority for that reason, but the ladder does not know to wait — worth an operator's opinion before guessing at a grace period.

## B-147 — Card disputes reach nothing

`ee10a67`

**What it built.** `HANDLED_EVENTS` in `reconcile.ts` covered five Stripe events and no `charge.dispute.*`, so a chargeback was something the operator learned about from a bank statement: the money was out of the Stripe balance and recorded here as collected, the invoice reading `paid`, forever. Same defect as B-146 one layer up, and it rides B-146's reversal primitive rather than inventing a second one.

- **`charge.dispute.created` and `charge.dispute.closed` added to `HANDLED_EVENTS`**, handled in one `case` pair. `created` calls `returnPayment()`; `closed` with `won` calls the new `reinstatePayment()`; `closed` with `lost` does nothing, because `created` already told the truth.
- **`reinstatePayment()` in `apps/web/lib/billing/reversals.ts`** — the other direction, symmetric with `returnPayment` and append-only for the same reason. A third ledger entry pointing at the reversal through `reversalOfId`, the payment back to `succeeded`, the money **re-allocated** (not restored), and the open `settling_payment_failed` card cancelled.
- **`payment.reinstated` in the audit catalog**, `requiresReason: true`.
- **A duplicate-reversal guard in `returnPayment`** — see below; it is a bug this row created and closed in the same diff.
- **8 tests** in `tests/stripe-webhook-db.test.ts`, in their own `describeDb` block with their own facility, lease and per-test teardown.

**What it decided.**

**`charge.dispute.created` is the moment to reverse, not `closed`.** Stripe withdraws the disputed amount from the balance when the dispute opens, not when it resolves. Waiting for the outcome would leave the ledger claiming money we demonstrably do not have for the 60–75 days a dispute runs, which is the exact defect the row names.

**No fee, either way.** B-146's `assessNsfFee` is reachable from `returnPayment` and is deliberately switched off here with `waiveFee: true`. Billing a returned-payment fee at `created` charges a tenant for a dispute we may be about to win, and B-147's own wording asks for the reversal and the task, not a fee. A dispute fee is a real cost (Stripe charges one) and is a separate decision with a separate configured amount — left behind, below.

**An early-warning inquiry is not a withdrawal.** Stripe creates `Dispute` objects for card-network inquiries with `status: warning_needs_response` / `warning_under_review`, and the funds are still ours. Reversing on one would re-open the invoice and start dunning a tenant over money we still hold. The handler tests `status.startsWith('warning_')` and reverses only when the funds actually moved — but still raises the queue card, because an inquiry is a real signal and nothing else in the product would ever mention it. `warning_closed` is routed to `reinstatePayment`, which returns `not_returned` and posts nothing.

**The system actor passes the reversal gate, and the seeded `system` role was NOT widened.** `returnPayment` gates on `refunds:approve`; the webhook has no staff actor and the seeded `system` role deliberately holds only `tenants:view` and `delinquency:execute_step`. Adding `refunds:approve` there would hand the delinquency engine a refund button — the wrong fix for a narrow need. Instead both entry points now go through `requireReversalAuthority()`, which lets `kind: 'system'` through with the reason stated: the bank has already moved the money, the only choice available is whether our records admit it, and `systemActor` is constructible in server code only, behind a signature the webhook route verifies before anything else. The same helper carries B-146's existing note about why `checkMonetaryAuthority` is not applied.

**Reinstatement RE-ALLOCATES rather than restoring the old allocations.** The invoices a payment settled before a 70-day dispute may well have been superseded — next month's rent was raised, a late fee landed because the arrears were genuinely real for those weeks. `reinstatePayment` calls `applyPayment` fresh, so the money settles what is open in the facility's configured order, the same rule every other payment follows. Pinning it back to the original invoices would leave a paid invoice sitting behind an unpaid older one.

**The counter-entry is `adjustment`, not `payment`.** Deliberate and load-bearing: `returnPayment` finds what to reverse via `ledgerEntries.where({ type: 'payment' })[0]`, so a second `payment`-typed row would make that ambiguous and a later return could reverse the wrong entry. Three entries, none edited, netting to one payment's worth of credit — which is the balance the tenant had before anyone disputed anything.

**A real bug this row created, found by writing the test for it.** Reinstating puts the payment back to `succeeded`, so `returnPayment`'s status check would let a *second* dispute through — and `reversalOfId` is `@unique`, so creating a second reversal of the same posted entry throws **inside the transaction**. From a webhook that is a 500, which Stripe retries for days. `returnPayment` now checks for an existing reversal of the posted entry and returns `already_returned` instead. Worth noting the shape: the unique constraint was doing its job, and the failure mode was a retry storm rather than corrupt data.

**Test verification.** 8 new tests: the reversal, re-opened invoice with its **original** due date (D-25's ageing anchor) and the high-priority task on `created`; redelivery posting exactly one adjustment; `lost` posting nothing new; `won` reinstating to `paid` with three ledger entries netting to `-12,900`, the task `cancelled`, and a redelivered win adding nothing; an early warning leaving the payment `succeeded` and the invoice `paid` while still raising the card; a dispute on a payment with no lease raising the card and posting no entry; and an unknown payment intent resolving rather than throwing. Full unit suite **3,509 passed, 8 skipped of 3,517** (was 3,501/3,509). `stripe-webhook-db` and `refunds-db` run twice for repeatability. Typecheck clean, lint 0 errors. No schema change, so no migration and no drift check needed.

**Left behind.** **No dispute fee.** `FeeType` has `nsf` and `lien` and no dispute type; charging one needs a configured amount, a decision about whether it survives a won dispute, and it is a term the tenant is being held to. Wants an operator's opinion before guessing — the same argument that left B-146's dunning-suppression window open. **`charge.dispute.funds_reinstated` / `funds_withdrawn` are not handled.** The two `dispute.*` events chosen carry `status`, which is sufficient; the funds events are a redundant second signal and handling both would need a third idempotency argument. **Nothing surfaces a dispute as a dispute.** The queue card says "A payment bounced after it was accepted" — accurate but generic, and B-146 widened that label for exactly this. A staffer has to open the audit log to learn it was a chargeback rather than a bad cheque. **Evidence submission is out of scope entirely** — responding to a dispute happens in the Stripe dashboard, which is the right place for it and is where the deadline lives.

## B-148 — Waitlist and lead forms announce success to nobody

`8d0e3d1`

**What it built.** Both public marketing forms — the sold-out-size notify-me (B-090a) and the quote/callback form (B-068) — rendered their `role="status"` paragraph **only in the success branch**, so the live region was inserted into the DOM already carrying its message. That is the exact failure `AdminForm`'s own comment describes and B-111 fixed product-wide: a region that appears with the event it reports is unreliably announced by VoiceOver and routinely missed by NVDA (4.1.3). Both also replaced the entire form on success, unmounting the submit button the user was standing on and dropping focus to `<body>` (2.4.3).

- **`apps/web/components/marketing/form-result.tsx`** — a shared `FormResult` wrapper. Mounts the `role="status"` paragraph unconditionally and empty, writes the message into it on success, renders its children only while not successful, and moves focus to the region when the message arrives.
- **Both forms wired to it**, replacing their own success branches. One component rather than the same six lines twice, per the row's "one diff for both".
- **`e2e/smoke.spec.ts`** — the existing waitlist test now uses B-156's `expectPreexisting`/`expectAnnounced` and asserts focus; a new sibling test does the same for the lead form.
- **The accessibility statement re-read and annotated**, with no prose change — see below.

**What it decided.**

**Focus moves here, and deliberately not in `AdminForm`.** `AdminForm` never steals focus after a success and its comment says why: stealing it would interrupt the announcement. That reasoning holds *because its form stays mounted* and focus stays somewhere meaningful. These two replace themselves, so there is nothing left to preserve — the choice is the region or `<body>`, and `<body>` means a keyboard user is silently returned to the top of the document with their next Tab starting from the site header. The region is given `tabIndex={-1}` and focused.

**Not converted to `AdminForm`.** It is the shipped correct pattern and the obvious reach, but it brings an `aria-label`ed form element, an error summary, and B-124's restore-what-was-typed pass, none of which these two need — and the lead form has its own `Field` with different markup. The diff would have been a rewrite of two working forms to fix a six-line defect. `FormResult` borrows the one part that was missing.

**The layout class applies only once there is a message.** An empty `<p>` has no height, but a margin on it still pushes the form down — a visible gap above every sold-out size card on the facility page. So `className` (margin only) is applied on success and omitted at idle. This is *not* the `empty:hidden` mistake B-111 fixed: that was `display:none`, which removes the element from the accessibility tree until the instant it has text. A margin class changes nothing about attachment or exposure.

**The success box lost its border.** Both previously rendered the confirmation in a bordered card. A persistent region cannot carry a border — it would draw an empty box on every page load — so both now use `AdminForm`'s treatment: plain green medium-weight text. Consistency with the rest of the product was the tiebreak, not just necessity.

**The accessibility statement needed no prose change, and that is the finding.** "A successful save is announced too" has been in the "what is true today" list since B-094 and was made honest for `AdminForm` by B-111. These two forms are not built on `AdminForm`, so the sentence was **false in the overstating direction** on the two forms a prospect is most likely to be the first to ever use. B-148 makes it true rather than narrowing it, and `expectPreexisting` in the e2e is what stops it regressing the way it silently did between B-094 and B-111. A dated note records the check; `LAST_REVIEWED` is not bumped, for the reason B-139's entry gives.

**The lead-form e2e uses a FIXED email, which is discipline (2) of the three the repo allows against shared demo data.** `captureLead` dedupes within its window and returns the same success without writing a second `Lead`, so a repeated sweep neither grows the table nor walks toward US-8 AC4's five-per-ten-minutes limit — which counts `Lead` rows per submitter hash and would eventually start refusing from one developer's IP. A unique-per-run address would have looked more careful and been the one that breaks on the fifth run.

**Test verification.** Full unit suite **3,509 passed, 8 skipped of 3,517** — unchanged, as expected for a component-level a11y fix with no service change. Typecheck clean, lint 0 errors. 8 e2e passed across desktop and mobile Chrome (`sold-out size offers to email`, `lead form announces and keeps focus`, `waitlist form has no WCAG 2.1 AA violations once opened`). No schema change. **One self-inflicted failure on the first e2e run, worth recording because the locator lesson generalises:** `getByLabel('Email')` substring-matches, and the marketing-consent checkbox's label begins "Send me occasional emails" — a strict-mode violation resolving to two elements, fixed with `{ exact: true }`. It was a test bug, not a product one; the waitlist half passed on that same run, including both new assertions.

**Left behind.** **The error path is still not asserted to pre-exist.** `expectPreexisting` can only run against an unconditionally-mounted region, and both forms — like `AdminForm` itself — render their error messages conditionally. `a11y-helpers.ts` already names this gap in its own comment; B-148 does not close it, and closing it means making the error summary persistent everywhere, which is a product-wide change with the same shape as B-111. **The waitlist form's confirmation still replaces the disclosure entirely**, so a visitor who wants a second size has to find the next card rather than being offered one. Deliberate: the row is about announcement, and changing what the success state *offers* is a UX decision nobody has asked for. **No test asserts the region is empty at idle for the lead form on a page with JavaScript off**; the no-JS posture is unchanged (the form still posts and the page re-renders) but the inline announcement is a client-side behaviour and always was.

## B-149 — Checkout's unit-lost branch was a dead end

`06db806`

**What it built.** When a checkout's 30-minute hold lapsed, `/checkout` offered one control — "Find me another unit the same size" — and if that failed, `relockAction` returned the words *"call us and we will find you something"* **with no phone number on the page**, no alternatives and no waitlist. That is the highest-intent moment in the funnel ending in an instruction the renter cannot follow. B-090a had shipped `WaitlistForm` only on the public facility page, the lower-intent surface.

- **`apps/web/components/marketing/call-link.tsx`** — `phoneFor` / `CallLink` lifted out of the facility page, unchanged. Prefers the facility's own line, falls back to the org line and says *"our main line"* so a transfer is no surprise.
- **`alternativeSizes()` in `lib/checkout/session.ts`** — the other sizes at the facility, excluding the lost type and anything with `availableCount === 0`.
- **The lapsed-lock panel now branches.** Size still available → the relock button, exactly as before. Size gone → the facility's phone number, the other available sizes at that facility (linked to the facility page, which gained a per-unit-type `id` anchor), and `WaitlistForm` for the size that was lost, submitting the existing `joinWaitlistAction`.
- **`relockAction` revalidates on the failure path**, so a relock that loses the race re-renders into the sold-out half rather than leaving the renter beside the button that just failed.
- **`tests/checkout-unit-lost.test.ts`** — five assertions on the two decisions that can silently go wrong.

**What it decided.**

**The branch is decided from `availableCount`, the same number `relock` acts on.** Not from a relock attempt, and not from a separate query. The screen and the button therefore cannot disagree about whether the size exists, and the race that remains (sold out between render and submit) resolves into the same panel via the new `revalidatePath`.

**No recommender, per the row.** Alternatives are the facility's own ordering, smallest first — the same list the facility page renders. Ranking alternative sizes or nearby facilities is a feature nobody asked for.

**`phoneFor` was moved rather than copied.** Two surfaces most likely to make a renter dial must not disagree about what they dial, and the facility page's own comment already says that is why the rule is resolved once per page. Copying it into checkout would have made that comment false. The facility page's `Phone` type is imported as `PhoneNumber` there because `lucide-react`'s `Phone` icon already owns the name.

**The waitlist form is reused verbatim, including its `<details>` disclosure.** Collapsed is right on a facility page with five sold-out sizes; on checkout there is exactly one and expanded would be defensible. Left as-is anyway — a variant prop for one caller is a config for a value that never changes, and B-148's `FormResult` announcement behaviour comes with it unmodified.

**The accessibility statement needed no prose change.** No new route, so the generated coverage claim is unaffected; the sold-out branch is a post-interaction, data-dependent state, which is **B-156's** general gap rather than a new exception. Recorded with a dated note; `LAST_REVIEWED` not bumped.

**Test verification.** Full unit suite **3,514 passed, 8 skipped of 3,522** (216 files passed, 1 skipped), exit 0. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected. No migration.

**Left behind.** **No e2e covers the sold-out branch.** Reaching it needs a lapsed session whose size has since gone — two mutations against shared demo inventory, which fits none of the three disciplines B-120 settled, so it would have to build its own facility. **No nearby-facility fallback.** When the facility is genuinely full, `alternativeSizes` returns empty and the renter gets the phone number and the waitlist and nothing else; offering another site is the recommender the row rules out. **The alternatives are links, not a one-click switch.** Putting the renter straight onto another size would mean re-pricing the basket mid-session, which is B-106's machinery and a larger change than this row. **`relock` itself still only tries the same unit type** — it does not consider a larger size at the same price, which is what a counter agent would do.

## B-150 — AR aging sat under a month picker and always answered "as of today"

`8aa64cc`

**What it built.** `/admin/reports` has a month picker at the top. Two sections down, B-131/D-68 had made unit occupancy either answer for the month or say which instant it does answer for. One section below **that**, the AR aging table computed from `new Date()` and said nothing — so a month-end AR figure and the aging table beneath it disagreed with nothing on screen explaining why, and the fix for one had not generalised to the other. Confirmed as reported: `agingForFacility` did `const now = new Date()` and its own comment said it "takes no date and cannot be given one".

- **`arAgingNote(asOf, timezone, periodLabel)`** in `lib/admin/reports.ts` — the sibling of `unitOccupancyNote`, printed above the table and wired with `aria-describedby` the same way, so a reader who reaches the table by table navigation still gets it.
- **`delinquencyReport` returns `asOf` and `timezone`**, and passes **one** clock down to every `agingForFacility` call instead of each taking its own.
- **`reportableFacilities`/`financialFacilities` now select `timezone`**, which is what makes "facility-local" possible at all.
- **FR-22 (1.3.1): the facility cell is a `<th scope="row">`** in all three tables on the page — occupancy, moves and AR — including the "All facilities" total rows.
- **`tests/ar-aging-note.test.ts`** (3) and two additions to `tests/reports-financial-db.test.ts`.

**What it decided.**

**It names the instant rather than answering for the date, and that is D-65 rather than laziness.** The row allowed either. D-65 already settled that AR aging is point-in-time, stored as the sole record of a closed month and never recomputed — reconstructing a past bucket would answer a different question under the same name, and it would also reopen the accounting close's freeze, which D-68 explicitly left alone. **No new D-number:** this applies a settled decision, it does not make one.

**The zone is printed, never implied.** `timeZoneName: 'short'` is on unconditionally, so the sentence carries "CDT" or "UTC" with it. When the facilities in scope span more than one zone there is no single local clock, so it states UTC *and says that is why* — a portfolio table cannot have a facility-local instant, and silently picking one facility's zone would be a new version of the same lie. Note that `dateStyle`/`timeStyle` cannot be combined with `timeZoneName` (it throws `Invalid option`), so the components are spelled out.

**One clock for the whole report.** `delinquencyReport` fanned out to `agingForFacility` in parallel, each calling `new Date()`. Individually harmless; but once the page prints an instant, the instant named has to be the one the buckets were cut at, and with N clocks it was none of them. `asOf` is now a parameter with a `new Date()` default, so the standalone callers (`accounting-close`, `report-subscriptions`) are unchanged.

**The three row-header fixes went together.** The row named only the occupancy table, but the moves and AR tables on the same page had the identical `<td>`, and fixing one of three is how a defect comes back as a review finding. `font-normal` on the data rows so the visual weight is unchanged; the total rows keep `font-medium`.

**Test verification.** Full unit suite **3,519 passed, 8 skipped of 3,527** (217 files passed, 1 skipped), exit 0 — up 5 from B-149's 3,514 by exactly the tests added. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected. No migration. The accessibility statement was re-read and annotated with no prose change — every surface here is under `/admin`.

**Left behind.** **The dashboard tile and the delinquency detail page do not print the sentence.** Neither has a date picker, so neither makes the implied claim — the detail page already says "Point-in-time, as of now" in prose — but they now have `asOf` available and do not use it. **The CSV export is unchanged.** D-68's rule is that the screen, the scheduled email and the CSV print the caveat identically; `/admin/reports/delinquency.csv` has no date column and does not carry the instant, which is a real gap in that rule that this row did not close. **`unitOccupancyNote` still formats in UTC** (`formatDay`, since B-131) while this one formats facility-local, so the two sentences on the same page use different clocks. They say different kinds of thing — one names a period end, one names a timestamp — so nothing is currently wrong on screen, but the inconsistency is one edit away from mattering. **Nothing reconstructs a historical aging bucket**, and per D-65 nothing should.

## B-151 — An overlock outlived the lease it was applied to

`de346e5`

**What it built.** Confirmed exactly as reported, and all three consequences were real. `evaluate` halts a lease with `cured` when the qualifying balance clears and `moved_out` when the lease has ended — and **only the `cured` branch called `releaseOverlock`**. A lease that ends still owing takes the other branch, so the lock stayed live. `deriveUnitStatus` returns `overlocked` before anything else, ahead of the `maintenance` that `completeMoveOut` sets one line earlier, so the unit read `overlocked` indefinitely. The reconciliation view compares system state against physical state, and both said "locked" — **no mismatch, both wrong**. `isOccupied` counts `overlocked` as occupied, so the unit stayed in the numerator and out of `publicInventoryForFacility`'s `status: 'available'` count: one unit of sellable inventory gone per event, reported by nothing.

- **`releaseOverlock` now takes a transaction client and is idempotent.** The guard is the substantive change — see below.
- **All three lease-ending paths release in their own transaction**: `completeMoveOut`, `commitTransfer` (the row named transfer and move-out; the third was found by grepping `status: 'ended'`) and the auction sale in `auctions/service.ts`.
- **A backstop in the nightly delinquency run** releases any lease that has ended, whatever the halt reason.
- **Tests**: two in `move-out-db.test.ts` covering the real end-to-end path, one in `overlock-db.test.ts` for idempotency.

**What it decided.**

**The unit deliberately does NOT return to the rentable denominator at lease end.** The row asked to "assert the unit returns to the rentable denominator", and the honest place to do that is when the lock physically comes off, not when the lease ends — there is still a real lock on the door. Making `deriveUnitStatus` ignore an overlock whose lease has ended was considered and is the worse bug: the unit would read `available` while padlocked, and could be rented to somebody who cannot open it. That converts a silent inventory loss into a customer standing at a door, which is the trade the reconciliation screen exists to prevent. So lease end raises the **task**, and `confirmOverlockRemoved` returns the unit — the second test asserts exactly that, through the task rather than by calling the service.

**`releaseOverlock` had to become idempotent, and this is the part that would have bitten later.** Curing called it exactly once, so a duplicate was impossible and nothing guarded against one. B-151 adds three callers plus a nightly re-run, and `createTask` is unique per `(type, entityId, businessDate)` — **per business date**. So an unguarded re-call raises one fresh `overlock_remove` task every morning until somebody removes the lock. That is the same trust problem the existing "withdrawn" branch already names in its own comment, arriving by a different route. A removal already asked for and still open is now returned rather than re-raised.

**The engine backstop is not the fix and is not redundant.** The three call sites are the fix. The backstop exists for the locks **already stuck** on leases that ended before this shipped — the engine's lease query is `where: { facilityId }`, so it does reach ended leases — and for a fourth way to end a lease that somebody writes later and forgets. It is keyed on the lease not occupying, not on the halt reason, because an ended lease with a zero balance halts as `cured` and can fall through `cure()`'s `executedDays.length > 0` guard.

**Test verification.** Full unit suite **3,522 passed, 8 skipped of 3,530** (217 files passed, 1 skipped), exit 0 — up 3 from B-150, exactly the tests added — and **run twice**, per the repo's rule for anything touching shared fixtures. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected. No migration. **Both new move-out tests were verified to fail with the fix removed** — the first found no `overlock_remove` task, the second could not complete a task that was never raised. The accessibility statement was re-read and annotated with no prose change; nothing customer-facing changed.

**Left behind.** **No test covers the transfer or auction call sites,** only move-out. All three are the same one-line call into the same tested function, and building an overlocked lease through a full transfer or a full lien sale is a large fixture for a line already asserted elsewhere — but it means a future edit could drop one of those two without a red test. **No test covers the nightly backstop**, which needs a configured timeline plus an ended lease with a live lock. **Nothing reports or repairs the units already stuck** beyond the backstop firing on the next nightly run at a facility with a delinquency timeline configured — a facility with no timeline configured runs no pipeline at all (B-056's rule), so its stuck locks stay stuck until a lease-ending path touches them. A one-off reconciliation sweep would close that and no row owns it. **The reconciliation view still cannot express "the lock is on a unit with no lease"** as its own category; it will now simply see a pending removal.

## B-152 — A rate-increase notice was recorded as sent with no delivery check

`b9409d2`

**What it built.** Confirmed as reported. `sendDueRateIncreaseNotices` flipped the status to `notice_sent` and *then* emitted the event, outside any transaction — so the row could assert a notice had gone out with no event behind it — and nothing anywhere afterwards read `Message.status`. An increase whose notice hard-bounced or landed on a suppressed address applied thirty days later regardless, which is exactly the fact that makes an increase indefensible if the tenant disputes it. US-11 blocks an effective date that violates the minimum notice period: a guarantee about **delivery** that the code made about **intent**.

- **The claim, the stamp and the emit are now one transaction**, and the emitted event id is written onto the row as `TenantRateIncrease.noticeEventId`. That is the outbox pattern `emitEvent`'s own doc comment asks for, and it is the anchor the reconciliation reads — `Message.eventId` carries it already, so no new join was invented.
- **`reconcileRateIncreaseNotices`** reads every message the notice event produced and judges it through `noticeDeliveryVerdict` in `packages/core/pricing` (no fixtures needed to test it): no message at all → `no_send_record`, all messages bounced/failed/suppressed/cancelled → `undeliverable`, anything else → `reached`.
- **A blocked increase moves to a new `notice_failed` status** with the verdict in `noticeFailureReason`, and raises the new high-priority `rate_increase_notice_undelivered` task.
- **The review screen** labels the hold and says what to do about it; a held row is excluded from the projected revenue delta.
- **Migration** `20260823153627_rate_increase_notice_delivery`: the enum value and two nullable columns.
- **Tests**: 15 new — 8 database (bounce, suppression, no-record, grace window, single task across runs, still-cancellable, blocks a duplicate, and the happy path still applies) and 7 unit, over the verdict function and `isCancellable`.

**What it decided.**

**Blocking is a status, not a check in the apply job.** `applyIsDue` already required `notice_sent`, so moving a held row to `notice_failed` makes "an increase whose notice did not arrive can never take effect" true by construction. The alternative — leaving it `notice_sent` and testing the messages again inside the apply loop — puts the guarantee in a place a later edit can delete without any test noticing.

**The reconciliation runs at the top of `applyDueRateIncreases` and sweeps every live notice, not only the ones due today.** It is per-facility and daily, so a bounce is caught within about a day of arriving and the operator has the rest of the notice period to re-notice. Reconciling only the rows reaching their effective date would be cheaper and would tell the operator on the exact day it is too late to do anything about it. No new registry entry was needed for that.

**"No send record" waits two hours; a bounce waits for nothing.** The outbox drain is the first thing the hourly cron does, so an event emitted at any point in an hour has been dispatched by the end of the next one — after that, no message means the pipeline produced none (a skip condition fired, or no rule matched), which D-88 says blocks. A message that has already bounced or been suppressed is a fact the moment it is recorded. Without the split, the `noticeDays: 1` case would apply unchecked, because the notice job runs at hour 10 and apply at hour 0 — fourteen hours, not a day.

**`queued`, `sent` and `deferred` count as reached.** None is proof of arrival, but none is evidence of failure, and blocking on "the provider callback is a minute late" would hold far more increases than bad addresses ever will. Only a positive failure blocks. A notice that reached the tenant on *either* channel counts as reached.

**Rows scheduled before this shipped are unjudgeable, not failed.** `noticeEventId: null` is excluded from the sweep — there is nothing to look their messages up by, and blocking on missing bookkeeping would hold increases whose notices were fine.

**`LIVE_RATE_INCREASE_STATUSES` replaced five copies of the same array.** `notice_failed` had to be added to all of them at once — the one-live-increase-per-lease check, the batch operations and the review screen — and a list that missed it would have let a second increase be scheduled alongside a merely-blocked first.

**A pre-existing typecheck failure on `main` was fixed on the way past.** B-151's new move-out test mutated a `ReadonlySet` through an un-narrowed `Actor` union; `tsconfig.tests.json` caught it and it was already red before this item started. Two errors, one edit: `actorOf` now returns the staff branch, and the permission set is copied rather than mutated.

**Test verification.** Full unit suite **3,537 passed, 8 skipped of 3,545** (217 files passed, 1 skipped), exit 0 — up 15 from B-151, exactly the tests added — and **run twice**, per the repo's rule for anything touching shared fixtures. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected. `db:migrate:test` and `db:migrate:e2e` both run. Production build green. The accessibility statement was not re-read: this item ships no customer-facing surface — the only customer-visible effect is a tenant *not* being charged more on a notice that never arrived.

**Left behind.** **There is no re-notice control.** D-88's remedy is "the operator re-notices from a good address and the clock restarts", and the way to do that today is to cancel the held increase and schedule a new one — two actions on the same screen, with the new effective date chosen by hand. A single "re-notice" button that reschedules from the corrected address is a genuine gap and no row owns it. **Nothing clears `noticeFailureReason`**, deliberately: a held increase is never revived in place. **The reconciliation makes one query per live notice** rather than one grouped query for the facility; at a realistic count of concurrent increases that is a handful of round trips a night, and it is the shape the loop needed to keep the per-row task and record-item honest. **No e2e spec covers the held state** — the block is asserted only at the service layer, so the review screen's new label and help text are typechecked and built but not exercised by a browser. **A soft bounce still counts as reached**, which is correct per PRD 05's own treatment, but it means a mailbox full for the whole notice period reads as delivered.

## B-153 — A tenant's rate can now come down

`e0da7d0`

**What it built.** The retention save that ECRI itself creates demand for. B-076 built the increase and D-37 gave it a model; there was no path in the other direction, so a manager keeping a good tenant either edited `Lease.monthlyRateCents` directly — bypassing the write-through US-11's schema AC exists to enforce — or did nothing.

- **`scheduleRateDecrease`** creates a `TenantRateIncrease` with a negative delta, already `approved`, and audits it as `rate.tenant_decreased` with a required reason code.
- **`decreaseProblem`** in `packages/core/pricing` is the mirror of `scheduleProblem`: refuses a negative rate, a rate that is not lower, and a past effective date. **Today is allowed**, unlike an increase.
- **`applyIsDue` and `noticeIsDue` became direction-aware**, keyed on `isRateDecrease` derived from the two figures on the row rather than on a stored `direction` column.
- **`applyRateChange` gained `reason: 'retention'`** (new `LeaseRateReason` enum value, migration `20260823155351_lease_rate_reason_retention`), so "how much did we give away to keep people" is answerable.
- **The review screen** gained a retention-save form, a direction-aware status label and a signed projected delta; the increase machinery is hidden from an actor who can only lower.
- **Tests**: 21 new — 12 unit over `decreaseProblem` and the two direction-aware predicates, 9 database over the service.

**What it decided.**

**The permission is `credits:manual`, not `rates:tenant_increase`.** The row asked for "manager-and-above, reusing `checkMonetaryAuthority` rather than minting a new threshold", and the two halves of that only fit together this way: `rates:tenant_increase` is granted to **regional and above** in the seed, which is right for raising a cohort's rent and wrong for the counter conversation this feature exists for. `checkMonetaryAuthority(actor, 'credit', monthlyReductionCents, facilityId)` lands on manager-and-above by construction — a manager holds `credits:manual` with a $50 limit, counter and bookkeeper hold neither the permission nor a limit — with **no seed change and no new limit column**. Over the limit it escalates by naming the role that can carry it, exactly as a refund does.

**The limit is measured against the MONTHLY giveaway,** not the new rate and not the remaining term. A $15 save is a $15 decision every month; annualising it would put a routine retention call over every manager's limit and make the feature unusable by the people it is for.

**There is no `pending_approval` state for a decrease.** The authority check is the approval, so the row is created `approved` with `approvedByStaffId` set. A pending state would mean a manager acting inside their own limit still had to wait for somebody else — which is the delay the feature exists to remove.

**The direction is derived, never stored.** A `direction` column could disagree with the delta beside it. `scheduleProblem` and `decreaseProblem` between them make an equal-rate row impossible, so `isRateDecrease` is total.

**`noticeIsDue` needed the direction check more than `applyIsDue` did, and that is the sharp edge of this item.** A decrease is `approved` from creation, which is exactly the state the notice job fires on — without the guard, the tenant whose rent had just been lowered would be emailed a rate-**increase** letter quoting the new figure. Both guards were mutation-tested: removing either turns four tests red, two unit and two database.

**An approved INCREASE still cannot apply.** Widening the apply query to `status: { in: ['notice_sent', 'approved'] }` is the change most able to do damage here, so the property that made B-152 worth building is asserted directly rather than left implied.

**The review screen is readable by either rate authority.** A manager who could make a save but could not see or cancel it has half a feature, and this exposes nothing new — the same manager already reads in-place rates on the tenant page and in the rate-variance report.

**No D-number, per the row's own instruction:** the approval level is a default the RBAC already models and is reversible in a seed.

**Test verification.** Full unit suite **3,558 passed, 8 skipped of 3,566** (217 files passed, 1 skipped), exit 0 — up 21 from B-152, exactly the tests added — and **run twice**. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected. `db:migrate:test` and `db:migrate:e2e` both run. Production build green. The accessibility statement was not re-read: this item ships no customer-facing surface.

**Left behind.** **The lease is still identified by typing a Lease ID**, the same as B-076's one-off increase form — the natural place to lower a rate is the tenant page, which already lists every lease with its rate and its move-out and transfer links, and neither form is there. **No batch decrease and no eligibility rule**, deliberately: there is no "who should we save" query, and inventing one would be a feature nobody asked for. **The monthly-reduction figure is checked against `maxCreditCents`, which is also what a one-off credit is checked against** — a recurring giveaway is arguably worth a stricter bar than a single credit, and the row explicitly ruled out minting a new threshold, so that judgement is deferred rather than made. **No e2e spec covers the retention form.** **Nothing reports retention saves as a category** even though `LeaseRateChange.reason = 'retention'` now makes it queryable; B-155's attach-rate work is the nearest thing and does not cover it.

## B-154 — Waitlist at the counter, and a report that could finally be called from

`a1cf2d8`

**What it built.** Three findings from one operator-review row, all against `WaitlistEntry` rows that already existed.

- **`joinWaitlistForLead`** (`lib/admin/inquiries.ts`) — the counter/phone half of `WaitlistForm`. Calls the same `joinWaitlist` the public facility page calls (D-79's model, not reinvented), carrying the lead's phone and first name across; the email comes from the counter screen, because a caller who gave none when the lead was taken still deserves the list. Same idempotent-by-address behaviour as the public form, and the same disposition rule `holdForLead` uses: joining a new lead to a waitlist marks it `contacted`, so the follow-up task queue stops chasing a caller who has already been served.
- **The lead detail page** (`/admin/leads/[leadId]`) — every quote row with nothing free now offers a "Join waitlist" mini-form (email pre-filled from the lead, phone/name carried silently) in place of the old bare "none free" text. Not gated on an existing hold: a caller can hold one size and still wait for a better one.
- **`/admin/reports/waitlist`** — each size now carries a "Contact" `<details>` disclosure of who is waiting: name, `mailto:` email, `tel:` phone, and whether they've already been notified. Native `<details>`/`<summary>`, no client JS, so the PII stays collapsed until a staffer asks for it.
- **D-87's copy half.** `sendAvailabilityEmail`'s text told a notified prospect "we are holding your place for 72 hours" — a claim the owner's 2026-08-21 resolution says is false: there is no unit hold, only a hold on *telling the next person*. The line now reads "it's on sale to everyone else too, so the first person to complete a rental gets it."
- **Tests**: 6 new — 4 database over `joinWaitlistForLead` (phone carried over, disposition, idempotency, permission refusal), 1 over `waitlistDemand`'s new `contacts` field, 1 asserting the sweep email never says "holding your place" and does say "first person to complete a rental gets it".

**What it decided.**

**Waitlist eligibility is independent of `held`.** The quote row's branch used to be `availableCount > 0 && !held` vs. one fallback string for both "sold out" and "already holding something else". Splitting it — `held` only ever gates the *Hold* button, never the *waitlist* one — is what makes "hold one size, wait for the nicer one" possible, a real counter conversation the old branch could not represent.

**The email on the counter form is typed fresh, not read from the lead.** `Lead.email` is optional by design (B-097: a caller gives a phone without hesitating and spells an email address badly), but `WaitlistEntry.email` is required — it is the whole delivery channel (D-80). Pre-filling from `lead.email` when present and leaving it blank otherwise, rather than refusing the flow for a lead with no email on file, is the same trade B-097 made in the other direction.

**No new permission.** `joinWaitlistForLead` reuses `tenants:edit`, the same gate `holdForLead` and `createInquiry` already carry — a waitlist join is strictly less consequential than a hold (no unit taken off sale), so a stricter check would be a threshold invented for no reason.

**Contact details render as `<details>`, not a permanently-visible column.** The report already computes an aggregate table an operator scans in one glance; making phone numbers visible by default on every row is the wrong default for a screen that might be open on a shared monitor. Collapsed-by-default with the count in the summary — "3 people" — gets both: the number is always there, the PII only when asked for.

**D-87's fix drops the 72-hour figure from the customer-facing copy entirely**, rather than reframing it ("you have 72 hours to claim it"). That number governs when the *next* waitlist person gets told, not any guarantee to the person reading the email — stating it would suggest a window that does not protect them from losing the unit to a stranger who never joined the list at all.

**No D-number.** D-87 already resolved the substantive question (Option A: no hold) on 2026-08-21; this row builds the two things D-87 left to it — the copy and the counter capture — rather than reopening it.

**Test verification.** Full unit suite **3,564 passed, 8 skipped of 3,572** (217 files passed, 1 skipped), exit 0 — up 6 from B-153, exactly the tests added. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: no difference detected (no migration — no new column). `db:migrate:test` and `db:migrate:e2e` both run, no pending migrations. Production build green. The accessibility statement was not re-read: no public page changed — the lead detail page and the waitlist report are both staff-only admin routes, and the statement's claims are about scanned pages and forms, not the wording of a transactional email. **Found, not fixed, and confirmed pre-existing on `main` before this item's changes:** two `comms-observability-db.test.ts` assertions (`detectConsumerLag` staying quiet, `staleDeliveryCount` reporting zero) fail intermittently — reproduced with this item's diff stashed out, same two assertions, same numbers (`17` instead of `0`). Order-dependent against the shared test database rather than caused by this item; a later full sweep also showed a one-off 20s timeout in `marketplace-db.test.ts` that did not reproduce in isolation. Neither file was touched by B-154.

**Left behind.** **No "already on the waitlist" indicator on the lead page** — a repeat submit is idempotent server-side (same as the public form) and returns a confirmation message, but the form itself keeps rendering after a successful join rather than switching to a persistent "on waitlist" state. Acceptable because the join is genuinely idempotent, not because it wouldn't be a nicer screen. **No bulk action on the report** — a manager who wants to call everyone waiting on a size still opens each `<details>` and dials one at a time; a call-list export is a real feature nobody has asked for yet. **The report's Contact column has no "call all" link or export**; native `<details>` was chosen for zero-JS PII-hiding, not for workflow speed.

## B-155 — Protection attach rate, finally reportable

`d4355b6`

**What it built.** US-44's own AC ("attach rate is reportable... a coaching number, not a vanity metric") had never been built — dollars were reported, the ratio was not. One operator-review row, three pieces:

- **`packages/core/metrics/attach-rate.ts`** — the definition, same pattern as every other module (D-25): `attachRate(events)` takes `{ enrolled, channel, staffId }` per move-in and returns overall / by-channel / by-staff buckets of `{ moveIns, enrolled, rate }`; `sumAttachRate` rolls facilities up by summing the components and recomputing the ratio, never averaging it. `channel` reuses `MoveSource` from `moves.ts` (web/phone/walk_in/referral/drive_by/unknown) rather than inventing a second vocabulary for "web / counter / phone." A staffId of `null` buckets under the fixed key `UNASSIGNED_STAFF` rather than being dropped or folded into a real staffer's count.
- **`attachRateReport` / `attachRateForFacility`** (`lib/admin/reports.ts`) — the adapter, same shape as `movesReport`/`movesForFacility` beside it. `enrolled` reads `Lease.protectionPlanName !== null` (the column a waiver already nulls, per `provisionLease` and `applyProtectionChange` — no new flag needed). Also resolves staff display names for the `byStaff` keys via `StaffUser`.
- **A new section on `/admin/reports`** — "Protection attach rate," beside the existing move-ins section, with the overall sentence plus two `AttachSplit` tables (by channel, by staff), gated the same as the moves section (`assertCanReport`: operational or financial).
- **Tests**: 9 in `tests/metrics.test.ts` (rate math, zero-not-NaN on an empty bucket, channel split, `UNASSIGNED_STAFF` bucketing, and the sum-not-average roll-up property with numbers chosen so averaging and summing visibly disagree), 2 in `tests/reports-db.test.ts` (zero-enrolled/unassigned baseline, then enrolled + staff-attributed once a plan and a payment exist), extending the existing `movesReport` fixture rather than building a second one.

**What it decided.**

**"Per staff member who completed the move-in" has no dedicated column, and the codebase has no admin-side lease-creation flow at all** — every lease is provisioned by `provisionLease` (B-026) from a Stripe webhook, and that path carries no staff actor under any circumstance, online or phone or walk-in. What DOES name a person is `Payment.receivedByStaffId` (US-32) — required for cash, check and money order, read from the session actor, never a form field. The move-in's **earliest payment**, walked via `PaymentAllocation → Invoice.leaseId`, is who was behind the counter for that rental; a card payment taken online legitimately has nobody there and reports as `UNASSIGNED_STAFF` ("Web / self-service"), visible rather than crediting or blaming a real staffer for a deal they never touched. This reuses data every counter payment already writes — no migration, no new capture flow, no schema change at all.

**`enrolled` is `protectionPlanName !== null`, not a new boolean.** `applyProtectionChange` (protection changes) and `provisionLease` (move-in) both null the column exactly when a tenant waives or switches to their own cover — the column already answers the question the metric needs.

**Attach rate sits in its own section, not folded into the acquisition splits above it.** Those answer where a move-in came from; this answers whether it left with protection. Same page, same gating, deliberately not the same table — a reader who conflated the two would misread a 100%-web-channel row as 100% attach.

**No D-number.** D-25 already settled every judgement call this metric needed (sum-then-ratio, never average); this row just applies it to a new figure.

**Test verification.** Full unit suite **3,564 passed, 8 skipped of 3,579** (214 files passed, 1 skipped), exit 1 on 7 failures — all in `city-copy-db.test.ts`, `comms-observability-db.test.ts` and `marketplace-db.test.ts`, none of them touched by this item. **Run three times** (the third after `reports-db.test.ts` was extended): failures were 9 (2 files), 11 (4 files, including a `referrals-db.test.ts` timeout), then 7 (3 files) — a different set each time, which is the order-dependent shared-database signature this repo has documented since B-090b/B-154, not a regression. `tests/metrics.test.ts` and `tests/reports-db.test.ts` — the only files this item touched — passed clean in every run and in two dedicated isolated runs (56/56). Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: no difference detected — no migration, no new column. `db:migrate:test` and `db:migrate:e2e` both run, no pending migrations. Production build green. The accessibility statement was not re-read: `/admin/reports` is a staff-only admin route and this item added a section to an existing page using the same table markup already on it, not a new public surface.

**Left behind.** **No CSV export for attach rate**, unlike occupancy/rent-roll/delinquency — the existing report page has no CSV for the moves section either, and this follows the same pattern rather than inventing one. **No e2e spec** — same posture as B-153/B-154's admin-report additions, covered by the `reports-db.test.ts` integration tests instead. **The by-staff table has no drill-through to the staffer's own leases** — a manager can see *that* a staffer's attach rate is low, not click into which move-ins to review; that is a real coaching workflow nobody has asked for yet. **If a staff-assisted checkout or counter lease-creation flow is ever built, this item's staff attribution should be revisited** — it is currently a proxy (earliest payment's receiver), correct for every rental this product can create today, but not the same thing as a dedicated "who ran this deal" field.

## B-158 — A gate command could be skipped by clock skew between the app and the database

`aa51d57`

**What it built.** `GateCommand.nextAttemptAt` defaulted to Postgres's own `now()`, while `drainGateCommands` selects `nextAttemptAt: { lte: now }` against a **Node-side `new Date()`** taken separately. A command enqueued moments before a drain could carry a DB-clock timestamp later than the drain's Node-clock cutoff and be passed over — self-healing on the next cron tick, but for a move-in that means a tenant standing at a keypad that does not work in the meantime. `enqueueCommand` (the single insertion path for every `GateCommand` row — verified, nothing else in the codebase writes to that table) now stamps `nextAttemptAt: new Date()` explicitly, so the value that gets compared always comes from the same clock family the drain reads with.

**What it decided.** **Fixed at the write side (app clock in, not DB clock in), not the read side.** The backlog row offered either "drain on `nextAttemptAt <= NOW()` evaluated in the database" or "default the column from the application clock that will later read it." The DB-side option needs raw SQL (`$queryRaw`) in place of the typed `findMany` `drainGateCommands` already uses, for the same outcome; the write-side fix is a one-line addition to a single existing call, keeps the whole file on the Prisma client, and needs no new query path. The schema's `@default(now())` is left in place as a fallback for any insert that bypasses `enqueueCommand` (there are none today, but it costs nothing to leave the column self-defaulting).

**No D-number.** This is a bug fix diagnosed against existing behavior (PRD 03 FR-3's own outbox contract), not a product decision.

**Test verification.** Added one regression test to `tests/gate-simulator-db.test.ts`, freezing Node's clock (`vi.useFakeTimers({ toFake: ['Date'] })`) around an `enqueueCommand` call and asserting the persisted `nextAttemptAt` matches the frozen value exactly — Postgres's real wall clock cannot see a JS fake timer, so this is the one way to prove which clock wrote the column without depending on real clock drift, which does not exist to race against on a local test database (app and DB share one machine clock here; the skew this bug depends on is real only against a remote DB). **Confirmed the test is a genuine regression guard, not a tautology**: stashed the `service.ts` fix back out and reran — the test failed cleanly (persisted timestamp was the real wall clock, not the frozen one), then reran clean with the fix restored. A second assertion in the same test drains immediately after and checks the command reaches `succeeded`, covering the behavioural guarantee the diagnosis was about. Full unit suite (two runs): **3,568 passed, 8 skipped of 3,580**, exit 1 both times on the same 4 failures in `comms-observability-db.test.ts` and `marketplace-db.test.ts` — neither file touched by this item. Reran those two files alone against this item's diff stashed out and they failed there too (same assertions, same shape as the timeouts/order-dependence already documented for B-154/B-155), confirming pre-existing and unrelated. `tests/gate-simulator-db.test.ts` — the only file this item touched — passed clean (12/12) in both full-suite runs and in isolation. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: no difference detected (no migration — the column's default is unchanged, only the app-side insert is more explicit). `db:migrate:test` and `db:migrate:e2e` both run, no pending migrations. Production build green. Accessibility statement not re-read: no customer-facing surface changed — this is a queue-drain timing fix with no UI.

**Left behind.** **The DB-side fix (`NOW()` evaluated in Postgres) is not built** — the write-side fix closes the gap for every command this codebase enqueues today, but a future insertion path that bypasses `enqueueCommand` would reintroduce the same class of bug. Worth revisiting only if a second insertion path is ever added.

## B-157 — The staff side of D-85: approval, a reason code, and a lien clock that genuinely does not reset

`7bd00ab`

**What it built.** D-85 chose Option A on 2026-08-21 — staff **may** move a tenant out of a unit in the lien pipeline, because refusing costs the operator the tenant *and* the balance, and letting somebody downsize into a unit they can afford is a collections tool rather than a concession. B-137 shipped the half every option agreed on (the portal refuses outright). This row builds the three controls Option A actually chose, and which the wizard asked for none of.

**1. Manager-and-above, stated rather than inherited.** `leases:transfer` happens to be granted to manager and above today, so the authority level held *by accident* — and would have stopped holding silently the moment somebody granted that permission to counter staff. `completeTransfer` now checks rank explicitly (`MANAGER_RANK = 20`, the same shape `approveAuction` uses for `REGIONAL_RANK`). The test that pins this uses an actor holding `leases:transfer` at rank 10, so it fails for the rank and not for the permission.

**2. A closed reason vocabulary, on its own audit action.** `LIEN_TRANSFER_REASONS` is transfer-specific (`downsize_to_affordable`, `payment_plan_agreed`, `facility_need`, `unit_uninhabitable`, `billing_error`, `other`) rather than the generic monetary-override list, because the generic one cannot answer the question this record exists for — "the notice named unit A and the goods are now in unit B, why" — and `management_approval` against a lien file says only that somebody senior agreed, which was never in doubt. Free text is refused: a code outside the vocabulary is rejected, so the log stays filterable.

The entry goes to a **new audit action**, `lease.transferred_in_lien_pipeline`, with `requiresReason: true`. That is the load-bearing choice: `recordAudit` itself throws `MissingReasonCodeError` when a required reason is absent, so the record a lien file needs cannot be omitted by a caller who forgot. An ordinary transfer keeps `lease.transferred` and stays reason-free — the audit catalog's own comment on that action says why ("the tenant asked to move units, which is an ordinary service request, not a discretionary override"), and that remains true. A lien-pipeline move is also now independently filterable instead of being one row among every routine unit swap.

**3. The unreset clock — which was a live defect, not an assertion to add.** This is the part worth reading. The row asked for "one test that the lien clock reads the same value either side of the move." Written as a probe first, that test failed, and not marginally:

| | before the transfer | after |
|---|---|---|
| `outstandingCents` | `20000` | **`0`** |
| blockers | *(no balance blocker)* | **`balance_settled`** |

D-86 (B-138) re-points the unpaid invoices at the new lease, so the old lease's ledger nets to zero. `AuctionCase` stays pinned to that lease — and read its balance from it. So a staff transfer of a `pending_auction` lease made the case report **"This lease owes nothing. There is no lien to enforce."** against a tenant who still owed every cent of the claim. The clock did not merely fail to be asserted; it silently zeroed.

**The fix follows B-138's own philosophy rather than re-pointing the case.** B-138 recorded the rule as: *money state follows the tenant by moving the row; evidence state stays where it happened and is read along the link.* An `AuctionCase` is evidence — it names the lease and unit a served notice named, and moving it would make the file claim a notice named a unit it never named. So the case stays pinned, and the **money is read forward** instead: `leaseSuccessorIds` in `lib/billing/transfer-chain.ts` walks the same `transferredFromLeaseId` link B-138 built, in the opposite direction (that module walked ancestors, for a reader standing on the tenant's current lease; a case stands at the old end and has to look forward).

**A second, more dangerous gap fell out of the same root cause and is fixed with it.** `block_auction` holds were also read from the pinned lease only. B-137 copies holds *in force at transfer time* onto the new lease, so those were fine — but a hold declared **after** the move lands on the lease the tenant now holds, and the case would never have seen it. That is the one blocker on the readiness list where proceeding is a federal matter rather than a state lien-law defect: an SCRA, bankruptcy, deceased or litigation hold failing open on a lien sale. Both `auctionCase` and `approveAuction` now check the effect across the chain. Fixing only the balance — the half the row named — would have left this open.

**What it decided, and a later session must not silently reverse.**

- **The case does not follow the tenant.** It stays pinned to the lease and unit the served notice named; the reason code is what reconciles the notice against the move, not a re-pointed row. D-85 says this in as many words ("a served notice naming a unit can still be reconciled against the move").
- **The refusal is at the commit, not the quote.** `previewTransfer` deliberately does not refuse a lien-pipeline lease — staff are meant to price the move before deciding, since D-85 chose to allow it. The preview carries `inLienPipeline` so the wizard knows to ask.
- **The claim grows across a transfer, it does not merely persist.** A tenant moving to a differently-priced unit posts the transfer's own proration onto the new lease, which the chain read now includes. The "same value either side" test uses a same-rate target so the move is money-neutral and the property under test is isolated; a second test covers the realistic case and asserts the claim never drops below what was already owed.

**Test verification.** Seven new tests in `tests/transfer-db.test.ts`. **Every one was confirmed to fail against the code it guards** — the three clock/hold tests with `auctions/service.ts` stashed out, the three control tests with `admin/transfer.ts` and the audit catalog stashed out — so none of them is a tautology. Full unit suite **3,577 passed, 8 skipped of 3,587**, which reconciles exactly against B-158's 3,580 plus these 7, and **run twice back to back with identical totals** — the check a change that touches shared fixtures (auction cases, a delinquency timeline) actually has to survive. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: no difference detected — **no migration, and no new column**: the reason lives in `AuditLog.reasonCode`, which D-85 asked for by name ("a reason code and an audit entry"), and the chain walk uses the `transferredFromLeaseId` link B-138 already added. Production build green. The only failures in the sweep are the two `comms-observability-db.test.ts` `detectConsumerLag` assertions, already proven pre-existing on unmodified `main` during B-158 and untouched by this item.

**Accessibility.** The statement was re-read and needs no change: its coverage claim is scoped to non-admin routes (`customerFacingExceptions` filters `audience !== 'admin'`), and this item changed only the staff-only transfer wizard. The new warning banner uses the house pattern for lien-adjacent warnings (`border-2 border-amber-500 bg-amber-50 text-amber-950`, matching the delinquency and notices settings screens) rather than the lighter variant first written, and the reason select is the same shared `Field as="select"` control the scanned waiver and returned-payment reason codes already use.

**Left behind.** **The banner and the reason select are a conditional state no scan opens** — they render only for a `pending_auction` lease, which is precisely the structural gap **B-156** owns (post-interaction and conditional states are scanned almost nowhere, and `[param]` routes only where somebody remembered a click-through). Flagged there rather than worked around here. **`recordSaleOutcome` still posts the waterfall against the pinned lease and unit**, which after a transfer is a unit the goods are no longer in — whether a lien sale following a transfer sells the *new* unit's contents, and what the served notice has to say for it to, is a policy question with real exposure and needs the D-10 attorney pass rather than an implementation guess. **No e2e spec** for the lien-pipeline branch; covered by the integration tests, same posture as B-137/B-138. **A promotion still does not follow a tenant through a transfer** — D-89 named this row as the natural home if an operator ever reports it, and none has.

## B-159 — The accessibility statement was overstating again, and the fix was to claim less

`4b98ca6`

**What it built.** Four claims in the public statement's "How we check" section, two of them plainly untrue, corrected — no new behaviour, no schema, no control. First row of the 2026-08-24 review block and taken first deliberately: this page is a live public claim about the codebase rather than a defect a visitor has to reach, and CLAUDE.md's end-of-item checklist names it for that reason.

- **"they block a release if they fail" was false.** Every axe scan lives in the `e2e` lane of `.github/workflows/ci.yml`, gated on `main` or a non-draft PR, while `vercel.json` carries no `ignoreCommand` and there is no deploy workflow — so Vercel's Git integration builds and ships a push to `main` in **parallel** with Actions and independently of its result. A failing scan has never stopped anything. Compounding it, this repo's own always-open-as-a-draft PR rule means the a11y lane does not run at all on the PR where the code is written. The sentence now says where the tests run and says in as many words that they are **not a release gate**.
- **"We test by keyboard by hand" was unrecorded**, which on this page is the same thing as untrue: PRD 02 §5.5 FR-24 defines "recorded" as a line in `docs/PROGRESS.md` and there is none, for any item. The screen-reader sentence beside it was correctly disclaimed and the keyboard one was not; they are now one disclaimed sentence.
- **The generated exception list is route-keyed by construction** — `customerFacingExceptions()` filters an array of routes, so no post-interaction STATE can ever appear in it — and a list that reads as a complete account of gaps while being structurally unable to hold half of them is the same overstatement in a new form. One sentence now says it names pages.
- **"They also fail on checks the tool could not decide" held only for the public route loop** in `e2e/a11y.spec.ts`. `smoke.spec.ts`, `portal.spec.ts`, `admin.spec.ts` and the rest destructure `violations` only, so every checkout step — the money path — was scanned without the `incomplete` assertion the page claimed for it. Scoped to the public pages, with the account and checkout named as collected-but-not-enforced.

**What it decided.**

**D-90 (owner): correct the sentence, do not build the gate.** The two honest endings for the release-gate claim were (A) rewrite it, free and true today, or (B) build a Vercel `ignoreCommand`/deploy workflow so a red scan genuinely stops a ship and keep the stronger sentence. Option A, on two grounds: the overstatement is live *now*, so a free correction lands today and a gate that takes a session does not; and whether a red scan should block a deploy is a CI-cost and release-velocity decision that deserves its own merits rather than being smuggled in as the price of making one sentence true. Option B is not closed — taking it later is a one-line edit to this page plus the gate.

**`LAST_REVIEWED` deliberately does not move.** These are retractions, and a retraction is not a re-verification. The date is a claim about the whole page and the "where we fall short" list was not re-checked here. That rule is now written into PRD 01 §6.8 alongside the other three this row produced, so the next session does not have to re-derive it.

**The state list is B-184's, and this row did not wait for it.** Enumerating the unscanned post-interaction states is real work with a real design (`SCANNED_STATES` beside the route array). A true sentence today beats a complete list later, on a page whose whole failure mode is claiming more than it can support.

**A real bug found along the way, and it was not flaky.** The unit suite was already red before this item touched anything: two `detectConsumerLag` tests in `tests/comms-observability-db.test.ts`. B-155's entry recorded the same file failing and attributed it to "the order-dependent shared-database signature this repo has documented since B-090b/B-154." It is not that. `staleDeliveryCount` counts events of a given name with no settled delivery for a given consumer **across the whole outbox**, and both tests used a fresh consumer name and asserted an absolute count of zero — which holds only while no other suite has ever emitted a `lease.moved_in` into `storage_test`. Seventeen had accumulated, and it now fails **alone**, deterministically, rather than intermittently. A count that grows monotonically until it crosses a threshold looks exactly like flakiness right up until it stops being intermittent, which is the part worth keeping. Fixed at the root with the scope that already existed for this: `dispatchEvents` takes an optional `facilityId` and its own comment says a test sharing a database with a global outbox "needs a way to say which events are its own" — `staleDeliveryCount` was the one sibling left out of it, so it now takes the same optional parameter and the settled-delivery test passes this run's facility. The quiet-consumer test pins `now` to 2020-01-01 instead, because it goes through `detectConsumerLag`, which takes a clock and not a facility. **No production behaviour changed** — the hourly detector passes nothing and still gets the global count FR-19 wants.

**Test verification.** Full unit suite **3,579 passed, 8 skipped of 3,587** (217 files passed, 1 skipped), **exit 0** — the first fully green full run since before B-155, which recorded 7 failures across three files. The suite was run **twice** after the fix, per the shared-state rule, and `tests/comms-observability-db.test.ts` was additionally run alone twice (13/13 both times) — which matters more than usual here, since the bug being fixed *is* a shared-state assumption. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: **no difference detected** — no migration, no new column. No e2e run: this item changes prose on a page already in the public axe loop and one function signature with no call-site behaviour change.

**Left behind.** **The deploy gate is not built** — D-90 keeps it available and nothing owns it; if it is ever wanted, it is a `vercel.json` `ignoreCommand` or a deploy workflow plus restoring one sentence. **The keyboard claim is a disclaimer until somebody records a pass** — B-184 owns the three manual passes (VoiceOver on the money path, keyboard on the four task queues and the promotions list, and the live map, still owed since `PROGRESS.md:4249`), and the sentence goes back to being a claim only when one is written down with its date. **The state-level exception list is B-184's**, so "it names pages" is the honest sentence until that row lands. **`staleDeliveryCount`'s other caller-visible gap is untouched**: the production detector still counts the entire outbox, which is correct for FR-19 and means a genuinely lagging consumer alerts on events from every facility at once — nobody has asked for a per-facility lag alert and this row did not invent one.

## B-160 — The auction file named the wrong unit, and the sale paid off the wrong lease

`13d23a2`

**What it built.** D-85 lets staff move a `pending_auction` tenant's goods to another unit; B-157 made the balance and the holds follow them. Every other reader of the case still named the unit the notice was served on, and the money still posted to the lease D-86 had already emptied. Four consequences, all of them live:

- **Staff cut the lock on a re-rented unit.** `auctionCase` returned the pinned `unit.number`, so the case screen, the lock-cut instruction, the inventory document and the advertising record all named a unit the goods had left — one that `completeTransfer` returns to `available` in the same transaction, and which a walk-in may be renting a week later.
- **A completed sale left the arrears standing.** `recordSaleOutcome` summed `outstandingCents` across the whole chain (B-157) and then posted every waterfall entry to `view.leaseId`, the pinned lease. The balance was read forward and the credit posted backward, so after a sale the live lease still showed the full claim and the delinquency ladder kept running on a tenant whose goods had already been sold.
- **The cleanout went to the wrong unit too.** The post-sale release to `maintenance` used the same pinned id, so the unit that was actually emptied stayed rentable and one somebody else was living in was flagged for cleanout verification.
- **Nothing said the notice and the goods had parted company.** No screen, document or record stated both facts.

The fix is one idea applied everywhere: **the case's pin is the evidence, not the instruction.** `AuctionCaseView.unitId`/`unitNumber` now name the unit the goods are in — what staff walk to, advertise, open and release — and `noticeUnitId`/`noticeUnitNumber` name what the served notice says, with `goodsMoved` and `currentLeaseId` beside them. That direction is deliberate: a reader that has not been told about the split names a unit somebody should walk to rather than one re-rented three weeks ago. The case screen renders both facts in an amber note; the inventory document carries both in its own text, and **never blank** — FR-6 treats an empty merge value as a missing one and throws, and an inventory that affirms *"the lien notice was served naming this same unit"* is better evidence than one that is silent. Sale proceeds post to `currentLeaseId`. `recordLockCut` heads its document with the opened unit.

**What it decided.**

**D-91 (owner): a lien transfer requires the notice to be RE-SERVED, naming the unit the goods are in now.** A Ch. 59 notice names the space, so once the goods move, the notice on file describes somewhere they are not — and an advertisement naming a unit the goods were never in is the commonest wrongful-sale claim after an unserved notice. The two rejected options are recorded in full: the audit record alone (faster, defensible only if a court reads the move as continuity of the same claim), and re-serving only on a size change (puts a legal distinction inside a size comparison). **The notice period runs again from the new service; the arrears clock does not** — that is D-85's rule and this does not touch it.

**Built as a read, not a rule.** `auctionCase` looks for the served notice against the CURRENT lease instead of the pinned one, so a moved case simply does not find one and the existing hard block fires. The only new machinery is a distinct `notice_names_another_unit` blocker, because "no lien notice has been served" is a lie when one was, on a unit the tenant has left — and a manager who served it themselves will spend the afternoon looking for a bug instead of re-serving.

**Nothing is stored, and that was the main design choice.** `leaseSuccessorIds` already returns each chain newest last, so the tail is where the tenant and the money went. A `currentUnitId` column would be a second answer to a question the chain already answers, and the two would drift the first time a transfer path forgot to write it. The extra lease lookup happens only when the chain is longer than one.

**The row's `recomputeUnitStatus` guard was deliberately not built, and it is not a deferral.** The row asks that a unit be refused `available` while a live case names it. Applied to the pinned unit that is wrong — the goods have gone, the unit is genuinely empty and should re-rent, and blocking it costs real revenue for no protection. Applied to the current unit it is redundant: `pending_auction` is in `OCCUPYING_LEASE_STATUSES`, so that unit is already held by its own live lease and cannot derive to `available` while the case is live. Once the case names the right unit, the harm the guard was aimed at is gone.

**Test verification.** Full unit suite **3,587 passed, 8 skipped of 3,595** (217 files, 1 skipped), exit 0, **run twice**. `tests/auctions-db.test.ts` gains six database tests for the moved case — both units reported, the unmoved case unchanged, the sale blocked until re-service and released by it, proceeds landing on the live lease with nothing on the pinned one, the emptied unit going to cleanout while the pinned one stays available, and the inventory naming both units — and was additionally run alone twice (40/40). `tests/auction-readiness.test.ts` gains two pure tests, including one pinning that the blocker's wording does not suggest the arrears clock restarts. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings. Schema drift: no difference detected — no migration, no column. No e2e: the auction pipeline has no e2e spec today and this row did not invent the first one.

**One existing test changed, and it is worth naming.** `transfer-db.test.ts`'s B-157 case asserted `after.unitNumber === before.unitNumber` — the pin, read through the field this row repurposes. The intent it was written for is unchanged and still asserted, now through `noticeUnitNumber`, and the test additionally pins the new contract (`goodsMoved`, and the view naming the destination unit). No behaviour was walked back to make it pass.

**Left behind.** **Re-serving is manual** — the block tells a manager to serve a new notice and the existing notice generation does it; nothing offers a one-click "re-serve for the new unit" from the case screen, which is the obvious next convenience and nobody has asked for it. **The `/admin/auctions` LIST does not flag a moved case** — it renders the corrected unit number, so it points at the right place, but a reader cannot tell from the list that the notice named another unit; the case screen is where that has to be seen and it is one click away. **`outstandingSurpluses` still names the pinned unit** — it is post-sale bookkeeping about money owed to a former tenant, and correcting it means another chain walk on a list that is about the money rather than the unit. **The advertisement text is still typed by a person**; this row fixed the number they read off the screen, not the record they type, and `AuctionAdvertisement` still stores no unit at all. **Per-state configuration of D-91 is not built** — the re-service rule is hardcoded Texas-default behaviour, on the same D-10 attorney-pass list as the surplus holding period and the vehicle carve-out.

## B-161 — One returned ACH served the whole lien ladder in a night

`f3188fe`

**What it built.** `packages/core/delinquency/engine.ts` returned *every* unexecuted step at or below `daysPastDue` and the nightly run executed all of them in one pass. `cure()` supersedes the whole step history, and `returnPayment` re-opens the invoices at their **original** due date (D-25 — correct, the money never arrived). So a bank clawing back a payment on a 90-day-old invoice put the lease back at full age with an empty record, and that night's run sent four dunning letters in the same post, re-cut the gate and called `openAuctionCase`. The lien pipeline opened by a chargeback, overnight, with no human in it.

Four changes, and the first is the one that matters most:

- **At most one step per lease per run, always.** `evaluate` now returns `due.slice(0, 1)`, and a new `executedToday` input makes a second run the same evening a no-op rather than a second rung. Both halves are needed: the cap alone would let the nightly job be run twice and walk the ladder twice. This is not configurable and is not part of the policy — a ladder is a sequence of chances to pay, and a lien file whose ninety days of notices all bear one date is not a lien file.
- **The ladder is held after a reversal.** A new `reversal_grace` halt, resolved by `reversalGracedLeases` from two facts: the reversal is inside `reversalGraceDays` of the business date, or the `settling_payment_failed` task about it is still open. The gate is keyed on the payment's **status**, not on the reversal entry, so B-147's won dispute (`reinstatePayment` sets it back to `succeeded`) lifts the hold for free while the append-only entries stay where they are.
- **The served history is put back.** `resumeLadderAfterReversal` un-supersedes the step runs the cure closed — scoped to those superseded at or after the payment posted, so an older episode the tenant genuinely settled and moved past stays closed, and per lease along the transfer chain, because `delinquency_step_run_open_episode` is a partial unique index on `(leaseId, dayOffset) where supersededAt is null` and a day already live on a *newer* episode must not be collided with.
- **The controls shipped with the columns.** `reversalGraceDays` (0–90, default 10) and `reversalResumes` (default true) are two fields on `/admin/settings/delinquency`, next to each other and each referring to the other, validated server-side as well as by the input — this is a legal configuration reachable by a POST. `TimelineProblem` gained an optional `field` so the refusal lands on the control rather than in the steps error.

**What it decided.**

**D-92 (owner): ten days of grace, then RESUME at the stage already reached** — per-facility configurable both ways. **Resume, not restart**, because restarting re-serves ninety days of notices and hands any tenant a way to defer an auction indefinitely by paying and reversing; it is defensible because the earlier notices really were served and are still in `DelinquencyStepRun`. **Ten days** is ordinary NSF re-notice practice and enough for a bank-side error to be put right by somebody holding a receipt and a cure confirmation. The rejected option — restart at day one — is recorded in D-92 with what it costs.

**The one-step cap is the fix; the grace window is the policy.** Worth separating, because only the second one was the open question. Even with `reversalResumes` false the ladder now re-serves one notice a night rather than all of them at once, so the restart option is survivable in a way it was not before.

**The row's fourth bullet needed no code, and it was checked rather than assumed.** "No re-assessment of a late fee a superseded run already charged" was already true: `assessLateFees` reads which ladder steps it has charged from the lease's own **fee invoices** (B-138), and a reversal voids none of them — a paid fee invoice stays paid-and-present, a reopened one stays present. `late-fees-db.test.ts` now pins it.

**The gate deliberately has no time limit.** An open `settling_payment_failed` task holds the ladder for as long as it stays open, which means a forgotten card in that queue freezes the pipeline on that lease. That is the row's explicit ask and it is the right way round: the failure mode is a delayed auction, not an auction nobody authorised. It is visible — the run records `ladder held — a returned payment is still being settled` per lease on the Billing Runs screen, because a pipeline that has stopped for a reason nobody can see is indistinguishable from one that is broken.

**Test verification.** Full unit suite **3,595 passed, 8 skipped of 3,603** (217 files passed, 1 skipped), **exit 0**, run twice. `tests/delinquency-engine-db.test.ts` gains four database tests for the bounce — the served history restored rather than left empty, the ladder held with the reason recorded, one step (not four) once the grace is over and the queue card closed, and the hold continuing while that card stays open — and `tests/delinquency-engine.test.ts` gains three pure ones, including that a tenant can still cure inside the grace window. `tests/late-fees-db.test.ts` gains the fourth bullet's check. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: **no difference detected**. No e2e run: nothing customer-facing changed and the delinquency settings screen has no e2e spec today.

**A real bug found on the way, and it is not in this code — B-185.** The first two full sweeps failed four and five tests in `tests/marketplace-db.test.ts` with *"Timed out fetching a new connection from the connection pool"*, and that file passes 10/10 alone. Stashing this row's changes and running the suite on a **clean tree reproduced it, worse** — 4 failed / 3,583 passed, `admin-tenants-db.test.ts`'s `searchTenants` case joining in. The cause is the test database: `storage_test` held **13,106 facilities and 8,276 units**, all created in August 2026, because only 32 of ~120 database suites clean up after themselves. `marketplaceFeed()` scans the whole facility table, so under parallel load it holds a connection past the 10s pool timeout; `searchTenants` caps at 25 results and hundreds of leftover "Ada Renter" rows now fill them. Dropping the schema and re-running `db:migrate:test` is what produced the green run above. **Both failures read as product bugs and neither is one** — a broken marketplace feed and a broken tenant search — which is exactly why it is a backlog row rather than a note. B-185 owns the cleanup discipline and the two over-broad assertions.

**Three existing tests changed, and the change is the point.** `delinquency-engine.test.ts`'s "fires every step passed, oldest first" and "catches up a missed week in one run" both asserted the behaviour this row removes; they now assert one step, and the catch-up case runs two evaluations to show the ladder still catches up, a night at a time. The DB suite's stage-change case needed a second night to reach the second step. No behaviour was walked back to make a test pass.

**Left behind.** **The test-database accumulation is only reset, not fixed** — B-185 owns it, and until it lands a sweep on a laptop that has not reset `storage_test` recently will fail in `marketplace-db` and `admin-tenants-db` for reasons that have nothing to do with the diff being tested. **Late fees are not gated by the grace window** — `assessLateFees` keeps running through it, so a reversal-re-opened arrear can cross a fee step while the ladder is held. B-103's rule already covers the honest case (a debit still in transit), a returned payment is genuinely late money, and no row asks for it; flagged because the two engines now treat a reversal differently and that is worth knowing before somebody assumes otherwise. **Nothing tells staff on the tenant profile that the ladder is held** — the reason is on the Billing Runs record and in the queue's absence, not on the lease. **The grace clock is the reversal's `occurredAt`, not a facility-local business date** — accurate to the hour rather than to the day, which is stricter than the ladder's own day-granular arithmetic and errs towards holding longer. **`reversalResumes: false` is untested against a real chain** — the restart path is a no-op by construction (skip the restore) and is covered by the resume tests' inverse, not by its own case. **Older versions of a timeline show the new settings only through the active one** — the version list on the settings screen still renders label, qualifying amount and steps, so a reader comparing versions cannot see that the grace changed between them.

## B-162 — A transfer was built as if the tenant were new

`PENDING`

**What it built.** Three defects with one cause. `previewTransfer` opened the new lease at the destination unit type's **street rate**, so a like-for-like move between two 10×10s was a rent increase — served with no notice period, no approval and no `TenantRateIncrease` record, through a screen for a service request the tenant asked for. Every protection US-11 puts around raising a rent was bypassed by moving the tenant sideways. An approved, *noticed* increase on the old lease evaporated and the nightly run reported `ok: true, "skipped — the lease has ended"` for it, every night, until the effective date passed. And ECRI tenure read `rateChanges[0].effectiveFrom ?? lease.startDate` on the new lease — where the transfer had just written a `LeaseRateChange` dated today and `startDate` *is* the transfer date — so months-since-last-change reset to zero on both halves of the fallback and asking to swap units was a way to opt out of every increase.

- **The rate.** `Facility.transferRatePolicy`, defaulting to `preserve_discount`: `new street × (in-place ÷ old street)`, capped at street. A lateral move costs exactly what they pay now, a downsize prices down, an upsize prices up. `street` and `in_place` are configurable alternatives with a control on the billing settings screen, and staff can type a figure on the transfer preview — re-previewed rather than applied on confirm, so the number somebody confirms is the number that posts. The preview restates the policy figure and the street rate beside an overridden one, and both land on the audit row.
- **A transfer that raises the rent says so.** An amber note naming both figures and the date, and stating that there is no notice period behind the new one.
- **The in-flight increase is cancelled, and named first.** The preview shows it; the commit cancels it inside the same transaction with a `rate.increase_cancelled` audit row carrying `reasonCode: 'transfer'`.
- **The promotion follows the tenant.** `PromoRedemption.leaseId` is re-pointed, so the remaining discounted periods, the minimum stay and the recapture obligation all move.
- **ECRI tenure reads the chain.** A `reason: 'transfer'` rate change is ignored when picking the last change, and the fallback is the chain's origin start date rather than this lease's.

**What it decided.**

**D-93 (owner), three answers.** The rate **keeps the tenant's discount off street** — the only rule that is right in all three directions, because it carries the thing the tenant actually holds (their position relative to street) rather than a dollar figure that only means anything against the unit they are leaving. The promotion **follows, benefit and obligation together** — carrying the obligation alone would take something from the tenant for making a move the operator wanted. The in-flight increase is **cancelled, not re-pointed**: the approver signed off on a delta from a figure the transfer replaces, so a re-pointed increase has to be either re-based (applying an approval nobody gave) or refused at apply time regardless. Refusing the transfer outright was rejected — it blocks a retention action for a reason the tenant cannot fix, and staff would cancel and retry for the same outcome.

**Two consequences the row did not anticipate, and they were the larger half.** Re-pointing the redemption on its own would have been worse than leaving it: the promo schedule's `periodIndex` was counted from the lease's own start, so the new lease restarted at zero, `appliedPeriods` (already holding 0 and 1) silently swallowed its first two months, and month three's discount would have arrived in month five. And `recaptureForLease` measured the minimum stay from `lease.startDate` — the transfer date — so a tenant who had served eight months would have been billed a full recapture for leaving. **Both are fixed the same way the delinquency ladder's position and the late-fee ladder's already were: by reading along `transferredFromLeaseId`.** `generateInvoices` offsets the period index by the periods the tenancy already billed, and the minimum stay is measured from the chain's origin.

**The target dropdown is priced by the policy too.** It quoted street while the settlement below it quoted the policy figure — two answers to one question with no way to tell which posts, and under `preserve_discount` they differ on nearly every row. The held-unit case already had this fix for the same reason; it now covers every row.

**The apply path cancels rather than skipping again.** `applyDueRateIncreases` marks an increase against an ended lease `cancelled` instead of reporting a bland success every night for ever, and reports `ok: false` when the lease ended as a **transfer** specifically — after this row that should not happen, so it is worth flagging rather than absorbing.

**Test verification.** Full unit suite **3,613 passed, 8 skipped of 3,621** (218 files passed, 1 skipped), **exit 0**, run twice with identical totals. New: `tests/transfer-rate.test.ts` — nine pure tests over the rule, covering all three policies in all three directions plus the two edges that decide whether it is safe (a tenant paying above street is capped at street; a de-priced legacy unit type falls back to street rather than freezing the in-place rate for ever). `tests/transfer-db.test.ts` gains seven database tests — the lateral move that used to be a rent rise, the upsize that keeps the discount and says the rent is going up, the `street` policy still honoured, a staff override posting and auditing both figures, an in-flight increase named on the preview and cancelled on commit, the redemption re-pointed with `appliedPeriods` intact, and the minimum stay measured from the tenancy rather than the transfer. `tests/invoices-db.test.ts` gains the period-index offset, with deliberately distinct discount amounts per period so the assertion can tell period 2 from period 1 — three equal discounts would have passed whichever index was read. `tests/rate-increase-db.test.ts` gains the ECRI-after-transfer case. Typecheck clean including `tsconfig.tests.json`; lint 0 errors, 7 pre-existing warnings, unchanged. Schema drift: **no difference detected**. No e2e run: the transfer wizard has no e2e spec today and this row did not invent the first one.

**No existing test changed.** Worth stating, because the shipped behaviour did: every existing transfer case happens to use a lease whose in-place rate equals its unit type's street rate, so `preserve_discount` and `street` agree on all of them. That is luck rather than design, and it is why the new cases deliberately start from a lease $20 under street.

**Left behind.** **The rate override has no permission of its own.** `leases:transfer` (manager and above) is enough to set any figure, including one below street — which is exactly the discretionary giveaway B-153 gave `rate.tenant_decreased` its own audited action for. It is recorded (`rateOverridden`, `policyRateCents` and `newRateCents` all land on the audit row) but not gated, and no limit like `maxCreditCents` applies to it. **`in_place` can price above street and is not guarded** — that is the policy's own consequence and an operator choosing it is choosing it; the preview states the figure and the street rate beside it. **The chain walk caps at ten hops** (`MAX_HOPS` in `transfer-chain.ts`), so a tenant who has transferred more than ten times gets a tenancy origin that is too recent — the same cap and the same failure direction the delinquency and late-fee readers already carry. **`ProtectionWaiver` is untouched** — the third item in the same PRD AC, and it is B-163's. **Nothing re-quotes a stale portal hold against the new policy**: a hold taken before an operator changes `transferRatePolicy` still settles at what the tenant was quoted, which is D-84's rule and deliberate, but it means the two can disagree for the life of a hold.
