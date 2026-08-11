import { prisma, type Prisma } from '@storage/db'
import { businessDateFor } from '@storage/core/jobs'
import {
  diffControllerState,
  opensGate,
  summarizeDrift,
  windowFingerprint,
  type Drift,
  type ExpectedCredential,
  type GrantState,
} from '@storage/core/access'
import { createTask } from '@/lib/admin/tasks'
import { recordAudit } from '@storage/core/audit'
import { adapterFor } from './adapter'
import { ptiExpectedWindowFingerprint } from './vendors/pti-cloud'

// PRD 03 FR-9 (B-080). "Nightly + on-demand expected-vs-actual diff;
// discrepancy tasks; metrics (drift count per facility)."
//
// The comparison itself is pure and lives in packages/core/access/reconciliation.ts.
// This is the part that has to touch the world: build what WE believe from our
// tables, ask the adapter what the CONTROLLER believes, and record the answer.

export type ReconciliationResult = {
  facilityId: string
  adapter: string
  verifiable: boolean
  reason?: string
  credentialsChecked: number
  drifts: Drift[]
  permissiveCount: number
  runId: string
}

/// Everything we think this facility's controller should be holding.
///
/// Revoked credentials are INCLUDED, with `shouldOpen: false`. That is the
/// whole point of including them: a revoked code the controller still honours
/// is the single most valuable thing this job finds, and a query filtered to
/// active credentials could never see it.
async function expectedState(facilityId: string): Promise<ExpectedCredential[]> {
  const [facility, credentials] = await Promise.all([
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { gateAdapter: true, gateHours: true },
    }),
    prisma.accessCredential.findMany({
      where: { facilityId },
      select: {
        id: true,
        codeHash: true,
        state: true,
        grant: { select: { state: true, extendedHours: true } },
      },
    }),
  ])

  return credentials.map((credential) => ({
    credentialId: credential.id,
    codeHash: credential.codeHash,
    // Both have to be true. A live grant with a revoked credential must not
    // open the gate, and neither must a live credential on a suspended grant.
    shouldOpen:
      credential.state === 'active' && opensGate(credential.grant.state as GrantState),
    windowFingerprint: expectedWindowFor(facility.gateAdapter, {
      schedule: facility.gateHours,
      extendedHours: credential.grant.extendedHours,
    }),
  }))
}

/// What "the right window" means depends on which controller is out there, and
/// pretending otherwise is how a drift report becomes noise.
///
/// A PTI site cannot hold our weekly schedule at all — it has two numbered
/// windows (see vendors/pti-cloud.ts, note 4) — so comparing our schedule
/// against what that controller reports would flag every credential at every
/// PTI site, forever, for a difference nothing can ever resolve.
function expectedWindowFor(
  adapter: string,
  input: { schedule: unknown; extendedHours: boolean },
): string | null {
  if (adapter === 'pti_cloud') return ptiExpectedWindowFingerprint(input.extendedHours)
  return windowFingerprint({ schedule: input.schedule, exempt: input.extendedHours })
}

