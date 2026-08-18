import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  certifiedMailAvailability,
  generateNotice,
  mailNoticeCertified,
  recordNoticeDelivery,
} from '../apps/web/lib/notices/service'
import { saveNoticeTemplate, exampleNoticeTemplate } from '../apps/web/lib/admin/notice-templates'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 §4.6 US-30 (B-083). Posting a lien notice by certified mail.
//
// **Every test here asserts a REFUSAL, and that is the design rather than a
// gap.** `mailNoticeCertified` performs every check before it calls the
// provider, precisely so that the one thing it can never do is put paper in the
// post and fail to write down that it did. What is left to test on the far side
// of that line is the provider's own HTTP behaviour, which needs credentials
// this project does not have — the honest position B-082 part 5 took for
// Search Console, and the reason there is no simulator here.
//
// No test in this file reaches the network. If one ever does, it means a
// refusal moved to the wrong side of the send.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>([
          'delinquency:execute_step',
          'tenants:view',
          'facility:settings',
        ]),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function oweOneMonth(): Promise<void> {
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `INV-${suffix}-${randomUUID().slice(0, 6)}`,
      kind: 'rent',
      status: 'open',
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-07-31T00:00:00Z'),
      issueDate: new Date('2026-07-01T00:00:00Z'),
      dueDate: new Date('2026-07-01T00:00:00Z'),
      subtotalCents: 12_900,
      taxCents: 0,
      totalCents: 12_900,
      amountPaidCents: 0,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      invoiceId: invoice.id,
      type: 'charge',
      amountCents: 12_900,
      description: 'Rent — July 2026',
      occurredAt: new Date('2026-07-01T00:00:00Z'),
    },
  })
}

async function generatedNoticeId(): Promise<string> {
  await oweOneMonth()
  const result = await generateNotice(actor(), leaseId, 'lien')
  if (!result.ok) throw new Error(`fixture could not generate a notice: ${JSON.stringify(result)}`)
  return result.noticeId
}

