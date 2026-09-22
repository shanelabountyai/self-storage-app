import { describe, expect, it } from 'vitest'
import { sortByDistance } from '../apps/web/lib/marketing/home-facts'
import type { HomeFacility } from '../apps/web/lib/marketing/home-facts'

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
