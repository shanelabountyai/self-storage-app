import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { businessDateFor } from '../packages/core/jobs'
import {
  assignTask,
  completeTask,
  createTask,
  facilityTasks,
  taskRollup,
} from '../apps/web/lib/admin/tasks'
import { requestDownstream } from '../apps/web/lib/checkout/provision'
import { flagTenantAddressReturned } from '../apps/web/lib/admin/tenants'
import * as accessProvision from '../apps/web/lib/access/provision'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-095 / PRD 02 §4.9 US-41.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let leaseId = ''
let counterId = ''

function actorAt(staffUserId: string, facility: string, permissions: PermissionKey[] = ['tenants:view', 'tenants:edit']): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId: facility,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('task queue', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `Tasks Test ${suffix}`,
          slug: `tasks-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: `Tasks Other ${suffix}`,
          slug: `tasks-other-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      }),
    ])
    facilityId = facility.id
    otherFacilityId = other.id

    const staff = await prisma.staffUser.create({
      data: { email: `tasks-staff-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
    })
    counterId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `tasks-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'A-1' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    const ids = [facilityId, otherFacilityId]
    await prisma.task.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unit.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unitType.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('createTask', () => {
    it('creates a new row the first time', async () => {
      const result = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: leaseId,
      })
      expect(result.created).toBe(true)
    })

    it('is idempotent on (type, entityId, businessDate) — a redelivered event does not duplicate the row', async () => {
      const first = await createTask({
        facilityId,
        type: 'returned_mail_review',
        entityType: 'Tenant',
        entityId: tenantId,
      })
      const second = await createTask({
        facilityId,
        type: 'returned_mail_review',
        entityType: 'Tenant',
        entityId: tenantId,
      })
      expect(second.created).toBe(false)
      expect(second.id).toBe(first.id)

      const rows = await prisma.task.count({
        where: { type: 'returned_mail_review', entityId: tenantId },
      })
      expect(rows).toBe(1)
    })

    it('makes a new task on a different business day for the same entity', async () => {
      const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      const backdated = await createTask({
        facilityId,
        type: 'returned_mail_review',
        entityType: 'Tenant',
        entityId: tenantId,
        at: yesterday,
      })
      expect(backdated.created).toBe(true)

      const rows = await prisma.task.count({
        where: { type: 'returned_mail_review', entityId: tenantId },
      })
      expect(rows).toBe(2)
    })

    it('survives a concurrent creation race without a duplicate', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createTask({
            facilityId,
            type: 'move_in_provisioning_failed',
            entityType: 'Lease',
            entityId: `${leaseId}-race`,
          }),
        ),
      )
      expect(new Set(results.map((r) => r.id)).size).toBe(1)
      expect(results.filter((r) => r.created).length).toBe(1)

      await prisma.task.deleteMany({ where: { entityId: `${leaseId}-race` } })
    })
  })

  describe('facilityTasks', () => {
    it('marks a still-open task from an earlier business day as overdue', async () => {
      const rows = await facilityTasks(actorAt(counterId, facilityId), facilityId, { businessDate: undefined })
      const overdueRow = rows.find((r) => r.entityId === tenantId && r.type === 'returned_mail_review')
      expect(overdueRow?.overdue).toBe(true)
    })

    it('does not mark today’s task as overdue', async () => {
      const rows = await facilityTasks(actorAt(counterId, facilityId), facilityId, { businessDate: undefined })
      const todays = rows.find((r) => r.entityId === leaseId && r.type === 'move_in_provisioning_failed')
      expect(todays?.overdue).toBe(false)
    })

    it('refuses a facility the actor cannot see', async () => {
      await expect(
        facilityTasks(actorAt(counterId, otherFacilityId), facilityId),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  describe('taskRollup', () => {
    it('counts open and overdue tasks per facility the actor can see', async () => {
      const rollup = await taskRollup(actorAt(counterId, facilityId))
      const row = rollup.find((r) => r.facilityId === facilityId)
      expect(row).toBeDefined()
      expect(row!.openCount).toBeGreaterThanOrEqual(3)
      expect(row!.overdueCount).toBeGreaterThanOrEqual(1)
      // A single-facility manager's rollup never mentions a facility they
      // cannot see.
      expect(rollup.map((r) => r.facilityId)).not.toContain(otherFacilityId)
    })
  })

  describe('completeTask', () => {
    it('refuses to complete without the required proof', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: `${leaseId}-proof`,
      })
      const result = await completeTask(actorAt(counterId, facilityId), id, {})
      expect(result).toEqual({ ok: false, missingFields: ['note'] })
      expect((await prisma.task.findUniqueOrThrow({ where: { id } })).status).toBe('open')
    })

    it('completes once proof is supplied, recording who and when', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: `${leaseId}-proof2`,
      })
      const result = await completeTask(actorAt(counterId, facilityId), id, { note: 'Retried, code issued.' })
      expect(result).toEqual({ ok: true })

      const task = await prisma.task.findUniqueOrThrow({ where: { id } })
      expect(task.status).toBe('completed')
      expect(task.completedByStaffId).toBe(counterId)
      expect(task.completedAt).toBeInstanceOf(Date)
    })

    it('does not audit-log a non-sensitive type', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: `${leaseId}-noaudit`,
      })
      await completeTask(actorAt(counterId, facilityId), id, { note: 'Handled.' })
      const audited = await prisma.auditLog.findFirst({ where: { entityType: 'Task', entityId: id } })
      expect(audited).toBeNull()
    })

    it('audit-logs a sensitive type on completion', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'returned_mail_review',
        entityType: 'Tenant',
        entityId: `${tenantId}-audit`,
      })
      await completeTask(actorAt(counterId, facilityId), id, { note: 'Confirmed a current address on file.' })
      const audited = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'Task', entityId: id, action: 'task.completed' },
      })
      expect(audited.actorStaffId).toBe(counterId)
    })

    it('refuses a view-only actor', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: `${leaseId}-viewonly`,
      })
      await expect(
        completeTask(actorAt(counterId, facilityId, ['tenants:view']), id, { note: 'x' }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  describe('assignTask', () => {
    it('assigns and unassigns', async () => {
      const { id } = await createTask({
        facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: `${leaseId}-assign`,
      })
      await assignTask(actorAt(counterId, facilityId), id, counterId)
      expect((await prisma.task.findUniqueOrThrow({ where: { id } })).assigneeStaffId).toBe(counterId)

      await assignTask(actorAt(counterId, facilityId), id, null)
      expect((await prisma.task.findUniqueOrThrow({ where: { id } })).assigneeStaffId).toBeNull()
    })
  })

  describe('real consumers', () => {
    it('creates a task and re-throws when move-in provisioning fails (FR-4.6)', async () => {
      vi.spyOn(accessProvision, 'provisionAccessForLease').mockRejectedValueOnce(
        new Error('simulated gate adapter failure'),
      )

      await expect(requestDownstream(leaseId)).rejects.toThrow('simulated gate adapter failure')

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'move_in_provisioning_failed', entityId: leaseId },
      })
      expect(task.facilityId).toBe(facilityId)
      expect(task.entityType).toBe('Lease')
    })

    it('flagging an address as returned mail creates a review task', async () => {
      const address = await prisma.tenantAddress.create({
        data: {
          tenantId,
          addressLine1: '99 Undeliverable Ln',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          source: 'counter',
        },
      })

      await flagTenantAddressReturned(actorAt(counterId, facilityId), tenantId, address.id)

      const task = await prisma.task.findFirstOrThrow({
        // The facility's OWN business date, not UTC's. These differ for the
        // last few hours of every Central day — after 7pm CDT the UTC date
        // has already rolled over, so a `gte: todayUtc()` filter looks for a
        // business date a day ahead of the one `createTask` actually stamps,
        // and finds nothing. The bug was in this assertion, not the code, and
        // it only ever failed if the suite happened to run in the evening.
        where: {
          type: 'returned_mail_review',
          entityId: tenantId,
          businessDate: businessDateFor(new Date(), 'America/Chicago'),
        },
      })
      expect(task.entityType).toBe('Tenant')
      expect((await prisma.tenantAddress.findUniqueOrThrow({ where: { id: address.id } })).returnedMailAt).toBeInstanceOf(
        Date,
      )

      await prisma.tenantAddress.delete({ where: { id: address.id } })
    })
  })
})
