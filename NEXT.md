# Next

**The buildable queue is EMPTY again. Every open row is blocked on you, not on
code.** ([06-backlog.md](docs/prds/06-backlog.md))

B-238 shipped on 2026-09-09 (`017d77f`). **D-111 is answered (A)** and recorded
in `07-decisions.md`: `Tenant.email` is nullable and non-unique, the counter
accepts a blank address with a `hint` naming what the renter loses (SC 3.3.2),
and the comms layer opens a `no_reachable_channel` task instead of writing a
`failed` row nobody reads.

**Six rows remain and not one of them is a build session's to start:**

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace listing | Master PRD §11 **OQ-9, open** | owner decision |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**The cheapest decision left is gone, so the next one is not cheap.** D-111 was
the one a build session could act on the moment you answered it. What is left
is **B-254**, which is not a decision at all: it is a person running a screen
reader through move-in and payment. It converts the largest unverified claim in
this codebase into a verified one, and **no agent may tick it**.

**Three gaps are open and NO ROW OWNS ANY OF THEM.** Named here because each
was named on the item that created it and would otherwise only exist in
`PROGRESS.md`:

- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language, and **B-269's** three string-typed surfaces
  still lose their `lang` marking. Carried unchanged since B-265.
- **B-238 left three of its own**, and the third is the one to watch: phone and
  postal are the alternative contact of record *in the decision* but nothing
  routes to them (a tenant with no email gets a task, not a letter); there is no
  sweep for existing `nobody@example.com` placeholders and none is proposed; and
  **the counter does not warn when it creates a SECOND tenant on an address
  already in use**, even though the consequence is that neither of them can then
  sign in.

## What B-238 learned

**The typechecker is what enumerates a blast radius — use it as the tool, not
as the gate.** The row required every reader of `Tenant.email` be enumerated
before sizing. Making the column nullable and running `npm run typecheck`
produced exactly that list: 19 errors across auth, checkout, comms, broadcast,
billing accounts, referrals, Stripe customers, portal transfer, rate increases,
the admin tenant types and the demo seed — then 23 more in `tests/`, which only
exist because `tsconfig.tests.json` covers the repo-root test directories.
Grepping for `tenant.email` found 39 sites and would have missed the ones
reached through a type.

**The dangerous fix in a "make it nullable" change is the one that looks like
reuse.** Two of them here: matching a BLANK address against existing tenants
(every no-email renter matches every other one, so they collapse into a single
tenant holding all of their leases), and resolving a SHARED address with
`findFirst` (signs somebody into their spouse's account). Both pass a test that
counts rows. The tests assert distinct ids and a null resolution instead.

## Do not reverse without reversing a decision

**D-111 is settled and is not to be re-opened.** Email stays REQUIRED on the
public checkout (FR-5.1) and is optional only where the session carries
B-230's `walk_in` stamp. A shared address resolves to nobody at sign-in. A blank
address always creates and never links. **Two refusals are POLICY now that the
schema no longer enforces them** — the portal's email-change screen and
`existingTenantByEmail` — and both are commented as such; deleting either
because "the constraint is gone" is the reversal to guard against.

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
It is also what a new migration needs before the unit suite will pass: B-238's
first run failed as `Null constraint violation on the fields: (email)`, which
reads like a broken schema and is a schema that was never migrated.
**`npm run db:migrate:e2e`** before a Playwright run.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`--project=desktop-chrome`, not `chromium`.**
