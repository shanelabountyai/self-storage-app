# Next

**B-290 is done** (D-133 answered (A)). A browser that ranks Spanish above English, with no `st_locale` cookie, now sees a one-line Spanish offer above the public header. Either answer sets the cookie. **D-134 is answered too: (A), `<title>` follows the reader.**

## Start here

**B-291** (XS, now unblocked). Translate `<title>` on `/faq`, `/about`, `/contact` and `/accessibility`, via `metadataFor(...)` in `apps/web/components/site/prose-page.tsx`. `description`, `alternates` and Open Graph stay English (D-122, D-123). Its acceptance: the four routes agree with each other and with what `/accessibility` says is translated, and `tests/i18n.test.ts` covers the four title keys in both dictionaries. `generateMetadata` needs `getLocale()`. B-267 and B-268 already did this for `/…/reserve` and `/reservations`, so copy that shape.

After B-291, no unblocked build row remains.

Gaps carried forward with no owning row:
- B-290: when an offer button is pressed, the region removes itself and focus is not moved deliberately (the consent banner moves it to `#main`). The server action re-renders, so moving focus would need a client wrapper.
- B-287: the reset mail still ends "If you did not request this…", even though a member did not request it.
- B-285's seven server-drawn `role="alert"`s on other portal screens (`methods`, `pay`, `pay/done`, `transfer`, `protection`, and two on `move-out`).
- B-284's two, B-281's four and B-280's three, all unchanged.

The cloud dev branch has roles, permissions and templates but no demo facilities or owner. Run `npm run db:seed:demo` and `npm run db:create-owner` if `npm run dev` needs them.

## Owner actions

| What | Why it is yours |
|---|---|
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** Each landed on the login. Read the pay-link funnel for that window as broken, not ignored, and consider whether anyone who asked to leave a waitlist is still on it. | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run: it writes nothing without `--apply`). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **Decide whether a Spanish tenant's recapture invoice line should be Spanish.** It stays English (D-122) while the move-out screen they agreed on is Spanish. Recorded in B-284's entry, not settled. | It changes what the ledger stores |
| **Tell existing business-account members they have access.** B-287 emails only members added from now on; anyone added between B-258 and this deploy was never told. | A judgement about contacting customers |

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired).
