import { prisma } from '@storage/db'
import { runJob, type JobItemOutcome } from '@storage/core/jobs'
import { can, facilityAccess, ForbiddenError, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { SCHEDULED_JOBS } from '@/lib/jobs/registry'

// PRD 02 FR-4: "logged to a Billing Runs screen with per-item outcomes, and
// manually re-runnable by admin."
//
// A read over `JobRun`, which already carries everything the screen needs —
// B-006 built the row and B-043's catch-up filled in the history. Nothing new
// is stored for this screen.

export type BillingRunRow = {
  id: string
  jobName: string
  facilityId: string | null
  facilityName: string
  businessDate: Date
  status: string
  startedAt: Date
  finishedAt: Date | null
  itemsOk: number
  itemsFailed: number
  items: JobItemOutcome[]
  lastError: string | null
  /// False for a job whose handler is no longer registered — the row is still
  /// history worth reading, it just cannot be re-run.
  rerunnable: boolean
}

const READ_PERMISSIONS = ['reports:financial', 'payments:take'] as const

/// Recent runs the actor may see, newest first.
///
/// Global runs (facilityId null) are visible only to an actor with
/// all-facilities access: a single-site manager has no business reading the
/// portfolio-wide outbox drain, and there is no facility to scope it to.
export async function recentRuns(actor: Actor, limit = 100): Promise<BillingRunRow[]> {
  if (!hasPermissionAnywhere(actor, READ_PERMISSIONS)) {
    throw new ForbiddenError('Missing permission to read billing runs', 'reports:financial')
  }
  const access = facilityAccess(actor)

  const runs = await prisma.jobRun.findMany({
    where: access.all ? {} : { facilityId: { in: access.facilityIds } },
    orderBy: [{ startedAt: 'desc' }],
    take: limit,
    include: { facility: { select: { name: true } } },
  })

  const registered = new Set(SCHEDULED_JOBS.map((job) => job.name))

  return runs.map((run) => ({
    id: run.id,
    jobName: run.jobName,
    facilityId: run.facilityId,
    facilityName: run.facility?.name ?? 'All facilities',
    businessDate: run.businessDate,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    itemsOk: run.itemsOk,
    itemsFailed: run.itemsFailed,
    items: itemsOf(run.details),
    lastError: run.lastError,
    rerunnable: registered.has(run.jobName),
  }))
}

/// `JobRun.details` is `{ items: [...] }` written by the runner. Read
/// defensively — it is JSON, and a row written by an older shape must render
/// as "no detail" rather than crash the screen.
function itemsOf(details: unknown): JobItemOutcome[] {
  if (!details || typeof details !== 'object') return []
  const items = (details as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is JobItemOutcome =>
      Boolean(item) && typeof item === 'object' && typeof (item as JobItemOutcome).itemId === 'string',
  )
}

export type RerunResult =
  | { ok: true; status: string }
  | { ok: false; reason: 'unknown_job' }

/// FR-4's manual re-run. `force` is set here and nowhere else — the scheduler
/// never sets it, which is what keeps the nightly path idempotent.
///
/// Gated on `facility:settings` rather than the read permissions above:
/// re-running a billing job re-does work that may charge money, and counter
/// staff hold `payments:take`.
export async function rerunJobRun(actor: Actor, runId: string): Promise<RerunResult> {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } })

  if (run.facilityId) {
    if (!can(actor, 'facility:settings', run.facilityId)) {
      throw new ForbiddenError('Missing permission to re-run billing jobs', 'facility:settings', run.facilityId)
    }
  } else {
    // A global run belongs to no facility, so "at this facility" cannot be
    // asked. Require both the permission and unrestricted facility access.
    if (!facilityAccess(actor).all || !hasPermissionAnywhere(actor, ['facility:settings'])) {
      throw new ForbiddenError('Missing permission to re-run global jobs', 'facility:settings')
    }
  }

  const job = SCHEDULED_JOBS.find((candidate) => candidate.name === run.jobName)
  if (!job) return { ok: false, reason: 'unknown_job' }

  const result = await runJob(
    { jobName: run.jobName, facilityId: run.facilityId, businessDate: run.businessDate, force: true },
    async ({ facilityId, recordItem }) =>
      job.handler({ facilityId, businessDate: run.businessDate, recordItem }),
  )
  return { ok: true, status: result.status === 'skipped' ? `skipped:${result.reason}` : result.run.status }
}