describeDb('certified mail', () => {
  const originalKey = process.env.CERTIFIED_MAIL_API_KEY

  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Certmail ${suffix}`,
        slug: `certmail-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        email: `certmail-${suffix}@example.com`,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `certmail-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `certmail-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `C-${suffix.slice(0, 4)}` },
    })
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
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.tenantAddress.deleteMany({ where: { tenantId } })

    await prisma.tenantAddress.create({
      data: {
        tenantId,
        addressLine1: '400 Elm Street',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        source: 'counter',
      },
    })
    await saveNoticeTemplate(actor(), facilityId, { type: 'lien', ...exampleNoticeTemplate('lien') })
    // A test-mode key, which `keyAllowed` permits outside production — so these
    // tests exercise the CONFIGURED path's refusals rather than short-circuiting
    // on "no key set".
    process.env.CERTIFIED_MAIL_API_KEY = 'test_fixture_key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CERTIFIED_MAIL_API_KEY
    else process.env.CERTIFIED_MAIL_API_KEY = originalKey
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.$disconnect()
  })

  describe('availability', () => {
    it('names the variable to set when nothing is configured', async () => {
      delete process.env.CERTIFIED_MAIL_API_KEY
      const availability = certifiedMailAvailability()
      expect(availability.available).toBe(false)
      // "Not configured" sends somebody looking. The variable name does not.
      expect(availability.available === false && availability.reason).toContain(
        'CERTIFIED_MAIL_API_KEY',
      )
      // And it points at the flow that still works, rather than at a dead end.
      expect(availability.available === false && availability.reason).toContain('record the tracking number')
    })

    it('refuses an unclassifiable key rather than guessing what it would do', () => {
      process.env.CERTIFIED_MAIL_API_KEY = 'sk_something_else'
      const availability = certifiedMailAvailability()
      expect(availability.available).toBe(false)
      expect(availability.available === false && availability.reason).toContain(
        'neither a test key nor a live key',
      )
    })

    it('is available with a test key outside production', () => {
      expect(certifiedMailAvailability()).toEqual({ available: true })
    })
  })

  describe('refusals, all of them before a letter could go out', () => {
    it('refuses when no provider is configured, even from a stale page', async () => {
      // The screen hides the button; this is the second gate. A form posted from
      // a page rendered before the key was pulled must not slip through.
      const noticeId = await generatedNoticeId()
      delete process.env.CERTIFIED_MAIL_API_KEY

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('CERTIFIED_MAIL_API_KEY')
    })

    it('refuses a draft notice', async () => {
      const notice = await prisma.notice.create({
        data: { facilityId, leaseId, type: 'lien', status: 'draft' },
      })
      const result = await mailNoticeCertified(actor(), notice.id)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('not been generated')
    })

    it('refuses a superseded notice and points at the correction', async () => {
      const noticeId = await generatedNoticeId()
      await prisma.notice.update({ where: { id: noticeId }, data: { supersededAt: new Date() } })

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('corrected notice instead')
    })

    it('refuses a notice already served, so one service never gets two tracking numbers', async () => {
      const noticeId = await generatedNoticeId()
      const recorded = await recordNoticeDelivery(actor(), noticeId, {
        method: 'certified_mail',
        deliveredAt: new Date(),
        proof: { tracking_number: '9407-typed-by-hand' },
      })
      expect(recorded.ok).toBe(true)

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('already been served')
    })

    it('refuses an incomplete rendered address, naming what is missing', async () => {
      // US-13 snapshots the address onto the notice. If that snapshot is short a
      // city, the letter comes back after the deadline the notice sets — so this
      // refuses rather than posting it, and says what to go and fix.
      const noticeId = await generatedNoticeId()
      await prisma.notice.update({
        where: { id: noticeId },
        data: { renderedCity: null, renderedPostalCode: '   ' },
      })

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('city')
      expect(result.ok === false && result.reason).toContain('postal code')
    })

    it('will not post to an address different from the one printed on the notice', async () => {
      // The refusal above says "generate a correction" rather than "we will use
      // the current address", and that wording is the point: the envelope has to
      // match the document.
      const noticeId = await generatedNoticeId()
      await prisma.notice.update({ where: { id: noticeId }, data: { renderedCity: null } })

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok === false && result.reason).toContain('generate a correction')
    })

    it('refuses when the facility has no complete return address', async () => {
      const noticeId = await generatedNoticeId()
      await prisma.facility.update({ where: { id: facilityId }, data: { postalCode: '' } })

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('return address')

      await prisma.facility.update({ where: { id: facilityId }, data: { postalCode: '78704' } })
    })

    it('refuses a notice whose stored document has no content, and calls it a defect', async () => {
      const noticeId = await generatedNoticeId()
      const notice = await prisma.notice.findUniqueOrThrow({
        where: { id: noticeId },
        select: { documentId: true },
      })
      await prisma.document.update({
        where: { id: notice.documentId! },
        data: { content: null },
      })

      const result = await mailNoticeCertified(actor(), noticeId)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('defect')
    })

    it('refuses a staff member without the delinquency permission', async () => {
      const noticeId = await generatedNoticeId()
      const readOnly: Actor = {
        kind: 'staff',
        staffUserId: staffId,
        assignments: [
          {
            facilityId,
            roleKey: 'bookkeeper',
            rank: 10,
            permissions: new Set<PermissionKey>(['tenants:view']),
            limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
          },
        ],
      }
      await expect(mailNoticeCertified(readOnly, noticeId)).rejects.toThrow()
    })

    it('leaves the notice unserved after every refusal', async () => {
      // The invariant behind all of the above: a refusal must not have moved the
      // record. A notice marked served with no letter behind it is the failure
      // this whole path exists to avoid.
      const noticeId = await generatedNoticeId()
      await prisma.notice.update({ where: { id: noticeId }, data: { renderedCity: null } })

      await mailNoticeCertified(actor(), noticeId)

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: noticeId } })
      expect(notice.status).toBe('generated')
      expect(notice.deliveredAt).toBeNull()
      expect(notice.deliveryProof).toBeNull()
    })
  })
})
