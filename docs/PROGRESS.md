# Build Progress

**This file is generated. Do not edit it by hand** — run `npm run docs:index` after appending an entry.

It is the index over the narrative build record. The entries themselves live in [`docs/progress/`](progress/), one part file per ~90 KB of build order; this index exists so that a session can see the whole history for a few thousand tokens instead of the 300,000 the entries themselves cost.

It complements rather than duplicates:

- [`docs/prds/06-backlog.md`](prds/06-backlog.md) — the ordered work list and ✅ markers ([index](prds/06-backlog-index.md))
- [`docs/prds/07-decisions.md`](prds/07-decisions.md) — settled decisions that override PRD text
- `git log` — the change-by-change record
- `README.md` — how the built thing works today

**Status:** 255 of 266 backlog items complete. Latest entry: Chore (`e33c60f`).
**Entries:** 283 across 20 part files.

## Reading one entry

Do not read a whole part file to find one item. Either of these prints just the entry:

```bash
npm run docs:entry -- B-137
awk '/^### B-137 /{f=1;print;next} f&&/^#{2,3} /{exit} f' docs/progress/*.md
```

## Adding one

Append the entry as a `### ` heading at the end of the **highest-numbered** file in `docs/progress/`, with its SHA on the line below the heading. Start a new part file once the current one passes ~90 KB. Then run `npm run docs:index`.

## Index


### Milestone 1 — Foundation

