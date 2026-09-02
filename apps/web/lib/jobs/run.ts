import { prisma, type JobRun } from '@storage/db'
import { runJob, type RunJobResult } from '@storage/core/jobs'
import { createTask } from '@/lib/admin/tasks'
import { MONEY_JOBS, scheduledJobLabel, type ScheduledJob } from '@/lib/jobs/registry'

// B-229 / PRD 02 FR-1, FR-4. The alarm on the nightly scheduler.
//
// `runJob` (packages/core) records what happened and returns; it has no task
// queue to reach for and should not grow one. This is the layer above it that
// every caller of a scheduled job goes through — the cron tick and the manual
// re-run — so a run that ends `failed` or `partial` raises a high-priority task
// at the facility instead of writing a row that only shows up on a screen
// somebody has to decide to open.

type RunnableJob = Pick<ScheduledJob, 'name' | 'label' | 'handler'>

export async function runScheduledJob(
  job: RunnableJob,
  options: { facilityId: string | null; businessDate: Date; force?: boolean },
): Promise<RunJobResult> {
  const result = await runJob(
    {
      jobName: job.name,
      facilityId: options.facilityId,
      businessDate: options.businessDate,
      force: options.force,
    },
    async ({ facilityId, recordItem }) =>
      job.handler({ facilityId, businessDate: options.businessDate, recordItem }),
  )

  // A skipped run is a run that already happened — its own outcome already
  // raised whatever it was going to raise.
  if (result.status === 'completed') await raiseJobFailureTask(job.label, result.run)
  return result
}

/// One sentence naming the job and what it said, for the task card's `detail`.
/// Truncated because `lastError` is a stack-free message but still up to 1000
/// characters, and this renders on a phone.
function failureDetail(label: string, run: JobRun): string | null {
  if (run.status === 'failed') {
    return `${label} did not finish${run.lastError ? `: ${truncate(run.lastError, 200)}` : '.'}`
  }
  if (run.status === 'partial') {
    return `${label} finished, but ${run.itemsFailed} item${run.itemsFailed === 1 ? '' : 's'} did not go through.`
  }
  return null
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

async function raiseJobFailureTask(label: string, run: JobRun): Promise<void> {
  const detail = failureDetail(label, run)
  if (!detail) return

  // `Task.facilityId` is required and a GLOBAL run belongs to no facility, so
  // it raises nothing here — deliberately, and this is the gap to know about.
  // Fanning one portfolio-wide failure out to every site is a wall of identical
  // cards nobody at any of those sites can act on, and picking one arbitrary
  // facility to tell would be picking the wrong one. Four jobs are global
  // (`access.drain-commands`, `checkout.expire` and the two marketing sweeps);
  // of them only the gate-command drain is urgent, and it is portfolio
  // infrastructure rather than one site's work. They stay visible on
  // /admin/billing, which now reads in plain words. A portfolio-level alert
  // channel is the right home and there is no entity for one yet.
  if (!run.facilityId) return

  await createTask({
    facilityId: run.facilityId,
    type: 'job_failed',
    entityType: 'JobRun',
    // `createTask` is unique on (type, entityId, businessDate), which is
    // exactly right per run: the same run failing again on the same day — a
    // re-run from the screen, a catch-up tick — is one task, not two.
    entityId: run.id,
    priority: 'high',
    detail,
  })
}

/// 48 hours: long enough that a single missed nightly hour (an outage the
/// catch-up will drain on the next tick) does not raise anything, short enough
/// that nobody discovers a stopped biller at month end.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

/// B-229's escalation. A money job that FAILS raises a task above; a money job
/// that never runs at all writes nothing, so nothing above can fire. This is
/// the check for that: no successful run in 48 hours at a facility, measured
/// from the last success or — for a site that has never had one — from when the
/// facility was created, so a misconfigured new site is not silent forever.
export async function raiseStaleMoneyJobTasks(
  now: Date,
  facilities: readonly { id: string; createdAt: Date }[],
): Promise<number> {
  if (facilities.length === 0) return 0

  const latest = await prisma.jobRun.findMany({
    where: {
      jobName: { in: [...MONEY_JOBS] },
      facilityId: { in: facilities.map((facility) => facility.id) },
      // `partial` counts, the same as `lastSuccessfulRun` treats it: the job
      // ran and did most of its work. The failed items raised their own task.
      status: { in: ['succeeded', 'partial'] },
      finishedAt: { not: null },
    },
    orderBy: [{ finishedAt: 'desc' }],
    distinct: ['jobName', 'facilityId'],
    select: { jobName: true, facilityId: true, finishedAt: true },
  })
  const lastSuccessAt = new Map(
    latest.map((run) => [`${run.jobName}:${run.facilityId}`, run.finishedAt as Date]),
  )

  let raised = 0
  for (const facility of facilities) {
    for (const jobName of MONEY_JOBS) {
      const since = lastSuccessAt.get(`${jobName}:${facility.id}`) ?? facility.createdAt
      const elapsedMs = now.getTime() - since.getTime()
      if (elapsedMs < STALE_AFTER_MS) continue
      const hours = Math.floor(elapsedMs / 3_600_000)

      const { created } = await createTask({
        facilityId: facility.id,
        type: 'job_failed',
        // Not a `JobRun` id — there is no run to point at, which is the whole
        // finding. Keyed per (job, facility) so the daily business-date
        // uniqueness gives one task a day until somebody fixes it.
        entityType: 'ScheduledJob',
        entityId: `${jobName}@${facility.id}`,
        at: now,
        priority: 'high',
        detail: `${scheduledJobLabel(jobName)} has not run successfully here for ${hours} hours.`,
      })
      if (created) raised += 1
    }
  }
  return raised
}
