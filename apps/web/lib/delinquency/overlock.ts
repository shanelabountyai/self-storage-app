import { prisma, type Prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import {
  overlockRemovalLabel,
  type OverlockRemovalReason,
} from '@storage/core/delinquency'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
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

  // PRD 05 CN-11 (B-063). The catalog has carried this event name since B-057's
  // planning with nothing emitting it — a lock going physically onto a unit is
  // the fact the tenant most needs told, and this is what the courtesy comms
  // rule fires on.
  await emitEvent(
    {
      name: 'overlock.required',
      entityType: 'Lease',
      entityId: overlock.leaseId,
      facilityId: overlock.facilityId,
      payload: { unitId: overlock.unitId, overlockId },
    },
    client,
  )
}

/// US-25's "queues overlock removal" on cure — and, since B-151, on lease end.
///
/// Raised only where a lock is actually ON — `requestOverlock` may have been
/// asked for and never fitted, in which case the request is withdrawn instead
/// and nobody is sent to remove a lock that was never there.
///
/// **Idempotent, which it was not before B-151.** Curing calls this once, so a
/// second task could not happen; ending a lease can be reached from four places
/// and the nightly backstop re-runs every night, and `createTask` is unique per
/// `(type, entityId, businessDate)` — so an un-guarded re-call raises one fresh
/// `overlock_remove` task per DAY until somebody removes the lock. A queue that
/// grows a duplicate every morning is the same trust problem as the withdrawn
/// branch above, arriving by a different route. A removal already asked for and
/// still open is returned rather than re-raised.
export async function releaseOverlock(
  input: {
    leaseId: string
    facilityId: string
    /// B-169. Why the lock is coming off, which the caller always knows and
    /// the task's TYPE cannot say. Defaults to `cured` only because that is
    /// the path B-058 built and the one where omitting it is harmless; every
    /// other caller passes its own.
    reason?: OverlockRemovalReason
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ taskId: string | null; withdrawn: boolean }> {
  const overlock = await client.unitOverlock.findFirst({
    where: { leaseId: input.leaseId, removedAt: null },
    select: { id: true, unitId: true, appliedAt: true, appliedTaskId: true, removedTaskId: true },
  })
  if (!overlock) return { taskId: null, withdrawn: false }

  if (!overlock.appliedAt) {
    // Never fitted. Close the record and cancel the request rather than
    // creating a removal task for a lock that does not exist — a queue that
    // sends somebody to a unit for nothing is one they stop trusting.
    await client.unitOverlock.update({
      where: { id: overlock.id },
      data: { removedAt: new Date() },
    })
    if (overlock.appliedTaskId) {
      await client.task.updateMany({
        where: { id: overlock.appliedTaskId, status: 'open' },
        data: { status: 'cancelled' },
      })
    }
    await recomputeUnitStatus(overlock.unitId, client)
    return { taskId: null, withdrawn: true }
  }

  if (overlock.removedTaskId) {
    const open = await client.task.findFirst({
      where: { id: overlock.removedTaskId, status: 'open' },
      select: { id: true },
    })
    if (open) return { taskId: open.id, withdrawn: false }
  }

  const reason: OverlockRemovalReason = input.reason ?? 'cured'
  const task = await createTask({
    facilityId: input.facilityId,
    type: 'overlock_remove',
    entityType: 'Lease',
    entityId: input.leaseId,
    // High: on a cure, every hour the lock stays on is an hour somebody who
    // settled their account cannot reach their own belongings. On a lease END
    // the urgency is the operator's rather than the tenant's — the unit is out
    // of sellable inventory until the lock comes off — and it is the same
    // priority for the same reason.
    priority: 'high',
    // B-169. The label states the fact; this states which of the five reasons
    // produced it. Without it the card asserted "the tenant has paid" on the
    // two paths where they most certainly had not.
    detail: overlockRemovalLabel(reason),
    client,
  })
  // Recorded on the lock itself, same as `appliedTaskId` — a defect fixed in
  // passing while building B-060's reconciliation view, which needs exactly
  // this to tell "confirmed, steady" apart from "confirmed, removal pending".
  await client.unitOverlock.update({
    where: { id: overlock.id },
    data: { removedTaskId: task.id, removalReason: reason },
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

  // PRD 05 CN-11's cure half — the same pairing D-16 requires for access:
  // both transitions are notified.
  await emitEvent(
    {
      name: 'overlock.cleared',
      entityType: 'Lease',
      entityId: leaseId,
      facilityId: overlock.facilityId,
      payload: { unitId: overlock.unitId, overlockId: overlock.id },
    },
    client,
  )
}

/// B-169. Every lock still on a unit whose lease has ended, released.
///
/// **A job step of its own, and that is the entire point.** B-151 put this
/// backstop inside `runDelinquencyTimeline`, after a guard that returns early
/// when the facility has no configured timeline (`skippedNoTimeline`) — so the
/// facilities most likely to have stuck locks, the ones nobody has configured,
/// were the only ones it could never reach. The units B-151 was built to free
/// were exactly the ones it could not.
///
/// Unconditional, nightly and idempotent, which is why it is a sweep rather
/// than the one-off repair script the backlog row asked for: B-151's own
/// reasoning is that a nightly job that fixes what it finds cannot be forgotten
/// the way a script can. The first run IS the repair.
///
/// `releaseOverlock` decides between withdrawing a request never fitted and
/// raising a removal task for a lock that is really on, so this only has to
/// find them.
export async function releaseStuckOverlocks(
  facilityId: string,
  recordItem: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<{ released: number; withdrawn: number }> {
  const stuck = await prisma.unitOverlock.findMany({
    where: {
      facilityId,
      removedAt: null,
      lease: { status: { notIn: [...OCCUPYING_LEASE_STATUSES] } },
    },
    select: {
      id: true,
      leaseId: true,
      lease: { select: { status: true, moveOutReason: true } },
      unit: { select: { number: true } },
    },
  })

  const result = { released: 0, withdrawn: 0 }
  for (const overlock of stuck) {
    // The lease's own recorded reason where it has one, rather than a blanket
    // "lease ended": a card that says the goods were sold at auction is the
    // difference between a staffer expecting a grateful tenant and one who
    // knows what they are walking into.
    const reason: OverlockRemovalReason =
      overlock.lease.moveOutReason === 'abandonment'
        ? 'abandoned'
        : overlock.lease.moveOutReason === 'transfer'
          ? 'transfer'
          : 'lease_ended'

    const outcome = await releaseOverlock({
      leaseId: overlock.leaseId,
      facilityId,
      reason,
    })
    if (outcome.withdrawn) {
      result.withdrawn += 1
      recordItem({
        itemId: overlock.leaseId,
        ok: true,
        message: `unit ${overlock.unit.number}: overlock request withdrawn — the lease ended before anybody fitted it`,
      })
      continue
    }
    if (!outcome.taskId) continue
    result.released += 1
    recordItem({
      itemId: overlock.leaseId,
      ok: true,
      message: `unit ${overlock.unit.number}: removal queued — the lock is on a unit with no live lease`,
    })
  }

  return result
}
