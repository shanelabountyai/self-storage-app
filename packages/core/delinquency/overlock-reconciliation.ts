// PRD 02 §4.9 US-36 (B-060). "A dedicated, always-current list of units that
// *should be* overlocked vs. *confirmed* overlocked (and the removal
// equivalent), reconciling system state with physical state."
//
// Kept pure and separate from the query that gathers the rows (in
// apps/web/lib/delinquency/overlock-reconciliation.ts) for the same reason
// every other rule in this directory is: the classification and the 24-hour
// threshold are exhaustively testable without a database.

/// A live `UnitOverlock` row (never removed) plus whatever open removal task
/// exists for it, if any.
export type OverlockReconciliationInput = {
  overlockId: string
  unitId: string
  unitNumber: string
  leaseId: string
  appliedAt: Date | null
  createdAt: Date
  /// When an open `overlock_remove` task exists for this lock's lease, its
  /// creation time — null if the lock has not had removal requested (or
  /// already came off, in which case the row would not be "live" at all).
  removalRequestedAt: Date | null
}

export type OverlockReconciliationState = 'awaiting_apply' | 'awaiting_removal' | 'confirmed'

export type OverlockReconciliationRow = OverlockReconciliationInput & {
  state: OverlockReconciliationState
  /// System state: does the delinquency pipeline currently want this unit
  /// locked?
  shouldBeLocked: boolean
  /// Physical state, as last confirmed by a staff member.
  confirmedLocked: boolean
  ageHours: number
  /// US-36's AC: "mismatch > 24h old is flagged."
  mismatch: boolean
}

export const OVERLOCK_MISMATCH_THRESHOLD_HOURS = 24

function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60)
}

/// Classifies one live overlock row against `now`.
export function classifyOverlock(row: OverlockReconciliationInput, now: Date): OverlockReconciliationRow {
  if (!row.appliedAt) {
    const ageHours = hoursBetween(row.createdAt, now)
    return {
      ...row,
      state: 'awaiting_apply',
      shouldBeLocked: true,
      confirmedLocked: false,
      ageHours,
      mismatch: ageHours > OVERLOCK_MISMATCH_THRESHOLD_HOURS,
    }
  }

  if (row.removalRequestedAt) {
    const ageHours = hoursBetween(row.removalRequestedAt, now)
    return {
      ...row,
      state: 'awaiting_removal',
      shouldBeLocked: false,
      confirmedLocked: true,
      ageHours,
      mismatch: ageHours > OVERLOCK_MISMATCH_THRESHOLD_HOURS,
    }
  }

  return {
    ...row,
    state: 'confirmed',
    shouldBeLocked: true,
    confirmedLocked: true,
    ageHours: hoursBetween(row.appliedAt, now),
    mismatch: false,
  }
}
