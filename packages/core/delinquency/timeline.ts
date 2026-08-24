// PRD 02 §4.6 US-25/US-29 (B-056). The delinquency timeline, as configuration.
//
// This file defines what a step CAN say. B-057 is what executes it, and the
// separation is deliberate: an owner configuring a lien timeline is making a
// legal decision, and the shape of that decision should be reviewable without
// reading an engine.
//
// D-10 makes Texas the shipped default and everything per-state configurable.
// US-29 is blunt about what that means for the defaults below — "No default
// timeline is presented as legally compliant; defaults are labeled 'example
// configuration'" — and the constant name and every surface that renders it
// carry that word.

/// What a step does on its own, without a person.
///
/// A closed list rather than free text: each of these is wired to real code in
/// B-057, and a timeline that could name an action nothing implements would be
/// a configuration screen that silently does nothing on day 30.
export const AUTOMATED_ACTIONS = [
  'assess_late_fee',
  'send_notice',
  'suspend_access',
  'restore_access',
  'flag_auction_eligible',
] as const

export type AutomatedAction = (typeof AUTOMATED_ACTIONS)[number]

export const AUTOMATED_ACTION_LABELS: Record<AutomatedAction, string> = {
  assess_late_fee: 'Assess a late fee',
  send_notice: 'Send the notice below',
  suspend_access: 'Suspend gate access',
  restore_access: 'Restore gate access',
  flag_auction_eligible: 'Flag the lease as auction-eligible',
}

/// How a notice goes out. US-25 asks for "delivery method(s)" — plural, because
/// a pre-lien notice in Texas is commonly sent by more than one route and the
/// proof of each is separate.
export const DELIVERY_METHODS = ['email', 'first_class_mail', 'certified_mail', 'hand_delivered'] as const
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  email: 'Email',
  first_class_mail: 'First-class mail',
  certified_mail: 'Certified mail, return receipt',
  hand_delivered: 'Hand delivered',
}

/// Proof a staff task must produce before it can be completed. Feeds
/// `Task.proof` through the same catalog every other task type uses (US-41).
export const PROOF_FIELDS = ['note', 'tracking_number', 'photo_reference', 'delivered_on'] as const
export type ProofField = (typeof PROOF_FIELDS)[number]

/// One label and one input type per proof field, in one place (B-170).
///
/// The completion form used to render `note` and a conditional
/// `photo_reference` and nothing else, while an operator could require
/// `tracking_number` and `delivered_on` on any staff step — so a step
/// configured that way raised a task whose proof could never be recorded, and
/// the refusal it produced was the raw enum key.
///
/// Typed `Record<ProofField, ...>` rather than `Record<string, ...>` on
/// purpose: adding a member to `PROOF_FIELDS` now fails the BUILD here, which
/// is the only way a fifth field cannot repeat the same story.
export const PROOF_FIELD_LABELS: Record<
  ProofField,
  { label: string; inputType: 'text' | 'date' }
> = {
  note: { label: 'Note', inputType: 'text' },
  tracking_number: { label: 'Tracking number', inputType: 'text' },
  photo_reference: { label: 'Photo reference', inputType: 'text' },
  delivered_on: { label: 'Date delivered', inputType: 'date' },
}

export type TimelineStep = {
  /// Days past due, measured by the one shared `daysPastDue` definition (D-25)
  /// — from the ORIGINAL due date of the oldest unpaid rent invoice, never from
  /// a retry attempt.
  dayOffset: number
  /// What an operator calls it: "Pre-lien notice", "Overlock".
  label: string
  automatedActions: AutomatedAction[]
  /// A `MessageTemplate` key when the step sends something. Null otherwise.
  noticeTemplateKey: string | null
  deliveryMethods: DeliveryMethod[]
  /// A task raised for a person. Null when the step is fully automatic.
  staffTaskLabel: string | null
  requiredProofFields: ProofField[]
}

export type TimelineProblem = {
  index: number | null
  problem: string
  /// The form field to hang the message on, when the problem is about a
  /// setting rather than a step. Absent means "the steps", which is where every
  /// problem `validateTimeline` itself raises belongs.
  field?: string
}

