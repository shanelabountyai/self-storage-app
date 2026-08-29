import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  addAdvertisement,
  approveAuction,
  auctionCase,
  cancelAuction,
  openAuctionCase,
  outstandingSurpluses,
  recordLockCut,
  recordSaleOutcome,
  recordSurplusDisposition,
  recordSurplusNotified,
  auctionLotSheet,
  scheduleSale,
  setContainsVehicle,
} from '../apps/web/lib/auctions/service'
import { updateAuctionSaleTerms } from '../apps/web/lib/admin/facility-settings'
import { verifyDocument } from '../apps/web/lib/documents/store'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-062 / PRD 02 §4.6 US-28, against real rows.
//
// The properties worth a database: the hard blocks actually refuse, the
// waterfall's figures land as ledger entries that reconcile, the inventory is a
// hashed document, and a surplus stays visible until somebody dispositions it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitId = ''
let regionalId = ''
let managerId = ''
let timelineId = ''

function actorWith(staffUserId: string, rank: number, permissions: PermissionKey[]): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 30 ? 'regional' : 'manager',
        rank,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const ALL: PermissionKey[] = ['tenants:view', 'tenants:edit', 'auctions:approve', 'units:edit']
const regional = () => actorWith(regionalId, 30, ALL)
const manager = () => actorWith(managerId, 20, ALL)

const BUYER = {
  name: 'Ida Buyer',
  addressLine1: '10 Market Street',
  city: 'Austin',
  state: 'TX',
  postalCode: '78704',
  governmentIdReference: 'TX DL ****1234',
  paymentMethod: 'cash',
  cleanoutDeadline: new Date('2026-09-15T00:00:00Z'),
  forfeitTerms: 'Contents left after the deadline are forfeit.',
}

/// A lease owing $600, with the whole timeline executed and proven, a served
/// lien notice, and regional approval — i.e. every readiness rule satisfied.
async function makeReadyCase(): Promise<string> {
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: 60_000,
      description: 'Rent arrears',
      occurredAt: new Date('2026-06-01T00:00:00Z'),
    },
  })

  const task = await prisma.task.create({
    data: {
      facilityId,
      type: 'delinquency_step',
      entityType: 'Lease',
      entityId: leaseId,
      businessDate: new Date('2026-07-15T00:00:00Z'),
      status: 'completed',
      proof: { tracking_number: '9400 1111' },
    },
  })
  await prisma.delinquencyStepRun.create({
    data: {
      leaseId,
      facilityId,
      timelineId,
      dayOffset: 30,
      label: 'Lien notice',
      businessDate: new Date('2026-07-15T00:00:00Z'),
      taskId: task.id,
    },
  })

  const document = await prisma.document.create({
    data: {
      facilityId,
      type: 'notice',
      subjectType: 'Lease',
      subjectId: leaseId,
      title: 'Lien notice',
      content: '<p>notice</p>',
      mimeType: 'text/html',
      contentHash: 'hash',
    },
  })
  await prisma.notice.create({
    data: {
      facilityId,
      leaseId,
      type: 'lien',
      status: 'delivered',
      generatedAt: new Date('2026-07-15T00:00:00Z'),
      deliveredAt: new Date('2026-07-16T00:00:00Z'),
      deliveryMethod: 'certified_mail',
      documentId: document.id,
      documentHash: 'hash',
    },
  })

  const opened = await openAuctionCase({ leaseId, facilityId })
  await approveAuction(regional(), opened!.id, 'management_approval')
  return opened!.id
}

