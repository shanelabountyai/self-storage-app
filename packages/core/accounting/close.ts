// PRD 02 §8, US-40 (B-084 part 1). The monthly close, and what "frozen" means.
//
// §8's principle is one line — "frozen month-end snapshots (P2 close process)"
// — and the whole design turns on a distinction it does not make: **some
// figures can be recomputed from dated rows later and some cannot**, and they
// need opposite treatment.
//
//   * **Point-in-time** — unit occupancy, AR aging. Nothing in this system
//     records what a unit's status WAS, and `delinquencyReport` takes no date
//     at all; both answer "as of now". So a July figure is knowable only in
//     July, and the frozen copy is the only record there will ever be.
//     Recomputing one later does not reproduce it — it answers a different
//     question with the same name.
//
//   * **Period-derived** — revenue, move counts. These come from rows carrying
//     their own dates, so they can be recomputed for a past window. The frozen
//     copy is what was FILED, and a later disagreement means somebody changed
//     the past: a voided invoice, a backdated adjustment, a corrected move-out.
//
// Comparing the first class would cry wolf every time a unit changed status,
// forever, about a month nobody touched. Not comparing the second would hide
// exactly the post-close edits an accountant needs to know about. So drift is
// computed over the period-derived figures and nothing else, and the screen
// says which is which rather than presenting one undifferentiated table.

export const CLOSE_SNAPSHOT_VERSION = 1

/// Figures that can only be taken at the time. Frozen because there is no
/// second chance to observe them.
export type PointInTimeFigures = {
  /// Occupied ÷ rentable units, 0–1.
  unitOccupancyRatio: number
  occupiedUnits: number
  rentableUnits: number
  /// Square-foot occupancy, which differs from unit occupancy whenever the big
  /// and small units rent differently — both are frozen because both are on
  /// the dashboard and neither can be recovered later.
  squareFootRatio: number
  /// AR aging in cents, in the shared `ArAging` buckets (`daysPastDue`, D-25 —
  /// anchored to the oldest unpaid invoice's ORIGINAL due date). The bucket
  /// names are the metrics layer's own, not renamed here: a close that invented
  /// its own bucket boundaries would be the second definition §8 forbids.
  arD0to10Cents: number
  arD11to30Cents: number
  arD31to60Cents: number
  arD61to90Cents: number
  arOver90Cents: number
  arTotalCents: number
}

/// Figures derived from dated rows, which a later run can reproduce — and
/// which therefore have a meaningful "has this changed since we filed it?".
export type PeriodDerivedFigures = {
  billedCents: number
  collectedCents: number
  discountsCents: number
  referralRewardsCents: number
  writeOffsCents: number
  refundsCents: number
  unappliedCents: number
  /// Collected ÷ gross potential at street. Period-derived because both halves
  /// are: payments carry dates, and the street rate is read as at period end.
  economicOccupancyRatio: number
  grossPotentialCents: number
  moveIns: number
  moveOuts: number
  netMoves: number
}

export type PeriodSnapshot = {
  version: number
  /// When the figures were computed — which is the close instant, and is what
  /// makes the point-in-time half meaningful.
  takenAt: string
  pointInTime: PointInTimeFigures
  periodDerived: PeriodDerivedFigures
}

// ------------------------------------------------------------- closing ----

export type CloseVerdict = { allowed: true } | { allowed: false; reason: string }

/// Whether a month may be closed yet.
///
/// The month has to have ENDED in the facility's own timezone. Closing August
/// on the 15th would freeze half a month under a name that claims the whole of
/// it, and every figure filed against it would be wrong in the same direction —
/// which is worse than not having filed, because it looks like a record.
export function canClosePeriod(input: {
  /// The exclusive end of the period, already resolved to a UTC instant from
  /// the facility's timezone (`monthBounds`).
  periodEnd: Date
  now: Date
  alreadyClosed: boolean
}): CloseVerdict {
  if (input.alreadyClosed) {
    return {
      allowed: false,
      reason: 'This month is already closed. Reopen it first if the figures need to be filed again.',
    }
  }
  if (input.now < input.periodEnd) {
    return {
      allowed: false,
      reason:
        'This month has not finished yet in this facility’s own timezone. Closing it now would freeze a part-month under a name that claims all of it.',
    }
  }
  return { allowed: true }
}

// --------------------------------------------------------------- drift ----

export type DriftRow = {
  key: keyof PeriodDerivedFigures
  label: string
  filedValue: number
  currentValue: number
  /// current − filed. Signed, because the direction is the information: money
  /// appearing after a close is a different problem from money vanishing.
  deltaValue: number
  /// Whether this figure is money, so the screen formats it as cents rather
  /// than as a count or a ratio.
  kind: 'cents' | 'count' | 'ratio'
}

const DERIVED_FIELDS: readonly {
  key: keyof PeriodDerivedFigures
  label: string
  kind: DriftRow['kind']
}[] = [
  { key: 'billedCents', label: 'Billed', kind: 'cents' },
  { key: 'collectedCents', label: 'Collected', kind: 'cents' },
  { key: 'discountsCents', label: 'Discounts given', kind: 'cents' },
  { key: 'referralRewardsCents', label: 'Referral rewards', kind: 'cents' },
  { key: 'writeOffsCents', label: 'Written off', kind: 'cents' },
  { key: 'refundsCents', label: 'Refunded', kind: 'cents' },
  { key: 'unappliedCents', label: 'Unapplied money', kind: 'cents' },
  { key: 'grossPotentialCents', label: 'Gross potential', kind: 'cents' },
  { key: 'economicOccupancyRatio', label: 'Economic occupancy', kind: 'ratio' },
  { key: 'moveIns', label: 'Move-ins', kind: 'count' },
  { key: 'moveOuts', label: 'Move-outs', kind: 'count' },
  { key: 'netMoves', label: 'Net moves', kind: 'count' },
]

/// Every period-derived figure that no longer matches what was filed.
///
/// Deliberately over the period-derived half ONLY — see the header. A ratio is
/// compared with a tolerance because it is a float: recomputing 0.8266666… can
/// differ in the last bits without anything in the world having changed, and a
/// drift report that fires on floating-point noise is one nobody reads.
export function periodDrift(
  filed: PeriodDerivedFigures,
  current: PeriodDerivedFigures,
): DriftRow[] {
  const rows: DriftRow[] = []
  for (const field of DERIVED_FIELDS) {
    const filedValue = filed[field.key]
    const currentValue = current[field.key]
    const changed =
      field.kind === 'ratio'
        ? Math.abs(currentValue - filedValue) > 1e-9
        : currentValue !== filedValue
    if (!changed) continue
    rows.push({
      key: field.key,
      label: field.label,
      filedValue,
      currentValue,
      deltaValue: currentValue - filedValue,
      kind: field.kind,
    })
  }
  return rows
}

/// One sentence for a person, because "3 figures differ" is a number and this
/// is a judgement they have to make.
export function driftSummary(rows: readonly DriftRow[]): string {
  if (rows.length === 0) {
    return 'Every figure still matches what was filed. Nothing dated inside this month has changed since it was closed.'
  }
  return (
    `${rows.length} ${rows.length === 1 ? 'figure no longer matches' : 'figures no longer match'} what was filed. ` +
    'Something dated inside this closed month has changed since — a voided invoice, a backdated adjustment or a corrected move-out are the usual causes. ' +
    'The filed figures are what was reported; this is what the same query returns today.'
  )
}
