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
/// `timeZones` are the zones of every facility in scope, and a month is
/// complete only when it is complete in **all** of them — so the reckoning is
/// done against the westernmost, which is simply the earliest local date among
/// them (B-223). No offset arithmetic: `businessDateFor` already answers "what
/// day is it there", and the smallest answer is the one that has advanced
/// least.
///
/// This is what "pass a timezone" could not do. A report spans every facility
/// the actor may read, which can be several zones, and picking one — the
/// operator's own, or the first in the list — would make two staff reading the
/// same URL see different months. Correct-by-construction instead: the figures
/// come from all of these sites, so the window closes when the last of them
/// closes it.
///
/// An empty list falls back to UTC, which is the old behaviour and is right for
/// the only case that reaches it: an actor who can report on no facility has no
/// figures for the range to be wrong about.
///
/// The management pack does NOT go through here — it has one facility by
/// construction and reckons its own month in that facility's zone.
///
/// An unparseable or backwards range falls back to the default rather than
/// erroring: a report is a read-only screen, and a 500 from a hand-edited URL
/// helps nobody. The form shows what was actually used.
export type ReportRangeOptions = {
  now?: Date
  /// The zones of every facility in scope. A COMPLETE month is reckoned
  /// against the westernmost of them (see the note above); a rolling LOG
  /// window is reckoned against the easternmost, UTC included, because it is
  /// asking the opposite question. See `DefaultWindow` and B-271.
  timeZones?: readonly string[]
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
///
/// The two windows are reckoned against OPPOSITE ends of the portfolio, and
/// that is not an inconsistency — they ask opposite questions. "Has this month
/// finished?" is answered by the site that has advanced least; "does this
/// window still hold what just happened?" is answered by the one that has
/// advanced most, with UTC among the candidates because the rows themselves are
/// UTC instants. B-271.
///
/// KNOWN, and deliberately NOT changed here (B-271 audit): `last-complete-month`
/// bounds a local month with UTC midnights, so for a US portfolio the last few
/// local hours of a month land in the NEXT month's report and the same hours of
/// the previous month are pulled into this one. That is a boundary
/// MISCLASSIFICATION, not the rolling window's blind spot: every row still
/// falls in exactly one window, consecutive ranges still tile with nothing
/// counted twice or skipped, so a year still sums. Correcting it means bounding
/// the month in ONE zone, which is the choice B-223 rejected on purpose.
export type DefaultWindow = 'last-complete-month' | 'rolling-30-days'

export function reportRange(
  params: { from?: string; to?: string },
  options: ReportRangeOptions = {},
): ReportRange {
  const { now = new Date(), timeZones, window = 'last-complete-month' } = options

  // The facility-local calendar date first, then the month off that — reading
  // `getUTCMonth()` on the raw instant is what made the pack show a month that
  // had not ended yet (B-220 defect 1). `businessDateFor` returns UTC midnight
  // of the local date, so the UTC getters below are correct on its result.
  //
  // B-223: the EARLIEST of those dates across every facility in scope, which is
  // the westernmost one. A month is complete only when it is complete
  // everywhere the figures come from, and taking the minimum says exactly that
  // without computing a single UTC offset.
  const zones = timeZones && timeZones.length > 0 ? timeZones : ['UTC']
  const localDates = zones.map((zone) => businessDateFor(now, zone))

  // A COMPLETE month is reckoned against the site that has advanced LEAST — the
  // westernmost, which is just the earliest local date (B-223, above).
  //
  // A rolling LOG is the opposite question and so takes the opposite end. It
  // does not ask "has the period finished everywhere", it asks "does the window
  // still contain what just happened", and the answer has to hold in the
  // coordinate the rows are actually stored in — which is UTC, not any
  // facility's local date. So UTC joins the reckoning and the LATEST date wins.
  //
  // B-271: it used to take the earliest date for both, and add a day to that
  // for the rolling end. That adds a day to a LOCAL date and then lets the
  // result be read as a UTC instant, so for every hour the local date lags the
  // UTC one — 00:00–05:00 UTC for Texas, wider further west — the "exclusive
  // end" was already in the PAST and the log hid the rows written in the hours
  // the operator opened it to look at. Because `max` includes the UTC date, the
  // end below is always strictly after `now`, which is the property that
  // matters and the one the old arithmetic could not state.
  const today =
    window === 'rolling-30-days'
      ? [...localDates, businessDateFor(now, 'UTC')].reduce((latest, date) =>
          date > latest ? date : latest,
        )
      : localDates.reduce((earliest, date) => (date < earliest ? date : earliest))

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
