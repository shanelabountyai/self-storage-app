# Build progress — part 06

_Detail entries, in build order. The index over every part is [`../PROGRESS.md`](../PROGRESS.md)._

## Feature PRDs added mid-build

### PRD 09 — Support impersonation ("log in as") 📋 specced, not built

`docs/prds/09-support-impersonation-prd.md`, backlogged as B-091 (core) and B-092 (oversight). Owner decisions recorded as D-13a–e.

Impersonation is **not** a permission bypass and so does not re-open D-12: the subject's own assignments resolve through the normal path, bounded by an escalation guard (subject's role rank ≤ impersonator's, facility scope a subset). Read-only by default with a permanent hard-block list — money, credentials, role changes, gate-code reveal, e-signature, outbound sends.

D-13a (no tenant notification) and D-13b (owner-only) are linked: with no tenant-facing signal, B-092's oversight reporting is the sole misuse-detection channel.

---

## Continued — in build order

### B-058 — Overlocks: the status that had no producer

`fd446c9`

**What it built.** The physical half of PRD 03 US-3. `overlocked` has been in
the unit status enum since B-010 with nothing setting it —
`occupancyFactsForMany` said so in a comment naming this item. Now a
`UnitOverlock` row carries the whole life of a lock: requested, applied,
removed, each with a staff id and a timestamp, and the unit's derived status
follows it. B-057's engine raises a typed `overlock_apply` task for a timeline
step that means "go and fit a lock", and `releaseOverlock` on cure either
queues the removal or withdraws a request nobody actioned. Ten new DB tests.

**What it decided.**

- *Requesting a lock does not overlock a unit — fitting one does.* The status
  flips on task completion, not on the engine raising the task. A unit reading
  `overlocked` while the lock is still in the office is a lie an auction file
  cannot survive, and staff would have no way to correct it.
- *The apply task requires a photo.* US-25's table calls the photo optional;
  US-28's evidence rules for the sale it leads to do not. A lock nobody
  photographed is a lock a tenant can say was never fitted, so
  `requiredProofFields` on `overlock_apply` is `['note', 'photo_reference']`
  and `completeTask` refuses without it. This deliberately tightens US-25.
- *Idempotency is a partial unique index, not a code check.*
  `unit_overlock_one_live_per_unit ON ("unitId") WHERE "removedAt" IS NULL` —
  so a replayed stage event (AC4) cannot produce a second lock or a second
  task, and history still permits a fresh lock after an earlier one came off.
- *A request that was never fitted is withdrawn, not removed.* Raising a
  "go and take the lock off" task for a lock nobody ever put on is how a queue
  stops being trusted. `releaseOverlock` cancels the open apply task instead.
- *Overlock steps are recognised by label, via one exported predicate.*
  `isOverlockStep` lives in core beside the timeline rules, so the engine and
  its tests share one rule. The alternative — a seventh automated action —
  was wrong: an overlock is not automated, it is a person with a padlock.
  A test asserts the example configuration still matches it, because a rename
  there would silently degrade to a generic task with no record behind it.
- *Removal keeps the row.* `removedAt` is stamped, nothing is deleted —
  "was this unit locked on the day of the sale" is a question US-28 turns on.

**What it left behind.** The ≤2-minute restore SLA is asserted as "the restore
is an inline call on the settling payment, not a nightly sweep" rather than by
timing a clock — B-098 already owns that path and this item did not rebuild it.
No admin screen specific to overlocks: they surface as unit status on the units
board and as tasks in the existing queue, which is where staff already look.
Lien and auction consumption of this history is B-061/B-062.

**A note on the tests.** Two B-057 tests used a step labelled "Overlock" to
exercise the *generic* staff-task path. Since this item that label routes
elsewhere, so they were repointed to a certified-letter step; the overlock path
has its own file.

---

### B-059 — Delinquency queue

`65bb8e6`

**What it built.** US-26's screen: "today's due steps grouped by type
(overlocks to apply/remove, notices to mail, proofs to record), so nothing is
missed." `delinquencyQueue` filters `facilityTasks` down to the three
delinquency-related types and groups them in that order — no new query, no new
table, per US-41's AC that every later queue reads the one `Task` list. Lives
at `/admin/delinquency`, the nav destination that already existed pointing at
the generic `[section]` placeholder, gated on the `delinquency:execute_step`
permission that was already in the catalog.

**What it decided.**

- *A generic-task bug in B-058 surfaced while wiring the form.* The plain
  `/admin/tasks` list only ever collected a `note`, so completing an
  `overlock_apply` task from there would always fail proof validation for
  the missing photo — nobody would have hit it until an operator tried. Fixed
  by threading `requiredProofFields` onto `TaskRow` (computed from the
  catalog) and rendering a conditional photo field on both the generic list
  and this one, off the same data rather than each screen guessing.
- *Escalation is text, matching B-065's keypad queue rather than inventing a
  second convention*: an `role="alert"` count banner plus a per-row "Overdue"
  label, never colour alone (1.4.1).

**What it left behind.** Assignment and reassignment already exist on the
generic queue (`assignTask`) and were not duplicated here — this screen is
about completing today's steps, not managing who owns them. FR-22's table
semantics (`scope="row"`, `aria-sort`) don't apply: like the two queues it
follows, this is a card list, not a data table.

---

### B-060 — Field ops: overlock reconciliation, the daily walkthrough, maintenance tickets

`dd93511`

**What it built.** The three US-35/36/37 stories, each as thin as the backlog
line asked for: "all as `Task` types and views, not new queues."

- *US-36, overlock reconciliation* (`/admin/overlocks`). A pure classifier
  (`classifyOverlock`, packages/core/delinquency) reads a live `UnitOverlock`
  row plus whatever open `overlock_remove` task belongs to its lease and
  states which of three things is true: awaiting apply, awaiting removal, or
  confirmed and steady. Mismatch is a flag, not a fourth state — over 24h in
  either non-steady state, per the AC. No new table: the whole view is a join
  over rows B-058 already writes.
- *US-35, the daily walkthrough* (`/admin/walkthrough`). One `Task` (type
  `daily_walkthrough`) per facility per day, raised at 7am local by a new
  `SCHEDULED_JOBS` entry, standing for "did anyone walk the property" as a
  completable fact. Its page assembles the real per-unit work from lists that
  already exist — B-059's overlock groups, and B-014's `/admin/units/ready`
  count-and-link — plus a "report a finding" form that creates a
  `MaintenanceTicket` directly. Nothing here is a new queue; it is one task
  type and a page that reads three existing sources.
- *US-37, maintenance tickets* (`/admin/maintenance`, + a "Report issue" link
  per row on the units board). A real `MaintenanceTicket` entity — the master
  PRD names it beside `Task` in §7, unlike the walkthrough — with status
  (open/in_progress/blocked/done), priority, an assignee, and its own
  `blocksAvailability` flag. `UnitOccupancyFacts` gained
  `blockingMaintenanceTicket`, and `canSetManualStatus` refuses `available`
  (only `available` — `maintenance`/`unrentable` stay reachable) while one is
  open, naming the ticket the way it already names a lease or a reservation.

**What it decided.**

- *A blocking ticket only narrows `available`, nothing else.* "The paint is
  chipped" and "the roof leaks" can both be open tickets; only the flag says
  which one should stop a unit renting out from under a contractor.
- *Opening a blocking ticket sets `maintenance` intent; closing one does not
  revert it.* Matches the precedent move-out already set for the same column —
  intent is a deliberate act, not an inference from whatever the last event
  was.
- *No new Task type for "recently vacated, needs a lock check."* B-014's
  `/admin/units/ready` already is that queue — it has existed since move-out
  got its own item, just never described as part of a "walkthrough." Building
  a parallel `Task`-based version would have duplicated a working screen the
  AC's own principle argues against. The walkthrough page links to it and
  shows a live count instead.
- *"Skipped days are visible" needed no extra code.* An uncompleted
  `daily_walkthrough` task from a prior business day simply stays open and
  reads as overdue through the same rendering every other queue already uses.

**What it left behind.**

- *Fixed in passing*: `UnitOverlock.removedTaskId` had existed on the schema
  since B-058 and was never written. `releaseOverlock` now sets it — and the
  reconciliation view's whole reason to exist is exactly that join, so this
  was found while building the thing that needed it, not gone looking for.
- No per-unit detail page exists yet, so "create from the unit page" (US-37's
  AC) is the units board's new "Report issue" link into `/admin/maintenance`
  rather than a dedicated screen — there is nowhere else for it to live until
  one is built.
- The walkthrough's photo attachment (US-35's AC) rides on the same
  `photo_reference` proof field every other task type uses; there is still no
  blob store behind it, a gap B-058 already noted and carries forward.

---

### B-061 — Pre-lien and lien notice generation

`ab148d6`

**What it built.** US-27's generated notices, with US-13's evidence chain
attached. A `NoticeTemplate` (versioned, per-facility, org-default fallback)
holds the text; `generateNotice` renders it through the existing document store,
so the notice is stored, hashed and verifiable by `verifyDocument` like every
other generated document. `/admin/settings/notices` is where an operator and
their attorney write the text; the tenant's per-lease Notices screen is where
staff preview, generate and record service. 74 new tests (52 pure, 22 DB).

**What it decided.**

- *A notice cannot be generated when the ledger and the invoices disagree.* Not
  a warning — a refusal, with the reason on screen. US-27 asks that the claim
  "reconciles to the ledger at generation time"; if the two sources of truth
  disagree then nobody knows what the tenant owes, which is exactly the moment
  to stop rather than to bake the discrepancy into a legal document and mail it.
  `claimForNotice` reuses B-049's `reconcile` verbatim so the ledger screen and
  the notice can never disagree about whether a lease reconciles.
