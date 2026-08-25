import { describe, expect, it } from 'vitest'
import { fieldError, parseDate, parseScaled, stalePreview } from '../apps/web/lib/admin/form-state'

// B-094 / WCAG 3.3.4 Error Prevention (Legal, Financial, Data).
//
// Tax components and fee-schedule rows are append-only by design (PRD 02 FR-9):
// no edit, no delete. Before this, the parse was `Math.round(Number(raw) * 100)`
// with no range check, so a fat-fingered "825" in a percent field became an
// 825% tax rate applied to every future invoice, permanently.
//
// The form inputs also carry `max`, but that guard is the browser's and a
// crafted POST skips it entirely — which is exactly why this lives server-side
// and is tested here rather than through the UI.

describe('parseScaled', () => {
  const percent = { scale: 100, min: 0, max: 100, unit: 'percent' }

  it('scales a decimal to integer minor units', () => {
    expect(parseScaled('8.25', percent)).toEqual({ value: 825 })
    expect(parseScaled('0', percent)).toEqual({ value: 0 })
  })

  it('rounds rather than truncates', () => {
    // "8.255" must not silently become 8.25.
    expect(parseScaled('8.255', percent)).toEqual({ value: 826 })
  })

  it('rejects the fat-finger case with the range in the message', () => {
    const result = parseScaled('825', percent)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('0 to 100')
  })

  it('rejects things Number() would accept or coerce', () => {
    // Number('') is 0 and Number(' ') is 0 — both would have stored a real rate.
    expect(parseScaled('', percent)).toHaveProperty('error')
    expect(parseScaled('   ', percent)).toHaveProperty('error')
    expect(parseScaled('eight', percent)).toHaveProperty('error')
    expect(parseScaled(null, percent)).toHaveProperty('error')
    expect(parseScaled('Infinity', percent)).toHaveProperty('error')
    expect(parseScaled('-1', percent)).toHaveProperty('error')
  })

  it('caps fee amounts at a plausible ceiling', () => {
    const money = { scale: 100, min: 0, max: 10_000, unit: 'dollars' }
    expect(parseScaled('25', money)).toEqual({ value: 2_500 })
    expect(parseScaled('250000', money)).toHaveProperty('error')
  })
})

describe('parseDate', () => {
  it('accepts an ISO calendar date', () => {
    const result = parseDate('2026-08-01')
    expect(result).toHaveProperty('value')
    expect((result as { value: Date }).value.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('rejects rather than storing Invalid Date', () => {
    // Prisma would reject this far from the field that caused it.
    expect(parseDate('not a date')).toHaveProperty('error')
    expect(parseDate('')).toHaveProperty('error')
    expect(parseDate(null)).toHaveProperty('error')
  })
})

describe('fieldError', () => {
  it('counts the problems so the summary can be read aloud', () => {
    const one = fieldError({ state: 'bad' })
    expect(one.status).toBe('error')
    if (one.status !== 'error') throw new Error('unreachable')
    expect(one.message).toContain('one field')

    const two = fieldError({ state: 'bad', name: 'bad' })
    if (two.status !== 'error') throw new Error('unreachable')
    expect(two.message).toContain('2 fields')
  })
})

// B-173 / WCAG 3.3.4. The move-out and transfer screens price a settlement from
// the URL and commit through a server action. The date now lives IN the
// committing form, so what posts is what is on screen — and this is the half
// that stops the defect simply mirroring: a date typed after the figures were
// worked out must not commit against them either.
//
// Server-side and tested here rather than through the UI for `parseScaled`'s
// reason: the screens also refuse in the browser, and a crafted POST skips that
// entirely. This is the guard that actually holds.
describe('stalePreview', () => {
  const form = (typed: string, previewed: string): FormData => {
    const data = new FormData()
    data.set('date', typed)
    data.set('previewed_date', previewed)
    return data
  }

  const message = (typed: string) => `Press Recalculate to see what a ${typed} move-out settles to.`

  it('passes the control that still matches the figures beside it', () => {
    expect(stalePreview(form('2026-09-05', '2026-09-05'), 'date', message)).toBeNull()
  })

  it('refuses a control moved since the preview, naming the value now in it', () => {
    const stale = stalePreview(form('2026-09-05', '2026-09-01'), 'date', message)
    if (stale?.status !== 'error') throw new Error('a moved date must refuse')
    expect(stale.fieldErrors.date).toContain('2026-09-05')
  })

  // A screen whose picker is empty has nothing to disagree with; the action's
  // own date parse is what refuses that, with a message about the date rather
  // than about a preview the reader never saw move.
  it('leaves an empty control to the action that parses it', () => {
    expect(stalePreview(form('', ''), 'date', message)).toBeNull()
  })

  // The whole point: absent both fields, this cannot pass by accident. A form
  // that forgets its `previewed_` twin gets the same treatment as one that
  // matches — which is why the four screens render it as a hidden input beside
  // the control rather than deriving it anywhere else.
  it('treats a missing previewed twin as agreement, not as a pass to skip', () => {
    const data = new FormData()
    data.set('date', '2026-09-05')
    const stale = stalePreview(data, 'date', message)
    if (stale?.status !== 'error') throw new Error('a control with no previewed twin must refuse')
    expect(stale.fieldErrors.date).toContain('2026-09-05')
  })
})
