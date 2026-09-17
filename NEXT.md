# Next

**B-317 is done** (`503430f`). An overpayment now reads *"Credit on your account: $500.00. It comes off your next bill."* on `/portal/pay/done`, `/pay/[token]/done` and the emailed receipt — `receiptBalanceLine` in `apps/web/lib/comms/prose.ts`, `{{payment.balance_line}}` in the template, `rcpt.creditOnAccount` / `rcpt.creditNextBill` on the two pages. The counter receipt was already right and is unchanged. Unit suite: 4,583 passed, 8 skipped, of 4,591.

## Start here

**B-318**, next in file order: B-281's rendered letter for a tenant with no email has no print path — the `bodySnapshot` renders only inside a collapsed `<details>`. Read the row; the reviewer's argument that B-281's deferral was wrong *is* the row.

**B-327 is still open and still worth reading before touching the rent-invoice index**: a voided rent invoice's period can never be billed again, and the bare index change that would release it drops promised discounts.

Nothing in the block is blocked on the tree. B-301 still is.

## Two things worth knowing before the next sweep

- **`npm run db:migrate:test` after any template edit (B-206)** — the catalog is seeded state, and the suite renders whatever the database holds, not your branch. B-317 needed it.
- **A bare `npx vitest run` skips every `describeDb` suite silently** — 9 files "skipped", exit 0, and it looks like a pass. Use `npm test -- <paths>`, which wraps the run in `dotenv -e .env.test -e .env.local`.
- **`db:migrate:e2e` reseeds the demo, and that stales `.next/cache/fetch-cache`.** `rm -rf apps/web/.next/cache/fetch-cache` after any reseed, before believing an e2e failure.

## Owner actions

Unchanged from the B-316 handoff — the Neon dev branch is still three migrations behind (`npm run db:status` exits non-zero; `npm run db:migrate:cloud` is the script), `.env.prod-ops` is still empty and still blocks B-277's backfill, B-301's dry run and the signed-lease scoping query, and the rest of that table stands as written. See the `B-316` section of `docs/PROGRESS.md` and the previous `NEXT.md` in git history (`git show 9b0cf73:NEXT.md`) for the full list — nothing in it was answered or actioned by B-317.

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (B-300 ✅, B-301 open).

## Do not re-raise

Read the numbering note at the top of `06-backlog.md` first — twelve refusals and two stated limits, so the next review pass does not re-find them. The carried-gap list is unchanged from the B-316 handoff (`git show 9b0cf73:NEXT.md`), plus **B-317 adds one**, in its `PROGRESS.md` entry and with no row: no e2e covers the credit sentence, because no demo tenant has overpaid.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
