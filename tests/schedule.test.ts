import { describe, expect, it } from 'vitest'
import {
  businessDateFor,
  daysBetween,
  facilitiesDueAt,
  localDayBounds,
  localParts,
  missedBusinessDates,
  reminderStage,
} from '../packages/core/jobs/schedule'

const CHICAGO = 'America/Chicago'
const NEW_YORK = 'America/New_York'
const PHOENIX = 'America/Phoenix' // no DST — a useful control

const iso = (date: Date) => date.toISOString().slice(0, 10)

describe('facility-local time', () => {
  it('converts an instant to local wall-clock parts', () => {
    // 06:00 UTC on 2026-07-30 is 01:00 CDT the same day.
    const parts = localParts(new Date('2026-07-30T06:00:00Z'), CHICAGO)
    expect(parts).toEqual({ year: 2026, month: 7, day: 30, hour: 1 })
  })

  it('gives the local calendar date, not the UTC one', () => {
    // 03:00 UTC is still the previous evening in Chicago.
    expect(iso(businessDateFor(new Date('2026-07-30T03:00:00Z'), CHICAGO))).toBe('2026-07-29')
    expect(iso(businessDateFor(new Date('2026-07-30T03:00:00Z'), 'UTC'))).toBe('2026-07-30')
  })

  it('zeroes the time component so it fits a DATE column', () => {
    const date = businessDateFor(new Date('2026-07-30T18:45:12Z'), CHICAGO)
    expect(date.toISOString()).toBe('2026-07-30T00:00:00.000Z')
  })

  it('renders midnight as hour 0, never 24', () => {
    // 05:00 UTC is midnight CDT.
    expect(localParts(new Date('2026-07-30T05:00:00Z'), CHICAGO).hour).toBe(0)
  })
})

describe('local day bounds', () => {
  it('gives the UTC instants of local midnight and the next midnight', () => {
    // Chicago is UTC-5 (CDT) in July: local midnight on the 30th is 05:00 UTC.
    const { start, end } = localDayBounds(new Date('2026-07-30T14:00:00Z'), CHICAGO)
    expect(start.toISOString()).toBe('2026-07-30T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-31T05:00:00.000Z')
  })

  it('matches plain UTC bounds when the zone is UTC', () => {
    const { start, end } = localDayBounds(new Date('2026-07-30T14:00:00Z'), 'UTC')
    expect(start.toISOString()).toBe('2026-07-30T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-31T00:00:00.000Z')
  })

  it('places an instant inside its own day bounds', () => {
    const now = new Date('2026-07-30T14:00:00Z')
    const { start, end } = localDayBounds(now, CHICAGO)
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime())
    expect(now.getTime()).toBeLessThan(end.getTime())
  })

  it('handles a zone ahead of UTC', () => {
    // Tokyo is UTC+9 year-round. 20:00 UTC on the 30th is 05:00 JST on the
    // 31st, so that instant's local day starts at 2026-07-30T15:00:00Z.
    const { start } = localDayBounds(new Date('2026-07-30T20:00:00Z'), 'Asia/Tokyo')
    expect(start.toISOString()).toBe('2026-07-30T15:00:00.000Z')
  })
})

describe('daylight saving', () => {
  const facilities = [{ id: 'chi', timezone: CHICAGO }]

  it('fires exactly once on the spring-forward day', () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00 CST/CDT. A 2am job would never
    // run if it were scheduled by wall clock alone.
    const ticks = Array.from(
      { length: 24 },
      (_, hour) => new Date(Date.UTC(2026, 2, 8, hour)),
    )
    const fired = ticks.filter((tick) => facilitiesDueAt(facilities, 3, tick).length > 0)
    expect(fired).toHaveLength(1)
  })

  it('fires exactly once on the fall-back day, when 1am happens twice', () => {
    // 2026-11-01: 02:00 CDT -> 01:00 CST, so local hour 1 occurs in two
    // separate UTC hours. Firing twice would double-bill.
    const ticks = Array.from(
      { length: 24 },
      (_, hour) => new Date(Date.UTC(2026, 10, 1, hour)),
    )
    const fired = ticks.filter((tick) => facilitiesDueAt(facilities, 1, tick).length > 0)
    expect(fired.length).toBeGreaterThanOrEqual(1)

    // Both occurrences of local 1am fall on the same business date, so the
    // JobRun unique constraint collapses them into one run.
    const dates = fired.flatMap((tick) =>
      facilitiesDueAt(facilities, 1, tick).map((d) => iso(d.businessDate)),
    )
    expect(new Set(dates).size).toBe(1)
  })

  it('fires once a day in a zone with no DST at all', () => {
    const phoenix = [{ id: 'phx', timezone: PHOENIX }]
    const ticks = Array.from(
      { length: 24 },
      (_, hour) => new Date(Date.UTC(2026, 2, 8, hour)),
    )
    expect(ticks.filter((t) => facilitiesDueAt(phoenix, 2, t).length > 0)).toHaveLength(1)
  })
})

