# Next

**B-295 is done** (no new decision; it applies B-245's ruling and B-285's exception). The seven `role="alert"`s B-285 named on other portal screens were audited and all seven were page content: four record state at draw, three the result of a `formMethod="get"` submit, which is a full document load. An ESLint rule now refuses the attribute under `app/portal/**`.

## Start here

**No unblocked build row remains.** The next move is the owner's: answer a blocked row (below), or start a new review block.

**One new finding has no owning row, and it is a real failure on `main`:**

- **`e2e/impersonation.spec.ts:63` fails on both projects, and it is NOT from B-295.** Verified by stashing B-295's portal files back to HEAD and re-running: still 2 failed / 4 passed. It fails at line 148 on `getByRole('cell', { name: reason })` on `/admin/impersonation` — the support session is started and the banner assertions pass, but the session's reason never appears as a cell in the admin table. No portal markup is involved. It wants its own row; nobody has diagnosed whether the row is missing, is rendered differently, or is being outlived by another test's session.

Gaps carried forward with no owning row:
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