| Item | SHA | Detail |
|---|---|---|
| B-001 — Monorepo & app scaffold | `9766d8c` | [01-from-b-001](progress/01-from-b-001.md#b-001-monorepo-app-scaffold-9766d8c) |
| B-002 — Core data model & migrations | `ec085f1` | [01-from-b-001](progress/01-from-b-001.md#b-002-core-data-model-migrations-ec085f1) |
| B-003 — Auth foundation | `475c202` | [01-from-b-001](progress/01-from-b-001.md#b-003-auth-foundation-475c202) |
| B-004 — RBAC roles-as-data & facility scoping | `e482d66` | [01-from-b-001](progress/01-from-b-001.md#b-004-rbac-roles-as-data-facility-scoping-e482d66) |
| B-005 — Append-only audit log | `8078f85` | [01-from-b-001](progress/01-from-b-001.md#b-005-append-only-audit-log-8078f85) |
| B-006 — Background jobs & event bus | `53617fb` | [01-from-b-001](progress/01-from-b-001.md#b-006-background-jobs-event-bus-53617fb) |
| B-007 — Admin shell & role-gated routes | `e3a51da` | [01-from-b-001](progress/01-from-b-001.md#b-007-admin-shell-role-gated-routes-e3a51da) |
| B-008 — Facility settings CRUD | `af2852e` | [01-from-b-001](progress/01-from-b-001.md#b-008-facility-settings-crud-af2852e) |
| B-009 — Unit type management | `16be6e5` | [01-from-b-001](progress/01-from-b-001.md#b-009-unit-type-management-16be6e5) |
| B-010 (1 of 2) — Unit inventory: rules layer | `64d6e86` | [01-from-b-001](progress/01-from-b-001.md#b-010-1-of-2-unit-inventory-rules-layer-64d6e86) |
| B-010 (2 of 2) — Unit inventory: views, import, bulk edit | `952c339` | [01-from-b-001](progress/01-from-b-001.md#b-010-2-of-2-unit-inventory-views-import-bulk-edit-952c339) |
| B-011 — Street rate management | `8b548ed` | [01-from-b-001](progress/01-from-b-001.md#b-011-street-rate-management-8b548ed) |
| B-012 — Seed & demo data | `616bc57` | [01-from-b-001](progress/01-from-b-001.md#b-012-seed-demo-data-616bc57) |

### Milestone 2 — First online move-in

| Item | SHA | Detail |
|---|---|---|
| B-013 — Public site shell | `11bfac8` | [02-from-b-013](progress/02-from-b-013.md#b-013-public-site-shell-11bfac8) |
| B-014 — Inventory & pricing read API with quote tokens | `db019dd` | [02-from-b-013](progress/02-from-b-013.md#b-014-inventory-pricing-read-api-with-quote-tokens-db019dd) |
| B-015 — Location search | `b1413bf` | [02-from-b-013](progress/02-from-b-013.md#b-015-location-search-b1413bf) |
| B-016 — Facility detail page | `32b6df3` | [02-from-b-013](progress/02-from-b-013.md#b-016-facility-detail-page-32b6df3) |
| B-093 — Public-site accessibility & copy remediation | `d09ef7e` | [02-from-b-013](progress/02-from-b-013.md#b-093-public-site-accessibility-copy-remediation-d09ef7e) |
| B-094 — Admin shell accessibility remediation | `7a45c3e` | [02-from-b-013](progress/02-from-b-013.md#b-094-admin-shell-accessibility-remediation-7a45c3e) |
| B-017 — Unit browsing & transparent pricing | `74de9dd` | [02-from-b-013](progress/02-from-b-013.md#b-017-unit-browsing-transparent-pricing-74de9dd) |
| B-018 — Free reservation service | `f297961` | [02-from-b-013](progress/02-from-b-013.md#b-018-free-reservation-service-f297961) |
| B-019 — Stripe foundation | `e48c963` | [02-from-b-013](progress/02-from-b-013.md#b-019-stripe-foundation-e48c963) |
| B-020 — Checkout session state machine | `db0ae0b` | [02-from-b-013](progress/02-from-b-013.md#b-020-checkout-session-state-machine-db0ae0b) |
| B-021 — Checkout steps 1–2 | `5aecc5d` | [02-from-b-013](progress/02-from-b-013.md#b-021-checkout-steps-12-5aecc5d) |
| B-022 — Protection plan | `e35d7c9` | [02-from-b-013](progress/02-from-b-013.md#b-022-protection-plan-e35d7c9) |
| B-023 — Document generation & store | `fc043f8` | [02-from-b-013](progress/02-from-b-013.md#b-023-document-generation-store-fc043f8) |
| B-024 — Lease template & e-signature | `3072779` | [02-from-b-013](progress/02-from-b-013.md#b-024-lease-template-e-signature-3072779) |
| B-025 — Payment step | `e7bb69a` | [02-from-b-013](progress/02-from-b-013.md#b-025-payment-step-e7bb69a) |
| B-026 — Move-in provisioning & rollback | `df322b8` | [02-from-b-013](progress/02-from-b-013.md#b-026-move-in-provisioning-rollback-df322b8) |
| B-027 — Access control service | `510a5c9` | [02-from-b-013](progress/02-from-b-013.md#b-027-access-control-service-510a5c9) |
| B-028 — Gate simulator | `26c6a71` | [02-from-b-013](progress/02-from-b-013.md#b-028-gate-simulator-26c6a71) |
| B-029 — Gate code issuance on move-in + confirmation screen, and the authorized-access list | `71e745b` | [02-from-b-013](progress/02-from-b-013.md#b-029-gate-code-issuance-on-move-in-confirmation-screen-and-the-authorized-access-list-71e745b) |
| B-030 — Comms core: the single outbound messaging service | `0fdca2e` | [03-from-b-030](progress/03-from-b-030.md#b-030-comms-core-the-single-outbound-messaging-service-0fdca2e) |
| B-031 — Move-in path transactional emails | `b7e9c9d` | [03-from-b-030](progress/03-from-b-030.md#b-031-move-in-path-transactional-emails-b7e9c9d) |
| B-032 — SMS consent capture at move-in | `2985eec` | [03-from-b-030](progress/03-from-b-030.md#b-032-sms-consent-capture-at-move-in-2985eec) |
| B-033 — Portal login | `d6bd421` | [03-from-b-030](progress/03-from-b-030.md#b-033-portal-login-d6bd421) |
| B-034 — Portal dashboard | `25abe40` | [03-from-b-030](progress/03-from-b-030.md#b-034-portal-dashboard-25abe40) |
| B-035 — Portal one-time payment | `0c3b336` | [03-from-b-030](progress/03-from-b-030.md#b-035-portal-one-time-payment-0c3b336) |
| B-036 — Payment methods & autopay management | `5a3e52e` | [03-from-b-030](progress/03-from-b-030.md#b-036-payment-methods-autopay-management-5a3e52e) |
| B-037 — Portal documents & contact info | `f1957be` | [03-from-b-030](progress/03-from-b-030.md#b-037-portal-documents-contact-info-f1957be) |
| B-038 — Admin tenant profile | `e28f7a8` | [03-from-b-030](progress/03-from-b-030.md#b-038-admin-tenant-profile-e28f7a8) |
| B-039 — Walk-in (POS) move-in + manual payments | `ffd26ec` | [03-from-b-030](progress/03-from-b-030.md#b-039-walk-in-pos-move-in-manual-payments-ffd26ec) |
| B-040 — Admin move-out | `de72721` | [03-from-b-030](progress/03-from-b-030.md#b-040-admin-move-out-de72721) |
| B-095 — One task queue, not seven | `0f6ec12` | [03-from-b-030](progress/03-from-b-030.md#b-095-one-task-queue-not-seven-0f6ec12) |
| B-041 — Portal move-out request | `62bd5c2` | [03-from-b-030](progress/03-from-b-030.md#b-041-portal-move-out-request-62bd5c2) |
| B-042 — MVP reporting | `f0f8b7b` | [04-from-b-042](progress/04-from-b-042.md#b-042-mvp-reporting-f0f8b7b) |
| B-043 — Billing scheduler ⏳ PARTIAL — catch-up only | `4c30a6a` | [04-from-b-042](progress/04-from-b-042.md#b-043-billing-scheduler-partial-catch-up-only-4c30a6a) |
| B-043 — Billing scheduler ✅ completed | `8e615a7` | [04-from-b-042](progress/04-from-b-042.md#b-043-billing-scheduler-completed-8e615a7) |
| B-044 — Recurring invoice generation + proration | `0d21bed` | [04-from-b-042](progress/04-from-b-042.md#b-044-recurring-invoice-generation-proration-0d21bed) |
| B-045 — Autopay run | `be48a33` | [04-from-b-042](progress/04-from-b-042.md#b-045-autopay-run-be48a33) |
| B-046 — Failed-payment retry | `58f8b99` | [04-from-b-042](progress/04-from-b-042.md#b-046-failed-payment-retry-58f8b99) |
| B-050 — Payment lifecycle notices | `297b52b` | [04-from-b-042](progress/04-from-b-042.md#b-050-payment-lifecycle-notices-297b52b) |
| B-051 — Pay-now magic links | `70b411e` | [04-from-b-042](progress/04-from-b-042.md#b-051-pay-now-magic-links-70b411e) |
| B-047 — Late fee schedule | `463a5d8` | [04-from-b-042](progress/04-from-b-042.md#b-047-late-fee-schedule-463a5d8) |
| Billing settings, given a screen | `1721979` | [04-from-b-042](progress/04-from-b-042.md#billing-settings-given-a-screen-1721979) |
| B-096 — Lease holds | `a8b8ec1` | [04-from-b-042](progress/04-from-b-042.md#b-096-lease-holds-a8b8ec1) |
| B-098 — Gate access suspension & restore on non-payment | `b33d9c8` | [04-from-b-042](progress/04-from-b-042.md#b-098-gate-access-suspension-restore-on-non-payment-b33d9c8) |
| B-048 — Partial payments and refunds | `ffa77cd` | [04-from-b-042](progress/04-from-b-042.md#b-048-partial-payments-and-refunds-ffa77cd) |
| B-049 — Tenant ledger screen | `dac5527` | [04-from-b-042](progress/04-from-b-042.md#b-049-tenant-ledger-screen-dac5527) |
| B-052 — Past-due dunning ladder | `aa421bc` | [05-from-b-052](progress/05-from-b-052.md#b-052-past-due-dunning-ladder-aa421bc) |
| Integration pass — the money loop against real Stripe | `a4c65c4` | [05-from-b-052](progress/05-from-b-052.md#integration-pass-the-money-loop-against-real-stripe-a4c65c4) |
| B-053 — Template editor + per-facility sender identity | `4cfbc3e` | [05-from-b-052](progress/05-from-b-052.md#b-053-template-editor-per-facility-sender-identity-4cfbc3e) |
| B-054 — Delivery events, the suppression list, and the send log | `fecf25a` | [05-from-b-052](progress/05-from-b-052.md#b-054-delivery-events-the-suppression-list-and-the-send-log-fecf25a) |
| B-055 — Revenue and delinquency-aging reports | `485aa97` | [05-from-b-052](progress/05-from-b-052.md#b-055-revenue-and-delinquency-aging-reports-485aa97) |
| Golden path 2 — demo checkpoint | `9d94742` | [05-from-b-052](progress/05-from-b-052.md#golden-path-2-demo-checkpoint-9d94742) |
| B-064 — Gate hours enforcement and the access event log | `7bf86ae` | [05-from-b-052](progress/05-from-b-052.md#b-064-gate-hours-enforcement-and-the-access-event-log-7bf86ae) |
| B-065 — The ManualAdapter work queue | `5998c56` | [05-from-b-052](progress/05-from-b-052.md#b-065-the-manualadapter-work-queue-5998c56) |
| B-066 — SEO infrastructure | `2513de6` | [05-from-b-052](progress/05-from-b-052.md#b-066-seo-infrastructure-2513de6) |
| B-067 — Facility marketing profile editor | `239c98e` | [05-from-b-052](progress/05-from-b-052.md#b-067-facility-marketing-profile-editor-239c98e) |
| B-097 — Phone and counter inquiry capture | `c25c923` | [05-from-b-052](progress/05-from-b-052.md#b-097-phone-and-counter-inquiry-capture-c25c923) |
| B-068 — Lead capture and attribution | `0b2a4a9` | [05-from-b-052](progress/05-from-b-052.md#b-068-lead-capture-and-attribution-0b2a4a9) |
| B-069 — Analytics, the funnel, and the consent banner | `0559b21` | [05-from-b-052](progress/05-from-b-052.md#b-069-analytics-the-funnel-and-the-consent-banner-0559b21) |
| B-070 — The promotions engine | `15ff40f` | [05-from-b-052](progress/05-from-b-052.md#b-070-the-promotions-engine-15ff40f) |
| B-056 — Delinquency timeline configuration | `7d982ab` | [05-from-b-052](progress/05-from-b-052.md#b-056-delinquency-timeline-configuration-7d982ab) |
| B-057 — The delinquency engine | `3c00546` | [05-from-b-052](progress/05-from-b-052.md#b-057-the-delinquency-engine-3c00546) |

### Feature PRDs added mid-build

| Item | SHA | Detail |
|---|---|---|
| PRD 09 — Support impersonation ("log in as") 📋 specced, not built | — | [06-from-prd-09](progress/06-from-prd-09.md#prd-09-support-impersonation-log-in-as-specced-not-built) |

### Continued — in build order

| Item | SHA | Detail |
|---|---|---|
| B-058 — Overlocks: the status that had no producer | `fd446c9` | [06-from-prd-09](progress/06-from-prd-09.md#b-058-overlocks-the-status-that-had-no-producer) |
| B-059 — Delinquency queue | `65bb8e6` | [06-from-prd-09](progress/06-from-prd-09.md#b-059-delinquency-queue) |
| B-060 — Field ops: overlock reconciliation, the daily walkthrough, maintenance tickets | `dd93511` | [06-from-prd-09](progress/06-from-prd-09.md#b-060-field-ops-overlock-reconciliation-the-daily-walkthrough-maintenance-tickets) |
| B-061 — Pre-lien and lien notice generation | `ab148d6` | [06-from-prd-09](progress/06-from-prd-09.md#b-061-pre-lien-and-lien-notice-generation) |
| B-062 — The auction pipeline | `5e92979` | [06-from-prd-09](progress/06-from-prd-09.md#b-062-the-auction-pipeline) |
| B-063 — Comms delinquency-stage notices and pre-lien/lien courtesy supplements | `959af72` | [06-from-prd-09](progress/06-from-prd-09.md#b-063-comms-delinquency-stage-notices-and-pre-lienlien-courtesy-supplements) |
| B-071 — Reviews: manual entry, facility-page display, review-request email | `e3e4ec9` | [06-from-prd-09](progress/06-from-prd-09.md#b-071-reviews-manual-entry-facility-page-display-review-request-email) |
| B-072 — Marketing consent + lead drip | `8826b4c` | [06-from-prd-09](progress/06-from-prd-09.md#b-072-marketing-consent-lead-drip) |
| B-073 — Abandoned-checkout follow-up | `9a7d284` | [06-from-prd-09](progress/06-from-prd-09.md#b-073-abandoned-checkout-follow-up) |
| B-074 — SMS channel live | `202ae29` | [06-from-prd-09](progress/06-from-prd-09.md#b-074-sms-channel-live) |
| B-075 — Delivery dashboard + alerting | `659f72f` | [06-from-prd-09](progress/06-from-prd-09.md#b-075-delivery-dashboard-alerting) |
| B-076 — Tenant rate increases | `d8d53b8` | [06-from-prd-09](progress/06-from-prd-09.md#b-076-tenant-rate-increases) |
| B-077 — Unit transfer wizard | `8957896` | [06-from-prd-09](progress/06-from-prd-09.md#b-077-unit-transfer-wizard) |
| B-078 — POS depth: cash drawer + merchandise | `604160a` | [06-from-prd-09](progress/06-from-prd-09.md#b-078-pos-depth-cash-drawer-merchandise) |
| B-079 — Staff MFA + org-level defaults | `d654876` | [06-from-prd-09](progress/06-from-prd-09.md#b-079-staff-mfa-org-level-defaults) |
| B-080 — Gate hardening: reconciliation, contract suite, one vendor stub | `9772d98` | [06-from-prd-09](progress/06-from-prd-09.md#b-080-gate-hardening-reconciliation-contract-suite-one-vendor-stub) |
| B-081 split → B-102–B-107, and B-102 — monthly statements centre | `ed5479c` | [06-from-prd-09](progress/06-from-prd-09.md#b-081-split-b-102b-107-and-b-102-monthly-statements-centre) |
| B-103 — ACH bank debit + Stripe Link | `7dbc517` | [06-from-prd-09](progress/06-from-prd-09.md#b-103-ach-bank-debit-stripe-link) |
| B-104 — Insurance tier change + proof of own cover | `8f515b2` | [07-from-b-104](progress/07-from-b-104.md#b-104-insurance-tier-change-proof-of-own-cover) |
| B-105 — Portal self-service for the authorized-access list | `95249b1` | [07-from-b-104](progress/07-from-b-104.md#b-105-portal-self-service-for-the-authorized-access-list) |
| B-104 follow-up — the blob store, and the proof upload it was blocking | `8470637` | [07-from-b-104](progress/07-from-b-104.md#b-104-follow-up-the-blob-store-and-the-proof-upload-it-was-blocking) |
| B-109 — Stale copy, dead references and enum identifiers on staff screens | `5a9b5d8` | [07-from-b-104](progress/07-from-b-104.md#b-109-stale-copy-dead-references-and-enum-identifiers-on-staff-screens) |
| B-110 — Checkout dynamic state | `9e7d6d6` | [07-from-b-104](progress/07-from-b-104.md#b-110-checkout-dynamic-state) |
| B-111 — Checkout goes both ways, and the price says what changed | `10ddbb4` | [07-from-b-104](progress/07-from-b-104.md#b-111-checkout-goes-both-ways-and-the-price-says-what-changed) |
| B-112 — Checkout step 1 down to the field cap, and consumer-sized controls | `e5d1f77` | [07-from-b-104](progress/07-from-b-104.md#b-112-checkout-step-1-down-to-the-field-cap-and-consumer-sized-controls) |
| Defect fix — the advertised price and the charged price disagreed by the promotion | `17566d1` | [07-from-b-104](progress/07-from-b-104.md#defect-fix-the-advertised-price-and-the-charged-price-disagreed-by-the-promotion) |
| B-113 — Admin dashboard drill-through and an "All facilities" that rolls up | `b2f8b2d` | [07-from-b-104](progress/07-from-b-104.md#b-113-admin-dashboard-drill-through-and-an-all-facilities-that-rolls-up) |
| B-114 — The Tenants screen lists tenants | `f01ba78` | [07-from-b-104](progress/07-from-b-104.md#b-114-the-tenants-screen-lists-tenants) |
| B-124 — A validation error no longer discards what was typed | `7ee46d3` | [07-from-b-104](progress/07-from-b-104.md#b-124-a-validation-error-no-longer-discards-what-was-typed) |
| B-125 — e2e runs against a production build, not the dev server | `ffbe20a` | [07-from-b-104](progress/07-from-b-104.md#b-125-e2e-runs-against-a-production-build-not-the-dev-server) |
| B-115 — Tasks and delinquency cards name and link their subject | `0f3d975` | [07-from-b-104](progress/07-from-b-104.md#b-115-tasks-and-delinquency-cards-name-and-link-their-subject) |
| B-116 — 320px reflow on the three admin routes that fail it, and the unit list's volume | `e1db355` | [07-from-b-104](progress/07-from-b-104.md#b-116-320px-reflow-on-the-three-admin-routes-that-fail-it-and-the-unit-lists-volume) |
| B-117 — Navigation hierarchy, admin and portal | `7716178` | [07-from-b-104](progress/07-from-b-104.md#b-117-navigation-hierarchy-admin-and-portal) |
| B-118 — Facility page: hero photo, sticky rent CTA, and the hold window stated before the form | `101430f` | [07-from-b-104](progress/07-from-b-104.md#b-118-facility-page-hero-photo-sticky-rent-cta-and-the-hold-window-stated-before-the-form) |
| B-119 — The accessibility scan contract | `5900834` | [07-from-b-104](progress/07-from-b-104.md#b-119-the-accessibility-scan-contract) |
| B-120 — The e2e suite is not repeatable, and it does not notice when it is testing the wrong application | `111b9b2` | [07-from-b-104](progress/07-from-b-104.md#b-120-the-e2e-suite-is-not-repeatable-and-it-does-not-notice-when-it-is-testing-the-wrong-application) |
| B-121 — The active-duty declaration reaches the delinquency pipeline | `3b29a71` | [08-from-b-121](progress/08-from-b-121.md#b-121-the-active-duty-declaration-reaches-the-delinquency-pipeline) |
| B-122 — A renter can actually enter a promo code | `b0b4140` | [08-from-b-121](progress/08-from-b-121.md#b-122-a-renter-can-actually-enter-a-promo-code) |
| B-123 — Marketing SMS: the lane, built and deliberately dark | `7c11133` | [08-from-b-121](progress/08-from-b-121.md#b-123-marketing-sms-the-lane-built-and-deliberately-dark) |
| B-126 — The reservation hold window: D-7 corrected, and the configurable half built | `6735c28` | [08-from-b-121](progress/08-from-b-121.md#b-126-the-reservation-hold-window-d-7-corrected-and-the-configurable-half-built) |
| B-100 (part 1) — Referral program: the engine | `792af15` | [08-from-b-121](progress/08-from-b-121.md#b-100-part-1-referral-program-the-engine) |
| B-100 (part 2) — Referrals: the trigger and the money | `fdfb49e` | [08-from-b-121](progress/08-from-b-121.md#b-100-part-2-referrals-the-trigger-and-the-money) |
| B-100 (part 3) — Referrals: the tenant's side, attribution, and the events | `32b724d` | [08-from-b-121](progress/08-from-b-121.md#b-100-part-3-referrals-the-tenants-side-attribution-and-the-events) |
| B-101 — Referral visibility, and the comms B-100 deferred | `a2947ab` | [08-from-b-121](progress/08-from-b-121.md#b-101-referral-visibility-and-the-comms-b-100-deferred) |
| B-108 — Staff MFA: a QR, a way to keep the recovery codes, and a sign-in that works from a bare /login | `f2a087f` | [08-from-b-121](progress/08-from-b-121.md#b-108-staff-mfa-a-qr-a-way-to-keep-the-recovery-codes-and-a-sign-in-that-works-from-a-bare-login) |
| B-106 (part 1 of 2) — Future-dated move-ins | `c557926` | [08-from-b-121](progress/08-from-b-121.md#b-106-part-1-of-2-future-dated-move-ins) |
| B-106 (part 2 of 3) — The checkout basket, with one line in it | `cf24da6` | [08-from-b-121](progress/08-from-b-121.md#b-106-part-2-of-3-the-checkout-basket-with-one-line-in-it) |
| B-106 (part 3 of 4) — Provisioning N leases | `820dd5a` | [08-from-b-121](progress/08-from-b-121.md#b-106-part-3-of-4-provisioning-n-leases) |
| B-106 (part 4 of 5) — One plan per unit, and access for every lease (D-52) | `e44c36a` | [08-from-b-121](progress/08-from-b-121.md#b-106-part-4-of-5-one-plan-per-unit-and-access-for-every-lease-d-52) |
| Chore — `tests/` and `e2e/` were typechecked by nothing | `1e64444` | [08-from-b-121](progress/08-from-b-121.md#chore-tests-and-e2e-were-typechecked-by-nothing) |
| B-106 (part 5 of 5) — The basket becomes editable, and three decisions land (D-53, D-54, D-55) | `1104766` | [08-from-b-121](progress/08-from-b-121.md#b-106-part-5-of-5-the-basket-becomes-editable-and-three-decisions-land-d-53-d-54-d-55) |
| B-107 — The search results grow a map, and the list stays the product (D-56) | `b4b40a2` | [08-from-b-121](progress/08-from-b-121.md#b-107-the-search-results-grow-a-map-and-the-list-stays-the-product-d-56) |
| B-082 (part 1 of 6) — Marketplace attribution: the channel that bills per move-in stops reporting as organic (D-57) | `2a4a84d` | [08-from-b-121](progress/08-from-b-121.md#b-082-part-1-of-6-marketplace-attribution-the-channel-that-bills-per-move-in-stops-reporting-as-organic-d-57) |
| B-082 (part 2 of 6) — City pages: a URL that has been a 301 target and a 404 at the same time since B-066 | `e77b611` | [09-from-b-082](progress/09-from-b-082.md#b-082-part-2-of-6-city-pages-a-url-that-has-been-a-301-target-and-a-404-at-the-same-time-since-b-066) |
| B-082 (part 3 of 6) — The guides content hub, and two ways a carried filter was about to disappear | `af69ef6` | [09-from-b-082](progress/09-from-b-082.md#b-082-part-3-of-6-the-guides-content-hub-and-two-ways-a-carried-filter-was-about-to-disappear) |
| B-082 (part 4 of 6) — Funnel v2: a breakdown that foots, two sequences, and what each discount actually bought | `a48c41f` | [09-from-b-082](progress/09-from-b-082.md#b-082-part-4-of-6-funnel-v2-a-breakdown-that-foots-two-sequences-and-what-each-discount-actually-bought) |
| B-082 (part 5 of 6) — Search Console: what Google has actually indexed, and the deadlock that stopped being deferrable | `40c8657` | [09-from-b-082](progress/09-from-b-082.md#b-082-part-5-of-6-search-console-what-google-has-actually-indexed-and-the-deadlock-that-stopped-being-deferrable) |
| B-082 (part 6 of 6) — Duplicate content, and the report immediately flagged our own city pages | `862993a` | [09-from-b-082](progress/09-from-b-082.md#b-082-part-6-of-6-duplicate-content-and-the-report-immediately-flagged-our-own-city-pages) |
| B-128 — City pages get copy somebody can write, and the seed that stopped being idempotent | `16076f1` | [09-from-b-082](progress/09-from-b-082.md#b-128-city-pages-get-copy-somebody-can-write-and-the-seed-that-stopped-being-idempotent) |
| B-083 — Certified mail for lien notices, and the auction half split out | `c9b953b` | [09-from-b-082](progress/09-from-b-082.md#b-083-certified-mail-for-lien-notices-and-the-auction-half-split-out) |
| B-084 part 1 of 4 — The monthly close, and what "frozen" actually means | `17a7694` | [09-from-b-082](progress/09-from-b-082.md#b-084-part-1-of-4-the-monthly-close-and-what-frozen-actually-means) |
| B-084 part 2 of 4 — The QuickBooks journal, and two omissions that look like bugs | `c26b29f` | [09-from-b-082](progress/09-from-b-082.md#b-084-part-2-of-4-the-quickbooks-journal-and-two-omissions-that-look-like-bugs) |
| B-084 part 3 of 4 — Scheduled report emails, and the first email that had to be accessible | `325603a` | [09-from-b-082](progress/09-from-b-082.md#b-084-part-3-of-4-scheduled-report-emails-and-the-first-email-that-had-to-be-accessible) |
| B-084 part 4 of 4 — The management pack, and what a number is worth | `44d7cae` | [09-from-b-082](progress/09-from-b-082.md#b-084-part-4-of-4-the-management-pack-and-what-a-number-is-worth) |
| B-130 — The lien-notice path had no e2e, because of one missing foreign key | `f8c05b2` | [09-from-b-082](progress/09-from-b-082.md#b-130-the-lien-notice-path-had-no-e2e-because-of-one-missing-foreign-key) |
| B-131 — Unit occupancy is historical, and the report stops answering a different question from the one its date picker implies | `b08176e` | [10-from-b-131](progress/10-from-b-131.md#b-131-unit-occupancy-is-historical-and-the-report-stops-answering-a-different-question-from-the-one-its-date-picker-implies) |
| B-132 — The demo leases that were delinquent in name only now owe real money | `b81aa8f` | [10-from-b-131](progress/10-from-b-131.md#b-132-the-demo-leases-that-were-delinquent-in-name-only-now-owe-real-money) |
| B-091 part 1 — The escalation guard and the record, with nothing yet able to render as somebody else | `f82223c` | [10-from-b-131](progress/10-from-b-131.md#b-091-part-1-the-escalation-guard-and-the-record-with-nothing-yet-able-to-render-as-somebody-else) |
| B-091 part 2 — Enforcement, banner and UI: the support session becomes possible and blocked in the same commit | `22c53c5` | [10-from-b-131](progress/10-from-b-131.md#b-091-part-2-enforcement-banner-and-ui-the-support-session-becomes-possible-and-blocked-in-the-same-commit) |
| B-092 — Impersonation oversight: the only channel through which misuse becomes visible | `2e8cf30` | [10-from-b-131](progress/10-from-b-131.md#b-092-impersonation-oversight-the-only-channel-through-which-misuse-becomes-visible) |
| B-088 part 1 — Revenue-management aids: a price change made a decision rather than a reflex | `5f54871` | [10-from-b-131](progress/10-from-b-131.md#b-088-part-1-revenue-management-aids-a-price-change-made-a-decision-rather-than-a-reflex) |
| B-088 part 2 — The owner KPI dashboard, built from what was filed rather than what can be re-derived | `8ec230a` | [10-from-b-131](progress/10-from-b-131.md#b-088-part-2-the-owner-kpi-dashboard-built-from-what-was-filed-rather-than-what-can-be-re-derived) |
| B-087 part 1 — IndexNow, structured-data monitoring, and half a PRD line that no longer exists | `317b522` | [10-from-b-131](progress/10-from-b-131.md#b-087-part-1-indexnow-structured-data-monitoring-and-half-a-prd-line-that-no-longer-exists) |
| B-089 — Per-city/size landing pages, and a duplicate detector promoted from report to gate | `2073e91` | [10-from-b-131](progress/10-from-b-131.md#b-089-per-citysize-landing-pages-and-a-duplicate-detector-promoted-from-report-to-gate) |
| B-090 part 1 — Waitlists, and the demand signal this product never had | `4821522` | [10-from-b-131](progress/10-from-b-131.md#b-090-part-1-waitlists-and-the-demand-signal-this-product-never-had) |
| B-090 part 2 — Tenant self-service transfer, built as a request rather than a commit | `09548c8` | [10-from-b-131](progress/10-from-b-131.md#b-090-part-2-tenant-self-service-transfer-built-as-a-request-rather-than-a-commit) |
| B-135 — An inbound text nobody sees, routed to the queue somebody already works | `2071c3e` | [11-from-b-135](progress/11-from-b-135.md#b-135-an-inbound-text-nobody-sees-routed-to-the-queue-somebody-already-works) |
| B-136 — A transfer quote that nothing honoured | `d7bd8a6` | [11-from-b-135](progress/11-from-b-135.md#b-136-a-transfer-quote-that-nothing-honoured) |
| B-137 — A transfer must carry the tenant's protective state, not just their rate | `b33454b` | [11-from-b-135](progress/11-from-b-135.md#b-137-a-transfer-must-carry-the-tenants-protective-state-not-just-their-rate) |
| B-138 — Collections must survive a transfer | `0063e42` | [11-from-b-135](progress/11-from-b-135.md#b-138-collections-must-survive-a-transfer) |
| B-139 — The accessibility statement was overstating, and its exception list was hand-written | `942a4ad` | [11-from-b-135](progress/11-from-b-135.md#b-139-the-accessibility-statement-was-overstating-and-its-exception-list-was-hand-written) |
| B-140 — A transfer hold was emailed a move-in reminder for a move-in that was not happening | `0bde0aa` | [11-from-b-135](progress/11-from-b-135.md#b-140-a-transfer-hold-was-emailed-a-move-in-reminder-for-a-move-in-that-was-not-happening) |
| B-141 — "Complete" on `/admin/tasks` silently did nothing when the note was empty | `8f009f8` | [11-from-b-135](progress/11-from-b-135.md#b-141-complete-on-admintasks-silently-did-nothing-when-the-note-was-empty) |
| B-142 — The portal transfer screen swallowed failures, stated no expiry, and had no date ceiling | `8f009f8` | [11-from-b-135](progress/11-from-b-135.md#b-142-the-portal-transfer-screen-swallowed-failures-stated-no-expiry-and-had-no-date-ceiling) |
| B-156 — The scan contract II: post-interaction states, parameterised routes, and a control that does nothing | `9a6d580` | [11-from-b-135](progress/11-from-b-135.md#b-156-the-scan-contract-ii-post-interaction-states-parameterised-routes-and-a-control-that-does-nothing) |
| B-143 — An inbound text is readable in full where its task links | `3239353` | [11-from-b-135](progress/11-from-b-135.md#b-143-an-inbound-text-is-readable-in-full-where-its-task-links) |
| B-144 — A promotion can carry a minimum stay, and say so | `e3aadcb` | [11-from-b-135](progress/11-from-b-135.md#b-144-a-promotion-can-carry-a-minimum-stay-and-say-so) |
| B-145 — Recapture when a promoted lease ends before its minimum stay | `93d4207` | [11-from-b-135](progress/11-from-b-135.md#b-145-recapture-when-a-promoted-lease-ends-before-its-minimum-stay) |
| B-146 — A payment that came back | `37634a2` | [11-from-b-135](progress/11-from-b-135.md#b-146-a-payment-that-came-back) |
| B-147 — Card disputes reach nothing | `ee10a67` | [11-from-b-135](progress/11-from-b-135.md#b-147-card-disputes-reach-nothing) |
| B-148 — Waitlist and lead forms announce success to nobody | `8d0e3d1` | [11-from-b-135](progress/11-from-b-135.md#b-148-waitlist-and-lead-forms-announce-success-to-nobody) |
| B-149 — Checkout's unit-lost branch was a dead end | `06db806` | [12-from-b-149](progress/12-from-b-149.md#b-149-checkouts-unit-lost-branch-was-a-dead-end) |
| B-150 — AR aging sat under a month picker and always answered "as of today" | `8aa64cc` | [12-from-b-149](progress/12-from-b-149.md#b-150-ar-aging-sat-under-a-month-picker-and-always-answered-as-of-today) |
| B-151 — An overlock outlived the lease it was applied to | `de346e5` | [12-from-b-149](progress/12-from-b-149.md#b-151-an-overlock-outlived-the-lease-it-was-applied-to) |
| B-152 — A rate-increase notice was recorded as sent with no delivery check | `b9409d2` | [12-from-b-149](progress/12-from-b-149.md#b-152-a-rate-increase-notice-was-recorded-as-sent-with-no-delivery-check) |
| B-153 — A tenant's rate can now come down | `e0da7d0` | [12-from-b-149](progress/12-from-b-149.md#b-153-a-tenants-rate-can-now-come-down) |
| B-154 — Waitlist at the counter, and a report that could finally be called from | `a1cf2d8` | [12-from-b-149](progress/12-from-b-149.md#b-154-waitlist-at-the-counter-and-a-report-that-could-finally-be-called-from) |
| B-155 — Protection attach rate, finally reportable | `d4355b6` | [12-from-b-149](progress/12-from-b-149.md#b-155-protection-attach-rate-finally-reportable) |
| B-158 — A gate command could be skipped by clock skew between the app and the database | `aa51d57` | [12-from-b-149](progress/12-from-b-149.md#b-158-a-gate-command-could-be-skipped-by-clock-skew-between-the-app-and-the-database) |
| B-157 — The staff side of D-85: approval, a reason code, and a lien clock that genuinely does not reset | `7bd00ab` | [12-from-b-149](progress/12-from-b-149.md#b-157-the-staff-side-of-d-85-approval-a-reason-code-and-a-lien-clock-that-genuinely-does-not-reset) |
| B-159 — The accessibility statement was overstating again, and the fix was to claim less | `4b98ca6` | [12-from-b-149](progress/12-from-b-149.md#b-159-the-accessibility-statement-was-overstating-again-and-the-fix-was-to-claim-less) |
| B-160 — The auction file named the wrong unit, and the sale paid off the wrong lease | `13d23a2` | [12-from-b-149](progress/12-from-b-149.md#b-160-the-auction-file-named-the-wrong-unit-and-the-sale-paid-off-the-wrong-lease) |
| B-161 — One returned ACH served the whole lien ladder in a night | `f3188fe` | [12-from-b-149](progress/12-from-b-149.md#b-161-one-returned-ach-served-the-whole-lien-ladder-in-a-night) |
| B-162 — A transfer was built as if the tenant were new | `3d873c7` | [12-from-b-149](progress/12-from-b-149.md#b-162-a-transfer-was-built-as-if-the-tenant-were-new) |
| B-163 — Proof of insurance stopped being monitored the moment a tenant moved units | `f73ca16` | [12-from-b-149](progress/12-from-b-149.md#b-163-proof-of-insurance-stopped-being-monitored-the-moment-a-tenant-moved-units) |
| B-164 — The lien-pipeline hole B-137 closed on one screen and left open on the next | `d1d2b0a` | [13-from-b-164](progress/13-from-b-164.md#b-164-the-lien-pipeline-hole-b-137-closed-on-one-screen-and-left-open-on-the-next) |
| B-165 — A rule-based rate increase is a step, not a jump to street | `caccde5` | [13-from-b-164](progress/13-from-b-164.md#b-165-a-rule-based-rate-increase-is-a-step-not-a-jump-to-street) |
| B-166 — A held rate increase has a way back: Re-notice | `64defdf` | [13-from-b-164](progress/13-from-b-164.md#b-166-a-held-rate-increase-has-a-way-back-re-notice) |
| B-167 — Six fee types that could be configured and never charged | `9d64d3c` | [13-from-b-164](progress/13-from-b-164.md#b-167-six-fee-types-that-could-be-configured-and-never-charged) |
| B-168 — A promotional recapture you can argue down without forgiving the arrears | `f661a45` | [13-from-b-164](progress/13-from-b-164.md#b-168-a-promotional-recapture-you-can-argue-down-without-forgiving-the-arrears) |
| B-169 — The backstop that could not reach the units it was built for | `7631936` | [13-from-b-164](progress/13-from-b-164.md#b-169-the-backstop-that-could-not-reach-the-units-it-was-built-for) |
| B-170 — Two of four proof fields, and an announcement that died with the row it reported on | `dedbc57` | [13-from-b-164](progress/13-from-b-164.md#b-170-two-of-four-proof-fields-and-an-announcement-that-died-with-the-row-it-reported-on) |
| B-171 — Both public marketing forms were silent on the error path | `91f99d4` | [13-from-b-164](progress/13-from-b-164.md#b-171-both-public-marketing-forms-were-silent-on-the-error-path) |
| B-172 — Checkout's unit-lost branch stops being a display | `4d181cd` | [13-from-b-164](progress/13-from-b-164.md#b-172-checkouts-unit-lost-branch-stops-being-a-display) |
| B-173 — One form, one truth: the date you typed is the date that posts | `67f874d` | [13-from-b-164](progress/13-from-b-164.md#b-173-one-form-one-truth-the-date-you-typed-is-the-date-that-posts) |
| B-174 — The portal move-out preview stops vanishing in silence | `00ec8a4` | [13-from-b-164](progress/13-from-b-164.md#b-174-the-portal-move-out-preview-stops-vanishing-in-silence) |
| B-175 — The lease says what a broken minimum stay costs | `424c30f` | [13-from-b-164](progress/13-from-b-164.md#b-175-the-lease-says-what-a-broken-minimum-stay-costs) |
| B-176 — The screen that sets a minimum stay now says whether anything enforces it | `cef567c` | [13-from-b-164](progress/13-from-b-164.md#b-176-the-screen-that-sets-a-minimum-stay-now-says-whether-anything-enforces-it) |
| B-177 — The rate screen names the tenant instead of asking for a cuid | `2fca73d` | [13-from-b-164](progress/13-from-b-164.md#b-177-the-rate-screen-names-the-tenant-instead-of-asking-for-a-cuid) |
| B-178 — The fee question says what it charges, and its answer matches its value | `c349796` | [13-from-b-164](progress/13-from-b-164.md#b-178-the-fee-question-says-what-it-charges-and-its-answer-matches-its-value) |
| B-179 — A returned payment offers the pay route, not a phone number | `646e34e` | [13-from-b-164](progress/13-from-b-164.md#b-179-a-returned-payment-offers-the-pay-route-not-a-phone-number) |
| B-180 — One email field for the whole quote table, and a confirmation that names the size | `f13465a` | [14-from-b-180](progress/14-from-b-180.md#b-180-one-email-field-for-the-whole-quote-table-and-a-confirmation-that-names-the-size) |
| B-181 — The tenant profile reads before it writes | `686b3cc` | [14-from-b-180](progress/14-from-b-180.md#b-181-the-tenant-profile-reads-before-it-writes) |
| B-182 — Customer-facing copy: "ring" → "call", "cheque" → "check" | `13fb9ff685b1ed6a2b53b84de6d361b0bbe2c508` | [14-from-b-180](progress/14-from-b-180.md#b-182-customer-facing-copy-ring-call-cheque-check) |
| B-183 — AR aging sits under a month picker that does not govern it | `157cb68d02fc57ae7babdce6a9715037b9cbb1f5` | [14-from-b-180](progress/14-from-b-180.md#b-183-ar-aging-sits-under-a-month-picker-that-does-not-govern-it) |
| B-184 — The scan contract III: states the route list cannot express, and the assertions that were only ever run on public routes | `c3aa355` | [14-from-b-180](progress/14-from-b-180.md#b-184-the-scan-contract-iii-states-the-route-list-cannot-express-and-the-assertions-that-were-only-ever-run-on-public-routes) |
| B-185 — The unit test database accumulates fixtures until the sweep stops being trustworthy | `68ce711a166a8990850caaafaad23e325006c769` | [14-from-b-180](progress/14-from-b-180.md#b-185-the-unit-test-database-accumulates-fixtures-until-the-sweep-stops-being-trustworthy) |
| B-186 — Every walk-in tenant is recorded as having given no notice at all | `f59f6a18ce70e14f49374f5425e9aec21ba6d719` | [14-from-b-180](progress/14-from-b-180.md#b-186-every-walk-in-tenant-is-recorded-as-having-given-no-notice-at-all) |
| B-090c — Delinquency payment plans and self-cure (B-090 part 3): a hold with no schedule behind it | `dc9e09b` | [14-from-b-180](progress/14-from-b-180.md#b-090c-delinquency-payment-plans-and-self-cure-b-090-part-3-a-hold-with-no-schedule-behind-it) |
| B-187 — The accessibility statement's one strengthened sentence is false again | `0e08180` | [14-from-b-180](progress/14-from-b-180.md#b-187-the-accessibility-statements-one-strengthened-sentence-is-false-again) |
| B-086 part 1 — Time-boxed shared access, and the scope column that was never enforced | `f78f280` | [14-from-b-180](progress/14-from-b-180.md#b-086-part-1-time-boxed-shared-access-and-the-scope-column-that-was-never-enforced) |
| B-188 — A payment plan counted money that came back, and money that was never meant for it | `0da24f8` | [14-from-b-180](progress/14-from-b-180.md#b-188-a-payment-plan-counted-money-that-came-back-and-money-that-was-never-meant-for-it) |
| B-189 — Autopay did not know a payment plan existed, in either direction | `733d444` | [14-from-b-180](progress/14-from-b-180.md#b-189-autopay-did-not-know-a-payment-plan-existed-in-either-direction) |
| B-190 — Nothing capped what a payment plan could defer, or how many times a lease could defer it | `b4f2ee0` | [14-from-b-180](progress/14-from-b-180.md#b-190-nothing-capped-what-a-payment-plan-could-defer-or-how-many-times-a-lease-could-defer-it) |
| B-191 — A payment plan told the tenant nothing, and went quietest at the moment it broke | `6e3c9aa` | [15-from-b-191](progress/15-from-b-191.md#b-191-a-payment-plan-told-the-tenant-nothing-and-went-quietest-at-the-moment-it-broke) |
| B-192 — The payment-plan builder announced nothing, named nothing, and sat where D-95 says it must not | `97491e2` | [15-from-b-191](progress/15-from-b-191.md#b-192-the-payment-plan-builder-announced-nothing-named-nothing-and-sat-where-d-95-says-it-must-not) |
| B-193 — The tenant's plan page had one way in, and it vanished the moment the plan broke | `88f066a` | [15-from-b-191](progress/15-from-b-191.md#b-193-the-tenants-plan-page-had-one-way-in-and-it-vanished-the-moment-the-plan-broke) |
| B-194 — Two notice forms discarded the server's refusal, and the screen promised a charge nothing charges | `be9c24b` | [15-from-b-191](progress/15-from-b-191.md#b-194-two-notice-forms-discarded-the-servers-refusal-and-the-screen-promised-a-charge-nothing-charges) |
| B-195 — The aging report's arithmetic was right and said nothing about what was being done | `0ebc3ff` | [15-from-b-191](progress/15-from-b-191.md#b-195-the-aging-reports-arithmetic-was-right-and-said-nothing-about-what-was-being-done) |
| B-196 — The scan contract IV: a waiver earned on one page stopped covering the whole product | `9f7c722` | [15-from-b-191](progress/15-from-b-191.md#b-196-the-scan-contract-iv-a-waiver-earned-on-one-page-stopped-covering-the-whole-product) |
| B-197 — The four limits that decide who may give money away were reachable only from a database client | `0be870b` | [15-from-b-191](progress/15-from-b-191.md#b-197-the-four-limits-that-decide-who-may-give-money-away-were-reachable-only-from-a-database-client) |
| Demo readiness — the preview-deploy safety net was inert on the only platform this deploys to | `f859549` | [15-from-b-191](progress/15-from-b-191.md#demo-readiness-the-preview-deploy-safety-net-was-inert-on-the-only-platform-this-deploys-to) |
| B-199 — Seven wide staff tables clipped their own action links on a phone, and the reflow test could not see it | `f9a9823` | [15-from-b-191](progress/15-from-b-191.md#b-199-seven-wide-staff-tables-clipped-their-own-action-links-on-a-phone-and-the-reflow-test-could-not-see-it) |
| B-198 — The template's second HTML body is deleted, and the schedule became a real table anyway | `cb4e6f1` | [15-from-b-191](progress/15-from-b-191.md#b-198-the-templates-second-html-body-is-deleted-and-the-schedule-became-a-real-table-anyway) |
| B-200 — Three stale report assertions, one of which was never checking the column it named | `4ce99da` | [15-from-b-191](progress/15-from-b-191.md#b-200-three-stale-report-assertions-one-of-which-was-never-checking-the-column-it-named) |
| B-201 — The reflow check that `[contain:layout]` cannot mask, and the seven defects it found on green routes | `bf21eba` | [15-from-b-191](progress/15-from-b-191.md#b-201-the-reflow-check-that-containlayout-cannot-mask-and-the-seven-defects-it-found-on-green-routes) |
| B-129 (part) — The auction lot sheet, and the readiness check that decides what may be advertised | `1350aa8` | [16-from-b-129](progress/16-from-b-129.md#b-129-part-the-auction-lot-sheet-and-the-readiness-check-that-decides-what-may-be-advertised) |
| B-218 — `gh pr ready` now runs the e2e lane, which it never has | `6371f1f` | [16-from-b-129](progress/16-from-b-129.md#b-218-gh-pr-ready-now-runs-the-e2e-lane-which-it-never-has) |
| B-202 — a payment plan now blocks the auction it always should have | `6371f1f` | [16-from-b-129](progress/16-from-b-129.md#b-202-a-payment-plan-now-blocks-the-auction-it-always-should-have) |
| B-203 — a manual payment reaches the plan, not this month's tax | `921822f` | [16-from-b-129](progress/16-from-b-129.md#b-203-a-manual-payment-reaches-the-plan-not-this-months-tax) |
| B-205 — The lot sheet carries what a lien advertisement has to carry | `c08f71f` `9474c57` | [16-from-b-129](progress/16-from-b-129.md#b-205-the-lot-sheet-carries-what-a-lien-advertisement-has-to-carry) |
| B-204 — An installment charge honours `halt_autopay` | `3d6b6c4` | [16-from-b-129](progress/16-from-b-129.md#b-204-an-installment-charge-honours-halt_autopay) |
| B-206 — The plan tells the tenant when it ends, and which payment ended it | `48aca48` | [16-from-b-129](progress/16-from-b-129.md#b-206-the-plan-tells-the-tenant-when-it-ends-and-which-payment-ended-it) |
| B-207 — The chased/halted split reaches the roll-up, the emailed report and the month-end close | `e65e314` | [16-from-b-129](progress/16-from-b-129.md#b-207-the-chasedhalted-split-reaches-the-roll-up-the-emailed-report-and-the-month-end-close) |
| B-208 — A payment plan stops covering for rent it never deferred | `e4276e6` | [16-from-b-129](progress/16-from-b-129.md#b-208-a-payment-plan-stops-covering-for-rent-it-never-deferred) |
| B-209 — "Collected under plans" counted money nobody collected, and correcting a mistyped plan burned the lease's annual allowance | `5ed47a4` | [16-from-b-129](progress/16-from-b-129.md#b-209-collected-under-plans-counted-money-nobody-collected-and-correcting-a-mistyped-plan-burned-the-leases-annual-allowance) |
| B-210 — A tenant one day late was told their plan was dead, and a plan that broke in March still said so in December | `80f7e7a` | [16-from-b-129](progress/16-from-b-129.md#b-210-a-tenant-one-day-late-was-told-their-plan-was-dead-and-a-plan-that-broke-in-march-still-said-so-in-december) |
| B-211 — Three screens described behaviour the product does not have | `fd3ea9e` | [16-from-b-129](progress/16-from-b-129.md#b-211-three-screens-described-behaviour-the-product-does-not-have) |
| B-212 — The payment-plan builder is offered where it cannot work, and where it can, it demands cent-exact arithmetic across twelve fields | `14904be` | [16-from-b-129](progress/16-from-b-129.md#b-212-the-payment-plan-builder-is-offered-where-it-cannot-work-and-where-it-can-it-demands-cent-exact-arithmetic-across-twelve-fields) |
| B-213 — The builder's per-installment refusal reaches no assistive technology, and no test in the repo renders one | `5af3e40` | [17-from-b-213](progress/17-from-b-213.md#b-213-the-builders-per-installment-refusal-reaches-no-assistive-technology-and-no-test-in-the-repo-renders-one) |
| B-214 — The accessibility statement's hand-check sentence was false for two of the five waiver paths | `6ac5179` | [17-from-b-213](progress/17-from-b-213.md#b-214-the-accessibility-statements-hand-check-sentence-was-false-for-two-of-the-five-waiver-paths) |
| B-215 — The layout loops reached routes but never states, so both customer-facing payment-plan surfaces were axe-only | `00c2129` | [17-from-b-213](progress/17-from-b-213.md#b-215-the-layout-loops-reached-routes-but-never-states-so-both-customer-facing-payment-plan-surfaces-were-axe-only) |
| B-228 — The same payment-plan installment was due on two different days, one tap apart | `0dfb9e9` | [17-from-b-213](progress/17-from-b-213.md#b-228-the-same-payment-plan-installment-was-due-on-two-different-days-one-tap-apart) |
| B-227 — Three screens promised a monthly charge with the tax left out, and the payment step said "Autopay is on" after the renter turned it off | `dd92b8c` | [17-from-b-213](progress/17-from-b-213.md#b-227-three-screens-promised-a-monthly-charge-with-the-tax-left-out-and-the-payment-step-said-autopay-is-on-after-the-renter-turned-it-off) |
| B-226 — The facility page advertised a discount, said it was already in the total, and left it out | `71b9233` | [17-from-b-213](progress/17-from-b-213.md#b-226-the-facility-page-advertised-a-discount-said-it-was-already-in-the-total-and-left-it-out) |
| B-225 — Money paid ahead had nowhere to live, so the tenant who prepaid was fee'd and then charged again | `a323791` | [17-from-b-213](progress/17-from-b-213.md#b-225-money-paid-ahead-had-nowhere-to-live-so-the-tenant-who-prepaid-was-feed-and-then-charged-again) |
| B-251 — A "you are here" state made of a 1.09:1 tint and a font-weight bump | `3c3ca7d` | [17-from-b-213](progress/17-from-b-213.md#b-251-a-you-are-here-state-made-of-a-1091-tint-and-a-font-weight-bump) |
| B-250 — The log that catches stale claims missed one, and the date it dates has not moved in twenty-one items | `47e38fd` | [17-from-b-213](progress/17-from-b-213.md#b-250-the-log-that-catches-stale-claims-missed-one-and-the-date-it-dates-has-not-moved-in-twenty-one-items) |
| B-249 — Fifty-six focusable scroll regions that announced nothing, and the axe rule that looks at them and passes | `1577e22` | [17-from-b-213](progress/17-from-b-213.md#b-249-fifty-six-focusable-scroll-regions-that-announced-nothing-and-the-axe-rule-that-looks-at-them-and-passes) |
| B-248 — A comment claimed polite regions coalesce, and the money form spoke six sentences per number typed | `2e12613` | [17-from-b-213](progress/17-from-b-213.md#b-248-a-comment-claimed-polite-regions-coalesce-and-the-money-form-spoke-six-sentences-per-number-typed) |
| B-247 — The menu built for a phone revealed 20px tap targets | `fbd3a4f` | [17-from-b-213](progress/17-from-b-213.md#b-247-the-menu-built-for-a-phone-revealed-20px-tap-targets) |
| B-246 — Scan contract VI: the layout half had no exception list, so "neither list" was a valid place to be | `796e4bf` | [17-from-b-213](progress/17-from-b-213.md#b-246-scan-contract-vi-the-layout-half-had-no-exception-list-so-neither-list-was-a-valid-place-to-be) |
| B-245 — Nine live regions that were never status messages, and the navigation no scan could see | `5477a05` | [17-from-b-213](progress/17-from-b-213.md#b-245-nine-live-regions-that-were-never-status-messages-and-the-navigation-no-scan-could-see) |
| B-244 — The portal said what you owed before it said which unit it was about | `1d87c01` | [17-from-b-213](progress/17-from-b-213.md#b-244-the-portal-said-what-you-owed-before-it-said-which-unit-it-was-about) |
| B-224 — A sale could be booked before the date the notice gave, and recorded with no advertisement at all | `12fa7bb` | [17-from-b-213](progress/17-from-b-213.md#b-224-a-sale-could-be-booked-before-the-date-the-notice-gave-and-recorded-with-no-advertisement-at-all) |
| B-221 — The test that had never once run, and the catalog entry that made it fail when it finally did | `46bb333` | [17-from-b-213](progress/17-from-b-213.md#b-221-the-test-that-had-never-once-run-and-the-catalog-entry-that-made-it-fail-when-it-finally-did) |
| B-223 — A report's month is complete when it is complete at every facility the figures come from | `a2b54f1` | [18-from-b-223](progress/18-from-b-223.md#b-223-a-reports-month-is-complete-when-it-is-complete-at-every-facility-the-figures-come-from) |
| B-222 — The revenue report's figures sat in rows with no header, and the fix had to change what the report looks like | `0da0eff` | [18-from-b-223](progress/18-from-b-223.md#b-222-the-revenue-reports-figures-sat-in-rows-with-no-header-and-the-fix-had-to-change-what-the-report-looks-like) |
| B-253 — The ordinary way to add a migration connected to shared cloud infrastructure and offered to drop it | `e16bac9` | [18-from-b-223](progress/18-from-b-223.md#b-253-the-ordinary-way-to-add-a-migration-connected-to-shared-cloud-infrastructure-and-offered-to-drop-it) |
| B-252 — Two unit tests that failed permanently from 12:00 CDT today, and only one of them was a defect | `1bf0b50` | [18-from-b-223](progress/18-from-b-223.md#b-252-two-unit-tests-that-failed-permanently-from-1200-cdt-today-and-only-one-of-them-was-a-defect) |
| B-219 — The document store keeps its "newest first" promise for two documents written in the same instant | `32d9e30` | [18-from-b-223](progress/18-from-b-223.md#b-219-the-document-store-keeps-its-newest-first-promise-for-two-documents-written-in-the-same-instant) |
| B-216 — The aging report attached its facility name with `scope="rowgroup"`, which no screen reader implements | `74bc47e` | [18-from-b-223](progress/18-from-b-223.md#b-216-the-aging-report-attached-its-facility-name-with-scoperowgroup-which-no-screen-reader-implements) |
| B-220 — Two month-turn defects in the reports section, and a third the fix uncovered | `79aaca9` | [18-from-b-223](progress/18-from-b-223.md#b-220-two-month-turn-defects-in-the-reports-section-and-a-third-the-fix-uncovered) |
| B-217 — The leases a counter staffer opens on a phone are cards now, and every scroll region that stays says it scrolls | `67c2c9c` | [18-from-b-223](progress/18-from-b-223.md#b-217-the-leases-a-counter-staffer-opens-on-a-phone-are-cards-now-and-every-scroll-region-that-stays-says-it-scrolls) |
| B-229 — A failed nightly job now wakes somebody, and the screen that shows it stopped speaking in cuids | `49b6d76` | [18-from-b-223](progress/18-from-b-223.md#b-229-a-failed-nightly-job-now-wakes-somebody-and-the-screen-that-shows-it-stopped-speaking-in-cuids) |
| B-230 — The counter takes a card, a walk-in move-in takes cash, and a counter rental stops reporting as a web rental | `8221ee5` | [18-from-b-223](progress/18-from-b-223.md#b-230-the-counter-takes-a-card-a-walk-in-move-in-takes-cash-and-a-counter-rental-stops-reporting-as-a-web-rental) |
| B-231 — The counter can see what the tenant owes, and a former tenant can finally hand over cash | `6751931` | [18-from-b-223](progress/18-from-b-223.md#b-231-the-counter-can-see-what-the-tenant-owes-and-a-former-tenant-can-finally-hand-over-cash) |
| B-232 — The portal says what the balance is for, and what paying it buys | `2f7d524` | [18-from-b-223](progress/18-from-b-223.md#b-232-the-portal-says-what-the-balance-is-for-and-what-paying-it-buys) |
| B-233 — A task can be taken, given back, and filtered to yours | `ab0ef59` | [18-from-b-223](progress/18-from-b-223.md#b-233-a-task-can-be-taken-given-back-and-filtered-to-yours) |
| B-234 — A held auction surplus gets an alarm, not a screen | `93ea899` | [18-from-b-223](progress/18-from-b-223.md#b-234-a-held-auction-surplus-gets-an-alarm-not-a-screen) |
| B-235 — "All facilities" answers with a worklist on the six screens that used to refuse | `4de7885` | [19-from-b-235](progress/19-from-b-235.md#b-235-all-facilities-answers-with-a-worklist-on-the-six-screens-that-used-to-refuse) |
| B-236 — the hourly tick bounds its work, and what it cannot reach stays due | `ce675c1` | [19-from-b-235](progress/19-from-b-235.md#b-236-the-hourly-tick-bounds-its-work-and-what-it-cannot-reach-stays-due) |
| B-237 — a facility can be created, and one that is not ready says so | `6e6144f` | [19-from-b-235](progress/19-from-b-235.md#b-237-a-facility-can-be-created-and-one-that-is-not-ready-says-so) |
| B-239 — the move-in confirmation says what happens next, and Pay replaces Move out in the portal nav | `2fdc885` | [19-from-b-235](progress/19-from-b-235.md#b-239-the-move-in-confirmation-says-what-happens-next-and-pay-replaces-move-out-in-the-portal-nav) |
| B-240 — the tenant profile answers the four questions at the top, and every section is one click away | `18cfa93` | [19-from-b-235](progress/19-from-b-235.md#b-240-the-tenant-profile-answers-the-four-questions-at-the-top-and-every-section-is-one-click-away) |
| B-241 — the reports index says what each group of reports actually is | `76edeef` | [19-from-b-235](progress/19-from-b-235.md#b-241-the-reports-index-says-what-each-group-of-reports-actually-is) |
| B-242 — a search result names the size its price belongs to, and carries a photo | `00664ee` | [19-from-b-235](progress/19-from-b-235.md#b-242-a-search-result-names-the-size-its-price-belongs-to-and-carries-a-photo) |
| B-255 — a web move-in's payment reaches the ledger | `7c9350f` | [19-from-b-235](progress/19-from-b-235.md#b-255-a-web-move-ins-payment-reaches-the-ledger) |
| B-090d — broadcast sends (B-090 part 4) | `0d4cd9c` | [19-from-b-235](progress/19-from-b-235.md#b-090d-broadcast-sends-b-090-part-4) |
| B-090e — Business accounts: the payer above the lease (2026-09-04) | — | [19-from-b-235](progress/19-from-b-235.md#b-090e-business-accounts-the-payer-above-the-lease-2026-09-04) |
| B-257 — One payment settled several leases; the ledger credited one (2026-09-04) | — | [19-from-b-235](progress/19-from-b-235.md#b-257-one-payment-settled-several-leases-the-ledger-credited-one-2026-09-04) |
| B-256 — The business account's portal half: one card, one Pay button (2026-09-04) | — | [19-from-b-235](progress/19-from-b-235.md#b-256-the-business-accounts-portal-half-one-card-one-pay-button-2026-09-04) |
| B-258 — Authorized users on a business account: the people allowed to see it (2026-09-04) | — | [20-from-b-258](progress/20-from-b-258.md#b-258-authorized-users-on-a-business-account-the-people-allowed-to-see-it-2026-09-04) |
| B-086 part 2 — Phone unlock, and the answer to OQ-2 (2026-09-04) | — | [20-from-b-258](progress/20-from-b-258.md#b-086-part-2-phone-unlock-and-the-answer-to-oq-2-2026-09-04) |
| B-090f — Spanish on the move-in path (B-090 part 6) (2026-09-05) | — | [20-from-b-258](progress/20-from-b-258.md#b-090f-spanish-on-the-move-in-path-b-090-part-6-2026-09-05) |
| B-260 part 1 — The portal in Spanish (2026-09-05) | — | [20-from-b-258](progress/20-from-b-258.md#b-260-part-1-the-portal-in-spanish-2026-09-05) |
| Chore — the build record was too large to read, so no session read it | `e33c60f` `2d63bfe` | [20-from-b-258](progress/20-from-b-258.md#chore-the-build-record-was-too-large-to-read-so-no-session-read-it) |
