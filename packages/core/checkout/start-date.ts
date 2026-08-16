// PRD 01 §9 Phase 2 (B-106). When a checkout's move-in may be scheduled for.
//
// Pure, so the page, the action and the tests all judge a date the same way —
// and so the SUGGESTION can be computed without a database.

export type StartDateWindow = {
  /// The earliest allowed move-in, facility-local. Today: a lease cannot begin
  /// before the money that starts it.
  earliest: Date
  /// The latest, from the facility's own `maxCheckoutStartDaysAhead`.
  latest: Date
}

export type StartDateVerdict =
  | { ok: true; startDate: Date }
  /// Refused, WITH the date to use instead.
  ///
  /// The suggestion is the whole point and the row states it as an acceptance
  /// criterion: "a notice-rule violation carries a *suggestion*, not just a
  /// refusal (3.3.3)". An error that says only "that date is not allowed"
  /// leaves the renter guessing at a boundary they cannot see, on the screen
  /// between them and paying — and 3.3.3 asks for a correction to be
  /// suggested whenever one is known. Here one always is: the window has two
  /// ends and the violated one names its own fix.
  | { ok: false; reason: 'too_early' | 'too_late' | 'unparseable'; message: string; suggested: Date }

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/// The window, from the facility's setting and the facility-local today.
///
/// Takes the local date as a string (`YYYY-MM-DD`, what `businessDateFor`
/// produces) rather than an instant, because "today" at a facility is a
/// calendar question: at 10pm in Texas the UTC date is already tomorrow, and a
/// renter told they cannot pick today would be reading a timezone bug.
export function startDateWindow(localToday: string, maxDaysAhead: number): StartDateWindow {
  const earliest = new Date(`${localToday}T00:00:00.000Z`)
  return { earliest, latest: addDays(earliest, Math.max(0, maxDaysAhead)) }
}

/// Judges a submitted date against the window.
export function judgeStartDate(raw: string, window: StartDateWindow): StartDateVerdict {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, startDate: window.earliest }

  // `<input type="date">` submits `YYYY-MM-DD`, but the row requires manual
  // text entry to work too — so anything the browser accepts as a date has to
  // be judged rather than assumed well-formed.
  const parsed = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      reason: 'unparseable',
      message: `Enter the date as year-month-day, like ${isoDate(window.earliest)}.`,
      suggested: window.earliest,
    }
  }

  const day = startOfDayUtc(parsed)
  if (day.getTime() < window.earliest.getTime()) {
    return {
      ok: false,
      reason: 'too_early',
      message: `A move-in cannot start before today. The earliest you can pick is ${isoDate(window.earliest)}.`,
      suggested: window.earliest,
    }
  }
  if (day.getTime() > window.latest.getTime()) {
    return {
      ok: false,
      reason: 'too_late',
      // Names the boundary AND the date, because "too far ahead" without a
      // number is a refusal the renter has to bisect their way past.
      message: `We can schedule a move-in up to ${daysBetween(window.earliest, window.latest)} days ahead. The latest you can pick is ${isoDate(window.latest)}.`,
      suggested: window.latest,
    }
  }

  return { ok: true, startDate: day }
}

/// `YYYY-MM-DD`, which is both what `<input type="date">` wants and what a
/// person reading an error message can type back.
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
