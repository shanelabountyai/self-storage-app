import { describe, expect, it } from 'vitest'
import { reportRange } from '../apps/web/lib/admin/report-range'

// B-055 / PRD 02 US-39: "date-range selection", parsed once for the screen and
// its CSV route so the export cannot read the same query string differently.

const now = new Date('2026-04-17T18:30:00.000Z')

describe('reportRange', () => {
  it('defaults to the current calendar month', () => {
    const range = reportRange({}, now)
    expect(range.fromValue).toBe('2026-04-01')
    expect(range.toValue).toBe('2026-04-30')
    // Exclusive end: the day AFTER the last day the user picked.
    expect(range.end.toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })

  it('includes the whole of the last day picked', () => {
    // Getting this backwards silently drops the last day of every month-long
    // range, which nobody notices until a year-end total is short.
    const range = reportRange({ from: '2026-03-01', to: '2026-03-31' }, now)
    expect(range.start.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('tiles consecutive months with no day counted twice or skipped', () => {
    const march = reportRange({ from: '2026-03-01', to: '2026-03-31' }, now)
    const april = reportRange({ from: '2026-04-01', to: '2026-04-30' }, now)
    expect(march.end.getTime()).toBe(april.start.getTime())
  })

  it('handles a single day', () => {
    const range = reportRange({ from: '2026-03-05', to: '2026-03-05' }, now)
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
      expect(reportRange(params, now).fromValue).toBe('2026-04-01')
    }
  })

  it('round-trips its own values', () => {
    const first = reportRange({ from: '2026-01-15', to: '2026-02-14' }, now)
    const again = reportRange({ from: first.fromValue, to: first.toValue }, now)
    expect(again.start.getTime()).toBe(first.start.getTime())
    expect(again.end.getTime()).toBe(first.end.getTime())
  })
})
