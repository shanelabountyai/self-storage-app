# Next

**B-328 is done** (`e787410`, with the SHA follow-up in the next commit; both pushed). The nightly invoice run now bills the period that contains `through` for a lease of any age, and it back-bills nothing (**D-142**, owner's call). Outage catch-up relies on the scheduler replaying each missed business date. Tests are in `tests/invoices-db.test.ts`.

## Start here

**B-325**, the first open row in file order that is not owner-blocked: `authAccountAccess` is one 62-word sentence doing three jobs. It is low severity and a copy-only change. Read the row in full first; it caps how strongly the fix may be worded.

**Pre-existing e2e failure, not yet owned:** `e2e/i18n.spec.ts` › `/confirm-email renders in Spanish`. See B-321's `PROGRESS.md` entry. Owner call: fix the title or fix the spec.

## Owner actions

- **B-328's missed periods:** any production lease older than twelve periods has unbilled periods that D-142 deliberately does not back-bill. Whether to raise them, with notice to tenants, is your decision. It needs the production count, which needs `.env.prod-ops`.
- **The Neon dev branch is four migrations behind.** Run `npm run db:migrate:cloud`, then confirm with `npm run db:status`.
- `.env.prod-ops` is still empty. It blocks B-277's backfill, B-301's dry run, the signed-lease scoping query, and the B-328 count. Full list: the `B-316` section of `docs/PROGRESS.md`.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** countertop's unscoped `pkill -9 -f 'node \(vitest'`. A 137 with zero failures is that, not your branch. Gate a re-run on `pgrep -f 'node \(vitest'` reaching zero.
- **`npm run db:migrate:test` after any migration or template edit**, and **`npm test -- <paths>`, never bare `npx vitest run`** (it skips every `describeDb` suite silently).
- **`db:migrate:e2e` reseeds the demo and stales `.next/cache/fetch-cache`.** `rm -rf apps/web/.next/cache/fetch-cache` after any reseed.


**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140), the signed-lease disclosure, the business-account members (B-300 ✅, B-301 open).

## Do not re-raise

Read the numbering note at the top of `06-backlog.md`. For carried gaps, see `git show 9b0cf73:NEXT.md` plus the B-317, B-318 and B-327 `PROGRESS.md` entries. B-327 adds two: there is no "void without re-billing" option, and a redemption that followed a transfer is not released when an invoice on the old lease is voided.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
