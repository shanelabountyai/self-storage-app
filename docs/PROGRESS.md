# Build Progress

What has actually been built, in build order. Updated at the end of every completed backlog item.

This is the **narrative** record — what exists, what it decided, and what a later item still has to do. It complements rather than duplicates:

- `docs/prds/06-backlog.md` — the ordered work list and ✅ markers
- `docs/prds/07-decisions.md` — settled decisions that override PRD text
- `git log` — the change-by-change record
- `README.md` — how the built thing works today

**Status:** Milestone 1 (Foundation) in progress — B-001 through B-009 done, B-010 in progress.
**Tests:** 227 unit + 8 e2e passing as of B-009.

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

### B-010 — Unit inventory 🔨 in progress

Split into two sessions (backlog sizes it M; it is four distinct things). Session 1 is the rules layer — derived status engine, unit CRUD, list + filters. Session 2 is grid view, JSON layout import, and bulk edit with preview.

**Deciding:** `Unit.status` stays the *effective* status (derived, queryable), and a new `Unit.operationalStatus` holds the operator's *intent* (available/maintenance/unrentable). Two columns because effective status alone destroys intent — a unit marked `maintenance`, leased, then vacated must return to `maintenance`, not silently to `available`, and the collapsing failure mode rents out a unit somebody deliberately took offline.

---

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.
