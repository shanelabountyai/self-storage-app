// The catalog of auditable actions, transcribed from PRD 02 US-38's list of
// sensitive actions. `requiresReason` marks the ones where US-38 says a reason
// code is required — recordAudit() refuses to write those without one.
//
// Adding an action here is the only way to audit something, so the catalog
// doubles as the answer to "what do we consider sensitive?".

export type AuditActionSpec = {
  action: string;
  /// Human label for the admin log view.
  label: string;
  requiresReason: boolean;
};

export const AUDIT_ACTIONS = [
  // Money — every one of these moves or forgives money, so all require a reason.
  /// B-167. A fee posted by hand onto a tenant's account. `requiresReason` for
  /// the same reason the waiver does, and arguably more: a waiver forgives
  /// money and a charge takes it, and "what was this $75 for" is the question
  /// a disputed move-out statement turns on. The reason IS the note the form
  /// requires — there is no code list, because what a damage fee is for is a
  /// sentence, not a category.
  { action: "fee.charged", label: "Fee charged", requiresReason: true },
  /// B-168. A promotional recapture reduced or forgiven at the counter. Its own
  /// action rather than `fee.waived`, because the question this answers is not
  /// "who forgave a fee" but "is the minimum stay real" — a term the business
  /// advertises and then routinely gives away at the desk is a term that does
  /// not exist, and a row filed under every other waiver cannot show that.
  { action: "promo.recapture_reduced", label: "Promotional recapture reduced or waived", requiresReason: true },
  { action: "fee.waived", label: "Fee waived", requiresReason: true },
  {
    action: "credit.issued",
    label: "Manual credit issued",
    requiresReason: true,
  },
  {
    action: "balance.written_off",
    label: "Balance written off",
    requiresReason: true,
  },
  { action: "refund.issued", label: "Refund issued", requiresReason: true },
  // B-146. FR-8's append-only correction: the entry stands and a reversing one
  // is posted beside it. `requiresReason` because the bank's own reason — NSF,
  // account closed, stop payment — is what a manager needs when the tenant
  // rings, and what decides whether the fee was fair.
  {
    action: "payment.returned",
    label: "Payment returned by the bank",
    requiresReason: true,
  },
  {
    action: "payment.recorded",
    label: "Payment recorded",
    requiresReason: false,
  },
  // B-147. The other side of `payment.returned`: a card dispute we won, where
  // the bank hands the money back. Its own action rather than a second
  // `payment.recorded`, because what happened is that an earlier reversal was
  // itself reversed, and a log that cannot tell those apart cannot answer the
  // only question anyone asks of it — why does this receipt appear twice.
  {
    action: "payment.reinstated",
    label: "Returned payment reinstated",
    requiresReason: true,
  },

  // Pricing
  {
    action: "rate.street_changed",
    label: "Street rate changed",
    requiresReason: false,
  },
  {
    action: "rate.tenant_increased",
    label: "Tenant rate increased",
    requiresReason: true,
  },
  /// B-153. The retention save. `requiresReason` for the same reason the
  /// increase does, and arguably more: an increase is a policy applied to a
  /// cohort, a decrease is a discretionary giveaway to one tenant, and "why
  /// does unit 114 pay less than unit 116" is asked by the next manager.
  {
    action: "rate.tenant_decreased",
    label: "Tenant rate lowered (retention)",
    requiresReason: true,
  },
  /// US-11: "Increases are cancellable up to the effective date; cancellation
  /// is audit-logged." A reason is required for the same reason approval
  /// needs one — a tenant who was told their rate was going up and then was
  /// not is a conversation somebody has to be able to reconstruct.
  {
    action: "rate.increase_cancelled",
    label: "Tenant rate increase cancelled",
    requiresReason: true,
  },
  /// B-166 / D-88. A held increase re-noticed: the old row cancelled and a
  /// clone scheduled at the same delta from a corrected address. Its own
  /// action rather than a cancel plus an approval, because the question this
  /// log has to answer is "how many times did we try to notice this tenant,
  /// and to what address" — filed as two unrelated rows, the attempt reads as
  /// somebody changing their mind twice.
  {
    action: "rate.increase_renoticed",
    label: "Tenant rate increase re-noticed",
    requiresReason: true,
  },

  // Tenants
  {
    action: "tenant.contact_updated",
    label: "Tenant contact info updated",
    requiresReason: false,
  },
  /// B-121 / D-49. Its own action rather than `tenant.contact_updated`, which is
  /// where it started: the question an SCRA claim asks is "when did you know?",
  /// and the answer has to be findable. Filed under contact details it is one
  /// unremarkable row among every phone-number correction ever made.
  ///
  /// `requiresReason: false` — the before/after snapshot IS the fact, and there
  /// is no discretion to explain. That is the opposite of `hold.lifted`, which
  /// is somebody deciding the protection no longer applies.
  {
    action: "tenant.active_duty_recorded",
    label: "Active-duty military status recorded",
    requiresReason: false,
  },
  {
    action: "tenant.note_added",
    label: "Note added to tenant",
    requiresReason: false,
  },
  {
    action: "document.logged",
    label: "Document logged",
    requiresReason: false,
  },
  { action: "task.completed", label: "Task completed", requiresReason: false },

  // Leases and units
  { action: "lease.edited", label: "Lease edited", requiresReason: false },
  {
    action: "lease.moved_out",
    label: "Move-out completed",
    requiresReason: false,
  },
  /// US-42. `requiresReason: true` on both: a hold that stops collections with
  /// no recorded why is indistinguishable from a mistake six months later, and
  /// lifting one is the act that resumes them against a possibly-protected
  /// tenant. The reason code carries the hold TYPE on placement, which is what
  /// makes "how many SCRA holds did we place last year" answerable.
  {
    action: "hold.placed",
    label: "Hold placed on lease",
    requiresReason: true,
  },
  {
    action: "hold.lifted",
    label: "Hold lifted from lease",
    requiresReason: true,
  },
  /// B-090 part 3. The `payment_plan` hold that halts the pipeline is placed
  /// through the same `hold.placed` entry above — this is the second entry
  /// that records what was actually agreed, since a hold's own reason field
  /// is one sentence and a schedule is not. `requiresReason: false`: the
  /// installments in `context` ARE the record, the same posture
  /// `lease.transferred` takes — there is no discretion here to explain, only
  /// a schedule to write down.
  {
    action: "payment_plan.created",
    label: "Payment plan agreed",
    requiresReason: false,
  },
  /// D-17. The system, not a person, put a recurring charge on a lease because
  /// the tenant's own cover lapsed. `requiresReason: false` because the reason
  /// is structural rather than discretionary — the entry carries the waiver,
  /// its expiry date and the premium instead, which is what a tenant disputing
  /// the charge will actually ask to see.
  {
    action: "lease.protection_auto_enrolled",
    label: "Protection auto-enrolled on lapsed proof",
    requiresReason: false,
  },
  {
    action: "lease.move_out_overridden",
    label: "Move-out charges overridden",
    requiresReason: true,
  },
  /// PRD 02 US-14 (B-077). A transfer closes one lease and opens another in
  /// one act, so neither `lease.moved_out` nor a move-in entry describes what
  /// happened — this is the single entry that names both units and both
  /// rates. No reason code: the tenant asked to move units, which is an
  /// ordinary service request, not a discretionary override.
  {
    action: "lease.transferred",
    label: "Tenant transferred between units",
    requiresReason: false,
  },
  /// B-157 / D-85. The same act, but out of a unit whose contents are being
  /// prepared for sale — which is NOT an ordinary service request. A served
  /// lien notice names a unit, and moving the goods after service is the fact
  /// somebody's attorney asks about, so the reason is what reconciles the
  /// notice against the move.
  ///
  /// Its own action rather than a reason code on `lease.transferred`, for two
  /// reasons: `requiresReason` is enforced by `recordAudit` itself, so the
  /// entry cannot be written without one; and a lien-pipeline transfer stays
  /// independently filterable instead of being one row among every routine
  /// unit swap.
  {
    action: "lease.transferred_in_lien_pipeline",
    label: "Tenant transferred out of a unit in the lien pipeline",
    requiresReason: true,
  },
  { action: "unit.created", label: "Unit created", requiresReason: false },
  { action: "unit.updated", label: "Unit updated", requiresReason: false },
  {
    action: "unit.status_overridden",
    label: "Unit status manually overridden",
    requiresReason: true,
  },
  /// One grouped entry per bulk operation, with per-unit detail inside
  /// (PRD 02 US-7). Reason required for the same reason a single status
  /// override needs one — more so, since it touches many units at once.
  {
    action: "unit.bulk_edited",
    label: "Units bulk edited",
    requiresReason: true,
  },
  {
    action: "unit.layout_imported",
    label: "Unit layout imported",
    requiresReason: true,
  },
  {
    action: "unit_type.created",
    label: "Unit type created",
    requiresReason: false,
  },
  {
    action: "unit_type.updated",
    label: "Unit type updated",
    requiresReason: false,
  },
  {
    action: "unit_type.cloned",
    label: "Unit type cloned to another facility",
    requiresReason: false,
  },

  // Delinquency, notices, auctions
  {
    action: "delinquency.step_overridden",
    label: "Delinquency step overridden",
    requiresReason: true,
  },
  {
    action: "delinquency.step_skipped",
    label: "Delinquency step skipped",
    requiresReason: true,
  },
  {
    action: "notice.generated",
    label: "Notice generated",
    requiresReason: false,
  },
  {
    action: "notice.delivered",
    label: "Notice delivery recorded",
    requiresReason: false,
  },
  {
    action: "auction.approved",
    label: "Auction eligibility approved",
    requiresReason: true,
  },
  {
    action: "auction.completed",
    label: "Auction outcome recorded",
    requiresReason: false,
  },
  /// B-062. Each one is a question a wrongful-sale complaint asks directly.
  {
    action: "auction.scheduled",
    label: "Sale scheduled",
    requiresReason: false,
  },
  /// Reason required: "cancelling a sale (tenant paid) at any point restores
  /// the normal lifecycle and LOGS THE REASON" (US-28).
  {
    action: "auction.cancelled",
    label: "Sale cancelled",
    requiresReason: true,
  },
  /// "The primary evidence that you sold what you said you sold."
  {
    action: "auction.lock_cut",
    label: "Lock cut and contents inventoried",
    requiresReason: false,
  },
  /// A surplus quietly retained is how a routine auction becomes a
  /// class-action-shaped problem, so its disposition is audited on its own.
  {
    action: "auction.surplus_dispositioned",
    label: "Auction surplus dispositioned",
    requiresReason: false,
  },

  // Access control (PRD 03 FR-1)
  { action: "access.granted", label: "Access granted", requiresReason: false },
  {
    action: "access.suspended",
    label: "Access suspended",
    requiresReason: true,
  },
  { action: "access.restored", label: "Access restored", requiresReason: true },
  { action: "access.revoked", label: "Access revoked", requiresReason: false },
  {
    action: "access.code_viewed",
    label: "Gate code revealed",
    requiresReason: true,
  },

  // Administration
  {
    action: "facility.settings_changed",
    label: "Facility settings changed",
    requiresReason: false,
  },
  /// B-128. Separate from `facility.settings_changed` because it belongs to no
  /// facility — a city page lists every site in the city, so the row it edits
  /// has no `facilityId` to stamp and would otherwise be an unattributable
  /// facility-settings entry.
  {
    action: "city.copy_changed",
    label: "City page copy changed",
    requiresReason: false,
  },
  /// B-084 part 1. Filing a month's figures. The `after` payload carries the
  /// whole snapshot, which makes the audit log — not the period row — the
  /// permanent record of every set of figures ever filed for a month.
  {
    action: "period.closed",
    label: "Accounting period closed",
    requiresReason: false,
  },
  /// Withdrawing figures that were filed. `requiresReason` is true and that is
  /// the point: a reopened month means somebody is going to restate numbers
  /// that have already been reported, and "why" is the first question asked
  /// about it afterwards. The `before` payload carries the snapshot being
  /// withdrawn, which is the only place it survives.
  {
    action: "period.reopened",
    label: "Accounting period reopened",
    requiresReason: true,
  },
  /// CN-16. A published template changes what every future tenant is told, and
  /// the version it records is what makes an old `Message` reproducible.
  {
    action: "template.published",
    label: "Message template published",
    requiresReason: false,
  },
  /// B-061. Separate from `template.published` because the stakes differ: this
  /// one changes the wording of a legal notice that precedes a sale, and "who
  /// last edited the lien notice, and when" is a question a wrongful-sale claim
  /// asks directly.
  {
    action: "notice_template.published",
    label: "Notice template published",
    requiresReason: false,
  },
  /// CN-20. Adding one stops every future notice to that address; removing one
  /// resumes mailing somebody the system had decided not to mail. Removal
  /// requires a reason — it is the direction that can put mail in front of a
  /// person who did not want it.
  {
    action: "suppression.added",
    label: "Address suppressed",
    requiresReason: false,
  },
  {
    action: "suppression.removed",
    label: "Suppression lifted",
    requiresReason: true,
  },
  /// PRD 02 US-43. Who took the call, and when. The lead row carries the same
  /// facts, but a lead can be edited and an audit entry cannot — and "was this
  /// walk-in ever actually recorded" is a commission question.
  { action: "lead.created", label: "Inquiry recorded", requiresReason: false },
  /// PRD 02 US-10. A promotion is a price the business advertises; who changed
  /// it and when is the question after a campaign costs more than expected.
  {
    action: "promotion.changed",
    label: "Promotion created or changed",
    requiresReason: false,
  },
  /// PRD 02 US-25/US-29. Changing a lien timeline changes what notices go out
  /// and when a sale becomes possible. Who changed it, and to what, is the
  /// first question after a wrongful-sale claim.
  {
    action: "delinquency.timeline_changed",
    label: "Delinquency timeline changed",
    requiresReason: false,
  },
  /// PRD 03 US-3 / US-28. Whether a unit was locked, and when, is a question a
  /// wrongful-sale claim turns on.
  {
    action: "unit.overlocked",
    label: "Overlock fitted",
    requiresReason: false,
  },
  {
    action: "unit.overlock_removed",
    label: "Overlock removed",
    requiresReason: false,
  },
  {
    action: "user.created",
    label: "Staff user created",
    requiresReason: false,
  },
  {
    action: "user.role_changed",
    label: "Staff role changed",
    requiresReason: true,
  },
  {
    action: "user.deactivated",
    label: "Staff user deactivated",
    requiresReason: true,
  },
  {
    action: "document.deleted",
    label: "Document deleted",
    requiresReason: true,
  },
  /// B-071. Not reason-required like a deletion — hiding a review is display
  /// moderation, not destroying evidence (the row and its text stay exactly
  /// as entered). Audited because "why did this review disappear from the
  /// page" is a question worth being able to answer.
  {
    action: "review.visibility_changed",
    label: "Review visibility changed",
    requiresReason: false,
  },
  /// B-078. Opening is not sensitive — it records a float somebody counted
  /// in — but it is the other end of the pair that makes a close-out
  /// meaningful, so both are logged.
  {
    action: "drawer.opened",
    label: "Drawer session opened",
    requiresReason: false,
  },
  {
    action: "drawer.closed",
    label: "Drawer session closed",
    requiresReason: false,
  },
  /// Reserved since B-005 and finally written by B-078. `requiresReason` is
  /// what enforces US-33's "over/short beyond a configurable threshold
  /// requires a manager note" — the audit machinery refuses the entry
  /// without one, so the rule cannot be bypassed by a caller that forgets.
  {
    action: "drawer.over_short",
    label: "Drawer over/short recorded",
    requiresReason: true,
  },
  /// US-34. A sale moves stock and takes money; both are worth a trail.
  {
    action: "merchandise.sold",
    label: "Merchandise sold",
    requiresReason: false,
  },
  /// A stock count changed without a sale — a delivery, a breakage, a
  /// recount. Requires a reason precisely because there is no transaction
  /// explaining it: an unexplained inventory adjustment is how shrinkage
  /// gets papered over.
  {
    action: "merchandise.stock_adjusted",
    label: "Stock adjusted",
    requiresReason: true,
  },

  /// PRD 05 CN-14. A double opt-in completed by text.
  ///
  /// Audited on its own, separately from the `Consent` row it writes, because
  /// the row records the STATE and this records the ACT — and it is the act a
  /// carrier or a TCPA complaint asks about: this number, texting this word, at
  /// this time.
  {
    action: "consent.captured",
    label: "Consent captured",
    requiresReason: false,
  },

  // PRD 01 US-705 (B-104). Protection cover, changed by the tenant.
  ///
  /// Three separate actions rather than one, because they answer three
  /// different questions after a loss: what did they ask for and when, did they
  /// change their mind, and what was actually in force on the day.
  {
    action: "protection.change_scheduled",
    label: "Protection change scheduled",
    requiresReason: false,
  },
  {
    action: "protection.change_cancelled",
    label: "Protection change cancelled",
    requiresReason: false,
  },
  {
    action: "protection.change_applied",
    label: "Protection change applied",
    requiresReason: false,
  },
  /// The tenant's own cover, as they described it. `requiresReason: false`
  /// because the record IS the reason — carrier, policy number and expiry.
  {
    action: "protection.proof_submitted",
    label: "Proof of insurance submitted",
    requiresReason: false,
  },

  // PRD 03 (B-080). Gate hardware.
  ///
  /// Recorded by the reconciliation job, not a person. The audit log is where
  /// "when did we first know this code was live" gets answered, and a task that
  /// somebody completes and closes is not a durable enough record of it.
  {
    action: "gate.drift_detected",
    label: "Gate controller drift detected",
    requiresReason: false,
  },
  /// SR-3: "immutable audit records for... every webhook secret rotation."
  {
    action: "gate.webhook_secret_rotated",
    label: "Gate webhook secret rotated",
    requiresReason: false,
  },
  {
    action: "gate.camera_link_changed",
    label: "Camera link changed",
    requiresReason: false,
  },

  // Authentication
  {
    action: "password.reset_completed",
    label: "Password reset completed",
    requiresReason: false,
  },
  {
    action: "login.locked_out",
    label: "Login locked out",
    requiresReason: false,
  },

  // B-079. Staff MFA (PRD 00 §7.1).
  { action: "mfa.enrolled", label: "MFA enrolled", requiresReason: false },
  /// A recovery code is a bypass of the second factor. Logged separately from an
  /// ordinary sign-in because a run of these is what a phished account looks
  /// like from the outside, and because it is the only signal that somebody is
  /// down to their last few codes.
  {
    action: "mfa.recovery_code_used",
    label: "MFA recovery code used",
    requiresReason: false,
  },
  {
    action: "mfa.recovery_codes_regenerated",
    label: "MFA recovery codes regenerated",
    requiresReason: false,
  },
  /// One administrator clearing another's second factor. Requires a reason:
  /// this is the single action that turns "I have their password" into a full
  /// account takeover, so the log has to say who asked and why.
  {
    action: "mfa.reset_by_admin",
    label: "MFA reset by an administrator",
    requiresReason: true,
  },

  // B-079. Org-level defaults (PRD 02 US-4).
  {
    action: "org_default.updated",
    label: "Org default updated",
    requiresReason: false,
  },
  /// Recorded once per facility, not once per push: "what changed at this
  /// facility and who did it" is the question the log gets asked, and a single
  /// org-level row listing twelve facility ids does not answer it.
  {
    action: "org_default.pushed",
    label: "Org default pushed to a facility",
    requiresReason: false,
  },

  // Support impersonation (PRD 09 FR-25, B-091). Both require a reason.
  //
  // On the STARTED entry the reason is the human's stated why, captured before
  // the session exists (FR-2). On the ENDED entry it is the `endedBy` value —
  // `self`, `expiry`, `forced` or `authority_changed` — which is what FR-25's
  // "(recording `endedBy`)" asks for and the only honest answer for the three
  // that no person triggered.
  //
  // Note who the ACTOR is on each: the started/ended entries are recorded
  // against the impersonator, because starting and ending are things the staff
  // member did as themselves. Only the entries written DURING the session carry
  // the subject as actor with the impersonator alongside (FR-24).
  {
    action: "impersonation.started",
    label: "Support session started",
    requiresReason: true,
  },
  {
    action: "impersonation.ended",
    label: "Support session ended",
    requiresReason: true,
  },
] as const satisfies readonly AuditActionSpec[];

