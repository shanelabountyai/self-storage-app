import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { signatureMatchesName } from '../apps/web/lib/lease/template'
import { signDocument, validateSignature, verifySignature } from '../apps/web/lib/lease/sign'
import { storeGeneratedDocument } from '../apps/web/lib/documents/store'

// B-024 / PRD 01 US-501 step 4, FR-4.2.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
let facilityId = ''

describe('typed signature attribution', () => {
  it('accepts the name as it appears on the lease', () => {
    expect(signatureMatchesName('Ada Renter', 'Ada Renter')).toBe(true)
    expect(signatureMatchesName('  ada   renter ', 'Ada Renter')).toBe(true)
  })

  it('accepts a middle name included or omitted', () => {
    // A real signer does this constantly, and rejecting it would send them
    // round a loop for no benefit.
    expect(signatureMatchesName('Ada May Renter', 'Ada Renter')).toBe(true)
    expect(signatureMatchesName('Ada Renter', 'Ada May Renter')).toBe(true)
  })

  it('rejects what people actually type when they are not signing', () => {
    // The common real errors — initials, agreement words, someone else.
    expect(signatureMatchesName('AR', 'Ada Renter')).toBe(false)
    expect(signatureMatchesName('yes', 'Ada Renter')).toBe(false)
    expect(signatureMatchesName('I agree', 'Ada Renter')).toBe(false)
    expect(signatureMatchesName('Bob Other', 'Ada Renter')).toBe(false)
    expect(signatureMatchesName('', 'Ada Renter')).toBe(false)
  })
})

describe('validateSignature', () => {
  it('asks for consent separately from the signature', () => {
    // E-SIGN: consent to transact electronically is its own affirmative act,
    // so it gets its own error and is never folded into the name field.
    const errors = validateSignature({ typedName: 'Ada Renter', legalName: 'Ada Renter', consented: false })
    expect(errors.consented).toBeDefined()
    expect(errors.typedName).toBeUndefined()
  })

  it('tells the signer exactly what to type', () => {
    // 3.3.2/3.3.3 — the instruction is in the message, not only in a hint.
    const errors = validateSignature({ typedName: 'AR', legalName: 'Ada Renter', consented: true })
    expect(errors.typedName).toMatch(/Ada Renter/)
  })

  it('passes a complete signature', () => {
    expect(
      validateSignature({ typedName: 'Ada Renter', legalName: 'Ada Renter', consented: true }),
    ).toEqual({})
  })
})

describeDb('signing evidence', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Lease Test',
        slug: `lease-${suffix}`,
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
    await prisma.documentSignature.deleteMany({ where: { document: { facilityId } } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  async function makeLease(subject: string) {
    const { id } = await storeGeneratedDocument({
      facilityId,
      type: 'lease',
      subjectType: 'CheckoutSession',
      subjectId: subject,
      title: 'Storage rental agreement',
      template: '<p>Rent is {{rate}} per month.</p>',
      values: { rate: '$129' },
    })
    return id
  }

  it('records consent, attribution and the hash of what was on screen', async () => {
    const documentId = await makeLease(`sign-${suffix}`)
    const result = await signDocument({
      documentId,
      typedName: 'Ada Renter',
      legalName: 'Ada Renter',
      consented: true,
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 test',
    })
    expect(result.ok).toBe(true)

    const signature = await prisma.documentSignature.findUniqueOrThrow({ where: { documentId } })
    expect(signature.consentedToElectronicRecords).toBe(true)
    expect(signature.ipAddress).toBe('203.0.113.9')
    expect(signature.userAgent).toBe('Mozilla/5.0 test')
    expect(signature.typedName).toBe('Ada Renter')

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
    // The signature binds the document as rendered, not a hash the form sent.
    expect(signature.signedContentHash).toBe(document.contentHash)

    expect(await verifySignature(documentId)).toMatchObject({ ok: true, typedName: 'Ada Renter' })
  })

  it('refuses to sign the same lease twice', async () => {
    const documentId = await makeLease(`twice-${suffix}`)
    await signDocument({ documentId, typedName: 'Ada Renter', legalName: 'Ada Renter', consented: true })

    // Not an error the renter should see, but it must never overwrite the
    // first signature's evidence.
    expect(
      await signDocument({ documentId, typedName: 'Someone Else', legalName: 'Ada Renter', consented: true }),
    ).toMatchObject({ ok: false, reason: 'already_signed' })

    const signature = await prisma.documentSignature.findUniqueOrThrow({ where: { documentId } })
    expect(signature.typedName).toBe('Ada Renter')
  })

  it('refuses to sign a document that has already been altered', async () => {
    const documentId = await makeLease(`altered-${suffix}`)
    await prisma.document.update({ where: { id: documentId }, data: { content: '<p>Rent is $12.</p>' } })

    // A signature over a document that already changed is worse than none.
    expect(
      await signDocument({ documentId, typedName: 'Ada Renter', legalName: 'Ada Renter', consented: true }),
    ).toMatchObject({ ok: false, reason: 'document_changed' })
  })

  it('detects a lease altered after it was signed', async () => {
    const documentId = await makeLease(`tamper-${suffix}`)
    await signDocument({ documentId, typedName: 'Ada Renter', legalName: 'Ada Renter', consented: true })

    // Both the content AND the document's own hash updated together — the case
    // that would fool a check against Document.contentHash alone.
    await prisma.document.update({
      where: { id: documentId },
      data: {
        content: '<p>Rent is $12 per month.</p>',
        contentHash: 'f'.repeat(64),
      },
    })

    expect(await verifySignature(documentId)).toMatchObject({
      ok: false,
      reason: 'altered_since_signing',
    })
  })

  it('reports an unsigned lease as unsigned', async () => {
    const documentId = await makeLease(`unsigned-${suffix}`)
    expect(await verifySignature(documentId)).toMatchObject({ ok: false, reason: 'unsigned' })
  })
})
