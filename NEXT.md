# Next

**B-286 is done** (`e1794be`). In the language toggle, `lang` now sits only on the current button, which has no `aria-label`. The other button's visible language name is wrapped in a `lang`-declared span. A new e2e test checks both locales, and a negative run shows it fails against the old markup. The row's hedge, that 3.1.2 arguably never required this, is carried unchanged.

## Start here

**B-287** (somebody granted sight of a business account is never told, and may not be able to sign in). It is the next unbuilt row, and its dependencies B-258 and B-265 are done. **B-275** (the Neon dev branch's drift) is still open above it and needs a session with Neon access.

Gaps carried forward with no owning row:
- B-285's seven server-drawn `role="alert"`s on other portal screens (`methods`, `pay`, `pay/done`, `transfer`, `protection`, and two on `move-out`).
- B-284's two, B-281's four and B-280's three, all unchanged.

B-286 added nothing new beyond what B-254 already owns: what a screen reader actually says.

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

**A stale `apps/web/.next/dev/lock` makes `E2E_DEV=1` die at `webServer`'s 300s timeout** with no other output, because Playwright hides the server's refusal. If the lock's `pid` is dead, `rm` it. The production-build path is unaffected.

**`--list` is the expected count for reconciling a sweep.** A grep of `test(` in the spec undercounts.