/// Runs one facility's comparison and records it.
///
/// Idempotent per facility per business date: the unique key is
/// (facilityId, businessDate), so a re-run — the on-demand button, or a cron
/// that fired twice — overwrites the day's row rather than filling the metrics
/// history with duplicates.
export async function reconcileFacility(
  facilityId: string,
  at: Date = new Date(),
): Promise<ReconciliationResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, gateAdapter: true },
  })
  const businessDate = businessDateFor(at, facility.timezone)
  const startedAt = new Date()

  const snapshot = await adapterFor(facilityId).snapshot(facilityId)

  if (!snapshot.verifiable) {
    // Recorded, not skipped. "We could not check this site" is itself the
    // finding — a facility that silently drops out of the report is one nobody
    // notices has been unverified for six months.
    const run = await saveRun({
      facilityId,
      businessDate,
      adapter: facility.gateAdapter,
      verifiable: false,
      credentialsChecked: 0,
      drifts: [],
      permissiveCount: 0,
      startedAt,
    })
    return {
      facilityId,
      adapter: facility.gateAdapter,
      verifiable: false,
      reason: snapshot.reason,
      credentialsChecked: 0,
      drifts: [],
      permissiveCount: 0,
      runId: run.id,
    }
  }

  const expected = await expectedState(facilityId)
  const drifts = diffControllerState(expected, snapshot.entries)
  const summary = summarizeDrift(drifts)

  const run = await saveRun({
    facilityId,
    businessDate,
    adapter: facility.gateAdapter,
    verifiable: true,
    credentialsChecked: expected.length,
    drifts,
    permissiveCount: summary.tooPermissive,
    startedAt,
  })

  if (drifts.length > 0) {
    // One task per facility per day, not one per finding. FR-9 says
    // "discrepancy tasks", and US-41's "one task queue, not seven" is the
    // reason it is not one per drift: a controller restored from a backup can
    // produce forty findings at once, and forty tasks is a queue nobody opens.
    await createTask({
      facilityId,
      type: 'gate_drift_review',
      entityType: 'Facility',
      entityId: facilityId,
      at,
      // A gate that is more permissive than we intend is somebody in the
      // building who should not be. A gate that is less permissive is somebody
      // on the phone. Both need doing; only one needs doing tonight.
      priority: summary.tooPermissive > 0 ? 'high' : 'normal',
    })

    await recordAudit({
      actor: { type: 'system', label: 'access.reconcile' },
      action: 'gate.drift_detected',
      entityType: 'Facility',
      entityId: facilityId,
      facilityId,
      context: {
        driftCount: drifts.length,
        permissiveCount: summary.tooPermissive,
        byKind: summary.byKind,
      },
    })
  }

  return {
    facilityId,
    adapter: facility.gateAdapter,
    verifiable: true,
    credentialsChecked: expected.length,
    drifts,
    permissiveCount: summary.tooPermissive,
    runId: run.id,
  }
}

async function saveRun(input: {
  facilityId: string
  businessDate: Date
  adapter: string
  verifiable: boolean
  credentialsChecked: number
  drifts: Drift[]
  permissiveCount: number
  startedAt: Date
}): Promise<{ id: string }> {
  const data = {
    adapter: input.adapter,
    verifiable: input.verifiable,
    credentialsChecked: input.credentialsChecked,
    driftCount: input.drifts.length,
    permissiveCount: input.permissiveCount,
    drifts: input.drifts as unknown as Prisma.InputJsonValue,
    startedAt: input.startedAt,
    finishedAt: new Date(),
  }

  return prisma.gateReconciliationRun.upsert({
    where: {
      facilityId_businessDate: {
        facilityId: input.facilityId,
        businessDate: input.businessDate,
      },
    },
    create: { facilityId: input.facilityId, businessDate: input.businessDate, ...data },
    update: data,
    select: { id: true },
  })
}

/// The most recent run per facility, for the health dashboard.
export async function latestRuns(
  facilityIds: string[],
): Promise<Map<string, { businessDate: Date; verifiable: boolean; driftCount: number; permissiveCount: number; credentialsChecked: number; finishedAt: Date | null }>> {
  if (facilityIds.length === 0) return new Map()

  const runs = await prisma.gateReconciliationRun.findMany({
    where: { facilityId: { in: facilityIds } },
    orderBy: [{ facilityId: 'asc' }, { businessDate: 'desc' }],
    distinct: ['facilityId'],
  })

  return new Map(
    runs.map((run) => [
      run.facilityId,
      {
        businessDate: run.businessDate,
        verifiable: run.verifiable,
        driftCount: run.driftCount,
        permissiveCount: run.permissiveCount,
        credentialsChecked: run.credentialsChecked,
        finishedAt: run.finishedAt,
      },
    ]),
  )
}

export async function runDetail(facilityId: string, businessDate?: Date) {
  return prisma.gateReconciliationRun.findFirst({
    where: { facilityId, ...(businessDate ? { businessDate } : {}) },
    orderBy: { businessDate: 'desc' },
  })
}
