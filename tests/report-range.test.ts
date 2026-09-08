import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reportRange } from '../apps/web/lib/admin/report-range'

// B-055 / PRD 02 US-39: "date-range selection", parsed once for the screen and
// its CSV route so the export cannot read the same query string differently.

const now = new Date('2026-04-17T18:30:00.000Z')

describe('reportRange', () => {
  // D-109 / B-220. Was "the current calendar month", which opened every report
  // on the 1st with a window nothing had happened in yet.
  it('defaults to the last COMPLETE calendar month', () => {
    const range = reportRange({}, { now })
    expect(range.fromValue).toBe('2026-03-01')
    expect(range.toValue).toBe('2026-03-31')
    // Exclusive end: the day AFTER the last day the user picked.
    expect(range.end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  // The defect this row exists for: on the 1st the old default was a window
  // zero days wide, so a report rendered its empty state against a month of
  // real activity and an operator could not tell it from a broken screen.
  it('is a whole month on the 1st, not a window nothing has happened in', () => {
    const range = reportRange({}, { now: new Date('2026-09-01T08:04:00.000Z') })
    expect(range.fromValue).toBe('2026-08-01')
    expect(range.toValue).toBe('2026-08-31')
  })

  // B-220 defect 1's shape, one level down. At 00:32 UTC on 1 September it is
  // still 19:32 on 31 August in Texas, so August has NOT ended there and the
  // last complete month is July. Reading the month off the raw instant is what
  // made the management pack offer a month that was still running.
  it('reckons the month in the timezone it is given', () => {
    const justAfterUtcMidnight = new Date('2026-09-01T00:32:00.000Z')
    expect(reportRange({}, { now: justAfterUtcMidnight }).fromValue).toBe('2026-08-01')
    expect(
      reportRange({}, { now: justAfterUtcMidnight, timeZones: ['America/Chicago'] }).fromValue,
    ).toBe('2026-07-01')
  })

  // B-223. A report spans every facility the actor may read, and those can be
  // in several zones. A month is complete only when it is complete in ALL of
  // them, so the reckoning follows the WESTERNMOST — which is just the earliest
  // local date among them.
  it('reckons a multi-zone portfolio against its westernmost facility', () => {
    // 00:32 UTC on 1 September: already September in London, still 31 August in
    // Chicago, still 31 August in Honolulu. The complete month is July, because
    // August has not finished at every site the figures come from.
    const justAfterUtcMidnight = new Date('2026-09-01T00:32:00.000Z')
    const zones = ['Europe/London', 'America/New_York', 'America/Chicago', 'Pacific/Honolulu']
    expect(reportRange({}, { now: justAfterUtcMidnight, timeZones: zones }).fromValue).toBe(
      '2026-07-01',
    )

    // Order must not matter — this is a minimum, not a first-one-wins.
    expect(
      reportRange({}, { now: justAfterUtcMidnight, timeZones: [...zones].reverse() }).fromValue,
    ).toBe('2026-07-01')

    // An all-London portfolio genuinely has finished August at that instant,
    // and is not held back by a facility it does not have.
    expect(
      reportRange({}, { now: justAfterUtcMidnight, timeZones: ['Europe/London'] }).fromValue,
    ).toBe('2026-08-01')
  })

  // Once every zone has crossed the boundary the answer is the same for all of
  // them, so the westernmost rule costs nothing for the other ~29 days.
  it('agrees with every zone once the month has ended everywhere', () => {
    const midMonth = new Date('2026-09-14T12:00:00.000Z')
    const zones = ['Europe/London', 'America/Chicago', 'Pacific/Honolulu']
    expect(reportRange({}, { now: midMonth, timeZones: zones }).fromValue).toBe('2026-08-01')
    expect(reportRange({}, { now: midMonth }).fromValue).toBe('2026-08-01')
  })

  // An actor who can report on no facility has no figures for the range to be
  // wrong about, so this is the old behaviour and stays it.
  it('falls back to UTC when there are no facilities in scope', () => {
    const justAfterUtcMidnight = new Date('2026-09-01T00:32:00.000Z')
    expect(reportRange({}, { now: justAfterUtcMidnight, timeZones: [] }).fromValue).toBe(
      '2026-08-01',
    )
  })

  // A January default must not land in month -1 of the same year.
  it('crosses the year boundary', () => {
    expect(reportRange({}, { now: new Date('2026-01-14T12:00:00.000Z') }).fromValue).toBe('2025-12-01')
  })

  // D-109's carve-out. A live log must include today: defaulting the support-
  // session screen to last complete month showed an owner a window that ended
  // before the session they opened it to check, which `impersonation.spec.ts`
  // caught.
  it('gives an activity log a rolling window that ends today', () => {
    const range = reportRange({}, { now, window: 'rolling-30-days' })
    expect(range.toValue).toBe('2026-04-17')
    expect(range.fromValue).toBe('2026-03-19')
    expect(range.end.getTime() - range.start.getTime()).toBe(30 * 86_400_000)
  })

  // B-271. The whole defect, and BOTH halves of the setup are load-bearing: a
  // facility zone AND a `now` inside 00:00-05:00 UTC. Drop either and this test
  // goes green against the unfixed code — which is why the original suite could
  // not see the bug at all. It passed a `now` of 18:30 UTC and no zones, and
  // with no zones the list falls back to UTC, the single configuration in which
  // adding a day to the local date happens to be right.
  //
  // 04:23 UTC on 6 September is 23:23 on the 5th in Texas. The old end was
  // `localDate + 1 day` = 2026-09-06T00:00Z, four hours and change BEFORE the
  // instant the operator is standing at, so an impersonation session opened at
  // 22:00 local was invisible on the screen that exists to catch it.
  it('does not end a live log in the past while the local date lags UTC', () => {
    const lateEvening = new Date('2026-09-06T04:23:00.000Z')
    const range = reportRange(
      {},
      { now: lateEvening, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )

    expect(range.end.getTime()).toBeGreaterThan(lateEvening.getTime())

    // Concretely: a session started at 22:00 local — 03:00 UTC, an hour and a
    // half before the operator opened the log — is inside the window.
    const session = new Date('2026-09-06T03:00:00.000Z')
    expect(session.getTime()).toBeGreaterThanOrEqual(range.start.getTime())
    expect(session.getTime()).toBeLessThan(range.end.getTime())

    // Still exactly thirty days, and still round-trippable as whole days: the
    // fix moves which date the window is anchored to, it does not turn the end
    // into an instant the operator cannot type back into a date input (which is
    // what clamping to `now` would have done).
    expect(range.end.getTime() - range.start.getTime()).toBe(30 * 86_400_000)
    expect(range.toValue).toBe('2026-09-06')
    expect(range.fromValue).toBe('2026-08-08')
    const again = reportRange(
      { from: range.fromValue, to: range.toValue },
      { now: lateEvening, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )
    expect(again.end.getTime()).toBe(range.end.getTime())
    expect(again.start.getTime()).toBe(range.start.getTime())
  })

  // The property the arithmetic could not state before, asserted as a property
  // rather than at the one instant that happened to catch it. There is no hour
  // of the day and no facility on earth for which a live log may end in the
  // past — that is what "live" means. The bug was invisible for 19 hours out of
  // 24, which is exactly why one red CI run looked like a flake.
  it('never ends a live log in the past, at any hour or longitude', () => {
    const zones = [
      'Pacific/Honolulu',
      'America/Anchorage',
      'America/Los_Angeles',
      'America/Chicago',
      'America/New_York',
      'Europe/London',
      'Asia/Tokyo',
      'Pacific/Kiritimati',
    ]
    for (const zone of zones) {
      for (let hour = 0; hour < 24; hour++) {
        const now = new Date(Date.UTC(2026, 8, 6, hour, 17, 0))
        const range = reportRange({}, { now, timeZones: [zone], window: 'rolling-30-days' })
        expect(
          range.end.getTime(),
          `${zone} at ${hour}:17 UTC ended its live log in the past`,
        ).toBeGreaterThan(now.getTime())
        expect(range.end.getTime() - range.start.getTime()).toBe(30 * 86_400_000)
      }
    }
  })

  // A portfolio is reckoned against OPPOSITE ends for the two windows, and this
  // is the test that says so on purpose rather than by accident. Same instant,
  // same zone list: the month waits for Honolulu, the log keeps up with London.
  it('reckons a log against the easternmost site and a month against the westernmost', () => {
    const justAfterUtcMidnight = new Date('2026-09-01T00:32:00.000Z')
    const zones = ['Europe/London', 'America/Chicago', 'Pacific/Honolulu']

    // August has not ended in Honolulu, so the last COMPLETE month is July.
    expect(reportRange({}, { now: justAfterUtcMidnight, timeZones: zones }).fromValue).toBe(
      '2026-07-01',
    )
    // It is already 1 September in London, and a row written a minute ago is in
    // the log regardless of which site it belongs to.
    const log = reportRange(
      {},
      { now: justAfterUtcMidnight, timeZones: zones, window: 'rolling-30-days' },
    )
    expect(log.toValue).toBe('2026-09-01')
    expect(log.end.getTime()).toBeGreaterThan(justAfterUtcMidnight.getTime())
  })

  // B-271 asked for `last-complete-month` to be audited rather than assumed
  // safe. It bounds a LOCAL month with UTC midnights, so the last few local
  // hours of a month sit on the wrong side of the boundary — for Chicago,
  // 31 August 19:00-23:59 local reports in September. That is a boundary
  // MISCLASSIFICATION and not the rolling window's blind spot, and this is the
  // difference stated as an assertion: consecutive months still tile exactly,
  // so every row is in one window and a year still sums. See `DefaultWindow`.
  it('tiles complete months exactly even though their bounds are UTC midnights', () => {
    const now = new Date('2026-09-14T12:00:00.000Z')
    const zones = ['America/Chicago']
    const august = reportRange({}, { now, timeZones: zones })
    const july = reportRange({ from: '2026-07-01', to: '2026-07-31' }, { now, timeZones: zones })
    const september = reportRange(
      { from: '2026-09-01', to: '2026-09-30' },
      { now, timeZones: zones },
    )
    expect(july.end.getTime()).toBe(august.start.getTime())
    expect(august.end.getTime()).toBe(september.start.getTime())
  })

  it('includes the whole of the last day picked', () => {
    // Getting this backwards silently drops the last day of every month-long
    // range, which nobody notices until a year-end total is short.
    const range = reportRange({ from: '2026-03-01', to: '2026-03-31' }, { now })
    expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('tiles consecutive months with no day counted twice or skipped', () => {
    const march = reportRange({ from: '2026-03-01', to: '2026-03-31' }, { now })
    const april = reportRange({ from: '2026-04-01', to: '2026-04-30' }, { now })
    expect(march.end.getTime()).toBe(april.start.getTime())
  })

  it('handles a single day', () => {
    const range = reportRange({ from: '2026-03-05', to: '2026-03-05' }, { now })
    expect(range.end.getTime() - range.start.getTime()).toBe(86_400_000)
  })

  it('falls back to the default rather than erroring on nonsense', () => {
    // A report is a read-only screen; a 500 from a hand-edited URL helps nobody.
    for (const params of [
      { from: 'yesterday' },
      { to: '' },
      { from: '2026-13-45', to: '2026-03-01' },
      { from: '2026-04-30', to: '2026-04-01' },
    ]) {
      expect(reportRange(params, { now }).fromValue).toBe('2026-03-01')
    }
  })

  it('round-trips its own values', () => {
    const first = reportRange({ from: '2026-01-15', to: '2026-02-14' }, { now })
    const again = reportRange({ from: first.fromValue, to: first.toValue }, { now })
    expect(again.start.getTime()).toBe(first.start.getTime())
    expect(again.end.getTime()).toBe(first.end.getTime())
  })
})

// B-223. The defect was not that `reportRange` reckoned badly — it was that no
// caller could tell it where the facilities are, so every one of them took the
// UTC default and nobody noticed for a month. `reportRangeForActor` is the only
// thing that knows the answer, so a screen that calls `reportRange` directly is
// back to reckoning a US operator's month in UTC.
//
// A grep rather than a type: the signature cannot express "not from a page",
// and the failure mode is a NEW file, which no existing test would cover.
describe('every report screen reckons its range against its facilities', () => {
  const appDir = join(__dirname, '..', 'apps', 'web', 'app')

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) return walk(full)
      return /\.(ts|tsx)$/.test(entry) ? [full] : []
    })
  }

  it('no page or route calls reportRange directly', () => {
    const offenders = walk(appDir).filter((file) =>
      /(?<!ForActor\()\breportRange\s*\(/.test(readFileSync(file, 'utf8')),
    )
    expect(
      offenders.map((file) => file.slice(appDir.length + 1)),
      'call reportRangeForActor(actor, ...) instead — see B-223',
    ).toEqual([])
  })
})
