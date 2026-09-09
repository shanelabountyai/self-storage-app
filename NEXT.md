# Next

**The buildable queue is empty.** B-274 was the only row on it and it shipped
(`2822230`). Nothing below is a build session's to start without either an
owner decision, a credential, or a new review pass.

## The choice for the next session

**A seventh review pass is the only thing that produces buildable rows.** The
last was 2026-08-25 (B-187–B-196) for the reviewer block; B-224–B-251 on
2026-09-01 was the sixth. Everything from B-197 on came from a reviewer report
or a previous item's left-behind note, and B-274 came from an ANSWER — a
provenance that has happened exactly once and cannot be relied on twice.

Run the three reviewers (`storage-operator`, `ux-reviewer`,
`accessibility-reviewer`) over **B-252 onward** and hand the findings to
`product-owner` to write as rows, the way the six previous blocks were built.
Each reviewer declares its own model tier; do not let them inherit Opus.

## One real gap this item found, and it needs an owner decision

**`db:migrate:cloud` now refuses with P3005 — "the database schema is not
empty".** The Neon dev branch has a schema and no `_prisma_migrations`
baseline, so `migrate deploy` will not write a first row into it. This is not
new and B-274 did not cause it: it is the same condition B-272 recorded as "the
116 the `.env.local` half reports as unapplied", presenting as an error instead
of a count now that there is a migration to apply.

**Nothing was done about it, deliberately.** Baselining is a deliberate act
against shared cloud infrastructure and is precisely what B-253 exists to stop
happening as a side effect of an ordinary item. It wants a D-number and a row,
not a keystroke at a prompt. Local (`storage_test` schema) and e2e (`public`)
both carry `20260909224550_auction_sale_manner`.

## The blocked list is still five, plus B-129

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace driver | partner agreement | credentials |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**B-254 is still the most valuable thing on this list and still not mine to
do.** A person runs a screen reader through move-in and payment; no agent may
tick it.

## What B-274 learned

**A row can pre-decide its refusals and still leave the interesting judgement
open.** The row said a null venue is "a refusal, not a blank" and named
`auctionReadiness` and `/admin/auctions` as the surfaces — it did not say what
the NOTICE does in that state. The answer is that it renders the old hedge word
for word, because the refusal belongs on the sale rather than on a pre-lien
notice for a half-configured facility, and because readiness blocking is what
guarantees the hedge can never be the last thing a tenant is told. That is
recorded in `PROGRESS.md` rather than left to be re-derived.

**A required field on an input type is a gate a test cannot be.** Making
`saleManner`/`saleVenue` required on `ReadinessInput` rather than optional is
what stops a future caller failing open into the exact silence this row closed
— and the compiler then named the single fixture that needed updating.
