import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  completeMoveOut,
  formerTenantDebts,
  markUnitReadyToRent,
  previewMoveOut,
} from '../apps/web/lib/admin/move-out'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-040 / PRD 02 US-14 (move-out), PRD 03 US-2.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

let facilityId = ''
let tenantId = ''
let unitAId = ''
let unitBId = ''
let counterId = ''
let managerId = ''

function actorOf(staffUserId: string, rank: number): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set<PermissionKey>(['tenants:view', 'leases:move_out', 'units:edit', 'reports:financial']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeLease(unitId: string, balanceCents: number) {
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId,
      status: 'active',
      startDate: d('2026-01-01'),
      monthlyRateCents: 31_000,
      billingDay: 1,
      paidThroughDate: d('2026-08-31'),
    },
  })
  if (balanceCents !== 0) {
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: lease.id,
        type: 'charge',
        amountCents: balanceCents,
        description: 'Rent',
      },
    })
  }
  return lease
}

describeDb('move-out', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Move-out Test ${suffix}`,
        slug: `moveout-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        prorateOnMoveOut: true,
        writeOffThresholdCents: 1_000,
        moveOutNoticeDays: 10,
      },
    })
    facilityId = facility.id

    const [counter, manager] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `mo-counter-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
      prisma.staffUser.create({
        data: { email: `mo-manager-${suffix}@example.com`, firstName: 'Mel', lastName: 'Manager' },
      }),
    ])
    counterId = counter.id
    managerId = manager.id

    const tenant = await prisma.tenant.create({
      data: { email: `mo-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const [a, b] = await Promise.all([
      prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'A-1' } }),
      prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'B-2' } }),
    ])
    unitAId = a.id
    unitBId = b.id
  })

  beforeEach(async () => {
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.updateMany({ where: { facilityId }, data: { operationalStatus: 'available' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('previews the settlement without writing anything', async () => {
    const lease = await makeLease(unitAId, 0)
    const before = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })

    const preview = await previewMoveOut(actorOf(counterId, 10), lease.id, d('2026-08-15'))
    expect(preview.settlement.prorationCreditCents).toBe(17_000)
    expect(preview.settlement.refundDueCents).toBe(17_000)
    expect(preview.noticeShortfallDays).toBe(10)

    const after = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
    expect(after.status).toBe(before.status)
    expect(after.moveOutDate).toBeNull()
  })

  it('ends the lease, posts the proration credit, and releases the unit to maintenance', async () => {
    const lease = await makeLease(unitAId, 0)
    const result = await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d('2026-08-15'),
      reason: 'tenant_request',
    })
    expect(result.ok).toBe(true)

    const ended = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
    expect(ended.status).toBe('ended')
    expect(ended.moveOutDate?.toISOString().slice(0, 10)).toBe('2026-08-15')
    expect(ended.moveOutReason).toBe('tenant_request')

    const credit = await prisma.ledgerEntry.findFirstOrThrow({
      where: { leaseId: lease.id, type: 'credit' },
    })
    expect(credit.amountCents).toBe(-17_000)

    // Never straight to available: a human has to open the door first.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })
    expect(unit.operationalStatus).toBe('maintenance')
    expect(unit.status).toBe('maintenance')
  })

  it('emits lease.moved_out so the confirmation can be sent', async () => {
    const lease = await makeLease(unitAId, 0)
    await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d('2026-08-15'),
      reason: 'tenant_request',
    })
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { entityId: lease.id, name: 'lease.moved_out' },
    })
    expect((event.payload as { refundDueCents: number }).refundDueCents).toBe(17_000)
  })

  describe('write-off authority', () => {
    it('stops counter staff closing a lease that owes more than the threshold', async () => {
      const lease = await makeLease(unitAId, 20_000)
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        // No proration credit: leaving after what they paid for.
        moveOutDate: d('2026-09-30'),
        reason: 'tenant_request',
      })
      expect(result).toEqual({ ok: false, problem: 'needs_manager' })
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status).toBe('active')
    })

    it('lets a manager close it', async () => {
      const lease = await makeLease(unitAId, 20_000)
      const result = await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d('2026-09-30'),
        reason: 'tenant_request',
      })
      expect(result.ok).toBe(true)
    })

    it('writes off a small residual and clears the balance', async () => {
      const lease = await makeLease(unitAId, 800)
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d('2026-09-30'),
        reason: 'tenant_request',
        writeOff: true,
        reasonCode: 'collections_uneconomic',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      expect(result.wroteOff).toBe(true)

      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId: lease.id },
        _sum: { amountCents: true },
      })
      expect(balance._sum.amountCents).toBe(0)

      const audited = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: lease.id, action: 'balance.written_off' },
      })
      expect(audited.reasonCode).toBe('collections_uneconomic')
    })

    it('refuses a write-off with no reason code', async () => {
      const lease = await makeLease(unitAId, 800)
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d('2026-09-30'),
        reason: 'tenant_request',
        writeOff: true,
      })
      expect(result).toEqual({ ok: false, problem: 'reason_code_required' })
    })
  })

  describe('access revocation (PRD 03 US-2)', () => {
    it('revokes the gate grant when the last lease ends', async () => {
      const lease = await makeLease(unitAId, 0)
      const grant = await prisma.accessGrant.create({
        data: { facilityId, tenantId, state: 'active', stateCause: 'system:move_in' },
      })

      await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d('2026-08-15'),
        reason: 'tenant_request',
      })

      expect((await prisma.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).state).toBe('revoked')
    })

    it('leaves access alone while another lease at the facility remains', async () => {
      // AC1: someone with two units keeps their code for the one they still have.
      const leaving = await makeLease(unitAId, 0)
      await makeLease(unitBId, 0)
      const grant = await prisma.accessGrant.create({
        data: { facilityId, tenantId, state: 'active', stateCause: 'system:move_in' },
      })

      await completeMoveOut(actorOf(counterId, 10), {
        leaseId: leaving.id,
        moveOutDate: d('2026-08-15'),
        reason: 'tenant_request',
      })

      expect((await prisma.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).state).toBe('active')
    })
  })

  it('marks a unit rentable only as a separate, deliberate act', async () => {
    const lease = await makeLease(unitAId, 0)
    await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d('2026-08-15'),
      reason: 'tenant_request',
    })
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })).status).toBe('maintenance')

    await markUnitReadyToRent(actorOf(counterId, 10), facilityId, unitAId)
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })).status).toBe('available')
  })

  it('records an abandonment without forgiving the balance', async () => {
    const lease = await makeLease(unitAId, 500)
    const result = await completeMoveOut(actorOf(managerId, 20), {
      leaseId: lease.id,
      moveOutDate: d('2026-09-30'),
      reason: 'abandonment',
    })
    expect(result.ok).toBe(true)

    const ended = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
    expect(ended.moveOutReason).toBe('abandonment')
    const balance = await prisma.ledgerEntry.aggregate({
      where: { leaseId: lease.id },
      _sum: { amountCents: true },
    })
    expect(balance._sum.amountCents, 'abandonment forgave the debt').toBe(500)
  })

  it('lists a former tenant who left owing, and not one who did not', async () => {
    const owing = await makeLease(unitAId, 500)
    const settled = await makeLease(unitBId, 0)
    const actor = actorOf(managerId, 20)
    await completeMoveOut(actor, { leaseId: owing.id, moveOutDate: d('2026-09-30'), reason: 'tenant_request' })
    await completeMoveOut(actor, {
      leaseId: settled.id,
      // Paid ahead, so this one ends in credit rather than debt.
      moveOutDate: d('2026-08-15'),
      reason: 'tenant_request',
    })

    const debts = await formerTenantDebts(actor, facilityId)
    expect(debts.map((row) => row.leaseId)).toEqual([owing.id])
    expect(debts[0].balanceCents).toBe(500)
  })

  it('refuses a facility the actor is not assigned to', async () => {
    const other = await prisma.facility.create({
      data: {
        name: `Other ${suffix}`,
        slug: `moveout-other-${suffix}`,
        addressLine1: '9 Elsewhere',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
      },
    })
    await expect(formerTenantDebts(actorOf(counterId, 10), other.id)).rejects.toThrow(ForbiddenError)
    await prisma.facility.delete({ where: { id: other.id } })
  })
})
