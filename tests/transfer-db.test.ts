import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { completeTransfer, previewTransfer, transferTargets } from '../apps/web/lib/admin/transfer'
import { auctionCase, openAuctionCase } from '../apps/web/lib/auctions/service'
import { recaptureForLease } from '../apps/web/lib/promotions/billing'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-077 / PRD 02 §4.3 US-14 (transfer), against real rows.
//
// The properties worth a database: both units change status in the same
// transaction, the tenant's history stays on one account with both leases and
// a `transfer` rate-change row, both sides of the period are prorated from
// B-044's math and net correctly, and the refusals actually refuse.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let smallTypeId = ''
let largeTypeId = ''
let managerId = ''
let tenantId = ''

const sends: { to: string; subject: string; body: string }[] = []

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '' })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

const PERMISSIONS = ['leases:transfer', 'tenants:view', 'units:edit']

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: managerId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(PERMISSIONS as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

/// An actor with no transfer permission, to prove the gate is real.
function counter(): Actor {
  return {
    kind: 'staff',
    staffUserId: managerId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let unitCounter = 0
async function makeUnit(unitTypeId: string) {
  unitCounter += 1
  return prisma.unit.create({
    data: { facilityId, unitTypeId, number: `T-${suffix.slice(0, 4)}-${unitCounter}`, status: 'available' },
  })
}

/// A lease on a small unit, billing on the 1st, paid through the end of the
/// August period — the shape every case below starts from.
async function makeLease(unitId: string, monthlyRateCents = 10_000) {
  return prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId,
      status: 'active',
      startDate: d('2026-01-01'),
      billingDay: 1,
      monthlyRateCents,
      paidThroughDate: d('2026-09-01'),
    },
  })
}

