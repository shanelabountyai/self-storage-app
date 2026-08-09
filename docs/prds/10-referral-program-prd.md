# PRD 10 — Refer a Friend

**Product:** Self-Storage Business Application (learning project)
**Feature:** Tenant-to-prospect referral program — refer someone, they rent, you both get $50 off one month
**Status:** Draft v1.0 — 2026-08-09
**Author:** Product Management
**Sibling PRDs:** `02-admin-dashboard-prd.md` (§4.5 billing — money is applied here, never here-adjacent), `04-marketing-seo-prd.md` (§3.6 promotions, §3.5 lead attribution — a referral is an acquisition channel), `05-communications-prd.md` (FR-21 consent, §6.1 suppression), `01-customer-website-prd.md` (§6.8 accessibility, the portal surface a referrer uses), `00-master-prd.md` (§7 cross-cutting)

> **Scope note:** This is a *feature* PRD, not a sixth module. It spans the tenant portal (where a referrer mints and texts an invite), the public site (where a prospect arrives), the promotions engine (which computes the discount) and billing (which applies it). It inherits every cross-cutting requirement in master PRD §7 without restating them.

> **Legal disclaimer:** Referral incentives touch CAN-SPAM, TCPA and — in some states — consumer-protection and unclaimed-property law. Every piece of notice and terms text implied here is **draft-only and not legal advice**, and must be reviewed by a licensed attorney before the program runs against real tenants. §9 lists the specific questions to take to that review.

---

## 1. Overview & Goals

### 1.1 Problem

Roughly half of self-storage rentals start with a phone call or a walk-in (PRD 02 US-43), and the cheapest of those come from somebody who already rents here telling a friend. That recommendation currently has no shape: the friend arrives as an ordinary web or phone lead, nobody knows who sent them, and the tenant who did the work gets nothing.

Meanwhile the same rental bought through an aggregator costs a per-move-in fee (PRD 04 §2). A referral that converts is the cheapest acquisition this business has, and it is the only channel that is completely unmeasured.

### 1.2 Goals

1. A current tenant can text a friend a single-use invite code in under ten seconds from the portal, in one tap, with no form to fill in.
2. A prospect who arrives on that link and completes a move-in earns **$50 off one month for each of them** — the new tenant on their first invoice, the referrer on their next one.
3. Referral becomes a first-class acquisition channel in the funnel and revenue reports, comparable against paid, organic and aggregator.
4. The reward is applied by the billing engine as an ordinary discount, so it appears in the ledger, on the invoice, and in the revenue report with no special-case reporting path.
5. The program cannot be farmed. Self-referral, throwaway accounts and refer-and-move-out are anticipated rather than discovered.

### 1.3 Non-goals

- **Cash payouts.** The reward is account credit against storage, never money out. Cash would raise money-transmission and unclaimed-property questions this project has no reason to take on.
- **Multi-level or chain referrals.** A refers B, B refers C: A gets nothing for C. Anything else is a pyramid shape and is out of scope permanently, not just at MVP.
- **The system emailing a prospect on a tenant's behalf.** See §5.2 — this is the central design decision and it is a deliberate non-goal, not an omission.
- **Referrals between staff, or staff referring tenants.** Staff-originated leads are B-097's counter capture and are compensated, if at all, by employment rather than by discount.
- **Retroactive credit.** A tenant who mentions a friend after that friend has already moved in does not get a link applied backwards. §9 Q3 revisits this.
- **Variable or negotiated reward amounts per referrer.** Two amounts — referrer and referee — set per facility by management and changeable going forward only. Not per tenant, not negotiable at the counter: a discount somebody can argue their way into is one they will.

---

## 2. Personas

| Persona | What they need |
|---|---|
| **Existing tenant (referrer)** | To text a friend a code from their own phone in one tap. To know whether it worked, without asking anybody. |
| **Prospect (referee)** | To understand, before they pay, that $50 is coming off — and which month. |
| **Facility manager** | To see referral as a channel next to the others, and to be able to explain to a tenant at the counter why a credit has or has not appeared. |
| **Owner** | To know whether the program pays for itself against the aggregator fee it is meant to displace. |

---

## 3. The reward, precisely

A referral pays **$50 off one month, to each party** — and the amount is **set by management, per facility**, not hardcoded (`referralRewardCents`, default 5000). Changing it applies to referrals qualifying from then on; anything already qualified keeps the amount it was promised (§6.1).

Both sides are separately configurable (`referralRewardCents` and `refereeRewardCents`), because "give the new customer $75 and the referrer $25" is a real campaign an operator will want to run, and a single shared field would need a schema change to allow it. Both default to 5000.

| | Who | When it applies | Mechanism |
|---|---|---|---|
| **Referee** | The new tenant | Their **first** rent invoice | A `discount` line item, exactly like a promotion (PRD 04 FR-PROMO-4) |
| **Referrer** | The existing tenant | Their **next** rent invoice after qualification | The same `discount` line item on their own next invoice |

