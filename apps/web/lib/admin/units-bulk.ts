import { prisma } from '@storage/db'
import type { Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { canSetManualStatus, deriveUnitStatus, type ManualUnitStatus } from '@storage/core/inventory'
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { occupancyFactsForMany, type UnitFilters } from './units'
import { unitWhere } from './unit-query'

// PRD 02 US-7: select by filter → change status, type, or attributes; preview
// the affected units and confirm; blocked transitions are skipped and
// reported; the whole thing lands as ONE audit entry with per-unit detail.
//
// Preview and apply run the *same* evaluator (`evaluateBulkOperation`). If they
// were separate implementations the preview would eventually lie about what
// apply is going to do, which is worse than having no preview at all.

/// Bulk transactions rewrite every matched row in one statement batch. This cap
/// keeps a mis-set filter from locking the whole unit table; a real 800-unit
/// facility can be done in two passes.
export const BULK_LIMIT = 500

export type BulkUnitOperation =
  | { kind: 'status'; operationalStatus: ManualUnitStatus }
  | { kind: 'unitType'; unitTypeId: string }
  | { kind: 'attributes'; building?: string | null; floor?: number; doorType?: string | null }

export type BulkRowOutcome = {
  unitId: string
  number: string
  /// `skip` means a rule refused this row; the rest of the batch still applies.
  outcome: 'apply' | 'skip'
  from: string
  to: string
  /// Why it was skipped, naming the blocking record (US-8 AC).
  skipReason?: string
  /// Applied, but the operator should know something (US-6 AC: a type change
  /// on an occupied unit warns and does not touch the tenant's rate).
  warning?: string
}

export type BulkPreview = {
  operation: BulkUnitOperation
  rows: BulkRowOutcome[]
  applyCount: number
  skipCount: number
  warningCount: number
  /// True when the filter matched more than BULK_LIMIT and the list is cut.
  truncated: boolean
  matchedTotal: number
}

type UnitForBulk = {
  id: string
  number: string
  status: string
  operationalStatus: ManualUnitStatus
  unitTypeId: string
  building: string | null
  floor: number
  doorType: string | null
}

/// Pure per-row decision, given the unit and its occupancy facts. Shared by
/// preview and apply so they cannot diverge.
function evaluateRow(
  unit: UnitForBulk,
  facts: Parameters<typeof canSetManualStatus>[1],
  operation: BulkUnitOperation,
  unitTypeNames: Map<string, string>,
): BulkRowOutcome {
  const base = { unitId: unit.id, number: unit.number }

  switch (operation.kind) {
    case 'status': {
      const verdict = canSetManualStatus(operation.operationalStatus, facts)
      if (!verdict.allowed) {
        return {
          ...base,
          outcome: 'skip',
          from: unit.status,
          to: operation.operationalStatus,
          skipReason: verdict.reason,
        }
      }
      return {
        ...base,
        outcome: 'apply',
        from: unit.status,
        to: deriveUnitStatus(operation.operationalStatus, facts),
      }
    }

    case 'unitType': {
      const from = unitTypeNames.get(unit.unitTypeId) ?? unit.unitTypeId
      const to = unitTypeNames.get(operation.unitTypeId) ?? operation.unitTypeId
      return {
        ...base,
        outcome: 'apply',
        from,
        to,
        // US-6 AC: warn, don't block — and nothing here writes
        // Lease.monthlyRateCents, so the tenant's rate is structurally safe.
        warning: facts.activeLease
          ? 'Unit is occupied. The type changes but the tenant’s current rate does not.'
          : undefined,
      }
    }

    case 'attributes': {
      const changes: string[] = []
      if (operation.building !== undefined && operation.building !== unit.building) {
        changes.push(`building ${unit.building ?? '—'} → ${operation.building ?? '—'}`)
      }
      if (operation.floor !== undefined && operation.floor !== unit.floor) {
        changes.push(`floor ${unit.floor} → ${operation.floor}`)
      }
      if (operation.doorType !== undefined && operation.doorType !== unit.doorType) {
        changes.push(`door ${unit.doorType ?? '—'} → ${operation.doorType ?? '—'}`)
      }
      if (changes.length === 0) {
        return { ...base, outcome: 'skip', from: '—', to: '—', skipReason: 'Already matches; nothing to change.' }
      }
      return { ...base, outcome: 'apply', from: '—', to: changes.join(', ') }
    }
  }
}

async function loadCandidates(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters,
): Promise<{ units: UnitForBulk[]; matchedTotal: number; truncated: boolean }> {
  const where: Prisma.UnitWhereInput = unitWhere(actor, facilityId, filters)

  const [matchedTotal, units] = await Promise.all([
    prisma.unit.count({ where }),
    prisma.unit.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        operationalStatus: true,
        unitTypeId: true,
        building: true,
        floor: true,
        doorType: true,
      },
      orderBy: [{ building: 'asc' }, { floor: 'asc' }, { number: 'asc' }],
      take: BULK_LIMIT,
    }),
  ])

  return { units, matchedTotal, truncated: matchedTotal > BULK_LIMIT }
}

