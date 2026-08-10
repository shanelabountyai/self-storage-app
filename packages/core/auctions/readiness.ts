// PRD 02 §4.6 US-28 / US-29 (B-062). What must be true before a sale may be
// scheduled, and what hard-blocks it outright.
//
// "The system hard-blocks scheduling if any required step lacks proof."
//
// Hard-block means refuse, not warn. Every rule here is one that appears in a
// wrongful-sale complaint, so the failure mode to design against is a manager
// under time pressure clicking past a yellow banner — there is no banner, and
// there is no override.

export type BlockerKind =
  | 'contains_vehicle'
  | 'no_timeline'
  | 'step_not_executed'
  | 'step_lacks_proof'
  | 'no_lien_notice_served'
  | 'not_approved'
  | 'balance_settled'
  | 'already_sold'
  | 'cancelled'

export type Blocker = {
  kind: BlockerKind
  message: string
  /// Which timeline step, where the blocker is about one.
  dayOffset?: number
  label?: string
}

/// One timeline step, paired with what actually happened to it on this lease.
export type StepEvidence = {
  dayOffset: number
  label: string
  /// From the timeline configuration (B-056).
  staffTaskLabel: string | null
  requiredProofFields: readonly string[]
  /// Whether a non-superseded `DelinquencyStepRun` exists for this step.
  executed: boolean
  /// Present when the step raised a staff task. `null` when it raised none.
  task: { status: string; proof: Record<string, unknown> | null } | null
}

export type ReadinessInput = {
  /// Null when the facility has never configured a timeline (B-056). Selling
  /// somebody's belongings on a schedule nobody configured is not a thing this
  /// system will do.
  timelineConfigured: boolean
  steps: readonly StepEvidence[]
  /// US-28's vehicle carve-out. Titled property follows a different notice and
  /// sale route; running one through here is "a wrongful sale by construction".
  containsVehicle: boolean
  /// Whether a lien notice has been generated AND served (B-061). A sale
  /// preceded by no served notice is the single most common wrongful-sale
  /// claim there is.
  lienNoticeServed: boolean
  /// Regional or owner approval, per the AC.
  approved: boolean
  /// What the lease still owes. A tenant who paid is not auctionable, whatever
  /// the pipeline says.
  outstandingCents: number
  status: 'eligible' | 'scheduled' | 'sold' | 'cancelled'
}

export type Readiness = {
  ready: boolean
  blockers: Blocker[]
}

/// Every reason this sale may not be scheduled. All of them, not the first —
/// a manager fixing one blocker at a time, discovering the next each round, is
/// how a deadline gets missed and a corner gets cut.
export function auctionReadiness(input: ReadinessInput): Readiness {
  const blockers: Blocker[] = []

  if (input.status === 'sold') {
    blockers.push({ kind: 'already_sold', message: 'This unit has already been sold.' })
  }
  if (input.status === 'cancelled') {
    blockers.push({
      kind: 'cancelled',
      message: 'This case was cancelled. Start a new one if the lease has fallen behind again.',
    })
  }

  // The hard block, stated first among the substantive rules because it is the
  // one that cannot be resolved by doing more paperwork.
  if (input.containsVehicle) {
    blockers.push({
      kind: 'contains_vehicle',
      message:
        'This unit is recorded as containing a vehicle, boat or trailer, which requires a separate ' +
        'vehicle lien process. Titled property follows a different notice and sale route — it cannot ' +
        'be sold through this pipeline.',
    })
  }

  if (input.outstandingCents <= 0) {
    blockers.push({
      kind: 'balance_settled',
      message: 'This lease owes nothing. There is no lien to enforce.',
    })
  }

  if (!input.timelineConfigured) {
    blockers.push({
      kind: 'no_timeline',
      message:
        'This facility has no delinquency timeline configured, so there is no record of what was ' +
        'required or whether it happened.',
    })
  }

  for (const step of input.steps) {
    if (!step.executed) {
      blockers.push({
        kind: 'step_not_executed',
        message: `Day ${step.dayOffset} — "${step.label}" has not run.`,
        dayOffset: step.dayOffset,
        label: step.label,
      })
      continue
    }

    // Only steps that asked for a person to do something can lack proof. An
    // automated step's evidence is the step run itself.
    if (!step.staffTaskLabel) continue

    if (!step.task || step.task.status !== 'completed') {
      blockers.push({
        kind: 'step_lacks_proof',
        message: `Day ${step.dayOffset} — "${step.label}" is not completed.`,
        dayOffset: step.dayOffset,
        label: step.label,
      })
      continue
    }

    const missing = step.requiredProofFields.filter((field) => {
      const value = step.task?.proof?.[field]
      return typeof value !== 'string' || value.trim() === ''
    })
    if (missing.length > 0) {
      blockers.push({
        kind: 'step_lacks_proof',
        message: `Day ${step.dayOffset} — "${step.label}" is missing: ${missing.join(', ')}.`,
        dayOffset: step.dayOffset,
        label: step.label,
      })
    }
  }

  if (!input.lienNoticeServed) {
    blockers.push({
      kind: 'no_lien_notice_served',
      message:
        'No lien notice has been generated and recorded as served for this lease. A sale with no ' +
        'served notice behind it cannot be defended.',
    })
  }

  if (!input.approved) {
    blockers.push({
      kind: 'not_approved',
      message: 'A regional manager or owner has not approved this sale.',
    })
  }

  return { ready: blockers.length === 0, blockers }
}

/// US-28's own list for the buyer record: "name, address, government-ID
/// reference, sales-tax resale certificate where exempt, amount, payment
/// method, and the cleanout deadline with its forfeit terms. A sales-tax return
/// on auction proceeds cannot be filed without it."
///
/// The resale certificate is conditional — required only when the buyer claims
/// tax exemption — so it is not in this list; `missingBuyerFields` handles it.
export const REQUIRED_BUYER_FIELDS = [
  'name',
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'governmentIdReference',
  'paymentMethod',
] as const

export type BuyerRecordInput = {
  name?: string | null
  addressLine1?: string | null
  /// Optional, unlike line 1 — plenty of addresses have no second line.
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  governmentIdReference?: string | null
  paymentMethod?: string | null
  taxExempt?: boolean
  resaleCertificateReference?: string | null
  cleanoutDeadline?: Date | null
}

export function missingBuyerFields(buyer: BuyerRecordInput): string[] {
  const missing = REQUIRED_BUYER_FIELDS.filter((field) => {
    const value = buyer[field]
    return typeof value !== 'string' || value.trim() === ''
  }) as string[]

  // Only when they claim exemption — but then it is not optional, because the
  // facility carries the tax liability if the certificate cannot be produced.
  if (buyer.taxExempt && !buyer.resaleCertificateReference?.trim()) {
    missing.push('resaleCertificateReference')
  }
  if (!buyer.cleanoutDeadline) missing.push('cleanoutDeadline')

  return missing
}