Three consequences worth stating rather than leaving to be discovered:

- **The referee's $50 is not applied at checkout.** The first invoice under anniversary billing (D-27) is generated at move-in, and that is where the discount lands. The checkout total shown before payment reflects it — US-12 AC1's rule that "the discounted first-invoice amount is shown before payment" applies here identically.
- **The referrer may wait.** If their next invoice is 26 days away, the credit is 26 days away. The portal says which date, because "you'll get it eventually" is the version that generates a phone call.
- **Neither reward is cash and neither is refundable.** A tenant who moves out with an unused referral credit loses it. This must be in the terms text and is on the attorney list (§9 Q1).

---

## 4. Qualification — what counts as "they sign up"

The single most consequential definition in this PRD, because it decides what the business pays for.

**A referral qualifies when the referee's move-in is complete AND their first payment has cleared.**

Not at reservation: a free hold costs nothing and expires on its own, and paying $50 a hold is a business somebody will discover within a week.
Not at move-in alone: a move-in whose card is later declined or charged back would have paid out on a rental that produced no money.
Not at lease signature: same reason.

Concretely, qualification fires on the same signal B-069's `move_in_completed` uses, gated on the move-in payment having reached `succeeded`.

### 4.1 Clawback

A referral that qualified and then unwound is reversed:

- The referee's payment is **refunded in full** within the clawback window → both rewards are cancelled. Applied credits are reversed with an offsetting ledger entry, never by deleting the original (FR-8's append-only rule).
- The referee **moves out inside the minimum stay** (`referralMinimumStayDays`, default 30) → both rewards are cancelled if not yet applied; already-applied rewards are **not** clawed back. Taking $50 back off somebody's final bill to punish them for leaving is a review, not a recovery.

The asymmetry is deliberate: an unwound *payment* means the rental never really happened, while an early *move-out* means it happened and ended. Only the first is a reason to take the money back.

---

## 5. Functional Requirements

### 5.1 The invite code — one code, one friend, one use (FR-REF-1)

**Each invite is a single-use code, minted per friend, not one permanent code per tenant.** (Owner decision, 2026-08-09.)

The obvious design is a permanent per-tenant code — simpler, and one row per tenant. It is also the one that gets posted to a coupon site, and from then on the business pays $50 to a stranger for every rental it would have got anyway, with the tenant collecting the other $50. An annual per-referrer cap bounds that exposure but does not stop it, and the tenant who posted it has done nothing wrong by the program's own rules.

Single-use codes close it structurally rather than by policy: a code that has been redeemed is dead, so a posted code is worth exactly one rental to whoever finds it first, and the tenant's remaining invites are unaffected.

The friction cost is nil, because the code is minted **by the act of sharing**:

- Tapping **Invite a friend** mints a fresh `ReferralInvite` and opens the share sheet with the message pre-filled — one tap, same as a static link.
- The code is short and unambiguous: 8 characters from an alphabet excluding `0/O` and `1/I/l`, so it survives being read aloud over a phone.
- `/r/{code}` sets the referral attribution cookie and 302s to the referrer's own facility page.
- An unused invite expires after `referralInviteExpiryDays` (default 60) so a tenant's outstanding invites do not accumulate forever, and the exposure has a horizon.
- Outstanding unredeemed invites per tenant are capped (`referralOpenInviteCap`, default 5) — minting a hundred and posting them all is the same attack wearing a different hat.

- **AC:** an invite is consumed the moment a referral **qualifies** (§4), not when the link is clicked. A friend who clicks and does not rent has not used anything up, and the tenant can share the same invite again.
- **AC:** the portal shows outstanding invites, each with its code and share control, plus the plain-language terms. The code is selectable text and works without JavaScript (PRD 01 §6.8).
- **AC:** a tenant with no active lease sees why they cannot refer, not a broken link.
- **AC:** a redeemed or expired code lands the visitor on the facility page normally, with no error and no referral attached. A prospect must never see "this code is dead" — that is a conversation between the business and the tenant, not something to fail a stranger's page load with.

### 5.2 How the invite reaches the friend (FR-REF-2) — **the central decision**

**The tenant texts it from their own phone. The system never sends an email or SMS to a prospect.**

This is a text message, which is what an owner picturing this feature has in mind and is the right channel — a storage referral happens in a conversation, not an email thread. The distinction that matters is *who sends it*: tapping **Invite a friend** opens the tenant's own Messages app with the code and a short line pre-filled, and the tenant hits send. From the tenant's side that is "refer by text" exactly as expected. From the business's side it is a message between two friends, and this system is not the sender.

This is the whole design of the feature and it is not a simplification:

