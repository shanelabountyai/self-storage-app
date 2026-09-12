# Next

**B-296 is done** (`39d1e1c`; no new decision — it applies B-223's rule at the other end of the same window). The `e2e/impersonation.spec.ts` failure B-295 left undiagnosed was a real bug in `reportRange`, not flakiness: for the five hours between UTC midnight and facility-local midnight, a rolling window that includes today had an exclusive end *earlier than now*, so the support-session log did not list a session started minutes earlier. It also fixed a second clock defect the verification run surfaced — `ImpersonationSession.startedAt` came from the database clock while `expiresAt` came from the app's.

## Start here

**No unblocked build row remains.** The next move is the owner's: answer a blocked row (below), or start a new review block.

Gaps carried forward with no owning row:
- **B-296: `last-complete-month` has the same clock disagreement at both its ends.** A payment taken at 8pm on the 31st is `2026-09-01T01:00Z` and a month report whose exclusive end is `2026-09-01T00:00Z` files it in the wrong month. Not fixed with B-296 because those same ranges also filter DATE columns stored at UTC midnight, where the current boundaries are correct — one range cannot serve both, and sorting out which callers need which is a row, not a clause.
- **B-296: `/admin/access` shares the rolling window and the fix but has no test of its own.** `admin-tasks.spec.ts` visits it and asserts nothing about its window.
- B-290: when an offer button is pressed, the region removes itself and focus is not moved deliberately (the consent banner moves it to `#main`). The server action re-renders, so moving focus would need a client wrapper.
- B-287: the reset mail still ends "If you did not request this…", even though a member did not request it.
- **B-295 left one thing open:** the three GET-submit refusals (`/portal/pay`, `/portal/transfer`, `/portal/move-out`) now announce nothing at all. Removing the role was right — nothing focused them — but a tenant who presses "Update"/"Show cost" and is refused still gets no announcement. Fixing that needs focus moved to the refusal, which on a server-rendered page needs a client wrapper: the same unsolved shape as B-290's. No row owns it.
- B-284's, B-281's and B-280's carried-forward gaps, all unchanged. (Note: an earlier NEXT.md rewrite folded these into the `role="alert"` paragraph and made them read as alert counts — "B-284's two, B-281's four and B-280's three". They are each item's own left-behind list, not alerts. B-295 checked.)

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
