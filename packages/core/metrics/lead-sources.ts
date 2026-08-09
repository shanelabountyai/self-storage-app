import { MOVE_SOURCES, type MoveSource } from './moves.ts'

// PRD 02 US-43 (B-097). Where an inquiry came from, and what a staffer may
// pick from.
//
// Deliberately the SAME vocabulary as `MOVE_SOURCES`, because the whole point
// of US-43's last AC is that the channel survives the trip from lead to
// reservation to move-in: "source and channel carry through reservation →
// move-in, so the move-in/move-out report can split walk-in vs phone vs web."
// Two lists would drift, and the drift would land as `unknown` in the one
// report the capture exists to feed.

/// What a staffer may choose. `web` is absent on purpose — a person filling
/// this in at the counter is, by construction, not the website, and offering it
/// would let a mis-click credit the channel this report exists to evaluate.
/// `unknown` is absent for the same reason: it is what history reports, never
/// something anyone selects.
export const STAFF_LEAD_SOURCES = ['phone', 'walk_in', 'referral', 'drive_by'] as const
export type StaffLeadSource = (typeof STAFF_LEAD_SOURCES)[number]

export const LEAD_SOURCE_LABELS: Record<StaffLeadSource, string> = {
  phone: 'Phone call',
  walk_in: 'Walked in',
  referral: 'Referred by someone',
  drive_by: 'Saw the sign',
}

export function isStaffLeadSource(value: string): value is StaffLeadSource {
  return (STAFF_LEAD_SOURCES as readonly string[]).includes(value)
}

/// Every staff source is a valid move source. Asserted in a test rather than
/// assumed, because the failure is silent: a source a staffer can pick but the
/// report cannot name reports as `unknown`, and nobody notices until the
/// channel split is being used to decide whether to keep answering the phone.
export function isReportableSource(value: string): value is MoveSource {
  return (MOVE_SOURCES as readonly string[]).includes(value)
}
