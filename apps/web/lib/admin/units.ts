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
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { unitWhere, type UnitFilters } from './unit-query'

// The adapter between the pure rule in @storage/core/inventory and real rows.
// Everything that writes Unit.status goes through recomputeUnitStatus() — that
// is the whole point of US-8, and a direct `data: { status }` write anywhere
// else is a bug.

export class UnitStatusChangeBlockedError extends Error {
  readonly blocking: { type: 'lease' | 'reservation' | 'overlock' | 'maintenance_ticket'; id: string } | null

  constructor(message: string, blocking: { type: 'lease' | 'reservation' | 'overlock' | 'maintenance_ticket'; id: string } | null) {
    super(message)
    this.name = 'UnitStatusChangeBlockedError'
    this.blocking = blocking
  }
}

/// Facts for many units in two queries rather than two per unit. Bulk
/// operations and the grid view both need this — the single-unit version below
/// is a thin wrapper so there is only one definition of "what occupies a unit".
export async function occupancyFactsForMany(
  unitIds: readonly string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, UnitOccupancyFacts>> {
  const facts = new Map<string, UnitOccupancyFacts>(
    unitIds.map((id) => [
      id,
      {
        activeLease: null,
        activeReservation: null,
        activeCheckoutLock: null,
        // Filled from `UnitOverlock` below (B-058). A unit is overlocked when
        // a lock has been FITTED, not when one was asked for — a status that
        // flipped on the request would read as locked while the lock was still
        // in the office, and this status is what the occupancy report and an
        // auction file both read.
        overlocked: false,
        blockingMaintenanceTicket: null,
      },
    ]),
  )
  if (unitIds.length === 0) return facts

  const [leases, reservations, checkoutLocks, basketLocks, overlocks, blockingTickets] =
    await Promise.all([
    client.lease.findMany({
      where: {
        unitId: { in: [...unitIds] },
        status: { in: [...OCCUPYING_LEASE_STATUSES] },
        deletedAt: null,
      },
      select: { id: true, status: true, unitId: true },
    }),
    // Serves every source (B-140): a unit is genuinely reserved whether the
    // hold is a prospect's own or a transfer's — this only decides what the
    // unit-status board shows, not what email goes out.
    client.reservation.findMany({
      where: { unitId: { in: [...unitIds] }, status: 'held', expiresAt: { gt: new Date() } },
      select: { id: true, unitId: true },
    }),
    // A move-in in progress holds its unit for 30 minutes (B-020). Same
    // "not past its expiry" rule as a reservation: a lapsed lock holds nothing,
    // whether or not the sweep has run yet.
    client.checkoutSession.findMany({
      where: { unitId: { in: [...unitIds] }, status: 'active', lockExpiresAt: { gt: new Date() } },
      select: { id: true, unitId: true },
    }),
    // B-106 part 5. The BASKET holds units too, and only the first of them is
    // the session's own `unitId`. Without this a renter who added a second unit
    // held it in their checkout while the public site went on selling it — the
    // overselling failure the lock exists to prevent, arriving by a door the
    // lock did not cover. Same expiry rule, read through the session because
    // one lock covers the whole basket.
    client.checkoutSessionUnit.findMany({
      where: {
        unitId: { in: [...unitIds] },
        session: { status: 'active', lockExpiresAt: { gt: new Date() } },
      },
      select: { checkoutSessionId: true, unitId: true },
    }),
    // B-058. `appliedAt` not null, not merely requested: a lock that has been
    // ASKED for is a task in somebody's queue, and the unit is not overlocked
    // until they have actually been out and fitted it.
    client.unitOverlock.findMany({
      where: { unitId: { in: [...unitIds] }, removedAt: null, appliedAt: { not: null } },
      select: { unitId: true },
    }),
    // B-060. Only tickets that actually claim to block — a cosmetic ticket
    // must never stop a unit from renting.
    client.maintenanceTicket.findMany({
      where: { unitId: { in: [...unitIds] }, status: { not: 'done' }, blocksAvailability: true },
      select: { id: true, unitId: true },
    }),
  ])

  for (const lease of leases) {
    const entry = facts.get(lease.unitId!)
    if (entry) entry.activeLease = { id: lease.id, status: lease.status }
  }
  for (const reservation of reservations) {
    const entry = reservation.unitId ? facts.get(reservation.unitId) : undefined
    if (entry) entry.activeReservation = { id: reservation.id }
  }
  for (const session of checkoutLocks) {
    const entry = session.unitId ? facts.get(session.unitId) : undefined
    if (entry) entry.activeCheckoutLock = { id: session.id }
  }
  // After the session pass, so a unit held by both reports the same lock id
  // either way — the basket line and the session's own column name one lock.
  for (const line of basketLocks) {
    const entry = line.unitId ? facts.get(line.unitId) : undefined
    if (entry && !entry.activeCheckoutLock) {
      entry.activeCheckoutLock = { id: line.checkoutSessionId }
    }
  }
  for (const overlock of overlocks) {
    const entry = facts.get(overlock.unitId)
    if (entry) entry.overlocked = true
  }
  for (const ticket of blockingTickets) {
    const entry = facts.get(ticket.unitId)
    // First one found wins — `canSetManualStatus` only needs a name to put in
    // the error, not every open ticket.
    if (entry && !entry.blockingMaintenanceTicket) entry.blockingMaintenanceTicket = { id: ticket.id }
  }

  return facts
}

/// Gathers the facts the derivation needs for one unit.
async function occupancyFactsFor(
  unitId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UnitOccupancyFacts> {
  const facts = await occupancyFactsForMany([unitId], client)
  return facts.get(unitId)!
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

export type { UnitFilters } from './unit-query'

/// B-116 (UX review 2026-08-12 finding 12; accessibility review finding 7,
/// D-48). `listUnits` had no `take`: a single facility renders ~100 rows, the
/// portfolio 290, each carrying a status `<select>`, a submit button and a
/// "Report issue" link — roughly 900 tab stops between the top of the table
/// and the bulk-edit heading below it. Same page size as the tenant list
/// (`tenant-list.ts`), not a second convention.
export const UNIT_PAGE_SIZE = 50

export type UnitOccupant = { tenantId: string; tenantName: string }

export type UnitList = {
  rows: (Awaited<ReturnType<typeof prisma.unit.findMany>>[number] & {
    unitType: { id: string; name: string; widthFt: number; lengthFt: number }
    /// Who is in this unit, if anyone — B-116: "who is in B-14?" used to be
    /// answerable only by leaving this screen for Tenants and searching.
    /// `null` for a vacant unit; present whenever a non-ended lease exists,
    /// including an overlocked one — an overlock does not evict the tenant.
    occupant: UnitOccupant | null
  })[]
  total: number
  page: number
  pageSize: number
}

export async function listUnits(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters = {},
  options: { page?: number } = {},
): Promise<UnitList> {
  const page = Math.max(1, options.page ?? 1)
  const where = unitWhere(actor, facilityId, filters)

  const [rows, total] = await Promise.all([
    prisma.unit.findMany({
      // Same selector bulk operations use — the rows the operator sees are
      // the rows a bulk edit will consider. Bulk edit itself reads `where`
      // again through `evaluateBulkOperation`, unpaginated by design — a
      // change applies to everything the filter matches, not just this page.
      where,
      include: { unitType: { select: { id: true, name: true, widthFt: true, lengthFt: true } } },
      orderBy: [{ building: 'asc' }, { floor: 'asc' }, { number: 'asc' }],
      skip: (page - 1) * UNIT_PAGE_SIZE,
      take: UNIT_PAGE_SIZE,
    }),
    prisma.unit.count({ where }),
  ])

  const leases = rows.length
    ? await prisma.lease.findMany({
        where: { unitId: { in: rows.map((u) => u.id) }, status: { in: [...OCCUPYING_LEASE_STATUSES] }, deletedAt: null },
        select: { unitId: true, tenantId: true, tenant: { select: { firstName: true, lastName: true } } },
      })
    : []
  const occupantByUnit = new Map<string, UnitOccupant>(
    leases.map((lease) => [
      lease.unitId!,
      { tenantId: lease.tenantId, tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}` },
    ]),
  )

  return {
    rows: rows.map((unit) => ({ ...unit, occupant: occupantByUnit.get(unit.id) ?? null })),
    total,
    page,
    pageSize: UNIT_PAGE_SIZE,
  }
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
