# Next

**The buildable queue is EMPTY again. Every open row is blocked on you, not on
code.** ([06-backlog.md](docs/prds/06-backlog.md))

B-270 shipped on 2026-09-09 (`5cfe382`). The waitlist form speaks the language
of the page around it: ten strings, `JoinResult.problem` is a `FieldMessage`
rather than a sentence, and the three success messages the action's own comment
claimed were identical actually are now — one dictionary key.

**One of the two gaps B-265 named is closed. The other is not, and no row owns
it:** B-268's live confirmation state of `/reservations` has still never been
axe-scanned in either language, and B-269's three string-typed surfaces still
lose their `lang` marking.

**Seven rows remain and not one of them is a build session's to start:**

| Row | Blocked on | Kind |
|---|---|---|
| **B-238** — a renter with no email cannot be leased | **D-111, OPEN** | owner decision |
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace listing | Master PRD §11 **OQ-9, open** | owner decision |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**So the next session needs an answer before it needs a plan.** The two cheapest
to unblock are unchanged: **D-111** (does `Tenant.email` stop being required and
unique? — B-238 is written for either answer, so the decision is the whole cost)
and **B-254**, which is not a decision at all but a person running a screen
reader through move-in and payment. B-254 converts the largest unverified claim
in this codebase into a verified one; no agent may tick it.

## What B-270 learned, because it cost a red spec

**`keyedFieldError` is wrong for a one-field form, and it looks right.** It
counts fields to build its summary, so `message` becomes "There is a problem
with one field." and the sentence that says what to DO survives only in
`fieldErrors`. A form whose `role="status"` region announces `message` — this
one, and `applyPromoAction`'s promo box — therefore trades 3.3.3 away for a
count. `checkout/actions.ts:497` already documented this and B-270 re-derived it
from a failing spec instead of reading it. **Typecheck, lint, `npm run build`
and 4,392 unit tests were all green with that regression in place**;
`smoke.spec.ts:1664` was the only thing in the repo that caught it. Use the
helper on multi-field forms; resolve the key once and give both halves the same
sentence on single-field ones.

## Do not reverse without reversing a decision

The direct-send locale rule is three steps and lives in `writingLocale`
(**D-130**). The platform alert, the scheduled report and the broadcast are
English on purpose (**D-122**; the broadcast is **D-129**'s operator half). An
operator's `termsText` is rendered as typed (**D-129**). The mailed lien notice
stays English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). B-270 adds no D-number: every choice it
made follows D-122 or D-130.

## Traps that are still live

**`grep` skips a file it decides is binary, and every source file here with an
em dash is binary under `LC_ALL=C`.** Use `grep -a` when enumerating call
sites. B-265's row undercounted itself by two this way; B-270's inherited
description undercounted the surface by a whole component (it named two action
messages; `en.ts` had no `waitlist.` key at all).

**A bare `prisma migrate diff` against `.env.local` reports phantom drift.**
That is the Neon dev branch, which is empty of all 115 migrations by design
(CLAUDE.md, B-253) — it reports the two `preferredLocale` columns as missing.
Diff against `.env.test` for the meaningful local answer; CI writes its own
`.env.local` at a throwaway container and is unaffected.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:migrate:e2e`** before a Playwright run.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`--project=desktop-chrome`, not `chromium`.**
