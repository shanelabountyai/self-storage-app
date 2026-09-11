# Next

**B-285 is done** (`SHA_PENDING`). The "Open the gate" button on `/portal/access` keeps focus while pending: `aria-busy` with a click guard, no `disabled`. No element on that page carries `role="alert"` at load. The e2e holds the unlock request open, and negative runs show the new assertions fail against the old button.

## Start here

**B-286** (the language toggle puts `lang` on an element whose `aria-label` is in the other language). It is the next unbuilt row. **B-275** (the Neon dev branch's drift) is still open above it and needs a session with Neon access.

B-285 left one gap with no owning row (see its PROGRESS entry): seven server-drawn `role="alert"`s on other portal screens (`methods`, `pay`, `pay/done`, `transfer`, `protection`, and two on `move-out`). Nobody has sorted page content from real status messages. The move-out pair is B-164's deliberate choice, which B-245's ruling now contradicts.

B-284's two gaps (the `/portal/protection` change confirmation, and the move-out and cancel success messages), B-281's four and B-280's three are unchanged.

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

**To see a pending state in e2e, hold the server action's POST open** with `page.route('**/<path>', async (route) => { if (route.request().method() === 'POST') await held; await route.continue() })`. Against a local server, pending lasts milliseconds, so a test that only checks the outcome cannot see a pending-state bug. The B-086 test passed with `disabled` in place for exactly that reason.

**Count submits on the form, not requests on the network.** `useActionState` queues a second press and sends it after the first returns, so a request count taken mid-flight reads 1 either way. A `submit` listener on the form sees the second press the moment it happens.

**E2E_DEV=1 reuses a dev server across runs**, so negative checks (swap the fix out, run one test, swap back) take seconds each rather than a production build per variant.
