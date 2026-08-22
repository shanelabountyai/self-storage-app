import { describe, expect, it } from 'vitest'
import { arAgingNote } from '../apps/web/lib/admin/reports'

// B-150 / PRD 02 §4.11 US-39.4. The sentence that stops a month picker from
// implying an answer the aging table has never given.

const asOf = new Date('2026-08-22T21:12:00Z')

describe('arAgingNote', () => {
  it('names the instant in the facility clock, with the zone on it', () => {
    const note = arAgingNote(asOf, 'America/Chicago', 'August 2026')
    expect(note).toContain('August 22, 2026')
    expect(note).toContain('4:12 PM CDT')
    // The whole point: it says the range above does not apply.
    expect(note).toContain('August 2026 range above does not apply')
  })

  it('says UTC, and says why, when the facilities span zones', () => {
    const note = arAgingNote(asOf, null, 'August 2026')
    expect(note).toContain('9:12 PM UTC')
    expect(note).toContain('span more than one timezone')
  })

  it('never claims to answer for the period, the way the occupancy note can', () => {
    for (const zone of ['America/Chicago', 'America/New_York', null]) {
      expect(arAgingNote(asOf, zone, 'July 2026')).toContain('does not apply')
    }
  })
})