- *The claim itemizes payments too, not only charges.* A claim listing charges
  and quoting a net total overstates the debt by exactly what the tenant paid —
  the first thing an attorney checks. `buildClaim` also asserts its own lines
  sum to its own total, which is unreachable-by-construction and checked anyway.
- *A separate table from `MessageTemplate`, deliberately.* Reusing it would have
  been less code and was wrong three ways: a statutory notice is a served
  document rather than an email; B-063's courtesy email supplements would share
  the key namespace with the thing they explicitly are not; and B-056's
  `validateTimeline` resolves `noticeTemplateKey` against `MessageTemplate`, so
  a notice template living there becomes selectable as a `send_notice` target —
  emailing the statutory notice through a path with no consent check and no
  delivery proof. The schema comment records all three.
- *`notice_email` consent is checked in the service, not the screen*, and
  `account_email` does not satisfy it. US-13 is explicit that overloading the
  two destroys the ability to prove agreement. Never-asked and consent-withdrawn
  give different messages because they need different fixes from whoever is at
  the counter.
- *The rendered address is snapshotted on the `Notice` row, not joined.* A
  tenant who moves on day 40 must not retroactively change where an already
  served notice says it went. `tenantAddressId` keeps the provenance chain back
  to the history row.
- *A correction is a new document.* `correctsNoticeId` forward, `supersededAt`
  back; the original's bytes and hash are untouched, and delivery cannot be
  recorded against a superseded notice.
- *No template means no notice.* A facility that has not written its text
  generates nothing, rather than silently mailing the unedited example — the
  same posture B-056 took for an unconfigured timeline, for a stronger reason.
- *Every delivery method requires proof*, and a notice posted on a unit requires
  a photo: the claim a tenant most easily denies.

**What it left behind.**

- *A shared-renderer change worth flagging.* `renderTemplate` escapes every
  merge value, correctly — which double-escaped the itemized claim table into
  visible markup. Fixed with a narrow `rawFields` parameter naming the merge
  fields whose value is markup this application built (one: `claimTable`).
  A template cannot opt itself in — the list comes from calling code — and
  `claimTableHtml` escapes every record-derived string it embeds. Four tests
  in `documents-db.test.ts` pin the blast radius.
- *B-056's example timeline said the pre-lien and lien templates "belong to
  B-063 and are unwritten".* That was the wrong reason even when written; the
  right one is that those keys name email templates and these notices are
  documents. Comment and step labels corrected; the labels now point staff at
  the notices screen. The invariant test was renamed to state the real rule.
- The deadline is `DEFAULT_DEADLINE_DAYS` (14) with a per-notice override, not
  a facility setting. Deliberate: the lawful figure is statutory and differs by
  stage, and a configurable field here would imply the system knows which value
  is compliant. The timeline (B-056) is where the schedule is encoded.
- Still HTML rather than PDF, per B-023's standing decision — no tagged-PDF
  encoder exists in this runtime, and the hash and evidence chain work
  identically. Certified-mail API integration is B-083; today staff type the
  tracking number.

---

### B-062 — The auction pipeline

`5e92979`

**What it built.** US-28 end to end: `AuctionCase` (one live case per lease, via
a partial unique index) with its advertising runs, the hard-blocked scheduling
gate, the lock-cut inventory as a hashed document, the buyer record, the
system-computed proceeds waterfall posting real ledger entries, and surplus
tracked as a liability until somebody records where the money went.
`/admin/auctions` lists cases and outstanding surpluses; the case screen carries
US-29's disclaimer and the pinned timeline summary. 131 new tests (97 pure, 34
DB), including a swept identity check over the waterfall.

**What it decided.**

- *The waterfall accounts for every cent, and asserts it.* `distribute` returns
  costs-recovered, applied-to-lien and surplus, and throws if they do not sum to
  gross proceeds. Unreachable by construction; checked anyway, because money
  falling out of the waterfall is the failure the file exists to prevent. A
  swept range test covers ~200 combinations.
- *The surplus is never posted to the lease ledger.* Sale costs post as a
  charge and the recovered amount as a payment, so the lease nets to zero (or
  to a real deficiency). Posting the surplus as a credit would make it read as
  discharged the moment it was recorded — exactly how a surplus gets quietly
  retained. It is a liability against the case, and it stays on the auctions
  screen until dispositioned.
- *A surplus starts `held`, never `no_surplus`*, and `no_surplus` cannot be
  chosen by a person. Otherwise a real surplus could be closed out by declaring
  it never existed.
- *Every blocker is reported at once, not the first.* A manager fixing one
  blocker per round, discovering the next each time, is how a deadline gets
  missed and a corner gets cut.
- *A vehicle blocks approval as well as scheduling.* Approving a case that can
  never be scheduled would leave a signed-off record of a sale nobody may run.
- *A served lien notice is a scheduling precondition*, joined to B-061:
  `status: delivered` and not superseded. Generated-but-never-served does not
  count — a sale with no served notice behind it is the commonest wrongful-sale
  claim there is.
- *Approval requires rank ≥ 30 (regional).* A site manager cannot approve the
  sale of their own site's tenant.
- *The lock-cut inventory is written once*, requires a photograph per line, and
  refuses an empty list — "no items of value" is itself a line that has to be
  written down. It renders through `storeGeneratedDocument`, so it is hashed and
  verifiable like a notice.
- *The buyer's government ID is a REFERENCE, never the number.* Enough to find
  the record, not enough to become a breach-notification liability.
- *`surplusHoldDays` is a facility setting with its control shipped in this
  item*, per the repo rule. US-28's own note says the duration needs an attorney
  pass under D-10, so the field is labelled a placeholder rather than a legal
  figure.

**What it left behind.**

- Two schema invariants correctly caught the new fields and were extended with
  reasons rather than loosened: four calendar dates (`@db.Date`), and
  `AuctionAdvertisement` as scoped through its parent case.
- The sale releases the unit to `maintenance` and ends the lease, reusing
  B-040's path — so a sold unit cannot go back on sale before somebody has
  opened the door.
- Online auction platform listing is B-083, still P2. Nothing here talks to an
  external marketplace; the advertising record is what staff type.
- Cancelling returns the lease to `delinquent` and lets the delinquency engine
  decide from there, rather than asserting the tenant paid — if they really did,
  the engine's own cure path runs.

---

### B-063 — Comms delinquency-stage notices and pre-lien/lien courtesy supplements

`959af72`

**What it built.** CN-11's remaining stage pair (overlock applied/removed) and
CN-12's pre-lien/lien courtesy supplements, on B-030's existing engine —
templates, notification rules, merge-field schema entries, and the event
wiring to fire them. The access-suspended/restored pair already shipped with
B-098; this closes out the rest of PRD 05's delinquency-stage list. 22 new
tests (14 pure copy/wiring checks, 8 against the database and the real seeded
catalog).

**What it decided.**

- *Two catalog event names had been reserved and never used.* `overlock.required`
  and `overlock.cleared` sat in packages/core/events/catalog.ts since B-057's
  planning with nothing emitting them. `confirmOverlockApplied` and
  `confirmOverlockRemoved` (B-058) now emit them in the same transaction as the
  state change — found while building the thing that needed them, not gone
  looking for.
- *The courtesy supplement quotes the notice's own snapshot, never a live
  balance.* `notice.generated`'s payload carries the claim total and deadline
  exactly as B-061 stored them on the `Notice` row. Recomputing at send time —
  the pattern every other rule in this catalog uses — would risk the email
  disagreeing with the mailed document it describes, which is worse for a
  courtesy message than a stale figure would be for a reminder.
- *One event, two templates, filtered by a skip condition each.* `notice_type_not_pre_lien`
  and `notice_type_not_lien` reuse the same device the catalog already needed
  for anything scoped narrower than its event — exactly one of the two fires
  per generated notice.
- *The courtesy language is tested as content, not trusted as prose.* Both
  supplement templates are checked for "courtesy", "not the formal notice",
  "by mail", and "lease and state law" — and checked to contain NONE of several
  phrasings that would read as the email being service of process. The same
  discipline B-056 applied to the timeline's own disclaimer.
- *FR-18 staleness gets a new predicate for the overlock notice*
  (`overlock_already_cleared`): a tenant who paid and had the lock removed
  between the event and the dispatch must not receive "we've locked your
  unit."

**What it left behind.**

- *SMS is out of scope, matching the existing architecture.* CN-12 asks for
  "email (and SMS if consented)"; B-030 shipped email-only (FR-4) and no SMS
  provider is wired in this codebase yet. Both supplements are email; the SMS
  half is a gap B-030 already carries, not a new one from this item.
- *A real bug in the test harness, not the product*: the seed script only runs
  when explicitly invoked — a schema change alone does not populate
  `NotificationRule`/`MessageTemplate` rows into either database. Re-running
  `db:seed` and `db:migrate:test` was what made the new templates actually
  sendable; a session that edits `comms-catalog.ts` without reseeding will see
  every new rule silently match nothing.
- No new admin screen: the existing per-facility template editor (B-053, CN-16)
  already reads `MessageTemplate` generically, so all four new templates are
  editable there with no further work.

---

### B-071 — Reviews: manual entry, facility-page display, review-request email

`e3e4ec9`

**What it built.** FR-REV-1/2/3 and US-6/US-7 end to end. A `Review` entity
(immutable content, hide-not-edit per FR-REV-2, same convention as
`TenantNote`), manual entry and visibility management at
`/admin/settings/reviews`, the average-plus-N-most-recent block on the
facility page, and a per-facility scheduled job that raises a one-time
review-request email N days after move-in (default 7, its own settings
control shipped in this item). 88 new tests (52 pure, 36 against the
database and the real seeded catalog).

**What it decided.**

