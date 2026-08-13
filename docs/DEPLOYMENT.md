# Deploying

Written while setting the project up on Vercel for the first time. It records
what was verified and what was only reasoned about, because the difference
matters when something does not work.

## What is already true

- **`prisma generate` runs on install.** The client is build output in
  `node_modules/.prisma/client`, so a clean checkout has none until
  `postinstall` makes one. Verified by deleting the directory and installing
  from scratch.
- **The deployed functions load a Linux query engine, and two settings put it
  there.** `binaryTargets` in `schema.prisma` generates it, and
  `serverExternalPackages: ['@prisma/client']` in `next.config.ts` keeps the
  client out of the bundle so it can still find it — see the comments in both
  files. Getting either wrong breaks every runtime query in production while
  leaving the prerendered pages working, which is how it went unnoticed for a
  day. `/storage/search?q=<zip>` is the cheapest honest smoke test: it is
  dynamic, public, and hits the database.
- **The build needs a reachable `DATABASE_URL`.** The homepage is prerendered
  with `revalidate = 3600` and reads the facility registry, so the build
  connects to the database. That is deliberate — the facility list changes when
  a site opens, not between page views — and it means a build against an
  unreachable database fails rather than degrading. Verified: unsetting
  `DATABASE_URL` fails the build at `/`.
- **The cron endpoint already speaks Vercel's dialect.** Vercel Cron sends
  `Authorization: Bearer $CRON_SECRET` when that variable is set, which is
  exactly what `/api/cron` checks. It fails closed with no secret configured, so
  an unset variable means the jobs silently never run — check the first hour.
- **Everything optional degrades honestly.** No Stripe key means the payment
  step says "call us" instead of rendering a form that cannot submit; no
  `TWILIO_*` means SMS falls back to email; no `BLOB_READ_WRITE_TOKEN` means a
  proof-of-insurance upload is refused with a message while the policy details
  are still recorded; no `ACCESS_CODE_ENCRYPTION_KEY` means gate codes are
  issued but not revealable. None of these break a deploy.

## The plan, and why it matters

**Vercel Pro, from 2026-08-11.** Two things in this repo needed it, and both are
now settled rather than open:

1. **`vercel.json` schedules the cron hourly** (`0 * * * *`). Hobby limits cron
   to once a day, which would have broken the design rather than slowed it:
   nightly jobs run in **facility-local** time, and the hourly tick is what asks
   "which facilities have just reached their hour". A daily tick runs every
   facility's jobs at one UTC hour — invoices generated in the middle of the
   afternoon for half the portfolio, late fees assessed a day early or late
   depending on the season.
2. **`/api/cron` sets `maxDuration = 300`.** Hobby caps functions at 60s. The
   tick dispatches events and runs every due job for every facility, so it grows
   with the portfolio; 300s is the ceiling Pro allows and the code already asks
   for it.

Nothing in the code assumes Vercel — `runJob` and the registry are
provider-agnostic — so moving the scheduler elsewhere later costs a config
change, not a rewrite.

## Why `vercel.json` looks like that

Vercel rejects unknown properties in `vercel.json`, so it carries no comments
of its own. The three settings each exist for a reason:

- **`framework: "nextjs"`** — the repo root is not a Next.js app, so detection
  from the root `package.json` would otherwise come up empty.
- **`buildCommand: "npm run build"`** — the root script, which builds the web
  workspace. It is wrapped in `dotenv -e .env.local` locally; that file does not
  exist on Vercel and `dotenv-cli` tolerates its absence, so one command works
  in both places.
- **`outputDirectory: "apps/web/.next"`** — because the build runs from the
  repo root.

**Root Directory is deliberately left at the repo root**, not set to
`apps/web`. The workspace packages (`@storage/core`, `@storage/db`) resolve
from the root `node_modules`, and an install scoped to `apps/web` does not
create them — `postinstall`'s `prisma generate` writes into
`packages/db/generated`, which an `apps/web`-rooted install would never see.

## Order to do it in

1. **A separate Neon database for production.** Not the dev one: the test suite
   writes to `storage_test` in the same instance, `db:migrate:test` reseeds it,
   and several suites delete freely. Set both `DATABASE_URL` (pooled) and
   `DIRECT_URL` (direct) — migrations need the direct one because Neon's pooler
   rejects some startup parameters.
2. **`vercel link`** from the repo root, or Add New → Import Git Repository in
   the dashboard. Link to git rather than pushing files: a project created by a
   file push is not connected to the repo, and every later deploy is another
   manual push.
3. **Environment variables** (below).
4. **Deployment Protection on** before the first deploy. This app rents units
   and takes money; a public preview URL is not what you want while it is being
   set up.
5. **Preview deploy first.** Confirm it builds, the homepage renders, and
   `/messaging-policy` is reachable.
