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

## Three rules this codebase learned the hard way

- **A new column that configures behaviour gets its control in the same item.** Each one is individually defensible to defer, and they accumulate: `billingPolicy`, `invoiceLeadDays`, `prorateOnMoveIn`, `paymentRetryDays` and the late-fee ladder all shipped reachable only from a database client, and took two separate clean-up passes to close. If an operator would ever need to change it, it needs a form field before the item is done.
- **Restart `npm run dev` after a schema change.** A running dev server holds the Prisma client it started with, so `db:generate` alone leaves it serving `Unknown field ... for select statement` while the unit tests pass — they reload the client each run. Costs twenty minutes if you go looking for the bug in your own code.
- **Test isolation is not free on a shared database.** `audit_log` is append-only and never cleaned between tests, so an assertion like `findFirst({ where: { action, entityId: leaseId } })` can return a row an earlier test in the same file wrote — scope it to the specific entity (the audit context carries the ids) or order newest-first. The same applies to fixture names: twenty suites create a tenant called "Ada Renter", and `searchTenants` caps at 25 results. A suite that passes once has not been shown to be repeatable; if a test touches shared state, run the suite twice before calling it green.
