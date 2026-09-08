# Next

**On `main` the buildable queue is empty. On THIS branch it is not:** **B-271**
(the `reportRange` rolling-window clock bug) and **B-273** (the staff mirror of
B-272) are open, buildable, and belong to no one yet. Everything else below is
blocked on you rather than on code.
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

**B-272 shipped on this branch, and it changes how a new page is added.** It is
the language-of-parts item, built and recorded under the number **B-269**
(`510e866`) and renumbered on the merge — `main` allocated B-269 to the
promotion terms above while the branch held it, and a merged number is
permanent where a branch's is not. Its commit messages still say B-269, because
history is not rewritten. Every public page now declares the language of its own
content: D-122 serves a Spanish visitor `<html lang="es">` on every route,
English pages included. Two rows came out of it — **B-273 (S)**, the staff
mirror (admin is English inside that same shell, and the template editor renders
Spanish bodies inside it), and **B-271 (S)**, the `reportRange` clock bug, which
has now been renumbered three times for the same reason.

**Four things B-272 leaves you, and the first two bind on any new page:**

- **`ProsePage` takes `lang` as a REQUIRED prop.** A new prose page states its
  language or fails `npm run typecheck`. English pages pass `lang="en"`;
  translated ones pass `lang={locale}`, which is a no-op in the accessibility
  tree and is the point — the prop records that somebody decided.
- **A public page either renders from the dictionary or is listed in
  `ENGLISH_UNDER_A_TRANSLATED_SHELL`** (`lib/a11y/scan-coverage.ts`) with
  `lang="en"` in its own markup; the walker in
  `tests/a11y-scan-coverage.test.ts` enforces both directions. **Translating a
  listed page means deleting its row AND its `lang="en"` together** — B-267 and
  B-272 crossed in exactly that way and the walker caught it on the merge, which
  is what it is for. **B-268 above is the next one**: `/reservations` is on that
  list today. Its "is this page translated" check matches `from '@/lib/i18n'`
  and NOT `@/lib/i18n/server`, deliberately — `/storage/[state]/[city]` reads
  the locale without rendering a translated string of its own.
- **Marking a MIXED page `lang="en"` at the top introduces the mirror defect.**
  `/storage/[state]/[city]` is the worked example: English prose around a
  translated search form, so the wrapper says `en` and the form's wrapper
  declares the shell language back. B-273 has the same shape on the template
  editor.
- **Axe cannot see a language-of-parts failure, and neither can the route
  loops.** No rule reads prose and decides what language it is in, and the loops
  carry no locale cookie, so every scan visits as an English visitor where the
  markup is trivially correct. If you are about to prove a language claim with a
  scan, you are about to write a green test that tests nothing — B-272's spec
  was pointed at a translated page first, and failed, before being pointed back.

**`docs/progress/21-from-b-268.md` is the current part** — part 20 passed 100 KB
and B-268's entry opened part 21. Append there until it passes ~90 KB.

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
