# Next

**B-265 — the six `sendDirectEmail` callers compose English in code.**
([06-backlog.md](docs/prds/06-backlog.md))

B-269 shipped on 2026-09-07 (`e8e27dd`). A promotion's terms now read in the
reader's language on all five surfaces that quote them, and the operator's own
`termsText` is rendered as typed and marked `lang="en"` (**D-129**). The
Spanish move-in path has no English left in it that a row is open for.

**B-265 (M)** is the last one on this seam and the sibling B-268 and B-269 both
pointed at. The reservation confirmation email carries the token that lands on
the page B-268 translated and quotes the terms B-269 translated — so a Spanish
renter now gets a Spanish confirmation *screen*, a Spanish *badge*, and an
English confirmation *email* about the same hold. Its open question is what
language to use for a recipient with no `Tenant` row at all (D-7 makes both
anonymous). The templated send path is already localized (`recipient.locale`);
these six bypass it.

**Three things B-269 leaves you:**

- **Count the surfaces before believing the row.** B-269's row said three and
  there were five — it had missed the checkout's own "currently applied" line.
  Grep for the FIELD (`.terms`, `promoTerms`), not for the sentence, and expect
  the admin, email and persisted readers to outnumber the renter-facing ones.
- **A pure package cannot read a locale, and that is now the settled shape**
  — `judgeStartDate` (B-263), `codeOutcomeMessage` (B-266), `offerTerms`
  (B-269). It returns the discriminant and the numbers; `apps/web` writes the
  words. Each of the three was a DELETION from `@storage/core`, not an addition.
- **A value persisted as a sentence needs a legacy read when it stops being
  one.** `checkoutSession.data.promoTerms` was English prose in a JSON column;
  `readTerms` in `lib/checkout/session.ts` reads an old string back as an
  operator override. Look for the same trap in anything B-265 touches.

**Do not reverse without reversing a decision.** An operator's `termsText` is
rendered as typed with no per-language column (**D-129**). The mailed lien
notice stays English (**D-127**). Template fallback is English-rather-than-refuse
(**D-126**). An unauthenticated checkout fills a blank language and never
overwrites a stated one (**D-128**). Consent disclosures ship a version per
language (**D-125**). The admin promotion screens are English throughout
(**D-122**), and so are `amountDueToday`'s line labels — those become invoice
lines and receipts, which are the business's record of a charge. The SEO
surfaces stay English with no row open for them (**D-123**).

**Two gaps named and not closed, neither owned by B-265:**

- **B-268's** live confirmation state of `/reservations` has still never been
  axe-scanned in either language and is not in `STATE_EXCEPTIONS`.
- **B-269's** `lang` marking is absent on three string-typed surfaces
  (`FormState.message`/`fieldErrors`, and `costLineLabel`'s `<dt>`). Closing it
  means turning `FormState` into nodes, which every admin screen shares. Stated
  on `/accessibility`; no row open.

**Run `npm run db:migrate:test` after switching branches** — the comms catalog
is seeded state, and a stale seed fails as `expected [] to have a length of 1`.
**`npm run db:reset-test`** if the unit suite starts timing out.
**`npm run db:migrate:e2e`** before a Playwright run on a fresh checkout.
**`--project=desktop-chrome`, not `chromium`.**
**Correction to B-268's handoff:** the absence of an `[e2e setup]` line is NOT
the tell for a bare `npx playwright test` — those lines print only when
something stale was actually released, so a freshly reseeded database prints
none. The tell is whether npm echoed `test:e2e`'s
`dotenv -e .env.test -e .env.local` at the top of the log.
