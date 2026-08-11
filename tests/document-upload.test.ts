import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_UPLOAD_TYPES,
  checkUpload,
  MAX_UPLOAD_BYTES,
  safeDisplayName,
  sniffType,
  storagePath,
  UPLOAD_PROBLEM_MESSAGES,
} from '../packages/core/documents'

// B-104 follow-up. The first place in this system where bytes arrive from the
// public internet and are kept. Every assertion below corresponds to a way of
// getting that wrong that ends in stored XSS, a leaked filename, or a request
// that never returns.

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')

describe('sniffType', () => {
  it('recognises the three formats we accept', () => {
    expect(sniffType(PDF)).toBe('application/pdf')
    expect(sniffType(JPEG)).toBe('image/jpeg')
    expect(sniffType(PNG)).toBe('image/png')
  })

  it('does not recognise HTML', () => {
    // The one that matters. A browser that sniffs an uploaded file as HTML and
    // runs it from a URL the uploader can share is stored XSS.
    expect(sniffType(HTML)).toBeNull()
  })

  it('does not recognise SVG', () => {
    // SVG is a document format that can carry script. It is deliberately not an
    // "image" as far as this system is concerned.
    expect(sniffType(SVG)).toBeNull()
  })

  it('does not read past the end of a short buffer', () => {
    expect(sniffType(Uint8Array.from([0x89, 0x50]))).toBeNull()
    expect(sniffType(new Uint8Array(0))).toBeNull()
  })
})

describe('checkUpload', () => {
  it('accepts a real PDF', () => {
    expect(checkUpload({ bytes: PDF, declaredType: 'application/pdf' })).toEqual({
      ok: true,
      mimeType: 'application/pdf',
      byteSize: PDF.length,
    })
  })

  it('decides the type from the BYTES, not from what the form said', () => {
    // The declared type is attacker-controlled. A file claiming to be a PNG and
    // containing HTML is the attack this exists to stop.
    const verdict = checkUpload({ bytes: HTML, declaredType: 'image/png' })
    expect(verdict).toEqual({ ok: false, problem: 'content_mismatch' })
  })

  it('stores the sniffed type even when the form claimed a different accepted one', () => {
    const verdict = checkUpload({ bytes: PDF, declaredType: 'image/jpeg' })
    expect(verdict.ok && verdict.mimeType).toBe('application/pdf')
  })

  it('rejects a type that is not on the list before reading it', () => {
    expect(checkUpload({ bytes: PDF, declaredType: 'image/svg+xml' })).toEqual({
      ok: false,
      problem: 'unsupported_type',
    })
  })

  it('rejects an empty file', () => {
    expect(checkUpload({ bytes: new Uint8Array(0) })).toEqual({ ok: false, problem: 'empty' })
  })

  it('rejects a file over the cap', () => {
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    huge.set(PDF)
    expect(checkUpload({ bytes: huge })).toEqual({ ok: false, problem: 'too_large' })
  })

  it('accepts one exactly at the cap', () => {
    const atCap = new Uint8Array(MAX_UPLOAD_BYTES)
    atCap.set(PDF)
    expect(checkUpload({ bytes: atCap }).ok).toBe(true)
  })

  it('works with no declared type at all', () => {
    expect(checkUpload({ bytes: JPEG }).ok).toBe(true)
  })

  it('has a message for every problem', () => {
    for (const message of Object.values(UPLOAD_PROBLEM_MESSAGES)) {
      expect(message).toBeTruthy()
    }
  })
})

describe('storagePath', () => {
  it('never uses the uploader’s filename', () => {
    const path = storagePath({
      facilityId: 'fac-1',
      documentType: 'insurance_proof',
      random: 'abc-123',
      mimeType: 'application/pdf',
    })
    // "policy for 123 Oak Street.pdf" in a URL is a privacy leak on its own,
    // quite apart from what a path separator in it would do.
    expect(path).toBe('fac-1/insurance_proof/abc-123.pdf')
  })

  it('gives each accepted type its own extension', () => {
    const forType = (mimeType: (typeof ACCEPTED_UPLOAD_TYPES)[number]) =>
      storagePath({ facilityId: 'f', documentType: 't', random: 'r', mimeType })
    expect(forType('application/pdf')).toMatch(/\.pdf$/)
    expect(forType('image/png')).toMatch(/\.png$/)
    expect(forType('image/jpeg')).toMatch(/\.jpg$/)
  })
})

describe('safeDisplayName', () => {
  it('keeps an ordinary filename', () => {
    expect(safeDisplayName('declaration.pdf', 'Document')).toBe('declaration.pdf')
  })

  it('strips path separators', () => {
    expect(safeDisplayName('../../etc/passwd', 'Document')).toBe('.. .. etc passwd')
  })

  it('strips quotes and control characters', () => {
    // This string ends up inside `Content-Disposition: attachment;
    // filename="..."`, where a stray quote or CR/LF lets the uploader write a
    // header of their own choosing.
    expect(safeDisplayName('a"b\r\nX-Evil: 1', 'Document')).toBe('abX-Evil: 1')
    expect(safeDisplayName("it's.pdf", 'Document')).toBe('its.pdf')
  })

  it('bounds the length', () => {
    expect(safeDisplayName('a'.repeat(500), 'Document')).toHaveLength(120)
  })

  it('falls back rather than returning an empty name', () => {
    expect(safeDisplayName('///', 'Document')).toBe('Document')
    expect(safeDisplayName(null, 'Document')).toBe('Document')
    expect(safeDisplayName('   ', 'Document')).toBe('Document')
  })
})
