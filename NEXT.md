# Next

**B-305 is done** (`d51e772`, SHA recorded in the follow-up commit). The eighth review block (`5933447`) has 22 rows left, **B-306–B-326** plus **B-327**, and **B-325 at `83aya`** (deliberately ahead of B-301 so mail's wording settles before the backfill sends).

A payment the counter directs at one unit now settles that unit — `restrictToInvoiceIds`, chosen over the before-submit statement, with the statement written anyway as a description of what the code does. A unit that owes nothing keeps the cash as credit on itself rather than handing it to the employer's arrears. **The two remedies the row offered are now closed; do not re-open the choice** — the reasoning is in the `PROGRESS.md` entry.

## Start here

**B-306**, then in file order **B-307**.

- **B-306** — a refused lien notice leaves no record and no worklist. It is the visible half of B-304: an acknowledged exception still refuses a notice, deliberately, and nothing anywhere records that it did. B-304's entry says that refusal is the thing an acknowledgement most plausibly looks like it should suppress and must not.
- **B-307** — the block's own doing. B-297/B-298 changed `facilityRevenue`, `reportRangeForMonth`, `movesForFacility` and `attachRateForFacility`, so every already-filed month now disagrees with what the same query returns. `periodDrift` detects it and is pull-only. The row builds the alarm and a computation-version stamp; **the restatement decision is the owner's** and is in the table below.

**B-327 is still open and still worth reading before touching the rent-invoice index**: a voided rent invoice's period can never be billed again, and the four-line index change that would release it is a money defect in disguise — the promotion and referral marks are consumed per period, so a bare re-raise drops a discount the tenant was promised.

Nothing in the block is blocked on the tree. B-301 still is.

## Two things worth knowing before the next sweep

- **The unit suite's connection cap was never applied** (`aa179bc`). `scripts/test-db.mts` built the URL from `DIRECT_URL`, which carries no query parameters, so `.env.test`'s `connection_limit=10` was dropped and every worker took Prisma's default of 21. It surfaced as a `marketplace` spec timing out on the pool, which reads as flakiness. Fixed and pinned by `tests/test-db-url.test.ts`. If a sweep ever looks slow again, check `pg_stat_activity` before reading a stack trace.
- **`db:migrate:e2e` reseeds the demo, and that stales `.next/cache/fetch-cache`.** `a11y-own-spec-routes.spec.ts`'s reserve test failed on mobile-chrome for exactly this — cached unit ids that no longer exist — and passed cleanly after `rm -rf apps/web/.next/cache/fetch-cache`. Do that after any reseed, before believing an e2e failure.

## Owner actions

**The Neon dev branch is two migrations behind.** `npm run db:status` exits non-zero: local is current, but `20260915120000_b303_ledger_correction` and `20260915130000_b304_ledger_exception_ack` have never been applied to the cloud dev branch. `npm run db:migrate:cloud` is the script for it (`migrate deploy`, which cannot drop anything) — left unrun deliberately, because it touches shared infrastructure and was not this item's work.

**One empty file still blocks three of these.** `.env.prod-ops`'s `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty; B-277's backfill, B-301's dry run and the signed-lease scoping query all need them. Filling it once unblocks all three.

| What | Why it is yours |
|---|---|
| **After B-297/B-298 deploy: decide whether to re-close or restate the filed periods.** Every filed month's billed/collected figures were computed with the old boundary. Get the count and the largest delta from a query first — the discipline B-300 used for the signed-lease disclosure. B-307 builds the alarm; it does not decide the restatement. | Filed accounting periods, and a judgement about telling a CPA |
| **Run `docs/ops/b298-signed-lease-move-in-date.sql` against production, then decide the disclosure.** **Read its second result set first:** a zero count beside a large `unresolved` means the join failed, not that nobody was affected. **The defect is still live** — B-298 has not deployed — so run it again after the deploy. | Production data, and a judgement about telling people |
| **B-301: tell existing business-account members they have access.** Wording fixed (B-300); **B-325 sharpens it further and sits ahead of B-301 for that reason** — worth taking before the send. Needs the dry-run count. | Contacting customers, and production access |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** | Production data, and a judgement about telling people |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** First data backfill to reach production from a migration file. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions`.** It is now **two numbers**, `{ total, unacknowledged }` — they differ by the leases somebody has marked reviewed, and a rising `total` against a flat `unacknowledged` is worth noticing. **B-303 means there is now something a person can do about a `ledger_does_not_reconcile` task**, and B-304 means one they cannot fix stops re-raising once they say so. | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** — and note that **B-306** exists because nothing recorded those attempts, so there is no list to retry from. | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **A portfolio-level business account needs an owner decision and a D-number before anyone builds toward it.** Recorded as a stated limit in PRD 01 §9, not as a row: a contractor with units at three sites is three accounts, three statements, three counter payments. | New scope, and a schema change with a large blast radius |
| **B-254 needs a person, not a session:** nobody has run VoiceOver or NVDA against this product, and `LAST_REVIEWED` cannot move until somebody does (D-115). B-285's, B-286's and B-299's announcement questions all wait on that same pass. | Only a human can perform it |

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (fix wording then backfill — B-300 ✅, B-301 open).

## Do not re-raise

The block recorded **twelve refusals** and **two stated limits** in the numbering note at the top of `06-backlog.md`, so the ninth review pass does not re-find them — among them that the westernmost-zone reckoning in `reportRange` is **correct as built** (D-138 weighed the union-of-zones alternative and it double-counts), that `bodega` vs `unidad` and B-286's toggle markup are both settled, and that a `<p tabindex="-1">` with no focus ring is not a 2.4.7 failure. Read that note before starting the next review.

Carried gaps with no owning row, unchanged: B-300's `authExpiry` "minutes" for 1; B-299's transfer-preview move-in ceiling and its untested preview refusals; B-298's `Lease.endDate` and the rest of the demo seed's date columns; B-290's missing funnel measurement; B-284's, B-281's and B-280's carried gaps. **B-305 adds two**, both in its `PROGRESS.md` entry and neither with a row: no e2e covers the directed allocation (the demo seed has no account payer holding a unit of their own), and a plain tenant with two personal units who hands over one sum for both now gets the surplus as visible credit on the unit the staffer picked rather than a silent spread — the deliberate trade, and the answer if operators object is a multi-unit subject in the picker, not a return to the spread. **B-303 adds three**, all in its `PROGRESS.md` entry and none with a row: `/admin/reports/ledger-exceptions` has no e2e coverage (B-277's gap, not B-303's), no screen lists what has been acknowledged portfolio-wide, and an acknowledgement is never expired.

**One thing B-302 left for B-314**, unchanged: `/pay/[token]` keeps its `role="alert"`, has no skip link, and is outside B-295's `app/portal/**` lint rule.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
