import { describe, expect, it } from 'vitest'
import {
  gateHoursDecision,
  isSharedAccessPreset,
  narrowSchedule,
  presetFor,
  SHARED_ACCESS_PRESETS,
} from '../packages/core/access'
import {
  DAYS_OF_WEEK,
  type DaySchedule,
  type WeeklySchedule,
} from '../packages/core/facility-settings'

// B-086 / PRD 03 US-8 AC1. The "scope" half of time-boxed shared access: a
// per-person window, narrowed against the facility's own gate hours.

const every = (entry: DaySchedule): WeeklySchedule =>
  Object.fromEntries(DAYS_OF_WEEK.map((day) => [day, entry])) as WeeklySchedule

const open = (from: string, to: string): DaySchedule => ({ closed: false, open: from, close: to })

describe('narrowSchedule', () => {
  it('is the facility when the person has no window, and vice versa', () => {
    const facility = every(open('06:00', '22:00'))
    expect(narrowSchedule(facility, null)).toEqual(facility)
    expect(narrowSchedule(null, facility)).toEqual(facility)
    expect(narrowSchedule(null, null)).toBeNull()
  })

  it('takes the tighter end of each side', () => {
    const result = narrowSchedule(every(open('06:00', '22:00')), every(open('09:00', '17:00')))
    expect(result?.monday).toEqual(open('09:00', '17:00'))
  })

  // The reason this is an intersection and not a replacement: a per-person
  // window that could WIDEN is free 24-hour access, which the facility sells as
  // an add-on, obtained by typing 00:00–23:59 into a portal form.
  it('never widens beyond the facility, however permissive the person is', () => {
    const result = narrowSchedule(every(open('06:00', '22:00')), every(open('00:00', '23:59')))
    expect(result?.monday).toEqual(open('06:00', '22:00'))
  })

  it('closes a day either side closes', () => {
    const facility = { ...every(open('06:00', '22:00')), sunday: { closed: true } as DaySchedule }
    const result = narrowSchedule(facility, every(open('09:00', '17:00')))
    expect(result?.sunday).toEqual({ closed: true })
    expect(narrowSchedule(every(open('06:00', '22:00')), SHARED_ACCESS_PRESETS.weekends.schedule)
      ?.monday).toEqual({ closed: true })
  })

  // Facility 06:00–12:00, person 14:00–18:00: no minute in common. An inverted
  // range would be rejected by `parseWeeklySchedule` on the way back in, so it
  // has to come out as closed rather than as `14:00–12:00`.
  it('closes a day whose windows do not overlap at all', () => {
    const result = narrowSchedule(every(open('06:00', '12:00')), every(open('14:00', '18:00')))
    expect(result?.monday).toEqual({ closed: true })
  })

  it('produces a schedule the gate decision can actually read', () => {
    const narrowed = narrowSchedule(
      every(open('06:00', '22:00')),
      SHARED_ACCESS_PRESETS.weekdays.schedule,
    )
    // Thursday 2026-08-27 10:00 Chicago, then Saturday the 29th.
    const thursday = new Date('2026-08-27T15:00:00Z')
    const saturday = new Date('2026-08-29T15:00:00Z')
    expect(gateHoursDecision(narrowed, thursday, 'America/Chicago').open).toBe(true)
    expect(gateHoursDecision(narrowed, saturday, 'America/Chicago')).toEqual({
      open: false,
      because: 'closed_today',
    })
  })
})

describe('presets', () => {
  it('round-trips every preset back to its own name', () => {
    for (const key of Object.keys(SHARED_ACCESS_PRESETS)) {
      expect(isSharedAccessPreset(key)).toBe(true)
      expect(presetFor(SHARED_ACCESS_PRESETS[key as keyof typeof SHARED_ACCESS_PRESETS].schedule))
        .toBe(key)
    }
  })

  // A window a manager typed by hand, or a preset whose definition later
  // changes. Labelling it as one of the three would tell a tenant their guest
  // can get in on a day they cannot.
  it('reads an unrecognised window as custom rather than mislabelling it', () => {
    expect(presetFor(every(open('09:00', '17:00')))).toBe('custom')
  })

  it('rejects a value that is not a preset at all', () => {
    expect(isSharedAccessPreset('whenever')).toBe(false)
  })
})
