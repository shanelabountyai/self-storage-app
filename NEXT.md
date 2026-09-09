# Next

**Pick up B-274.** It is the only buildable row and it did not exist yesterday.
([06-backlog.md](docs/prds/06-backlog.md), row `83aa`)

The 2026-09-09 session found the queue empty and asked; the owner answered
**master PRD §8 OQ-9 — the auction channel — as online, with the manner of sale
a per-facility setting (D-131)**. No code shipped. What the answer produced is
one row, and it needs no credentials, no partner and no decision.

## B-274 — nothing in the product says where a unit will be sold

`EXAMPLE_SALE_STATEMENTS` in `packages/core/notices/templates.ts` hedges the
whole consequence to *"the property may be advertised and sold to satisfy the
lien... governed by state law"*, and **no field in the schema carries a sale
venue**. Correct about the law, useless to the person receiving it: a tenant who
wants to attend, bid, or send a relative to buy their own property back cannot
learn from anything this product mails them whether the sale is at the facility
on a Saturday or on a website — and if a website, which one.

**Build:** `Facility.auctionSaleManner` (`online` | `live_onsite`, seeded
`online`) plus a venue string the `online` value requires, with its control on
`/admin/settings/delinquency` beside `auctionSaleTerms` — same page, same item,
because a column that configures behaviour ships with its form field. Two
consumers, both silent today: the pre-lien and lien `saleStatement`, and the lot
sheet (`/admin/auctions/lots.csv`).

**Three things the row must not do**, and they are in the row text:

1. **No marketplace driver.** B-129 stays open on the partner agreement, D-63
   stands, advertising stays `AuctionAdvertisement` rows a person types.
2. **`live_onsite` is not a degraded branch.** D-131 kept it first-class; a
   single-facility operator running their own sale is a supported answer.
3. **A null venue on an `online` facility is a refusal, not a blank.** A notice
   naming no site is worse than the hedge it replaces, so `auctionReadiness`
   gains the check and `/admin/auctions` names the facility — the same way it
   already names every other dropped-lot blocker.

Every word of the new statement is draft legal text under D-10 and keeps the
attorney-review caveat.

## The blocked list is six rows, and B-129 lost one of its two blockers

D-131 answered OQ-9, so B-129 kept only the harder blocker — the partner
agreement. The count in this heading was `five now, not six` on `main` and the
table under it had six rows then too; corrected here rather than carried.
Still not a build session's to start:

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace driver | partner agreement (OQ-9 no longer) | credentials |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**B-254 is still the most valuable thing on this list and still not mine to do.**
A person runs a screen reader through move-in and payment; no agent may tick it.

After B-274 the queue is empty again. **A seventh review pass is the only thing
that produces buildable rows** — the last was 2026-08-25 (B-187–B-196), and
everything from B-197 on came from a reviewer report or a previous item's
left-behind note.

## Renumbered on the 2026-09-09 merge — B-271/272/273 here are not `main`'s

This branch and `main` both filed rows 271-274 while neither could see the
other, and all four numbers mean different things on the two sides. `main` is
merged history, so it keeps them and this branch moved:

| was, on this branch | is now | `main`'s row of that number is |
|---|---|---|
| B-271 — a live log that ends in the past | **B-275** | the walk-in counter naming the account |
| B-272 — English contract prose under `lang="es"` | **B-276** | the two carried gaps nobody owned |
| B-273 — the staff mirror of the language-of-parts fix | **B-277** | a one-field refusal announcing a count |
| B-274 — the waitlist form in the reader's language | **dropped** | where a unit will be sold (the row above) |

**B-274 was dropped, not renumbered.** `main` had already built the same thing
as **B-270** (`5cfe382`), with a different key namespace; the duplicate that
goes is the one on the branch. The fourth time this branch has paid for
parallel numbering, and the second time it has dropped work over it.

## What B-275 leaves you

**`reportRange`'s two default windows are reckoned against OPPOSITE ends of the
portfolio, and that is deliberate.** `last-complete-month` takes the earliest
local date (westernmost — "has this period finished everywhere?"), and
`rolling-30-days` takes the LATEST, with UTC among the candidates ("does this
window still hold what just happened?", answered in the coordinate the rows are
stored in). A future reader will want to "fix" the inconsistency. It is not one,
and `DefaultWindow`'s doc comment says so at the point of the decision.

- **A live log's exclusive end must be strictly after `now`, and that is the
  property to assert** — not a particular date at a particular instant. The old
  code added a day to a LOCAL date and let the result be read as a UTC instant,
  so for 00:00–05:00 UTC in Texas the end was already in the past and
  `/admin/impersonation`, its `.csv` and `/admin/access` hid the rows the
  operator opened them to see.
- **A clock bug that is invisible 19 hours out of 24 looks exactly like a
  flake.** One red CI run was the only evidence for weeks. If a suite fails
  overnight and passes in the morning against the identical commit, that is the
  signature, not a flake.
- **A regression test for this class needs BOTH a facility zone AND a `now`
  inside the band.** Either alone goes green against the unfixed code — which is
  exactly why the old suite (no zones, 18:30 UTC) could not see it. With no
  zones the list falls back to `UTC`, the single configuration in which the old
  arithmetic was right.
