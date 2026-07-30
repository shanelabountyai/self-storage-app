// Shared effective-dating logic for anything versioned the way PRD 02 FR-9
// requires (tax rates, fee schedules — street rates and delinquency timelines
// get their own effective-dating when B-011/B-056 build them). Rows are never
// edited or deleted; "changing a value" is inserting a new row with a later
// effectiveFrom. This file has zero I/O so it's trivially unit-testable and
// reusable from billing (B-044) without duplicating the "which row wins" logic.

export type EffectiveDated = { effectiveFrom: Date }

/// The row whose effectiveFrom is the latest one on or before `asOf`, or null
/// if every row is still in the future. Ties (identical effectiveFrom) are
/// resolved arbitrarily but consistently — the unique constraint on
/// (facilityId, jurisdiction/feeType, effectiveFrom) means a real tie should
/// never occur in stored data.
export function effectiveAsOf<T extends EffectiveDated>(rows: readonly T[], asOf: Date): T | null {
  let winner: T | null = null
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > asOf.getTime()) continue
    if (!winner || row.effectiveFrom.getTime() > winner.effectiveFrom.getTime()) winner = row
  }
  return winner
}

/// Groups rows by a key and picks the effective one per group — e.g. one
/// result per tax jurisdiction, or one per fee type.
export function effectiveByGroup<T extends EffectiveDated>(
  rows: readonly T[],
  asOf: Date,
  keyOf: (row: T) => string,
): Map<string, T> {
  const byGroup = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = byGroup.get(key)
    if (group) group.push(row)
    else byGroup.set(key, [row])
  }

  const result = new Map<string, T>()
  for (const [key, group] of byGroup) {
    const effective = effectiveAsOf(group, asOf)
    if (effective) result.set(key, effective)
  }
  return result
}
