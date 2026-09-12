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
//
// Both ends are real INSTANTS at facility-local midnight (B-297), not UTC
// midnight. They used to be UTC midnight, which is right for a column holding a
// business DATE and wrong for one holding a timestamp: a payment taken at 8pm
// on 31 August in Texas is `2026-09-01T01:00Z`, so a September window opening at
// `2026-09-01T00:00Z` reported August's money in September. `zonedMidnight` is
// the same conversion `monthBounds` has always used for a tenant statement, and
// its own comment names this exact payment.
//
// The mirror of that bug was live at the other caller. The management pack and
// the accounting close pass `monthBounds` — already instants — into the very
// same `facilityRevenue`, whose `issueDate` filter reads a business date stored
// at UTC midnight. September's close therefore excluded the invoices issued on
// 1 September and counted the ones issued on 1 October, which for a portfolio
// that bills on the 1st is a whole rent cycle in the wrong month. One kind of
// bound cannot serve both kinds of column, so the rule is now explicit:
//
//   **These bounds are instants. A query filtering a DATE or a business-date
//   column converts them with `businessDateFor(bound, facility.timezone)`.**
//
// That round trip is exact for every facility, not just the one the range was
// reckoned in — an instant at some zone's local midnight is inside the same
// local calendar day everywhere, because no two zones are 24 hours apart.

import { businessDateFor, zonedMidnight } from '@storage/core/jobs'

export type ReportRange = {
  /// A real INSTANT: facility-local midnight on the first day of the range.
  /// See the note on the return value below for what that means for a query.
  start: Date
  /// Exclusive. Facility-local midnight on the day AFTER the last day picked.
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
  /// The zones of every facility in scope. The month is reckoned against the
  /// westernmost of them. See the note above.
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
  const today = zones
    .map((zone) => businessDateFor(now, zone))
    .reduce((earliest, date) => (date < earliest ? date : earliest))
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
  const dayAfter = new Date(toInclusive.getTime() + 86_400_000)

  if (dayAfter <= from) return reportRange({}, options)

  // ONE zone for both ends, so consecutive ranges tile exactly — a start taken
  // in the easternmost zone and an end in the westernmost would count the
  // boundary hours twice, which is the failure the note at the top of this file
  // exists to prevent. The westernmost is the zone whose local midnight falls
  // latest in UTC, which is the same site B-223 already reckons the month
  // against and is deterministic, unlike "the zone with the earliest local
  // date" — that is a tie for most of the day and would pick an arbitrary one.
  //
  // For a portfolio spanning zones the instant boundaries are therefore exact
  // only at the westernmost site; elsewhere up to the offset difference of
  // activity lands in the neighbouring month. A single range cannot do better
  // than that, and widening to the union would double-count instead.
  const zone = westernmost(zones, from)

  // B-296's clamp of the exclusive end to `now` is gone with the cause. It
  // existed because a UTC-midnight end sat BEHIND the wall clock for the five
  // hours between UTC midnight and Texas midnight, so /admin/impersonation's
  // "last 30 days" stopped before a session started 42 minutes earlier. A
  // local-midnight end for a window that includes today is tomorrow at the
  // westernmost site, which is always still ahead.

  return {
    start: localMidnight(from, zone),
    end: localMidnight(dayAfter, zone),
    fromValue: isoDay(from),
    toValue: isoDay(toInclusive),
    label: `${formatDay(from)} – ${formatDay(toInclusive)}`,
  }
}

/// `zonedMidnight` for the UTC-midnight calendar dates this file carries.
function localMidnight(day: Date, zone: string): Date {
  return zonedMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), zone)
}

/// The westernmost of the zones on a given date: the one whose local midnight
/// falls latest in UTC. See the note at the call site for why it is one zone.
function westernmost(zones: readonly string[], on: Date): string {
  return zones.reduce((west, zone) =>
    localMidnight(on, zone) > localMidnight(on, west) ? zone : west,
  )
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
