# Next

**B-301 is done** (`11c55a7`). Production's dry run found 0 memberships, so nothing needed sending. **Production was 52 migrations behind and is now migrated** (D-143; backup branch `pre-migrate-2026-09-19`).

## Start here

1. **Smoke-test production on its public domain.** The `AUTH_URL` host returns 401 because of Vercel deployment protection. Check that `/storage/search?q=78704` returns 200.
2. **The B-328 missed-period count for the owner.** Production is migrated and `.env.prod-ops` works.
3. **Decide whether production migrations should run on deploy.** D-143 is manual, and `db:status` does not look at production.

## Owner actions

- **B-328's missed periods:** whether to raise them, with notice to tenants. This needs the count.
- Once production has been verified, delete the Neon backup branch `pre-migrate-2026-09-19`.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** A 137 with zero failures is countertop's unscoped pkill, not your branch.
- **A 137 orphans fixtures**, and the next run fails on stale test-email rows, even on `main`.
- **`npm run db:migrate:test` after any migration or template edit.** Use `npm test -- <paths>`, never bare `npx vitest run`.
- **`db:migrate:e2e` reseeds**, so run `rm -rf apps/web/.next/cache/fetch-cache` afterwards.

## Do not re-raise

See the numbering note at the top of `06-backlog.md`, `git show 9b0cf73:NEXT.md`, and the B-317, B-318 and B-327 `PROGRESS.md` entries.

## The blocked list

B-254 (D-115); B-129, B-243, B-085 and B-133 (credentials or partner agreements); B-134 (trigger not fired).
