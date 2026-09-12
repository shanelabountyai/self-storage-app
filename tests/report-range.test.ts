import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { businessDateFor } from '../packages/core/jobs/index.ts'
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

  // B-296, kept after B-297 replaced its `now` clamp with a local-midnight end.
  // `today` is a facility-local calendar date carried at UTC midnight and the
  // rows are real instants, so for the five hours between UTC midnight and
  // Texas midnight the exclusive end sat BEHIND the wall clock:
  // /admin/impersonation's "last 30 days" stopped before a session started 42
  // minutes earlier, and the two arc tests in impersonation.spec.ts failed on
  // it — measured on the rows the run left behind, started 2026-09-12T00:42Z,
  // which is 19:42 on the 11th in Texas.
  it('includes what happened after UTC midnight but before local midnight', () => {
    const justAfterUtcMidnight = new Date('2026-09-12T00:42:00.000Z')
    const range = reportRange(
      {},
      { now: justAfterUtcMidnight, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )
    // The form still round-trips the LOCAL date — it is still the 11th there.
    expect(range.toValue).toBe('2026-09-11')
    expect(range.end.getTime()).toBeGreaterThan(justAfterUtcMidnight.getTime())
  })

  // ...and only then. A range the operator deliberately ended in the past ends
  // where they said, which is what a bare `end <= now` clamp would have got
  // wrong on every historical query on the same screen.
  it('does not stretch a range that ends in the past up to now', () => {
    const range = reportRange(
      { from: '2026-03-01', to: '2026-03-31' },
      { now, window: 'rolling-30-days' },
    )
    expect(range.end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
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

  // B-297. The bug this row exists for. A payment taken at 8pm on 31 August in
  // Texas is `2026-09-01T01:00Z`, so a UTC-midnight September window filed
  // August's money in September and August's own window ended before it.
  it('bounds the range at facility-local midnight, not UTC midnight', () => {
    const august = reportRange(
      { from: '2026-08-01', to: '2026-08-31' },
      { now, timeZones: ['America/Chicago'] },
    )
    expect(august.start.toISOString()).toBe('2026-08-01T05:00:00.000Z')
    expect(august.end.toISOString()).toBe('2026-09-01T05:00:00.000Z')

    const eightPmOnThe31st = new Date('2026-09-01T01:00:00.000Z')
    expect(eightPmOnThe31st >= august.start && eightPmOnThe31st < august.end).toBe(true)

    const september = reportRange(
      { from: '2026-09-01', to: '2026-09-30' },
      { now, timeZones: ['America/Chicago'] },
    )
    expect(eightPmOnThe31st < september.start).toBe(true)
    // Still tiles: the payment is in exactly one of the two.
    expect(september.start.getTime()).toBe(august.end.getTime())
  })

  // A DST month, because `zonedMidnight` measures the offset twice for exactly
  // this: 8 March 2026 is the spring-forward day in the US.
  it('is not an hour out across a DST boundary', () => {
    const march = reportRange(
      { from: '2026-03-01', to: '2026-03-31' },
      { now, timeZones: ['America/Chicago'] },
    )
    expect(march.start.toISOString()).toBe('2026-03-01T06:00:00.000Z') // CST
    expect(march.end.toISOString()).toBe('2026-04-01T05:00:00.000Z') // CDT
  })

  // The property that lets ONE range serve both a timestamp column and a
  // business-date one: converting an instant bound back with the facility's own
  // zone lands on the right calendar date at EVERY facility, not just at the
  // westernmost site the bounds were reckoned in.
  it('converts back to the same calendar date in every zone in scope', () => {
    const zones = ['America/New_York', 'America/Chicago', 'America/Los_Angeles']
    const range = reportRange({ from: '2026-08-01', to: '2026-08-31' }, { now, timeZones: zones })
    for (const zone of zones) {
      expect(businessDateFor(range.start, zone).toISOString()).toBe('2026-08-01T00:00:00.000Z')
      expect(businessDateFor(range.end, zone).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    }
  })

  // One zone at BOTH ends, so a multi-zone portfolio still tiles. Taking the
  // start in the easternmost zone and the end in the westernmost would count
  // the boundary hours in two consecutive months.
  it('tiles a multi-zone portfolio, and does not depend on the order given', () => {
    const zones = ['America/New_York', 'Pacific/Honolulu', 'America/Chicago']
    const august = reportRange({ from: '2026-08-01', to: '2026-08-31' }, { now, timeZones: zones })
    const september = reportRange(
      { from: '2026-09-01', to: '2026-09-30' },
      { now, timeZones: [...zones].reverse() },
    )
    expect(august.end.getTime()).toBe(september.start.getTime())
    // Honolulu is the westernmost of the three, and it is what both ends use.
    expect(august.end.toISOString()).toBe('2026-09-01T10:00:00.000Z')
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
      /(?<!ForActor\()(?<!ForMonth\()\breportRange\s*\(/.test(readFileSync(file, 'utf8')),
    )
    expect(
      offenders.map((file) => file.slice(appDir.length + 1)),
      'call reportRangeForActor(actor, ...) instead — see B-223',
    ).toEqual([])
  })

  // B-298. The other half of the same failure, and the reason it went unnoticed
  // for as long as it did: these four files never called `reportRange` at all,
  // so the grep above was clean while they each carried their own
  // `Date.UTC(year, month - 1, 1)`. Four copies of the arithmetic D-138
  // forbids, on screens whose figures the accounting close is supposed to tie
  // out against.
  //
  // Matched on a literal day-of-month `1` rather than on `Date.UTC` itself:
  // `Date.UTC(year, month - 1, day)` is a perfectly good way to read a calendar
  // date somebody submitted (`/portal/access` does exactly that), and a scan
  // that flagged it would be turned off. A hardcoded first-of-the-month is the
  // shape that is always a range bound.
  it('no page or route builds its own month bounds', () => {
    const offenders = walk(appDir).filter((file) =>
      /Date\.UTC\([^)]*,\s*1\s*\)/.test(readFileSync(file, 'utf8')),
    )
    expect(
      offenders.map((file) => file.slice(appDir.length + 1)),
      'call reportRangeForMonth(actor, month) instead — a hand-built bound is ' +
        'UTC midnight, and D-138 says these bounds are instants at facility-local midnight',
    ).toEqual([])
  })

  // B-296 fixed the rolling window; B-297 removed its clamp; neither left a
  // test that the two LOG screens still ask for that window rather than the
  // report default. `/admin/impersonation` is covered end to end by
  // `impersonation.spec.ts`, whose first test would fail if the window went
  // back to a month that ended before the session started. `/admin/access` had
  // nothing at all — `admin-tasks.spec.ts` visits it and asserts nothing about
  // its range — and a gate log defaulting to last month is the same defect
  // D-109 called worse than the one it fixed.
  it('both activity logs and their CSV siblings ask for the rolling window', () => {
    const logs = [
      'admin/access/page.tsx',
      'admin/impersonation/page.tsx',
      'admin/impersonation.csv/route.ts',
    ]
    for (const relative of logs) {
      const source = readFileSync(join(appDir, relative), 'utf8')
      expect(source, `${relative} must pass window: 'rolling-30-days'`).toContain(
        "'rolling-30-days'",
      )
    }
  })
})
