import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { effectiveByGroup } from '@storage/core/facility-settings'
import {
  DEFAULT_UNRENTABLE_LIMITS,
  daysUnrentable,
  rentLostCents,
  type UnrentableLimits,
  type UnrentableReason,
} from '@storage/core/inventory'
import { can, requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 02 US-8 "AC (unrentable says why)" (B-433): the org's two limits and the
// portfolio list. The write itself is `setUnitOperationalStatus`.

export async function getUnrentableLimits(): Promise<UnrentableLimits> {
  // A read, never an upsert: the screen asks twice in one render, and two
  // creates of the one row race into a unique-constraint failure.
  const row = await prisma.orgSetting.findUnique({ where: { id: 'org' } })
  return row
    ? { maxUnits: row.unrentableMaxUnits, maxDays: row.unrentableMaxDays }
    : DEFAULT_UNRENTABLE_LIMITS
}

export async function saveUnrentableLimits(actor: Actor, limits: UnrentableLimits): Promise<void> {
  requirePermission(actor, 'org:defaults', null)
  const before = await getUnrentableLimits()
  const data = { unrentableMaxUnits: limits.maxUnits, unrentableMaxDays: limits.maxDays }
  await prisma.orgSetting.upsert({ where: { id: 'org' }, create: data, update: data })
  await recordAudit({
    actor: toAuditActor(actor),
    action: 'org_setting.updated',
    entityType: 'OrgSetting',
    entityId: 'org',
    before,
    after: limits,
  })
}

export type UnrentableRow = {
  unitId: string
  number: string
  facilityId: string
  facilityName: string
  unitTypeName: string
  /// Null on a unit made unrentable before B-433 asked why.
  reason: UnrentableReason | null
  note: string | null
  setAt: Date | null
  setByName: string | null
  reviewAt: Date | null
  days: number | null
  /// Null when the days are unknown or the unit type has no current rate.
  rentLostCents: number | null
  /// The review date has passed, or there is none and the org's days are up.
  overdue: boolean
  canEdit: boolean
}

/// Every unrentable unit at the given facilities, longest first. Units with no
/// recorded date sort to the top: nobody knows how long, which is the worst case.
export async function listUnrentableUnits(
  actor: Actor,
  facilityIds: string[],
  now: Date = new Date(),
): Promise<UnrentableRow[]> {
  const visible = facilityIds.filter((id) => can(actor, 'tenants:view', id))
  const [units, rates, limits] = await Promise.all([
    prisma.unit.findMany({
      where: { facilityId: { in: visible }, operationalStatus: 'unrentable' },
      select: {
        id: true,
        number: true,
        facilityId: true,
        unitTypeId: true,
        unrentableReason: true,
        unrentableNote: true,
        unrentableSetAt: true,
        unrentableReviewAt: true,
        facility: { select: { name: true } },
        unitType: { select: { name: true } },
        unrentableSetByStaff: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId: { in: visible } },
      select: { unitTypeId: true, streetRateCents: true, effectiveFrom: true },
    }),
    getUnrentableLimits(),
  ])
  const rateByType = effectiveByGroup(rates, now, (row) => row.unitTypeId)

  return units
    .map((unit) => {
      const days = unit.unrentableSetAt ? daysUnrentable(unit.unrentableSetAt, now) : null
      const rate = rateByType.get(unit.unitTypeId)
      return {
        unitId: unit.id,
        number: unit.number,
        facilityId: unit.facilityId,
        facilityName: unit.facility.name,
        unitTypeName: unit.unitType.name,
        reason: unit.unrentableReason,
        note: unit.unrentableNote,
        setAt: unit.unrentableSetAt,
        setByName: unit.unrentableSetByStaff
          ? `${unit.unrentableSetByStaff.firstName} ${unit.unrentableSetByStaff.lastName}`.trim()
          : null,
        reviewAt: unit.unrentableReviewAt,
        days,
        rentLostCents: days !== null && rate ? rentLostCents(rate.streetRateCents, days) : null,
        overdue: unit.unrentableReviewAt
          ? unit.unrentableReviewAt.getTime() < now.getTime()
          : days === null || days > limits.maxDays,
        canEdit: can(actor, 'units:edit', unit.facilityId),
      }
    })
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || a.number.localeCompare(b.number))
}
