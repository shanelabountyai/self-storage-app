import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import type { HoldLike } from '@storage/core/holds'
import { sendBroadcast } from '@/lib/admin/broadcast'
import { systemLiftHold } from '@/lib/admin/holds'
import { createTask } from '@/lib/admin/tasks'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-42 "an emergency hold covers a region" (B-420). One action places
// an `emergency` hold on every occupying lease at the chosen facilities, or at
// every facility in a county. The hold itself is the ordinary per-lease row
// from B-096, so nothing downstream learned a new concept: the ladder, the
// late-fee run, the gate and the auction screen all read the catalog.

export type EmergencyHoldInput = {
  /// Either a list of facilities or a county within a state. Both is a list.
  facilityIds?: readonly string[]
  county?: { state: string; county: string } | null
  effectiveFrom: Date
  effectiveTo: Date
  reason: string
  /// Optional broadcast to affected tenants, through CN-21's operational
  /// template. Needs `comms:broadcast` at each facility on top of `tenants:edit`.
  broadcast?: { subject: string; message: string } | null
}

/// `problem` is `sendBroadcast`'s refusal for that site, when it refused.
export type BroadcastOutcome = { recipients: number; sent: number; failed: number; problem?: string }

export type EmergencyHoldResult =
  | { ok: true; facilities: number; leases: number; broadcast: BroadcastOutcome[] }
  | { ok: false; reason: 'no_facilities' | 'bad_dates' | 'missing_reason' }

/// The facilities the input names, or the county resolves to. Active only.
export async function emergencyHoldFacilities(
  input: Pick<EmergencyHoldInput, 'facilityIds' | 'county'>,
): Promise<{ id: string; name: string }[]> {
  const ids = [...(input.facilityIds ?? [])]
  const county = input.county?.county.trim()
  if (ids.length === 0 && !county) return []
  return prisma.facility.findMany({
    where: {
      status: 'active',
      OR: [
        ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
        ...(county
          ? [{ state: input.county!.state.toUpperCase(), county: { equals: county, mode: 'insensitive' as const } }]
          : []),
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export async function placeEmergencyHold(actor: Actor, input: EmergencyHoldInput): Promise<EmergencyHoldResult> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff only', 'tenants:edit', null)
  const reason = input.reason.trim()
  if (!reason) return { ok: false, reason: 'missing_reason' }
  if (input.effectiveTo.getTime() <= input.effectiveFrom.getTime()) return { ok: false, reason: 'bad_dates' }

  const facilities = await emergencyHoldFacilities(input)
  if (facilities.length === 0) return { ok: false, reason: 'no_facilities' }
  // Every site, before any write: a county-wide hold a staffer can only half
  // place is refused whole, not placed on the half they can reach.
  for (const facility of facilities) {
    assertFacilityAccess(actor, facility.id)
    if (!can(actor, 'tenants:edit', facility.id)) {
      throw new ForbiddenError('Missing permission to place a hold', 'tenants:edit', facility.id)
    }
    if (input.broadcast && !can(actor, 'comms:broadcast', facility.id)) {
      throw new ForbiddenError('Missing permission to send the broadcast', 'comms:broadcast', facility.id)
    }
  }
  const facilityIds = facilities.map((f) => f.id)

  const leases = await prisma.lease.findMany({
    where: { facilityId: { in: facilityIds }, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: { id: true, facilityId: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.leaseHold.createMany({
      data: leases.map((lease) => ({
        leaseId: lease.id,
        type: 'emergency',
        reason,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        placedByStaffId: actor.staffUserId,
      })),
    })
    // One row for the action. Per-lease `hold.placed` rows are deliberately
    // NOT written here: `placeHold`'s row exists so a lifted hold can be
    // traced, and this one carries every id a reader would need.
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'hold.emergency_placed',
        entityType: 'Facility',
        entityId: facilityIds[0],
        facilityId: null,
        reasonCode: 'emergency',
        context: {
          facilityIds,
          county: input.county ?? null,
          leases: leases.length,
          reason,
          effectiveFrom: input.effectiveFrom.toISOString(),
          effectiveTo: input.effectiveTo.toISOString(),
        },
      },
      tx,
    )
  })

  const broadcast: BroadcastOutcome[] = []
  if (input.broadcast) {
    for (const facilityId of facilityIds) {
      const result = await sendBroadcast(actor, {
        facilityId,
        templateKey: 'broadcast.notice',
        subject: input.broadcast.subject,
        message: input.broadcast.message,
        filter: {},
      })
      broadcast.push(
        result.ok
          ? { recipients: result.recipients, sent: result.sent, failed: result.failed }
          : { recipients: 0, sent: 0, failed: 0, problem: result.problem },
      )
    }
  }

  return { ok: true, facilities: facilities.length, leases: leases.length, broadcast }
}

/// B-420. Every emergency hold each lease has ever carried, for `pausedDays`.
/// Lifted ones included, since the days they ran still do not count.
export async function emergencyHoldsByLease(leaseIds: readonly string[]): Promise<Map<string, HoldLike[]>> {
  if (leaseIds.length === 0) return new Map()
  const rows = await prisma.leaseHold.findMany({
    where: { leaseId: { in: [...leaseIds] }, type: 'emergency' },
    select: { leaseId: true, type: true, effectiveFrom: true, effectiveTo: true, liftedAt: true },
  })
  const byLease = new Map<string, HoldLike[]>()
  for (const row of rows) byLease.set(row.leaseId, [...(byLease.get(row.leaseId) ?? []), row])
  return byLease
}

/// Nightly. An emergency hold past its end date is already inert
/// (`holdIsActive`), so this only closes the row and tells a person: one
/// `emergency_hold_ended` task per facility, naming how many leases resume.
export async function liftEndedEmergencyHolds(
  facilityId: string,
  now: Date,
  recordItem: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<void> {
  const ended = await prisma.leaseHold.findMany({
    where: { type: 'emergency', liftedAt: null, effectiveTo: { lte: now }, lease: { facilityId } },
    select: { id: true },
  })
  if (ended.length === 0) return
  for (const hold of ended) await systemLiftHold(hold.id, 'Emergency hold ended', 'emergency_ended')
  await createTask({
    facilityId,
    type: 'emergency_hold_ended',
    entityType: 'Facility',
    entityId: facilityId,
    priority: 'high',
    detail: `${ended.length} ${ended.length === 1 ? 'lease resumes' : 'leases resume'} collections, late fees and the lien timeline from today.`,
  })
  recordItem({ itemId: facilityId, ok: true, message: `emergency hold ended on ${ended.length} leases` })
}
