# Next

**B-283 is done** (`cff6938`). `/pay/[token]` and its receipt render in the
tenant's language, with `<html lang>` to match. It also fixed a bug that had
kept every real pay link from reaching that page since 2026-08-07: the proxy
lower-cased the token (see the B-283 entry in PROGRESS).

## Start here

**B-284** (the portal's Spanish has holes on the money screens). It is the next
unbuilt row. It already owns `/portal/pay/done`'s `en-US` date, which B-283 left
alone. `AMOUNT_PROBLEM_KEYS` now lives in `lib/portal/payment.ts`.
**B-275** (the Neon dev branch's drift) is still open above it and needs a
session with Neon access.

B-281's four gaps and B-280's three are unchanged (see their PROGRESS entries).

## Owner actions

| What | Why it is yours |
|---|---|
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link from 2026-08-20.** Each landed on the login. Read the pay-link funnel for that window as broken, not ignored, and consider whether anyone who asked to leave a waitlist is still on it. | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (dry: it writes nothing without `--apply`) and paste the output into B-277's `PROGRESS.md` entry | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115), B-290 (D-133), B-291 (D-134), B-129 / B-243 / B-085 / B-133
(credentials or partner agreements), B-134 (trigger not fired).

## What this session learned

**In zsh, never name a shell variable `path`.** zsh ties `path` to `PATH`, so
`path=/pay/x` in a loop wipes the command search path, and the next `curl`
reports "command not found".

**A test that drives only invalid tokens cannot see a bug that breaks valid
ones.** Rendering the page against a disposable, real token on a `dev:test`
server is what found the lower-casing bug.
