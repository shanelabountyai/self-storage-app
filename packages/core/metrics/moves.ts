// PRD 02 US-39.3, §4.11's "report 3 has an owner". Move-ins, move-outs, net,
// by source, with reservation conversion.

/// Where a rental came from. `web` is the public site's own checkout, `phone`
/// and `walk_in` are B-097's inquiry capture, `referral`/`drive_by` come with
/// it. `unknown` is not a category anyone chose — it is every lease created
/// before source was captured, kept visible rather than silently folded into
/// `web`, because a report that quietly attributes history to the channel
/// being evaluated is worse than one that admits a gap.
export const MOVE_SOURCES = ['web', 'phone', 'walk_in', 'referral', 'drive_by', 'unknown'] as const
export type MoveSource = (typeof MOVE_SOURCES)[number]

export function normalizeSource(source: string | null | undefined): MoveSource {
  if (!source) return 'unknown'
  return (MOVE_SOURCES as readonly string[]).includes(source) ? (source as MoveSource) : 'unknown'
}

export type MoveEvent = { source: MoveSource }

export type MoveCounts = {
  moveIns: number
  moveOuts: number
  /// moveIns − moveOuts. Negative is a real and important answer; a site
  /// losing four units a month needs that on the screen, not clamped to zero.
  net: number
  bySource: Record<MoveSource, number>
}

function emptyBySource(): Record<MoveSource, number> {
  return { web: 0, phone: 0, walk_in: 0, referral: 0, drive_by: 0, unknown: 0 }
}

/// Counts move-ins and move-outs in a period. `bySource` covers move-INS
/// only: a move-out has no acquisition channel, and attributing one would
/// invent data.
export function moveCounts(
  moveIns: readonly MoveEvent[],
  moveOutCount: number,
): MoveCounts {
  const bySource = emptyBySource()
  for (const move of moveIns) bySource[move.source] += 1

  return {
    moveIns: moveIns.length,
    moveOuts: moveOutCount,
    net: moveIns.length - moveOutCount,
    bySource,
  }
}

export function sumMoveCounts(counts: readonly MoveCounts[]): MoveCounts {
  const bySource = emptyBySource()
  for (const count of counts) {
    for (const source of MOVE_SOURCES) bySource[source] += count.bySource[source]
  }
  const moveIns = counts.reduce((total, c) => total + c.moveIns, 0)
  const moveOuts = counts.reduce((total, c) => total + c.moveOuts, 0)
  return { moveIns, moveOuts, net: moveIns - moveOuts, bySource }
}

export type ReservationOutcome = {
  createdAt: Date
  /// Set when this reservation became a lease. Null for held, cancelled and
  /// expired alike.
  convertedAt: Date | null
}

export type ConversionResult = {
  reservations: number
  converted: number
  /// converted ÷ reservations, 0–1.
  conversionRatio: number
  /// Mean days from reservation to move-in, over CONVERTED reservations only.
  /// Null when none converted — an average over an empty set is not zero, and
  /// showing 0.0 days would read as "they move in the same day".
  averageDaysToMoveIn: number | null
}

/// US-39.3's conversion half: what share of holds became rentals, and how
/// long they took.
export function reservationConversion(
  reservations: readonly ReservationOutcome[],
): ConversionResult {
  const converted = reservations.filter((r) => r.convertedAt !== null)
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  const totalDays = converted.reduce(
    (total, r) => total + (r.convertedAt!.getTime() - r.createdAt.getTime()) / MS_PER_DAY,
    0,
  )

  return {
    reservations: reservations.length,
    converted: converted.length,
    conversionRatio: reservations.length === 0 ? 0 : converted.length / reservations.length,
    averageDaysToMoveIn: converted.length === 0 ? null : totalDays / converted.length,
  }
}
