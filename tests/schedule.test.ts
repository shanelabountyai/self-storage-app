import { describe, expect, it } from 'vitest'
import {
  businessDateFor,
  daysBetween,
  facilitiesDueSince,
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
  const dayOfTicks = (year: number, month: number, day: number) =>
    Array.from({ length: 24 }, (_, hour) => new Date(Date.UTC(year, month, day, hour)))

  // B-236 changed the question these ask, and the change is worth stating
  // rather than editing quietly past.
  //
  // Under the old exact-hour rule the safety property was "fires exactly once
  // a day", and these tests asserted the count of ticks. Dueness is now "the
  // local hour has been reached", so a job is due at MANY ticks in a day by
  // design — that is what stops a dropped run vanishing. The property that
  // actually prevents double-billing was never the tick count: it is that every
  // tick within one facility-local day resolves to the SAME business date,
  // because `JobRun`'s unique constraint is keyed on (job, facility, date).
  // These now assert that, which is the thing the money depends on.

  /// The distinct business dates a facility is offered, for the ticks that fall
  /// on one particular local calendar day. A 24-hour UTC window straddles two
  /// local days in a US zone, so filtering by the local day is the whole point.
  const datesOnLocalDay = (ticks: readonly Date[], targetLocalHour: number, localDay: number) =>
    new Set(
      ticks
        .filter((tick) => localParts(tick, CHICAGO).day === localDay)
        .flatMap((tick) =>
          facilitiesDueSince(facilities, targetLocalHour, tick).map((due) => iso(due.businessDate)),
        ),
    )

  it('resolves to exactly one business date on the spring-forward day', () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00 CST/CDT.
    const dates = datesOnLocalDay(dayOfTicks(2026, 2, 8), 3, 8)
    expect(dates.size).toBe(1)
    expect([...dates]).toEqual(['2026-03-08'])
  })

  it('runs a 2am job on the spring-forward day, which the exact-hour form never did', () => {
    // The bug B-236 turned up by measurement rather than reasoning: local hour
    // 2 DOES NOT EXIST on 2026-03-08, so an `=== 2` test matched zero ticks and
    // `billing.assess-late-fees` (plus both card/proof scans) simply did not
    // run that day at any US facility. The catch-up reached them the next
    // night, a day late, once a year.
    const ticks = dayOfTicks(2026, 2, 8)
    expect(
      ticks.some((tick) => localParts(tick, CHICAGO).hour === 2),
      'local 2am existed on the spring-forward day',
    ).toBe(false)
    expect(datesOnLocalDay(ticks, 2, 8)).toEqual(new Set(['2026-03-08']))
  })

  it('resolves to one business date on the fall-back day, when 1am happens twice', () => {
    // 2026-11-01: 02:00 CDT -> 01:00 CST, so local hour 1 occurs in two
    // separate UTC hours. Two runs on one date would double-bill; one date
    // across both is what the unique constraint collapses.
    const ticks = dayOfTicks(2026, 10, 1)
    expect(ticks.filter((tick) => localParts(tick, CHICAGO).hour === 1)).toHaveLength(2)
    expect(datesOnLocalDay(ticks, 1, 1)).toEqual(new Set(['2026-11-01']))
  })

  it('resolves to one business date in a zone with no DST at all', () => {
    const phoenix = [{ id: 'phx', timezone: PHOENIX }]
    const dates = new Set(
      dayOfTicks(2026, 2, 8)
        .filter((tick) => localParts(tick, PHOENIX).day === 8)
        .flatMap((tick) => facilitiesDueSince(phoenix, 2, tick).map((due) => iso(due.businessDate))),
    )
    expect(dates).toEqual(new Set(['2026-03-08']))
  })
})

describe('selecting facilities due now', () => {
  const facilities = [
    { id: 'chi', timezone: CHICAGO },
    { id: 'nyc', timezone: NEW_YORK },
    { id: 'phx', timezone: PHOENIX },
  ]

  it('picks the facilities that have reached the target local hour', () => {
    // 07:00 UTC on 2026-07-30 = 02:00 CDT, 03:00 EDT, 00:00 MST. Phoenix has
    // not reached 2am yet; the other two have.
    const due = facilitiesDueSince(facilities, 2, new Date('2026-07-30T07:00:00Z'))
    expect(due.map((entry) => entry.facility.id)).toEqual(['chi', 'nyc'])
  })

  it('keeps a facility due for the rest of its local day, which is B-236', () => {
    // The whole point: a tick that ran out of budget at 2am must not make the
    // work disappear. At 6am local the same facility is still due, on the same
    // business date, so the next tick picks it up rather than dropping it.
    const early = facilitiesDueSince(facilities, 2, new Date('2026-07-30T07:00:00Z'))
    const later = facilitiesDueSince(facilities, 2, new Date('2026-07-30T11:00:00Z'))
    const chicago = (list: typeof early) => list.find((entry) => entry.facility.id === 'chi')
    expect(chicago(early)).toBeDefined()
    expect(chicago(later)).toBeDefined()
    expect(iso(chicago(later)!.businessDate)).toBe(iso(chicago(early)!.businessDate))
  })

  it('gives each facility the business date of ITS OWN local day', () => {
    // 05:00 UTC = midnight CDT on the 30th and 01:00 EDT on the 30th — but
    // 22:00 MST on the 29th. Phoenix reached its midnight twenty-two hours
    // ago, so it is due for the 29th, not the 30th. Under the exact-hour rule
    // Phoenix simply did not appear, which is the same thing said as silence.
    const due = facilitiesDueSince(facilities, 0, new Date('2026-07-30T05:00:00Z'))
    expect(due.map((entry) => [entry.facility.id, iso(entry.businessDate)])).toEqual([
      ['chi', '2026-07-30'],
      ['nyc', '2026-07-30'],
      ['phx', '2026-07-29'],
    ])
  })

  it('returns nothing before any facility has reached that hour', () => {
    // 07:00 UTC is 02:00/03:00/00:00 local — nobody is at 9am yet.
    expect(facilitiesDueSince(facilities, 9, new Date('2026-07-30T07:00:00Z'))).toEqual([])
  })

  it('offers each facility one business date per local day, never two', () => {
    // The invariant that replaced "fires exactly once". A facility may be due
    // at a dozen ticks; every tick inside one of its local days must name the
    // same date, or the unique constraint is not what collapses them.
    const perLocalDay = new Map<string, Set<string>>()
    for (let hour = 0; hour < 48; hour++) {
      for (const { facility, businessDate } of facilitiesDueSince(
        facilities,
        2,
        new Date(Date.UTC(2026, 6, 30, hour)),
      )) {
        const key = `${facility.id}:${iso(businessDate)}`
        perLocalDay.set(key, (perLocalDay.get(key) ?? new Set()).add(iso(businessDate)))
      }
    }
    expect([...new Set([...perLocalDay.keys()].map((key) => key.split(':')[0]))].sort()).toEqual([
      'chi',
      'nyc',
      'phx',
    ])
    expect([...perLocalDay.values()].every((dates) => dates.size === 1)).toBe(true)
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
