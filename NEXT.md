# Next

**Review block 9 is written** (2026-09-19, `072becd` + `ab39408`): B-329–B-346 at `83azza`–`83azzr`, from the operator, UX and accessibility reviews over B-301–B-328. 31 refusals are recorded in the numbering note.

## Start here

1. **B-338 (`83azzj`)**: a voided rent period is re-billed at the same rate, due on a date already past, and the tenant is told nothing. Its dependency **B-333 is now built**, so it is unblocked. It touches `ledger-corrections.tsx` again — the pre-submit re-bill warning goes into the same component B-333 just wrapped in an `AnnounceRegion`; put the warning INSIDE the void form (it is pre-submit), not in that region (which is post-submit).
2. Then work down the block from B-330. B-346 is last: **D-145** was settled (A), so write-off, void and adjustment all get a confirm step.

**B-329 is built** (2026-09-20, `5a6c9b3`), minus its production count — see Owner actions.
**B-333 is built** (2026-09-20, `af32799`). Taken ahead of B-338 because it was B-338's own stated dependency.

## Owner actions

- **Delete the Neon backup branch `pre-migrate-2026-09-19`.** Production has been verified.
- **Run B-329's production count.** Read-only; the sandbox refused it as a production read, so it needs a hand. The query is in the B-329 `PROGRESS.md` entry: every rent invoice with `status = 'void'` and any `PaymentAllocation`, and whether a live rent invoice now exists for the same `(leaseId, periodStart)`. Zero is expected (production holds seeded demo data only). A non-zero row is an owner remedy — a credit and a word to that tenant — not a build one.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** A 137 with zero failures is countertop's unscoped pkill, not your branch.
- **A 137 orphans fixtures**, and the next run fails on stale test-email rows, even on `main`.
- **`npm run db:migrate:test` after any migration or template edit.** Use `npm test -- <paths>`, never bare `npx vitest run`.
- **`db:migrate:e2e` reseeds**, so run `rm -rf apps/web/.next/cache/fetch-cache` afterwards.
- **B-333 left a permanent fixture in `storage_test`'s `public` schema** — facility `e2e-b333-ledger-corrections`, three leases, one of them deliberately not reconciling. It cannot be deleted (B-185: `audit_log` RESTRICTs against `facility`), its spec rebuilds it in `beforeAll`, and `db:reset-test` clears it with everything else. It means `/admin/reports/ledger-exceptions` now renders a TABLE locally rather than its empty state; both branches were scanned with axe and are clean.

## Do not re-raise

See the numbering note at the top of `06-backlog.md`, `git show 9b0cf73:NEXT.md`, and the B-317, B-318 and B-327 `PROGRESS.md` entries.

## The blocked list

B-254 (D-115); B-129, B-243, B-085 and B-133 (credentials or partner agreements); B-134 (trigger not fired).