- *`aggregateRating` never gets fed by manual reviews — recorded as D-33,
  closing PRD 04's own Open Question Q3.* Google's structured-data policies
  for review snippets require the rating be independently verifiable as
  collected by the site marking it up; a staff transcription of a rating
  authored and verified on Google itself is republished third-party data, not
  this site's own collection of it. The stakes are asymmetric with the upside:
  one facility's star rating against a manual action that can suppress
  rich-result eligibility **sitewide**. `qualifiesForSchemaMarkup` encodes
  "every review source is `google_api`" rather than a flag someone could
  enable early, so it is false by construction until FR-REV-4 (Phase 3) ships
  a real source. This was already anticipated at B-066 — `selfStorageJsonLd`'s
  `aggregateRating` parameter has carried the exact warning in its own comment
  since before `Review` existed.
- *The review-request delay is a per-facility scheduled job, not an
  event-driven wait.* "N days after X" needs something that ticks nightly and
  asks whether enough time has passed — the same shape B-043's expiry scans
  and B-097's follow-up sweep already use. `reviewRequestDue` uses `>=`, not
  `===`, so a catch-up run (or a facility that only just configured its review
  link) still raises every tenancy that already cleared the delay.
- *A facility with no Google review link never sends, and is never stamped
  for having tried.* A review ask with nowhere to leave the review is worse
  than not asking. Because eligibility is `>=`, the moment an operator sets
  the link, the next run catches up every tenancy that was already waiting —
  no lease is ever silently skipped forever for a gap that gets fixed later.
- *`reviewRequestSentAt` is stamped in the SAME transaction as the emit*, the
  same device `Reservation.expiryReminderSentAt` uses — the outbox only
  dedupes an event that already exists, so "once per tenancy" is the
  producer's job.
- *Classified `marketing`, not `transactional`.* This is a solicitation, and
  the suppression matrix only honours an unsubscribe/manual block for that
  classification — real protection even before B-072 builds explicit
  marketing-consent capture. `lease_on_hold_marketing` (already existing) is
  reused verbatim as the operator's manual-exclusion path AC2 asks for,
  needing zero new mechanism.
- *A suppressed send still counts as the one request.* AC2's "max 1 per
  tenancy" is used up by a suppressed attempt (moved out, on a marketing
  hold), not retried once the condition lifts — matches how every other
  once-per-something guarantee in this codebase behaves.

**What it left behind.**

- *Open/click tracking is explicitly NOT built.* AC3 asks for it; nothing in
  this codebase does open-pixel or click-redirect tracking for ANY template
  today, and building it narrowly for one new email would be backwards — every
  other message (dunning, payment failures) would benefit from it more. Send
  tracking (the `Message` row + status, identical to every other template)
  and a per-facility sent/suppressed/failed count on the settings screen are
  built; genuine open/click needs a general mechanism, which belongs with
  B-054's delivery dashboard or a dedicated item, not bolted onto reviews.
- Same seeding gotcha as B-063, hit again and fixed the same way: editing
  `comms-catalog.ts` needed `db:seed`/`db:migrate:test` re-run before the new
  template/rule existed in either database — the tests failed with zero sends
  until that ran.

---

### B-072 — Marketing consent + lead drip

`8826b4c`

**What it built.** FR-MSG-1 through 5 and US-13/US-14: an explicit,
unchecked-by-default `marketing_email` consent checkbox on the lead-capture
form; a real, working, signed one-click unsubscribe link on every marketing
email (nothing linked to `/unsubscribe` before this item, though the
suppression table and its `unsubscribe` reason already existed from B-054);
FR-MSG-5's quiet-hours (9pm-8am facility-local) and max-1-marketing-email/day
caps, enforced centrally rather than per-rule; and the three-step lead drip
(quote recap → value email → conditional promo nudge) as one new domain
event, three templates, and both an immediate consumer (step 1) and a
day-counted per-facility job (steps 2/3). 88 new tests (39 pure, 49 against
the database and the real seeded catalog).

**What it decided.**

