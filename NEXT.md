# Next

**The buildable queue is EMPTY again. Every open row is blocked on you, not on
code.** ([06-backlog.md](docs/prds/06-backlog.md))

B-272 shipped on 2026-09-09 (`e624977`). It took the two gaps this file had
carried for four items under the heading "no row owns either" — B-269's
string-typed surfaces that lost an operator's `lang` marking, and B-268's
never-axe-scanned live confirmation state of `/reservations`. **Both are
closed, and this file no longer carries an unowned-gap section.**

**Six rows remain and not one of them is a build session's to start:**

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace listing | Master PRD §11 **OQ-9, open** | owner decision |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**The cheapest one to unblock is B-129**, because OQ-9 is a decision you can make
at a desk. **The most valuable is B-254**, which is not a decision at all: it is a
person running a screen reader through move-in and payment, and it converts the
largest unverified claim in this codebase into a verified one. **No agent may
tick it.**

**One gap is open and no row owns it**, named here because it would otherwise
only exist in `PROGRESS.md`:

- **`keyedFieldError` is wrong for a one-field form** (`form-state.ts:85`). It
  counts entries to pick its summary, so one field error makes `message` read
  "There is a problem with one field." and the sentence saying what to DO
  survives only in `fieldErrors` — 3.3.3 traded for a count. **Three call sites
  already route around it with comments explaining why**, which is the tell that
  it is a defect rather than a style. B-272 deliberately did not ride it in: it
  is a different helper on a different criterion and deserves its own row. This
  is the one buildable thing on this page.

## What B-272 learned

**A "left behind" note names what its author could see from where they were
standing — and that is the SECOND time in three days.** B-271 found B-238's note
described an unreachable state. B-272 found B-269's note undercounted: it said
three surfaces and there were four, because it counted the ones on the checkout
it had just edited and missed `promo-code-entry.tsx` on the facility page beside
it. **Grep the call sites before believing the number**, and use `grep -a` — a
source file with an em dash is binary under `LC_ALL=C` and is skipped silently.

**A row's own sizing can be the thing keeping it unbuilt.** B-269 sized this as
"turning `FormState` into nodes is a change to the form machinery every admin
screen shares", and that framing is why it sat. It was not what the fix needed:
`message` stayed a string and an OPTIONAL `messageParts` sits beside it, so no
other action in the app was touched. **Re-derive the change before accepting the
estimate that deferred it.**

**A coverage claim can be true by accident for four months.** `/reservations`
counted as scanned since B-090 — as `?token=not-a-real-token`, the dead link.
The live page a renter actually ends a reservation on had never met axe. Both
live states passed with no violations, so the gap was in the claim, not the
markup, which is exactly the failure `scan-coverage.ts` exists to make visible.

## Do not reverse without reversing a decision

**`FormState.message` is a string on purpose.** It is what `announceOutside`
hands to `AnnounceRegion` as plain text and it crosses the server-action
boundary. `messageParts` is additive and optional, and **joining the parts must
reproduce `message` exactly** — `tests/i18n.test.ts` pins it, because a live
region announcing one sentence while the page shows another is worse than the
unmarked English it would be fixing. Widening `message` to a node is the
reversal to guard against.

**Both `/reservations` scan entries are `layout: 'excepted'` with a stated
reason** (B-246's rule). Promoting either to `'reached'` means a second
reserve-and-cancel cycle in a third file for a single-column page whose
container the four public loops already measure.

**D-129 is settled**: an operator's `termsText` is rendered as typed and marked
`lang="en"`, never given a column per language. **D-111 is settled**, including
B-271's four choices under it. Email stays REQUIRED on the public checkout
(FR-5.1); the portal's email-change refusal and `existingTenantByEmail` are
POLICY now that the schema no longer enforces them, and both are commented as
such. The direct-send locale rule lives in `writingLocale` (**D-130**). The
platform alert, the scheduled report and the broadcast are English on purpose
(**D-122**, **D-129**). The mailed lien notice stays English (**D-127**).
Template fallback is English-rather-than-refuse (**D-126**). An unauthenticated
checkout fills a blank language and never overwrites a stated one (**D-128**).
A business-account member may look and not pay (**D-120**).

## Traps that are still live

**`grep` skips a file it decides is binary, and every source file here with an
em dash is binary under `LC_ALL=C`.** Use `grep -a` when enumerating call sites.
This cost B-269 a surface and B-265 two.

**A bare `prisma migrate diff` against `.env.local` reports phantom drift.**
That is the Neon dev branch, empty of all 116 migrations by design (CLAUDE.md,
B-253). Diff against `.env.test` for the meaningful local answer.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
It is also what a new migration needs before the unit suite will pass.
**`npm run db:migrate:e2e`** before a Playwright run.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`--project=desktop-chrome`, not `chromium`.**

**The reliable tell that an e2e run had its env is npm's echoed `dotenv -e
.env.test -e .env.local`, not the presence of `[e2e setup]` lines** — those
print only when something stale was actually released (B-269's correction).
