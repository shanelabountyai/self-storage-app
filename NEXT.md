# Next

**B-264 — the lead form on a Spanish facility page is entirely English.**
([06-backlog.md](docs/prds/06-backlog.md))

B-263 shipped on 2026-09-06 (`618f531`). Every field error on the checkout —
steps 1 through 4, plus the summary heading above them — is now translated, and
renter-facing copy has left `@storage/core`. Three rows are open, all from the
same seam.

1. **B-264 (S)** — the recommendation, and the smallest. The facility page
   around this form is translated; the form is not. Its marketing-email
   disclosure needs the B-259 treatment (a version per language in
   `lib/consent/disclosures.ts`, the rendered locale recorded); the rest is
   ordinary copy. Do the whole form — translating the disclosure alone means
   nothing.
2. **B-267 (M, new)** — the sibling B-263 uncovered: the *reservation* form on
   the same page is English end to end, page AND action. Bigger than it looks
   because the action's two non-field messages are the interesting copy —
   especially "you already had a hold, so we updated it", which is the sentence
   a renter must understand to not think their reservation vanished.
3. **B-266 (S, new)** — `describeCodeOutcome` in `@storage/core/promotions`
   builds English sentences for the promo-code outcome. Same fix shape B-263
   used on `judgeStartDate`: the package returns the reason and the numbers,
   each surface builds its own sentence. **Watch that the outcome is not only a
   refusal** — B-122 made it carry APPLIED and SUPERSEDED too, and a renter told
   in English that their code *worked* is the same defect.

**Two things B-263 leaves you that are easy to get wrong:**

- **The row's stated premise was wrong; do not "simplify" the fix back.**
  `validateDetails` has exactly ONE production caller — the checkout action. It
  is the `FieldErrors` *type* that 237 admin call sites share, not the
  validators. Keys are still right, but the reason is that a pure function has
  no request to read a locale from, not that admin calls it.
- **`form-state.ts` imports `MessageKey` type-only, deliberately.** Three client
  components import `IDLE_FORM_STATE` from that file as a runtime value; a value
  import of `@/lib/i18n` there puts both 1,400-line dictionaries in their
  browser bundles.

**A new e2e spec must reach the server to mean anything.** Step 1's fields are
`required`, so an empty submit is refused by the browser and never calls the
action. Use `getByRole('main').getByRole('alert')` — a bare `.first()` finds
Next's empty route announcer — and assert INSIDE that box, because `AdminForm`
renders every message twice (summary list + beside the field).

**Do not reverse without reversing a decision.** The mailed lien notice stays
English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**).

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state with 96 rows, and a stale seed fails as
`expected [] to have a length of 1`. **`npm run db:reset-test`** if the unit
suite starts timing out.
