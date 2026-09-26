# Next

**B-400 is built** (2026-09-26, `955fdcc`). **Next item: B-401**, then B-402 to B-410 in `06-backlog.md` order. `/admin/reports/rate-increases` (+ `.csv`) reads applied increases by effective date; formulas in `packages/core/metrics/rate-increase-outcome.ts`. **Open flake, unowned:** `marketplace-db` fails in a full sweep when another suite deletes an active facility mid-feed (passes alone); see B-400's PROGRESS entry. It needs a row.

**B-399 is built** (2026-09-26, `954f6e2`). **Next item: B-400** (`83azzzzt`), then B-401 to B-410 in `06-backlog.md` order. `moveOutCause` and `moveOutCauseNote` are on `lease`; `moveCounts(moveIns, count, causes)` returns `byMoveOutCause`, which B-400's 30/60/90-day cause split can read. If `storage_test` gets slow (marketplace-db timing out), run `npm run db:reset-test`.

**B-398 is built** (2026-09-26, `36ef1a7`). **Next item: B-399**, then B-400 to B-410 in `06-backlog.md` order. POS search rows carry per-unit balance; tenant profile has card and cash links.

**B-397 is built** (2026-09-26). **Next item: B-398**, then B-399 to B-410 in `06-backlog.md` order. The facility page's price expander now has a late/leave block from `pricing.terms`. Finding: a future-dated move-in's gate code is issued at payment, not held to the start date (recorded in PROGRESS).

**B-396 is built** (2026-09-25, `0ed234f`). **Next item: B-397**, then B-398 to B-410 in `06-backlog.md` order. The facility page has a price headline and `#units` anchor; the phone sticky bar is "See sizes" only; promo and filter forms are `<details>`, so specs must click the `summary` before filling them.

**B-395 is built** (2026-09-25, `66c7e82`). **Next item: B-396**, then B-397 to B-410 in `06-backlog.md` order. Search features now drop facilities with no matching unit free and price from the matching unit; size alone still keeps them (B-376).

**B-394 is built** (2026-09-25, `a8067ec`). **Next item: B-395**, then B-396 to B-410 in `06-backlog.md` order. `/admin/delinquency` shows "All past due" (`agingForFacility`, behind `reports:financial`) beside today's queue; the empty state links `/admin/tenants?filter=past_due`.

**B-393 is built** (2026-09-25, `a56e828`). **Next item: B-394**, then B-395 to B-410 in `06-backlog.md` order. `/portal`'s balance panel now reads past due / due / autopay will charge from `balanceState` in `lib/portal/dashboard.ts`; `e2e/portal-balance-states.spec.ts` owns its fixture (serial, fixed slug).

**B-392 is built** (2026-09-25). **Next item: B-393**, then B-394 to B-410 in `06-backlog.md` order. B-392's e2e tests (T1/T2) need a Stripe key and were not written; B-410 owns the manual passes.

**B-391 is built** (2026-09-25, `f943854`). **Next item: B-392** (`83azzzzl`): B-390's timeout leaves a live card form after a charge; read payment status from Stripe. Opus (money path). Then the rest of review block 12, B-393 to B-410, in `06-backlog.md` order.

