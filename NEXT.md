# Next

**B-266 — the promo code is refused in English on a Spanish checkout.**
([06-backlog.md](docs/prds/06-backlog.md))

B-267 shipped on 2026-09-07 (`5a1cf0c`). The reservation form on a Spanish
facility page is Spanish, page and action. Three rows are open from this seam;
two are direct siblings.

1. **B-266 (S)** — the recommendation, and the last of B-263's three children.
   `describeCodeOutcome` in `@storage/core/promotions` builds English
   sentences from a `CodeOutcome`, `offerFor` puts one on
   `PromoLookup.problem`, and `applyPromoAction` renders it as BOTH the
   summary and the `promo` field error. Same fix shape B-263 used on
   `judgeStartDate` and B-267 on `holdWindowKey`: the package returns the
   reason and the numbers, each surface builds its own sentence. **Watch that
   the outcome is not only a refusal** — B-122 made it carry APPLIED and
   SUPERSEDED too, and a renter told in English that their code *worked* is
   the same defect. **Three surfaces read it**, not one: the checkout's field
   error, the facility page's badges, and the admin promotions screens D-122
   keeps English — which is exactly why the sentence cannot be built inside
   the package.
2. **B-268 (S)** — filed by B-267. `/reservations` is the page a successful
   hold redirects TO *and* the page the emailed cancel link lands on, and it
   is English end to end. **Not a pure dictionary edit**: `formatWhen`
   hardcodes `'en-US'`, so the hold's expiry date stays English after every
   sentence around it is translated — B-262 settled that shape (one constant,
   `Intl` per locale, `timeZone` explicit; B-228's class). Its cancel form is
   an `AdminForm`.
3. **B-265 (M)** — the six `sendDirectEmail` callers compose English in code.
   Bigger, and unblocked by nothing here.

**B-269 shipped on this branch after B-267 reached `main` (`510e866`), and it
changes how a new page is added.** Every public page now declares the language
of its own content — WCAG 2.1 SC 3.1.2 Language of Parts — because D-122 serves
a Spanish visitor `<html lang="es">` on every route, English pages included.
Two more rows came out of it: **B-270 (S)**, the staff mirror (admin is English
inside that same shell, and the template editor renders Spanish bodies inside
it), and **B-271 (S)**, which is the `reportRange` clock bug renamed — it was
this branch's B-268 until `main` allocated that number to the reservation page
above.

**Four things B-267 leaves you:**

- **`keyedFieldError` and `messages()` now have three callers.** Checkout,
  lead form, reserve action. Import them from `lib/admin/form-state.ts` and
  `lib/i18n/server.ts`; do not write a fourth copy. `form-state.ts` still
  imports `MessageKey` type-only and must stay that way — client components
  import `IDLE_FORM_STATE` from it as a runtime value.
- **Reuse a label key when it is the same field in the same words.** B-267's
  five labels are the checkout's `details.*` and its submit is
  `facility.reserveForFree`. B-264 wrote its own `lead.*` because that form
  asks different things. The test is the words, not the surface.
- **A refusal that hangs on no field still belongs under `err.`** — that
  prefix is what earns it the guard that an identical value in both locales
  is an untranslated paste. A SUCCESS that carries a refusal's weight cannot
  use it, and goes in `MUST_ALSO_DIFFER` in `tests/i18n.test.ts` instead.
- **`AdminForm` renders each message TWICE** (summary list + beside the
  field), so scope assertions inside one box. `FormResult` — what the two
  marketing forms use — is the opposite: only the SUMMARY is in its
  `role="status"`. Check the wrapper before writing the spec.

**Four things B-269 leaves you, and the first two bind on any new page:**

- **`ProsePage` takes `lang` as a REQUIRED prop.** A new prose page states its
  language or fails `npm run typecheck`. English pages pass `lang="en"`;
  translated ones pass `lang={locale}`, which is a no-op in the accessibility
  tree and is the point — the prop records that somebody decided.
- **A public page either renders from the dictionary or is listed in
  `ENGLISH_UNDER_A_TRANSLATED_SHELL`** (`lib/a11y/scan-coverage.ts`) with
  `lang="en"` in its own markup; the walker in
  `tests/a11y-scan-coverage.test.ts` enforces both directions. **Translating a
  listed page means deleting its row AND its `lang="en"` together** — B-267 and
  B-269 crossed in exactly that way, and the walker caught it on the merge,
  which is what it is for. Its "is this page translated" check matches
  `from '@/lib/i18n'` and NOT `@/lib/i18n/server`, deliberately:
  `/storage/[state]/[city]` reads the locale without rendering a translated
  string of its own.
- **Marking a MIXED page `lang="en"` at the top introduces the mirror defect.**
  `/storage/[state]/[city]` is the worked example: English prose around a
  translated search form, so the wrapper says `en` and the form's wrapper
  declares the shell language back. B-270 has the same shape on the template
  editor.
- **Axe cannot see a language-of-parts failure, and neither can the route
  loops.** No rule reads prose and decides what language it is in, and the
  loops carry no locale cookie, so every scan visits as an English visitor
  where the markup is trivially correct. If you are about to prove a language
  claim with a scan, you are about to write a green test that tests nothing —
  B-269's spec was pointed at a translated page first, and failed, before being
  pointed back.

**`docs/progress/20-from-b-258.md` is ~97 KB — start part 21 for the next
entry.**

**One transient e2e failure, recorded and not explained.** B-267's first run
failed three `demo-e2e` reserve specs with the page having redirected to
`?unavailable=1` — no matching unit type for an id the facility page had just
linked to. It did not reproduce (7/7 twice, and the English spec passed on
stashed `HEAD` and again with the change), and the type had 250 available
units throughout. The tell was timing: 5.3s/5.3s/30s against sub-1.5s in both
green runs. If it recurs, it presents identically to a broken reservation
link and it is not one.

**Do not reverse without reversing a decision.** The mailed lien notice stays
English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**), and the English keeps its original version string.
`/terms` and `/privacy` stay English (**D-123**, **D-124**) — `e2e/i18n.spec.ts`
fails if either is translated out of tidiness, and both are now scanned as a
Spanish reader sees them. `LAST_REVIEWED` on the accessibility statement moves
only for a recorded manual screen-reader pass (**D-115**, owned by **B-254**).

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`npm run db:migrate:e2e`** before a Playwright run on a fresh checkout.
**`--project=desktop-chrome`, not `chromium`** — the projects here are
`setup`, `mobile-chrome` and `desktop-chrome`, and the wrong name fails
before a server starts.
