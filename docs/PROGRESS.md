# Build Progress

What has actually been built, in build order. Updated at the end of every completed backlog item.

This is the **narrative** record — what exists, what it decided, and what a later item still has to do. It complements rather than duplicates:

- `docs/prds/06-backlog.md` — the ordered work list and ✅ markers
- `docs/prds/07-decisions.md` — settled decisions that override PRD text
- `git log` — the change-by-change record
- `README.md` — how the built thing works today

**Status:** Milestone 1 (Foundation) — B-001 through B-011 done. Next: B-012 (seed & demo data), which closes the milestone.
**Tests:** 309 unit + 8 e2e passing as of B-011.

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

### B-011 — Street rate management ✅ `pending`

Effective-dated street and web rates per unit type, rate history, and a rates API. Completes US-9.

**Decided:** the flat `streetRateCents`/`webRateCents` columns on `UnitType` were **dropped**, not kept alongside the new history table. A denormalized "current rate" cannot stay correct — nothing fires an event when a future-dated rate's date arrives, so it would silently go stale, and US-9 requires the site to *always* show the current rate. Resolving at read time makes that true by construction, and volumes are trivial (tens of types × a handful of versions).

This is the opposite call from B-010's `Unit.status`, deliberately. Status changes are *event*-driven (a lease is created), so a denormalized column can be kept correct by recomputing on the event. Rate changes are *time*-driven, with no event to hook. Same-looking problem, different mechanics, different answer.

Reuses B-008's `effectiveAsOf`/`effectiveByGroup` rather than reimplementing effective-dating — one definition now serving tax components, fee schedules, and rates. B-056's delinquency timelines should use it too.

A type whose only rate is future-dated is **absent** from the resolved map rather than priced at zero, so nothing can mistake "unpriced" for "free". Creating a type writes its first rate in the same transaction; cloning copies the source's *current* rate as the clone's opening rate, not the whole history. `updateUnitType` ignores any rate posted to it — changing a price is publishing a row, never an edit.

Rate history state (`scheduled` / `current` / `superseded`) is resolved in the data layer against a single clock reading, not in the view. React's purity lint caught the first version reading `Date.now()` during render — which would also have let rows disagree with each other in one pass.

**Left behind:** `rates:street:propose` (which `manager` holds) has no propose→approve workflow; publishing needs `rates:street:change`, so managers currently cannot change prices at all. The public, unauthenticated pricing read with quote tokens is B-014 — `/api/facilities/[id]/rates` is staff-auth only.

**Found:** Prisma generated the migration with `DROP COLUMN` *before* the new table, which would have destroyed every existing rate. Rewrote it as create → backfill → drop, and proved the backfill by seeding a known $199.00/$179.00 type, running the migration, and confirming the values survived.

---

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.
