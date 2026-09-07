# Next

**The buildable queue is EMPTY. Every open row is blocked on you, not on code.**
([06-backlog.md](docs/prds/06-backlog.md))

B-265 shipped on 2026-09-07 (`0e8f611`). The Spanish move-in seam is closed:
nine `sendDirectEmail` sends (the row said six — the waitlist mail and the
broadcast were missed), four of them now Spanish for a Spanish reader, and
`locale` is a REQUIRED field on `DirectEmailInput` so a tenth caller cannot
ship without a language declaration (**D-130**).

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

**Two gaps named, neither owned by any row:**

- **The waitlist form's own screen copy is still English** —
  `joinWaitlistAction`'s two `FormState` messages and `joinWaitlist`'s three
  refusals. B-263/B-264's class, one surface neither reached. The mail that
  form produces is Spanish now, which makes the screen the odd one out.
- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language; **B-269's** three string-typed surfaces still
  lose their `lang` marking.

**Do not reverse without reversing a decision.** The direct-send locale rule is
three steps and lives in `writingLocale` (**D-130**). The platform alert, the
scheduled report and the broadcast are English on purpose (**D-122**, and the
broadcast is **D-129**'s operator half — it HAS `recipient.locale` and refuses
it). An operator's `termsText` is rendered as typed (**D-129**). The mailed
lien notice stays English (**D-127**). Template fallback is
English-rather-than-refuse (**D-126**). An unauthenticated checkout fills a
blank language and never overwrites a stated one (**D-128**).

**`grep` skips a file it decides is binary, and every source file here with an
em dash is binary under `LC_ALL=C`.** That is why B-265's row undercounted its
own call sites by two. Use `grep -a` when enumerating call sites; `file` calls
those same files "data", which is the tell.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:migrate:e2e`** before a Playwright run (B-265 added a migration).
**`npm run db:reset-test`** if the unit suite starts timing out.
**`--project=desktop-chrome`, not `chromium`.**
