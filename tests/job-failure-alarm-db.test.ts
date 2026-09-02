import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { raiseStaleMoneyJobTasks, runScheduledJob } from '../apps/web/lib/jobs/run'
import { MONEY_JOBS, scheduledJobLabel } from '../apps/web/lib/jobs/registry'
import { recentRuns } from '../apps/web/lib/admin/billing-runs'
import { resolveTaskSubjects } from '../apps/web/lib/admin/task-subjects'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-229 / PRD 02 FR-1, FR-4. Until this item a nightly job that threw wrote
// `status: 'failed'` and returned — no task, no event, no message — and the one
// screen that showed it rendered `billing.assess-late-fees` and a raw cuid.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const BUSINESS_DATE = new Date('2026-09-02T00:00:00.000Z')

let facilityId = ''
let tenantId = ''
let unitNumber = ''
let leaseId = ''

const boom = {
  name: `test.explodes-${suffix}`,
  label: 'A job that explodes',
  handler: async () => {
    throw new Error('the biller fell over')
  },
}

const partly = {
  name: `test.partly-${suffix}`,
  label: 'A job that half works',
  handler: async ({
    recordItem,
  }: {
    recordItem: (o: { itemId: string; ok: boolean; message?: string }) => void
  }) => {
    recordItem({ itemId: leaseId, ok: false, message: 'card declined' })
    recordItem({ itemId: `missing-${suffix}`, ok: false, message: 'gone' })
    recordItem({ itemId: 'global', ok: true })
  },
}

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: randomUUID(),
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'reports:financial']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('a failed nightly job raises a task (B-229)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Alarm ${suffix}`,
        slug: `alarm-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `alarm-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitNumber = `A-${suffix.slice(0, 4)}`
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: unitNumber } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.jobRun.deleteMany({ where: { jobName: { in: [boom.name, partly.name, ...MONEY_JOBS] }, facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.jobRun.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('raises a high-priority task naming the job and the error', async () => {
    const result = await runScheduledJob(boom, { facilityId, businessDate: BUSINESS_DATE })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.run.status).toBe('failed')

    const task = await prisma.task.findFirstOrThrow({ where: { facilityId, type: 'job_failed' } })
    expect(task.priority).toBe('high')
    expect(task.entityType).toBe('JobRun')
    expect(task.entityId).toBe(result.run.id)
    // The operator's words, not `test.explodes-…`.
    expect(task.detail).toBe('A job that explodes did not finish: the biller fell over')
  })

  it('is one task however many times the same run fails on the same day', async () => {
    await runScheduledJob(boom, { facilityId, businessDate: BUSINESS_DATE })
    await runScheduledJob(boom, { facilityId, businessDate: BUSINESS_DATE, force: true })

    expect(await prisma.task.count({ where: { facilityId, type: 'job_failed' } })).toBe(1)
  })

  it('raises one for a partial run too — 799 leases billed and one not is still unbilled rent', async () => {
    const result = await runScheduledJob(partly, { facilityId, businessDate: BUSINESS_DATE })
    expect(result.status === 'completed' && result.run.status).toBe('partial')

    const task = await prisma.task.findFirstOrThrow({ where: { facilityId, type: 'job_failed' } })
    expect(task.detail).toBe('A job that half works finished, but 2 items did not go through.')
  })

  it('raises nothing for a global run — a portfolio-wide failure is not one site\'s work', async () => {
    const result = await runScheduledJob(boom, { facilityId: null, businessDate: BUSINESS_DATE })
    expect(result.status === 'completed' && result.run.status).toBe('failed')
    expect(await prisma.task.count({ where: { type: 'job_failed', facilityId } })).toBe(0)
    await prisma.jobRun.deleteMany({ where: { jobName: boom.name, facilityId: null } })
  })

  it('raises nothing when the job succeeds', async () => {
    await runScheduledJob(
      { name: `test.fine-${suffix}`, label: 'A job that works', handler: async () => {} },
      { facilityId, businessDate: BUSINESS_DATE },
    )
    expect(await prisma.task.count({ where: { facilityId, type: 'job_failed' } })).toBe(0)
    await prisma.jobRun.deleteMany({ where: { jobName: `test.fine-${suffix}` } })
  })

  it('names the run in plain words on the task card, and links to the runs screen', async () => {
    const result = await runScheduledJob(boom, { facilityId, businessDate: BUSINESS_DATE })
    if (result.status !== 'completed') throw new Error('expected a completed run')

    const subjects = await resolveTaskSubjects([{ entityType: 'JobRun', entityId: result.run.id }])
    expect(subjects.get(`JobRun:${result.run.id}`)).toEqual({
      // This fixture job is not in `SCHEDULED_JOBS`, so the label falls back to
      // the raw name — the same thing a `JobRun` row for a since-removed job
      // gets. The plain-words case is `scheduledJobLabel` below.
      label: `${boom.name} — 2026-09-02`,
      href: '/admin/billing',
    })
  })

  it('gives a failed item a tenant and a unit on the runs screen, and says so honestly when it cannot', async () => {
    await runScheduledJob(partly, { facilityId, businessDate: BUSINESS_DATE })

    const rows = await recentRuns(actor())
    const row = rows.find((candidate) => candidate.jobName === partly.name)
    expect(row).toBeDefined()
    // The label an operator would say, never the registry key.
    expect(row!.jobLabel).toBe(partly.name) // unregistered job falls back to its name
    const byId = new Map(row!.items.map((item) => [item.itemId, item.subject]))
    expect(byId.get(leaseId)).toEqual({
      label: `Unit ${unitNumber} — Ada Renter`,
      href: `/admin/tenants/${tenantId}`,
    })
    expect(byId.get(`missing-${suffix}`)).toEqual({ label: 'Unknown record', href: null })
  })
})