/// What a timeline must satisfy before it can be activated.
///
/// Validation refuses rather than warns, and every rule below exists because
/// the alternative is a step that silently never runs — which on a lien
/// timeline means a notice that was never sent and a sale that cannot be
/// defended.
export function validateTimeline(
  steps: readonly TimelineStep[],
  /// Every `MessageTemplate` key that exists for this facility. When supplied,
  /// a step naming a template that is not in it is REFUSED.
  ///
  /// Optional so the pure rules stay testable without a database — but the
  /// service always passes it, because a free-text template key is a step whose
  /// notice cannot be found, and on a lien timeline that is a notice that was
  /// never sent with nothing on any screen to say so.
  knownTemplateKeys?: readonly string[],
): TimelineProblem[] {
  const problems: TimelineProblem[] = []

  if (steps.length === 0) {
    return [{ index: null, problem: 'A timeline needs at least one step.' }]
  }

  const seenDays = new Map<number, number>()

  steps.forEach((step, index) => {
    if (!Number.isInteger(step.dayOffset) || step.dayOffset < 0) {
      problems.push({ index, problem: 'Days past due must be a whole number, zero or more.' })
    }
    if (!step.label.trim()) {
      problems.push({ index, problem: 'Give the step a name staff will recognise.' })
    }

    const firstAt = seenDays.get(step.dayOffset)
    if (firstAt !== undefined) {
      // Two steps on the same day is not an error a person intends, and the
      // order between them would decide whether a fee lands before or after a
      // notice quotes the balance.
      problems.push({
        index,
        problem: `Day ${step.dayOffset} already has a step ("${steps[firstAt].label}"). Two steps on one day leave the order between them undefined.`,
      })
    } else {
      seenDays.set(step.dayOffset, index)
    }

    if (step.automatedActions.includes('send_notice') && !step.noticeTemplateKey) {
      problems.push({ index, problem: 'This step sends a notice but no template is chosen.' })
    }
    if (
      step.noticeTemplateKey &&
      knownTemplateKeys &&
      !knownTemplateKeys.includes(step.noticeTemplateKey)
    ) {
      problems.push({
        index,
        problem: `There is no message template called "${step.noticeTemplateKey}". Pick one that exists, or leave the notice empty and have staff send it by hand.`,
      })
    }
    if (step.noticeTemplateKey && step.deliveryMethods.length === 0) {
      // A notice with no delivery method is generated and filed and never
      // reaches the tenant — which is the exact failure a lien file cannot
      // survive, and it looks like success on every screen.
      problems.push({ index, problem: 'Choose at least one way this notice is delivered.' })
    }
    if (step.staffTaskLabel && step.requiredProofFields.length === 0) {
      problems.push({
        index,
        problem: 'A staff step needs at least one piece of proof, or "done" means nothing later.',
      })
    }
    if (!step.staffTaskLabel && step.requiredProofFields.length > 0) {
      problems.push({ index, problem: 'Proof is required but no staff task asks for it.' })
    }
  })

  return problems
}

/// Steps in the order they fire. Sorted rather than trusted, because a
/// re-ordered list (US-25: "steps are re-orderable") must not depend on the
/// order somebody happened to drag them into.
/// Whether a step means "go and put a lock on the unit" (B-058).
///
/// Matched on the label because that is what an operator types. The
/// alternative was a seventh automated action, but an overlock is not
/// automated — it is a person with a padlock, so it is a staff task that
/// happens to create a record. Exported so the engine and its tests agree on
/// one rule rather than two copies of a regex.
export function isOverlockStep(step: TimelineStep): boolean {
  return Boolean(step.staffTaskLabel) && /overlock/i.test(`${step.label} ${step.staffTaskLabel ?? ''}`)
}

export function orderedSteps(steps: readonly TimelineStep[]): TimelineStep[] {
  return [...steps].sort((a, b) => a.dayOffset - b.dayOffset)
}

/// Which steps a lease at `daysPastDue` has passed, and which comes next.
export function stepsDue(
  steps: readonly TimelineStep[],
  daysPastDue: number,
  alreadyExecutedDays: readonly number[] = [],
): { due: TimelineStep[]; next: TimelineStep | null } {
  const executed = new Set(alreadyExecutedDays)
  const ordered = orderedSteps(steps)
  return {
    due: ordered.filter((step) => daysPastDue >= step.dayOffset && !executed.has(step.dayOffset)),
    next: ordered.find((step) => daysPastDue < step.dayOffset) ?? null,
  }
}

