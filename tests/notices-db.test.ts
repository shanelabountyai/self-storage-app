import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  generateNotice,
  noticesForLease,
  previewNotice,
  recordNoticeDelivery,
} from '../apps/web/lib/notices/service'
import { saveNoticeTemplate, exampleNoticeTemplate } from '../apps/web/lib/admin/notice-templates'
import { completeTask } from '../apps/web/lib/admin/tasks'
import { verifyDocument } from '../apps/web/lib/documents/store'
import { recordConsent } from '../packages/core/consent'
import { claimForLease } from '../apps/web/lib/notices/service'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-061 / PRD 02 §4.6 US-27, §4.2 US-13, against real rows.
//
// The properties worth a database here are all evidentiary: the address that
// was actually rendered is on the row, the document's hash still verifies, a
// correction is a new document rather than a rewrite, and a notice cannot be
// generated at all when the ledger and the invoices disagree.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''
let invoiceId = ''

function actor(permissions: PermissionKey[] = ['delinquency:execute_step', 'tenants:view', 'facility:settings']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

/// A lease owing exactly one month's rent, with the ledger and the invoice
/// agreeing — the state a notice may be generated from.
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
  invoiceId = invoice.id
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

describeDb('lien notices', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Notices ${suffix}`,
        slug: `notices-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        email: `notices-${suffix}@example.com`,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `notice-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `notice-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `N-${suffix.slice(0, 4)}` },
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
    // B-306. Every refusal now raises one. Without this, an open card left by
    // an earlier test in this file dedupes the next test's refusal away and
    // the suite disagrees with itself depending on order.
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.consent.deleteMany({ where: { tenantId } })
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
    const example = exampleNoticeTemplate('lien')
    await saveNoticeTemplate(actor(), facilityId, { type: 'lien', ...example })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.consent.deleteMany({ where: { tenantId } })
    await prisma.$disconnect()
  })

  describe('generation', () => {
    it('generates a notice, storing the document, its hash and the claim', async () => {
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId } })
      expect(notice.status).toBe('generated')
      expect(notice.claimTotalCents).toBe(12_900)
      expect(notice.documentHash).toBe(result.documentHash)
      expect(notice.templateVersion).toBe(1)
      expect(notice.generatedByStaffId).toBe(staffId)
    })

    it('stores the address it actually rendered, on the notice row — US-13’s AC', async () => {
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId } })
      expect(notice.renderedAddressLine1).toBe('400 Elm Street')
      expect(notice.renderedPostalCode).toBe('78704')
      // And the provenance chain back to the address row that supplied it.
      expect(notice.tenantAddressId).toBeTruthy()
    })

    it('stores where it said the sale would be held — B-276', async () => {
      // Snapshotted beside the address and for the same reason: the facility
      // setting keeps moving, and `auctionReadiness` has to be able to tell
      // that it moved AFTER this notice went out.
      await prisma.facility.update({
        where: { id: facilityId },
        data: { auctionSaleManner: 'online', auctionSaleVenue: 'StorageTreasures.com' },
      })
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId } })
      expect(notice.renderedSaleManner).toBe('online')
      expect(notice.renderedSaleVenue).toBe('StorageTreasures.com')
      // And it is the same sentence the document carries.
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: notice.documentId! },
      })
      expect(document.content).toContain('StorageTreasures.com')
    })

    it('keeps saying where it was sent after the tenant moves', async () => {
      // The whole reason the address is snapshotted rather than joined. On day
      // 40 of a lien cycle the tenant updates their address; the notice already
      // sent must keep naming the envelope it actually went on.
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      await prisma.tenantAddress.create({
        data: {
          tenantId,
          addressLine1: '900 Oak Avenue',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          source: 'portal',
        },
      })

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId } })
      expect(notice.renderedAddressLine1).toBe('400 Elm Street')
      expect(notice.renderedCity).toBe('Austin')
    })

    it('uses the newest address of record for a notice generated after the move', async () => {
      await oweOneMonth()
      await prisma.tenantAddress.create({
        data: {
          tenantId,
          addressLine1: '900 Oak Avenue',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          source: 'portal',
        },
      })

      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')
      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId } })
      expect(notice.renderedAddressLine1).toBe('900 Oak Avenue')
    })

    it('stores a document whose hash still verifies', async () => {
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      expect(await verifyDocument(result.documentId)).toEqual({ ok: true })
    })

    it('puts the itemized claim and the total on the document itself', async () => {
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      const document = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } })
      expect(document.content).toContain('$129.00')
      expect(document.content).toContain('Rent — July 2026')
      // FR-22: real table semantics, not a layout table.
      expect(document.content).toContain('<th scope="col">Date incurred</th>')
    })

    it('audits the generation with the hash and where it went', async () => {
      await oweOneMonth()
      const result = await generateNotice(actor(), leaseId, 'lien')
      if (!result.ok) throw new Error('unreachable')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'notice.generated', entityId: result.noticeId },
      })
      const context = entry.after as Record<string, unknown>
      expect(context.documentHash).toBe(result.documentHash)
      expect(String(context.renderedTo)).toContain('400 Elm Street')
    })

    it('previews the same document it would generate', async () => {
      await oweOneMonth()
      const preview = await previewNotice(actor(), leaseId, 'lien')
      expect(preview.ok).toBe(true)
      if (!preview.ok) throw new Error('unreachable')
      expect(preview.html).toContain('$129.00')

      // And previewing stored nothing.
      expect(await prisma.notice.count({ where: { leaseId } })).toBe(0)
    })
  })

  describe('the refusals', () => {
    it('REFUSES when the ledger and the invoices disagree — US-27’s AC', async () => {
      await oweOneMonth()
      // Somebody marks the invoice paid without a ledger entry behind it. The
      // ledger still says $129 owed; the invoices say nothing is.
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })

      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.problem.kind).toBe('ledger_does_not_reconcile')

      // Nothing was written — not a draft, not a document.
      expect(await prisma.notice.count({ where: { leaseId } })).toBe(0)
      expect(await prisma.document.count({ where: { subjectId: leaseId } })).toBe(0)
    })

    it('refuses when nothing is owed', async () => {
      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.problem.kind).toBe('nothing_owed')
    })

    it('refuses when the tenant has no address of record', async () => {
      await oweOneMonth()
      await prisma.tenantAddress.deleteMany({ where: { tenantId } })

      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.problem.kind).toBe('no_address')
    })

    it('refuses when the facility has no template — never falls back to the draft', async () => {
      // A facility that has not written its notice text generates no notice.
      // Silently mailing the unedited example would be the worst default
      // available, for the same reason B-056 refuses to run an unconfigured
      // timeline.
      await oweOneMonth()
      await prisma.noticeTemplate.deleteMany({ where: { facilityId } })

      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.problem.kind).toBe('no_template')
    })

    it('refuses a staffer without the delinquency permission', async () => {
      await oweOneMonth()
      await expect(generateNotice(actor(['tenants:view']), leaseId, 'lien')).rejects.toThrow()
    })
  })

  // B-306. Until this block, `generateNotice` returned the refusal before
  // anything was written: the only `recordAudit` in it was on the success path.
  // A manager who tried the pre-lien on day 32 and was refused left no trace at
  // all, so "any notice staff were refused should be retried" (B-292's own
  // conclusion) named a list that did not exist.
  describe('a refused notice leaves a record and a worklist — B-306', () => {
    /// Audit rows accumulate across this file and `audit_log` cannot be
    /// cleaned (B-185), so every assertion here is scoped to what happened
    /// since the test started rather than to a count over the lease.
    async function refusalsSince(since: Date) {
      return prisma.auditLog.findMany({
        where: {
          action: 'notice.refused',
          entityType: 'Lease',
          entityId: leaseId,
          occurredAt: { gte: since },
        },
        orderBy: { occurredAt: 'asc' },
      })
    }

    function openRefusalTasks(type = 'lien_notice_refused') {
      return prisma.task.findMany({ where: { type, entityId: leaseId, status: 'open' } })
    }

    /// The ledger says $129 is owed and the invoices say nothing is — the
    /// shape production has been refusing on since B-061.
    async function breakReconciliation(): Promise<void> {
      await oweOneMonth()
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })
    }

    it('records the refusal and raises a task when the ledger does not reconcile', async () => {
      const since = new Date()
      await breakReconciliation()

      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)

      const entries = await refusalsSince(since)
      expect(entries).toHaveLength(1)
      const context = entries[0].after as Record<string, unknown>
      expect(context.problem).toBe('ledger_does_not_reconcile')
      expect(context.type).toBe('lien')
      // The figures, not only the sentence — the ledger gets repaired and the
      // difference is then underivable from anything else.
      expect(context.differenceCents).toBe(12_900)
      expect(entries[0].actorStaffId).toBe(staffId)

      const tasks = await openRefusalTasks()
      expect(tasks).toHaveLength(1)
      // D-15: the card says why in words. Nothing renders the problem kind.
      expect(tasks[0].detail).toContain('disagree')
      expect(tasks[0].detail).not.toContain('_')
    })

    it('records the refusal when nothing is owed', async () => {
      const since = new Date()
      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(false)

      const entries = await refusalsSince(since)
      expect(entries).toHaveLength(1)
      expect((entries[0].after as Record<string, unknown>).problem).toBe('nothing_owed')
      expect(await openRefusalTasks()).toHaveLength(1)
    })

    it('records the refusal when there is no address and when there is no template', async () => {
      // Not `ClaimProblem`s, and refusals all the same: a notice was owed, an
      // attempt was made, and nothing went out. The third `ClaimProblem` kind,
      // `claim_does_not_sum`, is unreachable from real rows by construction —
      // see the comment on it in `buildClaim` — so `refusalFigures` covers it
      // in `tests/notice-refusal-figures.test.ts` instead.
      const noAddressSince = new Date()
      await oweOneMonth()
      await prisma.tenantAddress.deleteMany({ where: { tenantId } })
      await generateNotice(actor(), leaseId, 'lien')

      const noAddress = await refusalsSince(noAddressSince)
      expect(noAddress).toHaveLength(1)
      expect((noAddress[0].after as Record<string, unknown>).problem).toBe('no_address')
      expect(await openRefusalTasks()).toHaveLength(1)

      // A second refusal on the same lease and type, for a different reason,
      // still does not raise a second card.
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
      const noTemplateSince = new Date()
      await prisma.noticeTemplate.deleteMany({ where: { facilityId } })
      await generateNotice(actor(), leaseId, 'lien')

      const noTemplate = await refusalsSince(noTemplateSince)
      expect(noTemplate).toHaveLength(1)
      expect((noTemplate[0].after as Record<string, unknown>).problem).toBe('no_template')
      expect(await openRefusalTasks()).toHaveLength(1)
    })

    it('does not raise a duplicate card for a second refusal, on any day', async () => {
      await breakReconciliation()
      const since = new Date()

      await generateNotice(actor(), leaseId, 'lien')
      const first = await openRefusalTasks()
      expect(first).toHaveLength(1)

      // The same manager tries again tomorrow. `createTask`'s own idempotency
      // key is (type, entityId, businessDate), so without the open-task check
      // this is a second card for one unserved notice — B-304's lesson.
      await prisma.task.update({
        where: { id: first[0].id },
        data: { businessDate: new Date('2026-01-01T00:00:00Z') },
      })
      await generateNotice(actor(), leaseId, 'lien')

      expect(await openRefusalTasks()).toHaveLength(1)
      // Both attempts are in the record, though. The task is the worklist; the
      // audit entries are the evidence, and there is one per attempt.
      expect(await refusalsSince(since)).toHaveLength(2)
    })

    it('keeps the pre-lien and the lien apart', async () => {
      await saveNoticeTemplate(actor(), facilityId, {
        type: 'pre_lien',
        ...exampleNoticeTemplate('pre_lien'),
      })
      await breakReconciliation()

      await generateNotice(actor(), leaseId, 'pre_lien')
      await generateNotice(actor(), leaseId, 'lien')

      expect(await openRefusalTasks('pre_lien_notice_refused')).toHaveLength(1)
      expect(await openRefusalTasks('lien_notice_refused')).toHaveLength(1)
    })

    it('closes the card when the notice is actually generated', async () => {
      await breakReconciliation()
      await generateNotice(actor(), leaseId, 'lien')
      expect(await openRefusalTasks()).toHaveLength(1)

      // Somebody repairs the ledger the way B-303 does, and the notice goes.
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { amountPaidCents: 0, status: 'open' },
      })
      const result = await generateNotice(actor(), leaseId, 'lien')
      expect(result.ok).toBe(true)

      expect(await openRefusalTasks()).toHaveLength(0)
      // Cancelled, not completed: nobody did the task, the reason for it
      // stopped being true.
      const cards = await prisma.task.findMany({
        where: { type: 'lien_notice_refused', entityId: leaseId },
      })
      expect(cards.map((card) => card.status)).toEqual(['cancelled'])
    })

    it('refuses to let a note close the card', async () => {
      await breakReconciliation()
      await generateNotice(actor(), leaseId, 'lien')
      const [card] = await openRefusalTasks()

      const result = await completeTask(
        actor(['delinquency:execute_step', 'tenants:view', 'tenants:edit']),
        card.id,
        { note: 'Called the tenant.' },
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('a note cannot close this')
      expect(await openRefusalTasks()).toHaveLength(1)
    })

    it('records nothing for a preview — looking is not attempting', async () => {
      const since = new Date()
      await breakReconciliation()

      const preview = await previewNotice(actor(), leaseId, 'lien')
      expect(preview.ok).toBe(false)

      expect(await refusalsSince(since)).toHaveLength(0)
      expect(await openRefusalTasks()).toHaveLength(0)
    })

    it('records nothing for a lease id that does not exist', async () => {
      // A bad id is not a missed step, and there is no facility to scope an
      // entry to or lease for a card to be about.
      const result = await generateNotice(actor(), 'no-such-lease', 'lien')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.problem.kind).toBe('lease_not_found')
      expect(
        await prisma.auditLog.count({
          where: { action: 'notice.refused', entityId: 'no-such-lease' },
        }),
      ).toBe(0)
    })
  })

  describe('corrections — a new document, never a rewrite', () => {
    it('supersedes the original and leaves its document untouched', async () => {
      await oweOneMonth()
      const first = await generateNotice(actor(), leaseId, 'lien')
      if (!first.ok) throw new Error('unreachable')

      const second = await generateNotice(actor(), leaseId, 'lien', { correctsNoticeId: first.noticeId })
      if (!second.ok) throw new Error('unreachable')

      const original = await prisma.notice.findUniqueOrThrow({ where: { id: first.noticeId } })
      const correction = await prisma.notice.findUniqueOrThrow({ where: { id: second.noticeId } })

      expect(original.supersededAt).not.toBeNull()
      expect(correction.correctsNoticeId).toBe(first.noticeId)
      // Two documents, two rows. The original's bytes and hash are exactly
      // what they were — "a corrected notice is a new document with a new
      // date, never a regenerated PDF at the same URL".
      expect(correction.documentId).not.toBe(original.documentId)
      expect(original.documentHash).toBe(first.documentHash)
      expect(await verifyDocument(original.documentId!)).toEqual({ ok: true })
    })

    it('refuses to record delivery against a superseded notice', async () => {
      await oweOneMonth()
      const first = await generateNotice(actor(), leaseId, 'lien')
      if (!first.ok) throw new Error('unreachable')
      await generateNotice(actor(), leaseId, 'lien', { correctsNoticeId: first.noticeId })

      const result = await recordNoticeDelivery(actor(), first.noticeId, {
        method: 'certified_mail',
        deliveredAt: new Date(),
        proof: { tracking_number: '9400 1234' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('superseded')
    })
  })

  describe('recording delivery', () => {
    it('records certified mail with its tracking number', async () => {
      await oweOneMonth()
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'certified_mail',
        deliveredAt: new Date('2026-08-01T15:00:00Z'),
        proof: { tracking_number: '9400 1111 2222' },
      })
      expect(result).toEqual({ ok: true })

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: generated.noticeId } })
      expect(notice.status).toBe('delivered')
      expect(notice.deliveryMethod).toBe('certified_mail')
      expect(notice.deliveryProof).toEqual({ tracking_number: '9400 1111 2222' })
    })

    // B-167. The postage and the lien-processing cost, posted as they are
    // incurred. Until this item the operator ate both, and the tenant's cure
    // quote was short by them — Texas Property Code Ch. 59 lets an operator
    // recover the cost of the statutory notice (D-10).
    describe('the costs a notice incurs (B-167)', () => {
      beforeEach(async () => {
        // The facility outlives every test in this file, so a price set by one
        // of these tests would otherwise decide what the next one charges —
        // including the one asserting that an unpriced fee charges nothing.
        await prisma.feeSchedule.deleteMany({ where: { facilityId } })
      })

      async function priceFee(feeType: 'certified_mail' | 'lien', amountCents: number) {
        await prisma.feeSchedule.create({
          data: {
            facilityId,
            feeType,
            amountCents,
            effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          },
        })
      }

      /// The claim total, or a thrown error if the ledger stopped reconciling —
      /// which is itself worth failing on, since a fee posted to the invoice
      /// but not the ledger (or the reverse) shows up exactly here.
      async function claimTotal(): Promise<number> {
        const claim = await claimForLease(leaseId)
        if (!claim.ok) throw new Error(claim.problem.message)
        return claim.claim.totalCents
      }

      it('posts the certified-mail cost when delivery is recorded, and puts it in the claim', async () => {
        await priceFee('certified_mail', 899)
        await oweOneMonth()
        const generated = await generateNotice(actor(), leaseId, 'lien')
        if (!generated.ok) throw new Error('unreachable')

        const before = await claimTotal()
        await recordNoticeDelivery(actor(), generated.noticeId, {
          method: 'certified_mail',
          deliveredAt: new Date('2026-08-01T15:00:00Z'),
          proof: { tracking_number: '9400 3333' },
        })

        const fee = await prisma.invoice.findFirstOrThrow({
          where: { leaseId, kind: 'fee' },
          include: { lineItems: true },
        })
        expect(fee.totalCents).toBe(899)
        // The tracking number on the line the tenant reads: "what is this
        // $8.99" has to be answerable from the invoice itself.
        expect(fee.lineItems[0]?.description).toContain('9400 3333')

        // The whole reason it is posted here: the cure quote is now complete.
        expect(await claimTotal()).toBe(before + 899)
      })

      it('does not post it twice when a delivery is re-recorded', async () => {
        await priceFee('certified_mail', 899)
        await oweOneMonth()
        const generated = await generateNotice(actor(), leaseId, 'lien')
        if (!generated.ok) throw new Error('unreachable')

        const record = () =>
          recordNoticeDelivery(actor(), generated.noticeId, {
            method: 'certified_mail',
            deliveredAt: new Date('2026-08-01T15:00:00Z'),
            proof: { tracking_number: '9400 4444' },
          })
        await record()
        await record()

        const fees = await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })
        expect(fees).toHaveLength(1)
      })

      it('posts nothing when the facility has priced the fee at nothing', async () => {
        await oweOneMonth()
        const generated = await generateNotice(actor(), leaseId, 'lien')
        if (!generated.ok) throw new Error('unreachable')

        await recordNoticeDelivery(actor(), generated.noticeId, {
          method: 'certified_mail',
          deliveredAt: new Date(),
          proof: { tracking_number: '9400 5555' },
        })

        expect(await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })).toHaveLength(0)
      })

      it('charges nothing for a delivery method that costs nothing', async () => {
        await priceFee('certified_mail', 899)
        await oweOneMonth()
        const generated = await generateNotice(actor(), leaseId, 'lien')
        if (!generated.ok) throw new Error('unreachable')

        await recordNoticeDelivery(actor(), generated.noticeId, {
          method: 'hand_delivered',
          deliveredAt: new Date(),
          proof: { note: 'Handed to the tenant at the counter' },
        })

        expect(await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })).toHaveLength(0)
      })

      it('posts the lien-processing cost when the lien notice is generated', async () => {
        await priceFee('lien', 2_500)
        await oweOneMonth()
        const generated = await generateNotice(actor(), leaseId, 'lien')
        if (!generated.ok) throw new Error('unreachable')

        const fee = await prisma.invoice.findFirstOrThrow({ where: { leaseId, kind: 'fee' } })
        expect(fee.totalCents).toBe(2_500)

        // NOT in the claim this very notice states: the notice quotes the
        // balance as of generation, and a claim inflated by the act of making
        // it reads to a tenant exactly as badly as it sounds.
        const notice = await prisma.notice.findUniqueOrThrow({ where: { id: generated.noticeId } })
        expect(notice.claimTotalCents).toBe(12_900)
        // It IS in the running balance from here, which is what the cure quote
        // and the next notice read.
        expect(await claimTotal()).toBe(12_900 + 2_500)
      })

      it('does not charge the tenant for our own correction', async () => {
        await priceFee('lien', 2_500)
        await oweOneMonth()
        const first = await generateNotice(actor(), leaseId, 'lien')
        if (!first.ok) throw new Error('unreachable')
        await generateNotice(actor(), leaseId, 'lien', { correctsNoticeId: first.noticeId })

        const fees = await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })
        expect(fees).toHaveLength(1)
      })
    })

    it('refuses certified mail with no tracking number', async () => {
      await oweOneMonth()
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'certified_mail',
        deliveredAt: new Date(),
        proof: {},
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.missingProof).toEqual(['tracking_number'])
    })

    it('REFUSES email service without notice_email consent — US-13’s AC', async () => {
      await oweOneMonth()
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'email',
        deliveredAt: new Date(),
        proof: { email_address: 'ada@example.com' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('never been asked')

      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: generated.noticeId } })
      expect(notice.status).toBe('generated')
    })

    it('is not satisfied by account_email consent — the overload US-13 forbids', async () => {
      await oweOneMonth()
      await recordConsent({ tenantId, channel: 'account_email', state: 'granted', source: 'test' })
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      // A tenant happy to get receipts by email has not agreed to be SERVED
      // that way. Overloading the two destroys the ability to prove agreement.
      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'email',
        deliveredAt: new Date(),
        proof: { email_address: 'ada@example.com' },
      })
      expect(result.ok).toBe(false)
    })

    it('allows email once notice_email consent is granted', async () => {
      await oweOneMonth()
      await recordConsent({ tenantId, channel: 'notice_email', state: 'granted', source: 'lease_signing' })
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'email',
        deliveredAt: new Date(),
        proof: { email_address: 'ada@example.com' },
      })
      expect(result).toEqual({ ok: true })
    })

    it('refuses email again once consent is withdrawn — the newest row wins', async () => {
      await oweOneMonth()
      await recordConsent({ tenantId, channel: 'notice_email', state: 'granted', source: 'lease_signing' })
      await recordConsent({ tenantId, channel: 'notice_email', state: 'revoked', source: 'portal' })
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const result = await recordNoticeDelivery(actor(), generated.noticeId, {
        method: 'email',
        deliveredAt: new Date(),
        proof: { email_address: 'ada@example.com' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('withdrawn')
    })
  })

  describe('reading them back', () => {
    it('lists notices newest first with the address and hash', async () => {
      await oweOneMonth()
      const generated = await generateNotice(actor(), leaseId, 'lien')
      if (!generated.ok) throw new Error('unreachable')

      const rows = await noticesForLease(actor(), leaseId)
      expect(rows).toHaveLength(1)
      expect(rows[0].renderedAddress).toContain('400 Elm Street')
      expect(rows[0].documentHash).toBe(generated.documentHash)
      expect(rows[0].claimTotalCents).toBe(12_900)
    })
  })
})
