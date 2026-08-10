import { prisma } from '@storage/db'
import { classifyOverlock, type OverlockReconciliationRow } from '@storage/core/delinquency'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.6 US-36 (B-060). The DB-facing half of the reconciliation — gathers
// live `UnitOverlock` rows and their open removal task, if any, and hands them
// to the pure classifier in packages/core.

export async function overlockReconciliation(actor: Actor, facilityId: string): Promise<OverlockReconciliationRow[]> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'tenants:view', facilityId)) {
    throw new ForbiddenError('Missing permission to read overlocks', 'tenants:view', facilityId)
  }

  const overlocks = await prisma.unitOverlock.findMany({
    where: { facilityId, removedAt: null },
    select: {
      id: true,
      unitId: true,
      leaseId: true,
      appliedAt: true,
      createdAt: true,
      unit: { select: { number: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (overlocks.length === 0) return []

  const removalTasks = await prisma.task.findMany({
    where: { type: 'overlock_remove', entityId: { in: overlocks.map((o) => o.leaseId) }, status: 'open' },
    select: { entityId: true, createdAt: true },
  })
  const removalRequestedAt = new Map(removalTasks.map((t) => [t.entityId, t.createdAt]))

  const now = new Date()
  const rows = overlocks.map((overlock) =>
    classifyOverlock(
      {
        overlockId: overlock.id,
        unitId: overlock.unitId,
        unitNumber: overlock.unit.number,
        leaseId: overlock.leaseId,
        appliedAt: overlock.appliedAt,
        createdAt: overlock.createdAt,
        removalRequestedAt: removalRequestedAt.get(overlock.leaseId) ?? null,
      },
      now,
    ),
  )

  // Mismatches first — that is the whole reason this list exists — then
  // oldest-first within each group, matching every other queue's convention.
  return rows.sort((a, b) => Number(b.mismatch) - Number(a.mismatch) || b.ageHours - a.ageHours)
}
