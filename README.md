# Self-Storage Business Application

Multi-facility self-storage platform. Learning project, built to professional standards.

Product specs live in [docs/prds/](docs/prds/). Build order is
[docs/prds/06-backlog.md](docs/prds/06-backlog.md), top to bottom;
[docs/prds/07-decisions.md](docs/prds/07-decisions.md) overrides any conflicting PRD text.

## Layout

```
apps/web        Next.js App Router — public site, tenant portal, admin (role-gated routes)
packages/db     Prisma schema + generated client, shared by every surface
packages/core   Shared domain logic — audit, events, jobs; billing and lease logic later
docs/prds       Product requirements, backlog, decision log
e2e             Playwright specs (smoke + axe accessibility)
tests           Vitest unit tests
```

## Data model

[packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) is the single
schema for every surface. Entity names are canonical per master PRD §7.5 — use them.

A few invariants can't be expressed in Prisma's schema language and live as raw SQL
appended to the migration: one active lease per unit, billing day 1–28, non-negative
invoice totals, positive payment allocations, and single-subject consent records.
`tests/schema-invariants.test.ts` pins them so a regenerated migration can't drop
them silently, and `tests/db-constraints.test.ts` exercises them against a real
Postgres (skipped when `DATABASE_URL` is unset).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:generate
npm run dev                  # http://localhost:3000
```

Requires Node 22+ (developed on 26). If `npm install` warns about blocked install
scripts, the packages that legitimately need them are already listed under
`allowScripts` in `package.json` — run `npm approve-scripts --allow-scripts-pending`
to review anything new.

## Environment

Root `.env.local` is the single source of truth and is gitignored. Every npm script
injects it via `dotenv-cli`, so both Next.js and Prisma read the same file.
[.env.example](.env.example) documents the variable **names** only — never commit a
value. `npm run test` fails if a value ever lands in it.

Mirror the same variables into Vercel project settings before the first deploy.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright smoke + axe accessibility scan |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed roles and permissions (idempotent) |
| `npm run db:seed:demo` | Seed two demo facilities and tenants in every lifecycle state |
| `npm run db:create-owner` | Bootstrap the first admin account (see Admin shell below) |
| `npm run db:studio` | Prisma Studio |

## Auth

One Auth.js (v5) install serves both audiences — tenants and staff — distinguished
by an `audience` claim on the session JWT. Sessions are JWT-backed (30 days) in an
httpOnly, SameSite=Lax cookie; there is no session table to query per request.

- **Passwords are optional.** Magic-link sign-in is a permanent path, not just
  onboarding (PRD 01 FR-5.1). `Tenant.passwordHash` and `StaffUser.passwordHash`
  are nullable by design.
- **Hashing is `node:crypto` scrypt** — no bcrypt/argon2 dependency and no native
  build on Vercel. Parameters are stored inside each hash, so raising them later
  doesn't invalidate existing passwords; `needsRehash()` upgrades on next login.
- **Tokens are stored as SHA-256 only.** Magic links expire in 15 minutes,
  resets in 60, and both are single-use — burned atomically so a double click
  can't yield two sessions.
- **Login is throttled in Postgres**, per identity and per IP. No Redis; see
  `LIMITS` in `apps/web/lib/auth/rate-limit.ts` to tune.
- **Failures never enumerate accounts.** Unknown email, no password set, wrong
  password, and disabled account all return the same result, and the KDF runs
  even when there's no account so timing doesn't leak either.

Magic-link and reset emails currently print to the server console in development
and throw in production — the real sender is the notification service in B-030.
Sign-in and reset screens are B-033; `/login` is referenced but not built yet.

## Authorization

Roles are rows, not an enum — adding one is a seed change, not a migration
(master PRD §7.1). The catalog lives in
[packages/db/rbac-catalog.ts](packages/db/rbac-catalog.ts) and is applied by
`npm run db:seed`, which is idempotent and safe on every deploy.

Seven roles: `tenant`, `counter`, `bookkeeper`, `manager`, `regional`, `owner`,
`system`. The `system` actor used by jobs is **not** a superuser — it holds only
what its seeded role grants.

Every facility-scoped query must go through `apps/web/lib/rbac/authorize.ts`:

```ts
const actor = await requireStaffActor()
requirePermission(actor, 'units:edit', facilityId)

