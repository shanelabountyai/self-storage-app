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
