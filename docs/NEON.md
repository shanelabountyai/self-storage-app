# Neon: the region check, and what each outcome means

Two lookups, about two minutes. Nothing in this repo pins a region on either
side, so both are on defaults — which is exactly how a mismatch goes unnoticed.

## Why this is worth doing before spending anything

`packages/db/index.ts` raises Prisma's interactive-transaction limits from the
2s/5s default to **10s/20s**, and the comment says why:

> This one is Neon, over the network, where a round trip costs tens of
> milliseconds — and the longest transactions here (`completeMoveOut` settles a
> lease, posts the ledger, releases the unit, recomputes its status and closes
> the verification task) make eight or nine of them.

**Tens of milliseconds per round trip is not normal for co-located Vercel and
Neon.** Same-region is low single digits. Nine round trips at 2ms is 18ms; at
30ms it is 270ms — inside a transaction holding `FOR UPDATE` rows on a unit
somebody is trying to rent. Paying Neon more money does not fix geography.

## The two lookups

1. **Vercel** → the `self-storage-app` project → Settings → Functions →
   **Function Region**. Default for a US account is `iad1` (Washington DC,
   us-east-1).
2. **Neon** → the production project → Settings, or just read the host in
   `DATABASE_URL`. The region is in the hostname:
   `…us-east-2.aws.neon.tech` is Ohio, `…us-east-1…` is Virginia.

Nothing in the repo sets either: no `regions` key in `vercel.json`, no
`preferredRegion` export anywhere under `apps/` or `packages/`.

## What each outcome means

| Result | What it means | What to do |
|---|---|---|
| **Same region** | The latency comment is describing pooler and TLS overhead, not geography. The 10s/20s ceiling is doing real work and should stay. | Nothing. Move on to the plan question below. |
| **Different regions** | Every one of those eight or nine round trips is paying a cross-region hop. This is the single biggest performance win available, and it is a settings change. | Move the Vercel functions to Neon's region (cheaper than moving the database). Then re-measure a `completeMoveOut`. |

After changing it, smoke-test with something **dynamic**, not the homepage —
most pages here are prerendered and query at build time, so they render fine
from a deployment whose every runtime query throws:

```bash
curl -o /dev/null -w '%{http_code}\n' "$SITE/storage/search?q=78704"
```

## The separate plan question

Independent of region. Current published rates: Launch is **$0.106/CU-hour**
compute plus **$0.35/GB-month** storage, no monthly minimum since December
2025. Free gives 100 CU-hours per project per month and **0.5 GB storage**.

Three reasons free is not viable for production here, all from this repo rather
than general advice:

1. **`audit_log` can never be pruned.** Its append-only trigger refuses UPDATE,
   DELETE and TRUNCATE with no in-band override, so the table grows forever.
   0.5 GB is a countdown, not a limit you might avoid.
2. **The hourly cron defeats scale-to-zero.** `vercel.json` schedules
   `/api/cron` at `0 * * * *`; free computes suspend after 5 minutes idle, so
   that is 24 wakeups a day before any customer traffic.
3. **`maxDuration = 300` on a tick that grows with the portfolio.** Free caps
   autoscale at 2 CU. The cron is the workload most likely to want headroom and
   the one that cannot ask for it on free.

Estimated cost at current scale: **~$19/month** with autosuspend off (730h ×
0.25 CU × $0.106), **~$6** with it on, plus ~$1–2 storage. Keep it warm — a
cold start on the checkout page at 3am is the most expensive place to save $13.

Do not go to Scale. It is 2× the compute rate for capacity there is no evidence
of needing.

## The bonus worth taking

Neon branches are copy-on-write and create in seconds. `storage_test`
accumulated 13,106 facilities because `audit_log`'s RESTRICT foreign keys plus
its trigger make `TRUNCATE … CASCADE` on `facility` fail, so no suite can clean
up after itself and the only remedy is `npm run db:reset-test` on the whole
schema. A branch per CI run is disposable by construction, which turns that
from a recurring chore into a non-issue.

---
Rates above were read from search results, not from neon.com — that domain is
blocked by this session's egress proxy. Confirm on the pricing page before
committing.
