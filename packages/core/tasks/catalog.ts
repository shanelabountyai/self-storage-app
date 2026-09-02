// PRD 02 §4.9 US-41 (B-095). The catalog: what a `Task.type` string means,
// what proof it needs before it can be completed, and whether completing it
// is sensitive enough to audit. Same shape as `packages/core/audit/actions.ts`
// — a data table is how a new consumer adds a task type without anyone
// touching the completion logic.

import { type ProofField } from "../delinquency/timeline.ts";

export type TaskTypeSpec = {
  type: string;
  label: string;
  /// Keys that must be present and non-empty in `proof` before this task can
  /// be completed. Every type requires at least a note: a queue item marked
  /// "done" with nothing to show for it is how a task queue becomes noise
  /// nobody trusts.
  /// B-170: `ProofField`, not `string`. Every screen that renders these keys
  /// reads one label map (`PROOF_FIELD_LABELS`), and a key with no label there
  /// is a build failure rather than a raw enum shown to staff.
  requiredProofFields: readonly ProofField[];
  /// Whether completing this type writes an AuditLog entry alongside marking
  /// it done — for the types where "who resolved this and when" matters
  /// beyond the task row itself.
  sensitive: boolean;
  /// B-166. Types that a note can never close, and the sentence telling the
  /// reader what actually closes them.
  ///
  /// The proof gate above asks for evidence and accepts typing as evidence.
  /// That is right for most of this queue — "what did you do" about returned
  /// mail is a note by nature — and wrong for a task whose whole content is
  /// that a specific record is still in a blocked state: the increase is on
  /// hold whatever anybody types, so a completed row would mean the queue had
  /// forgotten about a held increase rather than that anyone had unheld it.
  /// Set this and `completeTask` refuses from the queue, and the card renders
  /// the sentence and the link instead of a note form. The screen named here
  /// completes the task itself, as `move_out_request_review` already does.
  ///
  /// The href lives in the catalog rather than in the queue's JSX so the view
  /// never has to switch on a `Task.type` string to know where to send
  /// somebody — the same reason `label` is here.
  resolvedByAction?: { sentence: string; href: string; linkLabel: string };
};

