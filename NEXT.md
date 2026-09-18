# Next

**B-327 is done** (`97e1d57`, with the SHA follow-up in the next commit; both pushed). Voiding a rent invoice now releases its period. The void also unwinds the promotion period and referral rewards the invoice consumed, so the nightly re-raise carries the same discount lines. Tests are in `tests/void-rebill-db.test.ts`.

## Start here

**B-328**, next in file order and raised by B-327: **the nightly run never bills a lease past its twelfth period** (`generateInvoices` uses `periodStartsBetween`'s default `maxPeriods = 12`, counted from the lease start). Read the row in full. It is a money path, and it asks for a **production count first**: how many live leases are older than twelve periods. That needs `.env.prod-ops`, which is still empty, so the count is an owner action. The code fix and its tests do not depend on it.

**Pre-existing e2e failure, not yet owned:** `e2e/i18n.spec.ts` › `/confirm-email renders in Spanish`. See B-321's `PROGRESS.md` entry. Owner call: fix the title or fix the spec.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** countertop's unscoped `pkill -9 -f 'node \(vitest'`. A 137 with zero failures is that, not your branch. Gate a re-run on `pgrep -f 'node \(vitest'` reaching zero.
- **`npm run db:migrate:test` after any migration or template edit**, and **`npm test -- <paths>`, never bare `npx vitest run`** (it skips every `describeDb` suite silently).
- **`db:migrate:e2e` reseeds the demo and stales `.next/cache/fetch-cache`.** `rm -rf apps/web/.next/cache/fetch-cache` after any reseed.

## Owner actions

- **The Neon dev branch is now four migrations behind** (B-327 added one). The script is `npm run db:migrate:cloud`, and `npm run db:status` confirms it.
- `.env.prod-ops` is still empty. It blocks B-277's backfill, B-301's dry run, the signed-lease scoping query, and now B-328's production count. Full list: the `B-316` section of `docs/PROGRESS.md` and `git show 9b0cf73:NEXT.md`.

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140), the signed-lease disclosure, the business-account members (B-300 ✅, B-301 open).

## Do not re-raise

Read the numbering note at the top of `06-backlog.md`. For carried gaps, see `git show 9b0cf73:NEXT.md` plus the B-317, B-318 and B-327 `PROGRESS.md` entries. B-327 adds two: there is no "void without re-billing" option, and a redemption that followed a transfer is not released when an invoice on the old lease is voided.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
