# PRD 03 — Facility Hardware Integrations

**Product:** Multi-facility self-storage business application (learning project)
**Module:** Facility hardware integrations (gate access, smart entry, access events, cameras, kiosk)
**Status:** Draft v1.0 — 2026-07-30
**Owner:** Product (this PRD); implementation via Claude Code
**Sibling PRDs:** `00-master-prd.md`, `01-customer-website-prd.md`, `02-admin-dashboard-prd.md`, `04-marketing-seo-prd.md`

---

## 1. Overview & Goals

Self-storage is one of the few property businesses where software directly opens and closes physical doors. When a tenant rents a unit online at 11pm, the system must issue a working gate code before they drive to the facility. When a tenant goes delinquent, the system must suspend access (and the operator typically overlocks the unit). When they pay, access must be restored within minutes. This module is the bridge between the business application's tenant/lease/billing state and the physical access-control hardware at each facility.

The commercial reality (see Section 3) is that most gate-access vendors expose integrations only to established property-management-software (PMS) partners, not as open public APIs. This PRD therefore has two equally important goals:

**Goals**

1. **G1 — Vendor-agnostic access abstraction.** Define an internal Access Control Service with a stable interface (issue code, revoke code, suspend, restore, set time windows, ingest access events) and vendor-specific adapters behind it. The business logic (move-in, move-out, delinquency) never talks to a vendor directly.
2. **G2 — Fully demoable without hardware.** Ship a first-class **simulated gate controller** (mock vendor service + virtual keypad UI) so the entire lifecycle — issue → use → suspend → restore → revoke, with event logs — is buildable, testable, and demoable in the learning build with zero hardware and zero vendor contracts.
3. **G3 — Automatic lifecycle sync.** Access state is always derived from lease/billing state within a defined SLA (target: ≤ 2 minutes from triggering event under normal conditions), with no manual keypad programming by staff in the happy path.
4. **G4 — Auditable, secure operations.** Every access-state change and every gate event is logged, attributable, and surfaced in the admin dashboard; credentials for vendor systems follow least-privilege and are never stored in plaintext.
5. **G5 — Multi-facility from day one.** Each facility configures its own vendor/adapter, gate hours, and code policy; a tenant with units at two facilities gets correct access at both.

**Success measures (learning build)**

- End-to-end demo: online move-in → code issued → simulated keypad entry succeeds → simulated after-hours entry denied → delinquency job suspends code → payment restores it → move-out revokes it, all visible in the admin access log.
- 100% of access-state transitions produce an audit record with actor, cause, and correlation ID.
- Swapping a facility from the `simulated` adapter to a hypothetical real adapter requires configuration change only, no business-logic change.

---

## 2. Non-Goals

- **Building a video surveillance platform.** No video ingest, storage, streaming, or analytics. Cameras are limited to per-facility links/embeds to the vendor's own viewer (Section 8.4).
- **Kiosk hardware or kiosk software.** Out of scope until Phase 3 at the earliest (Section 8.5); the customer website is the "kiosk."
- **Native mobile app in early phases.** Bluetooth smart-lock unlock is the one credible driver for a native app; recommendation stays web-first until that phase (Section 8.2).
- **Alarm systems, individual door alarms, unit monitoring (e.g., StorageDefender-style sensors), intercoms, elevators/floor restriction, HVAC/IoT.** Interesting, not in scope.
- **Physical overlock automation.** Delinquency overlock of the unit door remains a manual staff task tracked by the admin dashboard (a task/checklist item, per PRD 02); this module only suspends *gate* access and, in a later phase, smart-lock access.
- **Becoming a certified vendor integration partner.** For the learning build we do not pursue PTI/Janus/OpenTech partner agreements; adapters beyond `simulated` are specced but stubbed.
- **License plate recognition, badge/RFID credentialing, biometric access.**

---

## 3. Integration Landscape Summary (fact-grounded)

Honest framing: this market runs on **partner-mediated integrations**, not open developer platforms. Gate vendors integrate with the major PMS platforms (SiteLink, Storable/storEDGE, Storeganise, Stora, Tenant Inc., etc.) through certified partnerships, and the integration docs live behind those partnerships. A greenfield app should assume **no public, self-serve API** for most vendors and design accordingly.

