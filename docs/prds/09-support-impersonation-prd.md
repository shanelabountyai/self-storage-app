# PRD 09 — Support Impersonation ("Log in as")

**Product:** Self-Storage Business Application (learning project)
**Feature:** Staff-initiated impersonation of a tenant or another staff user, for support and troubleshooting
**Status:** Draft v1.0 — 2026-07-30
**Author:** Product Management
**Sibling PRDs:** `00-master-prd.md` (§7.1 auth & roles, §7.4 security/PII), `01-customer-website-prd.md` (tenant portal — the surface most often impersonated), `02-admin-dashboard-prd.md` (§3 roles, §4.10 audit log), `03-hardware-integrations-prd.md` (SR-2 gate-code viewing is a separate audited permission), `05-communications-prd.md` (suppression — impersonated sessions must not send)

> **Scope note:** This is a *feature* PRD, not a sixth module. It spans the admin dashboard (where a session starts) and the customer portal (what gets impersonated), and inherits every cross-cutting requirement in master PRD §7 without restating it.

> **Legal disclaimer:** Staff access to a tenant's account touches privacy disclosure and, in some states, consumer-protection expectations. The lease and privacy policy language implied by this feature is **draft-only and not legal advice** — it must be reviewed by a licensed attorney before real staff view real tenant accounts.

---

## 1. Overview & Goals

### 1.1 Problem

Support conversations stall on "it works for me." A tenant calls saying the pay button does nothing, their gate code is missing, or their balance looks wrong. A facility manager reports the unit map won't load. Today, staff can only guess from the tenant's description, or read raw database rows — neither of which reproduces what the person actually sees, and reading raw rows is both slower and *worse* for privacy than a scoped, audited view.

### 1.2 Goals

- **G1 — Reproduce the user's exact view.** A staff member can see the portal or admin dashboard as a specific tenant or staff user sees it, including their permissions, their facility scope, and their data.
- **G2 — Never become a privilege-escalation path.** Impersonation must not let anyone reach authority they do not already hold. This is the single hardest requirement in the document and everything else is subordinate to it.
- **G3 — Read-only by default.** Troubleshooting is a *looking* activity. Acting as another person is a separate, rarer, more dangerous capability that must be requested explicitly and can never cover money, credentials, or legal signatures.
- **G4 — Attributable forever.** Every action taken during impersonation is attributable to *both* the impersonated subject and the real human driving. The audit log must never show a tenant doing something a staff member actually did.
- **G5 — Visible and bounded.** The impersonator always knows they are impersonating; the session expires on its own; an owner can end anyone's session immediately.

### 1.3 Non-goals

- **Not a "become the customer" sales tool.** Completing a move-in, signing a lease, or taking a payment *as* a tenant is out of scope permanently, not deferred (see §5.3). Walk-in move-ins have their own flow (PRD 02 US-32 / B-039).
- **Not shared credentials.** This replaces the "just tell me your password" antipattern; it never involves learning or resetting the subject's password.
- **Not a data-export tool.** Bulk extraction while impersonating is not a supported workflow; reporting and CSV export have their own permissioned surfaces (PRD 02 §4.11).
- **Not customer-initiated.** A tenant cannot grant or invite an impersonation session in v1 (deferred, D-13e).

---

## 2. Personas

- **Sam (Owner/Admin, master PRD §2.4)** — the "super user" in this feature's sense: holds the `owner` role with an all-facilities assignment. Wants to diagnose an escalated complaint without a screen-share.
- **Dana (Facility Manager, §2.3)** — front-line support. Fields the "I can't pay" call and today has to escalate it. Under D-13b she does **not** hold impersonation permissions at seed; she is the persona the feature is most likely to be widened to once oversight reporting is live, and the escalation guard (§5.2) is designed so that widening is safe — she would be confined to tenants at her own facilities and could never reach a staff account.
- **Marcus (Tenant, §2.2)** — the subject. Has a reasonable expectation that account access is limited, purposeful, logged, and disclosed.

---

## 3. Relationship to D-12 (no superuser bypass)

`07-decisions.md` D-12 settled that there is **no permission bypass** — unrestricted access is always an ordinary `owner` + all-facilities `StaffFacilityAssignment` row, and nothing short-circuits `can()`, `facilityScope()`, or `checkMonetaryAuthority()`.

**This feature does not re-open D-12, because impersonation is not a bypass.** The distinction is precise and load-bearing:

| | Permission bypass (forbidden by D-12) | Impersonation (this PRD) |
|---|---|---|
| How authority is resolved | A flag skips the check | The **subject's own** assignments are resolved normally, through the same `loadStaffActor()` / tenant path |
| Resulting authority | Unbounded | Exactly the subject's, and never more than the impersonator already had (§5.2) |
| Audit story | Invisible — a boolean on a row | A dedicated session record plus dual attribution on every entry |
| Revocable | Only by editing code | Ending a row |