export const TASK_TYPES = [
  {
    // B-026's own comment named this the reason B-095 had to exist: gate
    // provisioning failing after a paid move-in must not be a silent retry
    // with no one watching.
    type: "move_in_provisioning_failed",
    label: "Move-in provisioning failed",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 02 US-13's own AC: returned mail "creates a task... rather than
    // sitting in a folder." Sensitive because stale contact info can affect
    // whether a legal notice is deemed delivered — worth a record of who
    // reviewed it and when, not just that the row flipped to completed.
    type: "returned_mail_review",
    label: "Returned mail — contact info may be stale",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 01 US-707: "the request lands in the admin module for staff
    // verification (unit vacant + clean) before finalization." The task is
    // the verification queue itself; finalizing (B-040's move-out screen)
    // completes it directly rather than through this catalog's own
    // proof-gate, since the real evidence is the move-out completing at all.
    type: "move_out_request_review",
    label: "Tenant requested a move-out — verify and finalize",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 01 §9 (B-090 part 2). A tenant has asked, from the portal, to move
    // into a different unit at the same site.
    //
    // The same shape as `move_out_request_review` and for the same reason: the
    // tenant is asking, not doing. A transfer moves physical goods between two
    // units — nobody but a person on site can say the old one is empty — and
    // committing one posts money, closes a lease and issues a gate credential.
    // So the portal records the ask and holds the target unit; B-077's wizard,
    // unchanged, is still the only thing that completes it.
    //
    // Not sensitive: the transfer itself writes `lease.transferred` to the
    // audit log when it commits, which is the record anyone would ask about.
    // This row only says somebody asked.
    type: "transfer_request_review",
    label: "Tenant asked to transfer to another unit",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 02 US-44 / D-17. A tenant's own cover ran out and no replacement
    // declaration page arrived. Raised whether or not the facility auto-enrols
    // — with the switch off this task IS the whole mechanism, and with it on
    // somebody still has to know a tenant just started being charged.
    //
    // Sensitive: whether a unit was covered on the day it flooded is exactly
    // the question a coverage argument turns on, so who saw this and what they
    // did about it belongs in the audit trail, not only on the task row.
    type: "insurance_proof_lapsed",
    label: "Proof of insurance lapsed — no current cover on file",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 01 US-705 (B-104). A tenant has told us about their own cover from
    // the portal — insurer, policy number, expiry.
    //
    // Distinct from `insurance_proof_lapsed`, which is the system noticing that
    // cover has RUN OUT. This one is a person volunteering details that nobody
    // has checked yet, and it exists because there is no blob store: the
    // declaration page cannot be attached, so a human confirming the numbers
    // against the document the tenant emails or brings in is the honest
    // substitute.
    //
    // Sensitive: whether a unit was covered, and by whom, is the first question
    // asked after a fire or a flood.
    type: "insurance_proof_review",
    label: "Check a tenant’s proof of insurance",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 US-20 / US-41. The "failed payments queue" the AC asks for is a
    // filtered view of this list, not a table of its own — §4.9 is explicit
    // that every later queue reads `Task`.
    //
    // Raised only when the retry schedule is FINISHED with an invoice: either
    // the card gave a decline no retry will fix, or the last scheduled attempt
    // failed. A task per failed attempt would put four rows in front of staff
    // for one tenant and train them to ignore the queue.
    type: "failed_payment",
    label: "Payment failed — autopay has stopped retrying",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 05 §8 Phase 3 / PRD 02 US-41 (B-135, D-78). Somebody texted us back
    // and it was not a keyword.
    //
    // `high` at creation and not by accident: everything else in this queue is
    // work the business found for itself, and this is the only type where a
    // person is standing somewhere waiting on an answer they have no way of
    // knowing we received.
    //
    // Not sensitive. The tenant's own words are already permanent in the
    // domain event this task points at, so an audit row would record only that
    // a staffer marked a message read — which the task row already says.
    type: "inbound_sms_review",
    label: "A tenant texted back — read it and reply",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 05 CN-19 / FR-15. A hard bounce means we can no longer reach this
    // tenant by email, and every notice this system sends is email-only until
    // B-074. Somebody has to get a working address by another route.
    //
    // Sensitive: whether a tenant was reachable bears directly on whether a
    // notice was properly served, which is a question a lien dispute turns on.
    type: "no_reachable_channel",
    label: "Email is bouncing — no way to reach this tenant",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 US-11 / D-88 (B-152). A scheduled rate increase whose notice
    // provably did not arrive. The increase is HELD, not applied — D-88's
    // Option A — so this task is the only thing that says so: somebody has to
    // get a working address and schedule the increase again, which restarts
    // the notice clock.
    //
    // `high` at creation, like `inbound_sms_review` and for the mirror-image
    // reason: revenue is slipping a month per bad address, and unlike the rest
    // of this queue the delay compounds silently.
    //
    // Sensitive: whether notice was served is the fact a rate-increase dispute
    // turns on, so who decided what to do about a failed one is worth keeping
    // beyond the task row.
    //
    // B-166: `resolvedByAction`, and this is the type the field was added
    // for. Until B-166 the only thing this card offered was a note box, so
    // the one recorded outcome of a held increase was somebody typing
    // "called them" — the increase still held, the task closed, and the queue
    // no longer saying so. Re-noticing or cancelling closes it; nothing else
    // can.
    type: "rate_increase_notice_undelivered",
    label: "Rate-increase notice did not arrive — the increase is on hold",
    requiredProofFields: ["note"],
    sensitive: true,
    resolvedByAction: {
      sentence:
        "Re-notice or cancel the increase — a note cannot close this, because the increase stays on hold either way.",
      href: "/admin/rate-increases",
      linkLabel: "Open rate changes",
    },
  },
  {
    // PRD 03 US-6 AC1. A gate command at a facility running the ManualAdapter:
    // there is no controller to talk to, so somebody walks to the keypad.
    //
    // Sensitive: this is the only record that a person, rather than the
    // system, changed who can get through a gate — and "was the code actually
    // removed after they moved out" is a question that gets asked after
    // something goes missing.
    type: "gate_manual_action",
    label: "Key an access change into the keypad",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // B-103 / PRD 01 §3. A bank debit that was accepted and then bounced,
    // typically four business days later.
    //
    // Its own type rather than reusing `failed_payment`: that one is a card
    // decline, where nobody was ever told the money arrived. This one is a
    // tenant who has a receipt, may have been let through a gate on it, and
    // will now start getting dunning letters. The conversation is different
    // and so is the urgency.
    //
    // B-146 widened it from ACH to every payment that came back after we
    // recorded it — a bounced cheque and a lost card dispute raise exactly this
    // conversation, and US-41's rule is one queue rather than a new type per
    // source. The LABEL changed with it: it said "a bank payment", which read
    // as wrong on a returned cheque.
    type: "settling_payment_failed",
    label: "A payment bounced after it was accepted",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 03 FR-9 (B-080). The nightly reconciliation found the controller and
    // our records disagreeing.
    //
    // One task per facility per day rather than one per finding: a controller
    // restored from a backup produces dozens of findings at once, and dozens of
    // tasks is a queue nobody opens. The task points at the run; the run lists
    // what diverged.
    //
    // Sensitive: the findings include which codes the gate honours that we have
    // no record of, and "who could get in on the 3rd" is asked after something
    // goes missing — the same reason `gate_manual_action` is marked sensitive.
    type: "gate_drift_review",
    label: "Reconcile the gate controller against our records",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 US-43: "a lead not contacted within the facility's configured
    // window generates a follow-up task. A lead with no disposition is
    // visible, never silently ageing in `new`."
    //
    // Not sensitive: this is a sales nudge, not a record anyone will be asked
    // about later. The lead's own `contactedAt` is the durable fact.
    type: "lead_follow_up",
    label: "Call this inquiry back",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // PRD 02 FR-5 / US-26 (B-057). A timeline step that needs a person: apply
    // an overlock, mail a notice, get approval before a sale.
    //
    // Sensitive: US-28 requires an auction to be defensible from the step
    // history with proof at each stage, and who completed a step — and when —
    // is exactly what a wrongful-sale claim asks about.
    type: "delinquency_step",
    label: "Delinquency step needs doing",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 03 US-3 AC1 (B-058). "An overlock task is created for staff in the
    // admin dashboard (physical overlock is manual)."
    //
    // A photo is required, not optional. US-25's table calls it "photo
    // optional"; US-28's evidence rules for the sale it leads to do not, and a
    // lock nobody photographed is a lock a tenant can say was never fitted.
    type: "overlock_apply",
    label: "Fit an overlock",
    requiredProofFields: ["note", "photo_reference"],
    sensitive: true,
  },
  {
    // The other half, on cure. US-25: "restores gate access, and queues
    // overlock removal."
    // B-169. The label states the FACT; `Task.detail` carries the reason.
    //
    // It read "the tenant has paid", which B-058 wrote for the cure path and
    // was true of it. B-151 then raised this same task after a lease ended,
    // after an auction sale and after an abandonment — so the card asserted a
    // payment that had not happened, on the two paths where the tenant most
    // certainly had not paid, and a staffer walked to the unit expecting a
    // grateful customer.
    type: "overlock_remove",
    label: "Take the overlock off",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). A payment plan's own
    // schedule went unmet — an installment's due date passed without enough
    // paid against it since the plan started.
    //
    // `high` at creation, the same tier as `inbound_sms_review` and
    // `rate_increase_notice_undelivered`: the hold that was pausing
    // collections has just been lifted automatically, and the pipeline
    // resumes against this tenant tonight whether or not anyone reads this
    // card.
    //
    // Sensitive: this is the record of WHY collections resumed against a
    // tenant who was told they were on a plan — exactly the question a
    // dispute over the ladder restarting asks.
    type: "payment_plan_broken",
    label: "Payment plan broken — collections have resumed",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 §4.9 US-35 (B-060). "Space-by-space verification items" — the one
    // task raised per facility per day that stands for the walk itself, rather
    // than one row per unit. Its own screen (`/admin/walkthrough`) lists the
    // real per-unit work (overlocks, units awaiting a post-move-out check)
    // alongside it; completing THIS task is "yes, I actually walked the
    // property today."
    //
    // Not sensitive: nothing legal turns on whether this particular task row
    // was completed — the things it points at (overlocks, tickets) carry their
    // own record if something goes wrong.
    type: "daily_walkthrough",
    label: "Daily walkthrough — confirm the property was walked",
    requiredProofFields: ["note"],
    sensitive: false,
  },
  {
    // B-229. PRD 02 FR-1/FR-4. A nightly job that ends `failed` or `partial`
    // wrote a `JobRun` row and told nobody: the only surface was
    // `/admin/billing`, which somebody has to decide to go and read. So
    // `billing.generate-invoices` throwing on a Tuesday at one site was a month
    // of unbilled rent, invisible until an owner asked why revenue was down,
    // and a failed `delinquency.timeline` stopped the lien clock in a way
    // `auctionReadiness` would later refuse every sale for, untraceably.
    //
    // The subject is the run itself (`entityType: "JobRun"`), so the card links
    // to the Billing runs screen where the error and the per-item outcomes are,
    // and `detail` carries the one sentence — which job, and what it said.
    //
    // Sensitive: what somebody did about a failed money job — re-ran it,
    // invoiced by hand, decided it did not matter — is exactly the question
    // asked when the month does not reconcile.
    type: "job_failed",
    label: "A nightly job did not finish",
    requiredProofFields: ["note"],
    sensitive: true,
  },
  {
    // PRD 02 §4.6 US-28 (B-234). A sale left money over and the former tenant
    // has not been told it is being held for them.
    //
    // The arithmetic for this existed from B-062 — `surplusObligation` has
    // always returned the un-notified state — and the only thing reading it was
    // one facility's auctions screen, which nobody opens at a site with no live
    // cases. So the surplus sat, correctly computed, unread, for the year the
    // hold runs. The alarm is what was missing, not the maths.
    //
    // No note can close it: a surplus stays un-notified whatever anybody types,
    // and a closed card would mean the queue had forgotten a liability rather
    // than that anyone had discharged it. Recording the notice on the auctions
    // screen cancels it.
    //
    // Sensitive: whether the former tenant was told, and when, is the first
    // question asked when a retained surplus turns into a claim.
    type: "surplus_notice_due",
    label: "Tell the former tenant a sale surplus is being held",
    requiredProofFields: ["note"],
    sensitive: true,
    resolvedByAction: {
      sentence:
        "Record the notice on the auctions screen — a note cannot close this, because the surplus stays un-notified either way.",
      href: "/admin/auctions",
      linkLabel: "Open auctions",
    },
  },
  {
    // PRD 02 §4.6 US-28 / US-29 (B-234). The holding period is running out, or
    // has run out, and no disposition has been recorded.
    //
    // Raised `surplusNoticeLeadDays` before the deadline and escalated to
    // `high` once it passes — the row's own state, not a second task type,
    // because the action does not change when it goes overdue. Only the answer
    // to "how long has this been true" does.
    //
    // The duration it counts against is configuration and stays labelled as an
    // example configuration (US-29, D-10). This alarms on whatever the facility
    // is set to and asserts nothing about what any state requires.
    type: "surplus_disposition_due",
    label: "Sale surplus must be paid out or remitted",
    requiredProofFields: ["note"],
    sensitive: true,
    resolvedByAction: {
      sentence:
        "Record the disposition on the auctions screen — a note cannot close this, because the surplus stays held either way.",
      href: "/admin/auctions",
      linkLabel: "Open auctions",
    },
  },
] as const satisfies readonly TaskTypeSpec[];

