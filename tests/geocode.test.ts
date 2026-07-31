import { describe, expect, it } from 'vitest'
import { distanceMiles, geocodeQuery } from '../apps/web/lib/geo/geocode'

// US-101. The geocoder resolves against a bundled dataset, so these assert real
// coordinates rather than mocking a provider — the whole point of not taking a
// network dependency is that the tests can be this concrete.

describe('geocodeQuery', () => {
  it('resolves a zip to its centroid', () => {
    expect(geocodeQuery('78704')).toEqual({
      latitude: 30.2428,
      longitude: -97.7658,
      label: 'Austin, TX 78704',
    })
  })

  it('is tolerant of casing and whitespace', () => {
    // US-101 AC. All four spellings are the same request.
    const canonical = geocodeQuery('Austin, TX')
    for (const variant of ['austin, tx', '  Austin,TX  ', 'AUSTIN   TX', 'austin tx']) {
      expect(geocodeQuery(variant), variant).toEqual(canonical)
    }
  })

  it('resolves a bare city name', () => {
    const austin = geocodeQuery('austin')
    expect(austin?.label).toBe('Austin, TX')
    // Averaged over the city's zip centroids, so it lands in Austin rather than
    // on whichever zip sorts first.
    expect(austin!.latitude).toBeCloseTo(30.3, 0)
    expect(austin!.longitude).toBeCloseTo(-97.8, 0)
  })

  it('resolves cities outside the states we operate in', () => {
    // Deliberate: a searcher in Tulsa should reach the "nearest facilities
    // beyond the radius" state, which needs a real point. Failing to geocode
    // would drop them onto the "we couldn't find that" dead end instead.
    expect(geocodeQuery('tulsa')?.label).toBe('Tulsa, OK')
  })

  it('picks the most prominent match for an ambiguous city, and says which', () => {
    const springfield = geocodeQuery('springfield')
    // Not a dead end, and the label names the state so the user can correct it.
    expect(springfield?.label).toBe('Springfield, IL')
    expect(geocodeQuery('Springfield, MA')?.label).toBe('Springfield, MA')
  })

  it('rejects things that are not places', () => {
    // 00000 is syntactically a zip but is not assigned to anywhere; guessing
    // would rank facilities against a point the user never asked for.
    for (const bad of ['00000', '', '   ', 'zzzz', 'not a real place']) {
      expect(geocodeQuery(bad), bad).toBeNull()
    }
  })
})

describe('distanceMiles', () => {
  it('agrees with a known distance', () => {
    const austin = geocodeQuery('78704')!
    const dallas = geocodeQuery('75201')!
    // The zipcodes package computes 185 mi between these two centroids.
    expect(distanceMiles(austin, dallas)).toBeCloseTo(185, 0)
  })

  it('is zero for a point against itself and symmetric', () => {
    const a = geocodeQuery('78704')!
    const b = geocodeQuery('75201')!
    expect(distanceMiles(a, a)).toBe(0)
    expect(distanceMiles(a, b)).toBeCloseTo(distanceMiles(b, a), 10)
  })

  it('stays finite for antipodal points', () => {
    // The naive haversine can hand Math.asin a value a hair over 1 here and
    // return NaN; the clamp is what stops that.
    const distance = distanceMiles({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })
    expect(Number.isFinite(distance)).toBe(true)
    expect(distance).toBeCloseTo(12_437, -2)
  })
})
