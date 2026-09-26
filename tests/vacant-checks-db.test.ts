import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { raiseVacantChecks, recordVacantCheck } from '../apps/web/lib/field-ops/vacant-checks'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-406 / PRD 02 §4.9 US-35: the daily sample of `available` units.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const DAY = new Date('2026-07-01T18:00:00Z')

let facilityId = ''
let staffId = ''
let unitIds: string[] = []

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['units:edit', 'tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const checkTasks = () => prisma.task.findMany({ where: { facilityId, type: 'vacant_unit_check' } })

describeDb('vacant unit checks', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Vacant ${suffix}`,
        slug: `vc-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `vc-${suffix}@example.com`, firstName: 'Vic', lastName: 'Manager' },
    })
    staffId = staff.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    for (let i = 1; i <= 8; i++) {
      const unit = await prisma.unit.create({
        data: {
          facilityId,
          unitTypeId: unitType.id,
          number: `V${i}`,
          // V1 and V2 were checked most recently, so they sort last.
          lastVacantCheckAt: i <= 2 ? new Date(`2026-06-2${i}T12:00:00Z`) : null,
        },
      })
      unitIds.push(unit.id)
    }
  })

  beforeEach(async () => {
    await prisma.maintenanceTicket.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.unit.updateMany({ where: { facilityId }, data: { operationalStatus: 'available', status: 'available' } })
    await prisma.facility.update({ where: { id: facilityId }, data: { vacantCheckSample: 5 } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.$disconnect()
  })

  it('samples 5 of 8 available units, never-checked first', async () => {
    expect(await raiseVacantChecks(facilityId, DAY)).toBe(5)
    const numbers = (await checkTasks()).map((t) => t.detail!.match(/^Unit (\w+):/)![1]).sort()
    // V3..V8 have never been checked; the 5 taken are from those, not V1/V2.
    expect(numbers).toHaveLength(5)
    expect(numbers).not.toContain('V1')
    expect(numbers).not.toContain('V2')
  })

  it('a re-run after some are recorded does not top the day back up', async () => {
    await raiseVacantChecks(facilityId, DAY)
    const [first] = await checkTasks()
    await recordVacantCheck(actor(), first!.id, 'ok')
    expect(await raiseVacantChecks(facilityId, DAY)).toBe(0)
    expect(await checkTasks()).toHaveLength(5)
  })

  it('sample 0 generates none', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { vacantCheckSample: 0 } })
    expect(await raiseVacantChecks(facilityId, DAY)).toBe(0)
    expect(await checkTasks()).toHaveLength(0)
  })

  it('an ok result stamps the unit and changes nothing else', async () => {
    await raiseVacantChecks(facilityId, DAY)
    const task = (await checkTasks())[0]!
    await recordVacantCheck(actor(), task.id, 'ok')

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: task.entityId } })
    expect(unit.lastVacantCheckAt).not.toBeNull()
    expect(unit.status).toBe('available')
    expect(await prisma.task.count({ where: { facilityId, type: 'vacant_unit_mismatch' } })).toBe(0)
  })

  it.each(['locked', 'not_empty'] as const)('%s opens a high task and takes the unit out of availability', async (result) => {
    await raiseVacantChecks(facilityId, DAY)
    const task = (await checkTasks())[0]!
    await recordVacantCheck(actor(), task.id, result)

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: task.entityId } })
    expect(unit.status).toBe('maintenance')
    const mismatch = await prisma.task.findFirstOrThrow({ where: { facilityId, type: 'vacant_unit_mismatch' } })
    expect(mismatch.priority).toBe('high')
    expect(mismatch.entityId).toBe(unit.id)
    expect(await prisma.maintenanceTicket.count({ where: { unitId: unit.id, blocksAvailability: true } })).toBe(1)
  })

  it('recording twice is a no-op', async () => {
    await raiseVacantChecks(facilityId, DAY)
    const task = (await checkTasks())[0]!
    await recordVacantCheck(actor(), task.id, 'locked')
    await recordVacantCheck(actor(), task.id, 'locked')
    expect(await prisma.maintenanceTicket.count({ where: { facilityId } })).toBe(1)
  })
})
