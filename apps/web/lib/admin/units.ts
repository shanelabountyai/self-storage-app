import { prisma } from '@storage/db'
import type { Prisma, UnitStatus } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  OCCUPYING_LEASE_STATUSES,
  canSetManualStatus,
  deriveUnitStatus,
  type ManualUnitStatus,
  type UnitOccupancyFacts,
} from '@storage/core/inventory'
import { ForbiddenError, requirePermission, resolveFacilityFilter } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// The adapter between the pure rule in @storage/core/inventory and real rows.
// Everything that writes Unit.status goes through recomputeUnitStatus() — that
// is the whole point of US-8, and a direct `data: { status }` write anywhere
// else is a bug.

export class UnitStatusChangeBlockedError extends Error {
  readonly blocking: { type: 'lease' | 'reservation' | 'overlock'; id: string } | null

  constructor(message: string, blocking: { type: 'lease' | 'reservation' | 'overlock'; id: string } | null) {
    super(message)
    this.name = 'UnitStatusChangeBlockedError'
    this.blocking = blocking
  }
}

/// Gathers the facts the derivation needs for one unit.
async function occupancyFactsFor(
  unitId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UnitOccupancyFacts> {
  const [activeLease, activeReservation] = await Promise.all([
    client.lease.findFirst({
      where: { unitId, status: { in: [...OCCUPYING_LEASE_STATUSES] }, deletedAt: null },
      select: { id: true, status: true },
    }),
    client.reservation.findFirst({
      where: { unitId, status: 'held', expiresAt: { gt: new Date() } },
      select: { id: true },
    }),
  ])

  return {
    activeLease,
    activeReservation,
    // No source yet — the delinquency engine (B-057) and field ops (B-060)
    // populate this. Until then no unit can be overlocked, which is correct:
    // nothing in the system can currently overlock one.
    overlocked: false,
  }
}

/// Recomputes and persists one unit's effective status from current facts.
/// Idempotent, and safe to call after anything that changes lease, reservation,
/// or delinquency state — which is exactly what B-018/B-026/B-040/B-057 must do.
export async function recomputeUnitStatus(
  unitId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UnitStatus> {
  const unit = await client.unit.findUniqueOrThrow({
    where: { id: unitId },
    select: { operationalStatus: true, status: true },
  })
  const facts = await occupancyFactsFor(unitId, client)
  const derived = deriveUnitStatus(unit.operationalStatus, facts) as UnitStatus

  if (derived !== unit.status) {
    await client.unit.update({ where: { id: unitId }, data: { status: derived } })
  }
  return derived
}

export type UnitFilters = {
  status?: UnitStatus
  unitTypeId?: string
  building?: string
  floor?: number
  /// Matches unit number, case-insensitively.
  search?: string
}

export async function listUnits(actor: Actor, facilityId: string, filters: UnitFilters = {}) {
  const where: Prisma.UnitWhereInput = {
    // Scoped through the shared helper rather than a bare facilityId, so this
    // list can never show a facility the actor lacks.
    ...resolveFacilityFilter(actor, facilityId),
    ...(filters.status && { status: filters.status }),
    ...(filters.unitTypeId && { unitTypeId: filters.unitTypeId }),
    ...(filters.building && { building: filters.building }),
    ...(filters.floor !== undefined && { floor: filters.floor }),
    ...(filters.search && { number: { contains: filters.search, mode: 'insensitive' } }),
  }

  return prisma.unit.findMany({
    where,
    include: { unitType: { select: { id: true, name: true, widthFt: true, lengthFt: true, streetRateCents: true } } },
    orderBy: [{ building: 'asc' }, { floor: 'asc' }, { number: 'asc' }],
  })
}

/// Distinct buildings and floors present at a facility, for filter dropdowns
/// and the grid view's grouping (B-010 session 2).
export async function unitGroupings(facilityId: string) {
  const rows = await prisma.unit.findMany({
    where: { facilityId },
    select: { building: true, floor: true },
    distinct: ['building', 'floor'],
    orderBy: [{ building: 'asc' }, { floor: 'asc' }],
  })
  return {
    buildings: [...new Set(rows.map((r) => r.building).filter((b): b is string => b !== null))],
    floors: [...new Set(rows.map((r) => r.floor))].sort((a, b) => a - b),
  }
}

export type UnitInput = {
  unitTypeId: string
  number: string
  building: string | null
  floor: number
  doorType: string | null
  notes: string | null
}

export async function createUnit(actor: Actor, facilityId: string, input: UnitInput) {
  requirePermission(actor, 'units:edit', facilityId)

  const unitType = await prisma.unitType.findUniqueOrThrow({ where: { id: input.unitTypeId } })
  if (unitType.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit type ${input.unitTypeId} belongs to another facility`)
  }

  // A new unit is vacant by definition, so status and intent both start
  // `available` — no recompute needed.
  const created = await prisma.unit.create({ data: { facilityId, ...input } })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit.created',
    entityType: 'Unit',
    entityId: created.id,
    facilityId,
    after: created,
  })

  return created
}

/// Edits a unit's descriptive fields. Deliberately cannot change status — that
/// is setUnitOperationalStatus()'s job, and separating them keeps the guard
/// from being bypassable through an innocuous-looking edit form.
export async function updateUnit(actor: Actor, facilityId: string, unitId: string, input: UnitInput) {
  requirePermission(actor, 'units:edit', facilityId)

  const before = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
  if (before.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit ${unitId} does not belong to facility ${facilityId}`)
  }

  const unitType = await prisma.unitType.findUniqueOrThrow({ where: { id: input.unitTypeId } })
  if (unitType.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit type ${input.unitTypeId} belongs to another facility`)
  }

  // US-6 AC: "type changes on an occupied unit warn and do not change the
  // tenant's current rate." Nothing here touches Lease.monthlyRateCents, so the
  // rate is structurally safe; the warning is the UI's job.
  const after = await prisma.unit.update({ where: { id: unitId }, data: input })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit.updated',
    entityType: 'Unit',
    entityId: unitId,
    facilityId,
    before,
    after,
  })

  return after
}

/// The guarded path for the only status change a human may make (US-8).
/// Throws UnitStatusChangeBlockedError naming the blocking record rather than
/// failing silently or half-applying.
export async function setUnitOperationalStatus(
  actor: Actor,
  facilityId: string,
  unitId: string,
  target: string,
  reasonCode: string,
) {
  requirePermission(actor, 'units:edit', facilityId)

  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
  if (unit.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit ${unitId} does not belong to facility ${facilityId}`)
  }

  const facts = await occupancyFactsFor(unitId)
  const verdict = canSetManualStatus(target, facts)
  if (!verdict.allowed) {
    throw new UnitStatusChangeBlockedError(verdict.reason, verdict.blocking)
  }

  await prisma.unit.update({
    where: { id: unitId },
    data: { operationalStatus: target as ManualUnitStatus },
  })
  const status = await recomputeUnitStatus(unitId)

  // A manual status override is a reason-coded audit action from B-005's
  // catalog — recordAudit() refuses to write it without one.
  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit.status_overridden',
    entityType: 'Unit',
    entityId: unitId,
    facilityId,
    reasonCode,
    before: { operationalStatus: unit.operationalStatus, status: unit.status },
    after: { operationalStatus: target, status },
  })

  return status
}
