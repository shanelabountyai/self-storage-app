import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { downloadHeaders, readUpload, storeUpload } from '../apps/web/lib/documents/storage'
import { submitInsuranceProof } from '../apps/web/lib/protection/changes'
import { tenantOwnsDocument } from '../apps/web/lib/portal/documents'

// B-104 follow-up, against real rows. The blob itself is faked — a test that
// reached a real bucket would be a test that needs a token and a network — but
// everything around it is real: validation, the `Document` row, the hash, and
// the ownership check the download route depends on.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseId = ''

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x41])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')

/// A stand-in blob store. Records what it was asked to keep so the test can
/// assert on the path and the bytes.
function fakeStore() {
  const written = new Map<string, { bytes: Uint8Array; contentType: string }>()
  return {
    written,
    put: async (path: string, bytes: Uint8Array, contentType: string) => {
      written.set(path, { bytes, contentType })
      return { url: `https://blob.test/${path}` }
    },
    get: async (url: string) => {
      const path = url.replace('https://blob.test/', '')
      return written.get(path)?.bytes ?? null
    },
  }
}

describeDb('uploaded documents', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Docs ${suffix}`,
        slug: `docs-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `D-${suffix.slice(0, 4)}` },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `d-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const other = await prisma.tenant.create({
      data: { email: `d-o-${suffix}@example.com`, firstName: 'Otto', lastName: 'Other' },
    })
    otherTenantId = other.id

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    // Facility stays: `audit_log` RESTRICT-references it.
  })

  it('stores the bytes and writes a Document row', async () => {
    const store = fakeStore()
    const result = await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: PDF,
        declaredType: 'application/pdf',
        filename: 'declaration.pdf',
        fallbackTitle: 'Proof of insurance',
      },
      store.put,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const document = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } })
    expect(document.mimeType).toBe('application/pdf')
    expect(document.byteSize).toBe(PDF.length)
    expect(document.storageRef).toMatch(/^https:\/\/blob\.test\//)
    // The evidence hash generated documents already carry: a file whose hash no
    // longer matches is a file that changed after it was accepted.
    expect(document.contentHash).toBe(createHash('sha256').update(PDF).digest('hex'))
  })

  it('never puts tenant bytes in the `content` column', async () => {
    // `content` is what the portal document viewer renders with
    // dangerouslySetInnerHTML. Nothing tenant-authored may reach it.
    const store = fakeStore()
    const result = await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: PDF,
        fallbackTitle: 'Proof',
      },
      store.put,
    )
    if (!result.ok) return
    const document = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } })
    expect(document.content).toBeNull()
  })

  it('refuses HTML dressed as an image, and writes nothing', async () => {
    const store = fakeStore()
    const result = await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: HTML,
        declaredType: 'image/png',
        fallbackTitle: 'Proof',
      },
      store.put,
    )
    expect(result.ok).toBe(false)
    expect(store.written.size).toBe(0)
    expect(await prisma.document.count({ where: { facilityId } })).toBe(0)
  })

  it('stores under a path that does not contain the filename', async () => {
    const store = fakeStore()
    await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: PDF,
        filename: 'my policy for 12 Oak Street.pdf',
        fallbackTitle: 'Proof',
      },
      store.put,
    )
    const [path] = [...store.written.keys()]
    expect(path).not.toContain('Oak')
    expect(path).toMatch(/^[^/]+\/insurance_proof\/[0-9a-f-]+\.pdf$/)
  })

  it('reads the bytes back', async () => {
    const store = fakeStore()
    const stored = await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: PDF,
        fallbackTitle: 'Proof',
      },
      store.put,
    )
    if (!stored.ok) throw new Error('unreachable')

    const read = await readUpload(stored.documentId, store.get)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Buffer.from(read.bytes).equals(Buffer.from(PDF))).toBe(true)
  })

  it('reports a blob that has vanished rather than throwing', async () => {
    const store = fakeStore()
    const stored = await storeUpload(
      {
        facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: leaseId,
        bytes: PDF,
        fallbackTitle: 'Proof',
      },
      store.put,
    )
    if (!stored.ok) throw new Error('unreachable')
    store.written.clear()

    expect(await readUpload(stored.documentId, store.get)).toEqual({ ok: false, reason: 'gone' })
  })

  describe('who may download it', () => {
    async function storeForLease() {
      const store = fakeStore()
      const stored = await storeUpload(
        {
          facilityId,
          type: 'insurance_proof',
          subjectType: 'Lease',
          subjectId: leaseId,
          bytes: PDF,
          fallbackTitle: 'Proof',
        },
        store.put,
      )
      if (!stored.ok) throw new Error('unreachable')
      return stored.documentId
    }

    it('lets the tenant it belongs to', async () => {
      expect(await tenantOwnsDocument(tenantId, await storeForLease())).toBe(true)
    })

    it('refuses another tenant', async () => {
      expect(await tenantOwnsDocument(otherTenantId, await storeForLease())).toBe(false)
    })

    it('refuses a document type the tenant is not a party to', async () => {
      // The same store holds lien evidence and inspection photos against these
      // very leases, and those are the operator's file.
      const store = fakeStore()
      const stored = await storeUpload(
        {
          facilityId,
          type: 'lien_evidence',
          subjectType: 'Lease',
          subjectId: leaseId,
          bytes: PDF,
          fallbackTitle: 'Evidence',
        },
        store.put,
      )
      if (!stored.ok) throw new Error('unreachable')
      expect(await tenantOwnsDocument(tenantId, stored.documentId)).toBe(false)
    })
  })

  describe('downloadHeaders', () => {
    it('forces a download and stops content sniffing', () => {
      const headers = downloadHeaders('application/pdf', 'declaration.pdf') as Record<string, string>
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['Content-Disposition']).toContain('attachment')
      // Even a type we got wrong is downloaded rather than rendered in our
      // origin, and a shared cache never keeps somebody's insurance paperwork.
      expect(headers['Cache-Control']).toContain('no-store')
    })

    it('cannot have a header injected through the filename', () => {
      const headers = downloadHeaders('application/pdf', 'a"\r\nX-Evil: 1') as Record<string, string>
      expect(headers['Content-Disposition']).not.toContain('X-Evil: 1\r')
      expect(headers['Content-Disposition']).toBe('attachment; filename="aX-Evil: 1"')
    })
  })

  describe('the insurance-proof flow end to end', () => {
    it('attaches the document to the waiver', async () => {
      const store = fakeStore()
      const result = await submitInsuranceProof(
        {
          tenantId,
          leaseId,
          carrier: 'State Farm',
          policyNumber: 'SF-1',
          expiresAt: new Date('2099-01-01T00:00:00Z'),
          document: { bytes: PDF, declaredType: 'application/pdf', filename: 'dec.pdf' },
        },
        store.put,
      )
      expect(result).toEqual({ ok: true, documentProblem: null })

      const waiver = await prisma.protectionWaiver.findUniqueOrThrow({ where: { leaseId } })
      expect(waiver.documentRef).toBeTruthy()
      expect(await prisma.document.count({ where: { facilityId, type: 'insurance_proof' } })).toBe(1)
    })

    it('keeps the policy details even when the file is rejected', async () => {
      // The expiry date is what stops D-17 auto-enrolling them into a paid
      // plan. Losing it because a photo was the wrong format would be the far
      // worse failure.
      const store = fakeStore()
      const result = await submitInsuranceProof(
        {
          tenantId,
          leaseId,
          carrier: 'State Farm',
          policyNumber: 'SF-2',
          expiresAt: new Date('2099-01-01T00:00:00Z'),
          document: { bytes: HTML, declaredType: 'image/png', filename: 'evil.png' },
        },
        store.put,
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.documentProblem).toBeTruthy()

      const waiver = await prisma.protectionWaiver.findUniqueOrThrow({ where: { leaseId } })
      expect(waiver.carrier).toBe('State Farm')
      expect(waiver.expiresAt?.toISOString().slice(0, 10)).toBe('2099-01-01')
      expect(waiver.documentRef).toBeNull()
    })

    it('still works with no file at all', async () => {
      const result = await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'State Farm',
        policyNumber: 'SF-3',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      expect(result).toEqual({ ok: true, documentProblem: null })
    })
  })
})
