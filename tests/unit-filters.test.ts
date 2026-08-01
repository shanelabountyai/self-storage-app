import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  hasActiveFilters,
  parseFilters,
} from '../apps/web/lib/inventory/unit-filters'
import type { PublicUnitType } from '../apps/web/lib/inventory/public-inventory'

// B-017 / PRD 01 US-201.

function unitType(overrides: Partial<PublicUnitType>): PublicUnitType {
  return {
    unitTypeId: overrides.name ?? 'id',
    name: 'unit',
    widthFt: 10,
    lengthFt: 10,
    heightFt: 8,
    sqFt: 100,
    climateControlled: false,
    driveUp: false,
    floor: 1,
    powerAvailable: false,
    description: null,
    availableCount: 5,
    streetRateCents: 14_900,
    webRateCents: 12_900,
    quote: { token: 't', expiresAt: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  }
}

const LOCKER = unitType({ name: 'locker', sqFt: 25, webRateCents: 5_900, climateControlled: true })
const MEDIUM = unitType({ name: 'medium', sqFt: 100, webRateCents: 12_900, climateControlled: true })
const LARGE = unitType({ name: 'large', sqFt: 200, webRateCents: 22_900, driveUp: true, floor: 2 })
const ALL = [LARGE, LOCKER, MEDIUM]

describe('parseFilters', () => {
  it('defaults to price low→high with nothing filtered', () => {
    const filters = parseFilters({})
    expect(filters).toEqual({ size: undefined, features: [], sort: 'price' })
    expect(hasActiveFilters(filters)).toBe(false)
  })

  it('accepts a single feature or several', () => {
    expect(parseFilters({ features: 'climate' }).features).toEqual(['climate'])
    expect(parseFilters({ features: ['climate', 'driveUp'] }).features).toEqual([
      'climate',
      'driveUp',
    ])
  })

  it('ignores values it does not recognise rather than emptying the list', () => {
    // These arrive in a URL anyone can edit. A bogus filter must degrade to "no
    // filter", not to a blank page the visitor cannot explain.
    const filters = parseFilters({ size: 'enormous', features: ['climate', 'nonsense'], sort: 'wat' })
    expect(filters.size).toBeUndefined()
    expect(filters.features).toEqual(['climate'])
    expect(filters.sort).toBe('price')
  })
})

describe('applyFilters', () => {
  it('sorts by price ascending by default', () => {
    const result = applyFilters(ALL, parseFilters({}))
    expect(result.map((u) => u.name)).toEqual(['locker', 'medium', 'large'])
  })

  it('sorts by size when asked', () => {
    const result = applyFilters(ALL, parseFilters({ sort: 'size' }))
    expect(result.map((u) => u.sqFt)).toEqual([25, 100, 200])
  })

  it('bands sizes by square footage, not by name', () => {
    // An operator naming a type "Small Locker" must not change which band it
    // falls into.
    expect(applyFilters(ALL, parseFilters({ size: 'small' })).map((u) => u.name)).toEqual(['locker'])
    expect(applyFilters(ALL, parseFilters({ size: 'medium' })).map((u) => u.name)).toEqual(['medium'])
    expect(applyFilters(ALL, parseFilters({ size: 'large' })).map((u) => u.name)).toEqual(['large'])
  })

  it('ANDs multiple features', () => {
    // Ticking two boxes means both, even though that often returns nothing.
    const both = applyFilters(ALL, parseFilters({ features: ['climate', 'driveUp'] }))
    expect(both).toEqual([])

    const climate = applyFilters(ALL, parseFilters({ features: ['climate'] }))
    expect(climate.map((u) => u.name)).toEqual(['locker', 'medium'])
  })

  it('treats ground floor as floor 1 or lower', () => {
    const ground = applyFilters(ALL, parseFilters({ features: ['groundFloor'] }))
    expect(ground.map((u) => u.name)).toEqual(['locker', 'medium'])
  })

  it('does not mutate the list it was given', () => {
    const original = [...ALL]
    applyFilters(ALL, parseFilters({ sort: 'size' }))
    expect(ALL).toEqual(original)
  })
})