describeDb('the auction pipeline', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Auctions ${suffix}`,
        slug: `auctions-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        surplusHoldDays: 90,
      },
    })
    facilityId = facility.id

    const [reg, mgr] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `auc-reg-${suffix}@example.com`, firstName: 'Rhea', lastName: 'Regional' },
      }),
      prisma.staffUser.create({
        data: { email: `auc-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      }),
    ])
    regionalId = reg.id
    managerId = mgr.id

    const tenant = await prisma.tenant.create({
      data: { email: `auc-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `A-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id

    const timeline = await prisma.delinquencyTimeline.create({
      data: {
        facilityId,
        version: 1,
        active: true,
        label: 'Test timeline',
        qualifyingAmount: 'full_balance',
        steps: [
          {
            dayOffset: 30,
            label: 'Lien notice',
            automatedActions: [],
            noticeTemplateKey: null,
            deliveryMethods: [],
            staffTaskLabel: 'Mail it',
            requiredProofFields: ['tracking_number'],
          },
        ],
      },
    })
    timelineId = timeline.id

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'pending_auction',
        startDate: new Date('2026-05-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
        delinquencyTimelineId: timeline.id,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.auctionAdvertisement.deleteMany({ where: { auctionCase: { facilityId } } })
    await prisma.auctionCase.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.lease.update({
      where: { id: leaseId },
      data: { status: 'pending_auction', endDate: null, moveOutDate: null },
    })
    await prisma.unit.update({
      where: { id: unitId },
      data: { operationalStatus: 'available', status: 'occupied' },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.auctionAdvertisement.deleteMany({ where: { auctionCase: { facilityId } } })
    await prisma.auctionCase.deleteMany({ where: { facilityId } })
    await prisma.notice.deleteMany({ where: { facilityId } })
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.$disconnect()
  })

  describe('opening a case', () => {
    it('opens one and only one live case per lease', async () => {
      const first = await openAuctionCase({ leaseId, facilityId })
      const second = await openAuctionCase({ leaseId, facilityId })

      expect(first?.created).toBe(true)
      expect(second?.created).toBe(false)
      expect(second?.id).toBe(first?.id)
      expect(await prisma.auctionCase.count({ where: { leaseId } })).toBe(1)
    })

    it('pins the timeline version that governed it — US-29', async () => {
      const opened = await openAuctionCase({ leaseId, facilityId })
      const view = await auctionCase(regional(), opened!.id)
      expect(view?.timelineLabel).toBe('Test timeline')
      expect(view?.timelineVersion).toBe(1)
    })

    it('allows a new case after an earlier one was cancelled', async () => {
      const first = await openAuctionCase({ leaseId, facilityId })
      await cancelAuction(regional(), first!.id, 'tenant paid')

      const second = await openAuctionCase({ leaseId, facilityId })
      expect(second?.created).toBe(true)
      expect(second?.id).not.toBe(first?.id)
    })
  })

  describe('the hard blocks — scheduling is refused', () => {
    it('refuses a unit containing a vehicle, however complete everything else is', async () => {
      const caseId = await makeReadyCase()
      await setContainsVehicle(manager(), caseId, true, 'A boat on a trailer.')

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.blockers?.map((one) => one.kind)).toContain('contains_vehicle')

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.status).toBe('eligible')
      expect(row.scheduledSaleDate).toBeNull()
    })

    it('refuses to even APPROVE a vehicle case', async () => {
      const opened = await openAuctionCase({ leaseId, facilityId })
      await setContainsVehicle(manager(), opened!.id, true, 'Camper van inside.')

      const result = await approveAuction(regional(), opened!.id, 'management_approval')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason.toLowerCase()).toContain('vehicle lien process')
    })

    it('refuses when a required step lacks its proof', async () => {
      const caseId = await makeReadyCase()
      // The tracking number goes missing — the task is still "completed".
      await prisma.task.updateMany({
        where: { facilityId, entityId: leaseId },
        data: { proof: { note: 'posted it' } },
      })

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.blockers?.some((one) => one.kind === 'step_lacks_proof')).toBe(true)
    })

    it('refuses when no lien notice was served', async () => {
      const caseId = await makeReadyCase()
      await prisma.notice.deleteMany({ where: { leaseId } })

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.blockers?.map((one) => one.kind)).toContain('no_lien_notice_served')
    })

    it('does not count a notice that was generated but never served', async () => {
      const caseId = await makeReadyCase()
      await prisma.notice.updateMany({
        where: { leaseId },
        data: { status: 'generated', deliveredAt: null },
      })

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
    })

    it('refuses without approval', async () => {
      const caseId = await makeReadyCase()
      await prisma.auctionCase.update({
        where: { id: caseId },
        data: { approvedAt: null, approvedByStaffId: null },
      })

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.blockers?.map((one) => one.kind)).toContain('not_approved')
    })

    it('refuses approval from a site manager — regional or owner only', async () => {
      const opened = await openAuctionCase({ leaseId, facilityId })
      const result = await approveAuction(manager(), opened!.id, 'management_approval')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('regional')
    })

    it('refuses once the tenant has paid', async () => {
      const caseId = await makeReadyCase()
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'payment',
          amountCents: -60_000,
          description: 'Paid in full',
          occurredAt: new Date('2026-08-01T00:00:00Z'),
        },
      })

      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.blockers?.map((one) => one.kind)).toContain('balance_settled')
    })

    it('schedules when every rule passes', async () => {
      const caseId = await makeReadyCase()
      const result = await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      expect(result).toEqual({ ok: true })

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.status).toBe('scheduled')
    })
  })

  // B-129 / PRD 02 §4.6 US-30. The lot sheet, against real rows.
  //
  // The property worth a database here is the one the pure test cannot reach:
  // that the sheet is computed from LIVE readiness rather than from the stored
  // status, so a case that was legitimately scheduled and has since become
  // unsellable drops off the sheet without anybody editing it.
  describe('the auction lot sheet', () => {
    // `facility:settings` rather than adding it to `ALL`: that list is shared
    // with every other actor in this file, and widening it would quietly
    // weaken whatever refusals the rest of the suite relies on.
    const settingsAdmin = () => actorWith(regionalId, 30, [...ALL, 'facility:settings'])

    it('carries a scheduled, ready lot with its size, address and terms', async () => {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-14T00:00:00Z'))
      await updateAuctionSaleTerms(settingsAdmin(), facilityId, '  Cash only, 48-hour cleanout.  ')

      const sheet = await auctionLotSheet(regional(), facilityId)
      const lot = sheet!.lots.find((one) => one.caseId === caseId)
      expect(lot).toBeDefined()
      expect(lot!.scheduledSaleDate.toISOString().slice(0, 10)).toBe('2026-09-14')
      expect(lot!.squareFeet).toBe(lot!.widthFt * lot!.lengthFt)
      // Trimmed to a value, and null only when genuinely unset.
      expect(sheet!.facility.saleTerms).toBe('Cash only, 48-hour cleanout.')
      expect(sheet!.facility.postalCode).toBeTruthy()
      // B-205. The name of the person on whose account the sale is held is a
      // required element of the advertisement, not a convenience.
      expect(lot!.tenantName).toBeTruthy()
    })

    it('carries the time of sale, and leaves it null until somebody sets one (B-205)', async () => {
      // The time and the place are two of the three elements a lien
      // advertisement must carry. The address gave the place; nothing gave the
      // time, so a manager reading this file down a phone to a classifieds
      // clerk published an advertisement missing it.
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-14T00:00:00Z'))

      expect((await auctionLotSheet(regional(), facilityId))!.facility.saleTime).toBeNull()

      await updateAuctionSaleTerms(
        settingsAdmin(),
        facilityId,
        'Cash only.',
        '  10:00 AM, or immediately following the preceding sale.  ',
      )
      const sheet = await auctionLotSheet(regional(), facilityId)
      expect(sheet!.facility.saleTime).toBe('10:00 AM, or immediately following the preceding sale.')
    })

    it('drops a scheduled lot the moment the tenant settles, with the reason', async () => {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-14T00:00:00Z'))
      expect((await auctionLotSheet(regional(), facilityId))!.lots.map((one) => one.caseId)).toContain(
        caseId,
      )

      // Paid in full. Nothing touches the auction case: `status` stays
      // `scheduled`, which is exactly why the sheet cannot key off it.
      const owed = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'payment',
          amountCents: -(owed._sum.amountCents ?? 0),
          description: 'Paid the lien off',
          occurredAt: new Date('2026-08-01T00:00:00Z'),
        },
      })

      const sheet = await auctionLotSheet(regional(), facilityId)
      expect(sheet!.lots.map((one) => one.caseId)).not.toContain(caseId)
      const refusal = sheet!.refused.find((one) => one.caseId === caseId)
      expect(refusal?.kind).toBe('not_ready')
      expect(refusal?.reason).toContain('owes nothing')

      // And the case itself was not edited to achieve that.
      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.status).toBe('scheduled')
    })

    it('leaves the terms null until somebody sets them', async () => {
      await updateAuctionSaleTerms(settingsAdmin(), facilityId, '   ')
      const sheet = await auctionLotSheet(regional(), facilityId)
      expect(sheet!.facility.saleTerms).toBeNull()
    })
  })

  describe('lock cut and inventory', () => {
    it('stores the inventory as a hashed document that verifies', async () => {
      const caseId = await makeReadyCase()
      const result = await recordLockCut(regional(), caseId, {
        cutAt: new Date('2026-09-01T14:00:00Z'),
        oldLockDisposition: 'Cut off and binned, photographed first',
        items: [
          { description: 'Sofa, brown fabric', photoReference: 'photo-1' },
          { description: '6 sealed boxes', photoReference: 'photo-2' },
        ],
      })
      expect(result).toEqual({ ok: true })

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.lockCutByStaffId).toBe(regionalId)
      expect(await verifyDocument(row.inventoryDocumentId!)).toEqual({ ok: true })

      const document = await prisma.document.findUniqueOrThrow({
        where: { id: row.inventoryDocumentId! },
      })
      expect(document.content).toContain('Sofa, brown fabric')
      expect(document.type).toBe('lien_evidence')
    })

    it('refuses an inventory with no items', async () => {
      const caseId = await makeReadyCase()
      const result = await recordLockCut(regional(), caseId, {
        cutAt: new Date(),
        oldLockDisposition: 'Cut off',
        items: [],
      })
      expect(result.ok).toBe(false)
    })

    it('refuses an inventory line with no photograph', async () => {
      const caseId = await makeReadyCase()
      const result = await recordLockCut(regional(), caseId, {
        cutAt: new Date(),
        oldLockDisposition: 'Cut off',
        items: [{ description: 'Sofa', photoReference: '' }],
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('Sofa')
    })

    it('cannot be recorded twice — the second would destroy the first', async () => {
      const caseId = await makeReadyCase()
      const input = {
        cutAt: new Date(),
        oldLockDisposition: 'Cut off',
        items: [{ description: 'Sofa', photoReference: 'photo-1' }],
      }
      await recordLockCut(regional(), caseId, input)
      const second = await recordLockCut(regional(), caseId, input)
      expect(second.ok).toBe(false)
    })
  })

  describe('recording the sale', () => {
    async function readyToSell(): Promise<string> {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      await recordLockCut(regional(), caseId, {
        cutAt: new Date('2026-09-01T14:00:00Z'),
        oldLockDisposition: 'Cut off and binned',
        items: [{ description: 'Sofa', photoReference: 'photo-1' }],
      })
      return caseId
    }

    it('posts the waterfall as ledger entries and settles the lease', async () => {
      const caseId = await readyToSell()
      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-01T18:00:00Z'),
        grossProceedsCents: 100_000,
        saleCostsCents: 15_000,
        buyer: BUYER,
      })
      expect(result).toEqual({ ok: true })

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.costsRecoveredCents).toBe(15_000)
      expect(row.appliedToLienCents).toBe(60_000)
      expect(row.surplusCents).toBe(25_000)

      // "Posted as ledger entries against the lease, never typed in as a
      // total": the ledger, not the case row, is what settles the balance.
      const ledger = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      })
      expect(ledger._sum.amountCents).toBe(0)

      const postings = await prisma.ledgerEntry.findMany({
        where: { leaseId, description: { contains: 'Auction' } },
        orderBy: { amountCents: 'desc' },
      })
      expect(postings.map((one) => one.amountCents)).toEqual([15_000, -75_000])
    })

    it('leaves the deficiency on the ledger when the sale fell short', async () => {
      const caseId = await readyToSell()
      await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-01T18:00:00Z'),
        grossProceedsCents: 40_000,
        saleCostsCents: 15_000,
        buyer: BUYER,
      })

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.surplusCents).toBe(0)
      expect(row.deficiencyCents).toBe(35_000)

      // The debt does not vanish because the goods are gone.
      const ledger = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      })
      expect(ledger._sum.amountCents).toBe(35_000)
    })

    it('releases the unit to maintenance for cleanout verification', async () => {
      const caseId = await readyToSell()
      await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-01T18:00:00Z'),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: BUYER,
      })

      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
      expect(unit.operationalStatus).toBe('maintenance')
      expect(unit.status).toBe('maintenance')

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.status).toBe('ended')
    })

    it('refuses an incomplete buyer record', async () => {
      const caseId = await readyToSell()
      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date(),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: { ...BUYER, governmentIdReference: '' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('governmentIdReference')
      expect(result.reason).toContain('sales-tax return')
    })

    it('requires a resale certificate from a tax-exempt buyer', async () => {
      const caseId = await readyToSell()
      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date(),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: { ...BUYER, taxExempt: true },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('resaleCertificateReference')
    })

    it('refuses a sale with no lock cut behind it', async () => {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))

      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date(),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: BUYER,
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toContain('primary evidence')
    })

    it('refuses to record a sale that was never scheduled', async () => {
      const caseId = await makeReadyCase()
      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date(),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: BUYER,
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('surplus — a liability, not revenue', () => {
    async function sellFor(grossProceedsCents: number): Promise<string> {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      await recordLockCut(regional(), caseId, {
        cutAt: new Date('2026-09-01T14:00:00Z'),
        oldLockDisposition: 'Cut off',
        items: [{ description: 'Sofa', photoReference: 'photo-1' }],
      })
      await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-01T18:00:00Z'),
        grossProceedsCents,
        saleCostsCents: 0,
        buyer: BUYER,
      })
      return caseId
    }

    it('starts HELD with a deadline from the facility’s configured period', async () => {
      const caseId = await sellFor(100_000)
      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })

      // Never "no surplus" — that is how one gets quietly kept.
      expect(row.surplusDisposition).toBe('held')
      expect(row.surplusCents).toBe(40_000)
      // 90 days, from this facility's setting.
      expect(row.surplusHoldUntil?.toISOString().slice(0, 10)).toBe('2026-11-30')
    })

    it('shows up as outstanding until it is dispositioned', async () => {
      const caseId = await sellFor(100_000)

      let outstanding = await outstandingSurpluses(regional(), facilityId)
      expect(outstanding).toHaveLength(1)
      expect(outstanding[0].caseId).toBe(caseId)
      expect(outstanding[0].outstandingActions[0]).toContain('Notify')

      await recordSurplusNotified(regional(), caseId)
      outstanding = await outstandingSurpluses(regional(), facilityId)
      expect(outstanding[0].notifiedAt).not.toBeNull()
      expect(outstanding[0].outstanding).toBe(true)

      await recordSurplusDisposition(regional(), caseId, 'claimed', 'Cheque 1042 to Ada Renter')
      expect(await outstandingSurpluses(regional(), facilityId)).toHaveLength(0)
    })

    it('records no surplus, and nothing outstanding, when the sale raised none', async () => {
      const caseId = await sellFor(50_000)
      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.surplusDisposition).toBe('no_surplus')
      expect(row.surplusHoldUntil).toBeNull()
      expect(await outstandingSurpluses(regional(), facilityId)).toHaveLength(0)
    })

    it('refuses to declare a real surplus "no surplus"', async () => {
      const caseId = await sellFor(100_000)
      const result = await recordSurplusDisposition(regional(), caseId, 'no_surplus', 'nothing here')
      expect(result.ok).toBe(false)
    })

    it('refuses a disposition with no note saying where the money went', async () => {
      const caseId = await sellFor(100_000)
      const result = await recordSurplusDisposition(regional(), caseId, 'remitted', '   ')
      expect(result.ok).toBe(false)
    })

    it('cannot be dispositioned twice', async () => {
      const caseId = await sellFor(100_000)
      await recordSurplusDisposition(regional(), caseId, 'claimed', 'Cheque 1042')
      const second = await recordSurplusDisposition(regional(), caseId, 'remitted', 'Also remitted?')
      expect(second.ok).toBe(false)
    })

    it('audits the disposition on its own', async () => {
      const caseId = await sellFor(100_000)
      await recordSurplusDisposition(regional(), caseId, 'remitted', 'Remitted to the comptroller')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auction.surplus_dispositioned', entityId: caseId },
      })
      expect((entry.after as Record<string, unknown>).disposition).toBe('remitted')
    })
  })

  describe('cancelling', () => {
    it('restores the normal lifecycle and logs the reason', async () => {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))

      const result = await cancelAuction(regional(), caseId, 'Tenant paid in full at the counter')
      expect(result).toEqual({ ok: true })

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
      expect(row.status).toBe('cancelled')
      expect(row.cancelledReason).toContain('Tenant paid')

      // Back to an ordinary delinquent lease.
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.status).toBe('delinquent')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auction.cancelled', entityId: caseId },
      })
      expect(entry.reasonCode).toContain('Tenant paid')
    })

    it('refuses to cancel with no reason', async () => {
      const caseId = await makeReadyCase()
      expect((await cancelAuction(regional(), caseId, '  ')).ok).toBe(false)
    })

    it('refuses to cancel a sale that already happened', async () => {
      const caseId = await makeReadyCase()
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      await recordLockCut(regional(), caseId, {
        cutAt: new Date(),
        oldLockDisposition: 'Cut off',
        items: [{ description: 'Sofa', photoReference: 'photo-1' }],
      })
      await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-01T18:00:00Z'),
        grossProceedsCents: 100_000,
        saleCostsCents: 0,
        buyer: BUYER,
      })

      const result = await cancelAuction(regional(), caseId, 'changed my mind')
      expect(result.ok).toBe(false)
    })
  })

  // B-160 / D-91. D-85 lets staff move a `pending_auction` tenant's goods to
  // another unit. B-157 made the BALANCE and the holds follow them; every other
  // reader of the case still named the unit the notice was served on, so the
  // lock-cut instruction and the advertisement pointed at a unit that had since
  // been re-rented, and the sale's proceeds posted to the lease D-86 had
  // already zeroed.
  //
  // The chain is built here with `transferredFromLeaseId` directly rather than
  // through `completeTransfer`, which is what that column is and what the
  // transfer writes — `transfer-db.test.ts` owns the wizard's own behaviour.
  describe('after the goods are moved to another unit — D-85, D-91', () => {
    let movedUnitId = ''
    let movedLeaseId = ''
    let movedUnitNumber = ''

    async function moveGoods(): Promise<void> {
      movedUnitNumber = `B160-${randomUUID().slice(0, 6)}`
      const unitType = await prisma.unit.findUniqueOrThrow({
        where: { id: unitId },
        select: { unitTypeId: true },
      })
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.unitTypeId, number: movedUnitNumber, status: 'occupied' },
      })
      movedUnitId = unit.id
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'pending_auction',
          startDate: new Date('2026-07-20T00:00:00Z'),
          billingDay: 1,
          monthlyRateCents: 12_900,
          delinquencyTimelineId: timelineId,
          transferredFromLeaseId: leaseId,
        },
      })
      movedLeaseId = lease.id
      // D-86: the unpaid balance moves with the tenant, which is what left the
      // pinned lease netting to zero in the first place.
      await prisma.ledgerEntry.updateMany({ where: { leaseId }, data: { leaseId: movedLeaseId } })
    }

    /// A lien notice served against whichever lease is named — the thing D-91
    /// says has to happen again once the goods have moved.
    async function serveLienNoticeOn(targetLeaseId: string): Promise<void> {
      const document = await prisma.document.create({
        data: {
          facilityId,
          type: 'notice',
          subjectType: 'Lease',
          subjectId: targetLeaseId,
          title: 'Lien notice',
          content: '<p>notice</p>',
          mimeType: 'text/html',
          contentHash: 'hash',
        },
      })
      await prisma.notice.create({
        data: {
          facilityId,
          leaseId: targetLeaseId,
          type: 'lien',
          status: 'delivered',
          generatedAt: new Date('2026-07-25T00:00:00Z'),
          deliveredAt: new Date('2026-07-26T00:00:00Z'),
          deliveryMethod: 'certified_mail',
          documentId: document.id,
          documentHash: 'hash',
        },
      })
    }

    afterEach(async () => {
      if (!movedLeaseId) return
      await prisma.ledgerEntry.deleteMany({ where: { leaseId: movedLeaseId } })
      await prisma.notice.deleteMany({ where: { leaseId: movedLeaseId } })
      await prisma.lease.delete({ where: { id: movedLeaseId } })
      await prisma.unit.delete({ where: { id: movedUnitId } })
      movedLeaseId = ''
      movedUnitId = ''
    })

    it('names the unit the goods are in now, and still says which unit the notice named', async () => {
      const caseId = await makeReadyCase()
      const pinnedUnitNumber = (await auctionCase(regional(), caseId))!.unitNumber
      await moveGoods()

      const view = (await auctionCase(regional(), caseId))!
      // What staff have to walk to, advertise, and cut a lock on.
      expect(view.unitId).toBe(movedUnitId)
      expect(view.unitNumber).toBe(movedUnitNumber)
      // What the served notice says. The case stays pinned to it (B-157) —
      // that anchoring is the evidentiary point and must not move.
      expect(view.noticeUnitId).toBe(unitId)
      expect(view.noticeUnitNumber).toBe(pinnedUnitNumber)
      expect(view.goodsMoved).toBe(true)
      expect(view.currentLeaseId).toBe(movedLeaseId)
    })

    it('says nothing about a move on a case whose goods never moved', async () => {
      const caseId = await makeReadyCase()
      const view = (await auctionCase(regional(), caseId))!
      expect(view.goodsMoved).toBe(false)
      expect(view.unitId).toBe(view.noticeUnitId)
      expect(view.currentLeaseId).toBe(view.leaseId)
    })

    it('blocks the sale until the notice is re-served naming the unit the goods are in', async () => {
      const caseId = await makeReadyCase()
      expect((await auctionCase(regional(), caseId))!.readiness.ready).toBe(true)

      await moveGoods()
      const moved = (await auctionCase(regional(), caseId))!
      expect(moved.readiness.ready).toBe(false)
      expect(moved.readiness.blockers.map((one) => one.kind)).toContain('notice_names_another_unit')
      // Not the generic one: a manager who served the notice themselves must
      // not be told no notice was served.
      expect(moved.readiness.blockers.map((one) => one.kind)).not.toContain('no_lien_notice_served')
      expect(await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))).toMatchObject({ ok: false })

      await serveLienNoticeOn(movedLeaseId)
      const reserved = (await auctionCase(regional(), caseId))!
      expect(reserved.readiness.blockers.map((one) => one.kind)).not.toContain('notice_names_another_unit')
      expect(reserved.readiness.ready).toBe(true)
    })

    it('posts the sale proceeds to the lease the claim moved to, not the pinned one', async () => {
      const caseId = await makeReadyCase()
      await moveGoods()
      await serveLienNoticeOn(movedLeaseId)
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      await recordLockCut(regional(), caseId, {
        cutAt: new Date('2026-09-01T15:00:00Z'),
        oldLockDisposition: 'Cut and binned',
        items: [{ description: 'Sofa', photoReference: 'IMG_1' }],
      })

      const before = await prisma.ledgerEntry.aggregate({
        where: { leaseId: movedLeaseId },
        _sum: { amountCents: true },
      })
      expect(before._sum.amountCents).toBe(60_000)

      const result = await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-02T00:00:00Z'),
        grossProceedsCents: 80_000,
        saleCostsCents: 5_000,
        buyer: BUYER,
      })
      expect(result).toMatchObject({ ok: true })

      // The live lease is settled by the sale...
      const after = await prisma.ledgerEntry.aggregate({
        where: { leaseId: movedLeaseId },
        _sum: { amountCents: true },
      })
      expect(after._sum.amountCents).toBe(0)
      // ...and nothing lands on the lease the tenant no longer holds, which
      // D-86 had already zeroed. Crediting it there left the live lease showing
      // the full arrears after a completed sale.
      const pinned = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      })
      expect(pinned._sum.amountCents ?? 0).toBe(0)
      expect(await prisma.ledgerEntry.count({ where: { leaseId } })).toBe(0)
    })

    it('sends the unit that was actually emptied for cleanout, not the one that was re-rented', async () => {
      const caseId = await makeReadyCase()
      await moveGoods()
      await serveLienNoticeOn(movedLeaseId)
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))
      await recordLockCut(regional(), caseId, {
        cutAt: new Date('2026-09-01T15:00:00Z'),
        oldLockDisposition: 'Cut and binned',
        items: [{ description: 'Sofa', photoReference: 'IMG_1' }],
      })
      await recordSaleOutcome(regional(), caseId, {
        soldAt: new Date('2026-09-02T00:00:00Z'),
        grossProceedsCents: 80_000,
        saleCostsCents: 5_000,
        buyer: BUYER,
      })

      const moved = await prisma.unit.findUniqueOrThrow({ where: { id: movedUnitId } })
      expect(moved.operationalStatus).toBe('maintenance')
      // The pinned unit has been free since the transfer and may already have a
      // new tenant in it. Marking it for cleanout after somebody else's sale is
      // the same defect as cutting its lock.
      const pinnedUnit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
      expect(pinnedUnit.operationalStatus).toBe('available')
    })

    it('heads the inventory with the unit that was actually opened, and names the served unit in it', async () => {
      const caseId = await makeReadyCase()
      const pinnedUnitNumber = (await auctionCase(regional(), caseId))!.unitNumber
      await moveGoods()
      await serveLienNoticeOn(movedLeaseId)
      await scheduleSale(regional(), caseId, new Date('2026-09-01T00:00:00Z'))

      expect(
        await recordLockCut(regional(), caseId, {
          cutAt: new Date('2026-09-01T15:00:00Z'),
          oldLockDisposition: 'Cut and binned',
          items: [{ description: 'Sofa', photoReference: 'IMG_1' }],
        }),
      ).toMatchObject({ ok: true })

      const view = (await auctionCase(regional(), caseId))!
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: view.inventoryDocumentId! },
      })
      expect(document.title).toContain(movedUnitNumber)
      expect(document.title).not.toContain(pinnedUnitNumber)
      // Both facts in the document itself: it sits in the same file as a notice
      // naming the other unit, and silence there reads as a contradiction.
      expect(document.content).toContain(movedUnitNumber)
      expect(document.content).toContain(pinnedUnitNumber)
    })
  })

  describe('the advertising record', () => {
    it('keeps every run, because "which runs did you place" needs a list', async () => {
      const caseId = await makeReadyCase()
      await addAdvertisement(regional(), caseId, {
        publication: 'Austin Chronicle',
        runDate: new Date('2026-08-20T00:00:00Z'),
        reference: 'tear-sheet-1',
      })
      await addAdvertisement(regional(), caseId, {
        publication: 'Austin Chronicle',
        runDate: new Date('2026-08-27T00:00:00Z'),
        reference: 'tear-sheet-2',
      })

      const view = await auctionCase(regional(), caseId)
      expect(view?.advertisements).toHaveLength(2)
      expect(view?.advertisements[0].publication).toBe('Austin Chronicle')
    })
  })
})
