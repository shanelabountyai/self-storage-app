import { describe, expect, it } from 'vitest'
import {
  officeToday,
  sharedAccessSuspendDays,
  sharedMoveOutNoticeDays,
  sharedOfficeHours,
  sharedPaymentRetryDays,
  sortByDistance,
  type HomeFacility,
} from '../apps/web/lib/marketing/home-facts'
import type { WeeklySchedule } from '../packages/core/facility-settings'

// B-366. The locations page's nearest-first cut — real enough to deserve its
// own test (a loop and two branches) rather than only a rendered page.

function facility(overrides: Partial<HomeFacility> = {}): HomeFacility {
  return {
    id: 'f1',
    slug: 'demo',
    name: 'Demo',
    addressLine1: '1 Main St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78704',
    phone: null,
    latitude: null,
    longitude: null,
    from: null,
    officeHours: null,
    timezone: 'America/Chicago',
    amenities: [],
    accessSuspendDaysPastDue: 6,
    paymentRetryDays: [1, 3, 5],
    moveOutNoticeDays: 10,
    ...overrides,
  }
}

describe('sortByDistance', () => {
  it('keeps the input order when no point is given', () => {
    const far = facility({ id: 'far', latitude: 40, longitude: -100 })
    const near = facility({ id: 'near', latitude: 30, longitude: -97 })
    const result = sortByDistance([far, near], undefined)
    expect(result.map((r) => r.facility.id)).toEqual(['far', 'near'])
    expect(result.every((r) => r.distanceMiles === undefined)).toBe(true)
  })

  it('ranks nearest first once a point is known', () => {
    const point = { latitude: 30.267, longitude: -97.743 } // Austin
    const far = facility({ id: 'far', latitude: 40.7128, longitude: -74.006 }) // NYC
    const near = facility({ id: 'near', latitude: 30.2672, longitude: -97.7431 }) // ~Austin
    const result = sortByDistance([far, near], point)
    expect(result.map((r) => r.facility.id)).toEqual(['near', 'far'])
    expect(result[0]!.distanceMiles).toBeLessThan(result[1]!.distanceMiles!)
  })

  it('sorts a facility with no coordinates after every one that has them', () => {
    const point = { latitude: 30.267, longitude: -97.743 }
    const known = facility({ id: 'known', latitude: 40.7128, longitude: -74.006 })
    const unknown = facility({ id: 'unknown' })
    const result = sortByDistance([unknown, known], point)
    expect(result.map((r) => r.facility.id)).toEqual(['known', 'unknown'])
    expect(result[1]!.distanceMiles).toBeUndefined()
  })
})

describe('officeToday', () => {
  const day = { closed: false as const, open: '09:00', close: '18:00' }
  const week = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [d, day]),
  ) as unknown as WeeklySchedule
  week.sunday = { closed: true }
  // 2026-09-23 is a Wednesday; 15:00Z = 10:00 in Chicago (CDT).
  it('is open inside hours, closed after, in the facility zone', () => {
    expect(officeToday(week, 'America/Chicago', new Date('2026-09-23T15:00:00Z'))?.open).toBe(true)
    expect(officeToday(week, 'America/Chicago', new Date('2026-09-24T01:00:00Z'))?.open).toBe(false)
  })
  it('is closed on a closed day and null without a schedule', () => {
    expect(officeToday(week, 'America/Chicago', new Date('2026-09-27T17:00:00Z'))?.open).toBe(false)
    expect(officeToday(null, 'America/Chicago', new Date())).toBeNull()
  })
})

// B-408. FAQ/size-guide/contact show one office-hours line beside the phone
// number only when it is true of every active facility — never a guess.
describe('sharedOfficeHours', () => {
  const day = { closed: false as const, open: '09:00', close: '18:00' }
  const week = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [
      d,
      d === 'sunday' ? { closed: true } : day,
    ]),
  ) as unknown as WeeklySchedule

  it('is null with no facilities', () => {
    expect(sharedOfficeHours([])).toBeNull()
  })

  it('is null when the first facility has no published hours', () => {
    expect(sharedOfficeHours([facility({ officeHours: null })])).toBeNull()
  })

  it('returns the schedule when every facility agrees, same timezone', () => {
    const facilities = [facility({ officeHours: week }), facility({ id: 'f2', officeHours: week })]
    expect(sharedOfficeHours(facilities)).toEqual({ schedule: week, timezone: 'America/Chicago' })
  })

  it('is null once one facility publishes different hours', () => {
    const other: WeeklySchedule = { ...week, monday: { closed: true } }
    const facilities = [facility({ officeHours: week }), facility({ id: 'f2', officeHours: other })]
    expect(sharedOfficeHours(facilities)).toBeNull()
  })

  it('is null once one facility is in a different timezone', () => {
    const facilities = [
      facility({ officeHours: week }),
      facility({ id: 'f2', officeHours: week, timezone: 'America/Denver' }),
    ]
    expect(sharedOfficeHours(facilities)).toBeNull()
  })
})

// B-409. The FAQ's card-decline and move-out answers, each stated only when
// every active facility's config agrees — same shape as `sharedOfficeHours`.
describe('sharedAccessSuspendDays', () => {
  it('is null with no facilities', () => {
    expect(sharedAccessSuspendDays([])).toBeNull()
  })

  it('returns the day when every facility agrees', () => {
    const facilities = [facility({ accessSuspendDaysPastDue: 6 }), facility({ id: 'f2', accessSuspendDaysPastDue: 6 })]
    expect(sharedAccessSuspendDays(facilities)).toBe(6)
  })

  it('is null once one facility disagrees', () => {
    const facilities = [facility({ accessSuspendDaysPastDue: 6 }), facility({ id: 'f2', accessSuspendDaysPastDue: 10 })]
    expect(sharedAccessSuspendDays(facilities)).toBeNull()
  })
})

describe('sharedPaymentRetryDays', () => {
  it('returns the schedule when every facility agrees', () => {
    const facilities = [
      facility({ paymentRetryDays: [1, 3, 5] }),
      facility({ id: 'f2', paymentRetryDays: [1, 3, 5] }),
    ]
    expect(sharedPaymentRetryDays(facilities)).toEqual([1, 3, 5])
  })

  it('is null once one facility publishes a different schedule', () => {
    const facilities = [
      facility({ paymentRetryDays: [1, 3, 5] }),
      facility({ id: 'f2', paymentRetryDays: [1, 3] }),
    ]
    expect(sharedPaymentRetryDays(facilities)).toBeNull()
  })
})

describe('sharedMoveOutNoticeDays', () => {
  it('returns the days when every facility agrees, including zero', () => {
    const facilities = [facility({ moveOutNoticeDays: 0 }), facility({ id: 'f2', moveOutNoticeDays: 0 })]
    expect(sharedMoveOutNoticeDays(facilities)).toBe(0)
  })

  it('is null once one facility disagrees', () => {
    const facilities = [facility({ moveOutNoticeDays: 10 }), facility({ id: 'f2', moveOutNoticeDays: 30 })]
    expect(sharedMoveOutNoticeDays(facilities)).toBeNull()
  })
})