describeDb('unit transfer (US-14)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Transfer ${suffix}`,
        slug: `transfer-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        billingPolicy: 'first_of_month',
        prorateOnMoveOut: true,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `tr-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    managerId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `tr-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const [small, large] = await Promise.all([
      prisma.unitType.create({ data: { facilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 } }),
      prisma.unitType.create({ data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 } }),
    ])
    smallTypeId = small.id
    largeTypeId = large.id

    await prisma.unitTypeRate.createMany({
      data: [
        { facilityId, unitTypeId: smallTypeId, streetRateCents: 10_000, webRateCents: 10_000, effectiveFrom: d('2020-01-01') },
        { facilityId, unitTypeId: largeTypeId, streetRateCents: 20_000, webRateCents: 20_000, effectiveFrom: d('2020-01-01') },
      ],
    })
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    // B-162's promotion cases. `PromoRedemption` RESTRICTs the promotion and
    // the facility, so the redemptions go before either.
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    // B-157's cases RESTRICT-reference the lease.
    await prisma.auctionCase.deleteMany({ where: { facilityId } })
    // A transferred lease REFERENCES the one it came from, so the ancestors
    // cannot go first (B-138's `onDelete: Restrict`).
    await prisma.lease.deleteMany({ where: { facilityId, transferredFromLeaseId: { not: null } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    // The facility and its staff stay: `audit_log` is append-only and
    // RESTRICT-references the facility, so an audited facility is permanent.
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    // B-162's promotion cases. `PromoRedemption` RESTRICTs the promotion and
    // the facility, so the redemptions go before either.
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    // B-157's cases RESTRICT-reference the lease.
    await prisma.auctionCase.deleteMany({ where: { facilityId } })
    // A transferred lease REFERENCES the one it came from, so the ancestors
    // cannot go first (B-138's `onDelete: Restrict`).
    await prisma.lease.deleteMany({ where: { facilityId, transferredFromLeaseId: { not: null } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.updateMany({ where: { id: tenantId }, data: { activeDutyMilitary: false } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('the preview', () => {
    it('prorates both sides of the same period from B-044’s math', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id, 10_000)

      // 1 Aug – 1 Sep is 31 days. Transferring on 16 Aug: used 1–15 (15
      // days), remaining 16–31 (16 days).
      const result = await previewTransfer(manager(), lease.id, to.id, d('2026-08-16'))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      // Refund: 10000 − round(10000 × 15/31) = 10000 − 4839 = 5161
      expect(result.preview.refundCents).toBe(5_161)
      // Charge on the new unit for the same 16 days: round(20000 × 16/31) = 10323
      expect(result.preview.chargeCents).toBe(10_323)
      expect(result.preview.netCents).toBe(10_323 - 5_161)
      expect(result.preview.newRateCents).toBe(20_000)
      expect(result.preview.currentRateCents).toBe(10_000)
    })

    it('credits more than it charges on a downsize', async () => {
      const from = await makeUnit(largeTypeId)
      const to = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id, 20_000)

      const result = await previewTransfer(manager(), lease.id, to.id, d('2026-08-16'))
      if (!result.ok) throw new Error('unreachable')
      expect(result.preview.netCents).toBeLessThan(0)
      expect(result.preview.totalDueTodayCents).toBeLessThan(0)
    })

    it('adds the facility’s transfer fee when one is published', async () => {
      await prisma.feeSchedule.create({
        data: { facilityId, feeType: 'transfer', amountCents: 2_500, effectiveFrom: d('2020-01-01') },
      })
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await previewTransfer(manager(), lease.id, to.id, d('2026-08-16'))
      if (!result.ok) throw new Error('unreachable')
      expect(result.preview.transferFeeCents).toBe(2_500)
      expect(result.preview.totalDueTodayCents).toBe(result.preview.netCents + 2_500)
    })

    it('prorates nothing at a facility that does not prorate', async () => {
      await prisma.facility.update({ where: { id: facilityId }, data: { prorateOnMoveOut: false } })
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await previewTransfer(manager(), lease.id, to.id, d('2026-08-16'))
      if (!result.ok) throw new Error('unreachable')
      expect(result.preview.refundCents).toBe(0)
      expect(result.preview.chargeCents).toBe(0)

      await prisma.facility.update({ where: { id: facilityId }, data: { prorateOnMoveOut: true } })
    })

    it('refuses a unit that is not available', async () => {
      const from = await makeUnit(smallTypeId)
      const occupied = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      // Something else is already on it.
      await makeLease(occupied.id)
      await prisma.unit.update({ where: { id: occupied.id }, data: { status: 'occupied' } })

      const result = await previewTransfer(manager(), lease.id, occupied.id, d('2026-08-16'))
      expect(result).toMatchObject({ ok: false, problem: 'unit_not_available' })
    })

    it('refuses the unit they are already in', async () => {
      const from = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id)
      const result = await previewTransfer(manager(), lease.id, from.id, d('2026-08-16'))
      expect(result).toMatchObject({ ok: false, problem: 'same_unit' })
    })

    it('refuses an already-ended lease', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'ended' } })

      const result = await previewTransfer(manager(), lease.id, to.id, d('2026-08-16'))
      expect(result).toMatchObject({ ok: false, problem: 'lease_not_occupying' })
    })

    it('refuses staff without leases:transfer', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      await expect(previewTransfer(counter(), lease.id, to.id, d('2026-08-16'))).rejects.toThrow()
    })
  })

  describe('committing', () => {
    it('closes the old lease, opens the new one, and moves both unit statuses atomically', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      const oldLease = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
      expect(oldLease.status).toBe('ended')
      expect(oldLease.moveOutReason).toBe('transfer')
      expect(oldLease.moveOutDate).toEqual(d('2026-08-16'))

      const newLease = await prisma.lease.findUniqueOrThrow({ where: { id: result.newLeaseId } })
      expect(newLease.status).toBe('active')
      expect(newLease.unitId).toBe(to.id)
      expect(newLease.monthlyRateCents).toBe(20_000)
      // The billing anniversary is carried, not recomputed — that is what
      // makes the two prorated halves one unbroken period.
      expect(newLease.billingDay).toBe(1)

      // Both units, same transaction.
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: from.id } })).status).toBe('available')
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: to.id } })).status).toBe('occupied')
    })

    it('keeps the tenant’s history unified — both leases on one account', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const leases = await prisma.lease.findMany({ where: { tenantId, facilityId } })
      expect(leases).toHaveLength(2)
      expect(new Set(leases.map((l) => l.tenantId))).toEqual(new Set([tenantId]))
    })

    it('writes a LeaseRateChange with reason `transfer` carrying the OLD rate as previous', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id, 10_000)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const change = await prisma.leaseRateChange.findFirstOrThrow({
        where: { leaseId: result.newLeaseId, reason: 'transfer' },
      })
      expect(change.previousRateCents).toBe(10_000)
      expect(change.newRateCents).toBe(20_000)
      expect(change.actorStaffId).toBe(managerId)
    })

    it('posts both ledger sides against the right leases', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const credit = await prisma.ledgerEntry.findFirstOrThrow({
        where: { leaseId: lease.id, type: 'credit' },
      })
      expect(credit.amountCents).toBe(-5_161)

      const charge = await prisma.ledgerEntry.findFirstOrThrow({
        where: { leaseId: result.newLeaseId, type: 'charge' },
      })
      expect(charge.amountCents).toBe(10_323)
    })

    it('audits the transfer with both units and both rates', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lease.transferred', entityId: lease.id },
      })
      const after = audit.after as Record<string, unknown>
      expect(after.fromUnitNumber).toBe(from.number)
      expect(after.toUnitNumber).toBe(to.number)
      expect(after.previousRateCents).toBe(10_000)
      expect(after.newRateCents).toBe(20_000)
    })

    it('emits lease.transferred and the confirmation names both units', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'lease.transferred', facilityId },
      })
      await processCommsEvent(event)

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain(from.number)
      expect(sends[0].body).toContain(to.number)
      expect(sends[0].body).toContain('$200.00')
    })

    it('never emits lease.moved_out — a transferring tenant has not left', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })

      expect(
        await prisma.domainEvent.count({ where: { name: 'lease.moved_out', facilityId } }),
      ).toBe(0)
    })

    it('refuses to commit a transfer the preview would refuse', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'ended' } })

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      expect(result).toMatchObject({ ok: false, problem: 'lease_not_occupying' })
      // Nothing was opened.
      expect(await prisma.lease.count({ where: { unitId: to.id } })).toBe(0)
    })
  })

  // B-137. The protection attaches to the person, and a change of unit does
  // not end it — before this, the new lease opened bare and the delinquency
  // engine's `onHold` check passed on a servicemember.
  describe('protective state (B-137)', () => {
    async function transferWithHold(data: {
      type: string
      effectiveFrom?: Date
      effectiveTo?: Date | null
      liftedAt?: Date | null
    }) {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      await prisma.leaseHold.create({
        data: {
          leaseId: lease.id,
          type: data.type,
          reason: 'test',
          effectiveFrom: data.effectiveFrom ?? d('2026-02-01'),
          effectiveTo: data.effectiveTo ?? null,
          liftedAt: data.liftedAt ?? null,
        },
      })
      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')
      return prisma.leaseHold.findMany({ where: { leaseId: result.newLeaseId } })
    }

    it('carries an open hold onto the new lease, keeping the date it started', async () => {
      const holds = await transferWithHold({ type: 'bankruptcy' })
      expect(holds).toHaveLength(1)
      expect(holds[0].type).toBe('bankruptcy')
      // Not the transfer date: the automatic stay started when it started.
      expect(holds[0].effectiveFrom).toEqual(d('2026-02-01'))
      expect(holds[0].liftedAt).toBeNull()
    })

    it('carries a future-dated hold — a commitment already made is not dropped', async () => {
      const holds = await transferWithHold({ type: 'litigation', effectiveFrom: d('2026-12-01') })
      expect(holds.map((h) => h.type)).toEqual(['litigation'])
    })

    it('leaves a lifted hold behind, and one that has already expired', async () => {
      expect(await transferWithHold({ type: 'dispute', liftedAt: d('2026-03-01') })).toHaveLength(0)
      expect(await transferWithHold({ type: 'dispute', effectiveTo: d('2026-04-01') })).toHaveLength(0)
    })

    it('places the SCRA hold on the new lease when the declaration stands and the old lease had none', async () => {
      await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: true } })
      try {
        const from = await makeUnit(smallTypeId)
        const to = await makeUnit(largeTypeId)
        const lease = await makeLease(from.id)

        const result = await completeTransfer(manager(), {
          leaseId: lease.id,
          toUnitId: to.id,
          transferDate: d('2026-08-16'),
        })
        if (!result.ok) throw new Error('unreachable')

        const holds = await prisma.leaseHold.findMany({ where: { leaseId: result.newLeaseId } })
        expect(holds.map((h) => h.type)).toEqual(['military_scra'])
        expect(holds[0].reason).toContain('transferred')
      } finally {
        await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: false } })
      }
    })

    it('does not place the SCRA hold twice when the old lease already carried one', async () => {
      await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: true } })
      try {
        const holds = await transferWithHold({ type: 'military_scra' })
        expect(holds).toHaveLength(1)
        expect(holds[0].effectiveFrom).toEqual(d('2026-02-01'))
      } finally {
        await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: false } })
      }
    })
  })

  // B-138 / D-86. Before this the arrears stayed on the lease the transfer
  // ended, the engine halted it as `moved_out`, and the new lease had no
  // invoices and 0 days past due — so asking for a swap stopped collections on
  // a tenant who owed money and had never left.
  describe('collections (B-138)', () => {
    let invoiceCounter = 0
    async function rentInvoice(
      leaseId: string,
      dueDate: Date,
      options: { totalCents?: number; paidCents?: number } = {},
    ) {
      invoiceCounter += 1
      const total = options.totalCents ?? 10_000
      const paid = options.paidCents ?? 0
      const invoice = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId,
          number: `TR${suffix.slice(0, 4)}${String(invoiceCounter).padStart(4, '0')}`,
          kind: 'rent',
          status: paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'open',
          issueDate: dueDate,
          dueDate,
          periodStart: dueDate,
          periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
          subtotalCents: total,
          totalCents: total,
          amountPaidCents: paid,
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          invoiceId: invoice.id,
          type: 'charge',
          amountCents: total,
          description: `Invoice ${invoice.number}`,
          occurredAt: dueDate,
        },
      })
      if (paid > 0) {
        await prisma.ledgerEntry.create({
          data: {
            facilityId,
            leaseId,
            type: 'payment',
            amountCents: -paid,
            description: 'Card payment',
            occurredAt: dueDate,
          },
        })
      }
      return invoice
    }

    async function balanceOf(leaseId: string): Promise<number> {
      const sum = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      })
      return sum._sum.amountCents ?? 0
    }

    /// Two months behind, the older one part-paid — which is what allocation
    /// oldest-first actually produces, and which is the `daysPastDue` anchor.
    async function behindTenant() {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'delinquent' } })
      const june = await rentInvoice(lease.id, d('2026-06-01'), { paidCents: 4_000 })
      const july = await rentInvoice(lease.id, d('2026-07-01'))
      return { lease, to, june, july }
    }

    it('moves the unpaid invoices onto the new lease, part-paid one included', async () => {
      const { lease, to, june, july } = await behindTenant()

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: june.id } })).leaseId).toBe(
        result.newLeaseId,
      )
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: july.id } })).leaseId).toBe(
        result.newLeaseId,
      )
      // The anchor survived: the oldest ORIGINAL due date, not the transfer
      // date and not July's (D-25).
      const moved = await prisma.invoice.findMany({
        where: { leaseId: result.newLeaseId },
        orderBy: { dueDate: 'asc' },
      })
      expect(moved[0].dueDate).toEqual(d('2026-06-01'))
    })

    it('leaves a settled invoice where it was raised', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      const paid = await rentInvoice(lease.id, d('2026-05-01'), { paidCents: 10_000 })

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).leaseId).toBe(
        lease.id,
      )
    })

    it('moves the BALANCE with them — the old lease keeps none of the arrears', async () => {
      const { lease, to } = await behindTenant()
      // 10000 − 4000 owed on June, 10000 on July.
      const owed = 16_000
      const before = await balanceOf(lease.id)
      expect(before).toBe(owed)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      // The old lease's arrears are exactly cancelled. What remains is its own
      // transfer settlement, which belongs to the unit being handed back.
      expect(await balanceOf(lease.id)).toBe(before - owed - result.preview.refundCents)

      // And the new lease carries them, on top of its own transfer charges.
      const expectedNew =
        owed + result.preview.chargeCents + result.preview.transferFeeCents
      expect(await balanceOf(result.newLeaseId)).toBe(expectedNew)
    })

    it('posts the carry against the invoice, so the ledger still reconciles', async () => {
      const { lease, to, june } = await behindTenant()

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      // Both halves name the invoice. A lump sum with no invoice behind it
      // would make `leaseLedger` report a discrepancy equal to the arrears.
      const entries = await prisma.ledgerEntry.findMany({
        where: { invoiceId: june.id, type: 'adjustment' },
        orderBy: { amountCents: 'asc' },
      })
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({ leaseId: lease.id, amountCents: -6_000 })
      expect(entries[1]).toMatchObject({ leaseId: result.newLeaseId, amountCents: 6_000 })
      expect(entries.every((entry) => entry.invoiceId === june.id)).toBe(true)
    })

    it('records the move per invoice, so “which lease was this raised against” stays answerable', async () => {
      const { lease, to, june } = await behindTenant()

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'invoice.lease_reassigned', entityId: june.id },
        orderBy: { occurredAt: 'desc' },
      })
      // `context` is merged into `after` by `recordAudit`.
      expect(entry.after).toMatchObject({ fromLeaseId: lease.id, toLeaseId: result.newLeaseId })
    })

    it('carries the standing, the timeline pin and the link the ladder reads', async () => {
      const { lease, to } = await behindTenant()
      const timeline = await prisma.delinquencyTimeline.findFirst({ where: { facilityId } })
      if (timeline) {
        await prisma.lease.update({
          where: { id: lease.id },
          data: { delinquencyTimelineId: timeline.id },
        })
      }

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      const created = await prisma.lease.findUniqueOrThrow({ where: { id: result.newLeaseId } })
      // Not `active`: three unpaid invoices came with them, and a lease that
      // read current beside its own arrears is the defect this row closes.
      expect(created.status).toBe('delinquent')
      expect(created.transferredFromLeaseId).toBe(lease.id)
      if (timeline) expect(created.delinquencyTimelineId).toBe(timeline.id)
    })

    it('leaves a lease that owes nothing exactly as it was', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      if (!result.ok) throw new Error('unreachable')

      expect(
        await prisma.ledgerEntry.count({ where: { leaseId: result.newLeaseId, type: 'adjustment' } }),
      ).toBe(0)
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: result.newLeaseId } })).status).toBe(
        'active',
      )
    })
  })

  // B-157 / D-85. Staff MAY move a tenant out of a unit whose contents are
  // being prepared for sale — refusing costs the operator the tenant and the
  // balance — but only with manager-and-above authority, a recorded reason,
  // and a lien clock that does not reset.
  describe('the lien pipeline (B-157, D-85)', () => {
    let timelineId = ''
    let invoiceCounter = 0

    /// An actor holding `leases:transfer` at a rank BELOW manager. The
    /// permission alone used to be the whole gate, so this is the case that
    /// proves the authority rule is stated rather than inherited: grant the
    /// permission to counter staff and nothing else changes.
    function permittedCounter(): Actor {
      return {
        kind: 'staff',
        staffUserId: managerId,
        assignments: [
          {
            facilityId,
            roleKey: 'counter',
            rank: 10,
            permissions: new Set<PermissionKey>(PERMISSIONS as never),
            limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
          },
        ],
      }
    }

    async function timeline(): Promise<string> {
      if (timelineId) return timelineId
      const row = await prisma.delinquencyTimeline.create({
        data: {
          facilityId,
          label: `Lien ${suffix}`,
          version: 1,
          active: true,
          steps: [{ dayOffset: 30, label: 'Lien notice', requiredProofFields: [] }],
        },
      })
      timelineId = row.id
      return timelineId
    }

    /// A tenant in the pipeline: two months unpaid, invoiced, on a
    /// `pending_auction` lease with a live auction case against it.
    async function inPipeline(toTypeId = largeTypeId) {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(toTypeId)
      const lease = await makeLease(from.id)
      await prisma.lease.update({
        where: { id: lease.id },
        data: { status: 'pending_auction', delinquencyTimelineId: await timeline() },
      })

      for (const due of [d('2026-06-01'), d('2026-07-01')]) {
        invoiceCounter += 1
        const invoice = await prisma.invoice.create({
          data: {
            facilityId,
            leaseId: lease.id,
            number: `LN${suffix.slice(0, 4)}${String(invoiceCounter).padStart(4, '0')}`,
            kind: 'rent',
            status: 'open',
            issueDate: due,
            dueDate: due,
            periodStart: due,
            periodEnd: due,
            subtotalCents: 10_000,
            totalCents: 10_000,
            amountPaidCents: 0,
          },
        })
        await prisma.ledgerEntry.create({
          data: {
            facilityId,
            leaseId: lease.id,
            invoiceId: invoice.id,
            type: 'charge',
            amountCents: 10_000,
            description: `Invoice ${invoice.number}`,
            occurredAt: due,
          },
        })
      }

      const opened = await openAuctionCase({ leaseId: lease.id, facilityId })
      return { lease, to, caseId: opened!.id }
    }

    it('refuses staff below manager, even holding leases:transfer', async () => {
      const { lease, to } = await inPipeline()
      const result = await completeTransfer(permittedCounter(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-07-15'),
        reasonCode: 'downsize_to_affordable',
      })
      expect(result).toMatchObject({ ok: false, problem: 'lien_transfer_needs_manager' })
      // Refused before anything committed — the lease is untouched.
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'pending_auction',
      )
    })

    it('refuses a manager who records no reason, and one who invents a code', async () => {
      const { lease, to } = await inPipeline()
      const base = { leaseId: lease.id, toUnitId: to.id, transferDate: d('2026-07-15') }

      expect(await completeTransfer(manager(), base)).toMatchObject({
        ok: false,
        problem: 'lien_transfer_needs_reason',
      })
      // Free text is not a code. The audit log stays filterable only if the
      // vocabulary is closed.
      expect(await completeTransfer(manager(), { ...base, reasonCode: 'he asked nicely' })).toMatchObject(
        { ok: false, problem: 'lien_transfer_needs_reason' },
      )
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe(
        'pending_auction',
      )
    })

    it('allows a manager with a reason, and records it under its own audit action', async () => {
      const { lease, to } = await inPipeline()
      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-07-15'),
        reasonCode: 'downsize_to_affordable',
        reasonNote: 'Moving to a 5x5 they can afford.',
      })
      expect(result.ok).toBe(true)

      // Its own action, not `lease.transferred` — a lien-pipeline move stays
      // independently filterable rather than being one row among every swap.
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lease.transferred_in_lien_pipeline', entityId: lease.id },
        orderBy: { occurredAt: 'desc' },
      })
      expect(entry.reasonCode).toBe('downsize_to_affordable')
      expect(entry.after).toMatchObject({
        // The unit the served notice named, on the transfer row itself.
        lienPipelineNoticeUnitNumber: expect.any(String),
        reasonNote: 'Moving to a 5x5 they can afford.',
      })
      // And nothing wrote the ordinary action for the same move.
      expect(
        await prisma.auditLog.count({ where: { action: 'lease.transferred', entityId: lease.id } }),
      ).toBe(0)
    })

    it('an ordinary transfer still needs no reason, and keeps the plain action', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-16'),
      })
      expect(result.ok).toBe(true)
      expect(
        await prisma.auditLog.count({ where: { action: 'lease.transferred', entityId: lease.id } }),
      ).toBe(1)
    })

    // The guarantee D-85 actually chose, and the one the row asks for by name.
    it('the lien clock reads the same value either side of the move', async () => {
      // A same-rate target, so the transfer itself moves no money: the credit
      // for the old unit and the charge for the new one are the same days at
      // the same rate. That isolates the property under test — the existing
      // claim survives the move — from the arithmetic of the move itself.
      const { lease, to, caseId } = await inPipeline(smallTypeId)
      const before = await auctionCase(manager(), caseId)

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-07-15'),
        reasonCode: 'downsize_to_affordable',
      })
      if (!result.ok) throw new Error('unreachable')

      const after = await auctionCase(manager(), caseId)

      // Before B-157 this read 0: D-86 re-points the unpaid invoices at the
      // new lease, so the old lease's ledger nets to zero and the case — still
      // pinned to it — reported `balance_settled`, "there is no lien to
      // enforce", against a tenant who owed every cent of it.
      expect(after?.outstandingCents).toBe(before?.outstandingCents)
      expect(after?.outstandingCents).toBe(20_000)
      expect(after?.readiness.blockers.map((one) => one.kind)).not.toContain('balance_settled')

      // The case stays pinned to the lease and the unit the notice named. That
      // anchoring is the evidentiary point — the reason code is what
      // reconciles it against the move, not a re-pointed row.
      expect(after?.leaseId).toBe(lease.id)
      expect(after?.noticeUnitNumber).toBe(before?.noticeUnitNumber)

      // B-160 / D-91. The pin is the EVIDENCE; it is not the instruction. The
      // view's own `unitNumber` names the unit somebody has to walk to, open
      // and cut a lock on, which after this move is the new one — reading the
      // pinned number here is how staff cut the lock on a unit that had since
      // been re-rented. Both facts, and a boolean saying they differ.
      expect(after?.goodsMoved).toBe(true)
      expect(after?.unitNumber).toBe(to.number)
      expect(after?.unitNumber).not.toBe(after?.noticeUnitNumber)
      expect(before?.goodsMoved).toBe(false)
    })

    it('carries the claim forward when the move itself charges, never resetting it', async () => {
      // The realistic case: the tenant moves to a differently-priced unit, so
      // the transfer posts its own proration. The claim must GROW by that
      // charge — it must never drop below what was already owed, which is the
      // failure this row exists to close.
      const { lease, to, caseId } = await inPipeline(largeTypeId)
      const before = (await auctionCase(manager(), caseId))?.outstandingCents ?? 0

      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-07-15'),
        reasonCode: 'downsize_to_affordable',
      })
      if (!result.ok) throw new Error('unreachable')

      const after = await auctionCase(manager(), caseId)
      expect(after?.outstandingCents).toBeGreaterThanOrEqual(before)
      expect(after?.readiness.blockers.map((one) => one.kind)).not.toContain('balance_settled')
    })

    it('sees a blocking hold placed on the lease the tenant now holds', async () => {
      const { lease, to, caseId } = await inPipeline()
      const result = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-07-15'),
        reasonCode: 'downsize_to_affordable',
      })
      if (!result.ok) throw new Error('unreachable')

      expect((await auctionCase(manager(), caseId))?.readiness.blockers.map((one) => one.kind)).not.toContain(
        'on_hold',
      )

      // Declared AFTER the move, so it lands on the new lease only. A case
      // reading just its pinned lease would never see it — and this is the
      // blocker where proceeding is a federal matter, not a state lien-law
      // defect.
      await prisma.leaseHold.create({
        data: {
          leaseId: result.newLeaseId,
          type: 'military_scra',
          reason: 'Declared after the transfer',
          effectiveFrom: d('2026-07-16'),
        },
      })

      expect((await auctionCase(manager(), caseId))?.readiness.blockers.map((one) => one.kind)).toContain(
        'on_hold',
      )
    })
  })

  // B-162 / D-93. Three defects with one cause: the new lease was built as if
  // the tenant were new.
  describe('the rate the new lease opens at (B-162, D-93)', () => {
    /// A tenant $20 under street on a 5×5 — the shape that made a like-for-like
    /// move a rent rise.
    async function discountedLease() {
      const from = await makeUnit(smallTypeId)
      return { from, lease: await makeLease(from.id, 8_000) }
    }

    it('a like-for-like move costs exactly what they pay now', async () => {
      const { lease } = await discountedLease()
      const to = await makeUnit(smallTypeId)

      const preview = await previewTransfer(manager(), lease.id, to.id, d('2026-08-15'))
      if (!preview.ok) throw new Error(preview.problem)

      // Before this it returned 10_000 — a $20 rise with no notice period, no
      // approval and no `TenantRateIncrease` record.
      expect(preview.preview.newRateCents).toBe(8_000)
      expect(preview.preview.policyRateCents).toBe(8_000)
      expect(preview.preview.toStreetRateCents).toBe(10_000)
      expect(preview.preview.raisesRate).toBe(false)
    })

    it('an upsize keeps the same discount and says the rent is going up', async () => {
      const { lease } = await discountedLease()
      const to = await makeUnit(largeTypeId)

      const preview = await previewTransfer(manager(), lease.id, to.id, d('2026-08-15'))
      if (!preview.ok) throw new Error(preview.problem)

      // 20% off $200, not $200 and not $80.
      expect(preview.preview.newRateCents).toBe(16_000)
      expect(preview.preview.raisesRate).toBe(true)
    })

    it('honours the facility policy when it is set to street', async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { transferRatePolicy: 'street' },
      })
      try {
        const { lease } = await discountedLease()
        const to = await makeUnit(smallTypeId)

        const preview = await previewTransfer(manager(), lease.id, to.id, d('2026-08-15'))
        if (!preview.ok) throw new Error(preview.problem)
        expect(preview.preview.newRateCents).toBe(10_000)
        expect(preview.preview.raisesRate).toBe(true)
      } finally {
        await prisma.facility.update({
          where: { id: facilityId },
          data: { transferRatePolicy: 'preserve_discount' },
        })
      }
    })

    it('takes a rate staff set, records that they set it, and posts that figure', async () => {
      const { lease } = await discountedLease()
      const to = await makeUnit(smallTypeId)

      const preview = await previewTransfer(manager(), lease.id, to.id, d('2026-08-15'), 7_500)
      if (!preview.ok) throw new Error(preview.problem)
      expect(preview.preview.newRateCents).toBe(7_500)
      expect(preview.preview.policyRateCents).toBe(8_000)
      expect(preview.preview.rateOverridden).toBe(true)

      const done = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-15'),
        rateOverrideCents: 7_500,
      })
      if (!done.ok) throw new Error(done.problem)

      const opened = await prisma.lease.findUniqueOrThrow({ where: { id: done.newLeaseId } })
      expect(opened.monthlyRateCents).toBe(7_500)

      // Both figures on the audit row: "they paid the policy rate" and "a
      // manager typed this in" are different facts.
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lease.transferred', entityId: lease.id },
        orderBy: { occurredAt: 'desc' },
      })
      // `context` is merged into `after` by `recordAudit`.
      const context = entry.after as Record<string, unknown>
      expect(context.rateOverridden).toBe(true)
      expect(context.policyRateCents).toBe(8_000)
      expect(context.newRateCents).toBe(7_500)
    })

    it('names an in-flight rate increase on the preview and cancels it on commit', async () => {
      const { lease } = await discountedLease()
      const to = await makeUnit(smallTypeId)
      const increase = await prisma.tenantRateIncrease.create({
        data: {
          facilityId,
          leaseId: lease.id,
          currentRateCents: 8_000,
          newRateCents: 9_000,
          effectiveDate: d('2026-10-01'),
          noticeDate: d('2026-09-01'),
          noticeDays: 30,
          status: 'notice_sent',
          noticeSentAt: new Date(),
        },
      })

      const preview = await previewTransfer(manager(), lease.id, to.id, d('2026-08-15'))
      if (!preview.ok) throw new Error(preview.problem)
      expect(preview.preview.liveRateIncrease?.id).toBe(increase.id)
      expect(preview.preview.liveRateIncrease?.newRateCents).toBe(9_000)

      await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-15'),
      })

      // Before this it stayed `notice_sent` for ever and the nightly run
      // reported `ok: true, "skipped — the lease has ended"` every night.
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: increase.id } })
      expect(after.status).toBe('cancelled')
      expect(
        await prisma.auditLog.count({
          where: { action: 'rate.increase_cancelled', entityId: increase.id },
        }),
      ).toBe(1)
    })
  })

  // B-162 / D-93. D-89 settled that a transfer recaptures nothing and named
  // the hole that left: the redemption stayed on the ended lease, so a tenant
  // inside a minimum stay could transfer to the cheapest unit on site and walk
  // out of the next lease owing nothing.
  describe('the promotion follows the tenant (B-162, D-93)', () => {
    async function promoLease() {
      const from = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id, 8_000)
      const promotion = await prisma.promotion.create({
        data: {
          name: `Half off ${suffix}`,
          type: 'percent_off',
          value: 50,
          durationPeriods: 3,
          status: 'active',
          minStayMonths: 6,
        },
      })
      const redemption = await prisma.promoRedemption.create({
        data: {
          promotionId: promotion.id,
          facilityId,
          leaseId: lease.id,
          schedule: [
            { periodIndex: 0, amountCents: 4_000 },
            { periodIndex: 1, amountCents: 4_000 },
            { periodIndex: 2, amountCents: 4_000 },
          ],
          totalCents: 12_000,
          appliedPeriods: [0, 1],
        },
      })
      return { lease, promotion, redemption }
    }

    it('re-points the redemption and leaves what was already given alone', async () => {
      const { lease, redemption } = await promoLease()
      const to = await makeUnit(smallTypeId)

      const done = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-15'),
      })
      if (!done.ok) throw new Error(done.problem)

      const after = await prisma.promoRedemption.findUniqueOrThrow({ where: { id: redemption.id } })
      expect(after.leaseId).toBe(done.newLeaseId)
      // Untouched on purpose: the period index is counted across the transfer
      // chain, so period 2's discount lands on the month it was promised for
      // rather than on the new lease's third.
      expect(after.appliedPeriods).toEqual([0, 1])
      expect(after.totalCents).toBe(12_000)

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lease.transferred', entityId: lease.id },
        orderBy: { occurredAt: 'desc' },
      })
      expect((entry.after as Record<string, unknown>).promoRedemptionMoved).toBe(true)
    })

    it('counts the minimum stay from when the tenancy began, not from the transfer', async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { promoRecapturePolicy: 'full' },
      })
      try {
        const { lease } = await promoLease()
        const to = await makeUnit(smallTypeId)
        const done = await completeTransfer(manager(), {
          leaseId: lease.id,
          toUnitId: to.id,
          transferDate: d('2026-08-15'),
        })
        if (!done.ok) throw new Error(done.problem)

        const moved = await prisma.lease.findUniqueOrThrow({ where: { id: done.newLeaseId } })
        // The tenancy started 2026-01-01; the new lease started 2026-08-15.
        // Leaving on 2026-09-01 is eight months served, not half of one.
        const recapture = await recaptureForLease(
          { id: moved.id, startDate: moved.startDate, facilityId },
          d('2026-09-01'),
        )
        expect(recapture.amountCents).toBe(0)
      } finally {
        await prisma.facility.update({
          where: { id: facilityId },
          data: { promoRecapturePolicy: 'none' },
        })
      }
    })
  })

  // B-163. The waiver was the last protective fact left on the closed lease,
  // after B-137 carried the holds and B-162 the promotion.
  describe('proof of insurance follows the tenant (B-163)', () => {
    it('re-points the waiver, expiry untouched', async () => {
      const from = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id)
      const expiresAt = d('2027-03-01')
      const waiver = await prisma.protectionWaiver.create({
        data: { facilityId, leaseId: lease.id, tenantId, carrier: 'State Farm', expiresAt },
      })
      const to = await makeUnit(smallTypeId)

      const done = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-15'),
      })
      if (!done.ok) throw new Error(done.problem)

      const after = await prisma.protectionWaiver.findUniqueOrThrow({ where: { id: waiver.id } })
      expect(after.leaseId).toBe(done.newLeaseId)
      // A transfer is not a renewal: the certificate expires when it expires.
      expect(after.expiresAt).toEqual(expiresAt)

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lease.transferred', entityId: lease.id },
        orderBy: { occurredAt: 'desc' },
      })
      expect((entry.after as Record<string, unknown>).protectionWaiverMoved).toBe(true)
    })

    it('moves an ALREADY-LAPSED waiver too, so a swap cannot shed a lapse', async () => {
      const from = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id)
      await prisma.protectionWaiver.create({
        data: { facilityId, leaseId: lease.id, tenantId, expiresAt: d('2026-01-01') },
      })
      const to = await makeUnit(smallTypeId)

      const done = await completeTransfer(manager(), {
        leaseId: lease.id,
        toUnitId: to.id,
        transferDate: d('2026-08-15'),
      })
      if (!done.ok) throw new Error(done.problem)

      const after = await prisma.protectionWaiver.findFirstOrThrow({ where: { facilityId } })
      expect(after.leaseId).toBe(done.newLeaseId)
    })
  })

  describe('transferTargets', () => {
    it('offers available units at the facility, never the one they are in', async () => {
      const from = await makeUnit(smallTypeId)
      const other = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const targets = await transferTargets(manager(), lease.id)
      const ids = targets.map((t) => t.id)
      expect(ids).toContain(other.id)
      expect(ids).not.toContain(from.id)
    })

    it('carries each unit’s street rate so the screen never asks for a unit id', async () => {
      const from = await makeUnit(smallTypeId)
      await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const targets = await transferTargets(manager(), lease.id)
      expect(targets.every((t) => t.rateCents !== null)).toBe(true)
    })
  })
})
