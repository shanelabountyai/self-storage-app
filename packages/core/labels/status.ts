// One place that turns a stored status into words a person reads.
//
// B-109. Admin was rendering the database's own identifiers: a filter chip
// saying *Filtered to "overlock_apply"*, a `<select>` whose options read
// `pending_auction`, a badge reading `unrentable`. `capitalize` and
// `.replace('_', ' ')` were doing the work in three different files, which is
// how `pending_auction` became "Pending auction" on one screen and
// "pending_auction" on another.
//
// The rule this encodes is narrower than "make it pretty": **admin may use
// industry words, it may not use enum identifiers.** "Overlocked" is a word a
// storage operator uses daily and stays. `overlock_apply` is a value in our
// schema and never appears on a screen. The distinction matters because the
// temptation is to translate the industry vocabulary too, and that would make
// the software harder to use for the people whose job it is.
//
// Every map is exhaustive over its union rather than `Record<string, string>`,
// so adding a status to the schema fails the build here instead of shipping the
// raw identifier to a screen. That is the whole reason this is typed at all.

export type UnitStatusValue =
  | 'available'
  | 'reserved'
  | 'occupied'
  | 'overlocked'
  | 'maintenance'
  | 'unrentable'

export type LeaseStatusValue =
  | 'pending'
  | 'active'
  | 'delinquent'
  | 'pending_auction'
  | 'ended'

export type LeadStatusValue = 'new' | 'contacted' | 'reserved' | 'converted' | 'lost'

/// "Overlocked" and "unrentable" are operator vocabulary, not jargon to be
/// translated away — a manager asks for the overlock list by name.
export const UNIT_STATUS_LABELS: Record<UnitStatusValue, string> = {
  available: 'Available',
  reserved: 'Reserved',
  occupied: 'Occupied',
  overlocked: 'Overlocked',
  maintenance: 'Maintenance',
  unrentable: 'Unrentable',
}

/// `pending_auction` is the one that most needs this: it is the status a lien
/// sale runs from, and it appeared on screen with its underscore intact.
export const LEASE_STATUS_LABELS: Record<LeaseStatusValue, string> = {
  pending: 'Pending',
  active: 'Active',
  delinquent: 'Past due',
  pending_auction: 'Pending auction',
  ended: 'Ended',
}

export const LEAD_STATUS_LABELS: Record<LeadStatusValue, string> = {
  new: 'New',
  contacted: 'Contacted',
  reserved: 'Reserved',
  converted: 'Converted',
  lost: 'Lost',
}

/// Falls back to a de-underscored, sentence-cased form rather than to the raw
/// value. A status this does not know about is a bug — the exhaustive maps
/// above are what catch it at build time — but if one ever reaches a screen it
/// should still read as words rather than as a column value.
export function labelForStatus(
  value: string,
  labels: Record<string, string> = {},
): string {
  const known = labels[value]
  if (known) return known
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const unitStatusLabel = (value: string) => labelForStatus(value, UNIT_STATUS_LABELS)
export const leaseStatusLabel = (value: string) => labelForStatus(value, LEASE_STATUS_LABELS)
export const leadStatusLabel = (value: string) => labelForStatus(value, LEAD_STATUS_LABELS)
