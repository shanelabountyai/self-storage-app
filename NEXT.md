# Next

**B-267 — the reservation form on a Spanish facility page is English end to
end.** ([06-backlog.md](docs/prds/06-backlog.md))

B-264 shipped on 2026-09-06 (`d17f86b`). The lead form on that page is now
Spanish, disclosure included. Two rows are open, both from the same seam.

1. **B-267 (M)** — the recommendation. The direct sibling of what just
   shipped: the *other* form on the *same* page, and the row B-263 sized as
   bigger than it looks. `reserve/page.tsx` imports nothing from
   `@/lib/i18n` and `reserveAction` builds five English literals inline plus
   two English `FormState` messages. **The two non-field messages are the
   item** — the sold-out sentence, and "you already had a hold, so we
   updated it", which is the sentence a renter must understand to not think
   their reservation vanished. Do the page and the action together;
   translating labels and leaving refusals is the defect B-263 existed to
   fix.
2. **B-266 (S)** — `describeCodeOutcome` in `@storage/core/promotions`
   builds English sentences for the promo-code outcome. Same fix shape
   B-263 used on `judgeStartDate`: the package returns the reason and the
   numbers, each surface builds its own sentence. **Watch that the outcome
   is not only a refusal** — B-122 made it carry APPLIED and SUPERSEDED
   too, and a renter told in English that their code *worked* is the same
   defect. Three surfaces read it, not one.

**Four things B-264 leaves you, each of which would cost a pass:**

- **`keyedFieldError` and `messages()` are shared now.** They moved out of
  the checkout action into `lib/admin/form-state.ts` and
  `lib/i18n/server.ts` when B-264 became their second caller. B-267 is the
  third — import them, do not write a third copy. `form-state.ts` still
  imports `MessageKey` type-only and must stay that way: client components
  import `IDLE_FORM_STATE` from it as a runtime value.
- **`FormResult` and `AdminForm` are opposites, and B-263's e2e advice
  applies to only one of them.** `AdminForm` renders each message TWICE
  (summary list + beside the field), so assertions must be scoped inside one
  box. `FormResult` — which the two marketing forms use, because neither is
  built on `AdminForm` — puts only the SUMMARY in its `role="status"` and
  the message beside its own field. Asserting a field message inside that
  live region fails, and it fails looking exactly like an untranslated
  string. Check which wrapper the reservation form uses before writing the
  spec.
- **A reservation is not a consent, so check before reaching for
  `disclosures.ts`.** B-264's disclosure work was needed because the lead
  form writes a `Consent` row. If the reserve path writes none, its copy is
  ordinary dictionary text and D-125 does not apply — the versioned-text
  machinery is for words somebody is asked to agree to, not for words they
  are asked to read.
- **e2e must reach the SERVER to mean anything.** Check whether the reserve
  form's fields are `required`: if they are, an empty submit is refused by
  the browser and the action never runs. The lead form's are not, which is
  why B-264's spec could submit a name and nothing else.

**Do not reverse without reversing a decision.** The mailed lien notice
stays English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**), and the English keeps its original version string —
re-pointing `v1` at edited words rewrites what past renters were shown.

**Run `npm run db:migrate:test` after switching branches** — the comms
catalog is seeded state with 96 rows, and a stale seed fails as
`expected [] to have a length of 1`. **`npm run db:reset-test`** if the unit
suite starts timing out. **`npm run db:migrate:e2e`** before a Playwright
run on a fresh checkout.
