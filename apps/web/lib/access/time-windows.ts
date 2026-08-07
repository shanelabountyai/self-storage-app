import { prisma } from '@storage/db'
import { isAlwaysOpen } from '@storage/core/access'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { enqueueCommand } from '@/lib/access/service'

// PRD 03 US-4 AC1 (B-064): "changes propagate to all active grants via
// `setTimeWindow`."
//
// Propagation is a queued command per grant, not a write. The gate hours are
// enforced by the controller, and the controller may be offline — so this has
// to go through the same outbox, retry, backoff and dead-letter path every
// other gate instruction uses (FR-3, B-027). A direct write would silently
// "succeed" while the fence kept running last week's schedule.

/// Pushes the facility's current gate hours to every grant that can open a
/// gate, plus each grant's own extended-hours flag.
///
/// Called after a settings save and after a grant's override changes. Returns
/// how many commands were enqueued, which is what the settings screen tells the
/// operator — "propagating to 47 tenants" is the honest version of a save that
/// has not actually reached the hardware yet.
export async function propagateGateHours(facilityId: string): Promise<{ enqueued: number }> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { gateHours: true },
  })
  const schedule = parseWeeklySchedule(facility.gateHours)

  const grants = await prisma.accessGrant.findMany({
    // `pending` included deliberately: a grant provisioned moments ago has its
    // credential arriving next, and skipping it here would leave exactly one
    // tenant on no window until the next settings edit.
    where: { facilityId, state: { in: ['pending', 'active', 'suspended'] } },
    select: { id: true, extendedHours: true },
  })

  let enqueued = 0
  for (const grant of grants) {
    await enqueueCommand({
      type: 'set_time_window',
      facilityId,
      grantId: grant.id,
      payload: {
        // `isAlwaysOpen` collapses a 00:00–23:59 seven-day schedule to null.
        // A window that can never fail is noise in the command queue and one
        // more thing for a controller to get wrong.
        schedule: schedule && !isAlwaysOpen(schedule) ? schedule : null,
        extendedHours: grant.extendedHours,
      },
      // Versioned by the schedule itself, so re-saving identical hours is one
      // command rather than a fresh one per click — and genuinely changing them
      // is always a new key. The outbox dedupes on it.
      idempotencyKey: `window:${grant.id}:${scheduleVersion(facility.gateHours, grant.extendedHours)}`,
    })
    enqueued += 1
  }

  return { enqueued }
}

/// A short stable digest of what is being pushed. Not a security boundary —
/// it only has to change when the schedule does.
function scheduleVersion(schedule: unknown, extendedHours: boolean): string {
  const json = JSON.stringify(schedule ?? null) + (extendedHours ? ':24h' : '')
  let hash = 0
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash * 31 + json.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

/// Pushes the facility's current hours to ONE grant.
///
/// Called at provisioning: without it a tenant who moved in on Tuesday has
/// unrestricted access until somebody next saves the settings form, because the
/// controller enforces the window it was told about and it has been told
/// nothing about this credential.
export async function pushGateHoursForGrant(grantId: string): Promise<void> {
  const grant = await prisma.accessGrant.findUniqueOrThrow({
    where: { id: grantId },
    select: { facilityId: true, extendedHours: true },
  })
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: grant.facilityId },
    select: { gateHours: true },
  })
  const schedule = parseWeeklySchedule(facility.gateHours)

  await enqueueCommand({
    type: 'set_time_window',
    facilityId: grant.facilityId,
    grantId,
    payload: {
      schedule: schedule && !isAlwaysOpen(schedule) ? schedule : null,
      extendedHours: grant.extendedHours,
    },
    idempotencyKey: `window:${grantId}:${scheduleVersion(facility.gateHours, grant.extendedHours)}`,
  })
}

/// US-4 AC3's per-tenant override, as a mutation.
///
/// Pushes immediately rather than waiting for the next settings save — a paid
/// add-on that takes effect "some time later" is a support call.
export async function setExtendedHours(grantId: string, extendedHours: boolean): Promise<void> {
  await prisma.accessGrant.update({ where: { id: grantId }, data: { extendedHours } })
  await pushGateHoursForGrant(grantId)
}
