# Next

**B-284 is done** (`649c1ad`). On the portal and checkout, dates now follow the tenant's language. So do the move-out recapture reason and the stale-preview refusals. An untagged date in `app/portal` or `app/(public)` now fails lint (`apps/web/eslint.config.mjs`).

## Start here

**B-285** (`/portal/access`: the unlock button blurs itself, and two static paragraphs shout). It is the next unbuilt row. **B-275** (the Neon dev branch's drift) is still open above it and needs a session with Neon access.

B-284 left gaps with no owning row yet (see its PROGRESS entry):
- the protection change confirmation (`scheduledNotice` in `@storage/core/billing` is English prose)
- the move-out and cancel success messages, which are English literals

B-281's four gaps and B-280's three are unchanged.

## Owner actions

| What | Why it is yours |
|---|---|
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** Each landed on the login. Read the pay-link funnel for that window as broken, not ignored, and consider whether anyone who asked to leave a waitlist is still on it. | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run: it writes nothing without `--apply`). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **Decide whether a Spanish tenant's recapture invoice line should be Spanish.** It stays English (D-122) while the move-out screen they agreed on is Spanish. Recorded in B-284's entry, not settled. | It changes what the ledger stores |

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115), B-290 (D-133), B-291 (D-134), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired).

## What this session learned

**Playwright's global setup logs only when it releases something.** A run with no `[e2e setup]` line is not proof that setup skipped. If the command went through `npm run test:e2e`, the env was loaded, and a clean database has nothing to release.

**ESLint's `no-restricted-syntax` with `[arguments.length<N]` is a cheap guard against a missing argument.** Scope it with `files`, and pin it with `ESLint#lintText` in a unit test, so a selector that silently matches nothing fails.
