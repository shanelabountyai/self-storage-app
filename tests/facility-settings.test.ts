import { describe, expect, it } from 'vitest'
import {
  CLOSED_ALL_WEEK,
  effectiveAsOf,
  effectiveByGroup,
  parseWeeklySchedule,
} from '../packages/core/facility-settings'

const row = (effectiveFrom: string, tag: string) => ({ effectiveFrom: new Date(effectiveFrom), tag })

describe('effectiveAsOf', () => {
  it('picks the latest row on or before the date', () => {
    const rows = [row('2026-01-01', 'a'), row('2026-06-01', 'b'), row('2026-12-01', 'c')]
    expect(effectiveAsOf(rows, new Date('2026-07-01'))?.tag).toBe('b')
  })

  it('never picks a row that starts in the future', () => {
    const rows = [row('2026-01-01', 'a'), row('2027-01-01', 'future')]
    expect(effectiveAsOf(rows, new Date('2026-06-01'))?.tag).toBe('a')
  })

  it('returns null when every row is in the future', () => {
    const rows = [row('2027-01-01', 'future')]
    expect(effectiveAsOf(rows, new Date('2026-01-01'))).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(effectiveAsOf([], new Date())).toBeNull()
  })

  it('treats the boundary instant as effective, not future', () => {
    const asOf = new Date('2026-06-01T00:00:00.000Z')
    const rows = [row('2026-06-01T00:00:00.000Z', 'exact')]
    expect(effectiveAsOf(rows, asOf)?.tag).toBe('exact')
  })

  it('is not fooled by array order', () => {
    const rows = [row('2026-12-01', 'c'), row('2026-01-01', 'a'), row('2026-06-01', 'b')]
    expect(effectiveAsOf(rows, new Date('2026-07-01'))?.tag).toBe('b')
  })
})

describe('effectiveByGroup', () => {
  it('resolves the current row independently per group', () => {
    const rows = [
      { effectiveFrom: new Date('2026-01-01'), jurisdiction: 'state', rate: 625 },
      { effectiveFrom: new Date('2026-06-01'), jurisdiction: 'state', rate: 650 },
      { effectiveFrom: new Date('2026-01-01'), jurisdiction: 'city', rate: 200 },
    ]
    const asOf = new Date('2026-07-01')
    const result = effectiveByGroup(rows, asOf, (r) => r.jurisdiction)
    expect(result.get('state')?.rate).toBe(650)
    expect(result.get('city')?.rate).toBe(200)
    expect(result.size).toBe(2)
  })

  it('omits a group whose only rows are still in the future', () => {
    const rows = [{ effectiveFrom: new Date('2027-01-01'), jurisdiction: 'new-county', rate: 100 }]
    expect(effectiveByGroup(rows, new Date('2026-01-01'), (r) => r.jurisdiction).size).toBe(0)
  })
})

describe('parseWeeklySchedule', () => {
  it('accepts a fully specified week', () => {
    const schedule = {
      ...CLOSED_ALL_WEEK,
      monday: { closed: false, open: '09:00', close: '18:00' },
    }
    expect(parseWeeklySchedule(schedule)).toEqual(schedule)
  })

  it('rejects a day missing from the week', () => {
    const { monday: _monday, ...incomplete } = CLOSED_ALL_WEEK
    expect(parseWeeklySchedule(incomplete)).toBeNull()
  })

  it('rejects an open time that is not before the close time', () => {
    const schedule = { ...CLOSED_ALL_WEEK, monday: { closed: false, open: '18:00', close: '09:00' } }
    expect(parseWeeklySchedule(schedule)).toBeNull()
  })

  it('rejects a malformed time string', () => {
    const schedule = { ...CLOSED_ALL_WEEK, monday: { closed: false, open: '9am', close: '18:00' } }
    expect(parseWeeklySchedule(schedule)).toBeNull()
  })

  it('rejects an out-of-range hour', () => {
    const schedule = { ...CLOSED_ALL_WEEK, monday: { closed: false, open: '24:00', close: '25:00' } }
    expect(parseWeeklySchedule(schedule)).toBeNull()
  })

  it('rejects non-object input without throwing', () => {
    expect(parseWeeklySchedule(null)).toBeNull()
    expect(parseWeeklySchedule('closed')).toBeNull()
    expect(parseWeeklySchedule(42)).toBeNull()
    expect(parseWeeklySchedule(undefined)).toBeNull()
  })
})
