import { prisma } from '@storage/db'
import { businessDateFor } from '@storage/core/jobs'
import { createTask } from '@/lib/admin/tasks'
import { createMaintenanceTicket } from '@/lib/admin/maintenance'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.9 US-35 (B-406). The daily walk also verifies a rotating sample of
// `available` units: a unit the system offers for rent that is in fact locked
// or full is the ghost-rental and someone-else's-lock case.

export const VACANT_CHECK_RESULTS = ['ok', 'locked', 'not_empty'] as const
export type VacantCheckResult = (typeof VACANT_CHECK_RESULTS)[number]

const RESULT_TEXT: Record<Exclude<VacantCheckResult, 'ok'>, string> = {
  locked: 'found locked',
  not_empty: 'found not empty',
}

/// Raises today's check tasks: the facility's sample size, oldest-checked first
/// (never-checked first), minus what today already has — so a re-run after some
/// are recorded does not top the day back up to a full sample.
export async function raiseVacantChecks(facilityId: string, businessDate: Date): Promise<number> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { vacantCheckSample: true, timezone: true },
  })
  if (facility.vacantCheckSample <= 0) return 0

  const today = businessDateFor(businessDate, facility.timezone)
  const already = await prisma.task.count({
    where: { facilityId, type: 'vacant_unit_check', businessDate: today },
  })
  const take = facility.vacantCheckSample - already
  if (take <= 0) return 0

  const units = await prisma.unit.findMany({
    where: { facilityId, status: 'available' },
    orderBy: [{ lastVacantCheckAt: { sort: 'asc', nulls: 'first' } }, { number: 'asc' }],
    take,
    select: { id: true, number: true },
  })
  for (const unit of units) {
    await createTask({
      facilityId,
      type: 'vacant_unit_check',
      entityType: 'Unit',
      entityId: unit.id,
      at: businessDate,
      detail: `Unit ${unit.number}: confirm it is empty and unlocked.`,
    })
  }
  return units.length
}

/// Records one check. `ok` just stamps the unit. A mismatch also opens a
/// high-priority task and a blocking ticket, which moves the unit to
/// `maintenance` (the existing US-37 path) until a manager closes it.
export async function recordVacantCheck(
  actor: Actor,
  taskId: string,
  result: VacantCheckResult,
): Promise<{ ok: boolean; message: string }> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
  if (task.type !== 'vacant_unit_check') throw new Error('Not a vacant unit check.')
  assertFacilityAccess(actor, task.facilityId)
  if (!can(actor, 'tenants:edit', task.facilityId)) {
    throw new ForbiddenError('Missing permission to complete tasks', 'tenants:edit', task.facilityId)
  }
  if (task.status !== 'open') return { ok: true, message: 'Already recorded.' }

  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: task.entityId },
    select: { id: true, number: true },
  })
  const now = new Date()

  // Completed first and unconditionally: a unit rented since the sample was
  // drawn still gets its result (a mismatch on it is still a real finding).
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, status: 'open' },
    data: { status: 'completed', proof: { result }, completedByStaffId: actor.staffUserId, completedAt: now },
  })
  if (claimed.count === 0) return { ok: true, message: 'Already recorded.' }
  await prisma.unit.update({ where: { id: unit.id }, data: { lastVacantCheckAt: now } })

  if (result === 'ok') return { ok: true, message: `Unit ${unit.number} checked — empty and unlocked.` }

  const finding = `Unit ${unit.number} ${RESULT_TEXT[result]} on a vacant-unit check`
  await createTask({
    facilityId: task.facilityId,
    type: 'vacant_unit_mismatch',
    entityType: 'Unit',
    entityId: unit.id,
    priority: 'high',
    detail: `${finding}. Held off the rentable list until a manager clears the maintenance ticket.`,
  })
  await createMaintenanceTicket(actor, task.facilityId, {
    unitId: unit.id,
    title: finding,
    notes: null,
    priority: 'high',
    blocksAvailability: true,
    source: 'walkthrough',
  })
  return { ok: true, message: `${finding}. The unit is held off the rentable list and a manager task is open.` }
}