/// US-25's AC: "Paying the qualifying amount (configurable: full balance vs.
/// rent-only) automatically halts the pipeline."
export const QUALIFYING_AMOUNTS = ['full_balance', 'rent_only'] as const
export type QualifyingAmount = (typeof QUALIFYING_AMOUNTS)[number]

export const QUALIFYING_AMOUNT_LABELS: Record<QualifyingAmount, string> = {
  full_balance: 'Everything owed, including fees',
  rent_only: 'Rent only — fees can stay outstanding',
}

/// US-29's disclaimer, in one place so every surface renders the same words.
///
/// Rendered persistently on the configuration screen and on every auction
/// approval screen, per US-29. Not a tooltip and not a one-time modal: the
/// person approving a sale eight months later is not the person who configured
/// the timeline.
export const TIMELINE_DISCLAIMER =
  'Lien requirements vary by state and change. Nothing here is legal advice, and no timeline in this system has been reviewed for compliance with the law of any state. Have an attorney licensed in this facility’s state review this configuration before it is used to sell anyone’s property.'

/// PRD 02 US-25's own table, as data — and labelled for what it is.
///
/// US-29: "defaults are labeled 'example configuration'". The name of this
/// constant is part of that, and so is `EXAMPLE_TIMELINE_LABEL`. It is a
/// starting point for a conversation with a lawyer, not a compliant timeline,
/// and the day numbers come from a PRD table rather than from any statute.
export const EXAMPLE_TIMELINE_LABEL = 'Example configuration — not legal advice'

export const EXAMPLE_TIMELINE_STEPS: readonly TimelineStep[] = [
  {
    dayOffset: 1,
    label: 'Late',
    automatedActions: ['assess_late_fee', 'send_notice'],
    noticeTemplateKey: 'dunning_step',
    deliveryMethods: ['email'],
    staffTaskLabel: null,
    requiredProofFields: [],
  },
  {
    dayOffset: 6,
    label: 'Access denied',
    // Inherits B-098's rule rather than reimplementing it — §4.6's own note:
    // "the Phase-2 delinquency engine inherits this rule as its access step."
    automatedActions: ['suspend_access', 'send_notice'],
    noticeTemplateKey: 'access_suspended',
    deliveryMethods: ['email'],
    staffTaskLabel: null,
    requiredProofFields: [],
  },
  {
    dayOffset: 10,
    label: 'Overlock',
    automatedActions: [],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: 'Apply the overlock and photograph it',
    requiredProofFields: ['note', 'photo_reference'],
  },
  {
    // `noticeTemplateKey` stays null, and that is not an oversight — but the
    // reason changed at B-061 and is worth stating precisely.
    //
    // These keys name MESSAGE templates: `send_notice` emits an event the
    // comms pipeline turns into an EMAIL. The statutory pre-lien and lien
    // notices are DOCUMENTS, generated from `NoticeTemplate` (B-061), served
    // by mail, hashed, and evidenced with the address they rendered to. Wiring
    // one to the other would email a statutory notice through a path with no
    // notice-by-email consent check and no delivery proof — precisely what
    // US-13's separate consent type exists to prevent.
    //
    // So this stays a staff task, and the task is now "generate it on the
    // notices screen, mail it, record the proof" rather than "write it
    // yourself". B-063 adds a courtesy EMAIL supplement about this stage,
    // which never claims to be the statutory notice; if that ships, its key
    // goes here and `send_notice` alongside.
    dayOffset: 15,
    label: 'Pre-lien notice',
    automatedActions: [],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: 'Generate the pre-lien notice on the tenant’s Notices screen, mail it, record the proof',
    requiredProofFields: ['tracking_number', 'delivered_on'],
  },
  {
    dayOffset: 30,
    label: 'Lien notice',
    automatedActions: [],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: 'Generate the lien notice on the tenant’s Notices screen, mail it, record the proof',
    requiredProofFields: ['tracking_number', 'delivered_on'],
  },
  {
    dayOffset: 45,
    label: 'Second late fee',
    automatedActions: ['assess_late_fee'],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: null,
    requiredProofFields: [],
  },
  {
    dayOffset: 60,
    label: 'Auction eligible',
    automatedActions: ['flag_auction_eligible'],
    noticeTemplateKey: null,
    deliveryMethods: [],
    staffTaskLabel: 'Regional or owner approval before scheduling a sale',
    requiredProofFields: ['note'],
  },
]
