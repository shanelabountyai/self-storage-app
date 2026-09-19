# Next

**Production is verified and caught up** (2026-09-19). Dynamic routes and the database work on `storage.labintelligence.co`. Every page returns 401 because of the app's demo gate (`DEMO_ACCESS_PASSWORD`), not Vercel protection. B-328's missed-period count is **zero**, so that owner question is closed. **D-144:** production migrations stay manual under D-143, and `npm run db:status` now reports production as well.

## Start here

1. **The next ⬜ row in `docs/prds/06-backlog.md`**, working top to bottom and skipping the blocked list.

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
