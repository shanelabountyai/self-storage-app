import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@storage/db'
import { dispatchEvents } from '@storage/core/events'
import { sendExpiringSoonReminders } from '@/lib/reservations/reserve'
import { raiseAbandonmentFollowUps } from '@/lib/checkout/abandonment-job'
import { retryDeferredSmsMessages } from '@/lib/comms/service'
import { detectConsumerLag } from '@/lib/comms/detectors'
import { CONSUMERS } from '@/lib/jobs/registry'
import { dueRunQueue, inParallel } from '@/lib/jobs/queue'
import { raiseStaleMoneyJobTasks, runScheduledJob } from '@/lib/jobs/run'
import { sweepWaitlists } from '@/lib/waitlist/service'

// Vercel Cron hits this hourly (see vercel.json). Master PRD §5 lists Vercel
// Cron as the MVP option; there is no Inngest/Trigger.dev account to manage and
// nothing extra to run locally.
//
// Hourly rather than nightly because nightly jobs run in *facility-local* time
// (PRD 02 FR-4) — each tick asks which facilities have just reached their hour.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// B-236. How much of `maxDuration` the scheduled-job queue may spend, measured
// from the top of the request so the checks above it are paid out of the same
// budget. The 60-second remainder is for whatever tuple was already in flight
// when the deadline passed, plus serialising the response — a run killed at the
// platform's cap reports nothing at all, which is the outcome this exists to
// avoid.
const JOB_BUDGET_MS = 240_000

// Facilities in flight at once. Six, against a pool the local convention caps
// at 10 per project: enough that the measured ~45s of pure latency for 40
// facilities at hour 0 lands under ten, with headroom for the checks above and
// for `pg_stat_activity` to stay unremarkable. Raising it trades connection
// headroom for wall clock and nothing else — the jobs do not contend.
const FACILITY_CONCURRENCY = 6

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  // Fail closed: with no secret configured the endpoint is not callable at all.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const started = Date.now()

  // Events first: a job may enqueue work that this same tick can pick up, but
  // more importantly a backlog of undelivered events is the more urgent debt.
  const dispatch = await dispatchEvents(CONSUMERS)

  // PRD 01 US-801's 24h reminder is time-window-based, not a once-daily
  // business-date job — a reservation can enter the window at any hour, so
  // this runs every tick rather than through SCHEDULED_JOBS' once-per-day
  // shape. `expiryReminderSentAt` (not a JobRun row) is what keeps it "once".
  const reminders = await sendExpiringSoonReminders(now)

  // PRD 04 US-9 / FR-LEAD-4 (B-073). Same reasoning as the reminder above:
  // "+1h" cannot be expressed as a once-daily business-date job, so this runs
  // every tick against real elapsed time rather than through `SCHEDULED_JOBS`.
  const abandonment = await raiseAbandonmentFollowUps(now)

  // PRD 05 FR-8 (B-074). "Queue for the next window opening" — a quiet-hours
  // SMS is neither sent nor abandoned, so every tick checks whether any
  // deferred one's facility has now opened, same shape as the two checks
  // just above.
  const smsRetry = await retryDeferredSmsMessages(now)

  // PRD 01 §9 Phase 3 (B-090 part 1). A unit becomes free when somebody moves
  // out or a hold lapses, which happens at an arbitrary hour — so this runs
  // every tick against real elapsed time, the same shape as the three checks
  // above. A once-per-business-date job would leave a free unit unadvertised
  // overnight, which is the revenue this feature exists to stop losing.
  const waitlist = await sweepWaitlists(now)

  // PRD 05 FR-19 (B-075). "Alert if the event consumer lags >15 minutes" —
  // elapsed time again, not a business date, so this runs every tick like
  // the three checks above rather than through SCHEDULED_JOBS.
  const consumerLag = await detectConsumerLag(CONSUMERS, now)

  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { id: true, timezone: true, createdAt: true },
  })

  const jobResults: {
    job: string
    facilityId: string | null
    status: string
    caughtUp?: string
  }[] = []

  // B-236. Everything still owed at this instant, resolved in two queries
  // rather than one per (job, facility), and grouped by facility because that
  // is the unit that parallelises: jobs at one site keep their registry order
  // (invoices before late fees before dunning), and no site's night depends on
  // another's.
  //
  // PRD 02 FR-4's catch-up lives inside `dueRunQueue` now. It is still safe to
  // ask for unconditionally: `runJob` is idempotent per (job, facility,
  // business date), so a date that already ran is skipped rather than repeated.
  const queue = await dueRunQueue(facilities, now)
  const deadline = started + JOB_BUDGET_MS
  let deferred = 0

  await inParallel(queue, FACILITY_CONCURRENCY, async (group) => {
    for (let index = 0; index < group.runs.length; index++) {
      // The budget is checked BEFORE each tuple, never mid-run: a job that has
      // started finishes and records its own row, so nothing is left half-done
      // with no history of it. What is left is left DUE — `facilitiesDueSince`
      // keeps it due until it runs — so the next tick picks it up rather than
      // the old behaviour of dropping it until tomorrow.
      if (Date.now() >= deadline) {
        deferred += group.runs.length - index
        return
      }

      const due = group.runs[index]
      const result = await runScheduledJob(due.job, {
        facilityId: due.facilityId,
        businessDate: due.businessDate,
      })
      jobResults.push({
        job: due.job.name,
        facilityId: due.facilityId,
        // Distinguishes a catch-up run from today's in the response, so an
        // operator reading the log can see the backlog draining.
        ...(due.caughtUp ? { caughtUp: due.businessDate.toISOString().slice(0, 10) } : {}),
        status: result.status === 'skipped' ? `skipped:${result.reason}` : result.run.status,
      })
    }
  })

  // B-229. A money job that FAILS raises its own task above. This is the other
  // half: a money job that never ran at all writes no row, so there is nothing
  // for the loop above to notice. Last, so a facility whose run has just been
  // caught up is not alarmed on for the two days it was behind.
  const staleMoneyJobs = await raiseStaleMoneyJobTasks(now, facilities)

  return Response.json({
    ranAt: now.toISOString(),
    durationMs: Date.now() - started,
    dispatch,
    reminders,
    abandonment,
    smsRetry,
    waitlist,
    consumerLag,
    jobs: jobResults,
    // B-236. What the budget left behind, so an unfinished tick and a quiet one
    // do not read alike. It is not the durable record — that is
    // `/admin/billing`, which asks `dueRunQueue` the same question and so also
    // sees a tick that never fired at all, which no self-report could.
    deferred,
    staleMoneyJobs,
  })
}
