# Next

**B-319 is done** (`8e38408`, SHA follow-up next commit, both pushed). The counter's Method is controlled state now — the `key` that remounted it at Cash is gone, and a picker change only resets Card (to Cash, with the reason in a `role="status"` line) when the new subject cannot take one. `settleTender` refuses `cash` with a check number as `check_number_on_cash`, so the POS payment, the counter move-in and merchandise all get it. Unit suite: 4,592 passed, 8 skipped, of 4,600; `e2e/admin-pos.spec.ts` 30/30.

## Start here

**B-320**, next in file order: a card taken at the counter has no printable receipt (`counterReceipt` refuses anything but cash), and a business account cannot pay by card at all. Read the row in full first.

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