The alternative — a "give us your friend's number and we'll text them" field — is the version to avoid, and the gap between the two is not stylistic:

- It makes *this business* the sender of an unsolicited commercial message to somebody who never gave consent. CAN-SPAM liability attaches to the sender, not to the person who typed the address, and forward-to-a-friend has been the subject of FTC enforcement.
- As **SMS** it is squarely a TCPA problem, where damages are statutory and **per message** — $500, trebled to $1,500 for a willful violation. A referral program that texted a thousand friends is a six-figure exposure on a feature designed to save aggregator fees.
- PRD 05 FR-21 requires captured consent before any marketing message, and a number typed by a third party is by definition not consent.
- The suppression list (PRD 05 CN-20) cannot protect somebody it has never heard of.

So: no recipient field, no "we'll send it for you", no address-book import — at MVP or ever. Getting the tenant's thumb to press send costs one extra tap and removes the entire category.

- **AC:** there is no input anywhere in this feature that accepts a third party's email address or phone number.
- **AC:** the share control uses the native share sheet where available (`navigator.share`, which opens Messages on a phone) with a pre-filled body, and falls back to copy-to-clipboard, then to selectable text.
- **AC:** the pre-filled text is editable by the tenant before sending. It is their message.

### 5.3 Attribution (FR-REF-3)

- `/r/{code}` sets a first-party referral cookie, 90 days, alongside B-068's existing attribution cookies.
- A lead or reservation created while that cookie is present records the referring tenant.
- The derived marketing channel is **`referral_tenant`** — distinct from `referral` (a link from another website), because the two have completely different costs and the report exists to tell them apart.
- **AC:** referral attribution survives the canonical-URL redirect, the same trap B-068 hit and fixed.
- **AC:** last-touch does not overwrite a referral. If somebody arrives on a tenant's link and later clicks an ad, the referral still pays: the tenant did the work, and the alternative teaches tenants the program does not work.

### 5.4 Fraud controls (FR-REF-4)

Anticipated rather than discovered. Each rule below exists because the program is money and money attracts effort.

| Rule | Why |
|---|---|
| A tenant cannot refer themselves — matched on email, phone (last 10 digits) and payment fingerprint | The first thing anyone tries |
| A referee who has ever held a lease at this org is not a new tenant and does not qualify | Otherwise a move-out and move-in pays $100 |
| One qualifying referral per referee, ever | A person can be referred once |
| Per-referrer cap, per rolling 12 months (`referralAnnualCap`, default 10) | Bounds the exposure of a single farmed account |
| Outstanding unredeemed invites capped (`referralOpenInviteCap`, default 5) | Minting a hundred codes and posting them is the same attack in a different hat |
| Program-wide budget per facility per month, configurable, **advisory** | An owner should know before the invoice, not after |
| Both parties must be at the **same** facility unless the operator opts into cross-facility | Referrals are local; cross-facility is a different economic bet |

- **AC:** every refusal is recorded with a reason, visible to staff on the referral record. A tenant asking "why didn't I get my $50" must be answerable at the counter in one screen.
- **AC:** a refused referral never silently drops. The referee's move-in completes at the standard rate with the reason logged — the same graceful-fallback rule as FR-PROMO-5.

### 5.5 Interaction with promotions (FR-REF-5)

PRD 04 FR-PROMO-4 sets one promo per reservation at MVP. A referral reward is **not** a promotion for that purpose — it is a separate discount, and the two may stack.

The argument: a promotion is a price the business is advertising, and a referral reward is a payment for work a tenant did. Refusing to stack them means a friend referred during a "first month free" campaign brings in a rental and earns nothing, which teaches tenants not to bother precisely when marketing is trying hardest.

- **AC:** stacked discounts can never exceed the rent for the period. The floor is zero, never a credit.
- **AC:** the invoice shows two separate discount lines with distinct descriptions, not one merged figure.

### 5.6 Visibility to the referrer (FR-REF-6)

- **AC:** the portal lists each referral by first name and initial only (`Sam T.`), its state, and — once qualified — the date the credit lands.
- **AC:** states are `shared` (link used, no lease), `pending` (moved in, payment not cleared or inside clawback), `earned`, `refused` (with a plain-language reason), `expired`.
- **AC:** the referee's identity beyond first name and initial is never shown. The referrer knowing their friend's unit number, balance or move-in date is a privacy leak the friend never agreed to.

### 5.7 Staff and owner surfaces (FR-REF-7)

- **AC:** a referral record is visible on both tenants' profiles, with the reward state and, when refused, the rule that refused it.
- **AC:** the funnel report (PRD 04 US-15 AC4) can filter to `referral_tenant`.
- **AC:** the revenue report's discount line (PRD 02 US-39.5) splits referral rewards from promotional discounts, because one is acquisition cost and the other is a price decision.
- **AC:** cost per referred move-in is reportable against the aggregator fee it displaces — the number that decides whether the program continues.