export type TaskType = (typeof TASK_TYPES)[number]["type"];

const BY_TYPE = new Map<string, TaskTypeSpec>(
  TASK_TYPES.map((spec) => [spec.type, spec]),
);

export function taskTypeSpec(type: string): TaskTypeSpec | undefined {
  return BY_TYPE.get(type);
}

/// Every type's floor: a note. Used verbatim for a registered type with no
/// stricter requirements, and as the fail-closed default for a type the
/// catalog has never heard of.
const DEFAULT_REQUIRED_FIELDS: readonly ProofField[] = ["note"];

/// What a type asks for, with the fail-closed default for a type the catalog
/// has never heard of.
export function requiredProofFieldsForType(type: string): readonly ProofField[] {
  return taskTypeSpec(type)?.requiredProofFields ?? DEFAULT_REQUIRED_FIELDS;
}

/// Which of `required` are missing or blank in `proof`.
///
/// Split out of `missingProofFields` (B-170) because the catalog is no longer
/// the only source of a task's required fields: a `delinquency_step` task also
/// inherits whatever proof the configured step asked for, and the form that
/// collects it and the gate that refuses without it have to read the same
/// list or the task becomes uncompletable.
export function missingFromRequired(
  required: readonly ProofField[],
  proof: Record<string, unknown> | null,
): ProofField[] {
  return required.filter((key) => {
    const value = proof?.[key];
    return typeof value !== "string" || value.trim() === "";
  });
}

/// Which of a type's required proof fields are missing or blank. Empty means
/// the task can be completed.
///
/// An unrecognised `type` falls back to the same default floor rather than
/// requiring nothing — the fail-closed direction, so a typo'd type string
/// blocks completion instead of silently accepting an empty proof object.
export function missingProofFields(
  type: string,
  proof: Record<string, unknown> | null,
): ProofField[] {
  return missingFromRequired(requiredProofFieldsForType(type), proof);
}

export function taskTypeIsSensitive(type: string): boolean {
  return taskTypeSpec(type)?.sensitive ?? false;
}

/// B-166. What closes this type, when a note cannot. Undefined for every
/// ordinary type, which is what `completeTask` and the queue card both branch
/// on.
export function taskTypeResolvedByAction(
  type: string,
): TaskTypeSpec["resolvedByAction"] {
  return taskTypeSpec(type)?.resolvedByAction;
}
