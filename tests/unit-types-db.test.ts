import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  DuplicateUnitTypeNameError,
  cloneUnitType,
  createUnitType,
  listUnitTypes,
  updateUnitType,
} from '../apps/web/lib/admin/unit-types'
import { ROLES } from '../packages/db/rbac-catalog'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
let facilityAId = ''
let facilityBId = ''
let staffId = ''
let counterStaffId = ''

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
}

const ownerAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [assignmentFor('owner', facilityId)],
})

const counterAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: counterStaffId,
  assignments: [assignmentFor('counter', facilityId)],
})

const BASE_INPUT = {
  name: 'Test 10x10',
  widthFt: 10,
  lengthFt: 10,
  heightFt: null,
  climateControlled: false,
  driveUp: false,
  floor: 1,
  powerAvailable: false,
  description: null,
  streetRateCents: 12_000,
  webRateCents: 10_900,
}

beforeAll(async () => {
  if (!hasDatabase) return
  const [a, b] = await Promise.all([
    prisma.facility.create({
      data: {
        name: 'Unit Types A',
        slug: `unit-types-a-${suffix}`,
        addressLine1: '1 Test St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
      },
    }),
    prisma.facility.create({
      data: {
        name: 'Unit Types B',
        slug: `unit-types-b-${suffix}`,
        addressLine1: '2 Test St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
      },
    }),
  ])
  facilityAId = a.id
  facilityBId = b.id

  const [owner, counter] = await Promise.all([
    prisma.staffUser.create({
      data: { email: `unit-types-owner-${suffix}@example.com`, firstName: 'Owner', lastName: 'Test' },
    }),
    prisma.staffUser.create({
      data: { email: `unit-types-counter-${suffix}@example.com`, firstName: 'Counter', lastName: 'Test' },
    }),
  ])
  staffId = owner.id
  counterStaffId = counter.id
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.unitType.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('createUnitType', () => {
  it('creates a unit type and writes an audit entry', async () => {
    const actor = ownerAt(facilityAId)
    const created = await createUnitType(actor, facilityAId, BASE_INPUT)

    expect(created.name).toBe('Test 10x10')
    const entries = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'unit_type.created' },
    })
    expect(entries).toHaveLength(1)
  })

  it('refuses a role with no units:edit permission', async () => {
    const actor = counterAt(facilityAId)
    await expect(
      createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("refuses creating in a facility the actor isn't assigned to", async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      createUnitType(actor, facilityBId, { ...BASE_INPUT, name: 'Cross-facility' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects zero or negative dimensions at the database level', async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Bad dims', widthFt: 0 }),
    ).rejects.toThrow()
  })

  it('rejects a negative rate at the database level', async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Bad rate', streetRateCents: -100 }),
    ).rejects.toThrow()
  })

  it('enforces one name per facility', async () => {
    const actor = ownerAt(facilityAId)
    await createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Duplicate Name' })
    await expect(
      createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Duplicate Name' }),
    ).rejects.toThrow()
  })
})

describe.skipIf(!hasDatabase)('updateUnitType', () => {
  it('updates fields and writes a before/after audit entry', async () => {
    const actor = ownerAt(facilityAId)
    const created = await createUnitType(actor, facilityAId, { ...BASE_INPUT, name: 'Update Me' })

    const updated = await updateUnitType(actor, facilityAId, created.id, {
      ...BASE_INPUT,
      name: 'Update Me',
      streetRateCents: 15_000,
      climateControlled: true,
    })

    expect(updated.streetRateCents).toBe(15_000)
    expect(updated.climateControlled).toBe(true)

    const entries = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'unit_type.updated' },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].before).toMatchObject({ streetRateCents: 12_000, climateControlled: false })
    expect(entries[0].after).toMatchObject({ streetRateCents: 15_000, climateControlled: true })
  })

  it("refuses to update a unit type that doesn't belong to the claimed facility", async () => {
    const actor = ownerAt(facilityAId)
    const inFacilityB = await createUnitType(ownerAt(facilityBId), facilityBId, {
      ...BASE_INPUT,
      name: 'Belongs To B',
    })

    await expect(
      updateUnitType(actor, facilityAId, inFacilityB.id, { ...BASE_INPUT, name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe.skipIf(!hasDatabase)('cloneUnitType', () => {
  it('copies every attribute except facilityId', async () => {
    const source = await createUnitType(ownerAt(facilityAId), facilityAId, {
      ...BASE_INPUT,
      name: 'Clone Source',
      climateControlled: true,
      driveUp: true,
      description: 'A cloneable type',
    })

    const cloned = await cloneUnitType(ownerAt(facilityBId), source.id, facilityBId)

    expect(cloned.facilityId).toBe(facilityBId)
    expect(cloned.name).toBe('Clone Source')
    expect(cloned.climateControlled).toBe(true)
    expect(cloned.driveUp).toBe(true)
    expect(cloned.description).toBe('A cloneable type')
    expect(cloned.streetRateCents).toBe(BASE_INPUT.streetRateCents)

    const entries = await prisma.auditLog.findMany({
      where: { entityId: cloned.id, action: 'unit_type.cloned' },
    })
    expect(entries).toHaveLength(1)
    // recordAudit() merges `context` into `after` — there is no separate
    // context column.
    expect(entries[0].after).toMatchObject({
      sourceUnitTypeId: source.id,
      sourceFacilityId: facilityAId,
    })
  })

  it('refuses cloning into a facility the actor cannot edit', async () => {
    const source = await createUnitType(ownerAt(facilityAId), facilityAId, {
      ...BASE_INPUT,
      name: 'No Permission Clone Source',
    })
    const actor = counterAt(facilityBId)

    await expect(cloneUnitType(actor, source.id, facilityBId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a clone that would duplicate a name already used at the target', async () => {
    const source = await createUnitType(ownerAt(facilityAId), facilityAId, {
      ...BASE_INPUT,
      name: 'Name Collision',
    })
    await createUnitType(ownerAt(facilityBId), facilityBId, {
      ...BASE_INPUT,
      name: 'Name Collision',
    })

    await expect(
      cloneUnitType(ownerAt(facilityBId), source.id, facilityBId),
    ).rejects.toBeInstanceOf(DuplicateUnitTypeNameError)
  })
})

describe.skipIf(!hasDatabase)('listUnitTypes', () => {
  it('is scoped to one facility and ordered by name', async () => {
    await createUnitType(ownerAt(facilityAId), facilityAId, { ...BASE_INPUT, name: 'Zzz Last' })
    await createUnitType(ownerAt(facilityAId), facilityAId, { ...BASE_INPUT, name: 'Aaa First' })

    const list = await listUnitTypes(facilityAId)
    const names = list.map((t) => t.name)
    expect(names).toContain('Zzz Last')
    expect(names).toContain('Aaa First')
    expect(names.indexOf('Aaa First')).toBeLessThan(names.indexOf('Zzz Last'))
    expect(list.every((t) => t.facilityId === facilityAId)).toBe(true)
  })
})
