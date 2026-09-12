# Next

**B-298 is done** (`e605fcd`; **D-139** — `Lease.startDate` is a facility-local CALENDAR DAY carried at UTC midnight, and a range bound filtering it converts with `businessDateFor(bound, facility.timezone)`, exactly as `moveOutDate` already does). It closed all three gaps B-297 carried forward. The audit result is that `occupancyForFacility` was already correct and must **not** be converted — every column it filters is a real instant — and there is now a test that fails if somebody makes it symmetric with its neighbours.

It found four live bugs on the way, all fixed here: four screens still built their own UTC-midnight month bounds (a payment at 8pm on the 31st reported in the next month); the **signed lease document** stated a move-in date one day earlier than its own first-payment sentence at any facility west of UTC; `/admin`'s "Moved in today" tile could not see a move-in scheduled for today; and `completeTransfer` recorded the day *before* the transfer on its audit row.

The migration is applied everywhere — local test schema, e2e `public`, and the Neon dev branch. `npm run db:status` is green.

## Start here

**No unblocked build row remains.** The next move is the owner's: answer a blocked row (below), or start a new review block.

Gaps carried forward with no owning row:
- **B-298: `Lease.endDate` was not audited the way `startDate` was.** It is a Timestamptz that `completeTransfer` and the move-out path write as a calendar day, and `/admin`'s tile now reads it as one — but no writer was traced end to end. Nothing else range-filters it today; a second reader would need the same pass.
- **B-298: only `startDate`/`endDate` were fixed in the demo seed.** `dayAgo` exists now beside B-228's `dayFromNow`; no other seeded date column was reviewed, and the same question applies to every fixture standing in for a typed date.
- B-290: when an offer button is pressed, the region removes itself and focus is not moved deliberately (the consent banner moves it to `#main`). The server action re-renders, so moving focus would need a client wrapper.
- B-287: the reset mail still ends "If you did not request this…", even though a member did not request it.
- **B-295 left one thing open:** the three GET-submit refusals (`/portal/pay`, `/portal/transfer`, `/portal/move-out`) now announce nothing at all. Removing the role was right — nothing focused them — but a tenant who presses "Update"/"Show cost" and is refused still gets no announcement. Fixing that needs focus moved to the refusal, which on a server-rendered page needs a client wrapper: the same unsolved shape as B-290's. No row owns it.
- B-284's, B-281's and B-280's carried-forward gaps, all unchanged.

The cloud dev branch has roles, permissions and templates but no demo facilities or owner. Run `npm run db:seed:demo` and `npm run db:create-owner` if `npm run dev` needs them.

## Owner actions

| What | Why it is yours |
|---|---|
| **Know that a signed lease document has stated the wrong move-in date since B-106**, one day early, for every renter who picked a future start date at a facility west of UTC — which is all of them. The first-payment sentence in the same document said the right day. Fixed by B-298 going forward; the documents already signed say what they say. | Signed customer artefacts, and a judgement about telling people |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** Each landed on the login. Read the pay-link funnel for that window as broken, not ignored, and consider whether anyone who asked to leave a waitlist is still on it. | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run: it writes nothing without `--apply`). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** It is normalisation, not a schema change, and it touches only rows carrying a time of day — but it is the first data backfill to reach production from a migration file rather than from a script. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **Decide whether a Spanish tenant's recapture invoice line should be Spanish.** It stays English (D-122) while the move-out screen they agreed on is Spanish. Recorded in B-284's entry, not settled. | It changes what the ledger stores |
| **Tell existing business-account members they have access.** B-287 emails only members added from now on; anyone added between B-258 and this deploy was never told. | A judgement about contacting customers |

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired).
