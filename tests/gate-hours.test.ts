import { describe, expect, it } from 'vitest'
import {
  accessDecision,
  gateHoursDecision,
  isAlwaysOpen,
  localReading,
} from '../packages/core/access/gate-hours'
import { CLOSED_ALL_WEEK, type WeeklySchedule } from '../packages/core/facility-settings/weekly-schedule'

// B-064 / PRD 03 US-4. "All hours logic uses the facility's IANA timezone; DST
// transitions covered by tests." (AC4)

const CHICAGO = 'America/Chicago'

function schedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
  return {
    monday: { closed: false, open: '06:00', close: '22:00' },
    tuesday: { closed: false, open: '06:00', close: '22:00' },
    wednesday: { closed: false, open: '06:00', close: '22:00' },
    thursday: { closed: false, open: '06:00', close: '22:00' },
    friday: { closed: false, open: '06:00', close: '22:00' },
    saturday: { closed: false, open: '08:00', close: '20:00' },
    sunday: { closed: true },
    ...overrides,
  }
}

describe('localReading', () => {
  it('reads the wall clock in the facility timezone, not the host', () => {
    // 2026-08-07T14:30Z is 09:30 in Chicago (CDT, UTC-5).
    expect(localReading(new Date('2026-08-07T14:30:00Z'), CHICAGO)).toMatchObject({
      day: 'friday',
      minutes: 9 * 60 + 30,
      clock: '09:30',
    })
  })

  it('reports midnight as 00:00, not 24:00', () => {
    // `hour12: false` yields '24' for midnight in some ICU versions. Untreated,
    // that reads as 1440 minutes past midnight — outside every window there is.
    expect(localReading(new Date('2026-08-07T05:00:00Z'), CHICAGO).clock).toBe('00:00')
    expect(localReading(new Date('2026-08-07T05:00:00Z'), CHICAGO).minutes).toBe(0)
  })

  it('rolls the day over at facility-local midnight, not UTC midnight', () => {
    // 2026-08-08T02:00Z is still Friday evening in Chicago.
    expect(localReading(new Date('2026-08-08T02:00:00Z'), CHICAGO).day).toBe('friday')
  })
})

describe('gate hours across a DST transition', () => {
  // US central time springs forward 2026-03-08 and falls back 2026-11-01.
  //
  // The bug these guard: any code that computes local time by subtracting a
  // stored UTC offset is right for eight months of the year and locks every
  // tenant out an hour early for the other four.
  const hours = schedule()

  it('opens at 06:00 local in winter — UTC-6', () => {
    // 12:00Z = 06:00 CST.
    expect(gateHoursDecision(hours, new Date('2026-01-15T12:00:00Z'), CHICAGO).open).toBe(true)
    // 11:59Z = 05:59 CST, one minute early.
    expect(gateHoursDecision(hours, new Date('2026-01-15T11:59:00Z'), CHICAGO).open).toBe(false)
  })

  it('opens at 06:00 local in summer — UTC-5', () => {
    // 11:00Z = 06:00 CDT. The same instant that opened the gate in January
    // (12:00Z) is 07:00 in July, and an offset-caching implementation would
    // have kept the gate shut for that hour.
    expect(gateHoursDecision(hours, new Date('2026-07-15T11:00:00Z'), CHICAGO).open).toBe(true)
    expect(gateHoursDecision(hours, new Date('2026-07-15T10:59:00Z'), CHICAGO).open).toBe(false)
  })

  it('is correct on the spring-forward day itself', () => {
    // 2026-03-08: 02:00 local jumps to 03:00. 11:59Z is 05:59 CDT — still shut.
    expect(gateHoursDecision(hours, new Date('2026-03-08T11:59:00Z'), CHICAGO).open).toBe(false)
    expect(gateHoursDecision(hours, new Date('2026-03-08T12:00:00Z'), CHICAGO).open).toBe(false)
    // Sunday is closed all day in this schedule, so both are shut for that
    // reason too — which is exactly why the next assertion uses a Monday.
    expect(gateHoursDecision(hours, new Date('2026-03-08T12:00:00Z'), CHICAGO)).toMatchObject({
      because: 'closed_today',
    })
  })

  it('is correct the morning after springing forward', () => {
    // Monday 2026-03-09, now on CDT. 11:00Z = 06:00 local: open.
    expect(gateHoursDecision(hours, new Date('2026-03-09T11:00:00Z'), CHICAGO).open).toBe(true)
    expect(gateHoursDecision(hours, new Date('2026-03-09T10:59:00Z'), CHICAGO).open).toBe(false)
  })

  it('is correct the morning after falling back', () => {
    // Monday 2026-11-02, back on CST. 12:00Z = 06:00 local: open.
    expect(gateHoursDecision(hours, new Date('2026-11-02T12:00:00Z'), CHICAGO).open).toBe(true)
    expect(gateHoursDecision(hours, new Date('2026-11-02T11:00:00Z'), CHICAGO).open).toBe(false)
  })
})

