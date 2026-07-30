import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { requirePermission, ForbiddenError } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 02 US-6: unit types are per-facility but clonable across facilities.
// Door type is deliberately absent here even though US-6's prose lists it as a
// unit-type attribute — B-002 already modeled doorType on Unit (a physical
// unit's door can vary within a type), and there is no defined reconciliation
// rule for having it in both places. B-010 (unit inventory) owns per-unit
// doorType; flagged for an owner decision if a per-type default is wanted.

export type UnitTypeInput = {
  name: string
  widthFt: number
  lengthFt: number
  heightFt: number | null
  climateControlled: boolean
  driveUp: boolean
  floor: number
  powerAvailable: boolean
  description: string | null
  streetRateCents: number
  webRateCents: number
}

export async function listUnitTypes(facilityId: string) {
  return prisma.unitType.findMany({
    where: { facilityId },
    orderBy: { name: 'asc' },
  })
}

export async function createUnitType(actor: Actor, facilityId: string, input: UnitTypeInput) {
  requirePermission(actor, 'units:edit', facilityId)

  const created = await prisma.unitType.create({ data: { facilityId, ...input } })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit_type.created',
    entityType: 'UnitType',
    entityId: created.id,
    facilityId,
    after: created,
  })

  return created
}

export async function updateUnitType(
  actor: Actor,
  facilityId: string,
  unitTypeId: string,
  input: UnitTypeInput,
) {
  requirePermission(actor, 'units:edit', facilityId)

  const before = await prisma.unitType.findUniqueOrThrow({ where: { id: unitTypeId } })
  if (before.facilityId !== facilityId) {
    // Belt and suspenders: requirePermission already checked facility access,
    // but this guards against a form submitting a unitTypeId that belongs to
    // a facility the request didn't claim to be editing.
    throw new ForbiddenError(`Unit type ${unitTypeId} does not belong to facility ${facilityId}`)
  }

  const after = await prisma.unitType.update({ where: { id: unitTypeId }, data: input })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit_type.updated',
    entityType: 'UnitType',
    entityId: unitTypeId,
    facilityId,
    before,
    after,
  })

  return after
}

export class DuplicateUnitTypeNameError extends Error {
  // Field named unitTypeName, not name — see the note on UnknownEventError in
  // packages/core/events/outbox.ts about that exact collision with Error.name.
  readonly unitTypeName: string

  constructor(unitTypeName: string, facilityName: string) {
    super(`${facilityName} already has a unit type named "${unitTypeName}"`)
    this.name = 'DuplicateUnitTypeNameError'
    this.unitTypeName = unitTypeName
  }
}

/// Copies every attribute except facilityId into a new UnitType at the target
/// facility. Requires 'units:edit' at the TARGET facility (creating there),
/// and merely read access at the source (cloning something you can only view,
/// e.g. as part of a cross-facility owner review, is fine).
export async function cloneUnitType(
  actor: Actor,
  sourceUnitTypeId: string,
  targetFacilityId: string,
) {
  const source = await prisma.unitType.findUniqueOrThrow({ where: { id: sourceUnitTypeId } })
  requirePermission(actor, 'units:edit', targetFacilityId)

  const targetFacility = await prisma.facility.findUniqueOrThrow({ where: { id: targetFacilityId } })
  const existing = await prisma.unitType.findUnique({
    where: { facilityId_name: { facilityId: targetFacilityId, name: source.name } },
  })
  if (existing) throw new DuplicateUnitTypeNameError(source.name, targetFacility.name)

  const cloned = await prisma.unitType.create({
    data: {
      facilityId: targetFacilityId,
      name: source.name,
      widthFt: source.widthFt,
      lengthFt: source.lengthFt,
      heightFt: source.heightFt,
      climateControlled: source.climateControlled,
      driveUp: source.driveUp,
      floor: source.floor,
      powerAvailable: source.powerAvailable,
      description: source.description,
      streetRateCents: source.streetRateCents,
      webRateCents: source.webRateCents,
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'unit_type.cloned',
    entityType: 'UnitType',
    entityId: cloned.id,
    facilityId: targetFacilityId,
    context: { sourceUnitTypeId, sourceFacilityId: source.facilityId },
    after: cloned,
  })

  return cloned
}