An impersonated session is *narrower* than the impersonator's own session in every case that matters, because of the rank rule in §5.2. If a future implementation finds itself adding a branch to `can()` to make impersonation work, that implementation is wrong.

---

## 4. Roles & Permissions

Four new permissions, seeded as data like every other (master §7.1, `packages/db/rbac-catalog.ts`):

| Permission | Grants | Seeded to |
|---|---|---|
| `impersonation:tenant` | Start a **read-only** session as a tenant | `owner` |
| `impersonation:staff` | Start a **read-only** session as another staff user | `owner` |
| `impersonation:write` | Upgrade a session to read-write (still subject to §5.3 hard blocks) | `owner` |
| `impersonation:oversee` | See all active sessions, force-end someone else's, run the report | `owner` |

**All four are owner-only at seed (D-13b).** This is deliberately tighter than the obvious "regionals field escalations, give it to them too" — because D-13a removed tenant notification, oversight reporting is now the *only* channel through which misuse becomes visible. Start with the smallest surface, get B-092's reporting running, then widen against observed usage.

Because roles are data, widening is a seed change and not a code change: granting `impersonation:tenant` to `regional` or `manager` later requires no migration. Treat that as the expected path once support volume justifies it, not as a redesign.

- **RBAC-I1:** Every permission is enforced server-side on session start **and re-checked on every request during the session**, consistent with the existing rule that a revoked role takes effect immediately rather than at token expiry.
- **RBAC-I2:** `impersonation:write` is meaningless alone — it only upgrades a session the actor could already start.

---

## 5. Functional Requirements

### 5.1 Starting a session

- **FR-1:** Staff start impersonation from a tenant or staff profile in the admin dashboard, never by typing an email into a generic box. The subject is always an entity the actor can already see under normal facility scoping.
- **FR-2:** Starting a session **requires a reason**, captured as free text plus an optional ticket reference. This is a `requiresReason` audit action; the session cannot start without it.
- **FR-3:** Sessions are time-boxed to **30 minutes** by default (per-org configurable, hard maximum 8 hours). Expiry is enforced server-side, not by a client timer.
- **FR-4:** Sessions do **not** nest. An impersonated session cannot start another impersonation.
- **FR-5:** Ending is one click ("Return to my account") and restores the original session **without re-login** — the real identity was never discarded (§6.1).

### 5.2 Who may impersonate whom — the escalation guard

This is G2 made concrete. Without it, impersonation is a privilege-escalation exploit: a manager impersonates an owner and inherits owner authority.

- **FR-6 (rank rule):** A staff subject may only be impersonated if **every** role they hold has `rank <= ` the impersonator's highest role rank. Equal rank is permitted (peer troubleshooting); higher is refused. Tenants are `rank 0` and always satisfy this.
- **FR-7 (scope rule):** The subject's facility scope must be a **subset** of the impersonator's. A manager scoped to Facility A cannot impersonate a tenant whose only lease is at Facility B, nor a manager assigned to A and B.
- **FR-8:** An all-facilities (`facilityId: null`) staff subject may only be impersonated by another all-facilities actor.
- **FR-9:** Both rules are evaluated at start **and re-evaluated per request**. If the subject is promoted mid-session, the session ends immediately rather than silently conferring the new authority.
- **FR-10:** Self-impersonation is refused (no-op with a clear message), as is impersonating a soft-deleted or suspended subject.

### 5.3 Read-only default and the permanent hard-block list

- **FR-11:** Sessions are **read-only by default**. Every mutating server action and route handler refuses, with a message naming impersonation as the reason.
- **FR-12:** With `impersonation:write`, most mutations become available — **except** the following, which are refused for **everyone, always, in any mode**:

| Blocked while impersonating | Why |
|---|---|
| Any money movement — payments, refunds, credits, fee waivers, write-offs | Financial non-repudiation; PRD 02 FR-8 |
| Payment-method CRUD (add/remove/default card, SetupIntent) | PCI blast radius, master §7.4 |
| Password change, password reset, email change | Account-takeover vector — the whole point is *not* needing their credentials |
| Role/permission/assignment changes | Direct privilege escalation |
| Starting another impersonation | FR-4 |
| Revealing an unmasked gate code | PRD 03 SR-2 makes this a separate audited permission; impersonation must not launder it |
| E-signing a lease or any document | E-SIGN/UETA — a signature must be the actual person |
| Deleting documents | Evidence-chain integrity |
| Sending any outbound message (email/SMS), including "resend my gate code" | PRD 05 — a support session must not spam the tenant |

- **FR-13:** Blocks are enforced in the **service layer**, not by hiding buttons. Hiding is a UX courtesy; the check is the control.

### 5.4 Visibility

