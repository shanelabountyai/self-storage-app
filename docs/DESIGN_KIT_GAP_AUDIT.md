# Design kit vs codebase: gap audit (2026-09-23)

Kit: claude.ai design-system project `84b81ef9-747f-4042-8f27-c32a0e41d567` (D-146, D-147). Built as B-363–B-370, tidied by B-381. Five read-only passes (foundations, storage/data components, website + mobile, portal + checkout, staff + admin), spot-checked against the code by file. Not yet verified by eye at 390px or in a browser; items marked *check* need that.

Excluded because already decided (D-146/D-147, B-363–B-382): dropped kit claims (Cedar Valley, since 1998, named manager, First month $1, kiosk pay, gate-from-phone counts, "About 2 minutes"), AA-darkened tokens, the real 11-link portal IA, native radio protection picker, bottom-sticky order summary, no `/admin/sites`, no tenant modal, no sort headers, no "Open main gate", no occupancy meter on the site card, no map on locations, no photos.

## 1. Root cause behind most of it

The kit has **29 primitives; the code has 2** (`components/ui/button.tsx`, `scroll-region.tsx`). B-363/B-381 moved colours across; the component vocabulary never came. Every card, alert, badge, field, table and empty state is hand-written Tailwind, so kit behaviours (shadow-1, selected ring, icon-plus-word alerts, table chrome) are enforced nowhere and drift page by page. Fixing this once (Card, Alert, Badge, Field, DataTable, EmptyState) closes a large share of the rows below.

## 2. In the kit, not in the code

Ranked by user-visible impact. **O** = no item owns it. **D** = recorded decision or data reason, listed only where the reason no longer fully holds.

