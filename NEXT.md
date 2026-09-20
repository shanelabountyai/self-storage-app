# Next

**Review block 9 is written** (2026-09-19, `072becd` + `ab39408`): B-329–B-346 at `83azza`–`83azzr`, from the operator, UX and accessibility reviews over B-301–B-328. 31 refusals are recorded in the numbering note.

## Start here

1. **B-338 (`83azzj`)**: a voided rent period is re-billed at the same rate, due on a date already past, and the tenant is told nothing.
2. Then work down the block. B-346 is last: **D-145** was settled (A), so write-off, void and adjustment all get a confirm step.

**B-329 is built** (2026-09-20, `5a6c9b3`), minus its production count — see Owner actions.

## Owner actions

- **Delete the Neon backup branch `pre-migrate-2026-09-19`.** Production has been verified.
- **Run B-329's production count.** Read-only; the sandbox refused it as a production read, so it needs a hand. The query is in the B-329 `PROGRESS.md` entry: every rent invoice with `status = 'void'` and any `PaymentAllocation`, and whether a live rent invoice now exists for the same `(leaseId, periodStart)`. Zero is expected (production holds seeded demo data only). A non-zero row is an owner remedy — a credit and a word to that tenant — not a build one.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** A 137 with zero failures is countertop's unscoped pkill, not your branch.
- **A 137 orphans fixtures**, and the next run fails on stale test-email rows, even on `main`.
- **`npm run db:migrate:test` after any migration or template edit.** Use `npm test -- <paths>`, never bare `npx vitest run`.
- **`db:migrate:e2e` reseeds**, so run `rm -rf apps/web/.next/cache/fetch-cache` afterwards.

## Do not re-raise

See the numbering note at the top of `06-backlog.md`, `git show 9b0cf73:NEXT.md`, and the B-317, B-318 and B-327 `PROGRESS.md` entries.

## The blocked list

B-254 (D-115); B-129, B-243, B-085 and B-133 (credentials or partner agreements); B-134 (trigger not fired).