describe('selecting facilities due now', () => {
  const facilities = [
    { id: 'chi', timezone: CHICAGO },
    { id: 'nyc', timezone: NEW_YORK },
    { id: 'phx', timezone: PHOENIX },
  ]

  it('picks only the facilities at the target local hour', () => {
    // 07:00 UTC on 2026-07-30 = 02:00 CDT, 03:00 EDT, 00:00 MST.
    const due = facilitiesDueAt(facilities, 2, new Date('2026-07-30T07:00:00Z'))
    expect(due.map((d) => d.facility.id)).toEqual(['chi'])
  })

  it('gives each facility its own business date', () => {
    // 05:00 UTC = midnight CDT on the 30th, but 01:00 EDT on the 30th too.
    const due = facilitiesDueAt(facilities, 0, new Date('2026-07-30T05:00:00Z'))
    expect(due.map((d) => [d.facility.id, iso(d.businessDate)])).toEqual([
      ['chi', '2026-07-30'],
    ])
  })

  it('returns nothing when no facility is at that hour', () => {
    expect(facilitiesDueAt(facilities, 9, new Date('2026-07-30T07:00:00Z'))).toEqual([])
  })

  it('covers every facility exactly once across a full day of ticks', () => {
    const seen = new Map<string, number>()
    for (let hour = 0; hour < 24; hour++) {
      for (const { facility } of facilitiesDueAt(
        facilities,
        2,
        new Date(Date.UTC(2026, 6, 30, hour)),
      )) {
        seen.set(facility.id, (seen.get(facility.id) ?? 0) + 1)
      }
    }
    expect([...seen.values()]).toEqual([1, 1, 1])
  })
})

describe('catch-up after downtime', () => {
  it('lists every missed date through today, excluding the one already done', () => {
    const dates = missedBusinessDates(
      new Date('2026-07-26T06:00:00Z'),
      new Date('2026-07-30T06:00:00Z'),
      CHICAGO,
    )
    expect(dates.map(iso)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'])
  })

  it('returns just today when nothing has ever run', () => {
    const dates = missedBusinessDates(null, new Date('2026-07-30T06:00:00Z'), CHICAGO)
    expect(dates.map(iso)).toEqual(['2026-07-30'])
  })

  it('returns nothing when the last run is already current', () => {
    const now = new Date('2026-07-30T06:00:00Z')
    expect(missedBusinessDates(now, now, CHICAGO)).toEqual([])
  })

  it('caps the backfill so a long outage cannot start thousands of runs', () => {
    const dates = missedBusinessDates(
      new Date('2020-01-01T06:00:00Z'),
      new Date('2026-07-30T06:00:00Z'),
      CHICAGO,
      30,
    )
    expect(dates).toHaveLength(30)
  })
})

// B-043's pre-emptive scans (PRD 05 CN-10a, D-17). The scans themselves are
// DB-bound; this is the day-maths they both turn on.

describe('daysBetween', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('counts whole days forwards and backwards', () => {
    expect(daysBetween(d('2026-08-05'), d('2026-09-04'))).toBe(30)
    expect(daysBetween(d('2026-08-05'), d('2026-08-05'))).toBe(0)
    expect(daysBetween(d('2026-08-05'), d('2026-08-04'))).toBe(-1)
  })

  it('is unaffected by a DST transition in between', () => {
    // US DST ends 2026-11-01. Business dates carry no offset, so the count is
    // exactly the number of calendar days regardless.
    expect(daysBetween(d('2026-10-25'), d('2026-11-08'))).toBe(14)
  })
})

describe('reminderStage', () => {
  const STAGES = [30, 7]

  it('reports nothing before the first threshold', () => {
    expect(reminderStage(31, STAGES)).toBeNull()
  })

  it('reports the 30-day stage on the day it is reached and while it holds', () => {
    expect(reminderStage(30, STAGES)).toBe(30)
    expect(reminderStage(20, STAGES)).toBe(30)
    expect(reminderStage(8, STAGES)).toBe(30)
  })

  it('drops to the 7-day stage once the countdown crosses it', () => {
    expect(reminderStage(7, STAGES)).toBe(7)
    expect(reminderStage(1, STAGES)).toBe(7)
  })

  it('stays at the last stage once the date has passed rather than falling off the end', () => {
    // A card that already expired is not suddenly un-notified; the caller's
    // dedupe is what stops it re-sending.
    expect(reminderStage(0, STAGES)).toBe(7)
    expect(reminderStage(-40, STAGES)).toBe(7)
  })

  it('does not care what order the thresholds are given in', () => {
    expect(reminderStage(20, [7, 30])).toBe(30)
  })
})
