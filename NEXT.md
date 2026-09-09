# Next

**The buildable queue is EMPTY again. Every open row is blocked on you, not on
code.** ([06-backlog.md](docs/prds/06-backlog.md))

B-271 shipped on 2026-09-09 (`c31f85c`). It took the last thing a build session
could reach without you: the code half of D-111 that B-238 left, where the
counter silently attached a walk-in's lease to whoever already held their email
address, and where the second account on one household inbox — the state the
unique constraint was dropped FOR — could not be created by any path in the app.

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

**Two gaps are open and NO ROW OWNS EITHER.** Named here because each was named
on the item that created it and would otherwise only exist in `PROGRESS.md`:

- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language, and **B-269's** three string-typed surfaces
  still lose their `lang` marking. Carried unchanged since B-265.
- **B-238's** first two survive B-271. Phone and postal are the alternative
  contact of record *in the decision* but nothing routes to them — a tenant with
  a genuinely blank address gets a task, not a letter — and there is no sweep for
  existing `nobody@example.com` placeholders and none is proposed. **B-238's
  third gap is closed by B-271**, and closing it found that the gap as written
  described an unreachable state; the real defect was the inverse.

## What B-271 learned

**A "left behind" note names the symptom its author could see, not necessarily
a reachable state.** B-238 recorded "the counter does not warn when it creates a
SECOND tenant on an address already in use". Grepping `tenant.create` across
`apps` and `packages` returns exactly ONE site outside the demo seed, and it
links to the oldest holder before it would ever create — so nothing in the
product could produce that state. The reachable defect was the inverse and worse:
the counter *linked*, silently, and put the walk-in's lease, ledger and gate code
on the spouse's account. **Trace the note to a call site before sizing the row.**

**Two guards can each be correct and still leave a decision unkeepable.**
`findAccount` and `existingTenantByEmail` both handle a shared address correctly
and both were written by B-238 — for a state nothing could reach. Dropping a
constraint removes the enforcement; it builds nothing that uses the freedom.

## Do not reverse without reversing a decision

**D-111 is settled and is not to be re-opened**, including B-271's four choices
under it, each commented where it lands: the **name** is what separates a
returning renter from a second person (a confirm on every repeat move-in is a
confirm that gets clicked through); `separateAccount` is the ONE thing that makes
a known address create instead of link, and is reachable only from a session that
came back through the confirm step; the whole branch is gated on the SESSION's
`walk_in` stamp, never on a form field, **because the echo names an existing
tenant and the public form is unauthenticated**; and two people of the SAME name
on one inbox still link, which is the status quo and not a regression.

Email stays REQUIRED on the public checkout (FR-5.1). A shared address resolves
to nobody at sign-in. A blank address always creates and never links. **Two
refusals are POLICY now that the schema no longer enforces them** — the portal's
email-change screen and `existingTenantByEmail` — and both are commented as such;
deleting either because "the constraint is gone" is the reversal to guard against.

The direct-send locale rule is three steps and lives in `writingLocale`
(**D-130**). The platform alert, the scheduled report and the broadcast are
English on purpose (**D-122**; the broadcast is **D-129**'s operator half). An
operator's `termsText` is rendered as typed (**D-129**). The mailed lien notice
stays English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). A business-account member may look and not
pay (**D-120**).

## Traps that are still live

**`keyedFieldError` is wrong for a one-field form, and it looks right.** It
counts fields to build its summary, so `message` becomes "There is a problem
with one field." and the sentence saying what to DO survives only in
`fieldErrors`. A form whose `role="status"` region announces `message` trades
3.3.3 away for a count. Resolve the key once and give both halves the same
sentence (`checkout/actions.ts:497`).

**`grep` skips a file it decides is binary, and every source file here with an
em dash is binary under `LC_ALL=C`.** Use `grep -a` when enumerating call sites.

**A bare `prisma migrate diff` against `.env.local` reports phantom drift.**
That is the Neon dev branch, empty of all 116 migrations by design (CLAUDE.md,
B-253). Diff against `.env.test` for the meaningful local answer.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
It is also what a new migration needs before the unit suite will pass.
**`npm run db:migrate:e2e`** before a Playwright run.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`--project=desktop-chrome`, not `chromium`.**
