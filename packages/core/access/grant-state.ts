// PRD 03 FR-1. The AccessGrant state machine, kept pure so the truth table is
// exhaustively testable and so nothing can reach a state by accident.

export const GRANT_STATES = ['pending', 'active', 'suspended', 'revoked'] as const
export type GrantState = (typeof GRANT_STATES)[number]

/// Every legal move. `pending → active` is provisioning; `active ⇄ suspended`
/// is delinquency and its reversal; anything → `revoked` is the end.
///
/// Expressed as data rather than as a switch, because FR-1 requires every
/// transition to be recorded with a cause and a correlation id — a table can be
/// enumerated in a test, and a switch has to be read.
const ALLOWED: Record<GrantState, readonly GrantState[]> = {
  pending: ['active', 'revoked'],
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  // Terminal. A tenant who comes back gets a new grant rather than a
  // resurrected one — the history of why access ended is evidence.
  revoked: [],
}

export type TransitionVerdict = { allowed: true } | { allowed: false; reason: string }

export function canTransition(from: GrantState, to: GrantState): TransitionVerdict {
  if (from === to) {
    // Not an error: re-suspending an already-suspended grant is what a repeated
    // delinquency run does. The caller treats it as a no-op rather than a
    // failure, but it must not emit a second command to the hardware.
    return { allowed: false, reason: `Grant is already ${to}` }
  }
  if (!ALLOWED[from].includes(to)) {
    return {
      allowed: false,
      reason:
        from === 'revoked'
          ? 'A revoked grant is final — issue a new grant instead of reviving this one'
          : `Cannot move a ${from} grant to ${to}`,
    }
  }
  return { allowed: true }
}

/// Whether a grant in this state should let someone through the gate.
///
/// The only state that opens a gate is `active`. Worth stating as a function
/// rather than an inline comparison: it is the question every access decision
/// asks, and a second place that spells it `!== 'suspended'` would let a
/// pending or revoked grant open a gate.
export function opensGate(state: GrantState): boolean {
  return state === 'active'
}

/// Causes are recorded, not free text, so a report can group by them and a
/// human can tell an automated suspension from a manager's.
export type GrantCause =
  | 'system:move_in'
  | 'system:move_out'
  | 'system:delinquency'
  | 'system:delinquency_cleared'
  /// B-086 / US-8 AC1. A time-boxed shared-access grant reaching its expiry.
  ///
  /// `system:`, not `tenant:`, and the distinction is the same evidentiary one
  /// the `tenant:` prefix exists for: the tenant set a date, but nobody was
  /// present when it came round. A log that reads "the tenant withdrew this
  /// person" on a Tuesday the tenant did nothing is a false statement about
  /// who did what.
  | 'system:shared_access_expired'
  | `staff:${string}`
  /// B-105. A tenant acting on their own lease from the portal — adding or
  /// withdrawing somebody on their authorized-access list.
  ///
  /// Its own prefix rather than folding into `staff:`, because the gate log is
  /// evidence: after a theft claim, "the tenant let this person in" and "a
  /// manager did" are different facts, and a cause string that cannot tell
  /// them apart makes the log answer the question wrongly.
  | `tenant:${string}`

export function isSystemCause(cause: string): boolean {
  return cause.startsWith('system:')
}

/// True when a tenant, rather than staff or the system, caused the change.
export function isTenantCause(cause: string): boolean {
  return cause.startsWith('tenant:')
}
