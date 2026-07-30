import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { effectiveByGroup, parseWeeklySchedule, type WeeklySchedule } from '@storage/core/facility-settings'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 02 US-3: address/geo, timezone, office+gate hours, effective-dated tax
// components and fee schedule, state. Every write here requires
// 'facility:settings' AT the target facility — requirePermission checks both
// the permission and facility access together, since can() only matches an
// assignment scoped to that facility (or an all-facilities one).

export type FacilitySettingsView = {
  facility: NonNullable<Awaited<ReturnType<typeof prisma.facility.findUnique>>>
  officeHours: WeeklySchedule | null
  gateHours: WeeklySchedule | null
  currentTaxComponents: { jurisdiction: string; rateBasisPoints: number; effectiveFrom: Date }[]
  currentFeeSchedule: { feeType: string; amountCents: number; effectiveFrom: Date }[]
  taxComponentHistory: Awaited<ReturnType<typeof prisma.taxComponent.findMany>>
  feeScheduleHistory: Awaited<ReturnType<typeof prisma.feeSchedule.findMany>>
}

export async function getFacilitySettings(facilityId: string): Promise<FacilitySettingsView> {
  const [facility, taxComponentHistory, feeScheduleHistory] = await Promise.all([
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId } }),
    prisma.taxComponent.findMany({ where: { facilityId }, orderBy: { effectiveFrom: 'desc' } }),
    prisma.feeSchedule.findMany({ where: { facilityId }, orderBy: { effectiveFrom: 'desc' } }),
  ])

  const now = new Date()
  const currentTax = effectiveByGroup(taxComponentHistory, now, (row) => row.jurisdiction)
  const currentFee = effectiveByGroup(feeScheduleHistory, now, (row) => row.feeType)

  return {
    facility,
    officeHours: parseWeeklySchedule(facility.officeHours),
    gateHours: parseWeeklySchedule(facility.gateHours),
    currentTaxComponents: [...currentTax.values()].sort((a, b) =>
      a.jurisdiction.localeCompare(b.jurisdiction),
    ),
    currentFeeSchedule: [...currentFee.values()].sort((a, b) => a.feeType.localeCompare(b.feeType)),
    taxComponentHistory,
    feeScheduleHistory,
  }
}

export type FacilityDetailsInput = {
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  timezone: string
  phone: string | null
  email: string | null
}

export class InvalidTimezoneError extends Error {
  readonly timezone: string

  constructor(timezone: string) {
    super(`"${timezone}" is not a recognized IANA timezone`)
    this.name = 'InvalidTimezoneError'
    this.timezone = timezone
  }
}

function assertValidTimezone(timezone: string): void {
  // Intl.supportedValuesOf ships with Node/browsers — no timezone-list
  // dependency needed for this validation.
  if (!Intl.supportedValuesOf('timeZone').includes(timezone)) {
    throw new InvalidTimezoneError(timezone)
  }
}

export async function updateFacilityDetails(
  actor: Actor,
  facilityId: string,
  input: FacilityDetailsInput,
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)
  assertValidTimezone(input.timezone)

  const before = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } })
  const after = await prisma.facility.update({ where: { id: facilityId }, data: input })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'facility.settings_changed',
    entityType: 'Facility',
    entityId: facilityId,
    facilityId,
    before,
    after,
  })
}

export type FacilityHoursInput = {
  officeHours: WeeklySchedule
  gateHours: WeeklySchedule
}

export class InvalidScheduleError extends Error {
  constructor() {
    super('Every day of the week needs either "closed" or a valid open/close time')
    this.name = 'InvalidScheduleError'
  }
}

export async function updateFacilityHours(
  actor: Actor,
  facilityId: string,
  input: FacilityHoursInput,
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)

  // Re-validate rather than trusting the caller's type: this is the boundary
  // where a malformed form submission would otherwise reach the database.
  if (!parseWeeklySchedule(input.officeHours) || !parseWeeklySchedule(input.gateHours)) {
    throw new InvalidScheduleError()
  }

  const before = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } })
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: { officeHours: input.officeHours, gateHours: input.gateHours },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'facility.settings_changed',
    entityType: 'Facility',
    entityId: facilityId,
    facilityId,
    before: { officeHours: before.officeHours, gateHours: before.gateHours },
    after: { officeHours: after.officeHours, gateHours: after.gateHours },
  })
}

export type AddTaxComponentInput = {
  jurisdiction: string
  rateBasisPoints: number
  effectiveFrom: Date
}

/// Never updates or deletes a row — "changing a rate" is a new effective-dated
/// row, so a previously generated invoice's line items are never retroactively
/// affected (PRD 02 US-3 AC).
export async function addTaxComponent(
  actor: Actor,
  facilityId: string,
  input: AddTaxComponentInput,
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)

  const created = await prisma.taxComponent.create({
    data: { facilityId, ...input },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'facility.settings_changed',
    entityType: 'TaxComponent',
    entityId: created.id,
    facilityId,
    context: { jurisdiction: input.jurisdiction, rateBasisPoints: input.rateBasisPoints, effectiveFrom: input.effectiveFrom },
  })
}

export type AddFeeScheduleEntryInput = {
  feeType: 'admin' | 'late' | 'nsf' | 'lien'
  amountCents: number
  effectiveFrom: Date
}

export async function addFeeScheduleEntry(
  actor: Actor,
  facilityId: string,
  input: AddFeeScheduleEntryInput,
): Promise<void> {
  requirePermission(actor, 'facility:settings', facilityId)

  const created = await prisma.feeSchedule.create({
    data: { facilityId, ...input },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'facility.settings_changed',
    entityType: 'FeeSchedule',
    entityId: created.id,
    facilityId,
    context: { feeType: input.feeType, amountCents: input.amountCents, effectiveFrom: input.effectiveFrom },
  })
}
