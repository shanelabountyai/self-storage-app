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

import { businessDateFor } from '@storage/core/jobs'

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

/// The range for a request, defaulting to the LAST COMPLETE calendar month
/// (D-109).
///
/// It used to default to the current calendar month, which meant every report
/// opened on the 1st with a window nothing had happened in yet: on 2026-09-01
/// `/admin/reports/promotions` rendered "No promotions were redeemed in this
/// range" against a campaign that had been discounting invoices all August, and
/// an operator has no way to tell that screen from a broken report (B-220).
/// A complete month also ties out — it is the same window the management pack
/// and the accounting close use, so a figure read here and a figure read there
/// are about the same days.
///
/// `timeZone` is the zone the calendar month is reckoned in. **Most callers
/// cannot supply one and should not pretend to**: a report spans every facility
/// the actor may read, which can be several zones, and none of the seven report
/// pages resolves a single facility at all — they take an actor, not a site. So
/// the default is UTC and the residual is named rather than hidden: for the few
/// hours between UTC midnight and facility-local midnight on the 1st, this
/// calls a month complete that is still running at a US facility. That is a
/// smaller window than the defect it replaces, and B-223 owns closing it.
/// The management pack does NOT go through here — it has one facility by
/// construction and reckons its own month in that facility's zone.
///
/// An unparseable or backwards range falls back to the default rather than
/// erroring: a report is a read-only screen, and a 500 from a hand-edited URL
/// helps nobody. The form shows what was actually used.
export type ReportRangeOptions = {
  now?: Date
  /// The zone the calendar month is reckoned in. See the note above.
  timeZone?: string
  /// Which default applies when the URL names no range. See `DefaultWindow`.
  window?: DefaultWindow
}

/// `last-complete-month` is D-109's answer for a REPORT: a window that ties out
/// against the management pack and the accounting close.
///
/// `rolling-30-days` is for a live ACTIVITY LOG, where the point is what has
/// just happened. `/admin/access` ("Gate activity") and `/admin/impersonation`
/// ("Support sessions") are the two, and applying the report default to them
/// was a worse defect than the one D-109 fixed: an owner opening the support-
/// session log to see who is in a tenant's account right now would have been
/// shown a month that ended before the session started. `impersonation.spec.ts`
/// caught exactly that. Neither screen is ever read beside a report, and
/// neither has to tie out to a billing period, so the objection that sank
/// "split by report type" in D-109 does not reach them.
export type DefaultWindow = 'last-complete-month' | 'rolling-30-days'

export function reportRange(
  params: { from?: string; to?: string },
  options: ReportRangeOptions = {},
): ReportRange {
  const { now = new Date(), timeZone = 'UTC', window = 'last-complete-month' } = options

  // The facility-local calendar date first, then the month off that — reading
  // `getUTCMonth()` on the raw instant is what made the pack show a month that
  // had not ended yet (B-220 defect 1). `businessDateFor` returns UTC midnight
  // of the local date, so the UTC getters below are correct on its result.
  const today = businessDateFor(now, timeZone)
  const monthStart =
    window === 'rolling-30-days'
      ? new Date(today.getTime() - 29 * 86_400_000)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  // Exclusive, and for the rolling window that is tomorrow — a log whose
  // default stopped at midnight today would hide the event the operator opened
  // it to look at.
  const monthEnd =
    window === 'rolling-30-days'
      ? new Date(today.getTime() + 86_400_000)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  const from = parseDay(params.from) ?? monthStart
  // The user picks the last day they want included; the exclusive end is the
  // next day. Getting this backwards silently drops the last day of every
  // month-long range, which nobody notices until a year-end total is short.
  const toInclusive = parseDay(params.to) ?? new Date(monthEnd.getTime() - 86_400_000)
  const end = new Date(toInclusive.getTime() + 86_400_000)

  if (end <= from) return reportRange({}, options)

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
