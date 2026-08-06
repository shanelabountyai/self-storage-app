// Nightly jobs run in facility-local time (PRD 02 FR-4), but cron fires in UTC.
// The bridge is: run the dispatcher every hour, and each hour ask which
// facilities have just reached their target local hour.
//
// Doing it this way is DST-safe for free — Intl resolves the offset for the
// actual instant, so the 2am that does not exist in spring and the 1am that
// happens twice in autumn both land on exactly one run.

/// Facility-local wall-clock parts for an instant.
export function localParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  // Intl renders midnight as hour 24 in some environments.
  const hour = get('hour') % 24

  return { year: get('year'), month: get('month'), day: get('day'), hour }
}

/// The facility-local calendar date for an instant, as a UTC-midnight Date.
/// Stored in JobRun.businessDate, which is a DATE column — the time component
/// is meaningless and deliberately zeroed.
export function businessDateFor(instant: Date, timezone: string): Date {
  const { year, month, day } = localParts(instant, timezone)
  return new Date(Date.UTC(year, month - 1, day))
}

/// Whole days between two business dates (both UTC-midnight, as
/// `businessDateFor` returns). Exact integer arithmetic, not a duration —
/// business dates carry no time component and no offset, so there is no DST
/// hour to lose.
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/// Which reminder threshold a countdown has reached, or null if none has.
///
/// Given thresholds in days (any order), returns the SMALLEST one that
/// `daysUntil` has fallen to or below — so a card 20 days out is at the 30-day
/// stage, one 5 days out is at the 7-day stage, and one already expired stays
/// at 7 rather than falling off the end. Callers dedupe on the returned stage,
/// which is what stops a "within 30 days" scan from re-sending every night for
/// a month (PRD 05 CN-10a: notice at 30, retrigger at 7 — two sends, not
/// thirty).
export function reminderStage(daysUntil: number, thresholds: readonly number[]): number | null {
  let stage: number | null = null
  for (const threshold of thresholds) {
    if (daysUntil > threshold) continue
    if (stage === null || threshold < stage) stage = threshold
  }
  return stage
}

export type SchedulableFacility = { id: string; timezone: string }

/// Facilities whose local time is currently the target hour. Called once per
/// hourly cron tick; each facility matches exactly once per local day.
export function facilitiesDueAt<T extends SchedulableFacility>(
  facilities: readonly T[],
  targetLocalHour: number,
  now: Date,
): { facility: T; businessDate: Date }[] {
  return facilities
    .filter((facility) => localParts(now, facility.timezone).hour === targetLocalHour)
    .map((facility) => ({
      facility,
      businessDate: businessDateFor(now, facility.timezone),
    }))
}

function tzOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - instant.getTime()
}

// ponytail: approximates local midnight using the zone's offset at the UTC-
// guess instant, which can be off by the DST shift (~1h) on the two transition
// days a year. Fine for a "what happened today" dashboard tile; never use this
// for billing math — invoice due dates need the exact-day guarantees in
// facilitiesDueAt/businessDateFor instead.
export function localDayBounds(instant: Date, timezone: string): { start: Date; end: Date } {
  const { year, month, day } = localParts(instant, timezone)
  const utcGuess = new Date(Date.UTC(year, month - 1, day))
  const offset = tzOffsetMs(utcGuess, timezone)
  const start = new Date(utcGuess.getTime() - offset)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

/// Business dates between the last completed run and now, so a job that missed
/// ticks during an outage can be caught up rather than silently skipped
/// (PRD 02 FR-4, FR-14).
export function missedBusinessDates(
  lastCompleted: Date | null,
  through: Date,
  timezone: string,
  maxDays = 30,
): Date[] {
  const target = businessDateFor(through, timezone)
  if (!lastCompleted) return [target]

  const dates: Date[] = []
  const cursor = new Date(businessDateFor(lastCompleted, timezone))
  cursor.setUTCDate(cursor.getUTCDate() + 1)

  while (cursor <= target && dates.length < maxDays) {
    dates.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}
