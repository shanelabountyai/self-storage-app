# Next

**Review block 9 is written** (2026-09-19, `072becd` + `ab39408`): B-329–B-346 at `83azza`–`83azzr`, from the operator, UX and accessibility reviews over B-301–B-328. 31 refusals are recorded in the numbering note.

## Start here

1. **B-342 (`83azzn`)**: next in review block 9. Work down the block from there. B-346 is last: **D-145** was settled (A), so write-off, void and adjustment all get a confirm step.

**B-341 is built** (2026-09-21, `950b49d`). The print page's `<article>` carries the tenant's `lang`, the letter and print-time dates are formatted in that locale, and the print-time line is two dictionary keys (`letter.printedCall` / `letter.printedSignIn`). `/admin/tasks` renders B-323's detail through `taskDetailSegments`, so the quoted subject gets its own `lang`. Both use the tenant's CURRENT preference: `Message` stores no locale (ponytail comment; unowned).
**B-340 is built** (2026-09-21, `920fcce`). The print page adds *"Printed {date}. To pay, call {phone} or sign in at {host}/login."* after the `<article>` and leaves the body verbatim. There is no Print button while the address is incomplete. The button and the profile link now have accessible names that start with their visible text, and the link never falls back to the template key. The repo has its first `.tsx` render test (`tests/message-print-page.test.tsx`). The print-time line is English only, and B-341 owns that.
**B-339 is built** (2026-09-21, `4edca09`). Confirmed the ladder cures per lease and does not net tenant credit, so the full row shipped. On `/admin/pos`, an amount over the picked unit's balance names the tenant's other owing units and offers a `units:` subject that settles them together. Card is not offered on that subject. B-305's single-unit restriction is unchanged.
**B-337 is built** (2026-09-21, `2760ee2`). The refused-amount message on `/portal/pay` and `/pay/[token]` is now `paypg.refusedChargesBalance`: it says the amount was not accepted and that the card form will charge the full balance of {amount} (`formatRate(amountCents)`, the Payment Element's figure). It no longer claims the box changed.
**B-336 is built** (2026-09-21, `b129bb7`). A refused token goes through `/pay/<token>/expired`. An expired link on an occupying lease sets `st_locale` to the tenant's language and lands on `/login?from=/portal/pay?lease=…&reason=pay_link_expired`, which shows a message and a `tel:` link. Revoked and unknown tokens are unchanged. `/pay/[token]/done` is now axe-scanned.
**B-335 is built** (2026-09-21, `a4954a7`). The payer's consolidated dunning email renders from the furthest `position` among the account's same-business-day `delinquency.day_reached` events (read from the outbox), whatever the dispatch order.
**B-334 is built** (2026-09-21, `aa79dd7`). The counter's tender fields are HIDDEN per Method, not unmounted, so B-319's cash-with-a-check-number refusal still fires after a switch; `tests/live-region-display.test.ts` now fails any `role="status"`/`aria-live` tag that is `display:none` at idle.
**B-332 is built** (2026-09-21, `68f417e`). A no-email tenant's receipt for a desk payment (counter receipt number, or `counter: true` on a desk card's `payment.succeeded`) writes its failed Message but opens no task; `taskLabel` tells "No email address on file" from "Email is bouncing" by the task's detail.
**B-329 is built** (2026-09-20, `5a6c9b3`), minus its production count — see Owner actions.
**B-333 is built** (2026-09-20, `af32799`).
**B-331 is built** (2026-09-21, `13540c3`). `paymentCredits` returns `accountName` and quotes the ACCOUNT's balance when every credited lease is an occupying unit of one account; every receipt (email, both portal/pay-link done pages, counter) names its scope from it.
**B-330 is built** (2026-09-21, `d3c23d7`). `applyPayment` takes `accountId`; the counter, counter card and `/portal/pay?account=` all pass it (card via PaymentIntent metadata). The Stripe idempotency namespace moved to `v3`.
**B-338 is built** (2026-09-20, `ec2b380`). It also fixed `outstandingCents` to ignore `void`/`uncollectible` invoices — every delinquency consumer (late fees, dunning, access gate, reports, POS) was counting cancelled invoices as owed. If a later item sees a delinquency figure drop after a void or write-off, that is this fix, not a regression.

## Owner actions

- **Delete the Neon backup branch `pre-migrate-2026-09-19`.** Production has been verified.
- **Run B-329's production count.** Read-only; the sandbox refused it as a production read, so it needs a hand. The query is in the B-329 `PROGRESS.md` entry: every rent invoice with `status = 'void'` and any `PaymentAllocation`, and whether a live rent invoice now exists for the same `(leaseId, periodStart)`. Zero is expected (production holds seeded demo data only). A non-zero row is an owner remedy — a credit and a word to that tenant — not a build one.

## Worth knowing before the next sweep

- **Another project kills this repo's vitest.** A 137 with zero failures is countertop's unscoped pkill, not your branch.
- **A 137 orphans fixtures**, and the next run fails on stale test-email rows, even on `main`.
- **`npm run db:migrate:test` after any migration or template edit** (B-338 added `invoice_reissued`; a branch without it seeded will disagree). Use `npm test -- <paths>`, never bare `npx vitest run`.
- **`db:migrate:e2e` reseeds**, so run `rm -rf apps/web/.next/cache/fetch-cache` afterwards.
- **B-333 left a permanent fixture in `storage_test`'s `public` schema** — facility `e2e-b333-ledger-corrections`, three leases, one of them deliberately not reconciling. It cannot be deleted (B-185: `audit_log` RESTRICTs against `facility`), its spec rebuilds it in `beforeAll`, and `db:reset-test` clears it with everything else. It means `/admin/reports/ledger-exceptions` now renders a TABLE locally rather than its empty state; both branches were scanned with axe and are clean.

## Do not re-raise

See the numbering note at the top of `06-backlog.md`, `git show 9b0cf73:NEXT.md`, and the B-317, B-318 and B-327 `PROGRESS.md` entries.

## The blocked list

B-254 (D-115); B-129, B-243, B-085 and B-133 (credentials or partner agreements); B-134 (trigger not fired).
