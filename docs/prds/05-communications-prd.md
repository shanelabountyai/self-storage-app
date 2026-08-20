# PRD 05 — Communications & Notifications

**Product:** Self-Storage Business Application (learning project)
**Module:** Communications & Notifications (email + SMS notification service, payment reminder engine)
**Status:** Draft v1.0 — 2026-07-30
**Author:** Product Management
**Sibling PRDs:** `00-master-prd.md` (vision, stack, shared data model, event bus), `01-customer-website-prd.md` (tenant portal, pay screen), `02-admin-dashboard-prd.md` (billing engine, delinquency pipeline, notice generation), `03-hardware-integrations-prd.md` (gate/access events), `04-marketing-seo-prd.md` (marketing consent model, drips, suppression)

> **Legal disclaimer:** This document describes software behavior touching TCPA, CAN-SPAM, carrier A2P rules, and state lien-notice law. It is written to professional product standards for a learning project and **is not legal advice**. Consent disclosure copy, notice templates, quiet-hour edge cases, and per-state delivery requirements must be reviewed by a licensed attorney before real tenants receive real messages.

---

## 1. Overview & Goals

### 1.1 Context

The owner's core request for this module is explicit: **text (SMS) and email capabilities to follow up with tenants — payment reminders and past-due balance follow-ups.** In self-storage, rent is small, recurring, and forgettable; most delinquency is not refusal to pay, it's forgetting to pay. A tenant who gets a text five days before rent is due, with a link that lets them pay in under a minute, rarely reaches the overlock stage. Every past-due tenant the system nudges back to current is a tenant the operator does not have to overlock, pre-lien, or auction — outcomes that are expensive, legally fraught (PRD 02 §Delinquency), and terrible for reviews.

This module is the platform's **single outbound messaging service**. Every other module already assumes it exists:

- PRD 02 US-31: *"All tenant-facing messages (invoices, receipts, failure notices, rate-increase letters, delinquency notices) are template-driven per facility, sent via the shared comms service… and logged on the tenant communication history."*
- PRD 02 FR-5/FR-7: the delinquency engine and event bus emit the billing/lifecycle events this module consumes.
- PRD 04 FR-MSG-1..5: the marketing module defines the consent model, suppression list, and quiet hours; this module shares that infrastructure for the transactional/operational side.
- PRD 01: the tenant portal is the destination of every "Pay now" deep link and hosts tenant notification preferences.

**Division of labor with PRD 04 (critical):** PRD 04 owns *marketing* messaging — lead drips, abandoned-reservation follow-ups, review requests, promos — and the marketing-consent capture that governs them. **This PRD owns *transactional/operational* messaging** — invoices, payment reminders, dunning, receipts, gate codes, rate-increase notices, delinquency/lien supplements — plus the shared delivery plumbing (providers, templates, suppression enforcement, message history) that both use. One consent store, one suppression list, one message log; two classification lanes.

### 1.2 Goals

- **G1 (centerpiece):** A configurable, automated **payment-reminder and past-due dunning sequence** over email and SMS: upcoming-due → due-date → escalating past-due ladder, each step carrying a one-tap **pay-now deep link** into the tenant portal.
- **G2:** An **event-driven notification service**: modules emit domain events; this service maps events to templates, channels, and recipients — no module ever calls Twilio or an ESP directly.
- **G3:** **Compliance by construction:** transactional vs marketing classification, SMS consent captured at move-in with TCPA-appropriate disclosure, STOP/HELP handling, quiet hours, CAN-SPAM-complete emails, and an immutable send log usable as evidence.
- **G4:** **Operator control without code:** template editor with preview/test-send, per-facility sender identity, sequence configuration, suppression management, delivery dashboard.
- **G5:** **Reliability a small operator can trust:** idempotent sends (a tenant is never double-texted for the same event), retries with backoff, provider webhook ingestion for delivery/bounce/failure status, SMS→email fallback.

### 1.3 Success in one sentence

A tenant who is about to miss rent gets a well-timed text or email, taps one link, pays in under a minute — and the operator can prove exactly what was sent, to whom, when, on what consent basis.

---

## 2. Non-Goals

- **Marketing campaigns, drips, and promos** — PRD 04 owns lead drips, abandonment sequences, review requests, and marketing-consent UX. This module provides the shared send/suppression/log infrastructure they run on.
- **Certified/registered postal mail and legal sufficiency of lien notices.** State lien statutes dictate delivery methods (often certified mail or verified mail); generating, mailing, and proving those notices is PRD 02's delinquency pipeline. This module sends email/SMS **supplements only** (§6.5) and never substitutes for a statutorily required delivery method.
- **Inbound two-way conversational messaging** (tenant texts a question, staff replies from an inbox). Phase 3 candidate; MVP handles inbound SMS only for STOP/HELP/START keywords and logging.
- **Voice calls / ringless voicemail.** Higher TCPA risk, low value at this scale.
- **Push notifications / native app messaging.** No native app (master PRD); PWA push is a master-PRD Phase 3 option.
- **In-app staff notifications** (approval bells, task alerts) — PRD 02 FR-1 owns the admin notification bell.
- **Building an ESP or SMS gateway.** We integrate providers (Resend, Twilio); we do not manage IP pools, carrier relationships, or short codes.
- **Non-US messaging.** US-only assumptions (TCPA, CAN-SPAM, A2P 10DLC) in v1.
- **Automated legal compliance guarantees.** The system enforces *configured* rules and records evidence; it does not validate configurations against statutes.

---

## 3. User Stories & Acceptance Criteria

Personas (from siblings): **Tara — Tenant**, **Priya — Facility Manager**, **Marcus — Owner/Operator**, **Dana — Regional Manager**. Stories tagged **[MVP]** / **[P2]** (see §8).

### 3.1 Payment reminders & dunning (centerpiece)

