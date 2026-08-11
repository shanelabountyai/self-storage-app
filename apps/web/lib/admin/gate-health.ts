import { prisma } from '@storage/db'
import { facilityAccess } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { latestRuns } from '@/lib/access/reconciliation'
import { webhookSecretStatus, type SecretStatus } from '@/lib/access/webhook-secrets'

// PRD 03 §8 Phase 2 (B-080): "per-facility adapter health dashboards".
//
// What "health" means here is deliberately narrow: the four things that go
// wrong with a gate integration and are invisible until somebody complains.
//
//   1. Commands piling up — the controller is not accepting writes.
//   2. Commands DEAD — retries gave up; a code somebody was promised is not on
//      the gate and no further attempt will be made.
//   3. Events gone quiet — the controller has stopped telling us about entries,
//      which looks identical to a quiet weekend until you compare it to one.
//   4. Drift — the controller and our records disagree (FR-9).
//
// (3) is the one nothing else in the system can see. A silent webhook feed
// produces no errors at all: every screen keeps working, every report just
// shows fewer gate events, and the first sign is a manager saying "the access
// log looks thin".

export type FacilityGateHealth = {
  facilityId: string
  facilityName: string
  adapter: string
  /// Simulator fault toggles, when the site is on the simulator.
  simulated: { offline: boolean; latencyMs: number; webhookFailing: boolean } | null
  commands: {
    pending: number
    failed: number
    awaitingManual: number
    deadLettered: number
    /// How long the oldest undelivered command has been waiting. The number
    /// that says "somebody is standing at a gate right now".
    oldestPendingMinutes: number | null
    lastSucceededAt: Date | null
  }
  events: {
    last24h: number
    lastEventAt: Date | null
    /// Hours since the last event. Null when there has never been one.
    quietHours: number | null
  }
  reconciliation: {
    businessDate: Date
    verifiable: boolean
    driftCount: number
    permissiveCount: number
    credentialsChecked: number
    finishedAt: Date | null
  } | null
  webhookSecret: SecretStatus
  cameras: number
}

/// One row per facility the actor can see.
///
/// Deliberately does NOT take a single-facility argument. An operator with
/// twelve sites finds the broken one by scanning a list, and a per-facility
/// screen would make them click through twelve to discover which — which is how
/// a gate stays down for a day.
export async function gateHealth(actor: Actor): Promise<FacilityGateHealth[]> {
  const access = facilityAccess(actor)
  const facilities = await prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, gateAdapter: true },
  })
  if (facilities.length === 0) return []

  const ids = facilities.map((facility) => facility.id)
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [commands, oldestPending, lastSucceeded, eventCounts, lastEvents, simConfigs, runs, cameraCounts] =
    await Promise.all([
      prisma.gateCommand.groupBy({
        by: ['facilityId', 'status'],
        where: { facilityId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.gateCommand.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: ids }, status: { in: ['pending', 'failed'] } },
        _min: { createdAt: true },
      }),
      prisma.gateCommand.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: ids }, status: 'succeeded' },
        _max: { completedAt: true },
      }),
      prisma.accessEvent.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: ids }, occurredAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      prisma.accessEvent.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: ids } },
        _max: { occurredAt: true },
      }),
      prisma.gateSimulatorConfig.findMany({ where: { facilityId: { in: ids } } }),
      latestRuns(ids),
      prisma.facilityCamera.groupBy({
        by: ['facilityId'],
        where: { facilityId: { in: ids } },
        _count: { _all: true },
      }),
    ])

  const commandsByFacility = new Map<string, Record<string, number>>()
  for (const row of commands) {
    const bucket = commandsByFacility.get(row.facilityId) ?? {}
    bucket[row.status] = row._count._all
    commandsByFacility.set(row.facilityId, bucket)
  }

  const oldestByFacility = new Map(oldestPending.map((row) => [row.facilityId, row._min.createdAt]))
  const lastOkByFacility = new Map(lastSucceeded.map((row) => [row.facilityId, row._max.completedAt]))
  const eventsByFacility = new Map(eventCounts.map((row) => [row.facilityId, row._count._all]))
  const lastEventByFacility = new Map(lastEvents.map((row) => [row.facilityId, row._max.occurredAt]))
  const simByFacility = new Map(simConfigs.map((row) => [row.facilityId, row]))
  const camerasByFacility = new Map(cameraCounts.map((row) => [row.facilityId, row._count._all]))

  // Sequential rather than mapped: `webhookSecretStatus` decrypts, and a dozen
  // facilities is a dozen cheap reads, not something worth a join.
  const rows: FacilityGateHealth[] = []
  for (const facility of facilities) {
    const counts = commandsByFacility.get(facility.id) ?? {}
    const oldest = oldestByFacility.get(facility.id) ?? null
    const lastEventAt = lastEventByFacility.get(facility.id) ?? null
    const sim = simByFacility.get(facility.id)
    const run = runs.get(facility.id) ?? null

    rows.push({
      facilityId: facility.id,
      facilityName: facility.name,
      adapter: facility.gateAdapter,
      simulated:
        facility.gateAdapter === 'simulated'
          ? {
              offline: sim?.offline ?? false,
              latencyMs: sim?.latencyMs ?? 0,
              webhookFailing: sim?.webhookFailing ?? false,
            }
          : null,
      commands: {
        pending: counts.pending ?? 0,
        failed: counts.failed ?? 0,
        awaitingManual: counts.awaiting_manual ?? 0,
        deadLettered: counts.dead_lettered ?? 0,
        oldestPendingMinutes: oldest
          ? Math.floor((now.getTime() - oldest.getTime()) / 60_000)
          : null,
        lastSucceededAt: lastOkByFacility.get(facility.id) ?? null,
      },
      events: {
        last24h: eventsByFacility.get(facility.id) ?? 0,
        lastEventAt,
        quietHours: lastEventAt
          ? Math.floor((now.getTime() - lastEventAt.getTime()) / 3_600_000)
          : null,
      },
      reconciliation: run,
      webhookSecret: await webhookSecretStatus(facility.id, now),
      cameras: camerasByFacility.get(facility.id) ?? 0,
    })
  }

  return rows
}

