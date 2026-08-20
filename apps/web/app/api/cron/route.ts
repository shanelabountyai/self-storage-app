import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@storage/db'
import { dispatchEvents } from '@storage/core/events'
import { facilitiesDueAt, lastSuccessfulRun, missedBusinessDates, runJob } from '@storage/core/jobs'
import { sendExpiringSoonReminders } from '@/lib/reservations/reserve'
import { raiseAbandonmentFollowUps } from '@/lib/checkout/abandonment-job'
import { retryDeferredSmsMessages } from '@/lib/comms/service'
import { detectConsumerLag } from '@/lib/comms/detectors'
import { CONSUMERS, SCHEDULED_JOBS } from '@/lib/jobs/registry'
import { sweepWaitlists } from '@/lib/waitlist/service'

// Vercel Cron hits this hourly (see vercel.json). Master PRD §5 lists Vercel
// Cron as the MVP option; there is no Inngest/Trigger.dev account to manage and
// nothing extra to run locally.
//
// Hourly rather than nightly because nightly jobs run in *facility-local* time
// (PRD 02 FR-4) — each tick asks which facilities have just reached their hour.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
    select: { id: true, timezone: true },
  })

  const jobResults: {
    job: string
    facilityId: string | null
    status: string
    caughtUp?: string
  }[] = []

  for (const job of SCHEDULED_JOBS) {
    const due =
      job.scope === 'global'
        ? now.getUTCHours() === job.localHour
          ? [{ facility: null, businessDate: new Date(Date.UTC(
              now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) }]
          : []
        : facilitiesDueAt(facilities, job.localHour, now)

    for (const { facility, businessDate } of due) {
      // PRD 02 FR-4's catch-up. `due` only ever contains facilities whose
      // local clock is AT the target hour right now — so an outage spanning
      // that hour meant the run was skipped and never revisited, silently and
      // permanently. Every missed business date since the last successful run
      // is run first, oldest first, then today's.
      //
      // Safe to do unconditionally: runJob is idempotent per (job, facility,
      // business date), so a date that did run is skipped rather than
      // repeated. On the normal path `missedBusinessDates` returns exactly
      // today, and this is the same single call it always was.
      const timezone = facility?.timezone ?? 'UTC'
      const previous = await lastSuccessfulRun(job.name, facility?.id ?? null)
      const dates = missedBusinessDates(previous?.businessDate ?? null, now, timezone)

      for (const date of dates) {
        const result = await runJob(
          { jobName: job.name, facilityId: facility?.id ?? null, businessDate: date },
          async ({ facilityId, recordItem }) =>
            job.handler({ facilityId, businessDate: date, recordItem }),
        )
        jobResults.push({
          job: job.name,
          facilityId: facility?.id ?? null,
          // Distinguishes a catch-up run from today's in the response, so an
          // operator reading the log can see the backlog draining.
          ...(date.getTime() === businessDate.getTime() ? {} : { caughtUp: date.toISOString().slice(0, 10) }),
          status: result.status === 'skipped' ? `skipped:${result.reason}` : result.run.status,
        })
      }
    }
  }

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
  })
}
