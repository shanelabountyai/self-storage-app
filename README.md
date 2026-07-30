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

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, typecheck, unit
tests, build, Playwright + axe, and Lighthouse (LCP < 2.5 s, CLS < 0.1, per master
PRD §7.3). `npm audit` runs as a report only — the current advisories come from
version pins inside `next` and `eslint` that cannot be overridden without putting
the dependency tree in an invalid state.
