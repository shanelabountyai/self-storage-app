# Next

**B-299 is done** (`4da40c7`). It closed the two gaps B-295 and B-290 each carried forward with no owning row, and they turned out to be one shape. The finding worth keeping: **both rows concluded "this needs a client wrapper", and for three of the four it does not** — a GET submit is a browser navigation, so the form submits to a fragment and the browser's own scroll-to-fragment focuses the refusal, exactly as the skip link has always worked. Only B-290's Spanish offer needed script, because it posts a server action and re-renders in place.

No migration. Full unit suite 4,480 + 8 of 4,488 across 263 files; the four affected e2e specs 254 passed, 0 failed.

## Start here

**No unblocked build row remains.** The next move is the owner's: answer a blocked row (below), or start the eighth review block (the seventh was 2026-09-10, over B-252–B-274; everything from B-275 on has never been reviewed).

Gaps carried forward with no owning row:
- **B-299: `/portal/transfer`'s preview does not validate the move-in ceiling.** `date_too_far_out` and `date_in_past` are `requestTransfer`'s refusals only, so a crafted URL prices a transfer for 2031 without complaint. No money moves — the request is still refused — but the screen quotes a date the product will not accept.
- **B-299: `/portal/transfer`'s preview refusal is rendered by no test of any kind** beyond the source check in `tests/refusal-fragment.test.ts`. Every refusal it can return needs a race or a second lease, which B-120's rules make expensive against the shared demo database.
- **B-298: `Lease.endDate` was not audited the way `startDate` was.** It is a Timestamptz that `completeTransfer` and the move-out path write as a calendar day, and `/admin`'s tile now reads it as one — but no writer was traced end to end. Nothing else range-filters it today; a second reader would need the same pass.
- **B-298: only `startDate`/`endDate` were fixed in the demo seed.** `dayAgo` exists now beside B-228's `dayFromNow`; no other seeded date column was reviewed.
- B-287: the reset mail still ends "If you did not request this…", even though a member did not request it.
- B-284's, B-281's and B-280's carried-forward gaps, all unchanged.
- **B-290's second gap is still open and is NOT what B-299 fixed:** nothing measures how many visitors see, accept or decline the Spanish offer. No funnel event, no row.

The cloud dev branch has roles, permissions and templates but no demo facilities or owner. Run `npm run db:seed:demo` and `npm run db:create-owner` if `npm run dev` needs them.

## Owner actions

Unchanged from B-298's handoff, and none of them has been done:

| What | Why it is yours |
|---|---|
| **Know that a signed lease document has stated the wrong move-in date since B-106**, one day early, for every renter who picked a future start date at a facility west of UTC. Fixed by B-298 going forward; the documents already signed say what they say. | Signed customer artefacts, and a judgement about telling people |
| **Know that no real pay link worked from 2026-08-07 until B-283 deploys, and no waitlist cancel link worked from 2026-08-20.** | Production data, and a judgement about telling people |
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (a dry run). Paste the output into B-277's `PROGRESS.md` entry. | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty |
| **B-298's migration rewrites `lease.startDate` on production when it deploys.** First data backfill to reach production from a migration file. Worth watching the deploy. | Production data |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | The first time production has been swept |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice |
| **Decide whether a Spanish tenant's recapture invoice line should be Spanish** (D-122 keeps it English) | It changes what the ledger stores |
| **Tell existing business-account members they have access.** B-287 emails only members added from now on. | A judgement about contacting customers |
| **B-254 needs a person, not a session:** nobody has run VoiceOver or NVDA against this product, and `LAST_REVIEWED` cannot move until somebody does (D-115). B-285's, B-286's and B-299's announcement questions all wait on that same pass. | Only a human can perform it |

## The blocked list

B-254 (D-115), B-129 / B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not fired).