### Staff and admin
1. **O — Restyle stopped at four screens.** Units, reports (all ~25 pages), `/admin/pos` payment search and the tenant profile still have a `text-lg` h1 and plain ruled tables. `admin/units/page.tsx:165,248`, `admin/pos/page.tsx:33,75`, `admin/reports/page.tsx:291`, `admin/tenants/[tenantId]/page.tsx:382`, `admin/delinquency/page.tsx:56` (the no-facility branch).
2. **O — Header search is a disabled stub** (`components/admin/header.tsx:29-40`) though `/admin/tenants?q=` already works. Wiring it needs no new route.
3. **O — Call / Text (`tel:`/`sms:`) on delinquency and tenant rows.** None anywhere in admin lists.
4. **O — Past due screen:** no metric strip (past-due $, tenants, lock-outs eligible, collected today), no This site / All sites toggle, no lock-out rule/date alert, no legal-caution card. One count-only banner.
5. **O — Tenants list:** no Export, no subtitle counts, filter tabs have no counts, no phone / rate / status-badge columns, "Add a tenant" is secondary where the kit's is primary.
6. **O — Sidebar count badges** (Past due, Walk-through, Rate changes). Counts exist (`overdueCount`, tasks).
7. **O — Walk-in move-in hands off to the public `/checkout` wizard** (`pos/actions.ts:133-170`), so the counter runs on customer chrome. No unit-tile picker (staff pick a unit type), no ID capture step, no disc-lock stepper.
8. **O — Dashboard:** no TrendBars, no unit-mix meter, no underperformer alert; economic occupancy exists on reports (`reports/page.tsx:354`) but not on the dashboard.
9. **O — Unit map:** tiles are not status-coloured, no vacant-only switch, no detail panel with next actions. `/admin/units` is a table plus grid.
10. **O — Rate changes:** no impact summary card, no notice-rule alert; propose flow is route-based, not the kit modal.
11. **D, weakened — SitePicker occupancy %** was recorded as "not built", but per-facility occupancy exists in reports.
12. **O — Shell layout:** header spans above the sidebar; kit puts brand + site picker + user footer in the sidebar and the header in the content column only. Facility switcher still shows a "Switch" button. *Check whether deliberate (no-JS submit).*
13. **O — Tenant profile** may lack gate code, protection tier, last access (the modal's content). *Check.*

### Portal and checkout
14. **O — Autopay alert on My units** (on / due Friday + "Turn on autopay"); code has a plain On/Off line. Autopay toggle is a full page away at `/portal/methods`.
15. **O — Unit card is thin:** no status badge, start date, protection plan and coverage, "Current" balance badge.
16. **O — Gate activity log** and **"text me when my unit is accessed"** switch. *Check that the data exists first.*
17. **O — ACH-first, fees stated plainly** ("Bank account, free" / "Card, 2.9%"). No fee copy in code; the 2.9% figure is not in code. Needs an owner call: it is a kit claim with no data behind it.
18. **O — Saved method rows** (kind, default badge, edit, bank rows); code lists cards only.
19. **O — Per-unit action row** (Pay early / Transfer / Give notice) on the card; these sit behind Manage.
20. **O — Autopay alert, "Cancel free any time before you sign" line, toast on gate open (30s copy).** Low.

### Website and mobile
21. **O — Find-a-unit filter rail** (features, budget, promos, radius, clear) and List/Map toggle; results are facility cards, not unit cards. `size`/`features` ride the URL but the renter cannot set or clear them. Biggest customer-facing gap.
22. **O — Facility card lacks status badge, hours, amenities and a CTA button** (`components/site/facility-card.tsx`). Hours and amenities have data (D-147 says derive facts). Same for **UnitCard** pieces on the facility page: "N left", strikethrough price, features (counts derivable).
23. **O — Header has no Locations or Sizes link and no active-link state** (`site-header.tsx`); size guide is missing from the footer Help column.
24. **O — Breadcrumbs on search.**
25. **D — Size guide picker + footprint diagram** (recorded, add if the flat list stops sufficing). Home "why people stay" icon grid (layout only).
26. **Mobile Home / Access / Pay screens** were not rebuilt (B-370 recorded). *Check at 390px:* gate code first on `/portal`, card fee beside its option, sticky total.

### Components and tokens
27. **O — Unit-state tokens (`--unit-*`) do not exist.** This is the highest-impact single item; see §4.
28. **O — Cards** have no shadow tokens, no hover lift, no selected ring (clay border + 1px ring); selection is done by fill (`aria-[current]:bg-accent`), which the kit forbids. No `--shadow-*`, `--dur-*`, `--ease-*`, `--overlay-scrim` tokens.
29. **O — No loading states:** zero `loading.tsx`, no Spinner or skeleton. A slow route shows nothing.
30. **O — Pagination** is Prev/Next per page; no shared component. *Check that long lists are not silently `take:`-capped.*
31. **O — TrendBars** (KPI and revenue are tables only), **MetricCard delta and icon** (KPI shows delta as text), **DataTable chrome** (~55 hand-rolled tables), **KeyValueList**, **EmptyState** (77 files hand-write "nothing here"; admin never uses the kit's).
32. **O — GateCodeCard:** no site eyebrow, no hours line, no masked dots, text Show/Hide instead of an eye toggle. **ProtectionPlanCard:** no recommended marker, no bullet points. **PaymentMethodRow:** covered in 18.
33. **O — Modal, Toast, Tabs, Switch, SegmentedControl, NumberStepper, Tag chip, Tooltip, IconButton (44px):** none in code. Several are deliberate for a11y (live regions instead of toast, `<details>` instead of modal) but nothing records it. Decide per component: adopt or record "not needed".
34. **O — Icons:** lucide in 9 files; the kit puts an icon beside every nav label.

## 3. In the code, not in the kit (needs a design or a "code is the design" note)

- **Whole surfaces with no kit screen.** Public: facility page (the highest-traffic page), reserve, size-by-dimension, `/checkout` (6 steps incl. Lease and Done), resume, lock-lapse recovery, promo step, reservations, guides, about/contact/faq/legal. Portal: pay (+done), statements, documents, payment plan, transfer, protection, move-out, refer, contact, notifications, add-card, authorised-people form. Admin: Billing, Business Accounts, Auctions, Overlocks, Gate Activity/Health, Keypad Queue, Maintenance, Walkthrough, Tasks, Inquiries, Announcements, Settings, Comms, POS drawer, ~25 reports.
- **States the kit never drew:** every error, empty, loading, 403, not-found, no-results, sold-out, geolocation-denied and no-facilities state; access-suspended, settling-funds, payment-plan, pending-transfer and business-payer cards.
- **Statuses:** `overlocked`, `unrentable` (hatch), `pending_auction`; the kit has five.
- **Chrome:** language toggle and offer, consent banner, impersonation banner, MFA screen, skip links, live-region announcers, print styles, phone admin nav ("More"), minimal checkout header, portal tab-bar owed/current states.
- **Forms:** admin form and inline-refusal pattern (`components/admin/form.tsx`), confirm-with-echo (B-346), bulk edit.
- **Stripe Payment Element** uses hard-coded hex (`portal-payment.tsx`, `payment-element.tsx`); Stripe cannot read CSS variables, so it needs a mapped appearance.
- **Dark theme:** `.dark` in `globals.css` is neutral grey and off-brand, and the kit has none. *Check whether anything sets `.dark`; if not, delete it.* Chart tokens `--chart-1..5` are still grey.

## 4. Present in both, divergent

| # | Divergence | Where | Note |
|---|---|---|---|
| 1 | **Unit-state legend is permuted.** Kit: vacant green, occupied grey, reserved blue, overdue red, maintenance amber. Code: available green, occupied **blue**, reserved **amber**, overlocked red, maintenance **grey**. Blue/gray palette classes survive because B-381's grep covers only red/amber/green/yellow. | `components/admin/unit-status-badge.tsx:9-17` | Owner call: PRD 02 US-5 fixes the code's mapping. Change the kit or the AC. Staff read this all day. |
| 2 | Radii 2–4px off: field kit 6 / code 8; button 6 / 10; card 14 / 10. | `globals.css` (`--radius` 10), `button.tsx:8` | B-363 compared only `--radius-md`. |
| 3 | Button: default 32px tall (kit 40), `translate-y-px` press (kit: no transform), translucent hover, destructive is a tint not solid, 50% disabled (kit 42%). 10+ hand-rolled 44px buttons bypass it. | `button.tsx:8-45` | Two button sizes on one page. |
| 4 | Cell inputs `h-9` (36px) in 5 places, under both the kit's 40 and the 44px touch floor. | grep `h-9 w-28` | A real a11y defect, not only a style one. |
| 5 | Alerts: no icon, no shared tone; status by colour and border. Kit: icon + title + action. | ~30 `role="alert"` sites | SC 1.4.1 risk where colour is the only cue. |
| 6 | Stepper: current and done share a fill, no check, no connector. | `components/checkout/stepper.tsx:66-72` | Mobile hide is deliberate (B-378). |
| 7 | Portal h1 `text-xl`, kit `text-3xl`; checkout is `text-3xl`. Container 896 vs 960; website `max-w-6xl` vs kit 1240. | `portal/*/page.tsx`, `portal/layout.tsx` | Portal is two sizes below checkout. |
| 8 | Links clay + always underlined; kit pine, underline on hover. | 57 `text-primary` links | Underline is the safer WCAG choice; record it. |
| 9 | Header CTA: "Find storage" is secondary; kit makes it the clay primary. | `site-header.tsx:75-82` | B-373 chose this on purpose; conflicts with the kit's rule. Record it. |
| 10 | Prices are mono in checkout and portal, not on public prices; 53 `font-mono` vs 275 `tabular-nums`. Two-decimal-in-ledgers rule not implemented (`formatRate` everywhere). | `components/site/*` | |
| 11 | 12px text used 311 times; kit says 14px floor (yet uses 12 for labels). | | Decide the rule. |
| 12 | Three active-nav treatments (underline, pill, left bar). | `portal-nav.tsx:68`, admin subnav | |
| 13 | Tab order Overview / Pay / Gate code / Help vs kit Home / Access / Pay / Help. | `portal-tab-bar.tsx` | Reasoned in B-372. |
| 14 | 18 `capitalize` uses Title-Case data values; three eyebrow tracking values. | `admin/settings/*`, `portal/payment-plan/page.tsx:166` | Kit is sentence case. |
| 15 | Open defect: portal Manage `<details>` reflows the nav row (B-367 left it). *Confirm still present.* | `portal-nav.tsx` | |
| 16 | Open red: smoke "checkout goes back" on mobile-chrome (B-378). NEXT.md says fixed by `ec1e729`; foundations pass still lists it. | | Stale claim in one of the two; verify. |

## 5. Suggested order (for you to choose)

1. **Decide** §4 #1 (unit-state legend), #8/#9 (links, header CTA) and §2 #17 (fee copy). All three are owner calls that change what gets built.
2. **Fix** §4 #4 (36px cells) and #5 (alerts without icon or word): both touch AA.
3. **Build the primitives once** (Card, Alert, Badge, Field, DataTable, EmptyState) and the `--unit-*`/shadow/motion tokens, then convert pages by area. Highest leverage.
4. **Finish the restyle** on the screens B-368/B-369 skipped (§2 #1), plus header search and Call/Text (cheap, no data work).
5. **Customer-facing gaps with data behind them:** facility-card hours/amenities/status, header Locations link, search filter rail.
6. **Commission kit screens** for the facility page, the checkout Lease step and the state pages, or record "code is the design" for each.

Rows written 2026-09-23: step 3 is B-384 (done); step 4 is B-385 and B-386; step 5 is B-387 and B-388; loading states (§2 #29) is B-389. **Still no row, deliberately:** step 1's owner calls (§4 #8/#9, §2 #17 fee copy) and step 6 (kit screens for the facility page, checkout Lease step and state pages), which need a design or a "code is the design" note first.

**Closed 2026-09-23 (D-151):** step 1's owner calls and step 6 were decided as "keep the code"; no rows.
