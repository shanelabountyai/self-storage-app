// PRD 02 US-39: "date-range selection", on every report.
//
// One parser, used by both the screen and its CSV route — because US-39's
// "CSV export matching on-screen data exactly" is only true if the export
// cannot interpret the same query string differently from the page.
//
// Half-open: `start` inclusive, `end` exclusive, matching the billing periods
// (packages/core/billing/periods.ts). A closed range would either double-count
// the boundary day between two consecutive months or skip it, depending on
// which way somebody rounded, and both are the kind of error that shows up as
// "the quarter doesn't add up to the three months".

export type ReportRange = {
  start: Date
  /// Exclusive. The day AFTER the last day the user picked.
  end: Date
  /// The `to` value as the user typed it, for round-tripping the form.
  fromValue: string
  toValue: string
  label: string
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/// The range for a request, defaulting to the current calendar month.
///
/// An unparseable or backwards range falls back to the default rather than
/// erroring: a report is a read-only screen, and a 500 from a hand-edited URL
/// helps nobody. The form shows what was actually used.
export function reportRange(params: { from?: string; to?: string }, now: Date = new Date()): ReportRange {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  const from = parseDay(params.from) ?? monthStart
  // The user picks the last day they want included; the exclusive end is the
  // next day. Getting this backwards silently drops the last day of every
  // month-long range, which nobody notices until a year-end total is short.
  const toInclusive = parseDay(params.to) ?? new Date(monthEnd.getTime() - 86_400_000)
  const end = new Date(toInclusive.getTime() + 86_400_000)

  if (end <= from) return reportRange({}, now)

  return {
    start: from,
    end,
    fromValue: isoDay(from),
    toValue: isoDay(toInclusive),
    label: `${formatDay(from)} – ${formatDay(toInclusive)}`,
  }
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
