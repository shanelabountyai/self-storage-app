// PRD 02 §4.9 US-41 (B-095). The catalog: what a `Task.type` string means,
// what proof it needs before it can be completed, and whether completing it
// is sensitive enough to audit. Same shape as `packages/core/audit/actions.ts`
// — a data table is how a new consumer adds a task type without anyone
// touching the completion logic.

export type TaskTypeSpec = {
  type: string
  label: string
  /// Keys that must be present and non-empty in `proof` before this task can
  /// be completed. Every type requires at least a note: a queue item marked
  /// "done" with nothing to show for it is how a task queue becomes noise
  /// nobody trusts.
  requiredProofFields: readonly string[]
  /// Whether completing this type writes an AuditLog entry alongside marking
  /// it done — for the types where "who resolved this and when" matters
  /// beyond the task row itself.
  sensitive: boolean
}

export const TASK_TYPES = [
  {
    // B-026's own comment named this the reason B-095 had to exist: gate
    // provisioning failing after a paid move-in must not be a silent retry
    // with no one watching.
    type: 'move_in_provisioning_failed',
    label: 'Move-in provisioning failed',
    requiredProofFields: ['note'],
    sensitive: false,
  },
  {
    // PRD 02 US-13's own AC: returned mail "creates a task... rather than
    // sitting in a folder." Sensitive because stale contact info can affect
    // whether a legal notice is deemed delivered — worth a record of who
    // reviewed it and when, not just that the row flipped to completed.
    type: 'returned_mail_review',
    label: 'Returned mail — contact info may be stale',
    requiredProofFields: ['note'],
    sensitive: true,
  },
  {
    // PRD 01 US-707: "the request lands in the admin module for staff
    // verification (unit vacant + clean) before finalization." The task is
    // the verification queue itself; finalizing (B-040's move-out screen)
    // completes it directly rather than through this catalog's own
    // proof-gate, since the real evidence is the move-out completing at all.
    type: 'move_out_request_review',
    label: 'Tenant requested a move-out — verify and finalize',
    requiredProofFields: ['note'],
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
    type: 'insurance_proof_lapsed',
    label: 'Proof of insurance lapsed — no current cover on file',
    requiredProofFields: ['note'],
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
    type: 'failed_payment',
    label: 'Payment failed — autopay has stopped retrying',
    requiredProofFields: ['note'],
    sensitive: false,
  },
  {
    // PRD 05 CN-19 / FR-15. A hard bounce means we can no longer reach this
    // tenant by email, and every notice this system sends is email-only until
    // B-074. Somebody has to get a working address by another route.
    //
    // Sensitive: whether a tenant was reachable bears directly on whether a
    // notice was properly served, which is a question a lien dispute turns on.
    type: 'no_reachable_channel',
    label: 'Email is bouncing — no way to reach this tenant',
    requiredProofFields: ['note'],
    sensitive: true,
  },
  {
    // PRD 03 US-6 AC1. A gate command at a facility running the ManualAdapter:
    // there is no controller to talk to, so somebody walks to the keypad.
    //
    // Sensitive: this is the only record that a person, rather than the
    // system, changed who can get through a gate — and "was the code actually
    // removed after they moved out" is a question that gets asked after
    // something goes missing.
    type: 'gate_manual_action',
    label: 'Key an access change into the keypad',
    requiredProofFields: ['note'],
    sensitive: true,
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
    // B-103 / PRD 01 §3. A bank debit that was accepted and then bounced,
    // typically four business days later.
    //
    // Its own type rather than reusing `failed_payment`: that one is a card
    // decline, where nobody was ever told the money arrived. This one is a
    // tenant who has a receipt, may have been let through a gate on it, and
    // will now start getting dunning letters. The conversation is different
    // and so is the urgency.
    type: 'settling_payment_failed',
    label: 'A bank payment bounced after it was accepted',
    requiredProofFields: ['note'],
    sensitive: false,
  },
  {
    type: 'gate_drift_review',
    label: 'Reconcile the gate controller against our records',
    requiredProofFields: ['note'],
    sensitive: true,
  },
  {
    // PRD 02 US-43: "a lead not contacted within the facility's configured
    // window generates a follow-up task. A lead with no disposition is
    // visible, never silently ageing in `new`."
    //
    // Not sensitive: this is a sales nudge, not a record anyone will be asked
    // about later. The lead's own `contactedAt` is the durable fact.
    type: 'lead_follow_up',
    label: 'Call this inquiry back',
    requiredProofFields: ['note'],
    sensitive: false,
  },
  {
    // PRD 02 FR-5 / US-26 (B-057). A timeline step that needs a person: apply
    // an overlock, mail a notice, get approval before a sale.
    //
    // Sensitive: US-28 requires an auction to be defensible from the step
    // history with proof at each stage, and who completed a step — and when —
    // is exactly what a wrongful-sale claim asks about.
    type: 'delinquency_step',
    label: 'Delinquency step needs doing',
    requiredProofFields: ['note'],
    sensitive: true,
  },
  {
    // PRD 03 US-3 AC1 (B-058). "An overlock task is created for staff in the
    // admin dashboard (physical overlock is manual)."
    //
    // A photo is required, not optional. US-25's table calls it "photo
    // optional"; US-28's evidence rules for the sale it leads to do not, and a
    // lock nobody photographed is a lock a tenant can say was never fitted.
    type: 'overlock_apply',
    label: 'Fit an overlock',
    requiredProofFields: ['note', 'photo_reference'],
    sensitive: true,
  },
  {
    // The other half, on cure. US-25: "restores gate access, and queues
    // overlock removal."
    type: 'overlock_remove',
    label: 'Take the overlock off — the tenant has paid',
    requiredProofFields: ['note'],
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
    type: 'daily_walkthrough',
    label: 'Daily walkthrough — confirm the property was walked',
    requiredProofFields: ['note'],
    sensitive: false,
  },
] as const satisfies readonly TaskTypeSpec[]

export type TaskType = (typeof TASK_TYPES)[number]['type']

const BY_TYPE = new Map<string, TaskTypeSpec>(TASK_TYPES.map((spec) => [spec.type, spec]))

export function taskTypeSpec(type: string): TaskTypeSpec | undefined {
  return BY_TYPE.get(type)
}

/// Every type's floor: a note. Used verbatim for a registered type with no
/// stricter requirements, and as the fail-closed default for a type the
/// catalog has never heard of.
const DEFAULT_REQUIRED_FIELDS: readonly string[] = ['note']

/// Which of a type's required proof fields are missing or blank. Empty means
/// the task can be completed.
///
/// An unrecognised `type` falls back to the same default floor rather than
/// requiring nothing — the fail-closed direction, so a typo'd type string
/// blocks completion instead of silently accepting an empty proof object.
export function missingProofFields(type: string, proof: Record<string, unknown> | null): string[] {
  const spec = taskTypeSpec(type)
  const required = spec?.requiredProofFields ?? DEFAULT_REQUIRED_FIELDS
  return required.filter((key) => {
    const value = proof?.[key]
    return typeof value !== 'string' || value.trim() === ''
  })
}

export function taskTypeIsSensitive(type: string): boolean {
  return taskTypeSpec(type)?.sensitive ?? false
}
