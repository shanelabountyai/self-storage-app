import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@storage/db'
import { dispatchEvents } from '@storage/core/events'
import { facilitiesDueAt, runJob } from '@storage/core/jobs'
import { sendExpiringSoonReminders } from '@/lib/reservations/reserve'
import { CONSUMERS, SCHEDULED_JOBS } from '@/lib/jobs/registry'

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

  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { id: true, timezone: true },
  })

  const jobResults: { job: string; facilityId: string | null; status: string }[] = []

  for (const job of SCHEDULED_JOBS) {
    const due =
      job.scope === 'global'
        ? now.getUTCHours() === job.localHour
          ? [{ facility: null, businessDate: new Date(Date.UTC(
              now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) }]
          : []
        : facilitiesDueAt(facilities, job.localHour, now)

    for (const { facility, businessDate } of due) {
      const result = await runJob(
        { jobName: job.name, facilityId: facility?.id ?? null, businessDate },
        async ({ facilityId, recordItem }) =>
          job.handler({ facilityId, businessDate, recordItem }),
      )
      jobResults.push({
        job: job.name,
        facilityId: facility?.id ?? null,
        status: result.status === 'skipped' ? `skipped:${result.reason}` : result.run.status,
      })
    }
  }

  return Response.json({
    ranAt: now.toISOString(),
    durationMs: Date.now() - started,
    dispatch,
    reminders,
    jobs: jobResults,
  })
}
