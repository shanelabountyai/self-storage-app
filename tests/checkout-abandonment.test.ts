import { describe, expect, it } from 'vitest'
import {
  abandonmentExitReason,
  abandonmentStepDue,
  DEFAULT_ABANDONMENT_HOURS,
  InvalidAbandonmentScheduleError,
  parseAbandonmentHours,
} from '../packages/core/checkout/abandonment'

// B-073 / PRD 04 §3.6 US-9, FR-LEAD-4.

const HOUR = 3_600_000

describe('abandonmentStepDue — AC1/AC2’s ladder', () => {
  const created = new Date('2026-07-01T12:00:00Z')

  it('step 1 is due at the default +1h', () => {
    expect(abandonmentStepDue(created, 1, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 59 * 60_000))).toBe(false)
    expect(abandonmentStepDue(created, 1, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + HOUR))).toBe(true)
  })

  it('step 2 is due at +24h', () => {
    expect(abandonmentStepDue(created, 2, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 23 * HOUR))).toBe(false)
    expect(abandonmentStepDue(created, 2, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 24 * HOUR))).toBe(true)
  })

  it('step 3 is due at +72h', () => {
    expect(abandonmentStepDue(created, 3, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 71 * HOUR))).toBe(false)
    expect(abandonmentStepDue(created, 3, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 72 * HOUR))).toBe(true)
  })

  it('stays due after its hour — a missed cron tick still catches up', () => {
    expect(abandonmentStepDue(created, 1, DEFAULT_ABANDONMENT_HOURS, new Date(created.getTime() + 10 * HOUR))).toBe(true)
  })

  it('respects a facility’s own configured offsets, not the default', () => {
    const custom = [2, 48, 96] as const
    expect(abandonmentStepDue(created, 1, custom, new Date(created.getTime() + HOUR))).toBe(false)
    expect(abandonmentStepDue(created, 1, custom, new Date(created.getTime() + 2 * HOUR))).toBe(true)
  })
})

describe('abandonmentExitReason — AC2’s halt condition', () => {
  it('halts on completion', () => {
    expect(abandonmentExitReason({ status: 'completed' })).toBe('completed')
  })

  it('does NOT halt on expired — a lapsed lock is the ordinary case, not an exit', () => {
    // The whole premise of the sequence: by +1h the 30-minute lock has long
    // since lapsed. Treating that as an exit would mean the sequence never
    // runs at all.
    expect(abandonmentExitReason({ status: 'expired' })).toBeNull()
  })

  it('does not halt while still active', () => {
    expect(abandonmentExitReason({ status: 'active' })).toBeNull()
  })
})

describe('parseAbandonmentHours — AC2’s "configurable"', () => {
  it('accepts three increasing offsets', () => {
    expect(parseAbandonmentHours('1, 24, 72')).toEqual([1, 24, 72])
  })

  it('refuses anything other than exactly three', () => {
    expect(() => parseAbandonmentHours('1, 24')).toThrow(InvalidAbandonmentScheduleError)
    expect(() => parseAbandonmentHours('1, 24, 72, 96')).toThrow(InvalidAbandonmentScheduleError)
    expect(() => parseAbandonmentHours('')).toThrow(InvalidAbandonmentScheduleError)
  })

  it('refuses a non-increasing schedule', () => {
    expect(() => parseAbandonmentHours('24, 1, 72')).toThrow(InvalidAbandonmentScheduleError)
    expect(() => parseAbandonmentHours('1, 1, 72')).toThrow(InvalidAbandonmentScheduleError)
  })

  it('refuses an out-of-range hour', () => {
    expect(() => parseAbandonmentHours('0, 24, 72')).toThrow(InvalidAbandonmentScheduleError)
    expect(() => parseAbandonmentHours('1, 24, 1000')).toThrow(InvalidAbandonmentScheduleError)
  })
})