**CN-1 [MVP]** As Tara (tenant), I get a reminder before rent is due so I never accidentally go late.
- AC: When an invoice enters "due soon" (default 5 days before due date, configurable 1–14 per facility), the service sends the *upcoming-due* template on the tenant's enabled channels (email always if address on file; SMS if consented and enabled).
- AC: Message includes merge fields: tenant first name, unit number, facility name, amount due, due date, and a **pay-now deep link**; SMS body fits one 160-char segment where possible (link counted).
- AC: No reminder is sent if the invoice is already paid, the tenant has autopay enabled with a valid payment method (configurable — operator may still choose to send an "autopay will run on X" variant), or the lease is in move-out.

**CN-2 [MVP]** As Tara, I get a due-date reminder on the morning rent is due.
- AC: Sent on due date at a facility-configurable local send time (default 10:00 facility time, always inside quiet-hours limits); suppressed if invoice paid or payment is processing.

**CN-3 [MVP]** As Marcus (owner), I configure a **past-due dunning ladder** so follow-up is automatic and escalates in tone, because manual chasing is where my managers lose hours and money.
- AC: Default ladder (editable per facility, steps addable/removable/re-orderable): **Day 1** past due (gentle: "looks like you missed…" + late-fee warning per fee schedule), **Day 5** (firm: late fee applied, balance itemized), **Day 10** (urgent: overlock/access-suspension warning aligned to the facility's PRD 02 delinquency timeline), **Day 30** (serious: pre-lien consequences preview, "contact us to arrange payment"). Each step defines: trigger day, channels, email template, SMS template, and skip conditions.
- AC: Each step sends **at most once per invoice per step** (idempotency, §4.6); any successful payment that clears the qualifying balance (PRD 02 US-25 definition: full balance vs rent-only, configured in the billing engine) halts the ladder immediately — a payment at 11:58pm must suppress the midnight step.
- AC: Ladder steps are driven by the billing engine's delinquency-day events (§5.2), not by an independent comms-side calendar, so comms can never disagree with billing about what day a tenant is on.
- AC: Partial payment behavior is configurable: re-render remaining balance in subsequent steps (default) or restart ladder.
- AC: Tone escalation is template content, not hardcoded; templates ship as editable defaults.
- **Built in B-052.** `Facility.dunningDays` (default 1, 5, 10, 30) is read by the nightly `billing.dunning` job, which computes the day count from the same `daysPastDue` every other consumer uses (D-25) and emits `delinquency.day_reached` per step. There is **no scheduler in comms** — that is CN-3's own requirement, and a second calendar here is precisely what would let a tenant be told they are on day 10 while billing believes day 5.
- **At-most-once is keyed on the ANCHOR INVOICE**, not the lease: the day count is measured from the oldest unpaid invoice's original due date, so that invoice is what the ladder is about. When it is cleared and a later one becomes the anchor, the ladder starts again for that invoice — which is what "per invoice per step" asks for. The record of what has been sent is the event log, so nothing has to be reset by hand. Keyed on the **day** rather than the position, so inserting a step between two existing ones does not re-fire the ones already sent.
- **Halts (CN-5)** are checked before the arithmetic and in the order a person would: move-out, then a `LeaseHold` declaring `halt_dunning` (US-42, by declared effect rather than a check on the type), then a settled balance. The balance halt is on the **money, not the day count** — the day count is a historical fact that does not decrease when someone pays, so "a payment at 11:58pm suppresses the midnight step" only works if the money is what is checked.
- **Tone escalation is content**, as this AC requires: one rule and one template, with the wording chosen from the step's position. Day 10 warns about gate access because B-098 genuinely suspends it; the last rung says "we would have to begin the formal collection steps" rather than naming a date, because the lien pipeline is Phase 2 and promising a date we cannot keep is worse than saying less. A position beyond the written rungs reuses the firmest rather than rendering blank.

**CN-4 [MVP]** As Tara, every reminder gives me a **one-tap way to pay**.
- AC: The pay-now link is a short, unique, single-purpose **magic link** that authenticates me into the tenant portal's payment screen for that balance (PRD 01 pay flow) without a password.
- AC: Link expiry configurable (default 7 days); an expired link lands on the portal login with the payment screen as post-login destination — never a dead end.
- AC: Links are single-tenant-scoped, unguessable (≥128-bit token), revoked on move-out, and show balance *as of page load* (not as of send) so a stale link never shows a stale balance.
- AC: Payment completed via a deep link is attributed to the originating message in the send log (proves the module's ROI — §7).
- **Built in B-051, with one deliberate deviation (D-30).** The link is **not a portal session** — it grants exactly one route, `/pay/<token>`, for exactly one lease, and every other route still sees an anonymous visitor. The literal reading of the AC above (sign them into the portal's payment screen) would hand anyone holding a forwarded email the tenant's gate code, address of record and saved cards; scoping by a session flag would have made every portal page responsible for checking it, which is fail-open. The screen therefore shows no gate code, no other unit and no way to remove a card, and the **update-card link in the failed-payment notice stays password-gated** because changing what autopay charges is more than this token grants. Token is 256-bit, stored as SHA-256 only, **multi-use for 7 days** (the balance must be "as of page load", which only means something if the link re-opens), revoked on move-out in the same transaction as the lease ending, and attributed to its originating event when the attempt is raised rather than when it succeeds.

**CN-5 [MVP]** As Priya (manager), the reminders stop when they should.
- AC: Ladder halts on: qualifying payment, promise-to-pay hold entered by staff (P2: staff can pause dunning N days, logged), move-out, deceased/legal-hold flag on tenant, or channel suppression (then remaining channels continue).
- AC: When PRD 02's pipeline reaches pre-lien/lien stages, automated dunning messages defer to that stage's notice supplements (§3.3, §6.5) — the tenant does not receive a chirpy "friendly reminder" the same day as a lien notice.

**CN-6 [MVP]** As Tara, if a payment attempt fails (autopay decline, card expired), I'm told immediately with a fix path.
- AC: `payment.failed` event → payment-failed template within 5 minutes, including failure reason category (card declined/expired — never raw processor codes), retry schedule if autopay will retry (Stripe Billing retry config, master PRD), and an update-payment-method deep link.
- AC: `payment.succeeded` → receipt (email always; SMS receipt only if tenant opted into SMS receipts — default off to conserve segments/cost).

### 3.2 Lease-lifecycle notifications

**CN-7 [MVP]** Move-in welcome: on `lease.moved_in`, send welcome message: facility address/hours, **gate code** (on `access.credential_issued` from PRD 03 — sent only after the credential is actually active), first-invoice summary, portal registration link. AC: gate code over SMS requires SMS consent; email fallback always; the code itself is masked in the admin-visible message log copy (show last digit only) while the send record proves delivery.

**CN-8 [MVP]** Move-out confirmation: on `lease.moved_out`, send confirmation with final balance settlement (paid in full / refund amount / balance due), access-revocation notice, and W-9-free simple receipt. AC: suppressed channels still get nothing; message logged.

**CN-9 [MVP]** Rate-increase notice: when the billing engine schedules a rate increase (PRD 02 US-11), send the tenant notice on the configured advance-notice date. AC: email is the primary channel; this notice is **also queued to postal mail when facility/state configuration requires written notice** (PRD 02 owns the mail queue and the legal-sufficiency call — this module only sends the electronic copy and records it); merge fields include old rate, new rate, effective date, and the governing notice-period; send is blocked (loud failure to admin) if any merge field is missing (PRD 02 FR-6 rule inherited).

**CN-10 [P2]** Operational notices: invoice-created ("your invoice is ready") for tenants who want it, autopay-upcoming ("we'll charge your card on the 1st"), insurance-expiring, gate-hours/holiday closures (facility broadcast), maintenance affecting a tenant's building. AC: each is a distinct event-template mapping with per-tenant opt-out where non-essential.

**CN-10a [MVP]** **Card-expiry pre-emption.** *(Pulled from CN-10's P2 bundle on 2026-07-31 — PRD 01 §4.8 already lists "card expiring soon" in its Phase 1 transactional table, and the operator review makes the case that this is not an operational nicety but the cheapest point of autopay success available.)* A nightly job scans saved payment methods expiring within 30 days and sends one templated email with a portal deep link to update the card; it retriggers at 7 days and is suppressed the moment the method is replaced.
- AC: the scan is idempotent per (tenant, payment method, stage) — a re-run sends nothing twice.
- AC: replacing the method cancels the 7-day retrigger; there is no message telling a tenant to fix something they have already fixed.
- AC: measured against PRD 02 §7's ≥92% autopay success target. A card that silently expires puts a tenant who has paid on time for three years into the dunning ladder over something visible 30 days ahead.
- **Built: the scan in B-043, the notice in B-050.** The template names no unit — a saved card belongs to the tenant rather than a unit (B-036), so a tenant renting two units gets one email rather than two naming different doors — and it says outright that nothing has failed, because a long-standing on-time tenant reading a payment email assumes the worst.

### Built in B-050 (2026-08-06)

CN-1, CN-2, CN-6 and CN-10a ship as eight org-default rules and templates in `packages/db/comms-catalog.ts`, alongside the D-17 protection notices and D-29's retry reminder. Three things worth not re-deciding:

- **The autopay skip requires BOTH halves of autopay** — the lease enrolled *and* a saved card on file. A lease enrolled with no card will not be charged, and that tenant does need the reminder; a naive `autopayEnabled` check silences exactly the person who needs telling.
- **The receipt has no autopay skip.** For most autopay tenants it is the only thing that tells them the charge went through.
- **House style:** amount and date in the first two lines, one link per action, never a consequence that has not happened. These reach people who are paying on time far more often than not, and a reminder that reads like a collections letter teaches good tenants to stop opening their email — after which CN-3's ladder has nobody listening.

**CN-22 [MVP]** **Checkout resume link.** *(Added 2026-07-31 from the UX review.)* PRD 01 FR-4.1 promises a checkout restored "via emailed link", and nothing sends one — the abandonment sequence that would (CN, marketing side) is Phase 2. So a renter interrupted at the lease step, the longest step and the one most likely to be interrupted, has a server-side draft they cannot reach.
- AC: sent when the checkout session is created **and the renter's email is captured** (end of step 1) — not on abandonment detection.
- AC: the link carries the session's signed token and restores the step the renter left, not step 1.
- AC: the body states the hold plainly: "We're holding this unit for you until [time]. After that it goes back on sale."
- AC: this is **transactional**, not marketing. It is not gated on marketing consent and is distinct from the Phase-2 abandoned-reservation sequence, which remains consent-gated.

### 3.3 Delinquency-stage and legal-adjacent messages

**CN-11 [MVP]** Overlock/access notices: on `delinquency.stage_changed` to access-revoked/overlocked, send: what happened, exact amount to cure, pay-now link, facility phone. AC: sent only after PRD 02 confirms the stage transition executed (not when queued); cure payment triggers an automatic "access restored" message when PRD 02 emits `access.restore` completion. **Two of these messages ship in MVP, not Phase 2** (D-16): the access-suspended and access-restored pair for the single days-past-due threshold, built with B-098. They state the exact amount to cure and that the balance must reach **zero** — copy implying a part payment reopens the gate produces the angriest call the office takes. The remaining stage notices stay Phase 2 with the timeline engine.

**CN-12 [MVP]** Pre-lien and lien **supplements**: when PRD 02 generates a pre-lien/lien notice, this module sends an email (and SMS if consented) telling the tenant a formal notice has been issued, with balance, deadline, and pay-now link. AC: the message never claims to *be* the statutory notice; template copy states a formal notice was sent per the lease/state law; the send is logged and linked to PRD 02's notice record so the evidence trail is unified. Certified-mail execution and proof stay entirely in PRD 02 (§2 Non-goals).

### 3.4 Preferences, consent, and opt-out

**CN-13 [MVP]** As Tara, I control my channels in the portal (PRD 01 surface, this module's data):
- AC: Preference center shows per-category toggles: payment reminders (email/SMS), receipts (email/SMS), operational notices (email/SMS). **Legally significant messages (delinquency stages, lien supplements, rate increases) are email-mandatory and cannot be toggled off** — the UI says so; a tenant can only lose these by having no valid address, which flags the account for staff follow-up.
- AC: SMS consent state (granted/revoked, timestamp, disclosure version, capture source) is displayed read-only; revoking SMS in the portal has the same effect as STOP.

**CN-14 [MVP]** As Tara, texting **STOP** stops texts; **HELP** gets help.
- AC: Inbound STOP (and carrier-standard variants: STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) immediately sets `sms_opted_out`, sends the single confirmation message carriers require, suppresses all future SMS (transactional included — see §6.2), and is audit-logged. HELP returns identification + support contact + "Reply STOP to opt out." START/UNSTOP re-enables with logged re-consent.
- AC: Opt-out processing is provider-level (Twilio Advanced Opt-Out) **and** application-level (our suppression check), so a race can't slip a message through.

**CN-15 [MVP]** As Priya, SMS consent is captured at move-in with clear disclosure.
- AC: Both move-in flows (counter, PRD 02 US-14; online, PRD 01) present an **unchecked-by-default** SMS consent checkbox with disclosure text covering: who is texting, message purpose (account and payment notifications), message frequency ("message frequency varies"), "message and data rates may apply," STOP/HELP instructions, and a statement that consent is not a condition of rental. Stored: timestamp, IP/terminal, disclosure text version, checkbox state. *(Final copy: legal review — Open Question Q2.)*
- AC: No SMS of any kind is sent to a tenant without a stored consent record; email is the fallback.

### 3.5 Admin controls & visibility

**CN-16 [MVP]** As Marcus, I edit templates with confidence.
- AC: Template editor per template (email: subject + HTML/text body; SMS: text with segment counter and 160/segment warning), with merge-field picker restricted to that template's event schema; save is versioned; sends record template version.
- AC: **Preview with sample data** and **test-send to self** (email + SMS to a staff-verified number) before publishing; a template with unknown/missing merge fields cannot be published.
- AC: Templates are org-level defaults with per-facility overrides (mirrors PRD 02 US-4 pattern).
- **Built in B-053.** The field schema lives in `packages/core/comms` — one declaration powering the picker, the preview's sample data, and the publish gate, so the three cannot disagree. **Publishing is blocked, not warned**, on a field the template's event cannot supply: that failure otherwise surfaces at send time, inside a job, with the tenant simply never hearing from us. A known-but-undeclared field is reported and allowed, since a line that renders empty is a legitimate choice and the send guard already refuses to mail a surviving placeholder. **Preview renders through the same `renderEmail` a real send uses** — a lenient preview would say a template is fine when it is not. **Saving is append-only**: a new version, the previous deactivated, because `Message` records the version it sent and editing in place would rewrite history a lien file may depend on. **Test-send goes to the actor's own signed-in address only**, never a typed one — a test-send taking an arbitrary address is an open relay wearing an admin screen.

**CN-17 [MVP]** As Marcus, each facility sends under its own identity.
- **Built in B-053, with the split CN-17 itself implies.** The *display name* is per facility; the *address* is not. Every facility sends from the one authenticated domain because SPF, DKIM and DMARC are configured there — a per-facility sending address would need its own DNS, and until that was done its mail would fail authentication and land in spam. The facility's real inbox is reached by **reply-to** instead. The postal footer is appended by the pipeline rather than written into each template, because it is a CAN-SPAM requirement and a template author forgetting it is exactly the failure that rule exists to catch.
- AC: Per-facility email From name / from address on a shared authenticated sending domain (e.g., `{facility}@mail.acmestorage.com`), reply-to routed to the facility's inbox; per-facility SMS number (one 10DLC number per facility, one registered brand/campaign for the org — §6.3); email footer auto-injects the facility's physical address.

**CN-18 [MVP]** As Priya, I see everything a tenant was sent, on the tenant record.
- AC: Tenant profile (PRD 02 integration) shows the unified message history: timestamp, channel, template + version, triggering event, rendered content snapshot, delivery status (queued→sent→delivered/bounced/failed), and payment attribution if a deep link converted. Immutable; export-to-PDF for dispute/lien evidence.

**CN-19 [MVP]** As Dana (regional), I have a delivery dashboard: sends by day/facility/template, delivery rate, bounce rate, SMS failure rate, opt-out rate, and a failure queue (hard bounces, invalid numbers, carrier filtering) with per-tenant follow-up tasks ("no reachable channel — call tenant"). AC: hard bounce or invalid number auto-flags the tenant record and creates a task in PRD 02's task system.

**CN-20 [MVP]** As Marcus, I manage the suppression list (shared with PRD 04): view/search entries (address/number, reason: unsubscribe, STOP, hard bounce, complaint, manual), add manual suppressions, and remove *only* manual/bounce entries (never STOP or spam-complaint entries) with logged justification.

**CN-21 [P2]** As Priya, I can send a one-off manual message (template-based, not freeform in MVP of this feature) to a tenant or a filtered set (e.g., all tenants in Building B: "power outage today"), respecting consent and quiet hours, logged like any automated send.

---

## 4. Functional Requirements

### 4.1 Architecture: event-driven notification service

- **FR-1:** A single `comms` service (monorepo package + background jobs per master PRD stack: Inngest/Trigger.dev or Vercel Cron + queue) subscribes to the event bus. **Producers never send messages; they emit events.** The service resolves event → notification rule(s) → recipient → consent/suppression check → channel(s) → template render → provider send → log.
- **FR-2:** **Notification rules** are data, not code: `(event_type, category, channel policy, template refs, skip conditions, delay)` — editable where §3 says configurable, seeded with the defaults in §3.
- **FR-3:** Scheduled steps (due-soon, ladder days) are **derived from billing-engine events** (`invoice.due_soon`, `delinquency.day_reached` — PRD 02's nightly delinquency evaluation, FR-5, is the tick source). The comms service owns *send-time scheduling within the day* (quiet hours, facility send-time) but never decides *which day* a tenant is on.

### 4.2 Channels & providers

- **FR-4 Email — Resend (recommended)**, per master PRD. Rationale for the learning build: first-class Next.js/TypeScript SDK and React Email templates (our stack), simple domain auth (SPF/DKIM/DMARC guided setup), webhooks for delivered/bounced/complained, generous free tier for development. Postmark is the runner-up (best-in-class transactional deliverability and separate message streams) and the swap surface is deliberately small (see FR-6); SendGrid is more machinery than this project needs. Transactional mail uses a dedicated subdomain (e.g., `mail.acmestorage.com`) kept separate from PRD 04's marketing stream (PRD 04 FR-MSG-2).
- **FR-5 SMS — Twilio** (Programmable Messaging + Messaging Service per facility number pool). US A2P over **10DLC** requires brand + campaign registration before production traffic (§6.3).
- **FR-6 Provider abstraction:** a thin `MessageProvider` interface (`send`, `parseWebhook`, `normalizeStatus`) so providers are swappable; no business logic in provider adapters.
- **FR-7 Channel selection & fallback:** per message category, policy = `email_only | sms_only | both | sms_preferred_email_fallback`. Fallback triggers: no SMS consent, suppressed number, invalid number, provider-reported failure (undelivered/carrier filtered) within a 30-minute window → send the email variant once (idempotency key covers the pair so fallback can't duplicate). Legally significant categories are always `both`-attempted with email mandatory (CN-13).
- **FR-8 Quiet hours (SMS):** no SMS outside **8:00am–9:00pm recipient local time** (TCPA window for telephone solicitations, adopted here for *all* SMS as a conservative default), with a per-org stricter override (e.g., 8am–8pm to clear Florida's mini-TCPA window) — see §6.4. Recipient timezone = facility timezone as proxy (tenant-level override P2). Messages triggered inside quiet hours queue for the next window opening; a message that becomes moot before sending (invoice paid) is cancelled, not sent.

### 4.3 Templates & rendering

- **FR-9:** Templates: email (MJML/React Email → HTML + auto-generated plaintext), SMS (plain text). Merge fields are typed per event schema; render fails loudly (blocked send + admin alert) on missing required fields — inherits PRD 02 FR-6's "never send with blank merge fields."
- **FR-9a Email HTML is accessible content, and this is stated before the templates exist** *(first met by B-084 part 3, 2026-08-18 — the scheduled report emails. Every clause is now a test in `tests/report-email.test.ts` rather than a reviewer's checklist: `lang` on the root, a real `<h1>` then `<h2>`s in order with nothing skipped, `<th scope>` on columns AND rows, a caption per table, no `<img>` at all — which settles the alt-text and the text-as-image clauses together — link text that names its destination, no colour anywhere that could carry meaning, and a text part built from the same document object rather than by stripping tags, asserted by checking it contains no markup and still carries every heading, caption and figure. The renderer is `packages/core/comms/report-email.ts` and part 4's management pack uses it.)* (added 2026-08-12 from the accessibility review, which found no accessibility criteria anywhere in this PRD for rendered email — a gap that only becomes visible at B-084, the first item that generates email nobody wrote by hand). Every generated email carries: a **text alternative part** that is a real equivalent rather than a stripped tag soup, a `lang` attribute, real heading elements in order rather than styled `<div>`s, `<th scope>` on any tabular figure (a statement, an AR summary, a rent roll), **no information carried by colour alone** (a red total is also labelled "past due"), **no text rendered as an image**, meaningful `alt` on any image that carries information and `alt=""` on every decorative one, and link text that names its destination rather than "click here". A tenant reading a lease notice or a past-due total in a screen reader is reading content they are legally expected to have received. This is cheap to state now and expensive once templates exist, are versioned, and have rendered snapshots stored against thousands of `message` rows (FR-21).
- **FR-10:** Standard merge fields available to all tenant templates: `tenant.first_name`, `unit.number`, `unit.size`, `facility.name/phone/address/office_hours`, `balance.total`, `balance.itemized[]`, `invoice.due_date`, `links.pay_now`, `links.portal`, `links.update_payment_method`.
- **FR-11:** Every email includes: facility physical postal address, facility contact, and — for any message not strictly transactional — a functioning unsubscribe (see §6.1 classification). SMS templates auto-append "Reply STOP to opt out, HELP for help" on the first message to a number and periodically per carrier guidelines (configurable cadence).

### 4.4 Pay-now deep links (magic links)

- **FR-12:** `links.pay_now` mints a single-purpose token: `{tenant_id, lease_id, purpose: pay_balance, expires_at, message_id}`; opening it establishes a **limited portal session scoped to viewing balance + paying** (PRD 01 auth integration; full account changes still require normal login). Token store supports revocation (move-out, staff action). Clicks and resulting payments are written back to the send record.
- **FR-13:** Security: tokens are random ≥128-bit, single-audience, HTTPS-only, not logged in plaintext anywhere except the send record (admin-visible masked); rate-limited token endpoint; a used/expired token degrades gracefully to login-then-redirect.

### 4.5 Webhooks & status tracking

- **FR-14:** Ingest provider webhooks (Resend: sent/delivered/bounced/complained; Twilio: queued/sent/delivered/undelivered/failed + inbound messages) with signature verification; normalize to a message-status state machine `queued → sent → delivered | bounced | failed | filtered`; webhook handlers are idempotent (provider retries must not duplicate status rows).
- **FR-15:** Status consequences: hard bounce → email suppression + tenant flag + staff task; spam complaint → suppression (non-removable); SMS `undelivered/30007-class filtering` → fallback per FR-7 + counter toward number health alert; 3 consecutive failures on a channel → channel auto-disabled for tenant + task.

### 4.6 Reliability & idempotency

- **FR-16 Idempotent sends (hard requirement):** every send carries a deterministic idempotency key — `hash(event_id, notification_rule_id, recipient_id, channel)` — enforced by a unique constraint at write time and honored across retries, redeliveries of the same event, and job restarts. **A tenant can never receive the same message twice for the same event**, including the SMS→email fallback pair (FR-7).
- **FR-17 Retries:** transient provider errors retry with exponential backoff + jitter (e.g., 1m/5m/30m/2h, max 5) inside the job runner; permanent errors (invalid address, suppression) fail fast to the failure queue. Retries re-check "still relevant?" (invoice unpaid, lease active) and quiet hours before each attempt.
- **FR-18 Ordering & staleness:** events carry occurrence timestamps; the service drops a queued message whose premise is stale (payment event arrived after due-reminder was queued). Balance amounts are re-read at render time, not frozen at event time.
- **FR-19 Observability:** dead-letter queue with admin surface (CN-19); alert to owner if >2% of a day's sends fail, if the event consumer lags >15 minutes, or if a dunning run sends zero messages when delinquent tenants exist (silent-failure detector).
- **FR-20 Kill switch & sandbox:** org-level pause-all-outbound switch; non-production environments hard-redirect all messages to a test inbox/number — no real tenant addresses can be messaged from dev/preview deploys.

### 4.7 Message log

- **FR-21:** Append-only `message` records: recipient, channel, provider + provider message id, event id, rule id, template id + version, rendered snapshot (email HTML + text; SMS body), consent basis snapshot (which consent record authorized an SMS), classification (transactional/operational/marketing), statuses with timestamps, deep-link click + payment attribution. Retention: life of tenancy + statute-of-limitations buffer (default 7 years, configurable — Q6).

---

## 5. Data & Integration Points

### 5.1 Owned entities (extends master PRD shared schema)

| Entity | Purpose | Notes |
|---|---|---|
| `notification_rule` | event→template/channel/policy mapping | org defaults + facility overrides, versioned |
| `message_template` | email/SMS template content | versioned; org + facility scope |
| `message` | one send attempt lifecycle | append-only, FR-21 |
| `message_status_event` | normalized webhook statuses | idempotent ingest |
| `magic_link_token` | pay-now/update-card links | hashed at rest, revocable |
| `sms_consent` | tenant SMS consent records | shares model with PRD 04 FR-MSG-1 (`contact_consent`), distinct `account_sms` channel alongside `marketing_sms` |
| `suppression` | shared with PRD 04 | one list, reason-coded |
| `sequence_config` | reminder/dunning ladder per facility | versioned; lease-visible which version applied |

### 5.2 Events consumed (producers own schemas; canonical names align with PRD 02 FR-7 / master PRD)

| Event | Producer | Resulting message(s) |
|---|---|---|
| `invoice.created` | Billing (PRD 02) | optional "invoice ready" (CN-10, P2) |
| `invoice.due_soon` (N days configurable) | Billing scheduler | upcoming-due reminder (CN-1) |
| `invoice.due_today` | Billing scheduler | due-date reminder (CN-2) |
| `payment.succeeded` | Billing/Stripe webhook | receipt; halts ladder (CN-3, CN-6) |
| `payment.failed` | Billing/Stripe webhook | failure notice + fix link (CN-6) |
| `delinquency.day_reached` (day X per timeline) | Delinquency engine (PRD 02 FR-5) | dunning ladder step (CN-3) |
| `delinquency.stage_changed` (`access_revoked`, `overlocked`, `pre_lien`, `lien`) | Delinquency engine | stage notice / legal supplement (CN-11, CN-12) |
| `access.restore` (completed) | PRD 02 → PRD 03 confirmed | access-restored message (CN-11) |
| `lease.moved_in` | PRD 02/01 | welcome (CN-7) |
| `access.credential_issued` | PRD 03 | gate-code message (CN-7) |
| `lease.moved_out` | PRD 02 | move-out confirmation (CN-8) |
| `lease.rate_increase_scheduled` (notice date) | PRD 02 US-11 | rate-increase notice (CN-9) |

### 5.3 Integration points (consumers/dependencies)

| System | Direction | Contract |
|---|---|---|
| Admin dashboard (PRD 02) | out | Message history on tenant record (CN-18), failure tasks (CN-19), template/sequence config UI hosted in admin settings; PRD 02's notice records link to supplement sends (CN-12) |
| Tenant portal (PRD 01) | both | Preference center (CN-13); magic-link limited sessions (FR-12); pay screen is deep-link destination |
| Marketing (PRD 04) | shared | One consent store, one suppression list, one message log, separate sending streams; PRD 04 sequences call this module's send API with `classification: marketing` |
| Billing/Stripe (PRD 02 / master) | in | Events per §5.2; qualifying-payment definition owned by billing |
| Hardware (PRD 03) | in | `access.credential_issued`, restore confirmations |
| Resend | both | Send API; status webhooks (signed) |
| Twilio | both | Messaging Service send; status webhooks; inbound keyword webhook; A2P 10DLC brand/campaign registration (one-time + per-campaign) |

---

## 6. Compliance

> Not legal advice (see header). Claims below are grounded in the cited public sources; final copy and configuration require attorney review.

### 6.1 Transactional vs marketing classification

- Every template is classified `transactional`, `operational`, or `marketing` (marketing lives in PRD 04). Payment reminders, dunning, receipts, gate codes, delinquency/lien supplements, and rate-increase notices are **transactional/relationship messages** — CAN-SPAM exempts "transactional or relationship" content (e.g., messages that "facilitate an agreed-upon transaction" or provide account/status information) from most of its requirements, though the from/routing information still must not be false or misleading ([FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business); [SocketLabs on transactional email under CAN-SPAM](https://www.socketlabs.com/blog/transactional-email-can-spam/)).
- We still include facility physical address and identification on every email (belt-and-suspenders, and it's good UX). Mixed-content messages default to the stricter (marketing) treatment.
- **Classification does not exempt SMS from the TCPA.** Consent rules for texting are channel-based, not content-based (§6.2).

### 6.2 TCPA / SMS consent

- The TCPA requires **prior express consent** for autodialed/automated texts to mobile phones; informational/transactional texts can rely on prior express consent (which providing a phone number in a transaction context can evidence), while **marketing texts require prior express *written* consent** with specific disclosures ([ActiveProspect TCPA consent guide](https://activeprospect.com/blog/tcpa-consent/); [DNC.com on express consent](https://www.dnc.com/blog/what-tcpa-express-consent); [Infobip 2026 TCPA compliance guide](https://www.infobip.com/blog/tcpa-compliance-sms)).
- **Our conservative posture:** we capture explicit, disclosed, written (electronic) SMS consent at move-in for *all* account texting (CN-15) — unchecked-by-default checkbox, disclosure of purpose/frequency/rates/opt-out, not a condition of rental — rather than relying on implied consent from a phone number on a lease. This exceeds the minimum for transactional texts and keeps us safe if a message is later argued to be marketing-tinged.
- **Revocation:** the FCC's 2025 opt-out rules require honoring revocation made "in any reasonable manner," with standard keywords (STOP etc.) treated as per-se valid, processed within 10 business days (we do it immediately), and permit one confirmation text ([BCLP on the TCPA opt-out rules effective April 11, 2025](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)). A STOP suppresses **all** our SMS to that number, transactional included — we treat scope-limiting a revocation as not worth the risk; email becomes the sole channel.
- CN-14's keyword handling + provider-level opt-out enforcement implements this.

### 6.3 A2P 10DLC registration (required before any US SMS ships)

- US carriers require Application-to-Person messaging over local 10-digit numbers to be registered: Twilio requires **brand registration** (the legal business entity, EIN) and **campaign registration** (use case, sample messages, opt-in/opt-out description) via its Trust Hub before production A2P 10DLC traffic; unregistered traffic is subject to blocking and carrier fees ([Twilio: Programmable Messaging and A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc); [Twilio A2P 10DLC registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart); [Twilio campaign registration](https://www.twilio.com/docs/trust-hub/registrations/a2p-10dlc-campaign)).
- **Build implication:** register one brand (the operating entity — master PRD assumes a single legal entity) and one "account notifications/customer care" campaign; attach each facility's number to that campaign via a Messaging Service. Registration involves review time and small recurring fees — it goes on the Phase 1 critical path (§8), not launch week. Sample messages submitted for vetting must match our actual templates.

### 6.4 Quiet hours

- Federal TCPA telemarketing rules prohibit solicitation calls/texts before 8am or after 9pm **recipient local time**; several state mini-TCPAs are stricter (e.g., Florida's 8am–8pm window with a 3-message/24h cap for solicitations; Oklahoma similar) and 2025-era class actions have targeted quiet-hour violations aggressively ([ActiveProspect on TCPA calling hours](https://activeprospect.com/blog/tcpa-calling-hours/); [Klaviyo on Florida's mini-TCPA](https://help.klaviyo.com/hc/en-us/articles/4405332994843); [Privacy World on quiet-hours class actions](https://www.privacyworld.blog/2025/03/new-class-action-threat-tcpa-quiet-hours-and-marketing-messages/)).
- Quiet hours legally target *solicitations*; our texts are account notifications. **We apply the 8am–9pm window to all SMS anyway** (FR-8) — a payment reminder at 6am angers tenants regardless of legality — with a stricter configurable override for operators in mini-TCPA states. Aligns with PRD 04 FR-MSG-5.

### 6.5 Lien/legal notices — supplements only

- State self-storage lien statutes prescribe notice content and delivery (frequently certified/verified mail); PRD 02 owns statutory notice generation, delivery, and proof (PRD 02 US-27, and its legal disclaimer). This module's pre-lien/lien messages (CN-12) are **courtesy supplements**: they reference the formal notice, never replace it, and their send records link into PRD 02's evidence chain. Template copy must never state or imply the email/SMS *is* the legal notice.

### 6.6 Evidence & audit

- Append-only message log with rendered snapshots, consent-basis snapshot per SMS, template versions, and delivery statuses (FR-21) — exportable per tenant (CN-18) for disputes, chargebacks, and lien files. Consent and suppression changes audit-logged (aligns PRD 04 FR-MSG-1/AC4).

### 6.7 Data protection basics

- Gate codes masked in admin log views (CN-7); magic-link tokens hashed at rest (FR-12/13); phone/email treated as PII per master PRD's cross-cutting security section; provider data-processing terms reviewed at signup (Q7).

---

## 7. Success Metrics

**North star: delinquency prevented.**

| Metric | Target (post-Phase 1, directional for a learning build) |
|---|---|
| % of invoices paid by due date (facilities with reminders on vs baseline/off) | +10 pts vs baseline |
| % of past-due balances cured within 5 days of first dunning step | ≥ 50% |
| Payments attributed to a pay-now deep link | ≥ 30% of portal payments |
| Median time from `payment.failed` → tenant notified | < 5 min |
| Duplicate sends per event (idempotency violations) | 0 — hard invariant, alarmed |
| Email delivery rate (transactional stream) | ≥ 99%; bounce < 1% |
| SMS delivery rate (registered 10DLC) | ≥ 97% |
| Sends violating quiet hours or suppression | 0 — hard invariant, alarmed |
| SMS opt-out rate (account notifications) | < 2% / month |
| Tenants with no reachable channel and no open follow-up task | 0 |
| Delinquent accounts reaching pre-lien (rate, trend) | declining quarter over quarter |

Instrumentation: send/delivery/click/payment attribution lives in the message log (FR-21); the dashboard (CN-19) reports these directly. A/B of reminder timing/tone is P2.

---

## 8. Phasing

Aligned to the master PRD roadmap (comms email lands with MVP billing; SMS lands with the Phase 2 delinquency pipeline — accelerated here per the owner's explicit request to have SMS reminders early).

### Phase 1 — Reminder engine, email-first + SMS core (with MVP billing)
- Event consumer + notification rules + idempotent send pipeline (FR-1..3, FR-16..20)
- Email via Resend: domain auth, transactional stream, webhooks (FR-4, FR-14)
- **Payment reminders: due-soon, due-date, dunning ladder day 1/5/10/30 defaults** (CN-1..6)
- Pay-now magic links + payment attribution (CN-4, FR-12/13)
- Move-in welcome, gate code (email), move-out confirmation (CN-7/8)
- Templates: seeded defaults, editor with preview/test-send, versioning (CN-16)
- Per-facility sender identity (email) (CN-17)
- Message history on tenant record; suppression list; failure queue (CN-18..20)
- **Start A2P 10DLC brand + campaign registration immediately** (lead time) (§6.3)
- SMS consent capture at move-in ships now (so consent exists before SMS does) (CN-15)

### Phase 2 — SMS live + full delinquency integration (with PRD 02 delinquency pipeline)
- Twilio sending on registered 10DLC numbers per facility; STOP/HELP/START; quiet hours; SMS→email fallback (FR-5, FR-7/8, CN-14)
- SMS variants of all reminder/dunning templates; SMS receipts opt-in
- Delinquency-stage notices + pre-lien/lien supplements linked to PRD 02 evidence (CN-11/12)
- Rate-increase notices (CN-9); tenant preference center (CN-13)
- Delivery dashboard + alerting hardening (CN-19, FR-19)

### Phase 3 — Depth
- Operational notices bundle (CN-10); manual/broadcast sends (CN-21)
- Promise-to-pay dunning pause; tenant-level timezone; reminder-timing experiments
- Two-way SMS inbox (evaluate); PWA push channel (per master PRD option)
  - ***Both answered 2026-08-20 by D-78, neither built.*** **PWA push: no** — PRD 00 gates it on "if metrics justify" and nothing in this product counts portal engagement, so the condition cannot be evaluated. **Two-way inbox: no**, on the evaluation that at 2–10 facilities inbound volume does not warrant a second queue beside `Task`. The evaluation did find a real defect: `sms-webhook/route.ts` handles STOP/HELP/START/YES and **silently drops every other inbound message**, so a tenant who replies is answered by nothing. That is **B-135** — route an unrecognised inbound SMS to the existing `Task` queue. If its task volume proves an inbox is warranted, that is the number to reopen D-78 with.
- Per-facility sequence analytics (cure curves by step)

**Dependencies:** Phase 1 requires PRD 02's billing events and PRD 01's pay screen. Phase 2 SMS is gated on completed 10DLC registration — treat as an external-approval dependency with unknown latency.

---

## 9. Open Questions

1. **Autopay tenants and reminders.** Default-suppress reminders for healthy autopay tenants, or send a "we'll charge your card on X" heads-up (fewer surprise-charge disputes, more noise)? Owner call; default proposed: suppress, offer heads-up as tenant opt-in. *(Decide before Phase 1 templates.)*
2. **SMS consent disclosure copy + lease clause.** Exact disclosure language and whether the lease itself carries a texting clause — attorney review (with PRD 04 Q5, same review). *(Blocks Phase 2 SMS.)*
3. **STOP scope.** We suppress all SMS on STOP (conservative). Should tenants be able to re-scope (marketing-only STOP, keep account alerts) via preference center flows carriers permit? Legal + UX review.
4. **Dunning ladder defaults vs delinquency timeline.** Day 10 "overlock warning" must reference each facility's actual configured overlock day (PRD 02 timelines vary per state/facility). Auto-derive step days from the facility timeline, or configure independently with a mismatch lint? Proposed: auto-derive with override + lint. *(Decide before Phase 1 config schema.)*
5. **Email for legally significant notices when address is invalid.** If a tenant's email hard-bounces during pre-lien, what's the escalation SLA for staff (phone call task? immediate?) — and does any target state treat email as a permitted notice channel (some lien statutes allow email with verified receipt)? Feeds PRD 02's per-state config. *(With master PRD Q1 — target states.)*
6. **Message retention.** 7-year default vs shorter with legal-hold carve-outs; storage cost of rendered HTML snapshots (store rendered text + template ref instead?).
7. **Provider terms.** Confirm Resend/Twilio data-processing and 10DLC fee pass-through fit the learning project's budget; revisit Postmark if deliverability testing disappoints.
8. **Shared consent store ownership.** PRD 04 defines `contact_consent`; this PRD adds `account_sms`. Which module's migration owns the table? Proposed: master-PRD shared schema owns it; both modules read/write via one package. *(Resolve at implementation kickoff.)*

---

## Sources

- [FTC — CAN-SPAM Act: A Compliance Guide for Business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [SocketLabs — CAN-SPAM & Transactional Emails](https://www.socketlabs.com/blog/transactional-email-can-spam/)
- [ActiveProspect — TCPA consent: The complete guide](https://activeprospect.com/blog/tcpa-consent/)
- [DNC.com — What Is TCPA Express Consent?](https://www.dnc.com/blog/what-tcpa-express-consent)
- [Infobip — 2026 Guide to TCPA Compliance for SMS in the US](https://www.infobip.com/blog/tcpa-compliance-sms)
- [BCLP — The TCPA's New Opt-Out Rules Take Effect on April 11, 2025](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
- [Twilio — Programmable Messaging and A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Twilio — A2P 10DLC registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
- [Twilio — A2P 10DLC Campaign Registration](https://www.twilio.com/docs/trust-hub/registrations/a2p-10dlc-campaign)
- [ActiveProspect — A business guide to TCPA calling hours](https://activeprospect.com/blog/tcpa-calling-hours/)
- [Klaviyo — Understanding Florida's mini-TCPA](https://help.klaviyo.com/hc/en-us/articles/4405332994843)
- [Privacy World — TCPA Quiet Hours and Marketing Messages class actions](https://www.privacyworld.blog/2025/03/new-class-action-threat-tcpa-quiet-hours-and-marketing-messages/)
