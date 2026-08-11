// PRD 02 US-4 (B-079). "As an owner, I can define org-level defaults (fee
// schedule, notice templates, delinquency timeline) and push them to selected
// facilities, with per-facility overrides flagged visibly."
//
// The design decision this file encodes: an org default is a PUSHED value, not
// a runtime fallback. Pushing writes ordinary effective-dated rows into the
// facility's own tables, so every downstream reader — invoicing, the late-fee
// job, the delinquency engine — keeps reading exactly one place and needs no
// knowledge that org defaults exist. Nothing changes underneath a facility
// because somebody edited a default; it changes when somebody pushes it.
//
// That choice makes "flagged visibly" a comparison rather than a stored flag.
// A boolean `isOverridden` column would be a second source of truth that drifts
// the first time anyone edits a facility fee directly — which is the ordinary
// way fees get edited. Comparing the live values against the default cannot
// drift, because there is nothing to keep in sync.

export const ORG_DEFAULT_SCOPES = ['fee_schedule', 'late_fee_ladder', 'delinquency_timeline'] as const
export type OrgDefaultScope = (typeof ORG_DEFAULT_SCOPES)[number]

export const ORG_DEFAULT_SCOPE_LABELS: Record<OrgDefaultScope, string> = {
  fee_schedule: 'Fee schedule',
  late_fee_ladder: 'Late-fee ladder',
  delinquency_timeline: 'Delinquency timeline',
}

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/// One flat fee. Mirrors the columns of `FeeSchedule` that a push writes.
export type FeeDefault = { feeType: string; amountCents: number }

/// One rung of the ladder. Mirrors `LateFeeRule`.
export type LateFeeDefault = {
  step: number
  daysPastDue: number
  amountCents: number
  percentBasisPoints: number
  basis: string
  capCents: number | null
}

/// The steps of a timeline, in the shape `DelinquencyTimeline.steps` stores.
export type TimelineDefault = {
  qualifyingAmount: string
  steps: unknown[]
}

export type OrgDefaultPayload =
  | { scope: 'fee_schedule'; fees: FeeDefault[] }
  | { scope: 'late_fee_ladder'; ladder: LateFeeDefault[] }
  | { scope: 'delinquency_timeline'; timeline: TimelineDefault }

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/// What a facility screen shows next to a facility's name.
///
/// `differences` names the specific things that diverge, not just that
/// something does. "Overridden" on its own tells an owner to go and look;
/// "Overridden: admin fee, late step 2" tells them whether they need to.
export type OverrideReport = {
  matches: boolean
  differences: string[]
  /// True when the facility has no value at all for something the default
  /// defines. Distinguished from an override because it usually means the
  /// default has never been pushed here, which is a different fix.
  missing: string[]
}

function report(differences: string[], missing: string[]): OverrideReport {
  return { matches: differences.length === 0 && missing.length === 0, differences, missing }
}

export function compareFeeSchedule(
  defaults: readonly FeeDefault[],
  current: readonly FeeDefault[],
): OverrideReport {
  const byType = new Map(current.map((fee) => [fee.feeType, fee]))
  const differences: string[] = []
  const missing: string[] = []

  for (const expected of defaults) {
    const actual = byType.get(expected.feeType)
    if (!actual) missing.push(expected.feeType)
    else if (actual.amountCents !== expected.amountCents) differences.push(expected.feeType)
  }

  // A fee the facility charges that the default says nothing about is NOT
  // reported. The default is a floor of agreed values, not an exhaustive list,
  // and flagging every local fee as a divergence would make the flag useless
  // at exactly the facilities that need looking at.
  return report(differences, missing)
}

export function compareLateFeeLadder(
  defaults: readonly LateFeeDefault[],
  current: readonly LateFeeDefault[],
): OverrideReport {
  const byStep = new Map(current.map((rule) => [rule.step, rule]))
  const differences: string[] = []
  const missing: string[] = []

  for (const expected of defaults) {
    const actual = byStep.get(expected.step)
    if (!actual) {
      missing.push(`step ${expected.step}`)
      continue
    }
    if (
      actual.daysPastDue !== expected.daysPastDue ||
      actual.amountCents !== expected.amountCents ||
      actual.percentBasisPoints !== expected.percentBasisPoints ||
      actual.basis !== expected.basis ||
      (actual.capCents ?? null) !== (expected.capCents ?? null)
    ) {
      differences.push(`step ${expected.step}`)
    }
  }

  // An EXTRA rung is reported, where an extra fee type above is not. A ladder
  // is a sequence a job walks to the end of, so a third step the org never
  // agreed to is a fee a tenant actually gets charged — not an unused row.
  for (const rule of current) {
    if (!defaults.some((d) => d.step === rule.step)) differences.push(`step ${rule.step} (extra)`)
  }

  return report(differences, missing)
}

export function compareTimeline(
  defaults: TimelineDefault,
  current: TimelineDefault | null,
): OverrideReport {
  if (!current) return report([], ['timeline'])

  const differences: string[] = []
  if (current.qualifyingAmount !== defaults.qualifyingAmount) differences.push('qualifying amount')

  // Whole-value comparison of the step array. The steps are stored as JSON and
  // read as JSON by the engine, so "the same timeline" means the same JSON —
  // diffing field by field here would invent a definition of equality the thing
  // that executes it does not share.
  if (!sameJson(current.steps, defaults.steps)) {
    differences.push(
      current.steps.length === defaults.steps.length
        ? 'step configuration'
        : `step count (${current.steps.length} vs ${defaults.steps.length})`,
    )
  }

  return report(differences, [])
}

/// Key-order-independent structural equality. `JSON.stringify` alone would call
/// two identical timelines different because one was written by a form and the
/// other by a seed script, which is the sort of false "overridden" flag that
/// gets a whole feature ignored.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameJson(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  // Undefined-valued keys are treated as absent: a form that omits an optional
  // field and one that sends it empty describe the same step.
  const keys = (o: Record<string, unknown>) =>
    Object.keys(o).filter((k) => o[k] !== undefined).sort()
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key, i) => rightKeys[i] === key && sameJson(left[key], right[key]))
}

export { sameJson as sameTimelineJson }
