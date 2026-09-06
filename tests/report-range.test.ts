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

  // The evening hole. `businessDateFor` returns UTC MIDNIGHT OF THE LOCAL DATE,
  // so `today + 1 day` is still a UTC midnight — and between local midnight and
  // UTC midnight it lands BEFORE now. Every support session and gate attempt
  // between 7pm and midnight US Central was therefore missing from the log it
  // is recorded on, until the local day rolled over.
  //
  // Found by `e2e/impersonation.spec.ts` failing in CI at 02:45 UTC and passing
  // locally at 22:58 UTC — the same commit, the same database, four hours
  // apart. That is the clock-dependent shape CLAUDE.md warns about, and it is
  // why this asserts against a PINNED instant rather than `new Date()`.
  it('covers an event that has just happened, late in a western local day', () => {
    // 21:51 on 5 September in America/Chicago; already the 6th in UTC.
    const evening = new Date('2026-09-06T02:51:04.000Z')
    const range = reportRange(
      {},
      { now: evening, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )

    // The label stays on the LOCAL date — that is the day an operator in Texas
    // is having, and moving it would be a different bug.
    expect(range.toValue).toBe('2026-09-05')
    // But the query bound has to reach the event the operator opened the log
    // for. `sessionReport` filters `startedAt: { gte: start, lt: end }`.
    expect(evening.getTime()).toBeLessThan(range.end.getTime())
  })

  it('clamps for an unparseable end too, not just an absent one', () => {
    // `?to=yesterday` falls back to the default range. Keying the clamp off
    // `params.to` being PRESENT rather than off it having parsed would have
    // left this URL with the hole while the plain one was fixed.
    const evening = new Date('2026-09-06T02:51:04.000Z')
    const range = reportRange(
      { to: 'yesterday' },
      { now: evening, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )
    expect(evening.getTime()).toBeLessThan(range.end.getTime())
  })

  it('leaves an explicitly picked end exactly where the operator put it', () => {
    // The other direction: a picked range means what it says, even though that
    // reintroduces the hole for that one URL. Closing THAT needs a local-day to
    // UTC-instant conversion, which this module deliberately avoids (B-223) —
    // it is named in NEXT.md rather than smuggled in here.
    const evening = new Date('2026-09-06T02:51:04.000Z')
    const range = reportRange(
      { from: '2026-08-07', to: '2026-09-05' },
      { now: evening, timeZones: ['America/Chicago'], window: 'rolling-30-days' },
    )
    expect(range.end.toISOString()).toBe('2026-09-06T00:00:00.000Z')
  })

  it('leaves the report window alone — only the live log clamps', () => {
    // `last-complete-month` must NOT grow to cover now: it ties out against the
    // accounting close (D-109), and a month that quietly included today would
    // be the defect that decision exists to prevent.
    const evening = new Date('2026-09-06T02:51:04.000Z')
    const range = reportRange({}, { now: evening, timeZones: ['America/Chicago'] })
    expect(range.toValue).toBe('2026-08-31')
    expect(range.end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
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
