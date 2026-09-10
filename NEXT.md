# Next

**B-278 is done.** The receipt for a payment that settled several units now
lists every unit it credited, with a total and the balance across those units.
That covers `/portal/pay/done`, the pay-link receipt `/pay/[token]/done` and
the emailed receipt. The portal nav's Pay link opens `/portal/pay?account=`
for a payer.

## Start here

**B-279** (a business account's payer is never sent a bill or a past-due
notice). It is the next unbuilt row in order. **B-275** (the Neon dev branch's
drift) is still open ABOVE it: buildable, authorised by D-132, and it needs a
session with Neon access.

**B-278 left one thing for a later row.** The emailed receipt's seeded wording
is "for unit {{unit.number}}", so a split payment reads "for unit C-7 and
C-8". The fix is a template edit in both languages, which is seeded state
(B-206's reseed trap), so it did not go in with a merge-field change.

## Owner actions

| What | Why it is yours |
|---|---|
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (dry: it writes nothing without `--apply`) and paste the output into B-277's `PROGRESS.md` entry | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty, so B-277's dry run could not happen. |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | This is the first time production has been swept, and the fix means leases that used to look broken now reconcile. |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice. A refused notice is a delayed lien clock. |

**The sweep does not find B-255's phantom balances.** A move-in charge with no
invoice reconciles by design (`tests/ledger-db.test.ts`, "reconciles a move-in
charge that never became an invoice"), so an unposted move-in payment is not a
ledger/invoice skew. B-277's row assumed otherwise. Only the backfill script's
`planMoveInBackfill` detects those leases. If they need an alarm, that is a new
row, not a change to `reconcile()`.

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115, a real screen-reader pass), B-290 (D-133), B-291 (D-134), B-129 /
B-243 / B-085 / B-133 (credentials or partner agreements), B-134 (trigger not
fired). **B-275** is buildable and authorised by D-132.

## What this session learned

**A seed change can break a spec in another topic file that names a fixture by
index.** B-256 edited the business-account block and its own specs passed; the
break was in `admin-tenants.spec.ts`, which reached the same lease as
`alex.active5`. Before giving a seeded lease new money state, grep `e2e/` for
the tenant's email as well as its name.

**Only the latest red run's log was read, so seven red runs looked like three.**
`gh run view <id> --log-failed` on each run back to the last green one finds
the first failure in minutes.

**A reseed leaves `.next/cache/fetch-cache` serving the old ids.**
`db:migrate:e2e` recreates the demo facilities, and every unit-type id changes.
The data cache survives `next build`, so the facility page links a dead
`?unitType=` and the `/reserve` layout test fails on "That size isn't available
here any more", which reads like a broken reserve flow. `rm -rf
apps/web/.next/cache/fetch-cache` after any reseed. CI never sees it.

**An accessible name added to a container can break a substring locator.**
Naming the dashboard's table region "Units billed to Acme Contracting" made
`getByRole('region', { name: 'Acme Contracting' })` match two elements. Pass
`exact: true` when a region locator names something a child region's name
might contain.

**A `page.setContent` fixture needs a viewport meta on the Pixel 7 project.**
Without one, mobile emulation lays the page out at 980px and a 900px fixture
fits, so the assertion meant to fail passes.
