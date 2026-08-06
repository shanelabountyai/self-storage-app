// PRD 02 US-21 (B-047). What a late fee is, before anything charges one.
//
// US-21's own phrasing is the specification: "per-facility rules such as '$X or
// Y% (greater/lesser) at N days late; second fee at M days'", respecting
// "configurable caps". Every one of those words is a field below, and the
// arithmetic lives here rather than in the job so it can be exercised at every
// boundary without a database — this is a function that decides how much money
// a tenant owes.

export type LateFeeBasis = 'flat' | 'percent' | 'greater' | 'lesser'

export type LateFeeStep = {
  /// 1 is the first fee, 2 the second. Ordering, not identity.
  step: number
  /// Days past due at which this step becomes chargeable, measured from the
  /// oldest unpaid RENT invoice's original due date (D-25).
  daysPastDue: number
  amountCents: number
  /// Hundredths of a percent — 10% is 1000, the same unit as tax rates.
  percentBasisPoints: number
  basis: LateFeeBasis
  /// The most this step may charge. Null is uncapped: a real choice for a flat
  /// fee, and a dangerous one for a percentage.
  capCents: number | null
}

/// What a step charges against a given overdue balance.
///
/// Rounded half-up to whole cents, and floored at zero — a negative balance
/// (a credit) must never produce a negative fee, which would quietly pay a
/// tenant for being overdue.
export function lateFeeAmount(step: LateFeeStep, overdueCents: number): number {
  if (overdueCents <= 0) return 0

  const flat = Math.max(0, step.amountCents)
  const percent = Math.round((overdueCents * Math.max(0, step.percentBasisPoints)) / 10_000)

  let amount: number
  switch (step.basis) {
    case 'flat':
      amount = flat
      break
    case 'percent':
      amount = percent
      break
    case 'greater':
      amount = Math.max(flat, percent)
      break
    case 'lesser':
      amount = Math.min(flat, percent)
      break
  }

  // The cap is applied last, after the greater/lesser choice. Applying it to
  // each side first would let "the greater of $20 or 10%, capped at $50" return
  // $20 on a $900 balance, because the capped percentage would lose the
  // comparison to the flat amount.
  if (step.capCents !== null) amount = Math.min(amount, step.capCents)

  // Never charge more than is owed. A $25 fee on a $4 residual balance is the
  // kind of thing that ends up in a complaint rather than a payment.
  return Math.min(amount, overdueCents)
}

/// The steps chargeable at a given age, given those already charged.
///
/// Returns them in step order so a caller assessing several at once — a lease
/// that aged past two thresholds while the scheduler was down — charges the
/// first fee before the second, and the ledger reads in the order it happened.
export function stepsDue(
  daysPastDue: number,
  steps: readonly LateFeeStep[],
  alreadyCharged: readonly number[] = [],
): LateFeeStep[] {
  const charged = new Set(alreadyCharged)
  return steps
    .filter((step) => !charged.has(step.step))
    .filter((step) => daysPastDue >= step.daysPastDue)
    .sort((a, b) => a.step - b.step)
}

/// Texas practice as a starting point, and configuration rather than law
/// (D-10). Seeded for a facility that has not set its own; an operator changes
/// it by inserting effective-dated rows, never by editing these.
export const DEFAULT_LATE_FEE_STEPS: readonly LateFeeStep[] = [
  {
    step: 1,
    daysPastDue: 5,
    amountCents: 2_000,
    percentBasisPoints: 1_000,
    basis: 'greater',
    capCents: 5_000,
  },
  {
    step: 2,
    daysPastDue: 30,
    amountCents: 2_000,
    percentBasisPoints: 0,
    basis: 'flat',
    capCents: 2_000,
  },
]