const units = await prisma.unit.findMany({
  where: { ...resolveFacilityFilter(actor, facilityId), status: 'available' },
})
```

`facilityScope()` and `resolveFacilityFilter()` return a Prisma `where` fragment
and **fail closed**: a staff user with no assignments gets `{ facilityId: { in: [] } }`,
which matches nothing. They never return an unrestricted `{}` except for a genuine
all-facilities assignment. Requesting a specific facility narrows; it can never widen.

There is no superuser bypass and there must never be one (D-12). Unrestricted access
is an ordinary assignment row — `owner` role, `facilityId: null` — so it stays
grantable, revocable, and auditable. The `db:create-owner` bootstrap script that
creates the first one lands with the admin shell in B-007; until then there are no
staff accounts.

Monetary authority (`fees:waive`, `refunds:approve`, `credits:manual`) is configured
per role in cents; `null` means unlimited. Over-limit is not a plain failure —
`checkMonetaryAuthority()` reports the shortfall and `nextApproverRole()` finds the
role that can approve it (PRD 02 RBAC-2). The approval-request workflow itself lands
with refunds in B-048.

## Admin shell

`/admin/*` is role-gated at two layers: [proxy.ts](apps/web/proxy.ts) (Next's
edge middleware convention, renamed from `middleware.ts` in Next 16) checks the
JWT session's `audience` claim before any page renders — no DB call, since Prisma
isn't Edge-Runtime compatible — and every layout/page re-checks with the actor's
real permissions from `lib/rbac/authorize.ts`. Nav visibility hides items a role
can't use, but hiding a link is UX, not the gate: `app/admin/[section]/page.tsx`
checks the same permission server-side before rendering anything.

**Bootstrapping the first account.** Nothing before this item can create a
`StaffUser` at all (D-12 — there is no permission bypass, ever; unrestricted
access is always an ordinary `owner` + all-facilities assignment row):

```bash
npm run db:create-owner -- --email you@example.com
```

Prints a one-time password-setup link (60-minute expiry, reuses the B-003 token
machinery). Refuses to create a second owner unless you pass `--force`, so
re-running it by accident is a safe no-op. The reset link points at
`/reset-password`, which doesn't exist until B-033 — call
`completePasswordReset()` directly, or wait for that item, to actually set the
password.

**The facility switcher** persists per browser via a cookie
(`lib/admin/facility-selection.ts`), not a per-user DB row — a deliberate
simplification, noted in code, upgradeable if cross-device persistence is ever
asked for. It always re-resolves against the actor's real access rather than
trusting a stale cookie, and "All facilities" only appears on the dashboard
(the one roll-up-capable screen that exists before B-042's portfolio report).

**Nav destinations without their own backlog item yet** (Units, Tenants,
Billing, …) render through one dynamic route,
[app/admin/\[section\]/page.tsx](apps/web/app/admin/[section]/page.tsx), rather
than ten placeholder folders.

## Facility settings

`/admin/settings` (PRD 02 US-3) edits the currently selected facility — there is
no "all facilities" bulk edit and no facility-*creation* screen; US-3's story is
configuring a site that already exists, and nothing else backlogs one either
(B-012's seed script creates demo facilities directly).

**Tax components and fee schedule are effective-dated (FR-9) and append-only.**
Changing a rate never edits or deletes a row — it inserts a new one with a later
`effectiveFrom`. `packages/core/facility-settings/effective-dating.ts` picks
"whichever row's effectiveFrom is the latest on or before a given date," so a
past invoice's already-generated line items are never retroactively touched, and
the full history stays visible (the versioning US-3 asks for) instead of being
overwritten. Tax rates are stored as basis points (`rateBasisPoints`, hundredths
of a percent — 8.25% is 825), the same reasoning as money-as-cents applied to
percentages. Fee amounts follow the normal `...Cents` convention; B-047 adds the
actual late-fee *rules* (caps, grace periods) on top of this baseline later.

Office and gate hours share one weekly-schedule shape
(`packages/core/facility-settings/weekly-schedule.ts`), validated on every write
so a malformed JSON blob can't reach the database. Gate hours are additionally
exposed at `GET /api/facilities/[facilityId]/gate-hours` — the API contract point
US-3's AC asks for, for the hardware module to consume once it exists (B-027+).

## Unit types

`/admin/units` (PRD 02 US-6) manages unit types per facility — dimensions, floor,
climate/drive-up/power, description, and the two flat rate fields the `UnitType`
model already carries (effective-dated rate *history* is B-011). Unlike facility
settings, a unit type is plainly mutable, not effective-dated — there's no US-3-
style versioning requirement for it, so edits update in place.

**Door type is deliberately not managed here.** US-6's prose lists it as a
unit-type attribute, but B-002 already modeled `doorType` on `Unit` (a physical
unit's door can vary within a type — e.g. a corner unit). Adding it to `UnitType`
too, with no defined rule for which one wins, would just create two sources of
truth. Flagged for an owner decision if a per-type default door type is wanted;
B-010 (unit inventory) owns the per-unit value either way.

**Clonable across facilities** (the AC's own word) copies every attribute except
`facilityId` into a new row at the target facility, and refuses if that facility
already has a type with the same name — the existing `@@unique([facilityId, name])`
constraint, not new logic. Requires `units:edit` at the *target* facility, since
that's where the write lands; only needs to be able to see the source.

There is no "Units" grid/list yet — that's PRD 02 US-5/7/8, backlogged as B-010.
`/admin/units` shows type management for now, the same way `/admin/settings`
replaced its placeholder in B-008; B-010 adds the actual inventory view alongside
or on a sub-route.

## Unit inventory

`/admin/units` is the inventory (list and grid); `/admin/units/types` is unit-type
management. Both share one filter definition (`lib/admin/unit-query.ts`) so the
rows an operator sees are provably the rows a bulk edit will act on.

**Status is derived, not free-form** (PRD 02 US-8), which needs two columns:

| Column | Meaning |
|---|---|
| `Unit.status` | Effective status. Derived, queryable. Written **only** by `recomputeUnitStatus()`. |
| `Unit.operationalStatus` | The operator's intent — `available` / `maintenance` / `unrentable`. The only part a human sets. |

One column can't do both: a unit marked `maintenance`, leased, then vacated must
return to `maintenance`, not silently to `available`. The rule itself is pure and
lives in [packages/core/inventory](packages/core/inventory/unit-status.ts), so
availability reads (B-014) reuse it rather than redefining "rentable". Precedence
is `overlocked > occupied > reserved > intent`.

A direct `data: { status }` write anywhere outside `recomputeUnitStatus()` is a
bug. Anything that changes lease, reservation, or delinquency state must call it —
that's B-018, B-026, B-040, and B-057.

**Bulk edit** previews before applying, and preview and apply run the *same*
evaluator — otherwise the preview eventually lies about what apply will do.
Blocked rows are skipped and reported with the blocking record named; the whole
operation lands as one audit entry with per-unit detail inside it (US-7). The
operation is re-evaluated at apply time, since a lease can be signed between
preview and confirm.

**JSON layout import** creates missing units and updates existing ones, matched by
number — the realistic case is standing up a facility where nothing exists yet.
It's all-or-nothing: if any row references an unknown unit type, nothing is
written, because a half-imported layout is worse than none. It never touches
occupancy.

## Street rates

Rates live in `UnitTypeRate`, effective-dated and append-only (PRD 02 US-9) —
`UnitType` carries **no** current-rate column. A denormalized "current rate"
would go stale the moment a future-dated row's date passed, because nothing
fires an event when a date arrives, and US-9 requires the site to *always* show
the current rate. Resolving at read time makes that true by construction.

- `currentRatesForFacility(facilityId, asOf?)` — one query, one rate per type
- `currentRateForUnitType(unitTypeId, asOf?)` / `rateHistoryForUnitType(...)`
- `publishUnitTypeRate(...)` — appends; requires `rates:street:change`

The "which row wins as of a date" logic is B-008's `effectiveAsOf` /
`effectiveByGroup`, reused rather than reimplemented — one definition of
effective-dating across tax components, fee schedules, and rates.

A type whose only rate starts in the future is **absent** from the resolved map
rather than priced at zero, so a caller cannot mistake "unpriced" for "free".
Editing a unit type cannot change its price: that's `publishUnitTypeRate`, and
`updateUnitType` ignores any rate posted to it. Backdating inserts history
without rewriting the present.

Current rates are exposed at `GET /api/facilities/[id]/rates` (staff auth,
facility-scoped), which accepts `?asOf=` so a scheduled change can be verified
before it lands. The *public* pricing read with quote tokens is B-014.

## Public site

Public pages live in the `app/(public)/` route group — a group rather than a path
segment, so they keep clean URLs (`/faq`, not `/public/faq`) while `/admin`,
`/login`, and `/api` stay outside and never inherit the site header and footer.

Mobile-first per PRD 01 §6.1–6.2: designed at 360px, tap targets ≥44×44px, `tel:`
on every phone number, numeric `inputMode` on the zip field, and no
hover-dependent interaction.

**WCAG 2.1 AA is an acceptance criterion here, not cleanup** (§6.8), and it is
verified rather than claimed:

- `e2e/a11y.spec.ts` runs axe over **every** public route at two viewports. The
  route list is the contract — a page not in it is a page nobody checks.
- `e2e/smoke.spec.ts` asserts the skip link is genuinely the first tab stop, and
  that the document does not scroll horizontally at 320px (1.4.10).
- `prefers-reduced-motion` is honoured globally in `globals.css`, so a future
  animation cannot forget it.
- Lighthouse gates accessibility at 100 and holds LCP < 2.5s / CLS < 0.1.

The homepage search submits by GET to `/storage/search?q=…` so the query lands in
a shareable URL (US-101). That page is a placeholder — geocoding and
distance-ranked results are B-015 — but the URL shape is already correct so it
won't change under anyone later.

**Legal pages are unreviewed drafts and say so on the page**, not just in a code
comment (D-10). The accessibility statement is written as a real claim, including
what is *not* done yet, because claiming conformance for flows that don't exist
would be worse than saying so.

## Demo data

`npm run db:seed:demo` creates two facilities with tenants in **every** lifecycle
state — lead, reserved, pending, active, delinquent, pending_auction, ended — at
both, so facility scoping is demonstrable (PRD 03 US-7 AC4). Distinct from
`db:seed`, which seeds roles and permissions: those are reference data every
environment needs, these are fixtures only a demo wants.

Two deliberate properties:

- **It writes no audit entries.** Demo data is constructed state, not actions
  somebody took, so inventing audit history would make the log lie. It also keeps
  the data deletable — `AuditLog.facility` is `onDelete: Restrict`, so a facility
  with audit rows can never be removed.
- **Idempotent by teardown-then-create.** Every row is marked (`demo-*` slug,
  `*@demo.example.com` email), so a re-run reproduces a known state exactly
  rather than layering onto whatever was there.

Unit statuses are never written directly — the seed calls `recomputeUnitStatus()`
like everything else, so the demo exercises the real derivation rather than
asserting a status into place.

Test fixtures create their facilities with `status: 'inactive'`, which keeps them
out of the facility switcher. Any test touching an audited service function makes
its facility permanently undeletable, so without that they accumulate visibly.

## Audit log

`@storage/core/audit` is the only way to write an audit entry. Append-only is
enforced by Postgres triggers, not convention — `UPDATE`, `DELETE`, and `TRUNCATE`
on `audit_log` all raise, for every writer including psql.

```ts
await recordAudit({
  actor: toAuditActor(actor),
  action: 'fee.waived',
  entityType: 'Invoice',
  entityId: invoice.id,
  facilityId,
  reasonCode: 'customer_goodwill',   // required for this action, or it throws
  before: previous,
  after: updated,
})
```

- **Actions are a catalog** ([audit/actions.ts](packages/core/audit/actions.ts)),
  transcribed from PRD 02 US-38. Each carries `requiresReason`; `recordAudit()`
  throws rather than writing a privileged action with no reason code.
- **Snapshots are diffed, then redacted.** Only changed fields are stored, and any
  key matching password/secret/token/`valueRef`/ssn/pin is replaced with
  `[redacted]`. The diff compares *raw* values and redacts the result — redacting
  first would make two different passwords look equal and lose the change entirely.
- **Consequences of append-only:** a facility or staff user with audit history
  cannot be hard-deleted (`onDelete: Restrict`, since nulling the column would
  itself be a blocked update). Test suites cannot clean up audit rows, so
  `npm test` leaves entries behind in the dev database. That is correct behaviour.
- **Retention is ≥7 years** and there is deliberately no in-band purge. When one is
  needed it requires dropping the trigger — see the migration for the procedure.

## Events and background jobs

Vercel Cron hits `/api/cron` **hourly** ([vercel.json](vercel.json)), guarded by a
`CRON_SECRET` bearer token — the route rejects everything when that is unset.
Master §5 offers Vercel Cron as the MVP option; there is no Inngest or
Trigger.dev account to manage and nothing extra to run locally.

Hourly, not nightly, because nightly jobs run in **facility-local** time
(PRD 02 FR-4). Each tick asks which facilities have just reached their target
local hour, which is DST-safe for free: the 2am that doesn't exist in spring and
the 1am that happens twice in autumn both produce exactly one run.

**Transactional outbox.** Pass the transaction client so the event and the change
it describes commit together:

```ts
await prisma.$transaction(async (tx) => {
  const lease = await tx.lease.update({ where: { id }, data: { status: 'ended' } })
  await emitEvent({ name: 'lease.moved_out', entityType: 'Lease', entityId: lease.id, facilityId }, tx)
})
```

An event never describes a rolled-back change, and a committed change never loses
its event. Names come from the catalog in
[events/catalog.ts](packages/core/events/catalog.ts); an unknown name throws at the
emit site rather than silently never firing a consumer.

**Delivery is at-least-once.** A handler that succeeds and then crashes before its
row is marked will run again — consumers must be idempotent. Exclusivity comes from
the unique index on `(eventId, consumer)`, so no advisory locks are involved.
Failures retry with exponential backoff (1m/5m/25m/60m) and dead-letter after 5
attempts rather than looping forever; `deadLetters()` surfaces them until B-054
turns them into staff tasks.

**Jobs are idempotent by constraint**, not by check-then-act: `JobRun` is unique on
`(jobName, facilityId, businessDate)`, so two workers racing the same nightly run
means one loses the insert and skips. A failed *item* leaves the run `partial` —
one bad lease can't stop the other 799. `force: true` re-runs a date for admin
re-runnability, reusing the same row.

`CONSUMERS` and `SCHEDULED_JOBS` in
[lib/jobs/registry.ts](apps/web/lib/jobs/registry.ts) are intentionally empty —
this item is the machinery. Reservation expiry (B-018), Stripe reconciliation
(B-019), gate commands (B-027), comms (B-030), and the billing scheduler (B-043)
register themselves as they're built.

## Conventions

- Money is integer cents. Never a float.
- Timestamps are UTC in the database, displayed in facility-local time.
- Every table representing physical or financial reality carries `facilityId`,
  directly or through its parent (master PRD §7.6).
- WCAG 2.1 AA is an acceptance criterion on customer-facing work, not a cleanup
  task. CI runs axe and asserts a perfect Lighthouse accessibility score.
- Compliance defaults are Texas, built per-state configurable (D-10). All legal and
  notice text is draft-only and not legal advice.
- Custom error classes use explicit field declarations, not TypeScript's
  constructor-parameter-property shorthand (`constructor(readonly x: T)`). Node's
  type-stripping — which runs `apps/web/scripts/*.mts` and `packages/db/prisma/seed.mts`
  directly, no build step — erases type annotations but can't transform that
  shorthand, and errors on it. `apps/web/scripts/*` also import via `tsx` (a
  devDependency) rather than plain `node`, since they need the `@/*` path alias;
  packages under `packages/*` don't use that alias and run under plain `node`.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, typecheck, unit
tests, build, Playwright + axe, and Lighthouse (LCP < 2.5 s, CLS < 0.1, per master
PRD §7.3). `npm audit` runs as a report only — the current advisories come from
version pins inside `next` and `eslint` that cannot be overridden without putting
the dependency tree in an invalid state.