**Review block 12 is written and committed** (2026-09-25, `6ddc468`): B-391 to B-410 at `83azzzzk`–`83azzzzzd`. Owner calls closed as D-152. **Next item: B-391** (ECRI batch skips delinquent, lien, held and not-yet-moved-in leases, P0), then B-392 (B-390's timeout leaves a live card form after a charge; read payment status from Stripe). Opus for both (money paths).

**Closure refresh done** (2026-09-23): DEMO, WRITEUP and the brief re-walked and republished (PROGRESS, last entry). LinkedIn draft 27 in the Ledger now says "eleven times" and "in one round alone" (Version 33). Unowned defect: checkout can sit on *Payment* after a card payment until reloaded (`payment-element.tsx` reloads before the webhook lands); is now B-390 (`83azzzzj`).

**Design-audit owner calls closed** (2026-09-23, D-151, `3118f0d`): links, header CTA, fee copy and the kit screens all stay as the code has them; no rows. Nothing queued, and the only open backlog rows are the blocked list. Next: new review block, or stop.

**B-389 is built** (2026-09-23), as primitives only (D-150): no `loading.tsx` survived e2e. The design-kit gap block B-385–B-389 is finished. Nothing queued: pick from `06-backlog.md`.

**B-388 is built** (2026-09-23). **Next item: B-389** (`83azzzzi`), the last in the block: loading states. The search rail is apply-on-submit with no status region (D-149).

**B-387 is built** (2026-09-23). **Next item: B-388** (`83azzzzh`), then B-389. Public facility card shows office hours, Open/Closed badge, amenities and a CTA; header has Locations and Sizes with `aria-current`; size guide in the footer. `/admin/pos/done` cash-receipt spec on mobile-chrome flaked once in a sweep and passed alone.


**B-385 is built** (2026-09-23, `14c8b70`). **Next item: B-387** (`83azzzzg`), then B-388, B-389. Staff restyle finished on units, POS, tenant profile, delinquency, tenants list and all reports pages. mobile-chrome was not run for it.


**B-386 is built** (2026-09-23). **Next item: B-385** (`83azzzze`), then B-387. Header search, Call/Text on tenants list and delinquency cards, and sidebar count badges shipped. Call/Text is deliberately not on tenant SEARCH results (name-substring locator collisions).

**Audit rows are now in the backlog** (2026-09-23): B-385–B-389 (`83azzzze`–`83azzzzi`). **Next item: B-386** (smallest, no new data), then B-385. Open owner calls, no row: link underline and header CTA (§4 #8/#9), ACH/card fee copy (§2 #17), kit screens for facility page and checkout.

**B-384 is built** (2026-09-23, `49783ca`). Alert/Card/Badge/EmptyState/DataTable exist in `components/ui`; Field is the admin one. Nothing queued: pick from `06-backlog.md`. The audit's other rows (staff restyle, customer-facing gaps, kit screens for facility page and checkout) still have no backlog row.



**Design-kit gap audit written** (2026-09-23, `bd87d3f`, `docs/DESIGN_KIT_GAP_AUDIT.md`). D-148: the kit's unit legend wins; AA fixes and primitives first. **Next item: B-383** (`83azzzzc`), then B-384. The audit's other rows (staff restyle, customer-facing gaps, kit screens for the facility page and checkout) have no backlog row yet.

**Smoke "checkout goes back" is green on mobile-chrome** (2026-09-23): the test now focuses the sr-only step button and presses Enter, since B-378 leaves it keyboard-only below `sm`. Nothing queued and no open red: pick from `06-backlog.md`.

**B-382 is built** (2026-09-23, `79d1614`). Review block 11 is finished. Nothing queued: pick the next open item from `06-backlog.md`. **Open red, unowned:** smoke "checkout goes back" fails on mobile-chrome since B-378 (aria-hidden stepper `<p>` intercepts the click); it needs a row or a fix first. Manual passes for B-382 are owed under B-254.


**B-381 is built** (2026-09-23, `d939379`). Next item: pick from `06-backlog.md` (B-382 `83azzzzb`). Status colours are tokens; a contrast test greps for palette classes. **Open red, unowned:** smoke "checkout goes back" fails on mobile-chrome since B-378 (aria-hidden stepper `<p>` intercepts the click); it needs a row or a fix first.

**B-380 is built** (2026-09-23, `a4448b2`). Next item: **B-381** (`83azzzza`). Records only: B-369 and B-370 entries backfilled.

**B-379 is built** (2026-09-23, `3366e9b`). Next item: **B-380**. English SEO prose (size guide, guides, city/size intros, facility FAQ) carries `lang="en"` under Spanish via `EnglishBody`.

**B-378 is built** (2026-09-23, `55a4279`). Next item: **B-379** (`83azzzy`). The checkout stepper is one visible line below `sm`; the row is still tabbable and revealed on focus.

**B-377 is built** (2026-09-23, `c89adf0`). Next item: **B-378** (`83azzzx`). The red `live-region-display` test is fixed.


**B-376 is built** (2026-09-23, `b906b7c`). Next item: **B-377** (`83azzzw`). Search prices by the carried size band; size-guide cards link to search; locations is in the footer.

**B-375 is built** (2026-09-23, `2ad13c8`). Next item: **B-376** (`83azzzv`). Staff tenants list reds only past-due balances; POS row buttons are outline.

**B-374 is built** (2026-09-23, `52f77db`). Next item: **B-375** (`83azzzu`). "Use my location" resets after a same-route push; the locations status region is always mounted.

**B-373 is built** (2026-09-23). Next item: **B-374** (`83azzzt`). The header is minimal on `/checkout`; "Find storage" is outline everywhere else.

**B-372 is built** (2026-09-23). Next item: **B-373** (`83azzzs`). The portal tab bar is now Overview / Pay / Gate code / Help, one shared `isPortalPathActive` matcher for both navs.

**B-371 is built** (2026-09-23). Next item: **B-372** (`83azzzr`). The revealed gate code now fits 320px; the POS tenant has a login and a real PIN in the seed. If `.env.test`'s `ACCESS_CODE_ENCRYPTION_KEY` is not 64 hex chars, no code renders locally: copy CI's.

**Review block 11 is written** (2026-09-23). B-371–B-382 sit at `83azzzq`–`83azzzzb`, from the operator, UX and accessibility reviews over B-363–B-370. **Next item: B-371.** The revealed gate code overflows at 320px, which makes the public statement's reflow claim false on `/portal`. The refusals, the merges, two corrected reviewer claims and the clean reads are in the numbering note. Five manual passes were added to B-254. No owner question was raised.

**Review block 10 is written** (2026-09-21): B-350–B-362 at `83azzv`–`83azzzh`, from the operator, UX and accessibility reviews over B-329–B-349. 22 refusals and the clean reads are recorded in the numbering note. No owner question was raised.

**Review block 10 is finished** (B-362 built 2026-09-23, `9986fde`). Nothing is queued: pick the next open item from `docs/prds/06-backlog.md`. The 3 `admin-reports.spec.ts` failures are fixed: the B-333 and B-358 fixture facilities were left active in Austin, adding a second facility and one with no hours. Both now end inactive. B-243 stays open: D-63 says build it against a real provider key or not at all.

**B-362 is built** (2026-09-23, `9986fde`). axe now scans `/login`'s pay-link-expired state (EN, ES) and bare `/portal/pay`'s choose-a-unit state; the no-units state is a `STATE_EXCEPTIONS` row.

**B-370 is built** (2026-09-23, `1d6ad5a`). A fixed bottom tab bar under `sm` (Home, Pay, Access, Help) replaces B-239's sticky Pay bar; the header nav is unchanged. Its `aria-label` must not contain "Your account" (substring locator collision). 450 e2e passed, 4 skipped.

**B-369 is built** (2026-09-23, `9fcaea7`). Admin dashboard, portfolio roll-up and rate-changes tables per the kit. No `/admin/sites` page exists and none was built.

**B-368 is built** (2026-09-23, `af60391`). The staff shell (dark inverse `SideNav`, accent-bar active state, card header) plus tenants, delinquency, units and the `/admin/pos` walk-in list restyled to the kit's `AppShell`. Sidebar is 192px until `lg`, 240px from there: 244px throughout failed the ledger page's 320px/200%-zoom/forced-spacing check. 995 e2e passed, 5 skipped. Not built (no data or route behind them): the kit's tenant modal, sort headers, "Open main gate", the occupancy meter.

**B-367 is built** (2026-09-23, `15271fc`). `/portal` (all eleven routes) and `/checkout` restyled to the kit's `PortalShell`/`MoveInFlowScreen`: icon nav pills, a dark `GateCodeCard`, a numbered-circle step indicator, mono money throughout. No route added or removed; every `aria-current` and `role="status"`/`"alert"` region is unchanged. Dropped, per D-147: the named site manager, "First month $1". Kept over the kit: the real eleven-link portal IA (not the kit's four), native radio/fieldset protection picker (not styled cards), the bottom-sticky order summary (not a top sidebar) — each has its own reason in the PROGRESS entry. Found and left alone, unowned: a pre-existing layout defect in the portal's `Manage` dropdown (confirmed via `git stash` to predate this item). 206 e2e passed against a production build (portal, checkout-unit-lost, a11y-own-spec-routes) — WCAG, 320px reflow, 200% zoom, forced text spacing. Accessibility statement re-read; also backfilled a missed B-366 entry.

**B-366 is built** (2026-09-22, `bce4227`). `/storage/search` and the city page's facility grid restyled to the kit's card-grid language; `/storage/size-guide` restyled and now shows a real "From $X/mo" per size from `cachedSizePricing()`; new `/storage/locations` lists every active facility, nearest-first once "Use my location" is used on it. "Facility" in the backlog line was an owner call: the city page, not the 1,398-line single-facility `[slug]` page, which is untouched. a11y (with the new route scanned): 258 passed, 0 failed. smoke/consent-banner/i18n/message-link-locale: 266 passed, 4 skipped.

**B-365 is built** (2026-09-22, `3b2bc46`). The home page follows the kit's `HomeScreen`, and every fact comes from `cachedHomeFacts()`: sizes open now, the protection minimum, the facilities, and the hold window when every facility shares one. The title, OpenGraph `siteName` and breadcrumb root are now `SITE.brand`. `publisher` stays `SITE.name`. smoke, i18n and a11y: 494 passed, 4 skipped.

**B-364 is built** (2026-09-22, `909716a`). Two-band header and a dark four-column footer per the kit's `Shell`. Facts come from `publicFootprint()`. Dark bands get their own focus ring through `[data-surface='inverse']`.

**B-363 is built** (2026-09-22, `8789a4d`). The kit's palette is on the shadcn variables, and Archivo, Source Sans 3 and JetBrains Mono replace Geist. `contrast-tokens` now computes chromatic oklch. a11y spec: 250 passed.

**B-358 is built** (2026-09-21, `4afcce3`). "Pay … together" focuses the Unit select and announces "Now paying {units} together."; the overflow warning names the lockout when another owing unit is past due.

**B-357 is built** (2026-09-21, `90c5ecc`). The printed letter's "To pay" line appears only when the template requires `links.pay_now`, and a no-email tenant is sent to the phone or the office, never `/login`.

**B-356 is built** (2026-09-21, `75dc582`). An expired pay link opens `/login`'s magic-link form without a click and says "No password? We can email you a sign-in link." A bare `/login` keeps it closed.

**B-355 is built** (2026-09-21, `a70ef4c`). The partly-paid void refusal and the void section's prose put the correction first, then the refund, and warn that a refund can trim another invoice the same payment paid.

**B-354 is built** (2026-09-21, `8eb48d9`). The void's confirm echo shows "Billed again" from `projectRentRebill`, the success message states the re-bill rather than hedging, and a mismatched Confirm re-asks with "nothing was posted" so the status region announces it.

**B-353 is built** (2026-09-21, `4f6d91f`). `paymentCredits` takes account scope only when the payment's tenant is the account's payer. A member paying their own unit gets that unit's balance and no account name on every receipt.

**B-352 is built** (2026-09-21, `ec7e240`). `voidRentInvoice` refuses `payment_in_flight` while a pending or processing charge is allocated to the invoice, and `applyPayment` locks its target invoices and drops any no longer open. PROGRESS records two narrow leftovers, neither owned by an item.

## Start here

**Project closure is done** (2026-09-21). All three deliverables exist, and their URLs are in the closure entry at the end of `docs/PROGRESS.md`:

- `docs/DEMO.md`: walked end to end against a production build
- Storage Business in Brief: https://claude.ai/artifact/AeGQeP4BE4Ljye66GfrJAf
- LinkedIn drafts 25–29 in the Ledger: https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i
- Technical write-up: `WRITEUP.md` (https://github.com/shanelabountyai/self-storage-app/blob/main/WRITEUP.md), screenshots in `docs/images/`

**B-351 is built** (2026-09-21, `34a0503`). `chargedSteps` counts only fee lines due on or after the oldest unpaid rent invoice's original due date, so a cured-then-late-again tenant is charged the ladder again. Waived, transferred (B-138) and returned-payment (B-161) steps inside the episode still hold.

**B-350 is built** (2026-09-21, `7132293`). Cash/check/money order, the counter card and card-on-file refuse an ACCOUNT payment above the account's open balance (`account_above_balance`, or `accountAboveBalance` on the card setup), before anything is written. D-113 is still open.

**B-349 is built** (2026-09-21, `67ec7f4`). A bare `/portal/pay` redirects a one-lease tenant to `?lease=`. A tenant with several leases, or none, gets a sentence and a link to `/portal`. The DEMO.md troubleshooting row is removed.

**B-348 is built** (2026-09-21, `b4866f9`). `--font-sans` resolves to Geist, and the body's font is asserted in `a11y.spec.ts`. It also added the `REACH` entry for `/pay/[token]/done` that B-336 left out, with its fixture moved to `e2e/pay-receipt-fixture.ts`.

**B-347 is built** (2026-09-21, `720a7c4`). The lease's late-fee sentence reads `lateFeeStepsFor`, not `FeeSchedule`: no ladder says no late fee is charged; otherwise every step's day and amount. `describeLateFee` now lives in `lib/billing/late-fees.ts`. Signed leases are not re-rendered.

**B-346 is built** (2026-09-21, `ef3c813`). Write-off, void and non-zero adjustment on the ledger screen echo tenant, unit, amount, direction and balance after, and post only on a press that carries back `yes:<echoed cents>`. Cancel posts nothing. Each domain function takes `preview: true`, which runs every refusal and writes nothing. `AdminForm`'s confirm state has opt-in `confirmValue` and `cancel`.
**B-345 is built** (2026-09-21, `a63a737`). "crossed in the mail" and "anything we mail you". `tests/us-english.test.ts` guards the en dictionary and the English catalog.
**B-344 is built** (2026-09-21, `924cdd5`). For a business account, the counter card screens say "payer" instead of "tenant", and the card-on-file line names whose card it is. The done page links `/admin/billing/accounts/[id]`, and a declined card links back to `/admin/pos/card` with the same subject and amount.
**B-343 is built** (2026-09-21, `47e106b`). The receipt email has a `{{payment.details}}` table (receipt number when there is one, the account, and *Paid by* with the check or money-order number). It reads the same columns `receiptRows` does, in both languages. Templates are seeded state, so run `db:migrate:test` when you switch branches.
**B-342 is built** (2026-09-21, `03ea9ac`). When `accountName` is set, the account-access mail has its own subject (*"You can now see {account} at {site}"*) and lead, and a recovery line that links `/forgot-password`, in EN and ES. The ordinary reset email is unchanged, and nothing is re-sent.
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