describe('gateHoursDecision', () => {
  it('treats the close time as exclusive', () => {
    // "Closes at 10pm" that admits someone at 10:00:00 sharp is a promise the
    // sign on the fence does not make.
    const hours = schedule()
    expect(gateHoursDecision(hours, new Date('2026-07-15T02:59:00Z'), CHICAGO).open).toBe(true)
    expect(gateHoursDecision(hours, new Date('2026-07-15T03:00:00Z'), CHICAGO).open).toBe(false)
  })

  it('says which day is closed rather than blaming the hours', () => {
    expect(gateHoursDecision(schedule(), new Date('2026-07-12T18:00:00Z'), CHICAGO)).toEqual({
      open: false,
      because: 'closed_today',
    })
  })

  it('reports the day’s own hours when the attempt is merely early', () => {
    expect(gateHoursDecision(schedule(), new Date('2026-07-11T11:00:00Z'), CHICAGO)).toEqual({
      open: false,
      because: 'outside_hours',
      opens: '08:00',
      closes: '20:00',
    })
  })

  it('treats an unconfigured schedule as open, not as locked', () => {
    // A facility that has never filled the form in has not opted into
    // enforcement. Defaulting the other way would lock every tenant out of
    // every unconfigured facility the moment this shipped.
    expect(gateHoursDecision(null, new Date('2026-07-15T09:00:00Z'), CHICAGO).open).toBe(true)
  })

  it('honours a facility that really is closed all week', () => {
    expect(gateHoursDecision(CLOSED_ALL_WEEK, new Date('2026-07-15T18:00:00Z'), CHICAGO).open).toBe(
      false,
    )
  })
})

describe('accessDecision — the per-grant override, AC3', () => {
  it('lets a 24-hour tenant in at 3am', () => {
    const at = new Date('2026-07-15T08:00:00Z') // 03:00 CDT
    expect(gateHoursDecision(schedule(), at, CHICAGO).open).toBe(false)
    expect(accessDecision({ schedule: schedule(), extendedHours: true }, at, CHICAGO).open).toBe(true)
  })

  it('lets a 24-hour tenant in on a day the facility is closed', () => {
    const sunday = new Date('2026-07-12T18:00:00Z')
    expect(accessDecision({ schedule: schedule(), extendedHours: true }, sunday, CHICAGO).open).toBe(
      true,
    )
  })

  it('keeps an ordinary tenant on the facility hours', () => {
    const at = new Date('2026-07-15T08:00:00Z')
    expect(accessDecision({ schedule: schedule(), extendedHours: false }, at, CHICAGO).open).toBe(
      false,
    )
  })
})

describe('isAlwaysOpen', () => {
  it('recognises a schedule that can never deny', () => {
    const allDay = Object.fromEntries(
      Object.keys(schedule()).map((day) => [day, { closed: false, open: '00:00', close: '23:59' }]),
    ) as WeeklySchedule
    expect(isAlwaysOpen(allDay)).toBe(true)
  })

  it('treats an unset schedule as unrestricted', () => {
    expect(isAlwaysOpen(null)).toBe(true)
  })

  it('does not mistake a real schedule for an open one', () => {
    expect(isAlwaysOpen(schedule())).toBe(false)
    expect(isAlwaysOpen(CLOSED_ALL_WEEK)).toBe(false)
  })
})
