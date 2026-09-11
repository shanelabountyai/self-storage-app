# Next

**B-280 is done** (`f8e0414`). The counter can take a business account's check
as the account's payer. `/admin/pos` search finds accounts by name, and the
picker's "Unit or account" list offers the account as one payment spread
oldest-first across its units. Per the owner's **D-137**, a payment keyed to a
unit on somebody else's account is refused past what that tenant owes
(`account_remainder`), so an account's check can no longer sit as prepayment on
one employee's unit.

## Start here

**B-281** (the counter and the dunning ladder have no paper lane). It is the
next unbuilt row in order. **B-275** (the Neon dev branch's drift) is still open
above it: buildable, authorised by D-132, and it needs a session with Neon access.

**B-280 left three gaps with no row** (see its PROGRESS entry): a card payment
for an account at the counter, account search by the payer's name, and an
`account_remainder` message that names the account. The B-278 receipt wording
and the B-279 reminder wording are still template edits (seeded state, B-206's
reseed trap).

## Owner actions (unchanged)

| What | Why it is yours |
|---|---|
| **Fill in `.env.prod-ops`, then run `npx dotenv -e .env.prod-ops -- npm run db:backfill:move-in-payments`** (dry: it writes nothing without `--apply`) and paste the output into B-277's `PROGRESS.md` entry | `DATABASE_URL`, `DIRECT_URL` and `EXPECTED_DEV_DB_HOST` are all empty, so B-277's dry run could not happen. |
| **After the next deploy, look at the first cron response's `ledgerExceptions` and the new `ledger_does_not_reconcile` tasks** | This is the first time production has been swept. |
| **Ask whether anyone tried to generate a lien notice and was refused** | Before B-292, `ledger_does_not_reconcile` refused every tenant who had paid an invoice. |

## Two questions are the owner's (unchanged)

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility`? |

## The blocked list is unchanged

B-254 (D-115), B-290 (D-133), B-291 (D-134), B-129 / B-243 / B-085 / B-133
(credentials or partner agreements), B-134 (trigger not fired).

## What this session learned

**`searchTenants` cannot find a business account's payer, by design.** It only
returns tenants holding a lease the actor can see, because the tenant profile's
access check depends on that. Anything that needs the payer at the counter has
to search accounts (`counterPayableAccounts({ name })`), not widen tenant search.

**TypeScript's `"x" in obj` narrowing on a union of Prisma select shapes gives
`{}`.** Make both branches return the same shape instead.