- **FR-14:** A persistent, high-contrast banner is fixed to the viewport for the entire session, naming the subject, the remaining time, the mode (read-only / read-write), and a "Return to my account" control. It is not dismissible.
- **FR-15:** The banner meets WCAG 2.1 AA (master §7.2) and is announced to assistive technology on entry — a screen-reader user must not be unaware they are impersonating.
- **FR-16:** **Tenants are not notified when staff view their account** (D-13). No email, no SMS, no in-portal alert fires on session start or end. This is a deliberate decision, not an unimplemented feature — do not add "helpful" notification later without amending D-13.
- **FR-17:** Not notifying changes nothing about the *record*. The `ImpersonationSession` row and the dual-attributed audit entries are written exactly as specified in §6, remain append-only, and remain fully discoverable by an owner, by a regulator, and in any dispute. SR-6 (non-repudiation) is unaffected: the decision is about what the tenant is *pushed*, never about what is *kept*.

> **Revisit if the operating footprint changes.** Texas is the seeded compliance default (D-10) and has no general consumer right-to-know covering this. Several states' privacy regimes — California's CPRA most prominently — take a different view of access disclosure. Because compliance config is per-state by design, expanding outside Texas should re-open this specific question rather than inheriting the Texas answer silently.

### 5.5 Oversight

- **FR-18:** An owner sees all active sessions and can force-end any of them immediately.
- **FR-19:** An impersonation report, filterable by impersonator / subject / date / facility and CSV-exportable, mirroring PRD 02 US-38's audit-log surface.
- **FR-20:** Sessions exceeding a configurable frequency threshold (e.g. one staff member impersonating >N distinct tenants in a day) raise an operational flag. Detecting misuse is a reporting concern, not a blocking one.
- **FR-21:** Because the tenant is never notified (D-13a/FR-16), oversight is the *only* place misuse surfaces. FR-18–FR-20 are therefore load-bearing rather than nice-to-have, and B-092 should not be deferred indefinitely behind B-091.

### 5.6 Render target

- **FR-22:** An impersonated tenant session renders **the real portal at its real URLs** (D-13d), not a copy embedded in the admin shell. G1 is "reproduce the user's exact view," and the bugs people actually call about — layout, responsive breakpoints, a control that doesn't respond — are exactly the ones an embedded reproduction would hide.
- **FR-23:** URL segregation is therefore explicitly **not** a security control here. The controls are the persistent banner (FR-14), the service-layer write blocks (FR-11–FR-13), and the escalation guard (§5.2). An implementation must not assume "it's under `/admin`, so it's safe" — the impersonated session lives outside `/admin` by design.

---

## 6. Data & Integration Points

### 6.1 Session model

The real identity is **never replaced** — replacing it is precisely how attribution gets lost. The token carries both, and the authoritative state lives in a row, not the token:

- **`ImpersonationSession`** — `id`, `impersonatorStaffId`, `subjectType` (`tenant` | `staff`), `subjectId`, `facilityScopeSnapshot`, `mode` (`read_only` | `read_write`), `reason`, `ticketRef?`, `startedAt`, `expiresAt`, `endedAt?`, `endedBy?` (`self` | `expiry` | `forced` | `authority_changed`), `ipAddress`.
- The session JWT gains an `impersonationSessionId` claim. Every request loads that row and validates it is unexpired and unended.

**Why a row and not just the JWT:** a JWT cannot be revoked, and FR-9/FR-18 both require server-side termination mid-session. This also matches the existing precedent that authority is re-read per request rather than trusted from the token.

**Retention: ≥7 years, matching the audit log (D-13c).** The rows are a few hundred bytes each, and with no tenant notification they carry the accountability trail on their own. A shorter window would strand the audit entries that reference them — you would still know an impersonation occurred, but not its stated reason, its duration, or who ended it, which is most of what an investigation needs. `ImpersonationSession` rows are therefore **not** covered by any shorter former-tenant PII purge; they hold no tenant PII beyond an id reference.

### 6.2 Audit attribution — schema change required

`AuditLog` currently records a single actor (`actorType`, `actorStaffId`, `actorLabel`). That is insufficient here: an action taken during impersonation has two responsible parties.

- **FR-24:** Add nullable `impersonatorStaffId` and `impersonationSessionId` to `AuditLog`. The **actor stays the subject** (they are who appeared to act); the impersonator is recorded alongside. A log filtered to a tenant still shows what happened to their account, and a log filtered by impersonator shows everything a staff member did while wearing someone else's identity.
- **FR-25:** New audit actions, both requiring a reason: `impersonation.started`, `impersonation.ended` (recording `endedBy`).
- **FR-26:** The change is purely additive — two nullable columns — which is compatible with the append-only triggers on `audit_log` (no backfill, no row rewrites).

### 6.3 Interaction with existing subsystems

