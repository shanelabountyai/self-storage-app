# Next

**The eighth review block is written** (`5933447`) — operator, digital-experience and accessibility, over **B-275–B-300**, the 26 items none of which had ever been reviewed. 32 findings became **25 rows, B-302–B-326**, at `83aza`–`83azx` plus **B-325 at `83aya`**, deliberately ahead of B-301 so that mail's wording settles before the backfill sends.

Docs only. No code, no migration, no tests — CI's `paths-ignore` skips both lanes.

## Start here

**B-302, and take it first for the reason B-186 was taken first.** `a11y.true.errors` is an **unscoped** public claim that a rejected entry's message is tied to its field and that what you typed is still there. Both halves are false on `/portal/pay` and `/pay/[token]` — the two screens where a customer types money. The amount input carries no `aria-invalid` and no `aria-describedby`, and a refused amount is overwritten with the full balance, so a Spanish reader typing `12,50` is refused and has the field rewritten to `1284.00`. That is the overstating direction, and **B-299 re-read this page in this same block without catching it**. Correcting an overstatement does **not** move `LAST_REVIEWED` (PRD 01 §6.8).

Then, in file order: **B-303/B-304** (a ledger exception cannot be repaired inside the product, so the lien gate is permanent and the task re-raises every morning forever), **B-305** (the counter misdirects a business-account payer's money — `claimsFor` spreads it oldest-first across the account, and D-137's guard only fires when the payer is somebody else), **B-306**, **B-307**.

Nothing in the block is blocked on the tree. B-301 still is.

## The one thing the block did to itself

**B-307 is this block's own doing.** B-297 and B-298 changed `facilityRevenue`, `reportRangeForMonth`, `movesForFacility` and `attachRateForFacility`, so **every already-filed month now disagrees with what the same query returns** — for a portfolio billing on the 1st, a whole rent cycle. `periodDrift` already detects it and is pull-only: no cron, no task, no alarm. The row builds the alarm and a computation-version stamp. The restatement decision is the owner's and is in the table below.

## Owner actions

**One empty file still blocks three of these.** `.env.prod-ops`'s `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty; B-277's backfill, B-301's dry run and the signed-lease scoping query all need them. Filling it once unblocks all three.

| What | Why it is yours |
|---|---|
| **After B-297/B-298 deploy: decide whether to re-close or restate the filed periods.** Every filed month's billed/collected figures were computed with the old boundary. Get the count and the largest delta from a query first — the discipline B-300 used for the signed-lease disclosure. B-307 builds the alarm; it does not decide the restatement. | Filed accounting periods, and a judgement about telling a CPA |
| **Run `docs/ops/b298-signed-lease-move-in-date.sql` against production, then decide the disclosure.** **Read its second result set first:** a zero count beside a large `unresolved` means the join failed, not that nobody was affected. **The defect is still live** — B-298 has not deployed — so run it again after the deploy. | Production data, and a judgement about telling people |
| **B-301: tell existing business-account members they have access.** Wording fixed (B-300); **B-325 sharpens it further and sits ahead of B-301 for that reason** — worth taking before the send. Needs the dry-run count. | Contacting customers, and production access |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** | Production data, and a judgement about telling people |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** First data backfill to reach production from a migration file. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks.** Note that until **B-303** ships there is nothing a person can do about one — no adjustment, no write-off on an open lease, no rent-invoice void. | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** — and note that **B-306** exists because nothing recorded those attempts, so there is no list to retry from. | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **A portfolio-level business account needs an owner decision and a D-number before anyone builds toward it.** Recorded as a stated limit in PRD 01 §9, not as a row: a contractor with units at three sites is three accounts, three statements, three counter payments. | New scope, and a schema change with a large blast radius |
| **B-254 needs a person, not a session:** nobody has run VoiceOver or NVDA against this product, and `LAST_REVIEWED` cannot move until somebody does (D-115). B-285's, B-286's and B-299's announcement questions all wait on that same pass. | Only a human can perform it |

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (fix wording then backfill — B-300 ✅, B-301 open).

## Do not re-raise

The block recorded **twelve refusals** and **two stated limits** in the numbering note at the top of `06-backlog.md`, so the ninth review pass does not re-find them — among them that the westernmost-zone reckoning in `reportRange` is **correct as built** (D-138 weighed the union-of-zones alternative and it double-counts), that `bodega` vs `unidad` and B-286's toggle markup are both settled, and that a `<p tabindex="-1">` with no focus ring is not a 2.4.7 failure. Read that note before starting the next review.

Carried gaps with no owning row, unchanged: B-300's `authExpiry` "minutes" for 1; B-299's transfer-preview move-in ceiling and its untested preview refusals; B-298's `Lease.endDate` and the rest of the demo seed's date columns; B-290's missing funnel measurement; B-284's, B-281's and B-280's carried gaps.

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