| Vendor / System | Category | Integration reality (as researchable publicly) |
|---|---|---|
| **PTI Security Systems** (StorLogix, StorLogix Cloud, EasyCode) | Keypad gate access; market leader | Integrates with many PMS platforms via partner integrations — SiteLink lists PTI as a certified gates & access partner, Storable documents a StorLogix gate integration, Storeganise and Tenant Inc./Hummingbird advertise PTI StorLogix Cloud integrations. Older StorLogix installs are on-premises Windows software synced from the PMS; StorLogix Cloud enables cloud-to-cloud sync. No open public developer API; access is partner-mediated. |
| **DoorKing (DKS)** | Telephone-entry & gate operators (broader than storage) | Markets to self-storage but is fundamentally a gate-operator/telephone-entry vendor; PMS integrations exist via middleware/partners. No public storage-oriented API. |
| **Sentinel Systems (WinSen)** | PMS + access control from one vendor | Sells its own management software *and* access control; third-party PMSs (SiteLink, Storable) list WinSen/Sentinel gate integrations, historically implemented against the locally installed WinSen components. Partner-mediated. |
| **OpenTech Alliance — INSOMNIAC CIA (Centralized Intelligent Access) / StorLogix-compatible keypads** | Cloud access control | CIA is explicitly cloud-based with a documented history of **API-based** PMS integrations (SiteLink integrated with the "OpenTech CIA API"; Storable lists it; Public Storage and Westport adopted it at scale; CIA also drives PTI keypads). Closest thing in this market to an integration-friendly cloud API — but still partner-gated, not self-serve. |
| **Nokē Smart Entry (Janus International)** | Smart electronic locks, Bluetooth/mobile-app unlock, per-unit controllers | Janus publishes a list of PMS **integration partners** (Storeganise, Stora, etc.); tenants use the Nokē mobile app for Bluetooth unlock and digital key sharing. Integration is partner-only; the tenant-facing unlock experience lives in Janus's own app, which constrains how deeply a custom portal can embed unlock UX. |
| **OpenTech INSOMNIAC Kiosks** | Self-service rental kiosks | Kiosk transacts against the PMS via OpenTech's integrations; buying a kiosk means buying into OpenTech's ecosystem. No reason to integrate in early phases (Section 8.5). |

**Design consequences**

1. **Abstraction layer is mandatory** (Section 4): vendor choice varies per facility and per acquisition; partner APIs differ wildly (cloud REST vs. on-prem sync vs. file/DLL exchange).
2. **A manual fallback is a real production feature, not a hack**: plenty of facilities run legacy keypads with no reachable API. The system must support "operator programs the keypad by hand from a work queue" as a legitimate adapter.
3. **The simulated adapter is the primary adapter for the learning build**, and it doubles as the contract-test fixture for any future real adapter.

