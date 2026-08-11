# Deploying

Written while setting the project up on Vercel for the first time. It records
what was verified and what was only reasoned about, because the difference
matters when something does not work.

## What is already true

- **`prisma generate` runs on install.** `packages/db/generated/` is gitignored
  (it is build output, and committing a per-platform engine binary is worse
  than regenerating it), so a clean checkout has no Prisma client until
  `postinstall` makes one. Verified by deleting the directory and installing
  from scratch.
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

## Two things to check against your Vercel plan

Both are believed true of Vercel's plans as of writing and are worth confirming
rather than taking on trust — plan limits change:

1. **`vercel.json` schedules the cron hourly** (`0 * * * *`). Hobby has
   historically limited cron to once per day. Nightly jobs run in
   facility-local time, so the hourly tick is what asks "which facilities have
   just reached their hour" — a daily tick would run every facility's jobs at
   one UTC hour, which is the thing the design avoids.
2. **`/api/cron` sets `maxDuration = 300`.** Hobby has historically capped
   functions at 60s. The tick dispatches events and runs every due job for
   every facility, so it will grow past 60s well before it grows past 300s.

If Hobby is the plan, expect to either upgrade or move the scheduler off Vercel
Cron. Nothing in the code assumes Vercel — `runJob` and the registry are
provider-agnostic.

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
   sign-in.

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

## After the first deploy

- Point Twilio's campaign at `https://<your-domain>/messaging-policy` rather
  than a hosted screenshot, and set the inbound-message webhook to
  `https://<your-domain>/api/comms/sms-webhook`. Twilio signs against the exact
  configured URL, so it must match byte for byte.
- Check `/admin/access/health` and the billing-runs screen after the first
  scheduled hour: a cron that never fires looks like nothing at all.