export type HealthConcern = { level: 'urgent' | 'attention'; message: string }

/// What is actually wrong here, in the order somebody should deal with it.
///
/// Pure, so the thresholds are testable and reviewable in one place rather than
/// scattered as inline conditions through JSX. Empty means healthy — and that
/// is a claim this has to be careful about making, which is why an unverifiable
/// reconciliation is a concern rather than silence.
export function concernsFor(row: FacilityGateHealth): HealthConcern[] {
  const concerns: HealthConcern[] = []

  if (row.commands.deadLettered > 0) {
    concerns.push({
      level: 'urgent',
      message: `${row.commands.deadLettered} gate command${row.commands.deadLettered === 1 ? '' : 's'} gave up retrying — somebody was promised access that never reached the gate`,
    })
  }

  if (row.reconciliation?.permissiveCount) {
    concerns.push({
      level: 'urgent',
      message: `${row.reconciliation.permissiveCount} code${row.reconciliation.permissiveCount === 1 ? '' : 's'} the gate honours more freely than we intend`,
    })
  }

  if (row.simulated?.offline) {
    concerns.push({ level: 'urgent', message: 'Simulated controller is switched to offline' })
  }

  // Four hours of a command sitting unsent is well past a retry cycle and well
  // into "the tenant has phoned twice".
  if ((row.commands.oldestPendingMinutes ?? 0) > 240) {
    concerns.push({
      level: 'attention',
      message: `Oldest unsent command has been waiting ${Math.floor((row.commands.oldestPendingMinutes ?? 0) / 60)} hours`,
    })
  }

  // A gate with no entries for 48 hours is either a very quiet site or a dead
  // webhook feed, and the two look identical from every other screen.
  if (row.events.quietHours !== null && row.events.quietHours >= 48) {
    concerns.push({
      level: 'attention',
      message: `No gate events for ${row.events.quietHours} hours — check the webhook feed before assuming it was quiet`,
    })
  }

  if (row.reconciliation && !row.reconciliation.verifiable) {
    concerns.push({
      level: 'attention',
      message: 'The controller cannot be read back, so nothing here has been verified against it',
    })
  }

  if (!row.reconciliation) {
    concerns.push({ level: 'attention', message: 'Never reconciled against the controller' })
  }

  if (row.reconciliation?.driftCount && !row.reconciliation.permissiveCount) {
    concerns.push({
      level: 'attention',
      message: `${row.reconciliation.driftCount} difference${row.reconciliation.driftCount === 1 ? '' : 's'} between our records and the controller`,
    })
  }

  return concerns
}
