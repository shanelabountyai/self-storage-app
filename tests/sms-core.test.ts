import { describe, expect, it } from 'vitest'
import {
  classifySmsKeyword,
  defaultNotificationPreference,
  isSmsQuietHours,
  normalizePhoneE164,
} from '../packages/core/comms'

// B-074 / PRD 05 FR-5/FR-8/CN-13/CN-14. Pure logic, no database — the rules
// worth pinning precisely because a compliance boundary (TCPA quiet hours,
// carrier-standard opt-out keywords) is the wrong place to discover an
// off-by-one from an integration test alone.

describe('normalizePhoneE164', () => {
  it('accepts 10 bare digits and prepends +1', () => {
    expect(normalizePhoneE164('5125550100')).toBe('+15125550100')
  })

  it('accepts a formatted US number', () => {
    expect(normalizePhoneE164('512-555-0100')).toBe('+15125550100')
    expect(normalizePhoneE164('(512) 555-0100')).toBe('+15125550100')
  })

  it('accepts 11 digits leading with the country code', () => {
    expect(normalizePhoneE164('15125550100')).toBe('+15125550100')
  })

  it('passes through an already-E.164 value unchanged', () => {
    expect(normalizePhoneE164('+15125550100')).toBe('+15125550100')
  })

  it('rejects too few digits', () => {
    expect(normalizePhoneE164('555010')).toBeNull()
  })

  it('rejects 11 digits not leading with 1', () => {
    expect(normalizePhoneE164('25125550100')).toBeNull()
  })

  it('rejects null, undefined and empty input', () => {
    expect(normalizePhoneE164(null)).toBeNull()
    expect(normalizePhoneE164(undefined)).toBeNull()
    expect(normalizePhoneE164('')).toBeNull()
  })

  it('rejects garbage text', () => {
    expect(normalizePhoneE164('call the office')).toBeNull()
  })
})

describe('isSmsQuietHours', () => {
  const tz = 'America/Chicago'

  it('is quiet before the window opens', () => {
    expect(isSmsQuietHours(new Date('2026-07-01T12:00:00Z'), tz, 8, 21)).toBe(true) // 7am Central
  })

  it('is not quiet right at the window opening', () => {
    expect(isSmsQuietHours(new Date('2026-07-01T13:00:00Z'), tz, 8, 21)).toBe(false) // 8am Central
  })

  it('is not quiet in the middle of the day', () => {
    expect(isSmsQuietHours(new Date('2026-07-01T18:00:00Z'), tz, 8, 21)).toBe(false) // 1pm Central
  })

  it('is quiet right at the window closing (end is exclusive)', () => {
    expect(isSmsQuietHours(new Date('2026-07-02T02:00:00Z'), tz, 8, 21)).toBe(true) // 9pm Central
  })

  it('is not quiet one minute before the window closes', () => {
    expect(isSmsQuietHours(new Date('2026-07-02T01:59:00Z'), tz, 8, 21)).toBe(false) // 8:59pm Central
  })

  it('honours a stricter per-facility override, e.g. Florida-style 8am-8pm', () => {
    expect(isSmsQuietHours(new Date('2026-07-02T01:00:00Z'), tz, 8, 20)).toBe(true) // 8pm Central
  })
})

describe('classifySmsKeyword', () => {
  it('recognises every carrier-standard STOP variant', () => {
    for (const word of ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      expect(classifySmsKeyword(word)).toBe('stop')
    }
  })

  it('recognises START and UNSTOP', () => {
    expect(classifySmsKeyword('START')).toBe('start')
    expect(classifySmsKeyword('UNSTOP')).toBe('start')
  })

  it('recognises HELP', () => {
    expect(classifySmsKeyword('HELP')).toBe('help')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(classifySmsKeyword('  stop  ')).toBe('stop')
    expect(classifySmsKeyword('Help')).toBe('help')
  })

  it('does not match a keyword embedded in a longer message', () => {
    expect(classifySmsKeyword('please stop texting me')).toBeNull()
  })

  it('returns null for an ordinary reply', () => {
    expect(classifySmsKeyword('Thanks, got it')).toBeNull()
  })
})

describe('defaultNotificationPreference', () => {
  it('defaults every category+channel to on', () => {
    expect(defaultNotificationPreference('payment_reminders', 'email')).toBe(true)
    expect(defaultNotificationPreference('payment_reminders', 'sms')).toBe(true)
    expect(defaultNotificationPreference('operational_notices', 'sms')).toBe(true)
  })

  it('defaults receipts-by-SMS to OFF (CN-6 / D-11a)', () => {
    expect(defaultNotificationPreference('receipts', 'sms')).toBe(false)
  })

  it('defaults receipts-by-email to on', () => {
    expect(defaultNotificationPreference('receipts', 'email')).toBe(true)
  })
})
