import { describe, expect, it } from 'vitest'
import {
  isoDate,
  judgeStartDate,
  startDateWindow,
} from '../packages/core/checkout/start-date'

// B-106 / PRD 01 §9 Phase 2. When a checkout may be scheduled for, and — the
// part the row makes an acceptance criterion — what a refusal tells you to do.

const WINDOW = startDateWindow('2026-08-15', 60)

describe('startDateWindow', () => {
  it('opens today and runs to the facility’s own horizon', () => {
    expect(isoDate(WINDOW.earliest)).toBe('2026-08-15')
    expect(isoDate(WINDOW.latest)).toBe('2026-10-14')
  })

  it('takes the facility-local date, not an instant', () => {
    // At 10pm in Texas the UTC date is already tomorrow. A renter told they
    // cannot pick today would be reading a timezone bug, so the window is
    // built from the local calendar date `businessDateFor` produces.
    expect(isoDate(startDateWindow('2026-12-31', 1).latest)).toBe('2027-01-01')
  })

  it('collapses to today when a facility allows no scheduling', () => {
    const sameDay = startDateWindow('2026-08-15', 0)
    expect(isoDate(sameDay.earliest)).toBe(isoDate(sameDay.latest))
  })
})

describe('judgeStartDate', () => {
  it('accepts today, the horizon, and anything between', () => {
    expect(judgeStartDate('2026-08-15', WINDOW).ok).toBe(true)
    expect(judgeStartDate('2026-09-20', WINDOW).ok).toBe(true)
    expect(judgeStartDate('2026-10-14', WINDOW).ok).toBe(true)
  })

  it('treats an empty value as today rather than an error', () => {
    // Most checkouts never touch this field. Leaving it blank is the ordinary
    // case, not a mistake to report.
    const verdict = judgeStartDate('', WINDOW)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(isoDate(verdict.startDate)).toBe('2026-08-15')
  })

  it('refuses a date before today AND names the date to use', () => {
    const verdict = judgeStartDate('2026-08-14', WINDOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toBe('too_early')
    expect(isoDate(verdict.suggested)).toBe('2026-08-15')
    expect(verdict.message).toContain('2026-08-15')
  })

  it('refuses a date past the horizon AND names both the limit and the date', () => {
    // 3.3.3's suggestion, and the reason the row states it as a criterion: an
    // error saying only "too far ahead" leaves the renter bisecting their way
    // to a boundary they cannot see, on the screen before payment.
    const verdict = judgeStartDate('2026-12-01', WINDOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toBe('too_late')
    expect(isoDate(verdict.suggested)).toBe('2026-10-14')
    expect(verdict.message).toContain('60 days')
    expect(verdict.message).toContain('2026-10-14')
  })

  it('refuses something that is not a date, and shows the format', () => {
    // The row requires manual text entry to work, so this is reachable by
    // typing rather than only by a broken browser.
    const verdict = judgeStartDate('next tuesday', WINDOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toBe('unparseable')
    expect(verdict.message).toContain('year-month-day')
    expect(verdict.message).toContain('2026-08-15')
  })

  it('every refusal carries a usable suggestion, never a bare no', () => {
    for (const raw of ['2020-01-01', '2099-01-01', 'nonsense']) {
      const verdict = judgeStartDate(raw, WINDOW)
      expect(verdict.ok, raw).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      // The suggested date is inside the window, so acting on the message
      // always resolves the error rather than producing the other one.
      expect(verdict.suggested.getTime()).toBeGreaterThanOrEqual(WINDOW.earliest.getTime())
      expect(verdict.suggested.getTime()).toBeLessThanOrEqual(WINDOW.latest.getTime())
      expect(verdict.message).toContain(isoDate(verdict.suggested))
    }
  })
})
