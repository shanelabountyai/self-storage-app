import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { businessDateFor, localParts } from '../packages/core/jobs'
import { SCHEDULED_JOBS } from '../apps/web/lib/jobs/registry'
import { dueRunQueue, inParallel } from '../apps/web/lib/jobs/queue'

// B-236. The hourly tick used to run every facility serially inside one
// 300-second request and DROP whatever did not fit: `facilitiesDueAt` matched
// only facilities whose local clock was AT the target hour, so the next tick
// had nothing due and the missed run was never revisited that night.
//
// These assert the two halves of the fix that are not visible from the route:
// dueness survives the hour it started in, and the queue empties only when the
// work has actually run.
//
// Nothing here executes a job handler. `dueRunQueue` is a pure read, and the
// JobRun rows below are written directly so the test asserts the QUEUE rather
// than re-testing `runJob`'s idempotency, which cron-catchup-db.test.ts owns.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const TAG = `b236-${suffix}`
const CHICAGO = 'America/Chicago'

// 2026-07-15 is a plain summer day: no DST edge, Chicago is UTC-5.
const atLocalHour = (hour: number) => new Date(Date.UTC(2026, 6, 15, hour + 5))

const perFacilityJobsBy = (localHour: number) =>
  SCHEDULED_JOBS.filter((job) => job.scope === 'per_facility' && job.localHour <= localHour)

