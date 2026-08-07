import { describe, expect, it } from 'vitest'
import {
  ACCESS_FLAGS,
  ACCESS_FLAG_LABELS,
  flagsFor,
  isAccessFlag,
  REPEATED_DENIAL_COUNT,
} from '../packages/core/access/anomalies'

// B-064 / PRD 03 US-5 AC3. The flags a manager filters the event log by.

const base = {
  result: 'denied' as const,
  reason: 'inactive',
  credentialKnown: true,
  grantState: 'active' as string | null,
  recentDenials: 1,
}

describe('flagsFor', () => {
  it('flags a code nobody recognises', () => {
    expect(flagsFor({ ...base, reason: 'unknown_code', credentialKnown: false })).toEqual([
      'unknown_code',
    ])
  })

  it('flags an out-of-hours attempt', () => {
    expect(flagsFor({ ...base, reason: 'outside_hours' })).toEqual(['after_hours_attempt'])
  })

  it('flags an out-of-hours entry that was allowed through', () => {
    // A real vendor with hardware-side windows can let somebody in and report
    // the window as a note. An entry outside published hours is worth
    // surfacing whichever way it went.
    expect(flagsFor({ ...base, result: 'granted', reason: 'outside_hours' })).toEqual([
      'after_hours_attempt',
    ])
  })

  it('flags a suspended tenant trying the gate', () => {
    expect(flagsFor({ ...base, grantState: 'suspended' })).toEqual(['suspended_attempt'])
  })

  it('flags the fifth denial in the window, not the sixth', () => {
    expect(flagsFor({ ...base, recentDenials: REPEATED_DENIAL_COUNT - 1 })).not.toContain(
      'denied_repeated',
    )
    expect(flagsFor({ ...base, recentDenials: REPEATED_DENIAL_COUNT })).toContain('denied_repeated')
  })

  it('carries every flag that applies, not just the worst one', () => {
    // A suspended tenant trying an old code at 3am for the sixth time is four
    // separate observations. Collapsing to "most severe" would hide three of
    // them from the filter somebody is using to find exactly that pattern.
    const flags = flagsFor({
      result: 'denied',
      reason: 'outside_hours',
      credentialKnown: false,
      grantState: 'suspended',
      recentDenials: 9,
    })
    expect(flags.sort()).toEqual(
      ['after_hours_attempt', 'denied_repeated', 'suspended_attempt', 'unknown_code'].sort(),
    )
  })

  it('flags nothing on an ordinary entry', () => {
    expect(
      flagsFor({ result: 'granted', reason: 'ok', credentialKnown: true, grantState: 'active', recentDenials: 0 }),
    ).toEqual([])
  })

  it('does not flag a granted entry as a repeat denial', () => {
    // Guards the obvious inversion: `recentDenials` is a facility-wide count,
    // so a busy gate with five denials elsewhere must not tar a legitimate
    // entry that happened in the middle of them.
    expect(
      flagsFor({ result: 'granted', reason: 'ok', credentialKnown: true, grantState: 'active', recentDenials: 20 }),
    ).toEqual([])
  })
})

describe('the flag catalog', () => {
  it('labels every flag it declares', () => {
    for (const flag of ACCESS_FLAGS) {
      expect(ACCESS_FLAG_LABELS[flag]).toBeTruthy()
      expect(isAccessFlag(flag)).toBe(true)
    }
  })

  it('rejects a string that is not a flag', () => {
    // The event log filter takes this straight off a query string.
    expect(isAccessFlag('long_dwell')).toBe(false)
    expect(isAccessFlag('')).toBe(false)
  })
})
