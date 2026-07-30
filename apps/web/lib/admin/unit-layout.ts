import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { parseLayout, type LayoutEntry, type LayoutParseIssue } from '@storage/core/inventory'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// Applies a parsed layout to a facility. Creates units that don't exist and
// updates the ones that do, matched by unit number — the common case is
// standing up a new facility, where nothing exists yet.

export type LayoutRowPlan = {
  number: string
  action: 'create' | 'update' | 'error'
  unitTypeName: string
  detail: string
}

export type LayoutPlan = {
  rows: LayoutRowPlan[]
  createCount: number
  updateCount: number
  errorCount: number
  /// Parse failures, reported instead of a plan. Row numbers are 1-based for
  /// humans reading their own file.
  issues: LayoutParseIssue[]
}

async function buildPlan(facilityId: string, entries: LayoutEntry[]): Promise<LayoutPlan> {
  const [unitTypes, existing] = await Promise.all([
    prisma.unitType.findMany({ where: { facilityId }, select: { id: true, name: true } }),
    prisma.unit.findMany({
      where: { facilityId, number: { in: entries.map((e) => e.number) } },
      select: { id: true, number: true },
    }),
  ])

  const typeByName = new Map(unitTypes.map((t) => [t.name.toLowerCase(), t]))
  const existingByNumber = new Map(existing.map((u) => [u.number, u]))

  const rows: LayoutRowPlan[] = entries.map((entry) => {
    const unitType = typeByName.get(entry.unitTypeName.toLowerCase())
    if (!unitType) {
      // Refusing rather than creating the type: a typo'd name would silently
      // spawn a junk unit type with no dimensions or rates.
      return {
        number: entry.number,
        action: 'error',
        unitTypeName: entry.unitTypeName,
        detail: `No unit type named "${entry.unitTypeName}" at this facility. Create it first (Types tab).`,
      }
    }

    const found = existingByNumber.get(entry.number)
    const where = [entry.building, `floor ${entry.floor}`].filter(Boolean).join(', ')
    return {
      number: entry.number,
      action: found ? 'update' : 'create',
      unitTypeName: unitType.name,
      detail: found ? `Update to ${unitType.name} (${where})` : `Create as ${unitType.name} (${where})`,
    }
  })

  return {
    rows,
    createCount: rows.filter((r) => r.action === 'create').length,
    updateCount: rows.filter((r) => r.action === 'update').length,
    errorCount: rows.filter((r) => r.action === 'error').length,
    issues: [],
  }
}

export async function previewLayoutImport(
  actor: Actor,
  facilityId: string,
  raw: string,
): Promise<LayoutPlan> {
  requirePermission(actor, 'units:edit', facilityId)

  const parsed = parseLayout(raw)
  if (!parsed.ok) {
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, issues: parsed.issues }
  }
  return buildPlan(facilityId, parsed.entries)
}

export type LayoutImportResult = LayoutPlan & { applied: boolean; auditEntryId?: string }

/// All-or-nothing: if any row cannot be resolved, nothing is written. A
/// half-imported facility layout is worse than none — you cannot tell by
/// looking which half landed.
export async function applyLayoutImport(
  actor: Actor,
  facilityId: string,
  raw: string,
  reasonCode: string,
): Promise<LayoutImportResult> {
  requirePermission(actor, 'units:edit', facilityId)

  const parsed = parseLayout(raw)
  if (!parsed.ok) {
    return { rows: [], createCount: 0, updateCount: 0, errorCount: 0, issues: parsed.issues, applied: false }
  }

  const plan = await buildPlan(facilityId, parsed.entries)
  if (plan.errorCount > 0) return { ...plan, applied: false }

  const unitTypes = await prisma.unitType.findMany({ where: { facilityId }, select: { id: true, name: true } })
  const typeByName = new Map(unitTypes.map((t) => [t.name.toLowerCase(), t.id]))

  const auditEntryId = await prisma.$transaction(async (tx) => {
    for (const entry of parsed.entries) {
      const unitTypeId = typeByName.get(entry.unitTypeName.toLowerCase())!
      const shared = {
        unitTypeId,
        building: entry.building,
        floor: entry.floor,
        doorType: entry.doorType,
        mapX: entry.mapX,
        mapY: entry.mapY,
      }

      await tx.unit.upsert({
        where: { facilityId_number: { facilityId, number: entry.number } },
        // Deliberately does not touch status or operationalStatus: a layout
        // describes geometry, not occupancy, and an import must never quietly
        // free an occupied unit.
        update: shared,
        create: { facilityId, number: entry.number, ...shared },
      })
    }

    const entry = await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'unit.layout_imported',
        entityType: 'Facility',
        entityId: facilityId,
        facilityId,
        reasonCode,
        context: {
          created: plan.rows.filter((r) => r.action === 'create').map((r) => r.number),
          updated: plan.rows.filter((r) => r.action === 'update').map((r) => r.number),
        },
      },
      tx,
    )
    return entry.id
  })

  return { ...plan, applied: true, auditEntryId }
}
