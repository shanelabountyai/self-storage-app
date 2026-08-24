import { orderedSteps, type TimelineStep } from './timeline.ts'

// PRD 02 FR-5 (B-057). What the nightly run should do to one lease tonight.
//
// Pure, and separated from the execution for the usual reason: this decides
// whether somebody's property moves a step closer to being sold, and every
// boundary in it should be checkable without a database, a clock or a gate.

export type HaltReason =
  /// The qualifying amount was paid. US-25's AC: "paying the qualifying amount
  /// automatically halts the pipeline."
  | 'cured'
  /// The lease ended. Nothing to chase and nobody to sell to.
  | 'moved_out'
  /// A `LeaseHold` declaring `halt_dunning` (US-42 / B-096). Checked FIRST, so
  /// no later branch can be reached past it — a servicemember under SCRA or a
  /// debtor under an automatic stay must not advance one step further.
  | 'on_hold'
  /// The facility has no active timeline. Not an error: B-056 is explicit that
  /// a system which has not been told what this state requires should run no
  /// lien pipeline at all.
  | 'no_timeline'
  /// B-161 / D-92. A payment came back — a returned ACH, a bounced cheque, a
  /// chargeback — and the arrear it re-opened is inside its grace window, or a
  /// `settling_payment_failed` task about it is still open. The tenant is
  /// holding a receipt and believes they are current; the ladder waits.
  | 'reversal_grace'

export type EngineInput = {
  steps: readonly TimelineStep[]
  daysPastDue: number
  /// What the tenant owes, measured against the timeline's own qualifying rule
  /// — the full balance or rent only (US-25's configurable AC). Resolved by the
  /// caller so this function does not need to know how a ledger works.
  qualifyingOutstandingCents: number
  leaseEnded: boolean
  onHold: boolean
  /// `dayOffset` values already executed for this lease. The idempotency key:
  /// a re-run of tonight, or a catch-up over a missed week, must not fire a
  /// step twice.
  executedDays: readonly number[]
  /// B-161. A step already ran for this lease on this business date. The other
  /// half of "one step per run": without it, running the nightly job twice in
  /// one evening walks the ladder two rungs and puts two notices on one date.
  executedToday: boolean
  /// B-161 / D-92. A reversal re-opened this arrear recently, or staff have not
  /// finished settling it. Resolved by the caller from the timeline's own
  /// `reversalGraceDays` and the open task, so this stays clock-free.
  reversalGrace: boolean
}

export type EngineDecision =
  | { act: true; steps: TimelineStep[] }
  | { act: false; halt: HaltReason | null }

/// Whether to advance this lease tonight, and by which steps.
///
/// The halts are checked before the arithmetic, in the order a person would —
/// and `cured` before `moved_out` deliberately: somebody who paid on their way
/// out has cured, and recording it as a move-out would lose that they settled.
export function evaluate(input: EngineInput): EngineDecision {
  if (input.steps.length === 0) return { act: false, halt: 'no_timeline' }
  if (input.onHold) return { act: false, halt: 'on_hold' }
  if (input.qualifyingOutstandingCents <= 0) return { act: false, halt: 'cured' }
  if (input.leaseEnded) return { act: false, halt: 'moved_out' }
  if (input.reversalGrace) return { act: false, halt: 'reversal_grace' }

  const executed = new Set(input.executedDays)
  const due = orderedSteps(input.steps).filter(
    (step) => input.daysPastDue >= step.dayOffset && !executed.has(step.dayOffset),
  )

  // B-161: ONE step per lease per run, however many are arithmetically due.
  //
  // Before this, a lease that arrived at full age with an empty history — a
  // reversal re-opening a 90-day invoice at its original due date (D-25), a
  // facility that configured its first timeline after the fact, a run that
  // missed a week — executed every step in the same pass. One returned ACH put
  // four dunning letters in the same post, cut the gate and opened the auction
  // case overnight. A ladder is a sequence of chances to pay; served all at
  // once it is neither a sequence nor a chance, and it is the part of a lien
  // file that has to look like it happened over ninety days because it did.
  //
  // The cost is deliberate: catching up N missed steps now takes N nights.
  if (due.length === 0 || input.executedToday) return { act: false, halt: null }
  return { act: true, steps: due.slice(0, 1) }
}

/// The stage a lease is at — the last step it has passed. Used for
/// `delinquency.stage_changed` and for the queue's grouping.
export function currentStage(
  steps: readonly TimelineStep[],
  executedDays: readonly number[],
): TimelineStep | null {
  const executed = new Set(executedDays)
  const passed = orderedSteps(steps).filter((step) => executed.has(step.dayOffset))
  return passed[passed.length - 1] ?? null
}
