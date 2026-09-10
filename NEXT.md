# Next

**B-279 is done** (`2eeba53`). A business account's payer now receives the bill
(`invoice.due_soon`, `invoice.due_today`) and the past-due ladder
(`delinquency.day_reached`) beside the lease's tenant, in the payer's own
language. The lien supplements stay tenant-only (D-118). The owner settled the
scope as **D-136**: a list of event names, because entity type cannot separate
the dunning email from the lien supplement. `/admin/billing/accounts/[id]` shows
days past due and the ladder stage.

## Start here

**B-280** (a business account cannot pay at the counter, and forcing it through
mis-posts the money). It is the next unbuilt row in order. **B-275** (the Neon
dev branch's drift) is still open ABOVE it: buildable, authorised by D-132, and
it needs a session with Neon access.

**Two things B-278 and B-279 left to template edits** (seeded state, B-206's
reseed trap, no row yet): the receipt reads "for unit C-7 and C-8", and a
payer's reminder reads "the balance on unit C-7" without naming the tenant on it.

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

**zsh does not word-split an unquoted variable.** `files="a b"; npm test -- $files`
hands vitest ONE filter string, and it answers "No test files found" with exit
1. Pass the paths literally, or use `${=files}`.

**A second recipient on one event shares the pay-link revocation.**
`mintPayLink` revoked any live link for the same event and lease, so adding the
payer would have killed the tenant's link. It is now scoped by tenant too. Check
every per-event side effect in a context extender before fanning an event out.

