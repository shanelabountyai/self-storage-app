# Next

**B-287 is done** (`251be24`). Adding a member to a business account now emails them a set-password link. The email opens with one sentence naming the account, is written in the member's `preferredLocale` (else English, never the staffer's browser language), and is filed under the member. The send runs after the membership commits. If it fails, the staffer's confirmation says so and tells them to point the member at "Forgot your password?". `sendAuthEmail` now escapes its HTML.

## Start here

**B-288** (Spanish uses two different words for the rented unit). It is the next unbuilt row, and its dependency B-260 is done. **B-289** (the counter's shared-address warning reads as a policy memo) follows. **B-275** (the Neon dev branch's drift) is still open and needs a session with Neon access.

Gaps carried forward with no owning row:
- B-287: the reset mail still ends "If you did not request this…", even though a member did not request it. The link still expires in 60 minutes; the lead sentence tells them to ask for a new one.
- B-285's seven server-drawn `role="alert"`s on other portal screens (`methods`, `pay`, `pay/done`, `transfer`, `protection`, and two on `move-out`).
- B-284's two, B-281's four and B-280's three, all unchanged.

## Owner actions

| What | Why it is yours |
|---|---|
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** Each landed on the login. Read the pay-link funnel for that window as broken, not ignored, and consider whether anyone who asked to leave a waitlist is still on it. | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run: it writes nothing without `--apply`). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **Decide whether a Spanish tenant's recapture invoice line should be Spanish.** It stays English (D-122) while the move-out screen they agreed on is Spanish. Recorded in B-284's entry, not settled. | It changes what the ledger stores |
| **Tell existing business-account members they have access.** B-287 emails only members added from now on; anyone added between B-258 and this deploy was never told. | A judgement about contacting customers |

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115), B-290 (D-133), B-291 (D-134), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired).
