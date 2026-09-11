# Next

**B-281 is done** (`83fd713`). Cash, check and money order at the counter now
end on `/admin/pos/done?payment=<id>`, a printable receipt. A message to a
tenant with no email is rendered before it is recorded `failed`, so the
`no_reachable_channel` task points to a body staff can print and mail.

## Start here

**B-283** (the Spanish payment reminder opens an English payment screen). It is
the next unbuilt row in order. **B-275** (the Neon dev branch's drift) is still
open above it: buildable, authorised by D-132, and it needs a session with Neon
access.

**B-281 left four gaps with no row** (see its PROGRESS entry):
- the deposit slip does not link to a receipt reprint
- the walk-in move-in's cash does not end on this receipt
- the task links to the tenant profile, not the message itself
- a no-email tenant who turned a category off still gets a task

B-280's three gaps are unchanged.

## Owner actions (unchanged)

| What | Why it is yours |
|---|---|
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (dry: it writes nothing without `--apply`) and paste the output into B-277's `PROGRESS.md` entry | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty, so B-277's dry run could not happen. |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | This is the first time production has been swept. |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice. |

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115), B-290 (D-133), B-291 (D-134), B-129 / B-243 / B-085 / B-133
(credentials or partner agreements), B-134 (trigger not fired).

## What this session learned

**In zsh, `npm test -- $files` passes the whole list as ONE argument.** zsh
does not word-split an unquoted variable, so vitest printed "No test files
found" and exited 1, which looks like a test failure. Pass the glob directly
(`npm test -- tests/comms*.test.ts`) or split it with `${=files}`.
