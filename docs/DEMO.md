# Demo script

A 20–25 minute walkthrough of the platform: a renter moves in online, a tenant
who is behind pays, and the operator's side shows what the system did about
each. It runs **locally**, against the seeded demo data. Every command and
every stop below was run on 2026-09-21 against a production build.

The deployed site (`storage.labintelligence.co`) is behind a shared password
and seeded **without** the demo logins, so it is not the demo path. See
[the last section](#the-deployed-site).

---

## Before the audience arrives (10 minutes)

**Once per machine:** Postgres running locally, `.env.local` and `.env.test`
filled in (see [README.md](../README.md#setup)). `.env.local` must have test-mode
Stripe keys (`STRIPE_SECRET_KEY=sk_test_…`) and `CRON_SECRET`. The Stripe CLI
must be installed (`brew install stripe/stripe-cli/stripe`).

**Every time, in this order:**

```bash
# 1. Free the port and reseed. Reseeding puts every demo balance back where
#    this script expects it: Dana owes $161, her gate is suspended.
lsof -ti :3000 | xargs -r kill -9
npm run db:migrate:e2e
rm -rf apps/web/.next/cache/fetch-cache

# 2. Build and serve the real production build on :3000 (build takes ~3 min).
npm run e2e:server

# 3. In a second terminal: forward Stripe's test webhooks to the app.
#    WITHOUT THIS, CHECKOUT NEVER COMPLETES — payments are finalised from the
#    webhook, never from the browser.
stripe listen --api-key "$(grep -E '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2- | tr -d '"')" \
  --forward-to localhost:3000/api/stripe/webhook
```

The secret `stripe listen` prints should match `STRIPE_WEBHOOK_SECRET` in
`.env.local`. It does for this machine's Stripe account. If it does not, every
webhook fails signature verification and nothing tells you.

**Keep this ready for the staff sign-in.** Staff two-factor authentication is
mandatory and there is no bypass, so you need a live code:

```bash
npx tsx -e "import {totpCode,base32Decode} from './packages/core/auth/totp.ts'; console.log(totpCode(base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'), Date.now()))"
```

Or add the secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` to an authenticator app
once. Each code works **once**: if you sign out and back in within the same
30 seconds, wait for the next code.

### Accounts

All of these are defined in
[apps/web/scripts/demo-credentials.ts](../apps/web/scripts/demo-credentials.ts).
The seed refuses to run with `NODE_ENV=production`, which is why they can be
published.

| Who | Email | Password | What they show |
|---|---|---|---|
| Owner (staff) | `owner@demo.example.com` | `demo-owner-password` + TOTP code | Everything on the admin side, all facilities |
| Dana, past due | `dana@demo.example.com` | `demo-tenant-password` | $161 past due at Austin South unit 10x10-006; gate suspended |
| Business payer | `business@demo.example.com` | `demo-tenant-password` | *Acme Contracting*: one payer, two units, one balance |
| Bookkeeper | `bookkeeper@demo.example.com` | `demo-tenant-password` | Sees the Acme account and cannot pay it |
| Pia, payment plan | `pia@demo.example.com` | `demo-tenant-password` | An agreed plan, which halts collections |

Stripe test card: **4242 4242 4242 4242**, any future expiry, any CVC, ZIP 78704.

Use two browser windows, one normal and one private, so the owner and a tenant
can be signed in at the same time.

---

## The walkthrough

### 1. Public site: find and price a unit (3 min)

**Open** `http://localhost:3000` → search **78704**.

> "This is what a renter sees first. The zip resolves to distance-ranked
> facilities with real prices and real availability, not 'call for rates'."

**Click** *Demo — Austin South*. Point at office hours versus gate hours, the
size filter, and the **online rate below the in-store rate**.

> "Every unit is month to month. The online price is the one you pay if you
> rent here; the counter quotes the in-store price. That split is a real
> industry pricing lever."

### 2. Move in online, no phone call (5 min)

**Click** *Rent now* on the 5×5 Locker. Walk the six steps:

1. **Your details.** No password field. Enter any name, a new email ending
   `@demo.example.com`, and zip 78704. City and state fill in from the zip.
2. **Your unit.** Point out *"We are holding this unit for you while you
   finish"*. The unit is locked so two people cannot buy the same one.
3. **Protection.** Choose **$2,000 cover**.
   > "Every renter has to have cover, either our plan or their own insurance.
   > The plan is labelled as not being insurance, because legally it isn't."
4. **Lease.** Read *The short version* aloud. Tick the e-sign consent, type a
   name, and press *Sign and continue*.
5. **Payment.** An itemised total: rent, a one-time admin fee, tax, and
   protection. Autopay is on by default and says so. Pay with 4242.
6. **Done.** *"You are moved in"*, **a gate code**, and the next payment date.

> "Card details go straight to Stripe and never touch our servers. The move-in
> completes from Stripe's webhook, not from the browser, so a renter who
> closes the tab still gets their unit."

**Write the gate code down.** You need it in stop 5.

### 3. The tenant who is behind (4 min)

**Private window:** sign in as `dana@demo.example.com`.

> "Dana is 35 days late. The first thing she sees is why her gate code
> doesn't work, and how to fix it in one step."

**Show** the past-due banner (*"Pay $161 and your gate code starts working
again"*), then *Statements* (month by month, what was owed and what was paid).

**Click** *Pay $161 now*. Show the itemised breakdown and the line saying the
gate turns back on. Pay with 4242 and land on the receipt.

**Then** make the "usually within a couple of minutes" happen now. Locally,
nothing runs the hourly scheduler, so trigger it yourself:

```bash
curl -s -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"')" \
  localhost:3000/api/cron | head -c 300
```

The same tick also raises next month's invoices, so Dana's portal then shows
October's rent as a normal, not-yet-due balance. That is the product working.

**Optional:** sign in as `business@demo.example.com` to show *Acme Contracting*:
one payer, two units, one balance, and one payment applied oldest-first across
units. `bookkeeper@` sees the same card with no Pay button.

### 4. The operator's morning (6 min)

**Normal window:** go to `http://localhost:3000/admin`, sign in as the owner
with a fresh TOTP code.

- **Dashboard** (*Demo — Austin South*). The *"This facility is not ready to
  operate"* banner lists what is still unset and what each gap costs.
  > "The system refuses to guess at legal configuration. With no delinquency
  > timeline, it runs no lien process at all, rather than a default one that
  > might be wrong for Texas."
- **Settings → Delinquency** (`/admin/settings/delinquency`). The *not legal
  advice* warning, and *Load the example configuration*. Saving creates a
  version, and each lease records which version governed it.
- **Tenants.** Search `dana@demo`. (A plain "Dana" also finds a *Dana
  Delinquent* at each facility; the portal Dana is the Austin South one.)
  Open her record: balance, the payment you just took, gate access, and
  communication history. Then open **Ledger**.
  > "Every correction, write-off and void on this screen repeats back the
  > tenant, unit, amount and resulting balance before it posts, and has a
  > Cancel. Money doesn't move on a single click."
- **Delinquency** (`/admin/delinquency`). Pia sits under *Halted*: her
  payment plan stops collections, and the screen says so rather than hiding
  her.
- **POS** (`/admin/pos`). The counter: take a cash or check payment, or a
  walk-in move-in at the **in-store** price. It is the same move-in flow the
  website uses.
- **Reports** (`/admin/reports`). Occupancy, economic occupancy, and a rent
  roll sorted by the biggest gap between in-place and street rate.
  > "That gap is the rate-increase opportunity. `/admin/rate-increases` shows
  > who the rule would pick, and nothing goes to a tenant until an owner
  > approves it."

### 5. The gate, with no hardware (2 min)

**Go to** `/admin/dev/keypad` (Gate simulator).

- Enter the code from stop 2 → **Access granted**.
- Enter `1234` → **Access denied — no credential on file matches that code.**
- Show *Fault injection*: take the gate offline, and the keypad keeps deciding
  locally while events queue for replay.

> "There's no real gate vendor here, on purpose. The simulator runs the real
> access service end to end, including a signed webhook, so switching to a
> vendor is an adapter, not a rewrite."

**Then** `/admin/access`: every attempt, including failures. Unknown codes are
kept, because a stranger working through numbers is a pattern worth seeing.

### 6. Close (1 min)

> "About 340 backlog items over eight weeks, each with its tests, a written
> record of what it decided, and automated accessibility scans on the
> customer-facing pages. Texas lien rules by default, configurable per state, and every legal
> text marked as an unreviewed draft."

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Checkout stays on **Payment** after *Pay and complete move-in* | `stripe listen` is not running, or its secret differs from `STRIPE_WEBHOOK_SECRET` | Start it (setup step 3). Compare the secret it prints with `.env.local`, then restart the server if you changed it |
| Staff sign-in refused with the right password | The TOTP code was already used in this 30-second window, or it expired | Wait for the next code |
| Dana's portal still says the gate is off after paying | No scheduler runs locally | Run the `curl … /api/cron` command in stop 3 |
| `/portal/pay` says *"We couldn't find that unit on your account"* | The URL was typed without `?lease=` | Use the *Pay $161 now* button on `/portal` |
| Dana owes $0 or the wrong amount before you start | A previous run or an e2e sweep paid her balance | `npm run db:migrate:e2e`, then `rm -rf apps/web/.next/cache/fetch-cache` |
| Reserve or checkout shows a unit or id that no longer exists | Cached page from before a reseed | `rm -rf apps/web/.next/cache/fetch-cache` and restart the server |
| Every page fails in about a second, or the server exits | Something else holds :3000, or memory pressure killed it | `lsof -ti :3000`, `sysctl -n kern.memorystatus_level`; stop other projects' dev servers |
| `npm run e2e:server` fails at *table does not exist* | Local e2e schema not migrated | `npm run db:migrate:e2e` |

Emails are not sent locally. With no `RESEND_API_KEY` they are written to the
server's console, and the tenant's communication history still records them.

---

## What to concede before you're asked

- **Nobody real has used it.** Every facility, tenant and payment is seeded
  or synthetic, and Stripe runs in test mode. There has been no pilot site.
- **The gate is simulated.** No gate vendor has been integrated (PRD 03 was
  built against a mock adapter by design). The same goes for SMS: the Twilio
  campaign was never approved, so texts fall back to email.
- **Legal text is draft and unreviewed.** The lease, lien notices and
  delinquency timeline are Texas-shaped examples, and the product says so on
  the page. None of it has been reviewed by an attorney.
- **It is not live for the public.** The deployment sits behind a shared
  password and holds demo data only. Production database migrations are
  applied by hand.
- **Accessibility is scanned, not certified.** Automated axe scans run in CI
  at phone and desktop widths, and they report failures rather than blocking a
  deploy. No screen-reader pass has been recorded, and the public
  accessibility statement says automated testing is "a floor, not a ceiling".
- **Some things are blocked, not skipped.** Six backlog items need credentials
  or partner agreements that do not exist (listed in `NEXT.md`).
- **The demo database is the e2e database.** It carries test fixtures such as
  *E2E — Ledger corrections* and *Demo — E2E Sandbox*, which appear in the
  facility switcher and on the Austin city page. They cannot be deleted
  because the audit log is append-only by design.
- **One known defect surfaced while writing this script.** The lease summary
  quotes the late fee from the facility's fee schedule ($20 at Austin South),
  while late fees are actually charged from the late-fee ladder, which the
  demo facilities do not have. A renter here signs a lease naming a fee that
  is never charged.

---

## The deployed site

`https://storage.labintelligence.co` answers `401` until you supply the shared
password (`DEMO_ACCESS_PASSWORD`, set in the Vercel project's environment
variables). It was seeded with `--no-logins`, so none of the passwords above
work there. Signing in means minting a reset link from a laptop with
`.env.prod-ops`, as described in
[DEPLOYMENT.md → Running a command against production](DEPLOYMENT.md#running-a-command-against-production).
That path was not re-run for this script. Use the local build to present.
