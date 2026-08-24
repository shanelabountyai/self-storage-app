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
  /// B-169. Whether the lease this lock was fitted against is still occupying.
  ///
  /// The state this list could not previously express, and the one that costs
  /// real money: a lock on a unit with no tenant is inventory nobody can rent,
  /// and `deriveUnitStatus` reports it as `overlocked` — which reads as "a
  /// tenant is behind", so system and physical agreed and both were wrong.
  leaseEnded: boolean
}

/// B-169. Why a lock is coming off. The removal task's card states this,
/// because its type cannot: B-058 wrote `overlock_remove` for the CURE path and
/// labelled it "the tenant has paid", and B-151 then raised the same task after
/// a lease ended, after an auction sale and after an abandonment — three paths
/// where the tenant most certainly did not pay.
export const OVERLOCK_REMOVAL_REASONS = [
  'cured',
  'lease_ended',
  'transfer',
  'auction_sold',
  'abandoned',
] as const

export type OverlockRemovalReason = (typeof OVERLOCK_REMOVAL_REASONS)[number]

/// In an operator's words, as the sentence under the card's subject.
export const OVERLOCK_REMOVAL_LABELS: Record<OverlockRemovalReason, string> = {
  cured: 'The tenant has paid.',
  lease_ended: 'The lease has ended — the unit is out of inventory until the lock comes off.',
  transfer: 'The tenant moved to another unit.',
  auction_sold: 'The contents were sold at auction. The tenant has not paid.',
  abandoned: 'The unit was recorded as abandoned. The tenant has not paid.',
}

export function overlockRemovalLabel(reason: string | null): string {
  return (
    OVERLOCK_REMOVAL_LABELS[reason as OverlockRemovalReason] ??
    'The lock is no longer wanted on this unit.'
  )
}

export type OverlockReconciliationState =
  | 'awaiting_apply'
  | 'awaiting_removal'
  | 'confirmed'
  /// B-169. A lock still on a unit whose lease has ended and which nothing has
  /// asked to have removed. Its own state rather than a flag on `confirmed`,
  /// because `confirmed` means "system and physical agree" and here they agree
  /// on something wrong — which is exactly why nothing reported it.
  | 'stuck_no_lease'

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

  // Ahead of the removal-requested branch: a lock whose removal HAS been asked
  // for is already visible and already ageing, and `stuck` is for the ones
  // nothing is chasing.
  if (row.leaseEnded && !row.removalRequestedAt) {
    const ageHours = hoursBetween(row.appliedAt, now)
    return {
      ...row,
      state: 'stuck_no_lease',
      // Nothing wants this locked. That is the whole finding.
      shouldBeLocked: false,
      confirmedLocked: true,
      ageHours,
      // Flagged immediately rather than after 24 hours, unlike every other
      // mismatch here: the others are a staff member not having got there yet,
      // and this one is a unit that has fallen out of sellable inventory with
      // nothing in any queue about it.
      mismatch: true,
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
