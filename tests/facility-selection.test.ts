import { describe, expect, it } from 'vitest'
import {
  resolveSelectedFacility,
  type SwitcherFacility,
} from '../apps/web/lib/admin/facility-selection-logic'

const FACILITIES: SwitcherFacility[] = [
  { id: 'fac-a', name: 'Austin', slug: 'austin', timezone: 'America/Chicago' },
  { id: 'fac-b', name: 'Dallas', slug: 'dallas', timezone: 'America/Chicago' },
]

describe('resolveSelectedFacility', () => {
  it('honors a valid cookie pointing at an assigned facility', () => {
    expect(resolveSelectedFacility('fac-b', FACILITIES, false)).toEqual({
      mode: 'single',
      facility: FACILITIES[1],
    })
  })

  it('honors "all" only when allowAll is true', () => {
    expect(resolveSelectedFacility('all', FACILITIES, true)).toEqual({ mode: 'all' })
  })

  it('falls back to the first facility when "all" is requested but not allowed', () => {
    // This is the case that matters most: a stale cookie set on the dashboard
    // (where "All facilities" is offered) must not silently apply on a screen
    // that doesn't support it.
    expect(resolveSelectedFacility('all', FACILITIES, false)).toEqual({
      mode: 'single',
      facility: FACILITIES[0],
    })
  })

  it('falls back to the first facility when the cookie is missing', () => {
    expect(resolveSelectedFacility(undefined, FACILITIES, false)).toEqual({
      mode: 'single',
      facility: FACILITIES[0],
    })
  })

  it('falls back to the first facility when the cookie names one the actor no longer has', () => {
    // A role change since the cookie was set must narrow access immediately,
    // not honor a cached choice pointing at a facility that's gone.
    expect(resolveSelectedFacility('fac-revoked', FACILITIES, false)).toEqual({
      mode: 'single',
      facility: FACILITIES[0],
    })
  })

  it('falls back to "all" when there are no single facilities but all is allowed', () => {
    expect(resolveSelectedFacility(undefined, [], true)).toEqual({ mode: 'all' })
  })

  it('falls back to "none" when there is nothing to select at all', () => {
    expect(resolveSelectedFacility(undefined, [], false)).toEqual({ mode: 'none' })
    expect(resolveSelectedFacility('fac-a', [], false)).toEqual({ mode: 'none' })
  })
})
