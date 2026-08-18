import { monthBounds } from '../billing/statements.ts'
import { zonedMidnight } from '../jobs/schedule.ts'

// PRD 02 US-40 (B-084 part 3). When a scheduled report goes out, and what
// window it covers.
//
// Pure, and deliberately separate from the sending: "is today the day, and
// which days does it report on" is the part with the edge cases, and it should
// be testable without a database, a clock or an outbox.

export const REPORT_CADENCES = ['daily', 'weekly', 'monthly'] as const
export type ReportCadence = (typeof REPORT_CADENCES)[number]

export const CADENCE_LABELS: Readonly<Record<ReportCadence, string>> = {
  daily: 'Every morning',
  weekly: 'Monday mornings',
  monthly: 'On the 1st of the month',
}

/// The half-open window a send covers, and a name for it.
export type ReportPeriod = {
  start: Date
  /// Exclusive, so consecutive periods tile with no day counted twice.
  end: Date
  /// What the email calls the period: "Monday 17 August", "the week to …",
  /// "July 2026". Also the idempotency key's period part, so it has to be
  /// stable for a given cadence and send date.
  key: string
  label: string
}

/// Whether a cadence sends on this facility-local date.
///
/// Every cadence reports on the period that has just FINISHED, so a daily runs
/// every day about yesterday, a weekly runs on Monday about the week before,
/// and a monthly runs on the 1st about last month. Reporting on a period still
/// in progress is how a figure gets quoted and then changes.
export function sendsOn(
  cadence: ReportCadence,
  local: { year: number; month: number; day: number },
): boolean {
  if (cadence === 'daily') return true
  // 1 = Monday. The week that just ended is the one a Monday report is about.
  //
  // The weekday is computed from the facility-local CALENDAR date rather than
  // from an instant, which is why this takes y/m/d. `zonedMidnight(...).getUTCDay()`
  // would be wrong for any facility east of UTC, where local midnight falls on
  // the previous UTC day — "is it Monday here" is a question about the calendar,
  // not about an instant.
  if (cadence === 'weekly') return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() === 1
  return local.day === 1
}

/// The period a send on this local date covers.
///
/// `year`/`month`/`day` are the facility-local calendar date the job is running
/// on; the bounds come back as UTC instants at facility-local midnight, the
/// same convention every other period in this product uses — a payment taken at
/// 8pm on the last day belongs to that period.
export function periodFor(
  cadence: ReportCadence,
  local: { year: number; month: number; day: number },
  timezone: string,
): ReportPeriod {
  const todayStart = zonedMidnight(local.year, local.month, local.day, timezone)

  if (cadence === 'monthly') {
    // The month before the one we are standing in.
    const year = local.month === 1 ? local.year - 1 : local.year
    const month = local.month === 1 ? 12 : local.month - 1
    const bounds = monthBounds(year, month, timezone)
    return {
      start: bounds.start,
      end: bounds.end,
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: monthLabel(year, month),
    }
  }

  const days = cadence === 'weekly' ? 7 : 1
  // Counted back in whole facility-local days rather than by subtracting
  // milliseconds: a week containing a DST change is 167 or 169 hours long, and
  // a fixed-millisecond window would silently include or drop an hour of
  // payments at one end.
  const start = zonedMidnight(local.year, local.month, local.day - days, timezone)
  return {
    start,
    end: todayStart,
    key: isoDate(start),
    label:
      cadence === 'weekly'
        ? `the week to ${isoDate(new Date(todayStart.getTime() - 1))}`
        : isoDate(start),
  }
}

function isoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/// The key that makes a scheduled send happen exactly once per period.
///
/// There is no `lastSentAt` column, deliberately: `Message.idempotencyKey` is
/// already unique and `sendDirectEmail` already refuses a repeat, so a second
/// column tracking the same fact is a second thing that can disagree with it.
export function sendIdempotencyKey(subscriptionId: string, period: ReportPeriod): string {
  return `report:${subscriptionId}:${period.key}`
}
