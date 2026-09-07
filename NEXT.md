# Next

**B-267 — the reservation form on a Spanish facility page is English end to
end.** ([06-backlog.md](docs/prds/06-backlog.md))

B-269 shipped on 2026-09-07 (`510e866`). Every public page now declares the
language of its own content, so the *markup* no longer lies about English
prose under `<html lang="es">`. What it did not do is translate anything —
three rows are open, and the first is still the recommendation.

1. **B-267 (M)** — the recommendation, unchanged from B-264's handoff and now
   one step easier. `reserve/page.tsx` imports nothing from `@/lib/i18n` and
   `reserveAction` builds five English literals inline plus two English
   `FormState` messages. **The two non-field messages are the item** — the
   sold-out sentence, and "you already had a hold, so we updated it", which is
   the sentence a renter must understand to not think their reservation
   vanished. Do the page and the action together; translating labels and
   leaving refusals is the defect B-263 existed to fix. **B-269 left you a
   `lang="en"` on that page's wrapper: CHANGE it to `lang={locale}`, do not
   add a second one** — and drop the page's row from
   `ENGLISH_UNDER_A_TRANSLATED_SHELL`, which `tests/a11y-scan-coverage.test.ts`
   will otherwise fail on in the "lists no page that has since been
   translated" direction.
2. **B-266 (S)** — `describeCodeOutcome` in `@storage/core/promotions` builds
   English sentences for the promo-code outcome. Same fix shape B-263 used on
   `judgeStartDate`: the package returns the reason and the numbers, each
   surface builds its own sentence. **Watch that the outcome is not only a
   refusal** — B-122 made it carry APPLIED and SUPERSEDED too, and a renter
   told in English that their code *worked* is the same defect. Three surfaces
   read it, not one.
3. **B-270 (S)** — the staff mirror of B-269, written while building it. Admin
   is English inside a cookie-driven shell, and the template editor renders
   Spanish bodies inside it. Not customer-facing, so it does not move the
   public accessibility statement.

**Four things B-269 leaves you, each of which would cost a pass:**

- **`ProsePage` takes `lang` as a REQUIRED prop.** A new prose page states its
  language or fails `npm run typecheck`. English pages pass `lang="en"`;
  translated ones pass `lang={locale}`, which is a no-op in the accessibility
  tree and is the point — the prop records that somebody decided.
- **A public page either renders from the dictionary or is listed in
  `ENGLISH_UNDER_A_TRANSLATED_SHELL`** (`lib/a11y/scan-coverage.ts`), with
  `lang="en"` in its own markup. The walker in
  `tests/a11y-scan-coverage.test.ts` enforces both directions. Its "is this
  page translated" test matches `from '@/lib/i18n'` and NOT
  `@/lib/i18n/server`, deliberately: `/storage/[state]/[city]` reads the locale
  without rendering a translated string of its own.
- **Marking a mixed page `lang="en"` at the top INTRODUCES the mirror defect.**
  `/storage/[state]/[city]` is the worked example: English prose around a
  translated search form, so the wrapper says `en` and the form's wrapper
  declares the shell language back. B-270 has the same shape on the template
  editor. A page-level `lang` is only ever true for a page with one language
  in it.
- **Axe cannot see any of this, and neither can the route loops.** No rule
  reads prose and decides what language it is in, and the loops carry no locale
  cookie, so every scan visits as an English visitor where the markup is
  trivially correct. If you are tempted to prove a language claim with a scan,
  you are about to write a green test that tests nothing — B-269's spec was
  pointed at a translated page first, and failed, before being pointed back.

**Do not reverse without reversing a decision.** The mailed lien notice stays
English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**), and the English keeps its original version string.
`/terms` and `/privacy` stay English (**D-123**, **D-124**) — `e2e/i18n.spec.ts`
fails if either is translated out of tidiness. `LAST_REVIEWED` on the
accessibility statement moves only for a recorded manual screen-reader pass
(**D-115**, owned by **B-254**).

**`docs/progress/20-from-b-258.md` is ~97 KB — start part 21 for the next
entry.**

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state with 96 rows, and a stale seed fails as
`expected [] to have a length of 1`. **`npm run db:reset-test`** if the unit
suite starts timing out. **`npm run db:migrate:e2e`** before a Playwright run
on a fresh checkout.