- *`review_request` (B-071) is NOT retroactively gated on the new consent
  requirement — recorded as D-34.* FR-MSG-4 lists lead drip, abandoned
  reservation and review request together as the three sequences US-13's
  consent rule governs, and a literal reading would gate all three. Rejected
  for review_request specifically: tenants have no consent-capture point yet
  (this item's checkbox lives on the anonymous LEAD form), so gating
  retroactively would have silently stopped every review request the day
  this shipped, for every existing tenant, with no way for an operator to
  turn it back on. What DOES apply universally — the unsubscribe link, quiet
  hours, the daily cap — costs nothing and closes a real gap, so those are
  enforced centrally for every `marketing`-classified send regardless of
  which item shipped it, retroactively covering review_request too.
- *Quiet hours and the daily cap are enforced centrally, not as an opt-in
  skip condition.* The same reasoning the postal footer already uses ("an
  edited template cannot drop a CAN-SPAM requirement") — a future marketing
  rule that forgot to list the skip condition would silently violate
  FR-MSG-5, so the check lives in `deliverForRule` itself, gated on
  `classification === 'marketing'`.
- *The daily cap is a rolling 24h window, not a facility-local calendar
  day.* Simpler, and the stricter reading — a calendar-day boundary would
  let two sends land three minutes apart across midnight and still call
  that "once a day."
- *Unsubscribe tokens are signed, not stored*, mirroring `quote-token.ts`'s
  precedent exactly, for the same reason: the token's whole purpose is to
  keep working long after it was sent, so there is nothing to revoke.
  Unlike a quote, it never expires — opened six months later, it still has
  to unsubscribe on the first click. Confirmation is a POST behind a button,
  not a bare GET, so an email client's link-prescan can't silently
  unsubscribe someone who never clicked anything.
- *`currentConsent` (B-061) was generalized* from tenant-only to
  `{tenantId} | {leadId}`, matching `recordConsent`'s existing shape — a
  lead has no tenant id to read consent by, and this is the read half of the
  same table.
- *Step 3's promo nudge is genuinely conditional*, not sent-with-nothing-to-
  nudge-about: the job checks for a live promo before ever raising the
  event, and simply does not raise it when none applies.

**What it left behind.**

- `marketing_sms` stays unbuilt, matching every prior item that touched
  SMS — B-030 shipped email-only (FR-4), no Twilio integration exists until
  B-074, and this item's own consent capture only writes `marketing_email`.
  The schema and the classification checks are already shaped for it per
  B-030's original note.
- Templates are per-brand and operator-editable through the existing CN-16
  editor (B-053) — no new UI needed, since the three new templates are just
  more `MessageTemplate` rows. "Not sequence logic" (AC2) holds: the three
  steps, their delays and the promo condition are fixed in
  `packages/core/leads/drip.ts`, not configurable.
- Same seeding gotcha as B-063/B-071, hit and fixed the same way: the seed
  script only runs on explicit invocation, so the new templates/rules did
  not exist in either database until `db:seed`/`db:migrate:test` re-ran.

---

### B-073 — Abandoned-checkout follow-up

`9a7d284`

**What it built.** US-9/FR-LEAD-4's three-step sequence: a `CheckoutSession`
that sits unfinished for 1/24/72 configurable hours (per-facility
`abandonmentFollowUpHours`, reachable from Operations policy — the repo's
own "a new column gets its control in the same item" rule) gets an email
carrying the exact unit and quoted price, a signed resume link, and — on the
final step only — a live promo's terms when one applies. Consent-gated both
at raise time and again at send time, the same two-layer device B-072's
lead drip uses. A new checkbox at checkout step 1 (`marketing_email`
consent, unchecked by default) is the only capture point, since a checkout
session has no earlier one. Recovery is attributed in the funnel report
(AC4): `provisionMoveIn`'s `move_in_completed` event now carries
`recoveredByAbandonment`, and the funnel page shows the resulting count.
26 new DB tests (against real rows and the real seeded catalog) plus the
17 pure-function tests already covered in the design pass.

**What it decided.**

- *`CheckoutSession`, not the separate `Reservation` entity, is FR-LEAD-4's
  "reservation started event."* The PRD's own US-9 wording ("unit selected,
  contact info captured") describes checkout step 1, and the free-hold
  `Reservation` model has no such multi-step form to abandon. Recorded here
  rather than re-litigated: a later item reading "reservation" in this PRD
  section should read it as "checkout."
- *`CheckoutStatus.abandoned` is deliberately never written.* The enum value
  exists but a dedicated `abandonmentSequenceStep Int` counter (0–3) tracks
  progress instead — the same shape `Lead.dripStep` (B-072) uses. Setting
  `status: 'abandoned'` would risk mutating a session out from under a
  renter who is simply slow, and nothing downstream (the checkout page's own
  `relock` fallback) distinguishes `abandoned` from `expired` anyway.
- *A lapsed 30-minute lock (`status: 'expired'`) is NOT an exit condition* —
  only `completed` is. By the time the first follow-up can fire (60+
  minutes in), an expired lock is the ordinary case, not evidence the
  renter is gone; the existing `relock` UI already lets them recover the
  unit (or another one) the moment they click back in.
- *The resume link is a second, separate signed-and-unstored token*
  (`resume-token.ts`, mirroring `quote-token.ts`/`unsubscribe-token.ts`),
  not the session's own token. The live session token is minted once at
  step 1 and only its hash is ever stored, so there is nothing left to
  re-send days later. Visiting the link mints a FRESH real session token
  (`reissueCheckoutToken`) and redirects into `/checkout?token=...`, so
  `advance`/`extendLock`/`relock` see exactly the shape they already
  handle — no new state machine.
- *Step 3's promo line is required-but-not-gated at the rule level*, the
  same device `lead_drip_promo_nudge` (B-072) uses: with no live promo the
  render throws on the missing field and the send is logged `failed` — a
  deliberate no-op, not a promo-less repeat of steps 1/2.

**What it left behind.**

- `checkout.abandonment_step`'s templates are operator-editable through the
  existing CN-16 editor, same as every other B-072-era template — no new UI
  needed beyond the merge-field entries this item added.
- Recovery attribution lives on the funnel report as a single count/rate,
  not a dedicated dashboard — AC4 only asks that recovered move-ins be
  "attributed... in funnel reporting," and a fuller breakdown (by step, by
  facility) can build on the same `properties.recoveredByAbandonment` flag
  without a schema change.
- Same seeding gotcha as every comms-catalog item before it: `db:seed` and
  `db:migrate:test` both re-ran after adding the three templates/rules, or
  the new sequence would have matched nothing in either database.

---

### B-074 — SMS channel live

`202ae29`

**What it built.** FR-5/FR-7/FR-8 and CN-13/CN-14: a second delivery channel
alongside B-030's email pipeline. `NotificationRule`/`MessageTemplate` were
already channel-keyed (B-030's own design); this item is what actually reads
`channel`/`channelPolicy` rather than hardcoding `email` everywhere. A new
`deliverSmsForRule` (Twilio, REST, no SDK — same convention as
`resendProvider`) sits beside the untouched `deliverForRule`: SMS consent
(`account_sms`, TCPA requires it for every classification, not just
marketing), phone normalization to E.164, quiet hours (8am-9pm
facility-local, configurable, applied to every classification unlike
email's marketing-only window), and a preference-center gate all sit in
front of it, falling back inline to the sibling email `MessageTemplate` of
the same key when SMS is not viable — one shared idempotency key per
(event, rule, recipient) for `sms_preferred_email_fallback` rules, so
exactly one channel's `Message` row ever settles. Quiet-hours SMS neither
sends nor falls back — it `defer`s (a new `MessageStatus` value) and the
hourly cron sweeps it once the window reopens, re-checking staleness
best-effort against the original event first. Five templates got real SMS
bodies (`invoice_due_soon`, `invoice_due_today`, `payment_retry_reminder`,
`payment_method_expiring`, `access_suspended`); a sixth channel a facility
never configures (`smsMessagingServiceSid` null) degrades every one of them
to email-only, silently, the same honest-degradation posture as an unset
`RESEND_API_KEY`. Inbound STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, HELP and
START/UNSTOP land on `/api/comms/sms-webhook` (hand-rolled Twilio signature
verification, no SDK) and reply via TwiML; the same `applySmsStop`/
`applySmsStart` functions are what the portal's "turn off text messages"
button calls, so the two entry points can never drift. A new
`/portal/notifications` page is CN-13's preference center: three categories
(payment reminders, receipts, operational notices) × two channels, plus a
read-only SMS consent state display. 68 new tests (23 pure, 6 signature,
39 against the database and the real seeded catalog).

**What it decided.**

- *`dunning_step` (the delinquency-stage ladder) and both lien-notice
  supplements NEVER get an SMS variant, permanently* — recorded as D-36. The
  backlog line's "SMS variants of all reminder/dunning templates" and CN-13's
  "legally significant messages... are email-mandatory and cannot be toggled
  off" name the same template in opposite directions; the PRD's explicit
  carve-out wins. `access.suspended` DOES get one — a consequence of
  non-payment, not a delinquency stage itself, and exactly the kind of thing
  a tenant wants to know about the moment it happens.
- *One `NotificationRule` row per templateKey, never two.* A rule that gets
  an SMS variant has its existing row's `channel` flipped from `email` to
  `sms` (plus `channelPolicy`), not a second parallel rule — `applicableRules`
  dedupes by templateKey alone, so two active rows for one key is exactly the
  ambiguity that dedup exists to not have. The seed script's identity for
  "which row to update" changed from `(event, templateKey, channel,
  facilityId)` to `(event, templateKey, facilityId)` for this reason — the
  old identity orphaned the email row under its old channel instead of
  updating it, and shipped as a real bug mid-item (caught by the seed
  count going 26→31 templates but 26→31 *rules* instead of staying at 26;
  fixed before the DB carried it into a real facility).
- *`deliverSmsForRule` is its own function, not a parameterized
  `deliverForRule`.* The two channels diverge enough (phone vs email,
  consent gate, quiet-hours scope, no HTML/postal-footer/unsubscribe, an
  inline fallback) that threading `channel` through the existing 200-line,
  well-tested function would have cost more clarity than the duplication it
  avoided. `applicableRules`/`effectiveTemplate`/`suppressionFor`/
  `writeMessage` DID generalize (a `channel` parameter, defaulted so every
  existing email call site needed zero changes) — those were mechanical and
  low-risk; the delivery function itself was not.
- *SMS requires `account_sms` consent for EVERY classification*, not just
  marketing — TCPA's prior-express-consent requirement is about the channel,
  not the content, unlike PRD 04's marketing-consent carve-out for
  transactional email. No `marketing_sms` rule is seeded (B-072 never built
  that capture flow), so this item's consent check is the only one that
  matters yet.
- *Twilio Advanced Opt-Out (the provider-level half of CN-14's "provider +
  app level") is an operator console setting, not code* — this item builds
  and controls only the application-level layer (`Suppression`, checked at
  every send regardless of what Twilio's own list says), the one thing this
  codebase actually owns. The settings screen's own copy says so.
- *`processCommsEvent`/`deliverSmsForRule` take an optional `now`*, defaulted
  to the real clock. FR-8's quiet-hours check needs a fixed instant to test
  deterministically, the same reason `raiseAbandonmentFollowUps`/
  `sendExpiringSoonReminders` already take one.

**What it left behind.**

- The async fallback trigger FR-15 also names — a provider-reported
  "undelivered/carrier filtered" status arriving later via Twilio's delivery
  webhook — has no consumer. This item only catches the SYNCHRONOUS failure
  (a network error, an immediate 4xx from Twilio's own API). The webhook
  itself (FR-14's SMS status callback) is unbuilt; B-054's delivery
  dashboard is the natural owner of both.
- HELP/an ordinary inbound reply that is not STOP/START gets acknowledged
  with no action and no reply. A tenant texting back a real question has
  nowhere for it to go — a two-way inbox is explicitly B-090 scope (Phase 3),
  not this item's.
- `NotificationRule.delayMinutes` stays unread — FR-3's "send-time offset the
  comms service owns" has no consumer yet; nothing in this item needed it.
- Portal re-enabling SMS after a STOP has no button — only the inbound START
  keyword lifts a stop-reasoned suppression. CN-13's own AC only asks for
  the portal to match STOP's effect (revoke), not START's; a portal
  re-consent flow is a real gap but not one this AC covers.
- `facilityContactForPhone` (the HELP reply's "identification + support
  contact") is best-effort by phone match — a prospect who never rented, or
  two tenants sharing a household number, gets a generic identification line
  with no facility-specific phone. No per-number-to-facility index exists;
  Twilio Messaging Services route by pool, not by a mapping this schema
  keeps.
- CN-16's template editor (segment counter, 160-char warning for SMS) was
  not touched — the editor still assumes email. The five new SMS bodies are
  short enough to have shipped without it, but a future SMS template edited
  through that screen has no length feedback.

---

### B-075 — Delivery dashboard + alerting

`659f72f`

**What it built.** CN-19's reporting half (the AC's own sentence — "hard
bounce or invalid number auto-flags the tenant record and creates a task" —
already shipped with B-054) and all of FR-19. A new `/admin/reports/
deliverability` page: overall and per-(template, channel) delivery/bounce/
SMS-failure rates, a by-day trend, the failure queue (a count linking into
`/admin/tasks` filtered to `no_reachable_channel` — the same "filtered view
of the one list, not a table of its own" device `failed_payment`'s own
catalog comment already named), and a dead-letter list finally reading
`deadLetters()` (exported by B-054's own predecessor, wired to nothing until
now). Three rate functions in a new `packages/core/metrics/comms.ts` are
the one place `deliveryRate`/`bounceRate`/`smsFailureRate` are defined, same
rule as every other report in that directory. Three silent-failure
detectors, each dropped exactly where its own condition is already known
rather than re-derived: a new daily per-facility `SCHEDULED_JOBS` entry
checks yesterday's failure rate against FR-19's >2% line; `billing.dunning`'s
existing handler now also calls a detector with the `DunningResult` it just
produced (a new `eligible` counter on that result — leases the ladder
actually evaluated as due a step — is what makes "delinquent tenants exist"
answerable from the ladder's own decision rather than a second, possibly-
disagreeing definition); and the hourly cron tick now also checks every
comms consumer for events over 15 minutes stale, via a new
`staleDeliveryCount` export sitting beside `deadLetters()` in
`packages/core/events/dispatch.ts`. All three alert through one new
`alertOwner()` (`apps/web/lib/comms/alerts.ts`), which reuses `sendDirectEmail`
rather than inventing a second notification path — deduplication is that
function's own idempotency key (`alert:<kind>:<scope>`), not a new table, so
a detector re-checking an ongoing problem sends nothing a second time today.
29 new tests (16 pure rate/threshold, 13 against the database and the real
seeded `owner` role).

**What it decided.**

- *"Alert to owner" is an email to whoever holds the `owner` role*, found the
  same way D-12's "no superuser bypass" already treats that role as the
  single unrestricted identity — not a new alerting channel, dashboard
  banner, or on-call rotation. If nobody has been bootstrapped into `owner`
  yet (a fresh dev/test database), the detector reports nothing sent rather
  than erroring, the same honest-degradation posture `commsEnabled()`/
  `selectProvider()` already use for an unconfigured environment.
- *FR-19's "day's sends fail" reads as bounced-or-failed, not `failed` alone*
  — a bounce and an outright provider rejection are the same operator
  problem (a bad list, a broken template, a provider outage) and nobody
  triaging a 2am alert cares which `MessageStatus` bucket caused it.
- *`DunningResult` gained a field (`eligible`) rather than the detector
  re-querying "which leases are delinquent" itself.* A second definition of
  delinquency computed outside the ladder could disagree with the ladder's
  own — an operator halted for `on_hold` or already fully stepped would
  read as "silently failed" under a naive re-derivation, which is exactly
  the false alarm a silent-failure detector must not raise.
- *SMS failure rate excludes `suppressed`* (no consent, opted out) —
  tracked as a distinct fact from a delivery failure, not folded into the
  same rate. CN-19 asks for both an "SMS failure rate" and an "opt-out
  rate" as separate figures; conflating them would make neither number mean
  one thing.
- *Opt-out rate is NOT built.* `Suppression` carries no `facilityId` by
  design (CN-20: the shared list is org-wide by address), so a genuinely
  per-facility opt-out rate cannot be computed from it, and attributing an
  address-scoped fact to the facility an admin happened to have selected
  when they added it would be a number that looks precise and is not. Left
  as a documented gap rather than a misleading figure — the page says so,
  and points at Suppressions (CN-20) for the address-level list instead.
- *The "alert if a dunning run sends zero" detector runs inside
  `billing.dunning`'s own handler, not as a separate scheduled job* — the
  `DunningResult` it needs only exists inside that call, and a second job
  re-running the ladder's logic to get it would be the exact duplicate-
  definition risk the decision above already rejected.

**What it left behind.**

- The failure-queue count on the dashboard is genuinely cross-facility (the
  same `reportableFacilities` scoping every other report uses), but its
  "open task" link lands on `/admin/tasks`, which is single-facility by
  design (B-095) — the link carries whichever facility the report was
  filtered to, or none, in which case the tasks screen falls back to its own
  switcher default. A true cross-facility failure-queue LIST (not just a
  count) has no screen; building one is `/admin/tasks`'s own scope, not this
  item's.
- FR-15's async SMS fallback trigger ("undelivered/carrier filtering" from
  Twilio's own delivery-status webhook) still has no consumer — B-074 left
  this behind and B-075 does not close it either. `smsFailureRate` on this
  dashboard is therefore a floor: it counts every SYNCHRONOUS failure
  correctly, but an SMS Twilio accepted and later marked undelivered is
  invisible to it until that webhook exists.
- Dead letters are read-only. There is no retry/requeue button — matching
  `GateCommand`'s own precedent (a dead-lettered command needs the
  ManualAdapter's human intervention, not a generic "try again"), a
  dead-lettered `EventDelivery` needs someone to read `lastError` and decide
  whether replaying it is even safe, which a button cannot judge.
- The `>2%` and `15 minutes` thresholds in FR-19 are constants
  (`dailyFailureRateExceeds`'s default parameter, `CONSUMER_LAG_MS`), not a
  facility setting — unlike every other number this codebase's own rule
  says needs a form field, these configure an internal alarm rather than
  tenant-facing behaviour, which is the distinction B-062's surplus-hold-days
  precedent draws the same way.

---

### B-076 — Tenant rate increases

`d8d53b8`

**What it built.** US-11 end to end, and the first use of two things reserved
long before this item: the `rates:tenant_increase` permission and the
`rate.tenant_increased` audit action, both defined and unreferenced since
B-004/B-005. A new `TenantRateIncrease` model carries the lifecycle
(pending → approved → notice sent → applied, plus cancelled); the
append-only `LeaseRateChange` history it eventually writes gains only a
nullable `rateIncreaseId`, which is US-11's own "notice-sent reference
(nullable until this story ships)". Scheduling comes two ways — one-off
(this tenant, this rate, this date) and rule-based (US-11's own example:
≥9 months since the last change and ≥$15 below street, raised to street) —
both refusing an effective date that breaks the facility's new
`rateIncreaseNoticeDays` (default 30, with its own settings control).
Approval is regional-or-owner with a required reason code, matching the
auction bar. Two new nightly jobs: notices go out at 10am local on the
notice date (emitting `lease.rate_increase_scheduled` into the ordinary
comms pipeline, with a new template quoting all four of CN-9's merge
fields), and increases apply at hour 0 — deliberately BEFORE
`billing.generate-invoices` at hour 1, which is what makes "the first
invoice on/after the effective date" true without `invoices.ts` needing an
effective-dated read of its own. A new `/admin/rate-increases` screen is
US-11's review screen: pending increases with the projected monthly revenue
delta, the rule's current worklist, and approve/cancel per row or per batch.
69 new tests (39 pure, 30 against the database and the real seeded catalog).

**What it decided.**

- *The workflow row is a new model, not a status column on `LeaseRateChange`
  — recorded as D-37.* That table is what a billing dispute reads to answer
  "which rate applied on this date"; a mutable status on it would make the
  history editable, and a cancelled increase would leave a history row for a
  change that never happened. PRD 02 §5 already names `TenantRateIncrease` as
  its own entity.
- *The notice is email only; the postal/`Notice`-document path is not built —
  also D-37.* CN-9 scopes itself to "the electronic copy" and hands the mail
  queue and the legal-sufficiency call to PRD 02, and the per-state "requires
  written notice" flag it would key off is exactly what D-10's unfinished
  attorney pass governs. `NoticeType.rate_change` already exists in the enum
  for whenever that lands.
- *`applyRateChange()` is now the ONLY way `Lease.monthlyRateCents` moves*,
  which is US-11's schema AC finally enforced ("written only through the
  function that writes the history row — the same discipline as
  `recomputeUnitStatus()`"). Until this item there was one hand-rolled
  inline writer (move-in) and no such function. Exported so B-077's
  transfers and any later promo-expiry path use it rather than touching the
  column.
- *An increase is applied only from `notice_sent`, never from `approved`.*
  That one guard is what makes "no tenant is charged more without having
  been told" true by construction rather than by the two jobs happening to
  run in the right order.
- *An increase whose lease rate moved after approval is REFUSED, not
  applied.* The approver signed off on a delta from a specific figure; the
  run records a failed item naming both rates rather than quietly applying
  the increase to a number nobody agreed to.
- *`notice_sent` is still cancellable.* The case that matters most is an
  operator who changes their mind after the letter went out — telling the
  tenant it is cancelled is a phone call, not a reason to make the charge
  unstoppable.
- *`rateVariance` (core metrics) was made generic* rather than duplicated, so
  the worklist and the rate-variance report cannot disagree about which
  lease is most worth raising.

**What it left behind.**

- **No mid-cycle proration.** US-11's AC allows for it ("with proration if
  mid-cycle billing anniversary rules require it"); this applies the new
  rate to the first invoice GENERATED on or after the effective date and
  never re-rates a period already invoiced. Under D-27's anniversary billing
  each lease's period starts on its own billing day, so an operator
  scheduling to a period boundary gets exactly what they expect — scheduling
  mid-period means the increase lands on the following period rather than
  splitting it. A real simplification, documented rather than hidden.
- **No percentage cap on a rule-based batch.** The rule raises to street,
  full stop. A softer step (cap at +10%, say) is a real feature the AC does
  not ask for, and a guessed cap would quietly become the thing every batch
  does.
- **The one-off form takes a lease ID typed by hand** rather than a tenant
  picker. The rule-based worklist is the path the AC actually describes
  ("the rate-variance report... is the worklist the Phase-2 rate-increase
  workflow runs from"); the one-off form is the escape hatch beside it, and
  a search-and-select control belongs with the tenant-picker work that has
  no item yet.
- **The notice period default (30 days) is still legally unverified.**
  PROGRESS.md has listed it open since B-056 and D-10's attorney pass has
  not happened; the setting, the screen and the email all say so rather than
  asserting a figure.

---

### B-077 — Unit transfer wizard

`8957896`

**What it built.** US-14's transfer: `/admin/tenants/[tenantId]/transfer`, one
screen with a GET-recalculate preview and a single confirmation, reached from
a per-lease link on the tenant profile. Behind it,
`apps/web/lib/admin/transfer.ts` closes the old lease and opens a new one in
**one transaction** — both units' statuses recomputed inside it, which is
US-14's "both units' statuses update atomically" taken literally. Both sides
of the billing period are prorated by calling B-044's `unusedRemainder` and
`prorate` once each, which is exactly what that module's header predicted
("a transfer is a prorated move-out and a prorated move-in on the same day,
so it calls this twice"). Four things reserved long ago finally got used: the
`lease.transferred` event, the `leases:transfer` permission (manager and
above), `LeaseRateReason.transfer`, and `FeeType.transfer`. 18 new DB tests.

**What it decided.**

- *A transfer is NOT `completeMoveOut` + `provisionMoveIn`.* Both were
  considered and neither fits: `completeMoveOut` unconditionally releases the
  unit to `maintenance`, revokes pay links and emits `lease.moved_out` —
  which fires CN-8's "your account is settled" email at a tenant who has not
  gone anywhere; `provisionMoveIn` is welded to a `CheckoutSession` it reads
  and completes. What IS reused is the money, which is the part US-14 and
  US-18 actually mandate. A test asserts `lease.moved_out` is never emitted.
- *`MoveOutReason` gained a `transfer` value* rather than reusing
  `tenant_request`. The former-tenant AR list and the move-out report both
  read this field, and counting a transfer as a departure would show a
  move-out and a move-in for somebody who never left.
- *The new lease is created at the OLD rate, then moved to the new one
  through `applyRateChange`.* That is what makes the `LeaseRateChange` row
  read `previous = what they paid on the old unit, new = the new unit's rate,
  reason = transfer` — creating it at the new rate directly would leave a
  history row claiming the rate had never changed. It also keeps B-076's
  write-through the only writer of `Lease.monthlyRateCents`, which was the
  whole point of building it.
- *`billingDay` is carried over, not recomputed from the transfer date.* The
  tenant keeps their billing anniversary, which is what makes the two
  prorated halves add up to one unbroken period rather than leaving a gap or
  an overlap.
- *The old unit returns to `available`, not `maintenance`.* A move-out holds
  the unit for a "verified empty and clean" check; a transfer happens with
  the tenant on site handing it back in the same visit, so a maintenance hold
  would be theatre. Staff can still mark it from the unit screen.
- *One screen, not a multi-step wizard.* The codebase's only comment about
  wizards (`admin/pos/actions.ts`) argues against building a second stateful
  flow, and this needs none — a GET form recalculates server-side, so the
  arithmetic never happens in the browser and the confirmed figure is the
  posted one, the same discipline the move-out screen established.

**A real bug found and fixed along the way (D-38).** Move-out's proration
divided by the days in the **calendar month**, where US-18's AC says "days in
billing period". Under D-27's anniversary default those differ. Worse, its
day-count did not tile with the charge side: a 1 Aug–1 Sep period with a
15 Aug move-out refunded 16 days while the charge covered 14, so one day of
every prorated move-out was billed to nobody and kept. `proratedCredit` now
delegates to B-044's `unusedRemainder`; a regression test asserts
`charged + refunded === the full period` across all 31 days. **Refunds on
anniversary-billed move-outs get slightly larger.** Fixed rather than worked
around because B-077 would otherwise have shipped a transfer whose two halves
used different arithmetic — and because US-14 and US-18 both already claimed
this math was "built once", which it now genuinely is.

**What it left behind.**

- **Same-facility only**, per US-14's own wording ("another unit in the same
  facility"). A cross-facility move is a move-out and a move-in, and the
  screen refuses one with that reason named.
- **No payment is taken at transfer time.** The net lands on the new lease's
  ledger and is collected by the ordinary billing path. Taking a card at the
  counter is POS work (B-039's surface), not this screen's.
- **The customer-side transfer flow is not built** — that is B-090 (Phase 3)
  and PRD 01 §9 explicitly puts "transfer-unit flow (upsize/downsize online)"
  out of MVP. This is the staff-side one US-14 asks for.
- **A failed gate-credential issue is swallowed**, deliberately: the transfer
  has committed and the tenant has the unit, so a slow controller must not
  roll it back. It surfaces through the same gate queue and
  `move_in_provisioning_failed` path B-026 built, but there is no
  transfer-specific task for it.

---

### B-078 — POS depth: cash drawer + merchandise

`604160a`

**What it built.** US-33's drawer session and US-34's merchandise sales, plus
the deposits reconciliation US-39.6 asks for.

- `packages/core/pos/drawer.ts` — `expectedDrawer`, `varianceOf`,
  `varianceNeedsNote`, `closeProblem`, `depositSlip`. Pure arithmetic over a
  list of tender movements.
- `packages/core/pos/merchandise.ts` — `priceSale`, `saleProblem`,
  `isLowStock`, `margin`.
- `DrawerSession`, `Product`, `MerchandiseSale`, `MerchandiseSaleLine`;
  `Payment.drawerSessionId` so every counter payment is attributable to the
  session that took it; `Facility.drawerVarianceThresholdCents` (default 500)
  with its control on the facility settings screen.
- `/admin/pos/drawer` (open with a counted float, close with a blind count),
  `/admin/pos/merchandise` (sell, adjust stock, low-stock list),
  `/admin/reports/deposits` with a CSV.
- Two permissions: `drawer:manage` (counter, manager, regional) and
  `merchandise:manage` (manager, regional) — 28 permissions, 87 grants.
- Four audit actions: `drawer.opened`, `drawer.closed`, `merchandise.sold`,
  `merchandise.stock_adjusted`.

**What it decided.**

- *Card and ACH never touch the drawer.* `expectedDrawer` ignores them
  entirely. The single most common way a till reconciliation gets built wrong
  is counting the day's card takings into the expected cash, which makes every
  drawer look over by exactly that amount. Cheques and money orders are
  counted, but on their own line — they are banked, not spendable as change.
- *A cash movement counts `amountCents`, and the change is deliberately NOT
  subtracted.* `settleTender` defines change as `tendered − amount`, so the
  drawer takes in the note and hands the change straight back out: net
  movement is `tendered − change`, which is `amount`. Subtracting change again
  double-counts it. `depositSlip` still reports `changeGivenCents` because
  staff want to see it — but it is already netted, not deducted twice.
- *Only one drawer session may be open per facility at a time*, enforced by a
  hand-written partial unique index (`drawer_session_one_open_per_facility`),
  the same mechanism `checkout_session_one_active_per_unit` uses. Prisma
  cannot express a partial index, so it is appended raw to the migration.
- *The close is blind.* The screen asks for the counted cash and cheques
  without showing the expected figure first. A count taken against a number
  already on screen is not a count.
- *A variance past the facility threshold requires a note before the session
  will close*, and an overage is treated exactly like a shortage — an
  unexplained overage usually means a payment was never recorded, which is the
  same failure seen from the other side.
- *A merchandise sale is its own entity, not an invoice line (D-39).* It has
  no billing period, no proration, and no delinquency consequence, and forcing
  it through `Invoice` would put it in the AR ageing of a tenant who owes
  nothing. `REVENUE_CATEGORIES` therefore stays at four, and the existing test
  asserting a `merchandise` line contributes nothing to rental revenue stays
  true.
- *`DrawerSession.businessDate` is a `@db.Date`.* A session opened at 8am and
  closed at 6pm is one facility-local day; a timestamp would turn "which day
  was this" into a timezone question, which is exactly what the deposits
  report groups by.

**A real bug the tests caught.** The first `expectedDrawer` subtracted
`changeCents` from `amountCents`, so a $60 bill paid with a $100 note read as
$20 in the drawer instead of $60. Every close-out that gave change would have
looked short by the change given. The implementation was fixed, not the test.
Two smaller things went with it: `SellResult.changeCents` was typed `number`
where `settleTender` returns `number | null` (null for cheque and money order,
by design — widened rather than cast), and `sellMerchandise` returned
`'no_product'` for a missing tenant, which now has its own
`'tenant_required'` code.

**What it left behind.**

- **No cash-count denomination breakdown.** The close takes one cash total,
  not a tally of twenties and fives. Operators who want a denomination sheet
  count on paper; adding it is a form change, not a model change.
- **No mid-shift drop or paid-out.** Everything that moves cash moves it as a
  `Payment` or a refund. A safe drop would need its own movement type.
- **No purchase orders or supplier records.** `Product.stockCount` is adjusted
  by hand with an audited reason. Receiving stock against a PO is out of MVP
  scope entirely.
- **Deposits are reported, not banked.** The report tells staff what to take
  to the bank; there is no bank-deposit record to reconcile against, and no
  bank feed.

---

### B-079 — Staff MFA + org-level defaults

`d654876`

**What it built.** Two halves of PRD 00 §7.1 and PRD 02 US-4.

*TOTP MFA for staff.*

- `packages/core/auth/totp.ts` — RFC 4226 (HOTP), RFC 6238 (TOTP) and RFC 4648
  (base32) implemented directly, plus `otpauthUri` and recovery-code shaping.
  `tests/totp.test.ts` runs every published vector from all three RFCs.
- `apps/web/lib/auth/totp-secret.ts` — AES-256-GCM at rest, keyed by HKDF from
  `AUTH_SECRET` with its own `info` string.
- `StaffUser.totpSecret / totpConfirmedAt / totpLastStep`, `StaffRecoveryCode`.
- `/mfa` — enrolment, and the recovery codes, shown once.
- The admin layout gate, and `/admin/settings/staff` for an owner to see who is
  enrolled and reset a lost second factor.
- Four audit actions: `mfa.enrolled`, `mfa.recovery_code_used`,
  `mfa.recovery_codes_regenerated`, `mfa.reset_by_admin` (reason required).

*Org-level defaults (US-4).*

- `OrgDefault` (one row per scope: fee schedule, late-fee ladder, delinquency
  timeline), `packages/core/org/defaults.ts` for the comparison, and
  `/admin/settings/org` to edit, compare and push.
- New permission `org:defaults` (owner, regional) — 29 permissions, 89 grants.
- Two audit actions: `org_default.updated`, `org_default.pushed` (per facility).

**What it decided.**

- *MFA is mandatory, with no toggle (D-40).* §7.1 states it as a property, not a
  setting. A toggle would be a column whose only correct value is `true`, plus a
  code path for `false` that exists to be a hole.
- *Verification is at sign-in; enforcement is at the admin surface.* An
  unenrolled staff member authenticates normally and then reaches `/mfa` and
  nothing else. Blocking the sign-in would leave a new hire unable to ever
  enrol, and would break `system` integration accounts that authenticate but
  never browse the admin. The gate reads the database on every admin request
  rather than a JWT claim, so an administrator's reset takes effect at once
  instead of after the remaining thirty days of a session.
- *There is never a half-authenticated session.* No JWT is issued until the
  second factor has passed, so no "MFA pending" state exists for anything to
  forget to check.
- *Staff magic links are refused at both ends (D-40).* A link that signs
  somebody in on possession of their inbox IS a second factor; offering it
  beside a mandatory TOTP prompt would let every enrolment be walked around
  with one click. `requestMagicLink` will not mint one and the credentials
  provider will not spend one — both, because links minted before this shipped
  are still sitting in inboxes.
- *The second factor is verified BEFORE the login attempt is recorded.*
  Recording a success on a correct password and failing MFA afterwards would
  clear the throttle counter on every attempt, leaving a six-digit code free to
  brute-force. A wrong code is now a failed attempt, throttled at five per
  fifteen minutes like any other.
- *A TOTP code may be spent once* — `totpLastStep` rejects any step at or below
  the last accepted one, claimed with a conditional `updateMany` so two racing
  requests cannot both win. Without it a shoulder-surfed code stays valid for
  about ninety seconds across the drift window.
- *An unreadable secret fails closed.* A rotated `AUTH_SECRET` makes every
  stored secret undecryptable; treating that as "no second factor configured"
  would turn a key rotation into a silent MFA bypass across every staff account
  at once.
- *Recovery codes are SHA-256, not argon2* — the opposite of the usual
  reasoning. They are 50 bits of machine entropy, so there is nothing to
  brute-force, and verification means testing against every unused code the
  person holds; ten argon2 runs per attempt would be a self-inflicted denial of
  service.
- *The login form always shows the code field for staff*, rather than revealing
  it after a first submit. A reveal would have to answer "does this account have
  MFA?" before anyone had authenticated — account enumeration — and would make
  every staff sign-in two round trips.
- *Org defaults are pushed, never resolved at runtime (D-41).* A push writes
  ordinary effective-dated rows into the receiving facility's own tables, so
  invoicing, the late-fee job and the delinquency engine keep reading exactly
  one place. A runtime fallback would change what a facility charges the moment
  somebody edited a central record, with no effective date and nothing in that
  site's history saying what happened.
- *"Overridden" is computed, not stored (D-41).* A boolean would be a second
  source of truth that goes stale the first time anyone edits a facility fee
  directly. The comparison also names what diverges — "overridden: admin fee,
  late step 2" — because "Overridden" alone sends an owner to inspect twelve
  sites, which is the work the screen exists to save.
- *A facility that already matches is skipped, not rewritten.* These tables are
  append-only, so pushing unconditionally would file an identical row at every
  site every time the button was pressed.
- *Push access is checked per facility*, against `facility:settings` at that
  facility, not once for the batch — the ids arrive from a form, and a regional
  manager must not reach a site they hold no assignment for by adding its id to
  the POST. Editing the default itself is checked org-wide, which only an
  all-facilities assignment satisfies.
- *Notice templates get no push (D-41).* `MessageTemplate` already resolves
  org-level → facility override at render time, so the org default is already
  live everywhere that has not diverged; pushing would turn every inheriting
  site into an override of the thing it was tracking. What was missing was the
  visibility half, which is what shipped.
- *There is no second timeline editor.* The org timeline default is ADOPTED from
  a facility's active timeline, because `/admin/settings/delinquency` already
  validates every step against the notice templates that exist — and a second
  place for a lien timeline to be wrong is not worth having.

**What it changed elsewhere.** The e2e suite now signs in once per run through a
Playwright setup project and replays the saved session, instead of once per
spec. Forced rather than chosen: a TOTP code is single-use, so twenty
fully-parallel specs signing in inside the same thirty-second window would have
had nineteen correctly rejected as replays. The demo owner is enrolled with a
published demo secret (`demo-credentials.ts`, same guard as the demo password —
`seed-demo.mts` refuses to run with `NODE_ENV=production`), so the suite
exercises the real second factor. **There is no test-only MFA bypass anywhere**,
which was the point.

`FormState` gained an optional `details?: string[]` on the success variant,
rendered by `AdminForm` as a list outside the live region. Recovery codes are
what it exists for: a list somebody must read, copy or print cannot be a single
run-on utterance announced once and left behind by the focus.

**A real bug found and fixed in B-078's deposits report.** It bucketed payments
by `receivedAt`'s **UTC** day while a drawer session carries the facility-LOCAL
one (`businessDate`), and a comment asserted the two matched. They do not: 6pm
in Chicago is 23:00 UTC the same date, but 7pm is 00:00 UTC the *next* one — so
every drawer counted after the office shut landed on a different row of the
report from the cash it was counting, each showing a variance against an empty
column. Now bucketed by the facility-local day on both sides, through the same
`businessDateFor` the session itself uses. The regression test constructs an
explicit late-evening payment rather than trusting the clock, because the bug
was invisible for nineteen hours a day and B-078's own runs happened to fall
inside those hours — it surfaced only because this item's verification ran after
7pm.

**A repo hazard found along the way**, now recorded in CLAUDE.md: appending
hand-written SQL to an already-applied migration (which B-078 did for its
partial index) changes the file's checksum, and the next `prisma migrate dev`
offers to reset the development database. `prisma migrate status` does not catch
it, so it stayed invisible until this item. Repaired by recomputing the hash into
`_prisma_migrations`, not by resetting.

**What it left behind.**

- **No QR code on the enrolment screen.** The secret is shown grouped in fours
  for manual entry, with an `otpauth://` link that opens an authenticator app
  directly on a phone. A QR needs Reed–Solomon encoding — not "a few lines" —
  so it would mean a dependency; add `qrcode` if desktop-to-phone enrolment
  friction turns out to matter.
- **No WebAuthn / passkeys.** §7.1 names TOTP specifically.
- **Rotating `AUTH_SECRET` invalidates every enrolment** and requires every
  staff member to re-enrol. That is the correct blast radius, but there is no
  re-encryption migration path — the `v1.` prefix on the stored ciphertext is
  what would make one possible later.
- **No "remember this device for 30 days".** Every staff sign-in asks for a
  code.
- **A pushed default cannot REMOVE an extra ladder rung** a facility added
  locally. The comparison reports it (`step 3 (extra)`), but effective-dated
  rows have no tombstone, so removing it is a manual edit on that facility's own
  settings screen. Pre-existing, not introduced here.
- **Org defaults cover three scopes, not every setting.** Billing policy,
  protection plans and gate hours are still per-facility only.

---

### B-080 — Gate hardening: reconciliation, contract suite, one vendor stub

`9772d98`

**What it built.** PRD 03 §8 Phase 2's operational hardening, in six parts.

- **Reconciliation (FR-9).** `packages/core/access/reconciliation.ts` is the
  pure diff; `apps/web/lib/access/reconciliation.ts` builds the expected side
  and records a `GateReconciliationRun` per facility per day. Nightly at 3am
  facility-local, plus an on-demand button. Raises a `gate_drift_review` task
  and a `gate.drift_detected` audit entry.
- **The port gained a read side.** `GateAdapter.snapshot()` — required, not
  optional (D-42).
- **Adapter contract suite** (`tests/adapter-contract-db.test.ts`): one set of
  assertions run against the simulated adapter, the vendor stub and the manual
  adapter.
- **One vendor stub (D-18/D-43):** `pti-emulator.ts` is a fake vendor with a
  deliberately different shape; `pti-cloud.ts` is our driver for it. Selected
  per facility by `gateAdapter = 'pti_cloud'`.
- **Webhook secret rotation (SR-4):** per-facility `GateWebhookSecret` with a
  24-hour dual-secret window, a partial unique index for "exactly one active",
  and a prune once the window closes.
- **Camera links (FR-10)** and a **gate health dashboard** at
  `/admin/access/health`.

**What it decided.**

- *`snapshot()` is required of every adapter, and "cannot verify" is not "no
  drift" (D-42).* An optional method would make every caller ask whether an
  adapter supports reading back; the honest answer for the manual adapter —
  "nothing at this site is verified" — is exactly what the report must be able
  to say. A facility that could not be checked is still recorded, because a
  site that silently drops out is one nobody notices has been unverified for
  six months.
- *Drift is matched by credential id, not by code.* Matching by code would
  report a rotation as a missing credential plus an unknown one — two findings
  for one fact, and every rotation looking like a break-in.
- *Findings carry hashes, never codes.* They land on a screen, in a job log and
  on a task; SR-1 keeps codes out of all three. A test asserts the stored
  findings contain neither the old nor the new code.
- *Each drift says whether the gate ended up MORE permissive than intended.*
  That is the distinction a manager needs at 7am: a code that opens when it
  should not is somebody in the building, while one that fails to open is
  somebody on the phone. Only the first makes the task high priority.
- *A revoked credential the controller has forgotten is NOT drift.* That is the
  system working, and reporting it would make every move-out generate a
  finding.
- *An offline controller reports "not verifiable", never an empty entry list.*
  An empty list would read as "the controller holds nothing" and flag every
  credential at the site.
- *One task per facility per day, not one per finding.* A controller restored
  from a backup produces dozens at once.
- *The emulator was written to be inconvenient (D-43)* — its own ids, one call
  that sets PIN and status and window together, numbered time zones instead of
  schedules, HTTP-ish codes the driver must classify. A stub shaped like our
  own port would have proved nothing.
- *Rotation keeps the old secret for 24 hours.* A vendor cannot switch keys at
  the same instant we do, and a single-secret rotation drops every gate event
  in flight while somebody pastes a value into a portal.
- *The new signing secret is shown once and never again.* An admin screen that
  could display every site's signing key is what SR-1 exists to prevent.
- *Camera links only, no iframes — settling OQ-8.* A viewer that refuses to be
  framed renders a blank box, and staff cannot tell that from a dead camera.
  URLs are https-only and rejected if they carry embedded credentials; the
  audit entry records the host, not the path, because a viewer path can carry a
  camera token.

**What the vendor stub found.** The port survived three of the four frictions
unchanged. The fourth is real and is written down rather than papered over:
`set_time_window` accepts an arbitrary weekly schedule and this vendor can only
express "always" or "site hours". The adapter degrades honestly — the window
fingerprint reports what the gate is *actually* enforcing — and reconciliation
compares like with like per adapter, so a PTI site does not report drift on
every credential forever. Second friction worth naming: because the vendor sets
PIN and status in one call, the driver must read grant state before pushing a
code, or rotating a suspended tenant's code silently restores their access. The
contract suite now asserts that for every adapter.

**A second test defect found and fixed: three suites only passed during the
working day.** The full run at 22:00 reported eight failures in
`checkout-abandonment-db`, `lead-drip-db` and `review-request-db` — all of the
shape "expected [] to have a length of 1". None of them were caused by this
item; stashing every B-080 change reproduced them exactly. The cause is that
each of those suites sends a MARKETING message, and `deliverForRule` refuses
marketing during quiet hours (FR-MSG-5: before 8am or from 9pm, facility-local)
against the **real wall clock**. The production behaviour is correct — nobody
should be emailed a promo at ten at night — so the fix is in the tests, which
now pin `Date` to midday Central. They previously meant something different
depending on the hour they ran, and would have failed in CI on any runner whose
clock put America/Chicago outside 08:00–21:00. Only `Date` is faked; faking
timers wholesale hangs the Prisma round trips these suites are built from.

**A test-coverage hole found and closed.** Six of the rotation assertions —
the whole encrypted-at-rest half of SR-4 — skipped themselves locally and in
CI, because `ACCESS_CODE_ENCRYPTION_KEY` was unset and every affected code path
takes a degraded branch without one. `vitest.config.ts` now sets a fixed
test-only key, so the ENCRYPTED paths are the ones under test. A security
feature whose tests quietly opt out is worse than one with no tests, because
the green run says otherwise. The suites that need the *unconfigured* behaviour
delete the variable themselves and restore it.

**What it left behind.**

- **No real vendor driver.** D-4 and D-18 both stand: this is a driver against a
  fake vendor, and B-085 (Phase 3, contingent on a partner agreement) is the
  first real one. The emulator must never be pointed at a live site.
- **No nonce replay cache.** SR-4 names one alongside the timestamp tolerance;
  the ±5-minute window shipped with B-028 and the cache did not. Nothing
  external can reach the endpoint yet, so a replay needs a captured in-process
  request — but this is a genuine gap in SR-4, not a resolved one.
- **Drift is reported, never auto-repaired.** The reconciliation raises a task
  and stops. Re-pushing automatically would mean a nightly job writing to gate
  hardware unsupervised on the strength of a comparison that has just told you
  the two sides disagree.
- **No drift trend over time on any screen.** The rows carry the history
  FR-9's "metrics" asks for; the dashboard shows only the latest run.
- **Camera links are unordered in practice** — `sortOrder` exists on the model
  and there is no UI to set it.

---

### B-081 split → B-102–B-107, and B-102 — monthly statements centre

`ed5479c`

**The split first (D-44).** B-081 bundled six unrelated features behind one
number. Backlog note 8 always intended these tail bundles to be split when
reached; B-078 and B-080 were each built whole because their parts shared a
schema and a screen, and B-081's do not — a mapping vendor, a payment method, a
statements read model, an insurance workflow, a gate-access surface and a
rewrite of the checkout core touch six PRD sections and six tables. It is now
B-102 (statements), B-103 (ACH + Stripe Link), B-104 (insurance tier change +
proof upload), B-105 (portal authorized-access self-service), B-106
(future-dated + multi-unit checkout — the only one that changes checkout's core
assumptions) and B-107 (map view, **blocked** until §10 OQ-6 has a maps vendor,
and ordered last for that reason). The dropped size-estimator quiz stays
dropped.

**What B-102 built.** PRD 01 US-705's "monthly statements".

- `packages/core/billing/statements.ts` — `buildStatement`, `reconciles`,
  `statementMonths`, `monthBounds`, all pure.
- `packages/core/jobs/schedule.ts` gained `zoneOffsetMinutes` and
  `zonedMidnight` — the inverse of `businessDateFor`, which did not exist.
- `apps/web/lib/billing/statements.ts` — the read model, plus the staff-side
  gate.
- `/portal/statements` and `/portal/statements/[leaseId]/[period]`; the same
  document for staff at `/admin/tenants/[id]/ledger/[leaseId]/statements`,
  through one shared `StatementView` component.

**What it decided.**

- *A statement is derived, never stored.* `LedgerEntry` is append-only, so a
  month recomputes to the same figures forever. A stored copy would be a second
  source of truth that could disagree with the ledger the business runs on. A
  later reversal appears in the period it was made — which is what an accountant
  expects — rather than silently rewriting a month already sent.
- *The closing balance is opening + movement, never a second independent sum.*
  Two sums that should agree are two things that can disagree, and the one
  thing a statement may not do is fail to add up.
- *A statement that does not reconcile throws.* `reconciles()` is called by the
  read model, not only by tests. Rendering it anyway puts a document in front of
  somebody's accountant that is wrong in a way nobody noticed.
- *Month boundaries are facility-local midnight, not UTC.* A payment taken at
  8pm on the 31st belongs to that month. This is the same mistake B-078's
  deposits report shipped with, caught this time before it shipped — a DB test
  files a 01:00 UTC payment into the previous local month, and a pure test
  asserts consecutive months have no gap and no overlap.
- *Months with no activity are listed.* "Nothing happened in March" is an
  answer a bookkeeper may need, and a gap in a numbered list reads as a missing
  document.
- *Ended leases keep their statements.* A moved-out tenant still needs last
  year's, which is most of why persona P5 wants this screen at all.
- *Staff see the identical document, gated exactly like the ledger*
  (`assertFacilityAccess` + `tenants:view` at the lease's own facility). Two
  implementations of a financial summary is two chances for them to disagree in
  front of a tenant; a different URL must not be a way around the ledger's own
  scoping.
- *Still HTML, not PDF.* B-023's standing decision holds — no JavaScript PDF
  library available to this project emits tagged PDFs, and an untagged statement
  is exactly the §6.8.1 accessibility failure. The browser's print dialogue
  makes a paper copy.

**What it left behind.**

- **No PDF and no emailed statement.** Both wait on the same unbuilt PDF
  encoder port. There is no "email me this statement" action.
- **No statement-level tax breakdown.** Line descriptions carry what each charge
  was; §3's "taxes itemized" is satisfied at the invoice, not summarised as a
  tax total per month.
- **No cross-lease consolidated statement.** A tenant with three units gets
  three lists. Consolidated billing is explicitly Phase 3 (§9, "business
  accounts").
- **No paging.** A tenant with six years of history gets 72 links on one page.

---

### B-103 — ACH bank debit + Stripe Link

`7dbc517`

**What it built.** PRD 01 §3's remaining payment methods, and the settlement
state ACH forced.

- `packages/core/billing/payment-methods.ts` — `methodsFor(surface, policy)`,
  the pure decision about which methods each surface offers.
- `PaymentStatus.processing`, `Facility.achAtCheckoutEnabled` (default off),
  and the `payment.processing` domain event.
- `payment_intent.processing` in the Stripe reconciler, plus `methodOf` — the
  first moment the real payment method is knowable.
- `leasesWithSettlingPayment` and its three callers: late fees, dunning and
  gate suspension.
- A `settling_payment_failed` task for a debit that bounces after acceptance.
- Portal copy (dashboard panel, receipt page), and the facility settings
  toggle.

**What it decided (D-45).**

- *`processing` posts nothing to the ledger and settles no invoice.* Money that
  has not arrived must not make an invoice read paid, and must not let a
  delinquent tenant's gate access auto-restore under D-16. It also means a
  bounce needs **no reversing entry** — there is nothing to reverse — which
  removes the entire class of correction bugs the alternative would have
  introduced. A test asserts the ledger is untouched after a bounce for exactly
  this reason.
- *The tenant is left alone anyway.* Late fees, dunning and gate suspension all
  skip a lease with a debit in flight. The money has left their account and
  nothing they can do makes it arrive faster.
- *Suppression is scoped by tenant-at-facility, not by invoice.* A portal
  payment does not always name an invoice, so an allocation-based lookup would
  miss the commonest case. The cost is that a tenant with two units at one site
  gets both left alone for a few days — an error in their favour, bounded by the
  settlement window.
- *The move-in does not wait for settlement.* Four business days for a unit
  somebody has paid for is not a product. The risk is real, which is why ACH at
  checkout is **per facility and off by default**, and why a late bounce raises
  its own task.
- *A bounced debit is its own task type, not `failed_payment`.* A card decline
  means nobody was ever told the money arrived. This tenant has a receipt, may
  have been let through a gate on it, and is about to start getting dunning
  letters. Different conversation, different urgency.
- *`Payment.method` is corrected on the processing event.* `createChargeIntent`
  writes every row as `card` because it cannot know what the payer will pick in
  the Element; the deposits report, the receipt and the tenant's own history all
  read this column, and a bank debit filed as a card is wrong on all three.
- *Payment method types are stated explicitly rather than left to the Stripe
  dashboard's automatic methods.* Bank debit at checkout is a per-facility
  decision this code has to make, and an off-session autopay charge must never
  be offered `us_bank_account` as a fresh method — there is nobody there to
  authorise a debit.
- *The portal shows settling money BESIDE the balance, never netted off it.*
  Subtracting it would make the portal disagree with the ledger and with every
  staff screen; saying nothing produces the support call this state exists to
  prevent.

**A latent robustness bug found during verification.** A full parallel test run
aborted `completeMoveOut`'s transaction mid-flight, while the same suite passed
alone and on the next run — the signature of a wall-clock limit under load
rather than a defect in the work. Prisma's default interactive-transaction
timeout is 5 seconds, tuned for a database on the same machine; this one is Neon
over the network, and that transaction makes eight or nine round trips. Raised
to 20 seconds (maxWait 10s) on the client. **This was never only a test
problem** — the same limit would abort a move-out during any production latency
spike and surface as an opaque Prisma error to whoever was standing at the
counter. Diagnosed from one observed failure rather than a reproduction, and
the fix makes the failure mode impossible rather than merely unlikely.

**What it left behind.**

- **Microdeposit verification is not handled.** A bank account Stripe cannot
  verify instantly leaves the intent in `requires_action`, and nothing here
  drives that flow — the renter would be stuck on the Payment Element. Instant
  verification covers the common case; this is a real gap for the rest.
- **No ACH-specific retry.** B-046's retry schedule is built around card decline
  codes. An `insufficient_funds` bounce raises a task and stops; it does not
  re-present the debit the way a card retry would.
- **Autopay still charges the stored default method**, whatever it is. Nothing
  yet lets a tenant say "use my bank account for autopay but my card for
  one-offs".
- **No separate settlement report.** Money in flight is visible per tenant in
  the portal and per lease to the jobs that skip it, but there is no
  facility-level "what is settling" view.

---
