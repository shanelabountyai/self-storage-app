import { prisma } from '@storage/db'
import {
  businessDateFor,
  facilitiesDueSince,
  missedBusinessDates,
  type SchedulableFacility,
} from '@storage/core/jobs'
import { SCHEDULED_JOBS, type ScheduledJob } from '@/lib/jobs/registry'

// B-236 / PRD 02 FR-4, FR-13, FR-14. What the hourly tick still owes, as data.
//
// The cron route used to decide dueness inline, one facility at a time: for
// every (job, facility) it asked the database for the last successful run, then
// ran the missing dates, serially, inside one 300-second request. Two things
// were wrong with that and only one of them was slowness.
//
//   * Work that did not fit was DROPPED, not deferred. `facilitiesDueAt`
//     matched only facilities whose local clock was AT the target hour, so the
//     next tick had nothing due and the missed run was never revisited that
//     night. Invoicing for the tail of a portfolio slipped a day, every night,
//     with the lien clock a day slow behind it.
//   * The lookup was one round trip per (job, facility). Measured on 2026-09-02
//     against 40 seeded facilities at local hour 0: 160 tuples cost 870
//     Postgres round trips, 160 of them these lookups. At the 51.6ms round trip
//     measured against Neon that tick is ~45 SECONDS of pure latency, almost
//     none of it work.
//
// So dueness is now (a) durable — `facilitiesDueSince` keeps a tuple due until
// it actually runs — and (b) resolved in ONE `groupBy` for the whole portfolio.
// The queue is grouped by facility because that is the unit that parallelises:
// jobs at one site must stay in registry order (invoices before late fees
// before dunning), and nothing about site A's night depends on site B's.

/// One outstanding (job, facility, business date) tuple.
export type DueRun = {
  job: ScheduledJob
  facilityId: string | null
  businessDate: Date
  /// A date being caught up after an outage rather than today's run. Reported
  /// so an operator reading the tick can watch a backlog drain.
  caughtUp: boolean
}

/// One facility's outstanding runs, in registry order. `facilityId` is null for
/// the global jobs, which form their own group.
export type DueGroup = { facilityId: string | null; runs: DueRun[] }

const key = (jobName: string, facilityId: string | null) => `${jobName}:${facilityId ?? ''}`

/// Everything the scheduler still owes at `now`, grouped by facility.
///
/// Pure read: two queries and no writes, which is what lets `/admin/billing`
/// call it to show a backlog. Runs already done are absent by construction —
/// `missedBusinessDates` returns nothing once the business date has a
/// successful run — so an empty result means the night is genuinely finished.
export async function dueRunQueue(
  facilities: readonly (SchedulableFacility & { id: string })[],
  now: Date,
): Promise<DueGroup[]> {
  const facilityIds = facilities.map((facility) => facility.id)

  // One GROUP BY for the whole portfolio, replacing a `lastSuccessfulRun` per
  // (job, facility). `partial` counts as success for the same reason
  // `lastSuccessfulRun` counted it: the date was attempted and its items
  // recorded, so re-running it would duplicate the ones that worked.
  //
  // Deliberately NOT bounded by date. A window would change behaviour for a
  // facility that has been down longer than the window — `missedBusinessDates`
  // treats "no history" as "run today only", and "history older than 30 days"
  // as "run the 30 days after it", which are different answers.
  const lastSuccess = await prisma.jobRun.groupBy({
    by: ['jobName', 'facilityId'],
    where: {
      jobName: { in: SCHEDULED_JOBS.map((job) => job.name) },
      status: { in: ['succeeded', 'partial'] },
      OR: [{ facilityId: { in: facilityIds } }, { facilityId: null }],
    },
    _max: { businessDate: true },
  })
  const lastByKey = new Map(
    lastSuccess.map((row) => [key(row.jobName, row.facilityId), row._max.businessDate]),
  )

  const groups = new Map<string, DueRun[]>()
  for (const job of SCHEDULED_JOBS) {
    const due =
      job.scope === 'global'
        ? now.getUTCHours() >= job.localHour
          ? [{ facility: null, businessDate: businessDateFor(now, 'UTC') }]
          : []
        : facilitiesDueSince(facilities, job.localHour, now)

    for (const { facility, businessDate } of due) {
      const facilityId = facility?.id ?? null
      const timezone = facility?.timezone ?? 'UTC'
      const previous = lastByKey.get(key(job.name, facilityId)) ?? null

      for (const date of missedBusinessDates(previous, now, timezone)) {
        const groupKey = facilityId ?? ''
        const runs = groups.get(groupKey) ?? []
        runs.push({
          job,
          facilityId,
          businessDate: date,
          caughtUp: date.getTime() !== businessDate.getTime(),
        })
        groups.set(groupKey, runs)
      }
    }
  }

  return [...groups].map(([groupKey, runs]) => ({ facilityId: groupKey || null, runs }))
}

/// Runs `worker` over `items` with at most `limit` in flight.
///
/// Bounded, not unbounded `Promise.all`: the pool behind a serverless function
/// is small (the local convention caps it at 10 per project) and a portfolio
/// fan-out would exhaust it and turn latency into connection errors. Safe to
/// parallelise at all because `runJob` is idempotent per (job, facility,
/// business date) and the groups do not share rows.
export async function inParallel<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    }),
  )
}
