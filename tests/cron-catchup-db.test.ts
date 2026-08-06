import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { lastSuccessfulRun, missedBusinessDates, runJob } from '../packages/core/jobs'

// B-043 / PRD 02 FR-4's catch-up after downtime.
//
// `missedBusinessDates` shipped with B-006 and had NO caller until this item:
// the cron route only ran facilities whose local clock was at the target hour
// right now, so an outage spanning that hour meant the run was skipped and
// never revisited — silently and permanently. These tests exercise the shape
// the route now uses (lastSuccessfulRun → missedBusinessDates → runJob per
// date) against real JobRun rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const JOB = `catchup-test-${suffix}`
const CHICAGO = 'America/Chicago'
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/// The route's own loop, minus the HTTP and the facility lookup.
async function tick(now: Date, ran: string[]): Promise<void> {
  const previous = await lastSuccessfulRun(JOB, null)
  const dates = missedBusinessDates(previous?.businessDate ?? null, now, CHICAGO)
  for (const date of dates) {
    await runJob({ jobName: JOB, facilityId: null, businessDate: date }, async () => {
      ran.push(date.toISOString().slice(0, 10))
    })
  }
}

describeDb('cron catch-up', () => {
  beforeEach(async () => {
    await prisma.jobRun.deleteMany({ where: { jobName: JOB } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.jobRun.deleteMany({ where: { jobName: JOB } })
    await prisma.$disconnect()
  })

  it('runs only today when there is no history', async () => {
    const ran: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), ran)
    expect(ran).toEqual(['2026-08-05'])
  })

  it('runs every business date missed during an outage, oldest first', async () => {
    // Last success was the 1st; the process was down for the 2nd–4th.
    await runJob({ jobName: JOB, facilityId: null, businessDate: d('2026-08-01') }, async () => {})

    const ran: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), ran)

    expect(ran).toEqual(['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'])
  })

  it('does not re-run a date that already succeeded', async () => {
    await runJob({ jobName: JOB, facilityId: null, businessDate: d('2026-08-04') }, async () => {})

    const ran: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), ran)

    // Only the 5th is outstanding — the 4th is skipped by runJob's own
    // idempotency, which is what makes calling this every tick safe.
    expect(ran).toEqual(['2026-08-05'])
    expect(await prisma.jobRun.count({ where: { jobName: JOB } })).toBe(2)
  })

  it('is safe to run twice in the same hour', async () => {
    const first: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), first)
    const second: string[] = []
    await tick(new Date('2026-08-05T07:30:00Z'), second)

    expect(first).toEqual(['2026-08-05'])
    expect(second, 'a second tick re-ran the day').toEqual([])
  })

  it('caps a very long outage rather than running unbounded history', async () => {
    // `missedBusinessDates` stops at 30 days. A year-long gap must not try to
    // run 365 nightly jobs inside one HTTP request.
    await runJob({ jobName: JOB, facilityId: null, businessDate: d('2025-08-05') }, async () => {})

    const ran: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), ran)

    // Bounded is the property that matters, not the exact count: the first
    // date depends on how the stored DATE lands once shifted into the
    // facility's timezone, so pinning it would assert an implementation
    // detail. What must hold is that a year's gap does not attempt a year of
    // nightly jobs inside one HTTP request.
    expect(ran.length).toBeGreaterThan(0)
    expect(ran.length).toBeLessThanOrEqual(30)
    expect(ran.length, 'a year-long gap was not capped').toBeLessThan(40)
  })

  it('resumes from a partial run, which counts as history', async () => {
    // A run with a failed item finishes `partial`, not `succeeded`.
    // `lastSuccessfulRun` counts it — the date was attempted and its items
    // recorded, so re-running it would duplicate the ones that worked.
    await runJob({ jobName: JOB, facilityId: null, businessDate: d('2026-08-03') }, async ({ recordItem }) => {
      recordItem({ itemId: 'x', ok: false, message: 'boom' })
    })
    const previous = await lastSuccessfulRun(JOB, null)
    expect(previous?.status).toBe('partial')

    const ran: string[] = []
    await tick(new Date('2026-08-05T07:00:00Z'), ran)
    expect(ran).toEqual(['2026-08-04', '2026-08-05'])
  })
})
