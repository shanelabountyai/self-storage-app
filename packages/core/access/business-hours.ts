import { DAYS_OF_WEEK, type WeeklySchedule } from '../facility-settings/weekly-schedule.ts'
import { localReading } from './gate-hours.ts'

// PRD 03 US-6 AC2 (B-065): "Overdue manual tasks (configurable, default 4
// **business hours**) escalate in the dashboard."
//
// Business hours, not elapsed hours, and the difference is the whole point. A
// manual gate task raised at 6pm on Friday is not four hours overdue at 10pm
// on Friday — nobody is there. Counting wall-clock hours would escalate every
// task raised after closing, every day, and a queue that shouts on every
// overnight item is one staff learn to scroll past.
//
// Counted against the facility's own `officeHours` (when a human is behind the
// desk), never `gateHours` (when a tenant can reach their unit). Those are
// different schedules for a reason.

const MS_PER_MINUTE = 60_000
const MINUTES_PER_DAY = 24 * 60

/// How many business minutes elapse between two instants, per the schedule.
///
/// Walks a minute-resolution day at a time rather than integrating over
/// intervals: a storage facility's SLA is measured in hours, the window this is
/// ever asked about is days rather than years, and the arithmetic that would
/// make it clever is the arithmetic that gets DST wrong. `localReading` is
/// asked afresh for each day boundary, so a span crossing a transition is
/// counted with the rules that applied on each side.
export function businessMinutesBetween(
  schedule: WeeklySchedule | null,
  from: Date,
  to: Date,
  timezone: string,
): number {
  if (to <= from) return 0
  // No schedule configured means no way to tell open from shut, so every hour
  // counts. The alternative — treating an unset schedule as permanently closed
  // — would mean nothing ever escalates, which is the silent-failure direction.
  if (!schedule) return Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE)

  let minutes = 0
  // A hard stop, not a correctness bound: 400 days of minute-stepping is
  // already far outside anything this is asked, and an unbounded loop over a
  // corrupt date is worse than an undercount.
  const maxSteps = 400 * MINUTES_PER_DAY
  let steps = 0

  let cursor = from.getTime()
  const end = to.getTime()

  while (cursor < end && steps < maxSteps) {
    const reading = localReading(new Date(cursor), timezone)
    const day = schedule[reading.day]

    if (day.closed) {
      // Skip to the next local midnight rather than minute by minute.
      cursor += (MINUTES_PER_DAY - reading.minutes) * MS_PER_MINUTE
      steps += MINUTES_PER_DAY - reading.minutes
      continue
    }

    const opens = toMinutes(day.open)
    const closes = toMinutes(day.close)

    if (reading.minutes < opens) {
      cursor += (opens - reading.minutes) * MS_PER_MINUTE
      steps += opens - reading.minutes
      continue
    }
    if (reading.minutes >= closes) {
      cursor += (MINUTES_PER_DAY - reading.minutes) * MS_PER_MINUTE
      steps += MINUTES_PER_DAY - reading.minutes
      continue
    }

    // Inside the open window: count the rest of it, or the rest of the span,
    // whichever ends first.
    const untilClose = closes - reading.minutes
    const untilEnd = Math.ceil((end - cursor) / MS_PER_MINUTE)
    const counted = Math.min(untilClose, untilEnd)
    minutes += counted
    cursor += counted * MS_PER_MINUTE
    steps += counted
  }

  return minutes
}

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number)
  return hour * 60 + minute
}

/// Whether a task raised at `createdAt` has blown its business-hours SLA.
export function isOverdue(input: {
  schedule: WeeklySchedule | null
  createdAt: Date
  now: Date
  slaHours: number
  timezone: string
}): boolean {
  if (input.slaHours <= 0) return false
  return (
    businessMinutesBetween(input.schedule, input.createdAt, input.now, input.timezone) >=
    input.slaHours * 60
  )
}

/// A facility that is closed every day of the week. Business-hours arithmetic
/// against this can never advance, so `isOverdue` is always false — which is
/// correct and is why the check above is on the schedule, not on the clock.
export function neverOpens(schedule: WeeklySchedule | null): boolean {
  return schedule !== null && DAYS_OF_WEEK.every((day) => schedule[day].closed)
}
