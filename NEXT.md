# Next

**B-269 — a promotion's own terms are English inside every Spanish sentence
that quotes them.**
([06-backlog.md](docs/prds/06-backlog.md))

B-268 shipped on 2026-09-07 (`5f60cab`). `/reservations` — the confirmation a
Spanish hold redirects to and the page the emailed cancel link lands on — reads
in Spanish, expiry date included. Two rows are open from this seam.

1. **B-269 (M)** — the recommendation, and the one the last three sessions each
   pushed forward. `promo.codeApplied` renders «Código aplicado: 50% off the
   first month». **It is NOT B-263's shape**, which is why it is its own row:
   `termsText` is an operator's free text in a database column, so there is no
   key to return for it. Only the GENERATED half (`describeTerms` +
   `withMinStay`, both discriminated unions already) can take that shape, and
   whether a per-language terms column exists at all is an owner decision with a
   D-number. **Three surfaces read it and the badges are the biggest** — every
   unit card on a translated facility page, not the one message B-266 touched.
   `formatCents` inside `describeTerms` hardcodes `$` too (B-228).
2. **B-265 (M)** — the six `sendDirectEmail` callers compose English in code.
   Closer to B-268 than it was: the reservation confirmation email carrying the
   token that lands on the page just translated is one of the six, so a Spanish
   renter now gets a Spanish confirmation *screen* and an English confirmation
   *email* about the same hold. Its open question is what language to use for a
   recipient with no `Tenant` row at all (D-7 makes both anonymous).

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

**Three things B-268 leaves you:**

- **Look for the enum being interpolated into prose.** The defect worth the
  session was not the date the row named — it was `<strong>{reservation.status}</strong>`
  inside a sentence. A database enum in prose is an English word inside
  `<html lang="es">` (3.1.2) *and*, for `converted`, made the surrounding
  sentence FALSE in both languages: somebody who had just moved in was told
  their unit was "back available for anyone to take". One key per case, never
  one key with the enum as a placeholder.
- **A doc comment that contradicts the code is what hides a branch.**
  `reservationByToken` claimed to filter non-live rows out and never has. It had
  said so since B-018, and it is why nobody had read the converted branch.
- **`LOCALE_TAG` now lives in `lib/i18n`, not `lib/comms/prose.ts`.** Import it
  from there for any `Intl` call on a translated surface. `keyedFieldError` and
  `messages()` still have three callers — B-268 deliberately did not make a
  fourth, because its page has no fields to count.

**Do not reverse without reversing a decision.** The mailed lien notice stays
English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**). The admin promotion screens are English throughout
(**D-122**) — that is B-269's third surface, and the reason `codeOutcomeMessage`
lives in the web app rather than in `@storage/core/promotions`. The SEO surfaces
stay English with no row open for them (**D-123**).

**One gap B-268 named and did not close:** the LIVE confirmation state of
`/reservations` has never been axe-scanned in either language and is not in
`STATE_EXCEPTIONS`. The new `i18n.spec.ts` spec now builds that state, so it is
one `assertNoAxeViolations` call plus a `SCANNED_STATES` entry — but an honest
entry needs `layout`, and `'reached'` means a `STATE_REACH` key built in
`e2e/a11y-own-spec-routes.spec.ts`, a second reserve-and-cancel cycle in a
second file.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`npm run db:migrate:e2e`** before a Playwright run on a fresh checkout.
**`--project=desktop-chrome`, not `chromium`** — the projects here are
`setup`, `mobile-chrome` and `desktop-chrome`, and the wrong name fails
before a server starts.
