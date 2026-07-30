import { prisma } from '@storage/db'
import type { JobRun } from '@storage/db'

export type JobItemOutcome = {
  itemId: string
  ok: boolean
  message?: string
}

export type JobContext = {
  run: JobRun
  businessDate: Date
  facilityId: string | null
  /// Records a per-item outcome for the Billing Runs screen (PRD 02 FR-4).
  /// A failed item does not fail the run — the run finishes `partial`, so one
  /// bad lease cannot stop the other 799.
  recordItem: (outcome: JobItemOutcome) => void
}

export type RunJobOptions = {
  jobName: string
  facilityId?: string | null
  businessDate: Date
  /// Re-runs a job that already completed for this date. Admin-triggered only
  /// (PRD 02 FR-4 "manually re-runnable"); the scheduler never sets it.
  force?: boolean
}

export type RunJobResult =
  | { status: 'skipped'; reason: 'already_ran' | 'in_progress'; run: JobRun }
  | { status: 'completed'; run: JobRun }

/// Runs a job exactly once per (job, facility, business date).
///
/// Idempotency is the unique constraint on JobRun, not a check-then-act: two
/// workers starting the same nightly run at the same instant will have one of
/// them lose the insert and skip, rather than both proceeding.
export async function runJob(
  options: RunJobOptions,
  handler: (context: JobContext) => Promise<void>,
): Promise<RunJobResult> {
  const { jobName, businessDate, force = false } = options
  const facilityId = options.facilityId ?? null

  const existing = await prisma.jobRun.findFirst({
    where: { jobName, facilityId, businessDate },
  })

  if (existing && !force) {
    return {
      status: 'skipped',
      reason: existing.status === 'running' ? 'in_progress' : 'already_ran',
      run: existing,
    }
  }

  let run: JobRun
  if (existing) {
    // Forced re-run: reset the row rather than creating a second one, so the
    // unique constraint keeps holding and history stays one row per date.
    run = await prisma.jobRun.update({
      where: { id: existing.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        finishedAt: null,
        itemsOk: 0,
        itemsFailed: 0,
        details: undefined,
        lastError: null,
      },
    })
  } else {
    try {
      run = await prisma.jobRun.create({ data: { jobName, facilityId, businessDate } })
    } catch {
      // Another worker created it between the read and the write.
      const claimed = await prisma.jobRun.findFirstOrThrow({
        where: { jobName, facilityId, businessDate },
      })
      return { status: 'skipped', reason: 'in_progress', run: claimed }
    }
  }

  const items: JobItemOutcome[] = []
  const recordItem = (outcome: JobItemOutcome) => {
    items.push(outcome)
  }

  try {
    await handler({ run, businessDate, facilityId, recordItem })

    const itemsFailed = items.filter((item) => !item.ok).length
    const finished = await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: itemsFailed > 0 ? 'partial' : 'succeeded',
        finishedAt: new Date(),
        itemsOk: items.length - itemsFailed,
        itemsFailed,
        details: items.length > 0 ? { items } : undefined,
      },
    })
    return { status: 'completed', run: finished }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const itemsFailed = items.filter((item) => !item.ok).length

    const failed = await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        itemsOk: items.length - itemsFailed,
        itemsFailed,
        details: items.length > 0 ? { items } : undefined,
        lastError: message.slice(0, 1000),
      },
    })
    return { status: 'completed', run: failed }
  }
}

/// The most recent successful run of a job, used to work out which business
/// dates were missed during an outage.
export async function lastSuccessfulRun(
  jobName: string,
  facilityId: string | null,
): Promise<JobRun | null> {
  return prisma.jobRun.findFirst({
    where: { jobName, facilityId, status: { in: ['succeeded', 'partial'] } },
    orderBy: { businessDate: 'desc' },
  })
}