export type AuditAction = (typeof AUDIT_ACTIONS)[number]["action"];

const BY_ACTION = new Map<string, AuditActionSpec>(
  AUDIT_ACTIONS.map((spec) => [spec.action, spec]),
);

export function auditActionSpec(action: string): AuditActionSpec | undefined {
  return BY_ACTION.get(action);
}

export function requiresReasonCode(action: string): boolean {
  return BY_ACTION.get(action)?.requiresReason ?? false;
}

/// Suggested reason codes. Free text is allowed — this is a starting vocabulary
/// so the log stays filterable rather than a prose field.
export const REASON_CODES = [
  "customer_goodwill",
  "billing_error",
  "system_error",
  "management_approval",
  "legal_requirement",
  "duplicate",
  "collections_uneconomic",
  "security_incident",
  "other",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/// What a staffer reads in the dropdown. B-178: four screens rendered the raw
/// enum key with its underscores swapped for spaces, so a write-off reason read
/// "collections uneconomic" — a database value shown to a person on the screen
/// that records why a debt was forgiven. Same device as `PROOF_FIELD_LABELS`
/// (B-170): the vocabulary is the code's, the words are the operator's.
export const REASON_CODE_LABELS: Record<ReasonCode, string> = {
  customer_goodwill: "Customer goodwill",
  billing_error: "Billing error",
  system_error: "System error",
  management_approval: "Management approval",
  legal_requirement: "Legal requirement",
  duplicate: "Duplicate",
  collections_uneconomic: "Not worth collecting",
  security_incident: "Security incident",
  other: "Other",
};
