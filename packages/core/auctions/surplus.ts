// PRD 02 §4.6 US-28 (B-062). Surplus as a liability, not revenue.
//
// "A surplus is a liability with a statutory life, not revenue. Notify the
// former tenant at the address of record (US-13), hold for the state's required
// period, and record the disposition — claimed, or remitted to the state
// comptroller. Surplus quietly retained is how a routine auction becomes a
// class-action-shaped problem."
//
// The holding period is CONFIGURATION, not a constant this file knows. US-28's
// own note says the Texas duration needs an attorney pass under D-10, and a
// hard-coded number here would be the system asserting a legal fact it has not
// been told. What is built now is the shape: a duration per facility, a
// deadline computed from it, and a disposition that has to be recorded.

export const SURPLUS_DISPOSITIONS = ['held', 'claimed', 'remitted', 'no_surplus'] as const
export type SurplusDisposition = (typeof SURPLUS_DISPOSITIONS)[number]

export const SURPLUS_DISPOSITION_LABELS: Readonly<Record<SurplusDisposition, string>> = {
  held: 'Held for the former tenant',
  claimed: 'Claimed by the former tenant',
  remitted: 'Remitted to the state',
  no_surplus: 'No surplus arose',
}

/// The default holding period offered when a facility has not set one.
///
/// Deliberately NOT presented as any state's requirement — it is a placeholder
/// that makes the deadline field usable, and the settings screen labels it as
/// needing an attorney's number. One year is the common order of magnitude, not
/// a legal claim.
export const DEFAULT_SURPLUS_HOLD_DAYS = 365

export type SurplusState = {
  surplusCents: number
  disposition: SurplusDisposition
  /// When the holding period runs out. Null when there is no surplus.
  holdUntil: Date | null
  /// Whether the former tenant has been notified at their address of record.
  notifiedAt: Date | null
}

export function surplusHoldUntil(soldAt: Date, holdDays: number): Date {
  return new Date(soldAt.getTime() + holdDays * 86_400_000)
}

/// Whether the end of the holding period is close enough to act on.
///
/// `leadDays` is per-facility configuration for the same reason the hold
/// itself is: how long a cheque or a comptroller filing takes is a fact about
/// a site, not about a statute. Overdue counts as due — the alarm must not go
/// quiet at the exact moment it starts mattering most.
export function surplusDispositionDue(
  holdUntil: Date | null,
  leadDays: number,
  now: Date,
): boolean {
  if (holdUntil === null) return false
  return now.getTime() >= holdUntil.getTime() - leadDays * 86_400_000
}

export type SurplusObligation = {
  /// Something is owed and outstanding.
  outstanding: boolean
  /// What has not been done yet, in the order it has to happen.
  outstandingActions: string[]
  /// The hold has run out and nobody has dispositioned it — the state that
  /// becomes a class action.
  overdue: boolean
}

/// What still has to happen for one sale's surplus.
///
/// Reported rather than enforced, because the actions are off-system (post a
/// notice, write a cheque, file with the comptroller) — but reported
/// relentlessly, since the failure mode is a surplus nobody looks at again.
export function surplusObligation(state: SurplusState, now: Date): SurplusObligation {
  if (state.surplusCents <= 0) {
    return { outstanding: false, outstandingActions: [], overdue: false }
  }

  if (state.disposition === 'claimed' || state.disposition === 'remitted') {
    return { outstanding: false, outstandingActions: [], overdue: false }
  }

  const outstandingActions: string[] = []
  if (!state.notifiedAt) {
    outstandingActions.push('Notify the former tenant at their address of record that a surplus is held.')
  }

  const overdue = state.holdUntil !== null && state.holdUntil.getTime() <= now.getTime()
  outstandingActions.push(
    overdue
      ? 'The holding period has run out. Record the disposition — paid to the former tenant, or remitted to the state.'
      : 'Hold the surplus until the holding period ends, then record its disposition.',
  )

  return { outstanding: true, outstandingActions, overdue }
}

/// Whether a disposition may be recorded against this sale.
///
/// `no_surplus` is not something a person picks — it is what a sale that raised
/// nothing extra already is. Offering it would let somebody close out a real
/// surplus by declaring it never existed.
export function canRecordDisposition(
  surplusCents: number,
  disposition: SurplusDisposition,
): { allowed: true } | { allowed: false; reason: string } {
  if (surplusCents <= 0) {
    return { allowed: false, reason: 'This sale produced no surplus, so there is nothing to disposition.' }
  }
  if (disposition === 'no_surplus') {
    return {
      allowed: false,
      reason: 'A surplus of more than zero cannot be recorded as "no surplus".',
    }
  }
  if (disposition === 'held') {
    return { allowed: false, reason: 'Held is the starting state, not a disposition.' }
  }
  return { allowed: true }
}