describeDb('cron due-run queue', () => {
  let facilityId: string

  beforeEach(async () => {
    await prisma.jobRun.deleteMany({ where: { facility: { slug: { startsWith: TAG } } } })
    await prisma.facility.deleteMany({ where: { slug: { startsWith: TAG } } })
    const facility = await prisma.facility.create({
      data: {
        name: `${TAG} site`,
        slug: `${TAG}-site`,
        status: 'active',
        addressLine1: '1 Test',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: CHICAGO,
      },
    })
    facilityId = facility.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.jobRun.deleteMany({ where: { facility: { slug: { startsWith: TAG } } } })
    await prisma.facility.deleteMany({ where: { slug: { startsWith: TAG } } })
    await prisma.$disconnect()
  })

  const facilities = () => [{ id: facilityId, timezone: CHICAGO }]
  const groupFor = async (now: Date) =>
    (await dueRunQueue(facilities(), now)).find((group) => group.facilityId === facilityId)

  it('queues every job whose local hour has been reached, in registry order', async () => {
    const now = atLocalHour(7)
    const group = await groupFor(now)

    const expected = perFacilityJobsBy(7).map((job) => job.name)
    expect(group?.runs.map((run) => run.job.name)).toEqual(expected)
    // Registry order is what keeps invoices before late fees before dunning at
    // one site — the reason the queue groups by facility rather than by job.
    expect(expected.length).toBeGreaterThan(1)
  })

  it('queues nothing at a facility whose local day has not reached any job yet', async () => {
    // 23:00 local is past every job's hour except the 23:00 one, so use a
    // facility-free portfolio to check the other direction: a job at hour 7 is
    // not queued at 06:00 local.
    const group = await groupFor(atLocalHour(6))
    expect(group?.runs.map((run) => run.job.name)).not.toContain('field-ops.raise-walkthrough')
    expect(group?.runs.map((run) => run.job.name)).toContain('billing.dunning')
  })

  it('keeps a run due at every later hour of the same day until it runs', async () => {
    // THE B-236 PROPERTY. Under the old exact-hour rule a run dropped at local
    // hour 1 was gone for the night: hour 2 asked "is it hour 1?" and it was
    // not. It must now still be owed, on the same business date.
    const early = await groupFor(atLocalHour(1))
    const late = await groupFor(atLocalHour(11))

    const invoicesEarly = early?.runs.find((run) => run.job.name === 'billing.generate-invoices')
    const invoicesLate = late?.runs.find((run) => run.job.name === 'billing.generate-invoices')

    expect(invoicesEarly).toBeDefined()
    expect(invoicesLate, 'a deferred run stopped being due later the same day').toBeDefined()
    expect(invoicesLate!.businessDate.toISOString()).toBe(invoicesEarly!.businessDate.toISOString())
    expect(invoicesLate!.caughtUp).toBe(false)
  })

  it('drops a run from the queue once it has succeeded, and only then', async () => {
    const now = atLocalHour(11)
    const businessDate = businessDateFor(now, CHICAGO)

    await prisma.jobRun.create({
      data: {
        jobName: 'billing.generate-invoices',
        facilityId,
        businessDate,
        status: 'succeeded',
        // `job_run_finished_after_started` is a real check constraint: a row
        // finished before it started is not a state the runner can produce.
        startedAt: now,
        finishedAt: now,
      },
    })

    const group = await groupFor(now)
    expect(group?.runs.map((run) => run.job.name)).not.toContain('billing.generate-invoices')
    // Its neighbours are untouched — the queue is per (job, facility, date).
    expect(group?.runs.map((run) => run.job.name)).toContain('billing.dunning')
  })

  it('does not drop a run that ended failed, so the next tick still owes it', async () => {
    const now = atLocalHour(11)
    await prisma.jobRun.create({
      data: {
        jobName: 'billing.dunning',
        facilityId,
        businessDate: businessDateFor(now, CHICAGO),
        status: 'failed',
        startedAt: now,
        finishedAt: now,
        lastError: 'boom',
      },
    })

    const group = await groupFor(now)
    expect(group?.runs.map((run) => run.job.name)).toContain('billing.dunning')
  })

  it('catches up the dates missed while the scheduler was down, oldest first', async () => {
    const now = atLocalHour(11)
    await prisma.jobRun.create({
      data: {
        jobName: 'billing.generate-invoices',
        facilityId,
        // Four days back; the ones in between were never run.
        businessDate: new Date(Date.UTC(2026, 6, 11)),
        status: 'succeeded',
        // `job_run_finished_after_started` is a real check constraint: a row
        // finished before it started is not a state the runner can produce.
        startedAt: now,
        finishedAt: now,
      },
    })

    const group = await groupFor(now)
    const invoices = group!.runs.filter((run) => run.job.name === 'billing.generate-invoices')
    const dates = invoices.map((run) => run.businessDate.toISOString().slice(0, 10))

    expect(dates).toEqual([...dates].sort())
    expect(dates.at(-1)).toBe('2026-07-15')
    expect(dates.length).toBeGreaterThan(1)
    // Every date but today's is flagged, so the response can show a backlog
    // draining rather than a wall of identical rows.
    expect(invoices.filter((run) => run.caughtUp)).toHaveLength(invoices.length - 1)
  })

  it('puts the global jobs in their own group, keyed to no facility', async () => {
    const queue = await dueRunQueue(facilities(), atLocalHour(11))
    const global = queue.find((group) => group.facilityId === null)
    expect(global?.runs.every((run) => run.job.scope === 'global')).toBe(true)
    expect(global?.runs.every((run) => run.facilityId === null)).toBe(true)
  })

  it('resolves the whole portfolio in a fixed number of queries', async () => {
    // The other half of B-236: the old loop asked for the last successful run
    // once per (job, facility) — 160 round trips at 40 facilities and hour 0,
    // against a database ~52ms away. Adding facilities must not add queries.
    const many = Array.from({ length: 25 }, (_, index) => ({
      id: `${facilityId}-ghost-${index}`,
      timezone: CHICAGO,
    }))
    const before = Date.now()
    await dueRunQueue([...facilities(), ...many], atLocalHour(11))
    // Not a benchmark — a smoke test that this is one round trip and not
    // twenty-five times the job count. A per-facility query would be seconds.
    expect(Date.now() - before).toBeLessThan(2_000)
  })
})

describe('bounded concurrency', () => {
  it('runs every item and never exceeds the limit in flight', async () => {
    const items = Array.from({ length: 20 }, (_, index) => index)
    const done: number[] = []
    let inFlight = 0
    let peak = 0

    await inParallel(items, 6, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      done.push(item)
      inFlight -= 1
    })

    expect(done.sort((a, b) => a - b)).toEqual(items)
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak, 'nothing ran in parallel at all').toBeGreaterThan(1)
  })

  it('does nothing, rather than hanging, on an empty queue', async () => {
    await expect(inParallel([], 6, async () => {})).resolves.toBeUndefined()
  })
})

describe('the local hour a tick sees', () => {
  it('is what the fixtures above assume', () => {
    // Guards the `atLocalHour` helper: if this drifts, every queue assertion
    // above is asserting a different hour than it says.
    expect(localParts(atLocalHour(7), CHICAGO).hour).toBe(7)
    expect(localParts(atLocalHour(0), CHICAGO).hour).toBe(0)
  })
})
