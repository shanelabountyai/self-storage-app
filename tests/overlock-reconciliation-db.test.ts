import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { requestOverlock, confirmOverlockApplied, releaseOverlock } from '../apps/web/lib/delinquency/overlock'
import { overlockReconciliation } from '../apps/web/lib/delinquency/overlock-reconciliation'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-060 / PRD 02 §4.6 US-36, against real rows.
//
// The join worth a database: pairing a live `UnitOverlock` with whichever open
// `overlock_remove` task actually belongs to it, which is exactly the kind of
// mismatch a bad join silently gets wrong.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitId = ''
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
        permissions: new Set(['tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('overlock reconciliation', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Reconciliation ${suffix}`,
        slug: `recon-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `recon-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    const tenant = await prisma.tenant.create({
      data: { email: `recon-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `R-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('is empty with nothing live', async () => {
    expect(await overlockReconciliation(actor(), facilityId)).toEqual([])
  })

  it('reads a freshly requested lock as awaiting_apply', async () => {
    await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })

    const rows = await overlockReconciliation(actor(), facilityId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unitNumber: `R-${suffix.slice(0, 4)}`, state: 'awaiting_apply' })
  })

  it('reads a confirmed, un-released lock as steady with no removal pending', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    await confirmOverlockApplied(actor(), requested!.overlockId)

    const rows = await overlockReconciliation(actor(), facilityId)
    expect(rows[0].state).toBe('confirmed')
  })

  it('reads a released lock still on as awaiting_removal — the join this exists for', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    await confirmOverlockApplied(actor(), requested!.overlockId)
    await releaseOverlock({ leaseId, facilityId })

    const rows = await overlockReconciliation(actor(), facilityId)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('awaiting_removal')
    expect(rows[0].shouldBeLocked).toBe(false)
    expect(rows[0].confirmedLocked).toBe(true)
  })

  it('drops off the list once the lock actually comes off', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    await confirmOverlockApplied(actor(), requested!.overlockId)
    const released = await releaseOverlock({ leaseId, facilityId })
    await prisma.unitOverlock.update({
      where: { id: requested!.overlockId },
      data: { removedAt: new Date() },
    })
    await prisma.task.update({ where: { id: released.taskId! }, data: { status: 'completed' } })

    expect(await overlockReconciliation(actor(), facilityId)).toEqual([])
  })
})