- **`last-complete-month` still bounds a LOCAL month with UTC midnights**, so
  for a US portfolio the last few local hours of a month report in the next one.
  Audited under B-275 and deliberately left: it is a boundary
  MISCLASSIFICATION, not a blind spot — every row is still in exactly one
  window and consecutive ranges still tile, so a year sums. **No row owns it**,
  and fixing it reopens B-223's "which zone bounds a multi-zone month", which is
  a decision and not a build.

## What B-277 leaves you

**Every admin screen is English inside `<html lang="en">` now, declared once on
`app/admin/layout.tsx`.** That single attribute is load-bearing for the whole
surface, and `tests/a11y-scan-coverage.test.ts` fails if it is deleted.

- **A new admin page that renders from the dictionary must be listed in
  `TRANSLATED_UNDER_THE_ADMIN_SHELL` and declare `lang={locale}` on the
  translated parts.** The walker checks for a DYNAMIC `lang`, not a literal — a
  `lang="en"` on a mixed page is the mirror defect, which is the whole point of
  the third `why` value, `mixed`.
- **The guard has a stated blind spot: it reads `page.tsx` only.** An admin page
  rendering a translated CHILD COMPONENT without importing `@/lib/i18n` itself
  passes while announcing Spanish under `lang="en"`. `StatementView` is that
  shape and is safe **only** because B-260 gave its `dict` prop an English
  default — **that default is now load-bearing for SC 3.1.2, not just for copy.**
  Named in `scan-coverage.ts`; owned by no row.
- **`/mfa`, `/login` and the other staff-reachable routes outside `app/admin`**
  are under no shell declaration. Different route groups, reached by tenants
  too, and outside B-277's scope.
- **Axe still cannot see any of this**, and neither can the route loops — they
  carry no locale cookie, so every scan visits as an English visitor where the
  markup is trivially correct. If you are about to prove a language claim with a
  scan, you are about to write a green test that tests nothing.

**One gap named, owned by no row:**

- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language; **B-269's** three string-typed surfaces still
  lose their `lang` marking.

## What answering OQ-9 learned

**An open question can hide a gap that has nothing to do with the question.**
OQ-9 asked which channel; the product's actual defect was that it names no
channel at all, to anybody, ever. Three items (B-062, B-083, B-129) built
around that question and none of them noticed the notice was silent, because
each was checking whether it could answer OQ-9 rather than what OQ-9's absence
was costing. **The row a decision unblocks is not always the row it was blocking.**

**B-129's own row cited the wrong PRD section for two weeks.** It said "master
PRD §11 OQ-9"; the open questions are §8 and there is no §11. Corrected in the
row and in the numbering note. Nobody followed the reference, which is the
point — a citation that is never checked is a citation that can be wrong.

## Do not reverse without reversing a decision

`ProsePage` takes `lang` as a REQUIRED prop. A public page either renders from
the dictionary or is listed in `ENGLISH_UNDER_A_TRANSLATED_SHELL` with
`lang="en"` in its own markup, and **translating a listed page means deleting
its row AND its `lang="en"` together**. The direct-send locale rule is three
steps and lives in `writingLocale` (**D-130**). The platform alert, the
scheduled report and the broadcast are English on purpose (**D-122**, and the
broadcast is **D-129**'s operator half — it HAS `recipient.locale` and refuses
it). An operator's `termsText` is rendered as typed (**D-129**). The mailed
lien notice stays English (**D-127**). Template fallback is
English-rather-than-refuse (**D-126**). An unauthenticated checkout fills a
blank language and never overwrites a stated one (**D-128**).

## Container and tooling notes

- **`docs/progress/21-from-b-268.md` is the current part** (~73 KB after the
  2026-09-09 merge carried five of `main`'s entries in). Append
  there until it passes ~90 KB.
- **Postgres is not running in a fresh session container** — `db:migrate:test`
  fails with `P1001` before anything else can run, and `service postgresql
  start` is the whole fix. The `storage_test` database and the `ci` role
  already exist.
- **`npm run build` cannot run as scripted in a fresh container.** It is
  `dotenv -e .env.local -- next build`, and `.env.local` is gitignored and
  absent, so the build dies prerendering `/` on `Environment variable not
  found: DATABASE_URL`. Use `npx dotenv -e .env.test -- npm run build -w web`,
  which exits 0 and renders all 106 pages.
- **A backgrounded `npm run build > log; echo "EXIT: $?"` reports the `echo`'s
  exit code, not the build's.** That is how B-275's entry came to claim a green
  build over a log that said `code 1`; the entry is corrected in place. Read the
  log, not the completion notice.
- **Run `npm run db:migrate:test` after switching branches** — the comms catalog
  is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
  **`npm run db:migrate:e2e`** before a Playwright run.
  **`npm run db:reset-test`** if the unit suite starts timing out.
  **`--project=desktop-chrome`, not `chromium`.**
- **`grep` skips a file it decides is binary, and every source file here with an
  em dash is binary under `LC_ALL=C`.** Use `grep -a` when enumerating call
  sites; `file` calls those same files "data", which is the tell.
