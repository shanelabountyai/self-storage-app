import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type WeeklySchedule,
} from '../facility-settings/weekly-schedule.ts'

// PRD 03 US-4 / FR-5 (B-064). Is the gate open right now?
//
// AC4: "All hours logic uses the facility's IANA timezone; DST transitions
// covered by tests." That sentence is the whole reason this file is separate
// from the schedule shape it reads.
//
// The trap it exists to avoid is a UTC-offset cache. A facility on
// America/Chicago is UTC-5 in July and UTC-6 in January, so any code that
// computes "local hour" by subtracting a stored offset is correct for about
// eight months of the year and silently locks every tenant out an hour early —
// or lets them in an hour late — for the other four. It also gets the two
// transition days themselves wrong in both directions.
//
// So the offset is never stored or derived. Every evaluation asks
// `Intl.DateTimeFormat` what the wall clock reads in that zone at that instant,
// which is the only source that knows the rules and knows when they changed.

/// A facility-local wall-clock reading: the day of week and the minutes past
/// midnight, in the facility's own timezone at the given instant.
export type LocalReading = {
  day: DayOfWeek
  minutes: number
  /// `HH:MM`, for messages a person reads.
  clock: string
}

// `weekday: 'short'` gives 'Mon'…'Sun' under en-US regardless of the host's
// locale, because the locale is pinned. Reading a localised long name and
// matching it against English keys is the classic way this breaks on a machine
// configured in another language.
const WEEKDAY_KEYS: Record<string, DayOfWeek> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    formatterCache.set(timezone, formatter)
  }
  return formatter
}

/// What the clock on the wall at the facility says.
///
/// Caching the *formatter* (not an offset) is safe: an `Intl.DateTimeFormat`
/// applies the zone's full rules to whatever instant it is handed, so the same
/// cached object gives the right answer in January and in July.
export function localReading(at: Date, timezone: string): LocalReading {
  const parts = formatterFor(timezone).formatToParts(at)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''

  const day = WEEKDAY_KEYS[get('weekday')] ?? 'monday'
  // `hour12: false` yields '24' for midnight in some ICU versions rather than
  // '00'. Normalising is one line; not normalising puts midnight an entire day
  // out of range and reads as 1440 minutes past midnight.
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))

  return {
    day,
    minutes: hour * 60 + minute,
    clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number)
  return hour * 60 + minute
}

export type GateHoursDecision =
  | { open: true }
  | { open: false; because: 'closed_today' | 'outside_hours'; opens?: string; closes?: string }

/// Whether the gate is open at `at`, per the facility's weekly schedule.
///
/// The window is half-open — `open` inclusive, `close` exclusive — so a gate
/// that closes at 22:00 denies at exactly 22:00. The alternative reads more
/// generously and is worse: "closes at 10pm" that admits someone at 10pm sharp
/// is a promise the sign on the fence does not make.
///
/// A schedule of `null` means **open**, not closed. A facility that has never
/// configured gate hours has not opted into enforcement, and defaulting the
/// other way would lock every tenant out of every unconfigured facility the
/// moment this shipped. Enforcement is something an operator turns on by
/// filling the form in.
export function gateHoursDecision(
  schedule: WeeklySchedule | null,
  at: Date,
  timezone: string,
): GateHoursDecision {
  if (!schedule) return { open: true }

  const reading = localReading(at, timezone)
  const today = schedule[reading.day]
  if (!today || today.closed) return { open: false, because: 'closed_today' }

  const opens = toMinutes(today.open)
  const closes = toMinutes(today.close)
  if (reading.minutes >= opens && reading.minutes < closes) return { open: true }

  return {
    open: false,
    because: 'outside_hours',
    opens: today.open,
    closes: today.close,
  }
}

/// AC3's per-grant extended-hours override: 24-hour access, sold as an add-on.
///
/// A boolean rather than a per-grant schedule, deliberately. "24h access" is
/// the product a storage facility actually sells; a second full schedule per
/// tenant would be a configuration surface with no customer behind it, and
/// every one of them would drift out of step with the facility's own hours.
export function accessDecision(
  input: { schedule: WeeklySchedule | null; extendedHours: boolean },
  at: Date,
  timezone: string,
): GateHoursDecision {
  if (input.extendedHours) return { open: true }
  return gateHoursDecision(input.schedule, at, timezone)
}

/// A sentence for a tenant or a manager, never a raw reason code.
export function describeGateHours(decision: GateHoursDecision, timezone: string): string {
  if (decision.open) return 'The gate is open.'
  if (decision.because === 'closed_today') {
    return 'The gate is closed today.'
  }
  return `The gate is open ${decision.opens}–${decision.closes} (${timezone.split('/').pop()?.replace(/_/g, ' ')} time).`
}

/// Whether a schedule leaves the gate open at every minute of every day.
///
/// Used to skip pointless enforcement: a facility configured 00:00–23:59 seven
/// days a week has effectively no restriction, and telling the vendor about a
/// window it can never fail is noise in the command queue.
export function isAlwaysOpen(schedule: WeeklySchedule | null): boolean {
  if (!schedule) return true
  return DAYS_OF_WEEK.every((day) => {
    const entry = schedule[day]
    return !entry.closed && entry.open === '00:00' && entry.close === '23:59'
  })
}
