# Next

**B-321 is done** (`f9d7859`, SHA follow-up next commit, both pushed). `/checkout/resume`, `/waitlist/cancel` and `/unsubscribe` now take their language from the record the token names (`messageLinkLocale`, `lib/i18n/link-locale.ts`), sent to the root layout in a proxy header. The proxy matcher now includes the two dotted-token routes it used to skip. Unsubscribe tokens sign the email's locale. Unit suite: 4,602 passed, 8 skipped, of 4,610. `e2e/message-link-locale.spec.ts` passed 8 of 8.

## Start here

**B-322**, next in file order: a business-account payer is refused a prepayment with no reason and no way out (copy only). Read the row in full first.

**Pre-existing e2e failure, not yet owned:** `e2e/i18n.spec.ts` › `/confirm-email renders in Spanish` fails on both projects. The `<title>` is always `confemail.title`, but the spec expects the error heading. The details are in B-321's `PROGRESS.md` entry. Owner call: fix the title or fix the spec.

**B-327 is still open and still worth reading before touching the rent-invoice index**: a voided rent invoice's period can never be billed again, and the bare index change that would release it drops promised discounts.

Nothing in the block is blocked on the tree. B-301 still is.

- **`storage_test` was reset on 2026-09-18** (it had 5,468 facilities and `marketplace-db.test.ts` was timing out on its full scan). If that file times out again, `npm run db:reset-test` before reading a stack trace.

## Two things worth knowing before the next sweep

- **Another project kills this repo's vitest.** The `Restaurant ordering` session's pre-sweep cleanup runs `pkill -9 -f 'node \(vitest'` **unscoped** — its playwright line is correctly `$PWD`-scoped, its vitest line is not. It SIGKILLed a full sweep here on 2026-09-17: `EXIT=137`, 405 lines of ✓, **zero failures**, no `JetsamEvent-*.ips` for that minute and 61% memory available. A dead runner on a healthy machine is not your branch. Gate the re-run on `pgrep -f 'node \(vitest'` reaching zero. The real fix is one word of scoping in the countertop repo.
- **`npm run db:migrate:test` after any template edit (B-206)**, and **a bare `npx vitest run` skips every `describeDb` suite silently** — use `npm test -- <paths>`.
- **`db:migrate:e2e` reseeds the demo, and that stales `.next/cache/fetch-cache`.** `rm -rf apps/web/.next/cache/fetch-cache` after any reseed, before believing an e2e failure.

## Owner actions

Unchanged from the B-317 handoff — the Neon dev branch is still three migrations behind (`npm run db:status` exits non-zero; `npm run db:migrate:cloud` is the script), `.env.prod-ops` is still empty and still blocks B-277's backfill, B-301's dry run and the signed-lease scoping query. See the `B-316` section of `docs/PROGRESS.md` and `git show 9b0cf73:NEXT.md` for the full list — nothing in it was answered or actioned by B-317 or B-318.

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (B-300 ✅, B-301 open).

## Do not re-raise

Read the numbering note at the top of `06-backlog.md` first — twelve refusals and two stated limits. The carried-gap list is unchanged from the B-316 handoff (`git show 9b0cf73:NEXT.md`), plus:

- **B-317**: no e2e covers the credit sentence, because no demo tenant has overpaid. No row.
- **B-318** adds three, all in its `PROGRESS.md` entry and none with a row: no axe scan of the print route (it needs a real `Message` row and the demo seed writes none — it is in `SCAN_EXCEPTIONS` as `audience: 'admin'`, same posture as the four other per-entity admin routes); a `no_reachable_channel` task whose tenant's only message failed to RENDER cannot be closed at all (nothing to mail, and a note no longer closes the type); and cancelling the browser's print dialog still records the letter.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