---

## 6. Data & Integration Points

### 6.1 Entities

- **`ReferralInvite`** — one code, one use. `code` unique, `referrerTenantId`, `facilityId`, `createdAt`, `expiresAt`, `redeemedAt?`, `redeemedByReferralId?`.
- **`Referral`** — `inviteId`, `referrerTenantId`, `refereeLeadId?`, `refereeTenantId?`, `refereeLeaseId?`, `facilityId`, `state`, `refusedReason?`, `qualifiedAt?`, `referrerRewardCents`, `refereeRewardCents`, `referrerRewardInvoiceId?`, `refereeRewardInvoiceId?`, timestamps.
- **`Facility`** gains `referralEnabled` (**default false**), `referralRewardCents` (5000), `refereeRewardCents` (5000), `referralMinimumStayDays` (30), `referralAnnualCap` (10), `referralInviteExpiryDays` (60), `referralOpenInviteCap` (5).

Every one of those facility fields is a **new column that configures behaviour, so each gets its control in the same backlog item** — this codebase's first hard-won rule, learned when `billingPolicy`, `invoiceLeadDays` and the late-fee ladder all shipped reachable only from a database client.

Both reward amounts are snapshotted onto the `Referral` at qualification, for the same reason the promo schedule is (FR-PROMO-4): changing the program next quarter must not silently rewrite what somebody was already promised.

**Redeeming an invite is atomic.** A conditional update — mark redeemed *where* `redeemedAt IS NULL` — is what makes "one use" true against two friends completing a move-in in the same minute, rather than a check-then-write that both pass. Same rule and same reason as FR-PROMO-5's redemption caps.

### 6.2 Billing hand-off

Referral rewards reach invoices through the **same** structured-discount path B-070 builds for promotions. Marketing owns the definition and the qualification; billing owns the money. No second discount mechanism.

### 6.3 Comms

Four templates, all to people who have a relationship with this business — never to the prospect:

| Event | To | Says |
|---|---|---|
| `referral.qualified` | Referrer | Your friend moved in; $50 comes off your invoice on {date} |
| `referral.qualified` | Referee | $50 is coming off your first invoice |
| `referral.refused` | Referrer | Why, in plain language |
| `referral.clawed_back` | Both | What changed and why |

All `transactional` by classification: these describe a change to money on an existing account, not marketing.

---

## 7. Accessibility

Inherits PRD 01 §6.8 in full. Specific to this flow:

- The copy-link control announces success through a live region present at page load, not by swapping the button's own label — a screen-reader user who cannot see the button change hears nothing otherwise.
- `navigator.share` is progressive enhancement; the keyboard path never depends on it.
- Referral state is text, never a coloured dot (1.4.1).
- The terms are page content, not a tooltip.

---

## 8. Phasing

**MVP (this PRD):** link, share, attribution, qualification on move-in-plus-payment, both discounts through the promotions path, fraud rules in §5.4, portal visibility, staff visibility, channel in the funnel.

**Phase 2:** program budget enforcement (advisory becomes blocking), cross-facility opt-in, referral leaderboard, cost-per-referred-move-in in the owner dashboard, reminder to a referrer whose link has been used but not converted.

**Never:** cash payouts, chain referrals, system-sent invites to prospects.

---

## 9. Open Questions — for the attorney pass

1. **Unclaimed property.** A tenant moves out with an unapplied earned credit. Does an account credit tied to future service constitute unclaimed property in Texas? This PRD forfeits it; that answer needs checking before the program runs.
2. **1099 / income reporting.** Account credit is generally not reportable, but a per-referrer annual cap of 10 × $50 = $500 sits near thresholds that exist for other instrument types. Confirm.
3. **Retroactive credit.** A tenant says "I sent you my neighbour last week." §1.3 excludes it, which is the defensible position but is also the one that makes staff argue at the counter. Decide deliberately.
4. **Terms text.** "$50 off one month" needs to say: which month, that it is not cash, that it is forfeited on move-out, and that the operator may end the program. Draft-only until reviewed.
5. **Cross-facility referrals** and the state-configurability rule (D-10) — does anything here vary by state?
6. **Employee households.** Whether a staff member's family may participate is a policy question, not a technical one.

---

## 10. Acceptance Summary

The feature is done when a tenant can tap once to text a friend a single-use code from their own phone, a prospect who follows it and moves in sees $50 off their first invoice before they pay, the referrer sees $50 off their next one with the date, both discounts appear as ordinary line items in the ledger and in the revenue report split from promotional discounts, every fraud rule in §5.4 refuses with a reason a staffer can read aloud, both reward amounts are editable per facility by a manager, a redeemed code cannot be redeemed twice under concurrency, and nowhere in the feature is there a field that accepts a third party's email address or phone number.
