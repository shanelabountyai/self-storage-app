# Self-Storage Business Application

Multi-facility self-storage platform. Learning project, built to professional standards.

## How to work in this repo

- Product source of truth: `docs/prds/`. Build order: `docs/prds/06-backlog.md`, top to bottom, one item (or noted small cluster) per session.
- `docs/prds/07-decisions.md` OVERRIDES any conflicting PRD text. Never re-open a settled decision; append new decisions there instead.
- Stack: Next.js (App Router) + TypeScript, Postgres + Prisma, Stripe (ledger-driven PaymentIntents — NOT Stripe Billing, per D-6), Tailwind CSS, deployed on Vercel.
- Data model: use the canonical entity names in `docs/prds/00-master-prd.md` §7 (Facility, Unit, UnitType, Tenant, Lease, Invoice, Payment, AccessCredential, Lead, and supporting entities).
- Money is integer cents. All timestamps UTC in the DB, facility-local timezone for display.
- Compliance defaults are Texas, built per-state configurable (D-10). All legal/notice text is draft-only and not legal advice.
- Gate hardware runs against the simulated adapter (PRD 03) — never assume a real vendor API.
- Accessibility: WCAG 2.1 AA is an acceptance criterion on customer-facing work, not a later cleanup.
- After completing a backlog item, in this order: run tests → mark the item ✅ in `docs/prds/06-backlog.md` → add its entry to `docs/PROGRESS.md` → commit → **push**. The SHA follow-up commit gets pushed too. Committing without pushing leaves the work on one laptop; this repo sat 123 commits ahead of an empty remote for a week before anyone noticed.
- `docs/PROGRESS.md` is the running narrative of what has been built. One entry per completed item, with its commit SHA and three things: **what it built**, **what it decided** (choices a later session must not silently reverse), and **what it left behind** (deliberate gaps and which item owns them). Note any real bug found along the way. Keep it factual — it is a record, not a changelog of intentions.
- Record the SHA in a small follow-up commit, not by amending. Amending changes the SHA you just wrote down, leaving `PROGRESS.md` pointing at a commit that no longer exists.
- Also update the same-day PRD when an item settles something the PRD left open, and append owner decisions to `07-decisions.md` with a new D-number rather than resolving them silently.
- Commit after every completed item with a message like `B-012: unit CRUD`, then push.

## Four rules this codebase learned the hard way

- **A new column that configures behaviour gets its control in the same item.** Each one is individually defensible to defer, and they accumulate: `billingPolicy`, `invoiceLeadDays`, `prorateOnMoveIn`, `paymentRetryDays` and the late-fee ladder all shipped reachable only from a database client, and took two separate clean-up passes to close. If an operator would ever need to change it, it needs a form field before the item is done.
- **Restart `npm run dev` after a schema change.** A running dev server holds the Prisma client it started with, so `db:generate` alone leaves it serving `Unknown field ... for select statement` while the unit tests pass — they reload the client each run. Costs twenty minutes if you go looking for the bug in your own code.
- **The test suite has its own Postgres schema; run `npm run db:migrate:test` after every migration.** `vitest.config.ts` points `DATABASE_URL` at `storage_test`, so dev keeps `public` and a test run can no longer leave a live owner account (or 3,901 facilities) in the database you are developing against. Two things make it work and both were measured: the URL carries **`schema=`** to scope the ORM *and* **`options=-c search_path=`** to scope RAW SQL, because Prisma does not set `search_path` from `schema=` — with only the first, `claimUnit`'s `FOR UPDATE SKIP LOCKED` and the gapless numbering silently read `public` while fixtures went to `storage_test`. It is built from **`DIRECT_URL`**, not the pooled one, because Neon's pooler rejects `search_path` as a startup parameter. A new migration is not applied to the test schema automatically — the suite will fail with a missing column until you run `db:migrate:test`. **The redirect is skipped when `CI` is set**, because CI's whole database is a throwaway container that migrates into `public`; pointing it at `storage_test` broke a build with "table does not exist".

- **Appending hand-written SQL to an already-applied migration desyncs its checksum.** Prisma stores a sha256 of each migration file in `_prisma_migrations`; edit the file after it has run and the next `migrate dev` announces *"the migration was modified after it was applied"* and offers to **reset the development database**. Do not accept. The fix is to recompute the hash and `UPDATE _prisma_migrations SET checksum = ...` for that row — the schema is already correct, only the bookkeeping is stale. Better still, put the raw SQL in the migration **before** applying it: `migrate dev --create-only`, append, then `migrate dev`. `prisma migrate status` does NOT catch this, so it stays invisible until the next migration a week later (it cost B-079 its first ten minutes).

- **Run the schema-drift check before pushing, not just the tests.** `prisma migrate diff --from-schema-datasource --to-schema-datamodel --exit-code` is what CI fails on, and `npm test` cannot see it: a migration that creates an index the model does not declare passes every local test and fails every push. That exact mistake cost six red CI runs.

- **Test isolation is not free on a shared database.** `audit_log` is append-only and never cleaned between tests, so an assertion like `findFirst({ where: { action, entityId: leaseId } })` can return a row an earlier test in the same file wrote — scope it to the specific entity (the audit context carries the ids) or order newest-first. The same applies to fixture names: twenty suites create a tenant called "Ada Renter", and `searchTenants` caps at 25 results. A suite that passes once has not been shown to be repeatable; if a test touches shared state, run the suite twice before calling it green.
