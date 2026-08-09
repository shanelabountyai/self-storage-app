import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createTask } from '../apps/web/lib/admin/tasks'
import { delinquencyQueue } from '../apps/web/lib/admin/delinquency-queue'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-059 / PRD 02 §4.6 US-26, against real rows.
//
// US-26: "today's due steps grouped by type (overlocks to apply/remove,
// notices to mail, proofs to record), so nothing is missed." US-41's AC is
// that this reads the one `Task` list rather than a table of its own — so the
// property worth a database is that grouping and filtering leave that list
// intact, not a parallel query.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let leaseId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: randomUUID(),
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(['tenants:view', 'delinquency:execute_step']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('the delinquency queue', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Queue ${suffix}`,
        slug: `dq-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `dq-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `Q-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
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
    await prisma.task.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('is empty when there is nothing to do — not every task type showing up', async () => {
    // A queue that also showed a lead follow-up or a bounced-email task would
    // train staff to ignore it.
    await createTask({ facilityId, type: 'lead_follow_up', entityType: 'Lead', entityId: leaseId })
    await createTask({ facilityId, type: 'failed_payment', entityType: 'Invoice', entityId: leaseId })

    expect(await delinquencyQueue(actor(), facilityId)).toEqual([])
  })

  it('groups by type in the order US-26 lists them, and drops empty groups', async () => {
    await createTask({ facilityId, type: 'delinquency_step', entityType: 'Lease', entityId: leaseId })
    await createTask({ facilityId, type: 'overlock_apply', entityType: 'Lease', entityId: leaseId })

    const groups = await delinquencyQueue(actor(), facilityId)
    expect(groups.map((g) => g.type)).toEqual(['overlock_apply', 'delinquency_step'])
    expect(groups.every((g) => g.tasks.length > 0)).toBe(true)
  })

  it('carries the proof requirement so a form can ask for a photo only where one is owed', async () => {
    await createTask({ facilityId, type: 'overlock_apply', entityType: 'Lease', entityId: leaseId })
    await createTask({ facilityId, type: 'overlock_remove', entityType: 'Lease', entityId: leaseId })

    const groups = await delinquencyQueue(actor(), facilityId)
    const apply = groups.find((g) => g.type === 'overlock_apply')!
    const remove = groups.find((g) => g.type === 'overlock_remove')!

    expect(apply.tasks[0].requiredProofFields).toContain('photo_reference')
    expect(remove.tasks[0].requiredProofFields).not.toContain('photo_reference')
  })

  it('threads the same overdue flag facilityTasks computes', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await createTask({ facilityId, type: 'delinquency_step', entityType: 'Lease', entityId: leaseId, at: yesterday })

    const groups = await delinquencyQueue(actor(), facilityId)
    expect(groups[0].tasks[0].overdue).toBe(true)
  })
})
