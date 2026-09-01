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
    expect(reportRange({}, { now: justAfterUtcMidnight, timeZone: 'America/Chicago' }).fromValue).toBe('2026-07-01')
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
