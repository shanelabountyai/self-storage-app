import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  contentMatchesHash,
  hashContent,
  MissingMergeFieldsError,
  mergeFieldsIn,
  renderDocument,
  renderTemplate,
} from '../apps/web/lib/documents/render'
import {
  documentsFor,
  softDeleteDocument,
  storeGeneratedDocument,
  verifyDocument,
} from '../apps/web/lib/documents/store'

// B-023 / PRD 02 FR-6, US-16.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
let facilityId = ''

describe('merge-field validation', () => {
  const template = '<p>Dear {{firstName}} {{lastName}}, your unit is {{unitNumber}}.</p>'

  it('lists the fields a template needs', () => {
    expect(mergeFieldsIn(template)).toEqual(['firstName', 'lastName', 'unitNumber'])
  })

  it('fills every field', () => {
    const html = renderTemplate(template, {
      firstName: 'Ada',
      lastName: 'Renter',
      unitNumber: 'A-1',
    })
    expect(html).toBe('<p>Dear Ada Renter, your unit is A-1.</p>')
  })

  it('fails loudly rather than rendering a hole', () => {
    // FR-6's actual requirement. A lease that renders "Dear " is a document
    // somebody signs — silence here produces a legal artifact with a gap in it.
    expect(() => renderTemplate(template, { firstName: 'Ada' })).toThrow(MissingMergeFieldsError)
    try {
      renderTemplate(template, { firstName: 'Ada' })
    } catch (error) {
      expect((error as MissingMergeFieldsError).fields).toEqual(['lastName', 'unitNumber'])
    }
  })

  it('treats a blank value as missing', () => {
    // An empty string is the same hole as an absent key, and is how a missing
    // value usually arrives from a form.
    expect(() =>
      renderTemplate(template, { firstName: 'Ada', lastName: '   ', unitNumber: 'A-1' }),
    ).toThrow(MissingMergeFieldsError)
  })

  it('escapes merged values', () => {
    // A lease is exactly where someone would try. A surname with an ampersand
    // must not be able to break the document either.
    const html = renderTemplate('<p>{{name}}</p>', {
      name: '<script>alert(1)</script> Smith & Sons',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Smith &amp; Sons')
  })

  describe('the rawFields seam (B-061)', () => {
    // One merge field in the whole system carries markup rather than a value:
    // B-061's itemized claim table. These pin the blast radius.

    it('escapes everything by default — the seam is opt-in per call', () => {
      const html = renderTemplate('<p>{{name}}</p>', { name: '<b>bold</b>' })
      expect(html).toContain('&lt;b&gt;')
    })

    it('passes through only the fields the CALLER named', () => {
      const html = renderTemplate('<p>{{safe}}{{unsafe}}</p>', {
        safe: '<table></table>',
        unsafe: '<script>alert(1)</script>',
      }, ['safe'])
      expect(html).toContain('<table></table>')
      // The field not named is still escaped, in the same render.
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('cannot be reached from template text', () => {
      // A notice template is edited by an operator. If a template could opt
      // its own field into raw rendering, an operator (or anyone who got at
      // the template) could inject markup into a legal document. The field
      // list comes from calling code only, so a template naming a field that
      // is not on the caller's list gets escaped like anything else.
      const html = renderTemplate('<p>{{payload}}</p>', {
        payload: '<script>alert(1)</script>',
      })
      expect(html).not.toContain('<script>')
    })

    it('still fails loudly on a missing raw field', () => {
      expect(() => renderTemplate('<p>{{claimTable}}</p>', { claimTable: '  ' }, ['claimTable'])).toThrow(
        MissingMergeFieldsError,
      )
    })
  })
})

describe('rendered documents', () => {
  const rendered = renderDocument({
    title: 'Storage lease',
    template: '<h2>Terms</h2><p>Rate: {{rate}}</p>',
    values: { rate: '$129/mo' },
  })

  it('carries the things a tagged PDF would have to carry', () => {
    // lang, a real <title>, one <h1>, and real text rather than raster.
    expect(rendered.html).toContain('<html lang="en">')
    expect(rendered.html).toContain('<title>Storage lease</title>')
    expect(rendered.html).toContain('<h1>Storage lease</h1>')
    expect(rendered.html).toContain('<h2>Terms</h2>')
  })

  it('hashes the exact rendered bytes', () => {
    expect(rendered.contentHash).toBe(hashContent(rendered.html))
    expect(contentMatchesHash(rendered.html, rendered.contentHash)).toBe(true)
    // FR-4.2's evidence: a document that changed after signing no longer
    // matches.
    expect(contentMatchesHash(rendered.html + ' ', rendered.contentHash)).toBe(false)
  })

  it('produces a different hash for different content', () => {
    const other = renderDocument({
      title: 'Storage lease',
      template: '<h2>Terms</h2><p>Rate: {{rate}}</p>',
      values: { rate: '$229/mo' },
    })
    expect(other.contentHash).not.toBe(rendered.contentHash)
  })
})

describeDb('document store', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Doc Test',
        slug: `doc-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.auditLog.deleteMany({ where: { facilityId } }).catch(() => undefined)
    await prisma.facility.deleteMany({ where: { id: facilityId } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('stores a generated document with its hash', async () => {
    const { id, rendered } = await storeGeneratedDocument({
      facilityId,
      type: 'lease',
      subjectType: 'Lease',
      subjectId: `lease-${suffix}`,
      title: 'Storage lease',
      template: '<p>Unit {{unit}}</p>',
      values: { unit: 'A-1' },
    })

    const stored = await prisma.document.findUniqueOrThrow({ where: { id } })
    expect(stored.contentHash).toBe(rendered.contentHash)
    expect(stored.mimeType).toBe('text/html; charset=utf-8')
    expect(stored.byteSize).toBeGreaterThan(0)
    expect(await verifyDocument(id)).toEqual({ ok: true })
  })

  it('writes nothing when the template has a hole', async () => {
    const before = await prisma.document.count({ where: { facilityId } })
    await expect(
      storeGeneratedDocument({
        facilityId,
        type: 'notice',
        subjectType: 'Lease',
        subjectId: `lease-${suffix}`,
        title: 'Notice',
        template: '<p>{{missing}}</p>',
        values: {},
      }),
    ).rejects.toThrow(MissingMergeFieldsError)
    expect(await prisma.document.count({ where: { facilityId } })).toBe(before)
  })

  it('detects a document that changed after it was stored', async () => {
    const { id } = await storeGeneratedDocument({
      facilityId,
      type: 'lease',
      subjectType: 'Lease',
      subjectId: `tamper-${suffix}`,
      title: 'Storage lease',
      template: '<p>Rate {{rate}}</p>',
      values: { rate: '$129' },
    })

    // Someone edits the row directly — the case the hash exists for.
    await prisma.document.update({
      where: { id },
      data: { content: '<p>Rate $12</p>' },
    })
    expect(await verifyDocument(id)).toEqual({ ok: false, reason: 'hash_mismatch' })
  })

  it('keeps every document for a subject, newest first', async () => {
    const subjectId = `multi-${suffix}`
    for (const title of ['First notice', 'Second notice']) {
      await storeGeneratedDocument({
        facilityId,
        type: 'notice',
        subjectType: 'Lease',
        subjectId,
        title,
        template: '<p>{{body}}</p>',
        values: { body: title },
      })
    }
    const found = await documentsFor('Lease', subjectId)
    expect(found).toHaveLength(2)
    expect(found[0].title).toBe('Second notice')
  })

  it('soft-deletes rather than removing evidence', async () => {
    const { id } = await storeGeneratedDocument({
      facilityId,
      type: 'lien_evidence',
      subjectType: 'Lease',
      subjectId: `soft-${suffix}`,
      title: 'Lien notice',
      template: '<p>{{body}}</p>',
      values: { body: 'served' },
    })

    await softDeleteDocument(id, { type: 'system', label: 'test' }, 'wrong tenant')

    // Gone from the list, still on disk — a lien file that loses a notice is a
    // wrongful-sale claim.
    expect(await documentsFor('Lease', `soft-${suffix}`)).toHaveLength(0)
    const row = await prisma.document.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).not.toBeNull()
    expect(row.content).not.toBeNull()
  })
})