async function evaluateBulkOperation(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters,
  operation: BulkUnitOperation,
): Promise<BulkPreview> {
  const { units, matchedTotal, truncated } = await loadCandidates(actor, facilityId, filters)
  const facts = await occupancyFactsForMany(units.map((u) => u.id))

  const unitTypes = await prisma.unitType.findMany({
    where: { facilityId },
    select: { id: true, name: true },
  })
  const unitTypeNames = new Map(unitTypes.map((t) => [t.id, t.name]))

  if (operation.kind === 'unitType' && !unitTypeNames.has(operation.unitTypeId)) {
    throw new ForbiddenError(`Unit type ${operation.unitTypeId} does not belong to facility ${facilityId}`)
  }

  const rows = units.map((unit) =>
    evaluateRow(unit, facts.get(unit.id)!, operation, unitTypeNames),
  )

  return {
    operation,
    rows,
    applyCount: rows.filter((r) => r.outcome === 'apply').length,
    skipCount: rows.filter((r) => r.outcome === 'skip').length,
    warningCount: rows.filter((r) => r.warning).length,
    truncated,
    matchedTotal,
  }
}

/// Read-only. Shows exactly what apply would do (US-7: "preview affected units
/// and require confirmation").
export async function previewBulkOperation(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters,
  operation: BulkUnitOperation,
): Promise<BulkPreview> {
  requirePermission(actor, 'units:edit', facilityId)
  return evaluateBulkOperation(actor, facilityId, filters, operation)
}

export type BulkApplyResult = BulkPreview & { auditEntryId: string }

/// Applies the operation to every row the evaluator says to apply, skipping
/// the rest. Atomic across the applied set plus its audit entry: either the
/// whole batch and its record commit, or neither.
export async function applyBulkOperation(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters,
  operation: BulkUnitOperation,
  reasonCode: string,
  /// Free text beside the chosen code, not instead of it. The code is what
  /// keeps US-38's log filterable; the note is for the half of a real reason
  /// no vocabulary anticipates ("roof leak, north row, per Dave").
  reasonNote?: string | null,
): Promise<BulkApplyResult> {
  requirePermission(actor, 'units:edit', facilityId)

  // Re-evaluated here rather than trusting a preview the client round-tripped —
  // a lease could have been signed between preview and confirm.
  const preview = await evaluateBulkOperation(actor, facilityId, filters, operation)
  const toApply = preview.rows.filter((r) => r.outcome === 'apply')

  const auditEntryId = await prisma.$transaction(async (tx) => {
    for (const row of toApply) {
      switch (operation.kind) {
        case 'status':
          await tx.unit.update({
            where: { id: row.unitId },
            data: {
              operationalStatus: operation.operationalStatus,
              // `to` is the derived effective status from the same evaluation,
              // so this stays consistent with recomputeUnitStatus().
              status: row.to as Prisma.UnitUpdateInput['status'],
            },
          })
          break
        case 'unitType':
          await tx.unit.update({
            where: { id: row.unitId },
            data: { unitTypeId: operation.unitTypeId },
          })
          break
        case 'attributes':
          await tx.unit.update({
            where: { id: row.unitId },
            data: {
              ...(operation.building !== undefined && { building: operation.building }),
              ...(operation.floor !== undefined && { floor: operation.floor }),
              ...(operation.doorType !== undefined && { doorType: operation.doorType }),
            },
          })
          break
      }
    }

    // US-7 AC: ONE grouped audit entry with per-unit detail. Anchored to the
    // facility rather than a unit, because the operation is not about any
    // single unit. Trade-off: filtering the log by one unit will not surface
    // the bulk edit that touched it — the per-unit detail lives in the entry.
    const entry = await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'unit.bulk_edited',
        entityType: 'Facility',
        entityId: facilityId,
        facilityId,
        reasonCode,
        context: {
          ...(reasonNote ? { reasonNote } : {}),
          operation,
          filters,
          matchedTotal: preview.matchedTotal,
          truncated: preview.truncated,
          applied: toApply.map((r) => ({ unitId: r.unitId, number: r.number, from: r.from, to: r.to })),
          skipped: preview.rows
            .filter((r) => r.outcome === 'skip')
            .map((r) => ({ unitId: r.unitId, number: r.number, reason: r.skipReason })),
        },
      },
      tx,
    )
    return entry.id
  })

  return { ...preview, auditEntryId }
}
