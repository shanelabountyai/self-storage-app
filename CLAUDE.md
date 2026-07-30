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
- After completing a backlog item: run tests, then mark the item done in `docs/prds/06-backlog.md`.
- Commit after every completed item with a message like `B-012: unit CRUD`.
