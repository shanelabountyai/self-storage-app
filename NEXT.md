# Next

**B-268 — the page a Spanish reservation ends on is English.**
([06-backlog.md](docs/prds/06-backlog.md))

B-266 shipped on 2026-09-07 (`a0f82e4`). The promo code box answers in the
renter's own language on both surfaces, applied or refused. Three rows are open
from this seam.

1. **B-268 (S)** — the recommendation, filed by B-267 and the shortest.
   `/reservations` is the page a successful hold redirects TO *and* the page the
   emailed cancel link lands on, and it is English end to end. **Not a pure
   dictionary edit**: `formatWhen` hardcodes `'en-US'`, so the hold's expiry date
   stays English after every sentence around it is translated — B-262 settled
   that shape (one constant, `Intl` per locale, `timeZone` explicit; B-228's
   class). Its cancel form is an `AdminForm`, so its refusals take B-263's keyed
   shape and its e2e assertions must be scoped inside ONE box.
2. **B-269 (M)** — filed by B-266, and the one this session narrowed rather than
   closed. `promo.codeApplied` renders «Código aplicado: 50% off the first
   month» — `{terms}` is the promotion's own wording and is English on every
   surface: this message, every unit-card badge on a translated facility page,
   and the checkout price summary. **It is NOT B-263's shape**, which is why it
   is its own row: `termsText` is an operator's free text in a database column,
   so there is no key to return for it. Only the GENERATED half (`describeTerms`
   + `withMinStay`, both discriminated unions already) can take that shape, and
   whether a per-language terms column exists at all is an owner decision with a
   D-number. `formatCents` inside `describeTerms` hardcodes `$` too (B-228).
3. **B-265 (M)** — the six `sendDirectEmail` callers compose English in code.
   Bigger, and unblocked by nothing here.

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

**`docs/progress/20-from-b-258.md` is past 100 KB — start part 21 for the next
entry.**

**Three things B-266 leaves you:**

- **A success that carries a refusal's weight goes in `MUST_ALSO_DIFFER`, not
  under `err.`** — the list in `tests/i18n.test.ts` now has three entries
  (`reserve.holdUpdated`, `promo.codeApplied`, `promo.codeSuperseded`). The
  `err.` prefix earns the untranslated-paste guard, but the checkout styles that
  branch red with `aria-invalid`, so a success wearing it tells somebody who
  succeeded that they failed.
- **Look for the sentence field beside the discriminant before adding a key.**
  `PromoLookup.problem` was deleted rather than translated: it had ONE reader,
  because every other `offerFor` caller passes no code. Check the callers before
  assuming a pre-built sentence is load-bearing.
- **`keyedFieldError` and `messages()` now have three callers** (checkout, lead
  form, reserve action) and B-266 deliberately did NOT make a fourth — its
  refusal has a sentence worth reading, and `keyedFieldError` counts fields to
  pick its summary. Import them from `lib/admin/form-state.ts` and
  `lib/i18n/server.ts`; do not write a fourth copy.

**Do not reverse without reversing a decision.** The mailed lien notice stays
English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**), and the English keeps its original version string. The
admin promotion screens are English throughout (**D-122**) — that is the third
surface, and the reason `codeOutcomeMessage` lives in the web app rather than in
`@storage/core/promotions`.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`npm run db:migrate:e2e`** before a Playwright run on a fresh checkout.
**`--project=desktop-chrome`, not `chromium`** — the projects here are
`setup`, `mobile-chrome` and `desktop-chrome`, and the wrong name fails
before a server starts.

**The transient e2e failure B-267 recorded did not recur.** Its three `demo-e2e`
reserve specs passed in this session's `smoke.spec.ts` run (106 passed). If it
does recur, it presents identically to a broken reservation link and it is not
one — see the B-267 entry in `docs/PROGRESS.md`.