6. **Run migrations against production** — `prisma migrate deploy` with
   `DIRECT_URL` pointed at the production database. This is not part of the
   build, deliberately: a build that migrates is a build that can half-migrate.
7. **Bootstrap the first owner**: `npm run db:create-owner`. Nothing can create
   a staff account before this (D-12), and MFA enrolment is forced on first
   sign-in. It prints a reset link that **expires in 60 minutes**, and until
   `RESEND_API_KEY` is set there is no self-service way to get another —
   `/forgot-password` throws rather than silently dropping a sign-in link. If it
   lapses, re-issue with `npm run db:reset-link -- --email you@example.com`
   rather than creating a second owner.

## Environment variables

Required for the app to build and run:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string. |
| `DIRECT_URL` | Neon **direct** connection string; migrations use it. |
| `AUTH_SECRET` | `openssl rand -hex 32`. Rotating it invalidates every staff MFA enrolment and every signed token — set it once. |
| `AUTH_URL` | The deployment's own origin. |
| `CRON_SECRET` | `openssl rand -hex 32`. Without it the hourly jobs never run. |

Strongly recommended before anything real happens:

| Variable | Without it |
| --- | --- |
| `ACCESS_CODE_ENCRYPTION_KEY` | `openssl rand -hex 32`. Gate codes are issued but can never be revealed to staff or re-sent to a tenant. |
| `BLOB_READ_WRITE_TOKEN` | Proof-of-insurance uploads are refused (details still recorded). Created by adding a Blob store to the project. |
| `HARDWARE_WEBHOOK_SECRET` | Per-facility rotation supersedes this; it is the fallback for a site that has never rotated. |

Add only when you mean it:

| Variable | Notes |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **Test keys until there is a real facility.** Live keys are what turn a mistake into a chargeback. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Leave unset until the A2P 10DLC campaign is approved. SMS falls back to email meanwhile, which is the correct behaviour rather than a workaround. |
| `RESEND_API_KEY` | Real outbound email. |

## Twilio go-live (PENDING — campaign not yet approved)

SMS is built and dormant. Nothing here is a code change; it is all
configuration, and it is deliberately inert until the last step so an
unapproved campaign cannot send.

**Where it stands.** The A2P 10DLC campaign is submitted and not yet approved.
The published opt-in policy is live at `/messaging-policy`, and the double
opt-in it describes (text `JOIN` → we ask → reply `YES`) is implemented in
`/api/comms/sms-webhook`. With `TWILIO_*` unset, every SMS rule falls back to
email, which is the correct behaviour rather than a workaround — see
`deliverSmsForRule`.

**When the campaign is approved, in this order:**

1. **Env vars in Vercel** (Production):
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Adding these alone still sends
   nothing — step 3 is the switch.
2. **Inbound webhook** in the Twilio console, on the Messaging Service:
   `https://<your-domain>/api/comms/sms-webhook`.
   Twilio signs the **exact URL it was configured with**, so it must match byte
   for byte — scheme, host and path. A trailing slash or a proxy that rewrites
   the host breaks verification by Twilio's design, not by a bug here.
   `TWILIO_AUTH_TOKEN` must be set before this: the route fails closed without
   it, because a forged STOP would cut a tenant off from every message.
3. **Per-facility Messaging Service SID.** `Facility.smsMessagingServiceSid` is
   the actual on/off switch, set per site on the facility settings screen. Empty
   means that facility stays email-only. This is what lets one site go live
   without dragging the whole portfolio with it.
4. **Check the quiet-hours window** per facility if any state needs narrower
   than the 8am–9pm default (`smsQuietHoursStartHour`/`EndHour`). It applies to
   every message, not only marketing.
5. **Round-trip it from a real handset** before telling anybody it works:
   - text `JOIN` → expect the confirmation *request*, and no subscription yet
   - reply `YES` → expect the welcome message, and a `granted` Consent row
   - reply `STOP` → expect one confirmation, and every SMS to that number to
     stop, transactional included
   - reply `HELP` → expect identification and a contact number

   A number the system does not recognise should be told so rather than
   confirmed. That reply is the one a carrier audit would read as proof of
   consent, and there must be none behind it.

**Also still placeholder:** `SITE.phone` is `(512) 555-0100`. It no longer
appears on the messaging policy, but it is the fallback office number across the
public site and portal.

## After the first deploy

- Point Twilio's campaign at `https://<your-domain>/messaging-policy` rather
  than a hosted screenshot, and set the inbound-message webhook to
  `https://<your-domain>/api/comms/sms-webhook`. Twilio signs against the exact
  configured URL, so it must match byte for byte.
- Check `/admin/access/health` and the billing-runs screen after the first
  scheduled hour: a cron that never fires looks like nothing at all.