Sources: [SiteLink marketplace — PTI](https://www.sitelink.com/marketplace/gate-access/pti-security-systems), [Storable Easy: PTI StorLogix Gate Integration](https://storageunitsoftware.zendesk.com/hc/en-us/articles/14010444763159-PTI-StorLogix-Gate-Integration), [Storeganise × PTI](https://storeganise.com/partner/pti-security), [Tenant Inc. Hummingbird × PTI StorLogix Cloud](https://www.einpresswire.com/article/566221493/tenant-inc-adds-hummingbird-integration-with-pti-storlogix-cloud-access-control-software), [SiteLink × OpenTech CIA API](https://www.insideselfstorage.com/software/self-storage-software-provider-sitelink-integrates-with-opentech-cia-api), [Storable — INSOMNIAC CIA](https://www.storable.com/resources/integration/insomniac-cia-access-control/), [Public Storage selects CIA](https://www.prweb.com/releases/Public_Storage_Selects_OpenTech_Alliance_s_Centralized_Intelligent_Access_CIA_Solution/prweb15636657.htm), [OpenTech CIA + PTI keypads](https://www.insideselfstorage.com/self-storage-products/opentech-cia-system-integrates-pti-self-storage-keypads), [Janus Nokē](https://www.janusintl.com/products/noke), [Nokē integration partners](https://www.janusintl.com/noke-smart-entry-integration-partners), [Stora × Nokē](https://stora.co/integrations/noke-by-janus-international), [Storable gate integrations index](https://storageunitsoftware.zendesk.com/hc/en-us/sections/14003130962839-Gate-Integrations), [Storable: WinSen Sentinel gate integration](https://storageunitsoftware.zendesk.com/hc/en-us/articles/14003742535447-Winsen-Sentinel-Gate-Integration), [Sentinel Systems](https://www.sentinelsystems.com/), [DoorKing self-storage](https://www.doorking.com/consumers/self-storage/), [SiteLink gates & access partners](https://www.sitelink.com/marketplace/gate-access).

---

## 4. Architecture

### 4.1 Access Control Service (ACS) and adapter pattern

A single internal service owns all access state. Domain modules (leases, billing, tenants — owned by sibling PRDs) publish events; the ACS consumes them and drives the facility's configured adapter.

```
                    ┌────────────────────────────────────────────┐
 lease.activated ──▶│           Access Control Service           │
 lease.ended ──────▶│                                            │
 billing.delinquent▶│  AccessGrant state machine (per tenant ×   │
 billing.cured ────▶│  facility): pending → active → suspended   │
                    │  → active → revoked                        │
                    │                                            │
                    │  Outbox: AccessCommand queue (idempotent,  │
                    │  retried, per-facility ordering)           │
                    └──────────────┬─────────────────────────────┘
                                   │ GateAdapter interface
        ┌──────────────┬───────────┼───────────────┬─────────────────┐
        ▼              ▼           ▼               ▼                 ▼
  SimulatedAdapter  ManualAdapter  PtiCloudAdapter  OpenTechAdapter  NokeAdapter
  (learning build,  (work queue    (stub, Phase 2+, (stub)           (stub, Phase 3)
   mock controller   for staff to   partner API
   + virtual keypad) hand-program)  required)
```

**`GateAdapter` interface (contract):**

- `provisionCode(grant): Result` — create/update a code with time-window and gate-zone attributes
- `revokeCode(grant): Result`
- `suspendCode(grant): Result` / `restoreCode(grant): Result` (vendors without native suspend implement as revoke + reprovision; the adapter hides this)
- `setTimeWindow(grant, window): Result`
- `healthCheck(): AdapterHealth`
- `capabilities(): {suspend, timeWindows, perGateZones, eventPush, eventPoll, remoteOpen}` — the ACS degrades gracefully per capability (e.g., no native time windows → enforce nothing hardware-side, but still flag after-hours events from the log)
- Event ingestion is separate: adapters implement **webhook receiver** and/or **poller** (4.2)

**Key rules**

- Business logic depends only on the `GateAdapter` interface and `AccessGrant` state machine. Vendor SDK/HTTP details live only inside adapters.
- All commands go through a persistent **outbox** with idempotency keys (`grantId + version`), exponential-backoff retry, and a dead-letter state that raises an admin alert. A command is never lost because a vendor endpoint was down.
- Adapter conformance is verified by a shared **contract test suite** run against every adapter; `SimulatedAdapter` is the reference implementation.
- Per-facility configuration selects adapter + credentials + code policy (code length, per-gate zones, gate hours).

### 4.2 Event sync: webhook + polling

Access events (entry/exit/denied) flow inbound through two mechanisms, normalized into one `AccessEvent` stream:

- **Webhook push** (preferred, for cloud vendors and the simulator): signed payloads (HMAC), per-facility shared secret, replay protection via timestamp + nonce, 2xx-ack with async processing.
- **Polling** (fallback, for vendors that only expose "give me events since cursor" or log files): per-facility scheduler (default every 60s; configurable), cursor persisted, overlap-window dedup by vendor event ID.

Normalized event: `{eventId, facilityId, gateId, vendorEventId, tenantId?, code?, direction (in/out/unknown), result (granted/denied), deniedReason?, occurredAt, receivedAt, raw}`. Unmatched codes (vendor event with no known grant) are kept and flagged — they are a security signal, not an error to drop.

### 4.3 Offline resilience

Physical access must not depend on our app being up — and our app must not lie when the gate controller is unreachable.

- **Hardware-side autonomy (design assumption):** keypads/controllers cache valid codes locally and keep operating if the network drops (this is how real systems behave). Consequence: **revocations and suspensions are eventually consistent.** The UI must show grant status as `active (pending sync)` / `suspended (pending sync)` until the adapter confirms, and the delinquency flow must not tell staff "access blocked" before confirmation.
- **App-side:** outbox retry as above; on adapter `healthCheck` failure, facility banner in admin dashboard ("Gate sync degraded since 14:02; 3 commands queued"); events buffered by vendor are back-filled by the poller on reconnect.
- **Reconciliation job:** nightly (and on-demand) full diff of expected grants vs. adapter-reported state; discrepancies create admin tasks. This catches drift from manual keypad edits, missed webhooks, or vendor-side changes.
- **Manual fallback path:** any facility can be switched to `ManualAdapter` (or a real adapter can fall back to manual on prolonged outage): commands become tasks in a staff work queue ("Program code 48213 for unit B12 on keypad; mark done"), preserving the same audit trail.

### 4.4 Integration points with sibling modules

- **Customer website/portal (PRD 01):** displays gate code + facility gate hours post-move-in; triggers delivery via email/SMS; hosts "my access" page and (Phase 3) shared-access management.
- **Admin dashboard (PRD 02):** access event log views, grant management overrides, manual work queue, gate-health banners, delinquency/overlock task list, camera links per facility.
- **Billing/lease domain (master PRD):** emits the lifecycle events ACS consumes; ACS emits `access.suspended/restored/revoked` back for timeline display.
- **Notifications service (master PRD):** ACS requests deliveries; it does not send email/SMS itself.

---

## 5. User Stories & Acceptance Criteria

**US-1: Move-in code issuance.**
*As a new tenant, when I complete move-in (online or in office), I receive a working gate code before I arrive at the facility.*
- AC1: On `lease.activated`, ACS creates an `AccessGrant` and enqueues `provisionCode` within 10s; code is unique per tenant per facility, respecting facility code-length policy, excluding trivially guessable codes (e.g., `0000`, `1234`, unit number).
- AC2: Code is delivered via the tenant's chosen channels (portal always; SMS/email opt-in) only after the adapter confirms provisioning; delivery is logged.
- AC3: Tenant renting a second unit at the same facility keeps one code (grant is facility-scoped, linked to all active leases); renting at a second facility yields a second, independent grant.
- AC4: In simulation mode, entering the code on the virtual keypad within gate hours returns "granted" and logs an `AccessEvent`.

**US-2: Move-out revocation.**
*As an operator, when a tenant moves out of their last unit at a facility, their gate access there ends automatically.*
- AC1: On final `lease.ended` at a facility, grant → `revoked` and `revokeCode` is enqueued; if other active leases remain at that facility, access persists.
- AC2: Revocation confirmed by adapter within SLA (≤ 2 min simulated); until confirmed, status shows `revoked (pending sync)`.
- AC3: Post-revocation keypad attempt is denied and logged as `denied: revoked` (verifiable in simulation).

**US-3: Delinquency suspension and restore.**
*As an operator, tenants at the overlock stage of delinquency lose gate access until they pay, and get it back automatically when they do.*
- AC1: On `billing.delinquency.stage_changed` to the configured suspension stage (per-facility policy, e.g., day 11 / overlock stage), grant → `suspended`; `suspendCode` enqueued; an overlock task is created for staff in the admin dashboard (physical overlock is manual — see Non-Goals).
- AC2: On `billing.cured`, grant → `active` and access restored without staff action; restore SLA ≤ 2 min (simulated); tenant notified on both transitions.
- AC3: Suspension never deletes the grant or code history; event log shows `denied: suspended` for attempts during suspension.
- AC4: Suspension stage transitions are idempotent — replayed billing events cause no duplicate commands or notifications.
- AC5: **In MVP the trigger is a single per-facility days-past-due threshold, not the delinquency timeline** (PRD 02 US-45, D-16): suspend at N days past due (default 6), restore automatically when the balance reaches zero. The ACS contract is unchanged either way — it consumes a suspend/restore instruction and does not care which side produced it — so the Phase-2 timeline engine replaces the *producer* and nothing here is rebuilt.

**US-4: Gate-hours enforcement.**
*As an operator, I set access hours per facility (and optionally per gate/zone), and codes only work within them.*
- AC1: Facility config defines gate hours (e.g., 06:00–22:00 facility-local time, per-day-of-week), editable in admin; changes propagate to all active grants via `setTimeWindow`.
- AC2: Where the adapter reports `timeWindows: true`, enforcement is hardware-side; simulated keypad denies out-of-window attempts as `denied: outside_hours`.
- AC3: Per-tenant extended-hours override (e.g., 24h access as a paid add-on) supported on the grant and reflected in enforcement.
- AC4: All hours logic uses the facility's IANA timezone; DST transitions covered by tests.

**US-5: Access event visibility.**
*As a facility manager, I can see who entered and left, when, and spot anomalies.*
- AC1: Admin dashboard shows a filterable event log (facility, date range, tenant, gate, result) with ≤ 60s ingestion lag from adapter receipt.
- AC2: Tenant detail page shows that tenant's recent access history.
- AC3: Flags are computed and filterable: `after_hours_attempt`, `denied_repeated` (≥ 5 denials in 15 min), `unknown_code`, `suspended_attempt`, `long_dwell` (entry without exit ≥ configurable hours, where direction data exists — degrade gracefully when the vendor can't distinguish in/out).
- AC4: Flagged events can raise notifications to manager per facility notification settings.

**US-6: Manual fallback operation.**
*As a facility manager at a site with a non-integrated legacy keypad (or during a vendor outage), I fulfill access changes from a work queue instead of the system talking to hardware.*
- AC1: With `ManualAdapter` active, every command becomes a task with the exact keypad action, code value, and reason; completing the task confirms the grant state and stamps actor + time.
- AC2: Overdue manual tasks (configurable, default 4 business hours) escalate in the dashboard.
- AC3: Switching a facility between adapters preserves all grants and history; pending commands are re-routed to the new adapter.

**US-7: Simulation-mode demo.**
*As the developer/learner, I can run the entire access lifecycle with no hardware.*
- AC1: `SimulatedAdapter` + mock gate-controller service run locally (same process or docker-compose service) with zero external dependencies.
- AC2: A "Virtual Keypad" dev page per facility accepts a code and returns granted/denied with reason, generating real `AccessEvent`s through the same webhook path a vendor would use.
- AC3: Simulator supports fault injection via config/UI: offline mode (commands queue), latency, webhook delivery failure, event backlog replay — enough to demo Section 4.3 behaviors.
- AC4: Seed script creates demo tenants in every lifecycle state across ≥ 2 facilities.

**US-9 [MVP]: Authorized access list per lease.**
*As a facility manager, I give the tenant's named people their own gate credentials, so the gate log says who actually entered and I can cut off one of them without changing the tenant's code.*
*(Raised by the operator review, 2026-07-31. A contractor sends two employees; a husband rents and his wife arrives. Today the tenant hands his code around, which destroys the log's evidentiary value at exactly the moment a theft claim needs it, and there is no way to revoke one person.)*
- AC1: A lease carries an authorized-access list: name, phone, relationship, optional access hours, active/revoked with dates and the actor who changed it. Default per-facility cap of 3 named people, configurable.
- AC2: Each authorized person gets **their own credential** through the existing grant/credential machinery — never a copy of the tenant's code — individually revocable, and suspended together with the lease when the lease is suspended for delinquency (US-3).
- AC3: Access events attribute to the credential holder, not to the lease, so "who entered" is answerable from the log alone.
- AC4: The list is **staff-managed at MVP** (the counter case is the common one). Tenant self-service from the portal is Phase 2 and inherits the same cap.

- **Self-service built in B-105** at `/portal/access`. The tenant and the counter call the *same* functions — a second path to a working gate code would be a second place for the cap, the audit entry and the suspension state to be wrong. `GrantCause` gained a `tenant:` prefix so the gate log can tell "the tenant let this person in" from "a manager did", which are different facts after a theft claim. A tenant may withdraw somebody a manager added: it is their unit, and making them ring the office is how a person keeps access they should not have over a weekend.
- **AC2's delinquency cascade was not actually wired up until B-105.** `cascadeAuthorizedAccess` had existed since B-029 with no caller, so a delinquent tenant locked out under D-16 could still send somebody in on that person's own code — the suspension was real for exactly one of the people it was meant to cover. Both directions are now driven from `applySuspend`/`applyRestore`; restoring only the tenant would have left everyone they authorised locked out permanently with nothing on any screen saying why. A person added *while* the tenant is suspended starts suspended too, or a locked-out tenant could add somebody from the portal and be back in the building on a code we issued.
- AC5: The authorized-access list and the tenant's **alternate contact** are different things and are never conflated: the alternate contact is who we call, not who gets in. Access by a non-tenant after default is a lien-process input and stays in the event log.

**US-8 (Phase 3): Smart-entry shared access.**
*As a tenant with smart locks, I unlock via my phone and grant time-boxed access to a family member.*
- AC1: Tenant can invite a secondary user (name, phone/email) with scope (which unit(s), schedule, expiry) from the portal; invitee gets their own credential — codes are never shared verbatim.
- AC2: Secondary access is individually revocable by tenant or staff and is suspended together with the primary on delinquency.
- AC3: Every secondary-user event is attributed to that person in the event log.
- AC4: Bluetooth unlock UX is honest about platform limits: web-first recommendation stands; native app/PWA decision deferred to a Phase 3 spike (see Open Questions), noting vendor reality that e.g. Nokē unlock runs through Janus's own app.

- **AC2 and AC3 needed nothing — they shipped with US-9.** Individual revocation, the delinquency cascade and per-credential event attribution are all B-029/B-105's, and re-reading them as US-8 requirements found no gap: a secondary user IS an authorized person, and giving them a second model would have been a second place for the cap, the audit entry and the suspension state to be wrong.
- **AC1's scope half built in B-086 part 1** (2026-08-25 — **D-100**, **D-101**). "Which unit(s)" was already answered — an `AuthorizedAccessPerson` hangs off one lease, which is one unit. The two genuinely missing were **expiry** and **an enforced schedule**. `expiresAt` stores the END of a facility-local day ("until the 14th" includes the 14th) and `access.expire-shared` sweeps at hour 0 facility-local, the same shape and the same DST reasoning `reservation.expire` uses. **It revokes rather than filtering**, which is the load-bearing decision: a keypad decides from the codes it was last told about and does not stop working because our server is down, so an expired person hidden from our own reads still opens the gate — the revoke goes through the outbox and reaches the controller.
- **`accessHours` was written and read by nothing for the whole of its life until this item.** Present since B-029, captured by the staff service and by B-105's portal, pushed to no controller and rendered on no screen — so a manager who set "weekends only" at the counter had configured precisely nothing, and nothing said so. `scheduleForGrant` is now the one place that decides which window a grant gets pushed, so provisioning, a settings save and a per-grant push cannot disagree; a person's window is **narrowed** against the facility's own gate hours rather than replacing them (**D-100** — replacing would hand out `extendedHours`, an add-on the facility sells, to anyone typing 00:00–23:59 into a portal form). Expressed as three presets rather than a weekly-schedule editor (**D-101**).
- **The expiry is rendered as an absolute facility-local date, never a countdown**, per PRD 01 §6.8.1 — the same standing rule B-142 applied to the transfer hold. A "3 days left" is a value a screen-reader user has to re-poll to read and is wrong the moment a page has been open overnight.
- **AC4 and `mobile_key` built in B-086 part 2** (2026-09-04 — **D-121**), which is also the spike AC4 deferred. `AccessCredentialType.mobile_key` had been in the enum since B-002 with no reader, no writer and no UI; it is now a real credential on the tenant's own grant, issued from `/portal/access`, and the unlock runs the tenant's secret through `evaluateKeypadEntry` — the same function the virtual keypad calls — so the delinquency suspension, the pushed gate hours, the fault injection and the signed webhook that writes the `AccessEvent` are the keypad's, not a second copy. A phone unlock is somebody presenting a credential at a gate; the only difference is that it is not typed.
- **AC4's honesty is the decision itself, not a caveat under it.** The unlock is **server-side, not Bluetooth** (D-121, and OQ-2 below): BLE cannot reach iOS at all, so the "web-first recommendation stands" this AC wrote down is now the built answer rather than a holding position. Two consequences are stated in the product rather than left to be found — the portal says in words that the gate code always keeps working and needs no signal, and the simulated `offline` fault **refuses** a remote unlock (a real standalone keypad keeps deciding from its own memory, and `evaluateKeypadEntry` still does, which is precisely the difference a simulation that hid it would erase).
- **A mobile key is individually revocable without touching the PIN**, which is why `revoke_credential` had to exist: every other revocation in this system is grant-scoped, and that was right for exactly as long as a holder had one credential. "I lost my phone" must not send a tenant to the office for a new gate code.
- **The gate log distinguishes `Keypad` from `Phone`.** A remote unlock can be sent from anywhere, so "the gate opened for them" stops implying "they were standing at it" — which is the first thing a manager has to be able to tell apart after a theft claim, and the event log is where they look.


---

## 6. Functional Requirements

**FR-1 Access grants.** One `AccessGrant` per **credential holder** × facility — the tenant is one holder, and each authorized person on one of that tenant's leases is another (US-9). A tenant with two units at one site still holds one grant (US-1 AC3); a tenant at two sites holds two. States `pending → active ⇄ suspended → revoked`; every transition recorded with cause (`system:move_in`, `system:delinquency`, `staff:<user>` etc.), correlation ID, and pre/post state.
**FR-2 Code policy.** Per-facility: length (4–8 digits), uniqueness scope, banned patterns, optional per-gate-zone permissions. Codes generated server-side; staff may trigger regenerate but never hand-type an arbitrary code except through `ManualAdapter` confirmation.

- **A `mobile_key` is inside the uniqueness scope but outside the length policy** (B-086 part 2). The digit policy exists because a person types the code at a keypad in the rain; nobody types a mobile key, so it is 256 bits of `randomBytes` — which also means it can never collide with a PIN and can never be presented at a physical keypad by somebody who read it over a shoulder. Every query that means "the code this tenant types" filters `type: pin` for that reason, and `codeForLease` is the one that would otherwise have rendered a 43-character token on the portal as a gate code.
**FR-3 Command pipeline.** Persistent outbox; idempotent commands; per-facility FIFO ordering; retry with backoff (max ~1h spread) then dead-letter + alert; commands superseded by newer state for the same grant are collapsed (revoke beats suspend).
**FR-4 Event pipeline.** Webhook receiver (signed) + poller (cursor-based) per Section 4.2; normalization; dedup by `(facilityId, vendorEventId)`; unknown-code retention; ≤ 60s ingestion lag target.
**FR-5 Gate hours.** Per-facility weekly schedule + holiday exceptions; per-grant overrides; propagate on change; facility-timezone correctness.
**FR-6 Delivery.** Code delivery via notifications service; template includes facility address, gate hours, and keypad instructions; re-send available from portal and admin; delivery events logged. SMS/email bodies must not include tenant name + facility + code + unit all together where avoidable (see SR-6).
**FR-7 Admin surfaces (consumed by PRD 02).** Event log views + flags, grant management (view, suspend/restore with reason, regenerate code), adapter health per facility, manual work queue, reconciliation report, camera links.
**FR-8 Simulation.** Mock controller service, virtual keypad, fault injection, seed data (US-7). Simulator exposes the same webhook signature scheme as the design's real-vendor contract so security code paths are exercised.
**FR-9 Reconciliation.** Nightly + on-demand expected-vs-actual diff; discrepancy tasks; metrics (drift count per facility).

- **Built in B-080.** The port gained a READ side (`GateAdapter.snapshot`) to make this possible at all — a write-only port can report that a command was accepted, never that the controller still agrees with us a month later. Five drift kinds, each classified by whether the gate ends up **more permissive** than intended (`unknown_at_controller`, a code the gate honours that we cannot account for, is the finding this exists for). Compared by **credential id, not by code**, so a rotation is one `code_mismatch` rather than a missing plus an unknown; and by **hashes, never plaintext**, because the findings land in a screen, a job log and a task (SR-1). An adapter that cannot enumerate — the manual one, and any vendor without a list endpoint — records `verifiable: false`, which is deliberately **not** the same as zero drift and is never rendered as a clean result. One task per facility per day, not one per finding (US-41). Nightly at 3am facility-local; on-demand from `/admin/access/health`.
**FR-10 Camera links.** Facility config stores labeled camera-viewer URLs (vendor NVR/cloud viewer); rendered as external links or sandboxed iframes in the facility page in admin; no credentials proxied, no video handled.

- **Built in B-080, links only — no iframes.** That resolves **OQ-8** in the direction it anticipated ("links-only may be the floor"): an iframe that renders a blank box because the vendor sent `X-Frame-Options: DENY` is worse than a link that works, because staff cannot tell a refused frame from a dead camera, and the one time it matters is the one time somebody is trying to see the gate. URLs are validated https-only and rejected if they carry embedded credentials — SR-1 forbids storing vendor passwords "including 'temporary' admin notes fields", and `https://user:pass@nvr…` is exactly that. The audit entry records the **host**, not the full URL, because a viewer path can carry a camera token.
**FR-11 Multi-facility.** All configuration (adapter, credentials, hours, code policy, cameras, notification rules) is per facility; cross-facility rollups only in reporting.
**FR-12 Data retention.** Access events retained per configurable policy (default 24 months, aligned with master-PRD data policy); grant/audit history retained for the life of the tenant record.

---

## 7. Security Requirements

**SR-1 Credential handling.** Vendor/adapter credentials (API keys, webhook secrets) stored encrypted at rest via the platform secret store; never in code, config files in repo, or logs; per-facility scoping so one leaked credential exposes one site. No storing of vendor account passwords in plaintext anywhere, including "temporary" admin notes fields.
**SR-2 Least privilege.** Vendor accounts/API tokens requested with the minimum scopes the adapter uses (e.g., code management + event read; not site configuration). Internally, admin permissions split: `access:view_events`, `access:manage_grants`, `access:manage_facility_config`, `access:view_codes` (viewing a tenant's actual code is a separate, audited permission — default masked `••••`).
**SR-3 Audit logging.** Immutable audit records for: every grant transition, every code view/regenerate, every adapter config or credential change, every manual-task completion, every webhook secret rotation. Includes actor (user or `system`), IP for staff actions, timestamp, correlation ID.
**SR-4 Webhook security.** HMAC signature verification, timestamp tolerance (±5 min), nonce replay cache, per-facility secrets, rotation without downtime (dual-secret window). Reject and log (rate-limited) invalid signatures.

- **Per-facility secrets and the dual-secret window built in B-080.** Rotation issues a new active secret and keeps the previous one accepted for 24 hours, because a vendor cannot change its signing key at the same instant we do — there is always a window where messages signed with either are in flight, and a single-secret rotation drops the gate events sent during it. Exactly one **active** secret per facility (partial unique index); several retiring ones are legal. The new secret is shown **once** and is never readable from any screen again. Rotation is opt-in per site: a facility nobody has rotated falls back to the shared environment secret and behaves exactly as it did before. Where no encryption key is configured, rotation is refused rather than storing a signing key in the clear.
**SR-5 Rate limiting & abuse.** Inbound webhook endpoints and virtual-keypad endpoint rate-limited per facility/IP; simulated keypad enforces attempt throttling (e.g., 5 bad codes → 10-min lockout with logged flag) to model real keypad behavior; outbound adapter calls respect vendor rate limits with client-side throttles.
**SR-6 Code confidentiality.** Gate codes hashed-or-encrypted at rest (encrypted, since they must be re-displayable to the tenant and pushed to hardware — document this trade-off), masked by default in admin UI and logs; never in URL query strings; SMS/email content minimizes combined identifiers.
**SR-7 Tenant-side security.** Portal shows codes only behind authenticated session + recent re-auth for reveal; shared-access invitations (Phase 3) expire and are single-use.
**SR-8 Transport & storage.** TLS for all adapter and webhook traffic; raw vendor payloads stored with PII minimization; secrets and event data covered by the master PRD's backup/encryption policy.
**SR-9 Fail-secure decisions documented.** Where behavior is ambiguous (vendor unreachable during suspension), the system errs toward flagging and human escalation rather than silently reporting success.

---

## 8. Phasing

### Phase 1 — Core lifecycle on simulation (learning-build MVP)
- Access Control Service, `AccessGrant` state machine, outbox/command pipeline (FR-1..FR-3)
- `SimulatedAdapter` + mock controller + virtual keypad + fault injection (FR-8)
- Move-in issue, move-out revoke, delinquency suspend/restore, gate hours (US-1..US-4)
- Event pipeline + admin event log with basic flags (FR-4, subset of US-5)
- Code delivery via portal/email/SMS (FR-6); security SR-1..SR-6 foundations
- `ManualAdapter` work queue (US-6) — cheap to build, teaches the fallback pattern

### Phase 2 — Operational hardening + first real-vendor shape
- Full anomaly flags + manager notifications (US-5 complete), reconciliation job (FR-9)
- Adapter contract-test suite; stub `PtiCloudAdapter`/`OpenTechAdapter` shaped from public integration behavior (no partner credentials; runs against simulator in "vendor emulation" profiles)
- Camera link management (FR-10); per-facility adapter health dashboards
- Extended-hours add-on grants; webhook secret rotation tooling

### Phase 3 — Smart entry & ecosystem (only with real business need)
- Smart-lock model: per-unit locks, secondary/shared credentials, unlock events (US-8); Nokē-style partner integration would require a Janus partnership — otherwise remains simulated
- ~~Native app vs. PWA spike for Bluetooth unlock~~ — **done, B-086 part 2 (D-121): no app, no Bluetooth, server-side unlock over the web portal.** See OQ-2.
- **Kiosk: explicitly deferred to here, and even then default "no."** Rationale: kiosks solve unstaffed-hours *rentals*, which our customer website already handles on any phone; kiosk hardware is capital-intensive, vendor-locked (OpenTech ecosystem), and adds a third surface to keep consistent. Reconsider only if evidence shows walk-up prospects abandoning because they won't rent on their phones.

---

## 9. Open Questions

- **OQ-1:** Which delinquency stage triggers gate suspension, and is it uniform or per-facility policy? (Owner: billing/master PRD; ACS just consumes the stage event.) Current assumption: per-facility, default = overlock stage.
- **OQ-2 — SETTLED by B-086 part 2 (D-121): neither, and no Bluetooth.** The spike found the platform half is not a preference: every browser on iOS is WebKit and WebKit has declined Web Bluetooth, so a BLE unlock in this web app would work for some Android tenants and not exist for roughly half of them. A native app does not rescue it either — the vendors who ship BLE run it from their own app against their own locks, so the blocker is a partnership, the same one B-085 and B-133 sit behind, and writing our own radio protocol against no vendor is the simulator D-63 refuses. **The unlock is server-side**: the phone asks us over the ordinary portal, we tell the controller, through the same credential and grant state a keypad code uses. Web-first stops being provisional. Revisit only if a partner arrives, in which case BLE runs in their app and `mobile_key` is unaffected — what we hold is an authorization, not a radio.
- **OQ-3:** Should suspended tenants retain *exit* access (car trapped inside scenario)? Real systems often allow exit-always. Current assumption: yes where the adapter can distinguish direction; document per-facility.
- **OQ-4:** One code per tenant per facility vs. per unit — some operators prefer per-unit codes for subleased/business units. Current assumption: per tenant per facility (simplest), revisit with shared-access design in Phase 3.
- **OQ-5:** For a future real deployment, which partner path first — OpenTech CIA (most API-oriented publicly) vs. PTI StorLogix Cloud (largest installed base)? Requires sales conversations; not answerable from public docs.
- **OQ-6:** How long do we retain raw vendor payloads vs. normalized events (storage vs. debuggability)? Default: raw 90 days, normalized per FR-12.
- **OQ-7:** Do gate-hours changes require tenant notification (courtesy vs. contractual)? Coordinate with customer-website PRD notification preferences.
- **OQ-8 — SETTLED by B-080: links only.** Some vendor viewers forbid iframing (X-Frame-Options), and a refused frame is indistinguishable from a dead camera to the person looking at it. Revisit only if a chosen vendor both permits framing and gains something real from it.

---

*Written to be handed to Claude Code as build context alongside the sibling PRDs. Build order within this module: FR-1 → FR-3 → FR-8 (simulator) → US-1/US-2 → US-3 → US-4 → FR-4/US-5 → US-6.*