describe('scheduledJobLabel (B-229)', () => {
  it('gives an operator the words for a registered job, never the registry key', () => {
    expect(scheduledJobLabel('billing.assess-late-fees')).toBe('Assess late fees')
    expect(scheduledJobLabel('field-ops.raise-walkthrough')).toBe('Raise the daily walkthrough')
  })

  it('falls back to the raw name for a job that is no longer registered', () => {
    // History worth reading, and there is nothing better left to call it.
    expect(scheduledJobLabel('billing.something-removed')).toBe('billing.something-removed')
  })
})

describeDb('a money job that never runs at all (B-229)', () => {
  const MONEY_JOB = MONEY_JOBS[0]
  let staleFacilityId = ''

  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Stale ${suffix}`,
        slug: `stale-${suffix}`,
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    staleFacilityId = facility.id
  })

  afterEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId: staleFacilityId } })
    await prisma.jobRun.deleteMany({ where: { facilityId: staleFacilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId: staleFacilityId } })
    await prisma.jobRun.deleteMany({ where: { facilityId: staleFacilityId } })
    await prisma.$disconnect()
  })

  function facilities(createdAt: Date) {
    return [{ id: staleFacilityId, createdAt }]
  }

  it('says nothing while the last success is inside 48 hours', async () => {
    const now = new Date('2026-09-02T12:00:00Z')
    for (const jobName of MONEY_JOBS) {
      await prisma.jobRun.create({
        data: {
          jobName,
          facilityId: staleFacilityId,
          businessDate: BUSINESS_DATE,
          status: 'succeeded',
          startedAt: new Date('2026-09-01T11:59:00Z'),
          finishedAt: new Date('2026-09-01T12:00:00Z'),
        },
      })
    }
    expect(await raiseStaleMoneyJobTasks(now, facilities(new Date('2026-01-01T00:00:00Z')))).toBe(0)
  })

  it('raises one per money job once the last success is older than 48 hours', async () => {
    const now = new Date('2026-09-05T12:00:00Z')
    for (const jobName of MONEY_JOBS) {
      await prisma.jobRun.create({
        data: {
          jobName,
          facilityId: staleFacilityId,
          businessDate: BUSINESS_DATE,
          status: 'succeeded',
          startedAt: new Date('2026-09-01T11:59:00Z'),
          finishedAt: new Date('2026-09-01T12:00:00Z'),
        },
      })
    }
    expect(await raiseStaleMoneyJobTasks(now, facilities(new Date('2026-01-01T00:00:00Z')))).toBe(MONEY_JOBS.length)

    const task = await prisma.task.findFirstOrThrow({
      where: { facilityId: staleFacilityId, entityId: `${MONEY_JOB}@${staleFacilityId}` },
    })
    expect(task.priority).toBe('high')
    expect(task.detail).toBe(`${scheduledJobLabel(MONEY_JOB)} has not run successfully here for 96 hours.`)

    // Same day, second tick: the alarm is one task, not one an hour.
    expect(await raiseStaleMoneyJobTasks(now, facilities(new Date('2026-01-01T00:00:00Z')))).toBe(0)
  })

  it('measures a facility that has never run one from when it was created, so a misconfigured new site is not silent', async () => {
    const now = new Date('2026-09-05T12:00:00Z')
    // Created an hour ago: nothing has had a chance to run.
    expect(await raiseStaleMoneyJobTasks(now, facilities(new Date('2026-09-05T11:00:00Z')))).toBe(0)
    // Created a week ago and still nothing: that is the silence worth alarming on.
    expect(await raiseStaleMoneyJobTasks(now, facilities(new Date('2026-08-29T12:00:00Z')))).toBe(MONEY_JOBS.length)
  })
})
