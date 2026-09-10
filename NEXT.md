# Next

**B-292 and B-277 are done (one commit, a noted cluster).** B-292 was found
while starting B-277: `reconcile()` counted a payment twice, so every lease that
had paid an invoice reported a discrepancy and **the lien-notice gate refused
every such tenant**. B-277's exception list sits on top of the fix.

## Start here

**Next: B-282** (three customer money-path tables bypass `ScrollRegion`, SC
2.1.1 Level A), then **B-278** (the receipt's `take: 1` with no `orderBy`).
Read the row before starting: several carry a `needs confirmation at build time`
clause that must not be quietly upgraded to verified.

## Owner actions

| What | Why it is yours |
|---|---|
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (dry: it writes nothing without `--apply`) and paste the output into B-277's `PROGRESS.md` entry | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty, so B-277's dry run could not happen. |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | This is the first time production has been swept, and the fix means leases that used to look broken now reconcile. |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice. A refused notice is a delayed lien clock. |

**The sweep does not find B-255's phantom balances.** A move-in charge with no
invoice reconciles by design (`tests/ledger-db.test.ts`, "reconciles a move-in
charge that never became an invoice"), so an unposted move-in payment is not a
ledger/invoice skew. B-277's row assumed otherwise. Only the backfill script's
`planMoveInBackfill` detects those leases. If they need an alarm, that is a new
row, not a change to `reconcile()`.

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115, a real screen-reader pass), B-290 (D-133), B-291 (D-134), B-129 /
B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not
fired). **B-275** is buildable and authorised by D-132.

## What this session learned

**A fixture that mirrors an assumption hides the bug the assumption is.**
`reports-financial-db.test.ts` writes payment ledger entries WITH an
`invoiceId`, which is what B-049's reconciliation assumed. No production writer
does that, so every real paid lease failed and every fixture passed. What found
it was running the arithmetic in SQL over `storage_test`'s 722 leases, whose
rows came through the real payment path. Do that before trusting a
reconciliation rule.
