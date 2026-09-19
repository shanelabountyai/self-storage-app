# Next

**Review block 9 is written** (2026-09-19, `072becd` + `ab39408`): B-329–B-346 at `83azza`–`83azzr`, from the operator, UX and accessibility reviews over B-301–B-328. 31 refusals are recorded in the numbering note.

## Start here

1. **B-329 (`83azza`)**: voiding a partly paid rent invoice double-bills the part already paid. This is a live money defect. **Before building, count in production** every voided rent invoice with money allocated to it since B-327 reached production (2026-09-19), and whether its period was billed again.
2. Then work down the block. B-346 is last: **D-145** was settled (A), so write-off, void and adjustment all get a confirm step.

## Owner actions

- **Delete the Neon backup branch `pre-migrate-2026-09-19`.** Production has been verified.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** A 137 with zero failures is countertop's unscoped pkill, not your branch.
- **A 137 orphans fixtures**, and the next run fails on stale test-email rows, even on `main`.
- **`npm run db:migrate:test` after any migration or template edit.** Use `npm test -- <paths>`, never bare `npx vitest run`.
- **`db:migrate:e2e` reseeds**, so run `rm -rf apps/web/.next/cache/fetch-cache` afterwards.

## Do not re-raise

See the numbering note at the top of `06-backlog.md`, `git show 9b0cf73:NEXT.md`, and the B-317, B-318 and B-327 `PROGRESS.md` entries.

## The blocked list

B-254 (D-115); B-129, B-243, B-085 and B-133 (credentials or partner agreements); B-134 (trigger not fired).
