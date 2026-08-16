import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { completeTransfer, previewTransfer, transferTargets } from '../apps/web/lib/admin/transfer'
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
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
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
