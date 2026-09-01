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
  | 'on_hold'
  | 'contains_vehicle'
  | 'no_timeline'
  | 'step_not_executed'
  | 'step_lacks_proof'
  | 'no_lien_notice_served'
  | 'notice_names_another_unit'
  | 'sale_before_notice_deadline'
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
  /// Whether the goods have been moved to another unit since the notice was
  /// served, and no notice has been served naming the unit they are in now
  /// (B-160, D-91). Only changes which of two messages a manager reads — the
  /// block itself is `lienNoticeServed` being false — but "no notice has been
  /// served" is a lie when one was, on a unit the tenant is no longer in, and
  /// a manager who knows they served it will spend the afternoon looking for
  /// the bug rather than re-serving.
  noticeUnitChanged?: boolean
  /// Whether a hold declaring `block_auction` is in force on this lease
  /// (B-121). The catalog has carried that effect since B-096 and NOTHING read
  /// it — not this function, not `approveAuction`, not `scheduleSale` — so an
  /// SCRA, bankruptcy, deceased or litigation hold stopped the nightly engine
  /// from opening a case and then stopped nothing at all once a manager was
  /// looking at one. The engine halting first made the gap invisible: every
  /// case that existed had been opened before the hold was placed.
  blockedByHold: boolean
  /// B-224. The served lien notice's own deadline — the date the notice told
  /// the tenant they had until. Null when no notice is served, in which case
  /// `no_lien_notice_served` is already blocking and this rule has nothing to
  /// say.
  noticeDeadline?: Date | null
  /// B-224. The date a sale is currently scheduled for, when it is scheduled.
  /// Null on a case that has not been, where there is no date to check yet —
  /// `scheduleSale` runs the same rule against the date it is HANDED, which is
  /// the moment that matters.
  scheduledSaleDate?: Date | null
  /// B-224 / D-10. Days the facility requires between the notice deadline and
  /// the sale, on top of the deadline itself. Configuration rather than a
  /// constant, because the interval is per-state; 0 means the deadline is the
  /// only rule, which is the safe default and the one every existing facility
  /// gets.
  minDaysNoticeToSale?: number
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

  // First among the substantive rules, ahead even of the vehicle carve-out:
  // more paperwork does not resolve it either, and of everything on this list
  // it is the one where proceeding is a federal matter rather than a state
  // lien-law defect.
  if (input.blockedByHold) {
    blockers.push({
      kind: 'on_hold',
      message:
        'A hold on this lease blocks sale — see the account holds on the tenant profile. ' +
        'Military (SCRA), bankruptcy, deceased, litigation and payment-plan holds all stop a lien sale. ' +
        'Lift the hold first if it genuinely no longer applies; do not work around it.',
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
    blockers.push(
      input.noticeUnitChanged
        ? {
            kind: 'notice_names_another_unit',
            message:
              'The goods have been moved to another unit since the lien notice was served, so the ' +
              'notice on file names a unit they are no longer in. Serve a new lien notice naming ' +
              'the unit they are in now. The notice period runs again from that service; what the ' +
              'tenant owes, and how long they have owed it, are unchanged.',
          }
        : {
            kind: 'no_lien_notice_served',
            message:
              'No lien notice has been generated and recorded as served for this lease. A sale with no ' +
              'served notice behind it cannot be defended.',
          },
    )
  }

  if (!input.approved) {
    blockers.push({
      kind: 'not_approved',
      message: 'A regional manager or owner has not approved this sale.',
    })
  }

  // Only meaningful once a date exists. On a case that has not been scheduled
  // there is nothing to check here — `scheduleSale` runs the identical rule
  // against the date it is handed, which is the moment a bad date could enter.
  if (input.scheduledSaleDate) {
    const tooEarly = saleDateBlocker({
      saleDate: input.scheduledSaleDate,
      noticeDeadline: input.noticeDeadline ?? null,
      minDaysNoticeToSale: input.minDaysNoticeToSale ?? 0,
    })
    if (tooEarly) blockers.push(tooEarly)
  }

  return { ready: blockers.length === 0, blockers }
}

/// B-224. Whether a sale date falls before the tenant was told it could.
///
/// The single most common wrongful-sale claim after "no notice was served" is
/// "the sale happened before the date the notice gave me", and until this
/// function `scheduleSale` did no date arithmetic of any kind: it stored
/// whatever it was handed. A manager serving the notice on the 5th giving the
/// tenant until the 19th could schedule for the 9th, and every readiness rule
/// still passed.
///
/// **Both dates are business dates** — `Notice.deadlineDate` is `@db.Date` and
/// the sale date is parsed as UTC midnight from a date-only input — so they
/// carry no zone and comparing them directly IS the facility-local comparison.
/// Converting either one through a timezone here would introduce the day-shift
/// this rule exists to prevent (B-220, B-223).
///
/// Returns the blocker rather than throwing, so both callers can present it
/// the way they present every other one.
export function saleDateBlocker(input: {
  saleDate: Date
  noticeDeadline: Date | null
  minDaysNoticeToSale: number
}): Blocker | null {
  // No served notice is `no_lien_notice_served`'s business, not this rule's.
  // Saying "the sale is too early" about a notice that does not exist would
  // send a manager to change the date when the fix is to serve the notice.
  if (!input.noticeDeadline) return null

  const margin = Math.max(0, Math.trunc(input.minDaysNoticeToSale))
  const earliest = new Date(input.noticeDeadline.getTime() + margin * 86_400_000)
  if (input.saleDate.getTime() >= earliest.getTime()) return null

  const day = (date: Date) => date.toISOString().slice(0, 10)
  return {
    kind: 'sale_before_notice_deadline',
    message:
      `The sale is set for ${day(input.saleDate)}, before ${day(earliest)} — the date the served ` +
      `lien notice gave the tenant${margin > 0 ? `, plus the ${margin} day${margin === 1 ? '' : 's'} this facility requires after it` : ''}. ` +
      `Selling before the deadline in the notice is the claim this pipeline exists to prevent. ` +
      `Move the sale to ${day(earliest)} or later, or serve a new notice and let its own deadline run.`,
  }
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
