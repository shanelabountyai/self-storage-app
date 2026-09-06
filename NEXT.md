# Next

**B-263 — the Spanish checkout answers in English the moment it refuses you.**
([06-backlog.md](docs/prds/06-backlog.md))

B-261 shipped on 2026-09-06 (**D-126, D-127, D-128**). The renter now browses,
rents, pays, runs their account and is *written to* in Spanish. What is left is
smaller and sharper.

**Three rows are open, all from the same seam. Pick one; B-263 is the
recommendation** — it is on the money path, it is a type change rather than a
copy change, and 3.3.3 wants a suggestion the renter can act on at exactly the
moment this one speaks English.

1. **B-263 (M)** — `validateDetails`, `validateDeclarations` and
   `validateSignature` return English literals. **The fix is that the
   validators return message KEYS and the action translates them**, not that
   the strings move into the dictionary at the call site: `validateDetails` is
   shared with admin surfaces that are English by design (D-122). `FieldErrors`
   is `Record<string, string>` today, which is what makes it a type change.
2. **B-264 (S)** — the lead form on the translated facility page is entirely
   English. Its marketing-email disclosure needs the B-259 treatment (a version
   per language in `lib/consent/disclosures.ts`, the rendered locale recorded);
   the rest is ordinary copy. Do the whole form — translating the disclosure
   alone means nothing.
3. **B-265 (M, new)** — the six `sendDirectEmail` callers compose their own
   body, so `MessageTemplate.locale` reaches none of them. **The checkout
   resume link is the one that matters**: end of step 1, so it is the *first*
   email a Spanish renter gets. The open question that made it its own row is
   what language to use for a reservation or magic-link recipient who has no
   `Tenant` row at all (D-7 makes both anonymous).

**Two things B-261 leaves you that are easy to break:**

- **`npm run db:migrate:test` after switching branches**, not only after a
  migration. The catalog is seeded state and now has **96 rows, not 48** — a
  branch without the Spanish variants reseeds them away, and the suites fail as
  `expected [] to have a length of 1`, which reads exactly like a broken sender
  (B-206).
- **`tests/comms-catalog-locale.test.ts` is pure and fast** and will fail on a
  template edit that drops a merge field from one language. Trust it: it checks
  both directions plus untranslated pastes.

**Do not reverse without reversing a decision.** The mailed lien notice stays
English and the Spanish courtesy email says so (**D-127**). The template
fallback is English-rather-than-refuse (**D-126**). An unauthenticated checkout
fills a blank language and never overwrites a stated one (**D-128**).

**Run `npm run db:reset-test` if the unit suite starts timing out** —
`storage_test` accumulates facilities and the symptom reads exactly like a
regression.
