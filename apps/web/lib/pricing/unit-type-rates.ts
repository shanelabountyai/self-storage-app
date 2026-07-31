import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { effectiveAsOf, effectiveByGroup } from '@storage/core/facility-settings'
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 02 US-9. Rates are resolved at read time from the effective-dated
// history rather than cached on UnitType — see the schema comment on
// UnitTypeRate for why a denormalized "current rate" cannot stay correct.
//
// The "which row wins as of a date" logic is B-008's `effectiveAsOf` /
// `effectiveByGroup`, reused rather than reimplemented. That function is the
// single definition of effective-dating for tax components, fee schedules, and
// now rates; B-056's delinquency timelines should use it too.

export type ResolvedRate = {
  id?: string
  unitTypeId: string
  streetRateCents: number
  webRateCents: number
  effectiveFrom: Date
}

/// Current rate per unit type across a whole facility, in one query.
/// Unit types whose only rates start in the future are absent from the map —
/// they have no price yet, which callers must handle rather than defaulting
/// to zero and quietly renting something for free.
export async function currentRatesForFacility(
  facilityId: string,
  asOf: Date = new Date(),
): Promise<Map<string, ResolvedRate>> {
  const rows = await prisma.unitTypeRate.findMany({
    where: { facilityId },
    select: { unitTypeId: true, streetRateCents: true, webRateCents: true, effectiveFrom: true },
  })
  return effectiveByGroup(rows, asOf, (row) => row.unitTypeId)
}

export async function currentRateForUnitType(
  unitTypeId: string,
  asOf: Date = new Date(),
): Promise<ResolvedRate | null> {
  const rows = await prisma.unitTypeRate.findMany({
    where: { unitTypeId },
    select: { id: true, unitTypeId: true, streetRateCents: true, webRateCents: true, effectiveFrom: true },
  })
  return effectiveAsOf(rows, asOf)
}

export type RateHistoryRow = {
  id: string
  streetRateCents: number
  webRateCents: number
  effectiveFrom: Date
  /// Resolved here, not in the view: "which row is current" is effective-dating
  /// logic, and a component that computed it would have to read the clock
  /// during render — impure, and able to disagree between rows in one pass.
  state: 'scheduled' | 'current' | 'superseded'
}

/// Full history, newest first — the "rate history per unit type is viewable"
/// half of the US-9 AC. Every row is labelled against a single `asOf`, so the
/// whole table is consistent with itself.
export async function rateHistoryForUnitType(
  unitTypeId: string,
  asOf: Date = new Date(),
): Promise<RateHistoryRow[]> {
  const rows = await prisma.unitTypeRate.findMany({
    where: { unitTypeId },
    orderBy: { effectiveFrom: 'desc' },
  })

  const current = effectiveAsOf(rows, asOf)
  return rows.map((row) => ({
    id: row.id,
    streetRateCents: row.streetRateCents,
    webRateCents: row.webRateCents,
    effectiveFrom: row.effectiveFrom,
    state:
      row.effectiveFrom.getTime() > asOf.getTime()
        ? 'scheduled'
        : row.id === current?.id
          ? 'current'
          : 'superseded',
  }))
}

export type NewRateInput = {
  streetRateCents: number
  webRateCents: number
  effectiveFrom: Date
}

/// Publishes a new rate. Never edits or deletes an existing row, so history is
/// complete by construction and an in-flight lease is untouched — US-9's
/// "never alter existing leases" holds because nothing here writes
/// Lease.monthlyRateCents.
///
/// Requires `rates:street:change`. `rates:street:propose` (which manager holds)
/// is a separate propose-then-approve workflow that no backlog item builds yet.
export async function publishUnitTypeRate(
  actor: Actor,
  facilityId: string,
  unitTypeId: string,
  input: NewRateInput,
) {
  requirePermission(actor, 'rates:street:change', facilityId)

  const unitType = await prisma.unitType.findUniqueOrThrow({ where: { id: unitTypeId } })
  if (unitType.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit type ${unitTypeId} belongs to another facility`)
  }

  const previous = await currentRateForUnitType(unitTypeId, input.effectiveFrom)

  const created = await prisma.unitTypeRate.create({
    data: { facilityId, unitTypeId, ...input },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'rate.street_changed',
    entityType: 'UnitType',
    entityId: unitTypeId,
    facilityId,
    before: previous
      ? { streetRateCents: previous.streetRateCents, webRateCents: previous.webRateCents }
      : null,
    after: { streetRateCents: created.streetRateCents, webRateCents: created.webRateCents },
    context: { effectiveFrom: created.effectiveFrom, unitTypeName: unitType.name },
  })

  return created
}
