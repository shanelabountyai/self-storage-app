# Next

**B-307 is done** (`4d35dce`, SHA recorded in the follow-up commit). The eighth review block (`5933447`) has 20 rows left, **B-308–B-326** plus **B-327**, and **B-325 at `83aya`** (deliberately ahead of B-301 so mail's wording settles before the backfill sends).

A per-facility job at 8am local now recomputes each facility's filed months against their **stored** windows and raises **one** high-priority `closed_period_drifted` card naming the months and the largest difference. Its idempotency key is a **fingerprint of the drift**, not the business date — so a month somebody has read and left as filed never comes back, and one that drifts further raises a new card. Snapshots carry a **computation version**, and the close screen no longer offers the three data causes for a difference no data explains. **No migration.** Nothing re-files or restates a closed period; that stays an owner action below.

## Start here

**B-308**, in file order.

- **B-308** — the counter's shared-address question and its only button say opposite things (digital-experience review 2026-09-14, finding 2; verified in code; cheap and high). B-289 is the row it came out of.

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
| **After B-297/B-298 deploy: decide whether to re-close or restate the filed periods.** Every filed month's billed/collected figures were computed with the old boundary. **B-307 has shipped, so the 8am job will now raise one card per facility naming the months and the largest delta** — the count you would otherwise have queried for arrives on its own, and the card's sentence says the calculation moved rather than the data. Reading it and deciding to leave the months as filed is a real answer: close the card with a note and it does not come back. | Filed accounting periods, and a judgement about telling a CPA |
| **Run `docs/ops/b298-signed-lease-move-in-date.sql` against production, then decide the disclosure.** **Read its second result set first:** a zero count beside a large `unresolved` means the join failed, not that nobody was affected. **The defect is still live** — B-298 has not deployed — so run it again after the deploy. | Production data, and a judgement about telling people |
| **B-301: tell existing business-account members they have access.** Wording fixed (B-300); **B-325 sharpens it further and sits ahead of B-301 for that reason** — worth taking before the send. Needs the dry-run count. | Contacting customers, and production access |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** | Production data, and a judgement about telling people |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** First data backfill to reach production from a migration file. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions`.** It is now **two numbers**, `{ total, unacknowledged }` — they differ by the leases somebody has marked reviewed, and a rising `total` against a flat `unacknowledged` is worth noticing. **B-303 means there is now something a person can do about a `ledger_does_not_reconcile` task**, and B-304 means one they cannot fix stops re-raising once they say so. | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused.** **B-306 has shipped, so every refusal from here on is recorded and raises a card** — but it is not retroactive, and nothing records the attempts made before it. The ones from before B-292 still have to come from a person's memory. | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **A portfolio-level business account needs an owner decision and a D-number before anyone builds toward it.** Recorded as a stated limit in PRD 01 §9, not as a row: a contractor with units at three sites is three accounts, three statements, three counter payments. | New scope, and a schema change with a large blast radius |
| **B-254 needs a person, not a session:** nobody has run VoiceOver or NVDA against this product, and `LAST_REVIEWED` cannot move until somebody does (D-115). B-285's, B-286's and B-299's announcement questions all wait on that same pass. | Only a human can perform it |

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (fix wording then backfill — B-300 ✅, B-301 open).

## Do not re-raise

The block recorded **twelve refusals** and **two stated limits** in the numbering note at the top of `06-backlog.md`, so the ninth review pass does not re-find them — among them that the westernmost-zone reckoning in `reportRange` is **correct as built** (D-138 weighed the union-of-zones alternative and it double-counts), that `bodega` vs `unidad` and B-286's toggle markup are both settled, and that a `<p tabindex="-1">` with no focus ring is not a 2.4.7 failure. Read that note before starting the next review.

Carried gaps with no owning row, unchanged: B-300's `authExpiry` "minutes" for 1; B-299's transfer-preview move-in ceiling and its untested preview refusals; B-298's `Lease.endDate` and the rest of the demo seed's date columns; B-290's missing funnel measurement; B-284's, B-281's and B-280's carried gaps. **B-305 adds two**, both in its `PROGRESS.md` entry and neither with a row: no e2e covers the directed allocation (the demo seed has no account payer holding a unit of their own), and a plain tenant with two personal units who hands over one sum for both now gets the surplus as visible credit on the unit the staffer picked rather than a silent spread — the deliberate trade, and the answer if operators object is a multi-unit subject in the picker, not a return to the spread. **B-307 adds four**, all in its `PROGRESS.md` entry and none with a row: the recompute window is a fixed 12 months (`ponytail:`), so a month filed more than a year ago is never checked; nothing cancels the card when the drift clears, so a correctly re-closed month leaves its old card for somebody to close by hand; no e2e covers the card or the job, because the demo seed files no accounting period; and the sweep does not roll up — eight sites means eight cards and no portfolio view, the same gap B-303 recorded for ledger exceptions. **B-306 adds four**, all in its `PROGRESS.md` entry and none with a row: nothing surfaces a refused notice on the tenant's own Notices screen; "or the case is closed" is not a second closing path, so a cured tenant's card has to be cancelled by hand; no e2e covers the new card or the case screen's new section; and `claim_does_not_sum` is unreachable from real ledger rows, so `refusalFigures` is exported solely for its own test. **B-303 adds three**, all in its `PROGRESS.md` entry and none with a row: `/admin/reports/ledger-exceptions` has no e2e coverage (B-277's gap, not B-303's), no screen lists what has been acknowledged portfolio-wide, and an acknowledgement is never expired.

**One thing B-302 left for B-314**, unchanged: `/pay/[token]` keeps its `role="alert"`, has no skip link, and is outside B-295's `app/portal/**` lint rule.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
