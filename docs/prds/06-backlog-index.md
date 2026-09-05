# 06 — Backlog index

**This file is generated. Do not edit it by hand** — edit [`06-backlog.md`](06-backlog.md) and run `npm run docs:index`.

`06-backlog.md` is the source of truth and stays that way; it is also ~350 KB of wide table rows, which is more than a session should spend to answer "what is next". This is the same rows with the long description, the PRD reference and the dependency prose dropped.

**266 items — 255 complete, 11 open.**

## Open, in build order

| # | ID | Item | Size | Depends on |
|---|---|---|---|---|
| 83a | B-129 | Online auction platform listing from the auction pipeline | M | B-062, B-083 |
| 83bya | B-238 | A renter with no email address cannot be leased, and two people cannot share one | L | B-038 |
| 83byf | B-243 | A certified letter that comes back is nobody's work item | M | B-083 |
| 83byma | B-254 | `LAST_REVIEWED` on the public accessibility statement has a bump trigger | S | B-250, D-115 |
| 85 | B-085 | First real gate-vendor driver (OpenTech CIA or PTI StorLogix Cloud — needs partner agreement, PRD… | L | B-080 |
| 87a | B-133 | Google reviews ingestion + GBP API sync | M | B-087 |
| 89a | B-134 | Authored copy for a size page, when a real portfolio needs it | S | B-089 |
| 90 | B-090 | Split into six parts, 2026-08-20 | XL | B-074, B-081 |
| 90k | B-259 | A Spanish renter ticks three consent boxes written in English | M | B-090f |
| 90m | B-261 | Every email and text still goes out in English, including to a renter who rented in Spanish | L | B-090f, B-259 |
| 90n | B-262 | The Spanish stops at the signed-in product | L | B-260 |

> An item stays open until every part of it is done — several above are partly built, and their parts are recorded in [`../PROGRESS.md`](../PROGRESS.md).

## All items

| # | ID | ✅ | Item | Size | Phase |
|---|---|---|---|---|---|
| 1 | B-001 | ✅ | Monorepo & app scaffold: | M | MVP |
| 2 | B-002 | ✅ | Core data model & migrations: | L | MVP |
| 3 | B-003 | ✅ | Auth foundation: | M | MVP |
| 4 | B-004 | ✅ | RBAC roles-as-data (tenant/counter/manager/regional/owner/system) + server-side facility scoping… | M | MVP |
| 5 | B-005 | ✅ | Append-only audit log service (actor, timestamp, entity, before/after, reason codes) wired as a… | M | MVP |
| 6 | B-006 | ✅ | Background jobs + event bus foundation: | M | MVP |
| 7 | B-007 | ✅ | Admin shell: | M | MVP |
| 8 | B-008 | ✅ | Facility settings CRUD: | M | MVP |
| 9 | B-009 | ✅ | Unit type management: | S | MVP |
| 10 | B-010 | ✅ | Unit inventory: | M | MVP |
| 11 | B-011 | ✅ | Street rate management: | S | MVP |
| 12 | B-012 | ✅ | Seed & demo data script: | S | MVP |
| 13 | B-013 | ✅ | Public site shell: | M | MVP |
| 14 | B-014 | ✅ | Inventory & pricing read API with quote tokens (price seen = price charged), availability cache… | M | MVP |
| 15 | B-015 | ✅ | Location search: | M | MVP |
| 16 | B-016 | ✅ | Facility detail page: | M | MVP |
| 16a | B-093 | ✅ | Public-site remediation of shipped code | S | MVP |
| 16b | B-094 | ✅ | Admin shell remediation of shipped code | M | MVP |
| 17 | B-017 | ✅ | Unit browsing + transparent pricing: | M | MVP |
| 18 | B-018 | ✅ | Free reservation service: | M | MVP |
| 19 | B-019 | ✅ | Stripe foundation: | M | MVP |
| 20 | B-020 | ✅ | Checkout session state machine: | L | MVP |
| 21 | B-021 | ✅ | Checkout steps 1–2: | M | MVP |
| 22 | B-022 | ✅ | Protection plan: | M | MVP |
| 23 | B-023 | ✅ | Document generation service: | M | MVP |
| 24 | B-024 | ✅ | Lease template + e-sign step: | M | MVP |
| 25 | B-025 | ✅ | Payment step: | M | MVP |
| 25a | B-095 | ✅ | One task queue, not seven | M | MVP |
| 26 | B-026 | ✅ | Move-in provisioning + rollback: | M | MVP |
| 27 | B-027 | ✅ | Access Control Service: | L | MVP |
| 28 | B-028 | ✅ | SimulatedAdapter + mock gate controller + virtual keypad dev page + fault injection… | M | MVP |
| 29 | B-029 | ✅ | Gate code issuance on move-in + confirmation screen: | M | MVP |
| 30 | B-030 | ✅ | Comms core: | L | MVP |
| 31 | B-031 | ✅ | Move-in path transactional emails: | M | MVP |
| 32 | B-032 | ✅ | SMS consent capture at move-in (unchecked-by-default checkbox, disclosure versioning, stored… | S | MVP |
| 33 | B-033 | ✅ | Portal login: | M | MVP |
| 34 | B-034 | ✅ | Portal dashboard: | M | MVP |
| 35 | B-035 | ✅ | Portal one-time payment: | M | MVP |
| 36 | B-036 | ✅ | Payment methods & autopay management: | M | MVP |
| 37 | B-037 | ✅ | Portal documents & contact info: | M | MVP |
| 38 | B-038 | ✅ | Admin tenant profile: | M | MVP |
| 38a | B-096 | ✅ | Lease holds | S | MVP |
| 39 | B-039 | ✅ | Walk-in (POS) move-in + manual payments: | M | MVP |
| 39a | B-097 | ✅ | Phone & counter inquiry capture | M | MVP |
| 40 | B-040 | ✅ | Admin move-out: | M | MVP |
| 41 | B-041 | ✅ | Portal move-out request: | M | MVP |
| 42 | B-042 | ✅ | MVP reporting: | L | MVP |
| 43 | B-043 | ✅ | Billing scheduler: | M | MVP |
| 44 | B-044 | ✅ | Recurring invoice generation + proration: | L | MVP |
| 45 | B-045 | ✅ | Autopay run: | M | MVP |
| 46 | B-046 | ✅ | Failed-payment retry: | M | MVP |
| 47 | B-047 | ✅ | Late fee schedule: | S | MVP |
| 47a | B-098 | ✅ | Gate access suspension & restore on non-payment | M | MVP |
| 48 | B-048 | ✅ | Partial payments (configurable allocation order, displayed at payment time) + refunds (card via… | M | MVP |
| 49 | B-049 | ✅ | Tenant ledger screen: | M | MVP |
| 50 | B-050 | ✅ | Payment lifecycle notices: | M | MVP |
| 51 | B-051 | ✅ | Pay-now magic links: | M | MVP |
| 52 | B-052 | ✅ | Past-due dunning ladder: | M | MVP |
| 53 | B-053 | ✅ | Template editor + per-facility sender identity: | M | MVP |
| 54 | B-054 | ✅ | Message history on tenant record + shared suppression list + failure queue (hard bounce → tenant… | M | MVP |
| 55 | B-055 | ✅ | Revenue + delinquency-aging reports (billed vs collected by category; AR aging buckets with tenant… | M | MVP |
| 56 | B-056 | ✅ | Delinquency timeline configuration: | M | Phase 2 |
| 57 | B-057 | ✅ | Delinquency engine: | L | Phase 2 |
| 58 | B-058 | ✅ | Gate access suspend/restore on delinquency/cure: | S | Phase 2 |
| 59 | B-059 | ✅ | Delinquency queue: | M | Phase 2 |
| 60 | B-060 | ✅ | Field ops: | M | Phase 2 |
| 61 | B-061 | ✅ | Pre-lien/lien notice generation: | M | Phase 2 |
| 62 | B-062 | ✅ | Auction pipeline: | L | Phase 2 |
| 63 | B-063 | ✅ | Comms delinquency-stage notices + pre-lien/lien supplements (courtesy only, never claims to be the… | M | Phase 2 |
| 64 | B-064 | ✅ | Gate hours enforcement (per-facility weekly schedule, timezone/DST-safe, per-grant overrides) +… | L | MVP |
| 65 | B-065 | ✅ | ManualAdapter work queue: | M | MVP |
| 66 | B-066 | ✅ | SEO infrastructure: | L | MVP |
| 67 | B-067 | ✅ | Facility marketing profile editor: | M | MVP |
| 68 | B-068 | ✅ | Lead capture & attribution: | M | MVP |
| 69 | B-069 | ✅ | Analytics: | M | MVP |
| 70 | B-070 | ✅ | Promotions engine end-to-end: | L | MVP |
| 70a | B-100 | ✅ | Referral program core | L | Phase 2 |
| 70b | B-101 | ✅ | Referral visibility | M | Phase 2 |
| 71 | B-071 | ✅ | Reviews: | M | Phase 2 |
| 72 | B-072 | ✅ | Marketing consent + lead drip: | M | Phase 2 |
| 73 | B-073 | ✅ | Abandoned-reservation follow-up: | M | Phase 2 |
| 74 | B-074 | ✅ | SMS channel live: | L | Phase 2 |
| 75 | B-075 | ✅ | Delivery dashboard + alerting: | M | Phase 2 |
| 76 | B-076 | ✅ | Tenant rate increases: | M | Phase 2 |
| 77 | B-077 | ✅ | Unit transfer wizard: | M | Phase 2 |
| 78 | B-078 | ✅ | POS depth: | L | Phase 2 |
| 79 | B-079 | ✅ | Staff & org hardening: | M | Phase 2 |
| 79a | B-108 | ✅ | Staff MFA enrolment and sign-in: QR code, a save path for the recovery codes, and the… | M | Phase 2 |
| 80 | B-080 | ✅ | Hardware hardening: | L | Phase 2 |
| 81a | B-102 | ✅ | Monthly statements centre | M | Phase 2 |
| 81b | B-103 | ✅ | ACH bank debit + Stripe Link | M | Phase 2 |
| 81c | B-104 | ✅ | Insurance tier change + proof-of-insurance upload | M | Phase 2 |
| 81d | B-105 | ✅ | Portal self-service for the authorized-access list | M | Phase 2 |
| 81da | B-109 | ✅ | Stale copy, dead references and enum identifiers on staff screens | S | MVP |
| 81db | B-110 | ✅ | Checkout dynamic state | M | MVP |
| 81dc | B-111 | ✅ | Checkout goes both ways, and the price says what changed | M | MVP |
| 81dd | B-112 | ✅ | Checkout step 1 down to the field cap, and consumer-sized controls | M | MVP |
| 81de | B-113 | ✅ | Admin dashboard drill-through and an "All facilities" that rolls up | M | MVP |
| 81df | B-114 | ✅ | The Tenants screen lists tenants | M | MVP |
| 81dg | B-115 | ✅ | Tasks and delinquency cards name and link their subject | S | MVP |
| 81dh | B-116 | ✅ | 320px reflow on the three admin routes that fail it, and the unit list's volume | M | MVP |
| 81di | B-117 | ✅ | Navigation hierarchy, admin and portal | S | MVP |
| 81dj | B-118 | ✅ | Facility page: hero photo, sticky rent CTA, and the hold window stated before the form | M | MVP |
| 81dk | B-119 | ✅ | The accessibility scan contract | M | MVP |
| 81dl | B-120 | ✅ | The e2e suite is not repeatable, and it does not notice when it is testing the wrong application | M | MVP |
| 81dm | B-121 | ✅ | The active-duty declaration has to reach the delinquency pipeline | M | MVP |
| 81dn | B-122 | ✅ | A renter can actually enter a promo code | M | Phase 2 |
| 81do | B-123 | ✅ | Marketing SMS, or a decision not to have it | M | Phase 2 |
| 81dp | B-124 | ✅ | A validation error must not discard what was typed | M | MVP |
| 81dr | B-126 | ✅ | Reconcile D-7's promised reservation hold window against what shipped | S | MVP |
| 81ds | B-127 | ✅ | Two friends redeeming the same referral invite in the same instant DEADLOCK instead of one losing | S | Phase 2 |
| 81dt | B-128 | ✅ | City pages need copy somebody can write, or the decision that they never will | M | Phase 2 |
| 81dq | B-125 | ✅ | e2e runs against a production build, not the dev server | S | MVP |
| 81e | B-106 | ✅ | Future-dated move-ins beyond 14 days + multi-unit rental in one checkout. | L | Phase 2 |
| 81f | B-107 | ✅ | Map view with pins/price bubbles + "use my location" | M | Phase 2 |
| 82 | B-082 | ✅ | Marketing reach: | L | Phase 2 |
| 83 | B-083 | ✅ | Certified-mail API integration for lien notices with tracked proof. | M | Phase 2 |
| 83b | B-130 | ✅ | No demo lease can generate a lien notice, so B-061's generation path has never been exercised end… | S | Phase 2 |
| 83ba | B-137 | ✅ | A transfer must carry the tenant's protective state, not just their rate | M | Phase 2 |
| 83bb | B-138 | ✅ | Collections must survive a transfer | M | Phase 2 |
| 83bc | B-139 | ✅ | The accessibility statement is overstating, and its exception list is hand-written | S | MVP |
| 83bd | B-140 | ✅ | A transfer hold emails the tenant a move-in reminder for a move-in that is not happening | S | Phase 3 |
| 83be | B-141 | ✅ | "Complete" on `/admin/tasks` silently does nothing when the note is empty | M | MVP |
| 83bf | B-142 | ✅ | The portal transfer screen swallows every failure, states no expiry, and has no date ceiling | S | Phase 3 |
| 83bg | B-143 | ✅ | An inbound text is truncated on the card and readable nowhere else | S | Phase 3 |
| 83bh | B-144 | ✅ | `Promotion.minStayMonths` configures nothing, because nothing can set it | S | MVP |
| 83bi | B-145 | ✅ | Recapture when a promoted lease ends before its minimum stay | M | MVP |
| 83bj | B-146 | ✅ | There is no returned-payment path at all | M | MVP |
| 83bk | B-147 | ✅ | Card disputes reach nothing | M | MVP |
| 83bl | B-148 | ✅ | Waitlist and lead forms announce success to nobody | S | MVP |
| 83bm | B-149 | ✅ | Checkout's unit-lost branch is still a dead end | M | MVP |
| 83bn | B-150 | ✅ | AR aging sits under a month picker and always answers "as of today" | S | MVP |
| 83bo | B-151 | ✅ | An overlock outlives the lease it was applied to | M | Phase 2 |
| 83bp | B-152 | ✅ | A rate-increase notice is recorded as sent with no delivery check | M | Phase 2 |
| 83bq | B-153 | ✅ | There is no way to lower an existing tenant's rate | M | Phase 2 |
| 83br | B-154 | ✅ | The waitlist cannot be taken at the counter, and the demand report withholds the phone numbers it… | S | Phase 3 |
| 83bs | B-155 | ✅ | Protection attach rate is not measured anywhere | S | MVP |
| 83bt | B-156 | ✅ | The scan contract II: post-interaction states, parameterised routes, and a control that does nothing | M | MVP |
| 83bv | B-158 | ✅ | A gate command can be skipped by clock skew between the app and the database | S | Phase 2 |
| 83bu | B-157 | ✅ | The staff side of D-85: a lien-pipeline transfer needs approval, a reason code and an unreset clock | M | Phase 2 |
| 83bva | B-159 | ✅ | The public accessibility statement is overstating again, in two sentences | S | MVP |
| 83bvb | B-160 | ✅ | A lien transfer leaves the auction file pointing at the wrong unit and posts the sale proceeds to… | M | Phase 2 |
| 83bvc | B-161 | ✅ | A bounced check or a chargeback replays the entire delinquency ladder in one night | M | Phase 2 |
| 83bvd | B-162 | ✅ | A transfer re-prices to street, drops any in-flight rate increase, and resets the ECRI clock to zero | M | Phase 2 |
| 83bve | B-163 | ✅ | Proof of insurance stops being monitored the moment a tenant transfers units | M | MVP |
| 83bvf | B-164 | ✅ | A tenant whose goods are in the lien pipeline can still schedule a move-out from the portal | S | Phase 2 |
| 83bvg | B-165 | ✅ | Batch ECRI raises every eligible tenant straight to full street rate, with no cap and no… | M | Phase 2 |
| 83bvh | B-166 | ✅ | A rate increase held for an undelivered notice has no way back — the only control is Cancel | M | Phase 2 |
| 83bvi | B-167 | ✅ | Six configurable fee types can be configured and cannot be charged, and no ad-hoc charge exists… | M | MVP |
| 83bvj | B-168 | ✅ | A promotional recapture cannot be waived, argued down, or partially forgiven at the counter | M | MVP |
| 83bvk | B-169 | ✅ | Nothing finds the overlocks already stuck, and the removal task tells staff the tenant has paid… | S | Phase 2 |
| 83bvl | B-170 | ✅ | The task-completion form asks for two of the four proof fields, and announces nothing when it works | M | MVP |
| 83bvm | B-171 | ✅ | Both public marketing forms are silent on the error path | S | MVP |
| 83bvn | B-172 | ✅ | Checkout's unit-lost branch says your answers are still here, gives no way to use them, and reads… | M | MVP |
| 83bvo | B-173 | ✅ | The date you typed is not the date that posts — all four move-out and transfer screens | S | MVP |
| 83bvp | B-174 | ✅ | The portal move-out money panel vanishes with no message, and the date has no ceiling | S | MVP |
| 83bvq | B-175 | ✅ | The signed lease states the minimum stay and never states the charge | S | MVP |
| 83bvr | B-176 | ✅ | Minimum stay and recapture policy are two settings on two screens, neither mentioning the other | S | MVP |
| 83bvs | B-177 | ✅ | Lowering a tenant's rate asks for a lease ID and never says whose rate you just cut | M | Phase 2 |
| 83bvt | B-178 | ✅ | "Charge the fee?" does not say how much, and the option labelled Yes carries the value `no` | S | MVP |
| 83bvu | B-179 | ✅ | A returned payment tells the tenant to phone, on a screen that could take the money | S | MVP |
| 83bvv | B-180 | ✅ | The lead screen's waitlist capture is labelled only by placeholder and types the email once per size | S | Phase 3 |
| 83bvw | B-181 | ✅ | The tenant profile is seventeen stacked sections and the third one is a support-session form | M | MVP |
| 83bvx | B-182 | ✅ | Customer-facing copy asks tenants to "ring the office" and explains itself with internal reasoning | S | MVP |
| 83bvy | B-183 | ✅ | AR aging sits under a month picker that does not govern it, and the fix is a paragraph | S | MVP |
| 83bvz | B-184 | ✅ | The scan contract III: states the route list cannot express, and the assertions that were only… | M | MVP |
| 83bwa | B-185 | ✅ | The unit test database accumulates fixtures until the sweep stops being trustworthy | M | MVP |
| 83bwb | B-186 | ✅ | Every walk-in tenant is recorded as having given no notice at all | S | MVP |
| 83bwc | B-187 | ✅ | The accessibility statement's one strengthened sentence is false again, and B-184's own record… | S | MVP |
| 83bwd | B-188 | ✅ | A payment plan counts money that came back, and money that was never meant for it | M | Phase 3 |
| 83bwe | B-189 | ✅ | Autopay does not know a payment plan exists, in either direction | M | Phase 3 |
| 83bwf | B-190 | ✅ | Nothing caps what a payment plan may defer, or how many times a lease may defer it | M | Phase 3 |
| 83bwg | B-191 | ✅ | A payment plan tells the tenant nothing — not when it is agreed, not before an installment, not… | M | Phase 3 |
| 83bwh | B-192 | ✅ | The payment-plan builder announces nothing, names nothing, and sits where D-95 says it must not | M | Phase 3 |
| 83bwi | B-193 | ✅ | The tenant's plan page has exactly one way in, and it vanishes the moment the plan breaks | S | Phase 3 |
| 83bwj | B-194 | ✅ | B-186's two notice forms throw away the server's refusal, and the screen still promises a charge… | PRD 02 §4.4 US-14 (move-out), §5.5 FR-16–FR-24; PRD 01 §4.7 US-707; D-10 | B-186, B-170, B-167 |
| 83bwk | B-195 | ✅ | No report can say who is on a plan, so every aging figure has a hole in it | M | Phase 3 |
| 83bwl | B-196 | ✅ | The scan contract IV: an exemption checked once on one element now suppresses that check… | M | MVP |
| 83bwm | B-197 | ✅ | The four monetary limits that decide who may give money away are reachable only from a database… | S | Phase 3 |
| 83bwn | B-198 | ✅ | Every email this product sends is one `<p>` of text, and the template editor is why | PRD 05 FR-9a, FR-21, CN-16, CN-24; PRD 02 §5.5; D-102 | B-053, B-191 |
| 83bwo | B-199 | ✅ | Six e2e tests have failed on a phone viewport for four items running, and each one wrote down that… | S | MVP |
| 83bwp | B-200 | ✅ | Three e2e tests in `admin-reports.spec.ts` assert stale expectations, and one of them means the… | S | MVP |
| 83bwq | B-201 | ✅ | No dynamic admin route has ever been reflow-checked, and `[contain:layout]` means the check that… | S | MVP |
| 83a | B-129 |  | Online auction platform listing from the auction pipeline | M | Phase 2 |
| 83bwr | B-202 | ✅ | A payment plan does not stop a scheduled auction, and today's lot sheet will advertise the unit… | S | Phase 2 |
| 83bws | B-203 | ✅ | A tenant who pays exactly the installment they were told to pay still breaks their plan | M | Phase 2 |
| 83bwt | B-204 | ✅ | An installment charge ignores `halt_autopay`, so we take money from a bankrupt, a servicemember… | S | Phase 2 |
| 83bwu | B-205 | ✅ | The lot sheet omits the columns a lien advertisement is legally required to carry, and renumbers… | M | Phase 2 |
| 83bwv | B-206 | ✅ | A staff-cancelled plan tells the tenant nothing, and the break notice does not say which payment… | M | Phase 2 |
| 83bww | B-207 | ✅ | The chased/halted split reached the drill-down and not the roll-up, the emailed report, or the… | M | Phase 2 |
| 83bwx | B-208 | ✅ | A payment plan halts late fees and dunning on rent the plan never deferred, for up to 90 days | M | Phase 2 |
| 83bwy | B-209 | ✅ | "Collected under plans" counts money nobody collected, and correcting a mistyped plan burns the… | S | Phase 2 |
| 83bwz | B-210 | ✅ | A tenant one day late is told their plan is dead, and a plan that broke in March still says so in… | M | Phase 3 |
| 83bx | B-211 | ✅ | Three screens describe behaviour the product does not have | S | Phase 2 |
| 83bxa | B-212 | ✅ | The payment-plan builder is offered where it cannot work, and where it can, it demands cent-exact… | M | Phase 2 |
| 83bxb | B-213 | ✅ | The builder's per-installment refusal reaches no assistive technology, and no test in the repo… | S | Phase 2 |
| 83bxc | B-214 | ✅ | The accessibility statement's hand-check sentence is false for two of the five waiver paths | M | Phase 2 |
| 83bxd | B-215 | ✅ | The scan contract V: the layout loops reach routes but never states, so both customer-facing… | M | Phase 2 |
| 83bxe | B-216 | ✅ | The aging report attaches its facility name with `scope="rowgroup"`, which no screen reader… | S | Phase 2 |
| 83bxf | B-217 | ✅ | Seven staff tables now scroll sideways on a phone, and B-199 explicitly left the call open | M | Phase 2 |
| 83bxg | B-218 | ✅ | `gh pr ready` runs no e2e, so the heavy lane has never once gated a pull request | S | Phase 2 |
| 83bxh | B-219 | ✅ | The document store promises "newest first" and cannot keep it for two documents written in the… | S | Phase 2 |
| 83bxk | B-222 | ✅ | The revenue report attaches its facility name with `scope="rowgroup"` too, and unlike the aging… | M | Phase 2 |
| 83bxi | B-220 | ✅ | Two month-turn defects in the reports section, found together and distinct: the pack defaults to a… | M | Phase 2 |
| 83bxl | B-223 | ✅ | A portfolio report has no timezone, so its default month is UTC's and can name a month still… | M | Phase 2 |
| 83bxj | B-221 | ✅ | `a refused completion says why` guards only an EMPTY task queue, and failed for the first time on… | S | Phase 2 |
| 83bxm | B-224 | ✅ | A sale can be scheduled before the notice deadline, and sold with no advertisement on file | M | Phase 2 |
| 83bxma | B-244 | ✅ | The portal dashboard states your balance and your payment plan before it says which unit they… | PRD 01 US-702, §6.8, §6.8.1 (portal dashboard); B-215 | B-215 |
| 83bxn | B-225 | ✅ | Money paid ahead has nowhere to live, so the tenant who prepaid is charged a late fee and then… | L | Phase 2 |
| 83bxo | B-226 | ✅ | The facility page advertises a promotion, says it is already in the total, and leaves it out of… | S | Phase 2 |
| 83bxp | B-227 | ✅ | Three screens state a monthly charge with the sales tax left out, and the payment step says… | M | Phase 2 |
| 83bxq | B-228 | ✅ | The same payment-plan installment is due on two different days, one tap apart | M | Phase 2 |
| 83bxr | B-229 | ✅ | A nightly job that fails writes a row and tells nobody, and the one screen that shows it speaks in… | M | Phase 2 |
| 83bxs | B-230 | ✅ | The counter cannot take a card, a walk-in move-in cannot take cash or a check, and every counter… | L | Phase 2 |
| 83bxt | B-231 | ✅ | The counter takes payments on a screen that never shows what the tenant owes, and cannot take one… | M | Phase 2 |
| 83bxu | B-232 | ✅ | The portal asks a past-due tenant for money without saying what it is for, or what paying it buys | M | Phase 2 |
| 83bxv | B-233 | ✅ | Task assignment is built, tested and reachable from nothing, so "my day" is everyone's day | M | Phase 2 |
| 83bxw | B-234 | ✅ | An auction surplus becomes overdue a year later and nothing anywhere says so | S | Phase 2 |
| 83bxx | B-235 | ✅ | The approvals the product itself requires have no cross-facility worklist | M | Phase 2 |
| 83bxy | B-236 | ✅ | The hourly cron runs every facility serially inside one 300-second request, and what it drops is… | M | Phase 2 |
| 83bxz | B-237 | ✅ | There is no way to create a facility, and one created by hand takes rent and does nothing else | M | Phase 2 |
| 83bya | B-238 |  | A renter with no email address cannot be leased, and two people cannot share one | L | Phase 2 |
| 83byb | B-239 | ✅ | The move-in confirmation hands the renter nothing to do next, and the portal's one permanent… | M | Phase 2 |
| 83byc | B-240 | ✅ | The tenant profile is 2,086 lines in one column with no way to reach anything | PRD 02 US-13; D-95; D-114; B-217 | B-217 |
| 83byd | B-241 | ✅ | Sixteen reports in one flat row, under a navigation label that is wrong for a third of them | S | Phase 2 |
| 83bye | B-242 | ✅ | A search result quotes a price with no size attached, and carries no photo | M | Phase 2 |
| 83byf | B-243 |  | A certified letter that comes back is nobody's work item | M | Phase 2 |
| 83byh | B-245 | ✅ | Eight live regions per lease are server-rendered already populated, and a client-side navigation… | M | Phase 2 |
| 83byi | B-246 | ✅ | The scan contract VI: the layout half has no exception list, so two payment-plan states shipped in… | PRD 01 §6.8; PRD 02 §5.5 FR-25; B-201, B-215 | B-215 |
| 83byj | B-247 | ✅ | The Manage menu's six links are 20px tall on the phone the menu exists for | PRD 01 §6.2, §6.8; B-117 | B-117 |
| 83byk | B-248 | ✅ | The payment-plan builder's running total announces on every keystroke, and the comment asserting… | S | Phase 2 |
| 83byl | B-249 | ✅ | Fifty-six keyboard-focusable scroll regions have no role and no accessible name | M | Phase 2 |
| 83bym | B-250 | ✅ | The accessibility statement's review date is structurally frozen, and B-218 flipped one of its… | S | Phase 2 |
| 83byma | B-254 |  | `LAST_REVIEWED` on the public accessibility statement has a bump trigger | S | Phase 2 |
| 83byn | B-251 | ✅ | The current month on the management pack is a 1.09:1 tint plus a font-weight bump | S | Phase 2 |
| 83byo | B-252 | ✅ | Two unit tests began failing permanently at 12:00 CDT today, and the second is only the first… | S | Phase 2 |
| 83byp | B-253 | ✅ | `npm run db:migrate` points at the Neon cloud dev branch and offers to reset it, and the two… | S | Phase 2 |
| 83byq | B-255 | ✅ | A web move-in's payment never reaches the ledger, so every card move-in reads as owing its whole… | M | Phase 2 |
| 84 | B-084 | ✅ | Split into four parts, 2026-08-18 | M | Phase 2 |
| 83c | B-132 | ✅ | The demo leases that were delinquent in name only now owe real money | S | Phase 2 |
| 84a | B-131 | ✅ | Unit occupancy is now historical, and says which instant it answers for when it cannot be | M | Phase 2 |
| 85 | B-085 |  | First real gate-vendor driver (OpenTech CIA or PTI StorLogix Cloud — needs partner agreement, PRD… | L | Phase 3 |
| 86 | B-086 | ✅ | Split into two parts, 2026-08-25 | L | Phase 3 |
| 87 | B-087 | ✅ | Split into two parts, 2026-08-20 | M | Phase 3 |
| 87a | B-133 |  | Google reviews ingestion + GBP API sync | M | Phase 3 |
| 88 | B-088 | ✅ | Split into two parts, 2026-08-19 | M | Phase 3 |
| 89 | B-089 | ✅ | Per-city/size landing pages | M | Phase 3 |
| 89a | B-134 |  | Authored copy for a size page, when a real portfolio needs it | S | Phase 3 |
| 90 | B-090 |  | Split into six parts, 2026-08-20 | XL | Phase 3 |
| 90a | B-090a | ✅ | Waitlists with notify-me | M | Phase 3 |
| 90b | B-135 | ✅ | An inbound text nobody sees — now a task somebody works | S | Phase 3 |
| 90c | B-090b | ✅ | Tenant self-service transfer, as a request | M | Phase 3 |
| 90d | B-136 | ✅ | A transfer quote that nothing honours | S | Phase 3 |
| 90e | B-090c | ✅ | Delinquency payment plans and self-cure | L | Phase 3 |
| 90f | B-090d | ✅ | Broadcast sends — one message to a site's tenants | M | Phase 3 |
| 90g | B-090e | ✅ | Business accounts — the payer above the lease | L | Phase 3 |
| 90ga | B-257 | ✅ | One payment settled several leases and the ledger only credited one of them | M | Phase 3 |
| 90h | B-256 | ✅ | The business account's portal half: one card and one Pay button | M/L | Phase 3 |
| 90i | B-258 | ✅ | Authorized users on a business account: the people allowed to see it | M | Phase 3 |
| 90j | B-090f | ✅ | Spanish on the move-in path | L | Phase 2 |
| 90k | B-259 |  | A Spanish renter ticks three consent boxes written in English | M | Phase 2 |
| 90l | B-260 | ✅ | The Spanish stops at the move-in path | L | Phase 2 |
| 90m | B-261 |  | Every email and text still goes out in English, including to a renter who rented in Spanish | L | Phase 2 |
| 90n | B-262 |  | The Spanish stops at the signed-in product | L | Phase 2 |
| 91 | B-091 | ✅ | Split into two parts, 2026-08-19 | L | Phase 2 |
| 92 | B-092 | ✅ | Impersonation oversight | M | Phase 2 |
