import { describe, expect, it } from 'vitest'
import { csvCents, csvField, csvPercent, toCsv } from '../apps/web/lib/admin/csv'

// B-042 / PRD 02 US-39's "CSV export matching on-screen data exactly."

describe('csvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('A-101')).toBe('A-101')
    expect(csvField(42)).toBe('42')
  })

  it('quotes commas, quotes and newlines per RFC 4180', () => {
    expect(csvField('Smith, Jane')).toBe('"Smith, Jane"')
    expect(csvField('10" unit')).toBe('"10"" unit"')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('renders null and undefined as empty, not as the words', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('neutralises a spreadsheet formula in tenant-supplied text', () => {
    // A tenant named `=1+1` (or, less playfully, one whose name starts with a
    // hyphen) must not become a live formula when staff open the export.
    expect(csvField('=1+1')).toBe('"\t=1+1"')
    expect(csvField('+SUM(A1:A9)')).toBe('"\t+SUM(A1:A9)"')
    expect(csvField('-Smith')).toBe('"\t-Smith"')
    expect(csvField('@import')).toBe('"\t@import"')
  })
})

describe('toCsv', () => {
  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv(['Unit', 'Rate'], [['A-1', '129.00']])
    expect(csv).toBe('Unit,Rate\r\nA-1,129.00')
  })

  it('handles an empty row set without losing the header', () => {
    expect(toCsv(['Unit'], [])).toBe('Unit')
  })
})

describe('number formatting', () => {
  it('renders cents as a plain decimal a spreadsheet reads as a number', () => {
    expect(csvCents(12_900)).toBe('129.00')
    expect(csvCents(0)).toBe('0.00')
    expect(csvCents(-500)).toBe('-5.00')
  })

  it('renders a ratio as a one-decimal percentage, matching the screen', () => {
    expect(csvPercent(0.5)).toBe('50.0')
    expect(csvPercent(202 / 402)).toBe('50.2')
    expect(csvPercent(0)).toBe('0.0')
  })
})
