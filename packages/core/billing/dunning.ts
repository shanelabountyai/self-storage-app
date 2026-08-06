// PRD 05 CN-3 / CN-5 (B-052). The past-due dunning ladder.
//
// ── The rule the whole item turns on ────────────────────────────────────────
//
// CN-3: "Ladder steps are driven by the billing engine's delinquency-day
// events, not by an independent comms-side calendar, so comms can never
// disagree with billing about what day a tenant is on."
//
// So there is no scheduler here. The nightly billing run computes the day count
// from the same `daysPastDue` every other consumer reads (D-25), asks this
// function which steps that crosses, and emits an event per step. Comms react.
// A second calendar in the comms module is precisely the thing that would let a
// tenant be told they are on day 10 while billing believes day 5.

export type DunningStep = {
  /// Days past due at which this step fires.
  day: number
  /// 1-based position in the ladder, used for tone escalation in the template.
  /// Held separately from `day` so re-ordering or removing a step does not
  /// renumber the tone of the ones around it.
  position: number
}

/// CN-3's default ladder: gentle, firm, urgent, serious.
export const DEFAULT_DUNNING_DAYS: readonly number[] = [1, 5, 10, 30]

export function stepsFrom(days: readonly number[]): DunningStep[] {
  return [...days]
    .filter((day) => Number.isInteger(day) && day > 0)
    .sort((a, b) => a - b)
    .map((day, index) => ({ day, position: index + 1 }))
}

/// Which steps a lease has crossed and not yet been sent.
///
/// Returns them in ladder order, so a lease that aged past two steps while the
/// scheduler was down is chased in sequence rather than being sent the day-30
/// letter with no day-10 warning before it.
///
/// `alreadySent` is the days already dispatched for THIS invoice — CN-3's
/// "at most once per invoice per step". Keyed on the day rather than the
/// position, so an operator who inserts a new step between two existing ones
/// does not re-fire the ones already sent.
export function dunningStepsDue(
  daysPastDue: number,
  steps: readonly DunningStep[],
  alreadySent: readonly number[] = [],
): DunningStep[] {
  const sent = new Set(alreadySent)
  return steps
    .filter((step) => !sent.has(step.day))
    .filter((step) => daysPastDue >= step.day)
    .sort((a, b) => a.day - b.day)
}

export type LadderHalt =
  /// CN-5: "any successful payment that clears the qualifying balance halts the
  /// ladder immediately — a payment at 11:58pm must suppress the midnight
  /// step." Nothing outstanding, nothing to chase.
  | 'settled'
  /// The lease ended. CN-5's move-out halt.
  | 'moved_out'
  /// A `LeaseHold` declaring `halt_dunning` (US-42, B-096) — evaluated by its
  /// declared effects rather than a per-screen check on the type.
  | 'on_hold'

export type LadderDecision =
  | { send: true; steps: DunningStep[] }
  | { send: false; halt: LadderHalt }
  | { send: false; halt: null }

/// Whether to chase this lease tonight, and with which steps.
///
/// The halts are checked before the arithmetic, in the order a person would:
/// a lease that has ended or is on hold is not chased whatever its day count
/// says, and a settled balance stops the ladder even mid-way up it.
export function ladderDecision(input: {
  daysPastDue: number
  outstandingCents: number
  leaseEnded: boolean
  onHold: boolean
  steps: readonly DunningStep[]
  alreadySent: readonly number[]
}): LadderDecision {
  if (input.leaseEnded) return { send: false, halt: 'moved_out' }
  if (input.onHold) return { send: false, halt: 'on_hold' }
  // Checked on the BALANCE, not on the day count. The day count is a
  // historical fact that does not decrease when someone pays; only the money
  // says whether there is anything left to chase.
  if (input.outstandingCents <= 0) return { send: false, halt: 'settled' }

  const due = dunningStepsDue(input.daysPastDue, input.steps, input.alreadySent)
  return due.length > 0 ? { send: true, steps: due } : { send: false, halt: null }
}
