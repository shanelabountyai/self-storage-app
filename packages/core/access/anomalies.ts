// PRD 03 US-5 AC3 (B-064). The flags a manager filters the event log by.
//
// "Flags are computed and filterable: `after_hours_attempt`, `denied_repeated`
// (≥ 5 denials in 15 min), `unknown_code`, `suspended_attempt`, `long_dwell`."
//
// Computed at INGESTION and stored on the row, not derived on read. Two
// reasons, and the second is the one that matters:
//
//   * `denied_repeated` is a property of a window of neighbouring events, so
//     deriving it while rendering a filtered, paginated list means re-reading
//     the neighbours of every row on every page load.
//   * The flag is evidence. What the system thought at the time is the thing a
//     manager is being asked about later, and a flag recomputed under today's
//     thresholds would quietly rewrite that.

export const ACCESS_FLAGS = [
  'after_hours_attempt',
  'denied_repeated',
  'unknown_code',
  'suspended_attempt',
] as const

export type AccessFlag = (typeof ACCESS_FLAGS)[number]

export const ACCESS_FLAG_LABELS: Record<AccessFlag, string> = {
  after_hours_attempt: 'Outside gate hours',
  denied_repeated: 'Repeated denials',
  unknown_code: 'Unknown code',
  suspended_attempt: 'Suspended account tried the gate',
}

/// AC3's threshold, stated once. Five denials inside fifteen minutes.
export const REPEATED_DENIAL_COUNT = 5
export const REPEATED_DENIAL_WINDOW_MINUTES = 15

export type EventForFlags = {
  result: 'granted' | 'denied'
  /// The vendor's own reason, already normalised by the adapter.
  reason: string
  /// Whether the code presented matched a credential on file. False is the
  /// literal definition of `unknown_code`.
  credentialKnown: boolean
  /// The grant's state at the moment of the attempt, where there was one.
  grantState: string | null
  /// How many denials this facility has logged inside the window ending at
  /// this event, INCLUDING this one.
  recentDenials: number
}

/// Every flag that applies to one event.
///
/// An event can carry several: a suspended tenant trying an old code at 3am
/// for the sixth time is genuinely four different observations, and collapsing
/// them to the "most severe" would hide three of them from the filter that
/// somebody is using to find exactly that pattern.
export function flagsFor(event: EventForFlags): AccessFlag[] {
  const flags: AccessFlag[] = []

  if (event.result === 'denied' && !event.credentialKnown) {
    flags.push('unknown_code')
  }
  // The reason string is the adapter's, and `outside_hours` is what the
  // simulator and FR-5's contract both emit. Flagged on a GRANT too: a real
  // vendor with hardware-side time windows can let somebody in and report the
  // window as a note, and an entry outside published hours is worth surfacing
  // whichever way it went.
  if (event.reason === 'outside_hours') {
    flags.push('after_hours_attempt')
  }
  if (event.result === 'denied' && event.grantState === 'suspended') {
    flags.push('suspended_attempt')
  }
  if (event.result === 'denied' && event.recentDenials >= REPEATED_DENIAL_COUNT) {
    flags.push('denied_repeated')
  }

  return flags
}

export function isAccessFlag(value: string): value is AccessFlag {
  return (ACCESS_FLAGS as readonly string[]).includes(value)
}
