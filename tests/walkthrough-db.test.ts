import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { raiseDailyWalkthrough } from '../apps/web/lib/field-ops/walkthrough'

// B-060 / PRD 02 §4.9 US-35, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''

describeDb('raiseDailyWalkthrough', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Walkthrough ${suffix}`,
        slug: `walk-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
  })

  beforeEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  // Chicago is UTC-5 in July, so these times sit safely inside 1 and 2 July
  // local rather than crossing midnight — the point being tested is the
  // (type, entityId, businessDate) key, not the timezone conversion itself.
  const DAY_1 = new Date('2026-07-01T18:00:00Z')
  const DAY_1_LATER = new Date('2026-07-01T20:00:00Z')
  const DAY_2 = new Date('2026-07-02T18:00:00Z')

  it('raises one task for the day, against the facility itself', async () => {
    await raiseDailyWalkthrough(facilityId, DAY_1)

    const task = await prisma.task.findFirstOrThrow({ where: { facilityId, type: 'daily_walkthrough' } })
    expect(task.entityType).toBe('Facility')
    expect(task.entityId).toBe(facilityId)
    expect(task.status).toBe('open')
  })

  it('is idempotent for the same business day — a caught-up run does not pile up', async () => {
    await raiseDailyWalkthrough(facilityId, DAY_1)
    await raiseDailyWalkthrough(facilityId, DAY_1_LATER)

    expect(await prisma.task.count({ where: { facilityId, type: 'daily_walkthrough' } })).toBe(1)
  })

  it('raises a separate task for each missed day on a catch-up run', async () => {
    await raiseDailyWalkthrough(facilityId, DAY_1)
    await raiseDailyWalkthrough(facilityId, DAY_2)

    // Neither day's task is completed, so both stay open — this is US-35's
    // "skipped days are visible (not silently absent)".
    expect(await prisma.task.count({ where: { facilityId, type: 'daily_walkthrough', status: 'open' } })).toBe(2)
  })
})
