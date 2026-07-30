// The shape stored in Facility.officeHours and Facility.gateHours (Json
// columns, left undefined until this item per the B-002 scope note). PRD 03
// FR-5's per-facility weekly schedule + holiday exceptions and per-grant
// overrides build on top of this in B-064 — this is just the flat weekly
// shape both office and gate hours share.

export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

export type DaySchedule = { closed: true } | { closed: false; open: string; close: string }

export type WeeklySchedule = Record<DayOfWeek, DaySchedule>

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isValidDaySchedule(value: unknown): value is DaySchedule {
  if (typeof value !== 'object' || value === null) return false
  const day = value as Record<string, unknown>
  if (day.closed === true) return true
  return (
    day.closed === false &&
    typeof day.open === 'string' &&
    typeof day.close === 'string' &&
    TIME_PATTERN.test(day.open) &&
    TIME_PATTERN.test(day.close) &&
    day.open < day.close
  )
}

/// Returns null rather than throwing on malformed input — callers decide
/// whether that means "reject the write" or "treat as unset" (a Facility with
/// no hours configured yet reads as null, not an error).
export function parseWeeklySchedule(value: unknown): WeeklySchedule | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  for (const day of DAYS_OF_WEEK) {
    if (!isValidDaySchedule(record[day])) return null
  }
  return record as WeeklySchedule
}

export const CLOSED_ALL_WEEK: WeeklySchedule = Object.fromEntries(
  DAYS_OF_WEEK.map((day) => [day, { closed: true }]),
) as WeeklySchedule
