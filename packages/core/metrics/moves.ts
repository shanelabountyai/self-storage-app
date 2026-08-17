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

/// B-082 part 1. The MARKETING channel a move-in is credited to — a different
/// axis from `MoveSource` above, not more values on it.
///
/// `source` answers "how was the deal taken" (web, phone, walk-in). This
/// answers "where did the renter come from" (aggregator, paid search, organic).
/// A SpareFoot rental is `web` AND `aggregator`; folding the two axes into one
/// column is what made every marketplace move-in report as plain `web`, hiding
/// the only channel in this industry that charges per completed move-in inside
/// the bucket an owner reads as "our own website earned this".
///
/// The vocabulary is `MARKETING_CHANNELS` from @storage/core/marketing, plus
/// `unknown` for a lease that predates capture. Kept as a plain string list
/// rather than an import so this module stays dependency-free like the rest of
/// metrics; `normalizeChannel` is the only place the two must agree, and the
/// test asserts they do.
export const MOVE_CHANNELS = [
  'paid_search',
  'paid_social',
  'organic',
  'organic_social',
  'email',
  'referral',
  'aggregator',
  'direct',
  'phone',
  'walk_in',
  'referral_tenant',
  'unknown',
] as const
export type MoveChannel = (typeof MOVE_CHANNELS)[number]

export function normalizeChannel(channel: string | null | undefined): MoveChannel {
  if (!channel) return 'unknown'
  return (MOVE_CHANNELS as readonly string[]).includes(channel) ? (channel as MoveChannel) : 'unknown'
}

export type MoveEvent = { source: MoveSource; channel: MoveChannel }

export type MoveCounts = {
  moveIns: number
  moveOuts: number
  /// moveIns − moveOuts. Negative is a real and important answer; a site
  /// losing four units a month needs that on the screen, not clamped to zero.
  net: number
  bySource: Record<MoveSource, number>
  /// B-082 part 1. Same move-ins, split the other way. Both totals equal
  /// `moveIns` — that is what makes the two axes comparable rather than two
  /// unrelated numbers on one screen.
  byChannel: Record<MoveChannel, number>
}

function emptyBySource(): Record<MoveSource, number> {
  return { web: 0, phone: 0, walk_in: 0, referral: 0, drive_by: 0, unknown: 0 }
}

function emptyByChannel(): Record<MoveChannel, number> {
  return Object.fromEntries(MOVE_CHANNELS.map((channel) => [channel, 0])) as Record<
    MoveChannel,
    number
  >
}

/// Counts move-ins and move-outs in a period. `bySource` and `byChannel` cover
/// move-INS only: a move-out has no acquisition channel, and attributing one
/// would invent data.
export function moveCounts(
  moveIns: readonly MoveEvent[],
  moveOutCount: number,
): MoveCounts {
  const bySource = emptyBySource()
  const byChannel = emptyByChannel()
  for (const move of moveIns) {
    bySource[move.source] += 1
    byChannel[move.channel] += 1
  }

  return {
    moveIns: moveIns.length,
    moveOuts: moveOutCount,
    net: moveIns.length - moveOutCount,
    bySource,
    byChannel,
  }
}

export function sumMoveCounts(counts: readonly MoveCounts[]): MoveCounts {
  const bySource = emptyBySource()
  const byChannel = emptyByChannel()
  for (const count of counts) {
    for (const source of MOVE_SOURCES) bySource[source] += count.bySource[source]
    for (const channel of MOVE_CHANNELS) byChannel[channel] += count.byChannel[channel]
  }
  const moveIns = counts.reduce((total, c) => total + c.moveIns, 0)
  const moveOuts = counts.reduce((total, c) => total + c.moveOuts, 0)
  return { moveIns, moveOuts, net: moveIns - moveOuts, bySource, byChannel }
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
