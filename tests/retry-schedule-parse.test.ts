import { describe, expect, it } from 'vitest'
import {
  InvalidRetryScheduleError,
  parseRetryDays,
} from '../apps/web/lib/admin/facility-settings'

// The retry schedule, typed by a person into a settings form.

describe('parseRetryDays', () => {
  it('reads the ordinary case', () => {
    expect(parseRetryDays('1, 3, 5')).toEqual([1, 3, 5])
  })

  it('accepts spaces, commas or both', () => {
    expect(parseRetryDays('1 3 5')).toEqual([1, 3, 5])
    expect(parseRetryDays('1,3,5')).toEqual([1, 3, 5])
    expect(parseRetryDays('  2 ,  7 ')).toEqual([2, 7])
  })

  it('treats empty as no retries, which is a real choice', () => {
    expect(parseRetryDays('')).toEqual([])
    expect(parseRetryDays('   ')).toEqual([])
  })

  it('insists the days increase', () => {
    // The offsets count from the ORIGINAL due date, not from the last attempt
    // (D-25's anchoring rule) — so "1, 3, 2" is not a schedule that retries
    // sooner, it is one whose third attempt is already in the past when its
    // second fires.
    expect(() => parseRetryDays('1, 3, 2')).toThrow(InvalidRetryScheduleError)
    expect(() => parseRetryDays('3, 3')).toThrow(InvalidRetryScheduleError)
  })

  it('explains the ordering rule rather than just refusing', () => {
    // 3.3.3: a field error carries a suggestion, not only an identification.
    expect(() => parseRetryDays('5, 1')).toThrow(/increasing order/)
  })

  it('rejects anything that is not a whole number of days', () => {
    expect(() => parseRetryDays('1, x, 5')).toThrow(InvalidRetryScheduleError)
    expect(() => parseRetryDays('1.5')).toThrow(InvalidRetryScheduleError)
    expect(() => parseRetryDays('0')).toThrow(InvalidRetryScheduleError)
    expect(() => parseRetryDays('-1')).toThrow(InvalidRetryScheduleError)
  })

  it('refuses a schedule longer than a card will forgive', () => {
    expect(() => parseRetryDays('1,2,3,4,5,6,7')).toThrow(InvalidRetryScheduleError)
  })

  it('names the offending value so the person can find it', () => {
    expect(() => parseRetryDays('1, banana, 5')).toThrow(/"banana"/)
  })
})
