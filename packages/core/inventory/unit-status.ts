// PRD 02 US-8: "Unit status is derived, not free-form." This file is that rule,
// kept pure and I/O-free so the truth table is exhaustively testable and so
// billing/availability (B-014) can reuse it without importing app code.
//
// Two columns back this (see the enum comments in schema.prisma):
//   Unit.status            — the effective status. Derived. Queryable.
//   Unit.operationalStatus — the operator's intent. The only part a human sets.

export const MANUAL_UNIT_STATUSES = ['available', 'maintenance', 'unrentable'] as const
export const DERIVED_UNIT_STATUSES = ['occupied', 'reserved', 'overlocked'] as const

export type ManualUnitStatus = (typeof MANUAL_UNIT_STATUSES)[number]
export type DerivedUnitStatus = (typeof DERIVED_UNIT_STATUSES)[number]
export type EffectiveUnitStatus = ManualUnitStatus | DerivedUnitStatus

/// A lease occupies its unit unless it has ended. This deliberately matches the
/// `lease_one_active_per_unit` partial index from B-002 (`status <> 'ended'`) —
/// if the two ever disagree, a unit could hold two leases the UI calls vacant.
export const OCCUPYING_LEASE_STATUSES = [
  'pending',
  'active',
  'delinquent',
  'pending_auction',
] as const

export type UnitOccupancyFacts = {
  /// Any non-ended lease on the unit.
  activeLease: { id: string; status: string } | null
  /// A reservation still holding the unit — `held` and not past its expiry.
  activeReservation: { id: string } | null
  /// Physical overlock from the delinquency pipeline. There is no source for
  /// this yet: the delinquency engine is B-057 and field ops is B-060, so the
  /// adapter passes `false`. Modeled now because `overlocked` outranks
  /// `occupied`, and retrofitting precedence later is how display bugs start.
  overlocked: boolean
}

/// Precedence, highest first:
///   overlocked — an enforcement state, and strictly more informative than the
///                occupancy it implies
///   occupied   — a lease exists
///   reserved   — a hold exists
///   operational intent (available / maintenance / unrentable)
export function deriveUnitStatus(
  operationalStatus: ManualUnitStatus,
  facts: UnitOccupancyFacts,
): EffectiveUnitStatus {
  if (facts.overlocked) return 'overlocked'
  if (facts.activeLease) return 'occupied'
  if (facts.activeReservation) return 'reserved'
  return operationalStatus
}

export type StatusChangeVerdict =
  | { allowed: true }
  | {
      allowed: false
      reason: string
      /// Names the record standing in the way, per US-8's AC: "a clear error
      /// naming the blocking record".
      blocking: { type: 'lease' | 'reservation' | 'overlock'; id: string } | null
    }

export function isManualUnitStatus(value: string): value is ManualUnitStatus {
  return (MANUAL_UNIT_STATUSES as readonly string[]).includes(value)
}

/// Whether a human may set `target` as the unit's operational status right now.
///
/// Refuses for two distinct reasons, kept distinct because they need different
/// error messages: the target is a status nobody may set by hand, or the target
/// is legal but something currently occupies the unit.
export function canSetManualStatus(
  target: string,
  facts: UnitOccupancyFacts,
): StatusChangeVerdict {
  if (!isManualUnitStatus(target)) {
    return {
      allowed: false,
      reason:
        `"${target}" is derived from lease, reservation, or delinquency state and cannot be set by hand. ` +
        `Settable statuses are: ${MANUAL_UNIT_STATUSES.join(', ')}.`,
      blocking: null,
    }
  }

  // US-8: manual statuses apply "only when no active lease exists". Extended to
  // reservations and overlocks on the same logic — all three mean the unit is
  // spoken for, and letting an operator mark a held unit `available` is exactly
  // the double-booking this rule exists to prevent.
  if (facts.overlocked) {
    return {
      allowed: false,
      reason: `Unit is overlocked by the delinquency pipeline. Resolve the delinquency before changing its status.`,
      blocking: { type: 'overlock', id: 'delinquency' },
    }
  }

  if (facts.activeLease) {
    return {
      allowed: false,
      reason: `Unit has a ${facts.activeLease.status} lease (${facts.activeLease.id}). Move the tenant out before marking it ${target}.`,
      blocking: { type: 'lease', id: facts.activeLease.id },
    }
  }

  if (facts.activeReservation) {
    return {
      allowed: false,
      reason: `Unit is held by reservation ${facts.activeReservation.id}. Cancel or let the hold expire before marking it ${target}.`,
      blocking: { type: 'reservation', id: facts.activeReservation.id },
    }
  }

  return { allowed: true }
}

/// True when a unit can be rented right now. Used by availability reads
/// (B-014) so "rentable" has one definition rather than one per caller.
export function isRentable(status: EffectiveUnitStatus): boolean {
  return status === 'available'
}