| Subsystem | Interaction |
|---|---|
| Auth (B-003) | New claim on the existing JWT; no change to session length, cookie flags, or providers |
| RBAC (B-004) | Subject's authority resolved through the **existing** `loadStaffActor()` / tenant path; `facilityScope()` still fails closed and is never widened |
| Audit (B-005) | Two nullable columns + two catalog actions; append-only triggers unaffected |
| Events (B-006) | Impersonated sessions may emit domain events only in read-write mode, and never `payment.*` or comms-triggering events |
| Comms (B-030) | Impersonated sessions are hard-suppressed as senders (FR-12) |

---

## 7. Security Requirements

- **SR-1 — Escalation guard is the primary control.** FR-6/FR-7/FR-8 are the security boundary. They belong in one function with a dedicated adversarial test suite, including: manager→owner (refused), manager→peer manager at an unassigned facility (refused), owner→owner (permitted), staff promoted mid-session (session ends).
- **SR-2 — Defense in depth on writes.** Read-only enforcement lives in the service layer. A page that forgets to hide a button must still be safe.
- **SR-3 — No credential exposure.** Impersonation never reveals, sets, or resets the subject's password, and never exposes a token that outlives the session.
- **SR-4 — PII minimization (master §7.4).** Impersonation grants *view parity*, not extra visibility: anything masked for the subject (gate codes, partial card digits) stays masked. Impersonation must never render a field the subject themselves cannot see.
- **SR-5 — Bounded exposure.** Short default TTL, hard maximum, server-enforced expiry, forced-end capability.
- **SR-6 — Non-repudiation.** No configuration, role, or flag can produce an unattributed action. If the session row cannot be written, the session does not start.
- **SR-7 — Rate limiting.** Session starts are throttled per impersonator, reusing the existing DB-backed throttle rather than a new mechanism.

---

## 8. Phasing

| Phase | Contents |
|---|---|
| **Phase A (core)** | Session model, four permissions, escalation guard, read-only enforcement + hard-block list, banner, dual-attribution audit, start/end/expiry |
| **Phase B (oversight)** | Active-session list with force-end, impersonation report + CSV, frequency flags |
| **Later / optional** | `impersonation:write` mode, tenant-initiated support invitations (D-13e) |

Phase A's dependencies (B-003 auth, B-004 RBAC, B-005 audit) are all built, so it is buildable now. It is nonetheless **internal tooling, not MVP golden-path work** — recommended placement is Phase 2, after the money loop works, unless support pain arrives sooner.

Read-only tenant impersonation is by far the highest value-to-risk slice. If this gets trimmed, keep that and drop everything else — but note that D-13a/D-13b make Phase B's reporting the sole misuse-detection channel, so "Phase A only, indefinitely" is not a safe resting state.

---

## 9. Settled decisions

Resolved by the owner 2026-07-30 and recorded as **D-13a–D-13e** in `07-decisions.md`, which takes precedence over anything above that contradicts it. Do not re-open without amending that log.

| Ref | Question | Decision |
|---|---|---|
| D-13a | Notify tenants when staff view their account? | **No.** No email, SMS, or in-portal alert. The record is still written in full (FR-16/FR-17). |
| D-13b | Which roles get impersonation permissions at seed? | **Owner only**, all four. Widen via seed once B-092 reporting is live (§4). |
| D-13c | Retention of `ImpersonationSession` rows | **≥7 years**, matching the audit log (§6.1). |
| D-13d | Where does an impersonated portal render? | **The real portal at real URLs**, not embedded in the admin shell (FR-22/FR-23). |
| D-13e | Tenant-initiated support access | **Deferred**, not rejected — revisit together with D-13a if that is ever reconsidered. |

## 10. Open Questions

1. **Lease/privacy-policy disclosure.** This feature implies language stating staff may access an account for support. Drafting it is in scope for whoever builds Phase A; **attorney review is required** before real staff view real tenant accounts (D-10, Texas default). This is a task with a legal dependency, not a design choice.
2. **Should `impersonation:write` ship at all?** §8 lists it as "later / optional." Every troubleshooting case identified so far is satisfied by read-only. If no concrete need appears by the time Phase B lands, the honest move is to delete the permission rather than carry an unused write path through the codebase.
3. **Frequency-flag threshold (FR-20).** "More than N distinct subjects per day" needs a real N, which needs observed usage. Ship Phase B with a conservative default and tune.

---

## 11. Acceptance Summary

The feature is done when an owner can answer "what does this tenant actually see?" in under a minute, and can separately answer "who looked at this account, when, why, and what did they do?" from an append-only record — while it remains provably impossible for *any* impersonator, at any role, to acquire authority they did not already hold.

(The first question is deliberately an owner's to answer for now, not a manager's — D-13b. The escalation guard in §5.2 is what makes widening to `regional`/`manager` a seed change rather than a security review.)
