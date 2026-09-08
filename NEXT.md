# Next

**The buildable queue is now empty on this branch as well as on `main`.**
B-271 and B-273 both shipped on 2026-09-08 (`864e6f0`, `482abe6`). Every
remaining open row is blocked on you rather than on code.
([06-backlog.md](docs/prds/06-backlog.md))

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

**So the next session needs an answer before it needs a plan.** The two
cheapest to unblock are **D-111** (does `Tenant.email` stop being required and
unique? — B-238 is written for either answer, so the decision is the whole
cost) and **B-254**, which is not a decision at all but a person running a
screen reader through move-in and payment. B-254 converts the largest
unverified claim in this codebase into a verified one; no agent may tick it.

## What B-271 leaves you

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
  Audited under B-271 and deliberately left: it is a boundary
  MISCLASSIFICATION, not a blind spot — every row is still in exactly one
  window and consecutive ranges still tile, so a year sums. **No row owns it**,
  and fixing it reopens B-223's "which zone bounds a multi-zone month", which is
  a decision and not a build.

## What B-273 leaves you

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
  too, and outside B-273's scope.
- **Axe still cannot see any of this**, and neither can the route loops — they
  carry no locale cookie, so every scan visits as an English visitor where the
  markup is trivially correct. If you are about to prove a language claim with a
  scan, you are about to write a green test that tests nothing.

**Two gaps named, neither owned by any row:**

- **The waitlist form's own screen copy is still English** —
  `joinWaitlistAction`'s two `FormState` messages and `joinWaitlist`'s three
  refusals. B-263/B-264's class, one surface neither reached. The mail that
  form produces is Spanish now, which makes the screen the odd one out.
- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language; **B-269's** three string-typed surfaces still
  lose their `lang` marking.

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

- **`docs/progress/21-from-b-268.md` is the current part** (~37 KB). Append
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
  exit code, not the build's.** That is how B-271's entry came to claim a green
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
