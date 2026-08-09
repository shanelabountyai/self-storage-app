import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { createTask } from '@/lib/admin/tasks'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 03 US-3 AC1 / PRD 02 US-25 (B-058). Overlocks.
//
// "An overlock task is created for staff in the admin dashboard (physical
// overlock is manual — see Non-Goals)." This system never actuates a lock; it
// asks somebody to fit one, records that they did, and makes the unit read as
// `overlocked` — a status that has existed in the enum since B-010 with nothing
// producing it.

/// Asks for an overlock and records the intent.
///
/// Idempotent per unit: the partial unique index allows one LIVE overlock, so a
/// replayed stage event or a re-run of the nightly job asks once. PRD 03 US-3
/// AC4 requires exactly that — "replayed billing events cause no duplicate
/// commands or notifications".
export async function requestOverlock(input: {
  leaseId: string
  facilityId: string
  reason: string
  businessDate?: Date
}): Promise<{ overlockId: string; taskId: string } | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { unitId: true },
  })
  if (!lease?.unitId) return null

  const existing = await prisma.unitOverlock.findFirst({
    where: { unitId: lease.unitId, removedAt: null },
    select: { id: true, appliedTaskId: true },
  })
  if (existing) return null

  const task = await createTask({
    facilityId: input.facilityId,
    type: 'overlock_apply',
    entityType: 'Lease',
    entityId: input.leaseId,
    at: input.businessDate,
    priority: 'high',
  })

  try {
    const overlock = await prisma.unitOverlock.create({
      data: {
        unitId: lease.unitId,
        leaseId: input.leaseId,
        facilityId: input.facilityId,
        reason: input.reason,
        appliedTaskId: task.id,
      },
      select: { id: true },
    })
    return { overlockId: overlock.id, taskId: task.id }
  } catch {
    // Lost the race for the partial unique index. Somebody else asked first,
    // which is the outcome AC4 wants.
    return null
  }
}

/// Records that staff actually fitted the lock.
///
/// This is what makes the unit `overlocked` — not the request. A unit whose
/// status flipped when the task was RAISED would read as locked while the lock
/// was still in the office, and the status is what an auction file and the
/// occupancy report both read.
export async function confirmOverlockApplied(
  actor: Actor,
  overlockId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const overlock = await client.unitOverlock.findUnique({
    where: { id: overlockId },
    select: { unitId: true, facilityId: true, leaseId: true, appliedAt: true },
  })
  if (!overlock || overlock.appliedAt) return

  await client.unitOverlock.update({
    where: { id: overlockId },
    data: {
      appliedAt: new Date(),
      appliedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
    },
  })
  await recomputeUnitStatus(overlock.unitId, client)

  await recordAudit(
    {
      actor: toAuditActor(actor),
      action: 'unit.overlocked',
      entityType: 'Unit',
      entityId: overlock.unitId,
      facilityId: overlock.facilityId,
      context: { leaseId: overlock.leaseId, overlockId },
    },
    client,
  )
}

/// US-25's "queues overlock removal" on cure.
///
/// Raised only where a lock is actually ON — `requestOverlock` may have been
/// asked for and never fitted, in which case the request is withdrawn instead
/// and nobody is sent to remove a lock that was never there.
export async function releaseOverlock(input: {
  leaseId: string
  facilityId: string
}): Promise<{ taskId: string | null; withdrawn: boolean }> {
  const overlock = await prisma.unitOverlock.findFirst({
    where: { leaseId: input.leaseId, removedAt: null },
    select: { id: true, unitId: true, appliedAt: true, appliedTaskId: true },
  })
  if (!overlock) return { taskId: null, withdrawn: false }

  if (!overlock.appliedAt) {
    // Never fitted. Close the record and cancel the request rather than
    // creating a removal task for a lock that does not exist — a queue that
    // sends somebody to a unit for nothing is one they stop trusting.
    await prisma.unitOverlock.update({
      where: { id: overlock.id },
      data: { removedAt: new Date() },
    })
    if (overlock.appliedTaskId) {
      await prisma.task.updateMany({
        where: { id: overlock.appliedTaskId, status: 'open' },
        data: { status: 'cancelled' },
      })
    }
    await recomputeUnitStatus(overlock.unitId)
    return { taskId: null, withdrawn: true }
  }

  const task = await createTask({
    facilityId: input.facilityId,
    type: 'overlock_remove',
    entityType: 'Lease',
    entityId: input.leaseId,
    // High: the tenant has paid, and every hour the lock stays on is an hour
    // somebody who settled their account cannot reach their own belongings.
    priority: 'high',
  })
  return { taskId: task.id, withdrawn: false }
}

/// Records that staff took the lock off. Returns the unit to `occupied`.
export async function confirmOverlockRemoved(
  actor: Actor,
  leaseId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const overlock = await client.unitOverlock.findFirst({
    where: { leaseId, removedAt: null },
    select: { id: true, unitId: true, facilityId: true },
  })
  if (!overlock) return

  await client.unitOverlock.update({
    where: { id: overlock.id },
    data: {
      removedAt: new Date(),
      removedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
    },
  })
  await recomputeUnitStatus(overlock.unitId, client)

  await recordAudit(
    {
      actor: toAuditActor(actor),
      action: 'unit.overlock_removed',
      entityType: 'Unit',
      entityId: overlock.unitId,
      facilityId: overlock.facilityId,
      context: { leaseId, overlockId: overlock.id },
    },
    client,
  )
}
