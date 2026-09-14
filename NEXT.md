# Next

**Three of the owner's blocked decisions are answered** (`96dc622`). One became **D-140**, one became a backlog row, and one could not be answered because nobody has the number it needs — so what exists for that one is the query, not a decision.

The finding worth keeping: **the scoping query's obvious join is wrong in a way that fails silently in the dangerous direction.** A signed lease's `document."subjectType"` is `'CheckoutSessionUnit'`, not `'lease'` — so `document.subjectId = lease.id` returns zero rows on a fully-populated database, and zero rows there reads as *"nobody was affected, no disclosure needed"*. It now reports resolved vs. unresolved beside the count.

Unit suite 4,483 + 8 of 4,491 across 264 files (4,488 baseline + 3 new). No migration. No e2e — the change is the text of an outbound email.

## Start here

**No unblocked build row remains, and the eighth review block is still the standing next move** (the seventh was 2026-09-10, over B-252–B-274; everything from B-275 on has never been reviewed). The one new build row, **B-301**, is blocked on production access rather than on the tree.

Gaps carried forward with no owning row:
- **B-300: `authExpiry`'s English string says "minutes" for a value of 1** while the Spanish pluralises. Unreachable — no auth token here has a one-minute life — and left alone deliberately.
- **B-299: `/portal/transfer`'s preview does not validate the move-in ceiling.** `date_too_far_out` and `date_in_past` are `requestTransfer`'s refusals only, so a crafted URL prices a transfer for 2031 without complaint. No money moves — the request is still refused — but the screen quotes a date the product will not accept.
- **B-299: `/portal/transfer`'s preview refusal is rendered by no test of any kind** beyond the source check in `tests/refusal-fragment.test.ts`. Every refusal it can return needs a race or a second lease, which B-120's rules make expensive against the shared demo database.
- **B-298: `Lease.endDate` was not audited the way `startDate` was.** It is a Timestamptz that `completeTransfer` and the move-out path write as a calendar day, and `/admin`'s tile now reads it as one — but no writer was traced end to end. Nothing else range-filters it today; a second reader would need the same pass.
- **B-298: only `startDate`/`endDate` were fixed in the demo seed.** `dayAgo` exists now beside B-228's `dayFromNow`; no other seeded date column was reviewed.
- B-284's, B-281's and B-280's carried-forward gaps, all unchanged.
- **B-290's second gap is still open:** nothing measures how many visitors see, accept or decline the Spanish offer. No funnel event, no row.

B-287's reset-mail gap is **closed** by B-300. D-122's open half is **closed** by D-140 — do not re-open it; the upgrade path is written into the D-number.

The cloud dev branch has roles, permissions and templates but no demo facilities or owner. Run `npm run db:seed:demo` and `npm run db:create-owner` if `npm run dev` needs them.

## Owner actions

**One empty file now blocks three of these.** `.env.prod-ops`'s `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all still empty, and B-277's backfill, B-301's dry run and the signed-lease scoping query all need them. Filling it once unblocks all three.

| What | Why it is yours |
|---|---|
| **Run `docs/ops/b298-signed-lease-move-in-date.sql` against production, then decide the disclosure.** You chose to scope before deciding, and the query is written and smoke-tested. **Read its second result set first:** a zero count beside a large `unresolved` means the join failed, not that nobody was affected. **The defect is still live** — B-298 has not deployed — so run it again after the deploy. | Production data, and a judgement about telling people |
| **B-301: tell existing business-account members they have access.** You chose fix-the-wording-then-backfill; the wording is fixed (B-300) and the send is a row. Needs the dry-run count before anything goes out. | Contacting customers, and production access |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** | Production data, and a judgement about telling people |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** First data backfill to reach production from a migration file. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **B-254 needs a person, not a session:** nobody has run VoiceOver or NVDA against this product, and `LAST_REVIEWED` cannot move until somebody does (D-115). B-285's, B-286's and B-299's announcement questions all wait on that same pass. | Only a human can perform it |

**Answered 2026-09-14, do not re-ask:** the Spanish recapture line (D-140, stays English); the signed-lease disclosure (scope first, query written); the business-account members (fix wording then backfill — B-300 ✅, B-301 open).

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired), B-301 (production access).
