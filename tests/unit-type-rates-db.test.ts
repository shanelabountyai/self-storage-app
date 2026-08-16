import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import { createUnitType } from '../apps/web/lib/admin/unit-types'
import {
  currentRateForUnitType,
  currentRatesForFacility,
  publishUnitTypeRate,
  rateHistoryForUnitType,
} from '../apps/web/lib/pricing/unit-type-rates'
import { ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '@storage/db/rbac-catalog'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
let facilityId = ''
let unitTypeId = ''
let staffId = ''
let managerStaffId = ''
let tenantId = ''

function assignmentFor(roleKey: string, fid: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId: fid,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set<PermissionKey>(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
}
const owner = (): Actor => ({ kind: 'staff', staffUserId: staffId, assignments: [assignmentFor('owner', facilityId)] })
/// Manager holds `rates:street:propose` but NOT `rates:street:change`.
const manager = (): Actor => ({ kind: 'staff', staffUserId: managerStaffId, assignments: [assignmentFor('manager', facilityId)] })

const BASE_TYPE = {
  name: `Rates ${suffix}`,
  widthFt: 10,
  lengthFt: 10,
  heightFt: null,
  climateControlled: false,
  driveUp: false,
  floor: 1,
  powerAvailable: false,
  description: null,
  streetRateCents: 10_000,
  webRateCents: 9_000,
}

const past = new Date('2020-01-01T00:00:00Z')
const future = new Date('2099-01-01T00:00:00Z')

beforeAll(async () => {
  if (!hasDatabase) return
  const facility = await prisma.facility.create({
    data: {
      name: 'Rates Test',
      slug: `rates-${suffix}`,
      addressLine1: '1 St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
        status: 'inactive' as const,
    },
  })
  facilityId = facility.id

  const [o, m, tenant] = await Promise.all([
    prisma.staffUser.create({ data: { email: `rates-o-${suffix}@example.com`, firstName: 'O', lastName: 'T' } }),
    prisma.staffUser.create({ data: { email: `rates-m-${suffix}@example.com`, firstName: 'M', lastName: 'T' } }),
    prisma.tenant.create({ data: { email: `rates-t-${suffix}@example.com`, firstName: 'Pat', lastName: 'R' } }),
  ])
  staffId = o.id
  managerStaffId = m.id
  tenantId = tenant.id

  const type = await createUnitType(owner(), facilityId, BASE_TYPE)
  unitTypeId = type.id
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.lease.deleteMany({ where: { facilityId } })
  await prisma.unit.deleteMany({ where: { facilityId } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
  await prisma.unitType.deleteMany({ where: { facilityId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('creating a unit type', () => {
  it('writes the initial rate as its first effective-dated row', async () => {
    const rate = await currentRateForUnitType(unitTypeId)
    expect(rate?.streetRateCents).toBe(10_000)
    expect(rate?.webRateCents).toBe(9_000)
    expect(await prisma.unitTypeRate.count({ where: { unitTypeId } })).toBe(1)
  })
})

describe.skipIf(!hasDatabase)('publishUnitTypeRate', () => {
  it('requires rates:street:change — propose alone is not enough', async () => {
    // Manager can propose but not publish; the propose→approve workflow has no
    // backlog item yet, so publishing is owner/regional only.
    await expect(
      publishUnitTypeRate(manager(), facilityId, unitTypeId, {
        streetRateCents: 11_000,
        webRateCents: 10_000,
        effectiveFrom: new Date(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('appends rather than editing, so history survives', async () => {
    await publishUnitTypeRate(owner(), facilityId, unitTypeId, {
      streetRateCents: 12_000,
      webRateCents: 11_000,
      effectiveFrom: past,
    })

    const history = await rateHistoryForUnitType(unitTypeId)
    expect(history.length).toBeGreaterThanOrEqual(2)
    // The original row is still there, untouched.
    expect(history.some((r) => r.streetRateCents === 10_000)).toBe(true)
  })

  it('does not let a backdated rate supersede a newer one', async () => {
    // The 12,000 row published above is dated 2020; the type's initial 10,000
    // row is dated at creation (now). "Latest effectiveFrom on or before now"
    // is therefore still the initial rate — backdating inserts history, it
    // does not rewrite the present.
    const current = await currentRateForUnitType(unitTypeId)
    expect(current?.streetRateCents).toBe(10_000)
  })

  it('writes an audit entry carrying the before and after rate', async () => {
    const entries = await prisma.auditLog.findMany({
      where: { entityId: unitTypeId, action: 'rate.street_changed' },
    })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].after).toMatchObject({ streetRateCents: 12_000 })
  })
})

describe.skipIf(!hasDatabase)('effective dating', () => {
  it('ignores a future-dated rate until its date arrives', async () => {
    await publishUnitTypeRate(owner(), facilityId, unitTypeId, {
      streetRateCents: 99_000,
      webRateCents: 98_000,
      effectiveFrom: future,
    })

    const now = await currentRateForUnitType(unitTypeId)
    expect(now?.streetRateCents).not.toBe(99_000)

    // ...but asking about that future date returns it. This is what makes a
    // scheduled rate change verifiable before it lands.
    const later = await currentRateForUnitType(unitTypeId, new Date('2099-06-01T00:00:00Z'))
    expect(later?.streetRateCents).toBe(99_000)
  })

  it('labels every history row against one clock reading', async () => {
    const history = await rateHistoryForUnitType(unitTypeId)
    // Exactly one row is current; the rest are scheduled or superseded.
    expect(history.filter((r) => r.state === 'current')).toHaveLength(1)
    expect(history.some((r) => r.state === 'scheduled')).toBe(true)
  })

  it('resolves rates for a whole facility consistently with the per-type read', async () => {
    // Asserted against the single-type resolver rather than a literal, so the
    // test does not depend on which rate other cases have published.
    const [facilityRates, single] = await Promise.all([
      currentRatesForFacility(facilityId),
      currentRateForUnitType(unitTypeId),
    ])
    expect(facilityRates.get(unitTypeId)?.streetRateCents).toBe(single?.streetRateCents)
  })

  it('omits a unit type whose only rate is in the future rather than pricing it at zero', async () => {
    const futureOnly = await prisma.unitType.create({
      data: { facilityId, name: `Future Only ${suffix}`, widthFt: 5, lengthFt: 5 },
    })
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId: futureOnly.id,
        streetRateCents: 5_000,
        webRateCents: 4_500,
        effectiveFrom: future,
      },
    })

    const rates = await currentRatesForFacility(facilityId)
    // Absent, not zero — a caller must not mistake "unpriced" for "free".
    expect(rates.has(futureOnly.id)).toBe(false)
    expect(await currentRateForUnitType(futureOnly.id)).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('US-9: rate changes never alter existing leases', () => {
  it('leaves a signed lease at its own rate after the street rate moves', async () => {
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `RATE-1-${suffix}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_000,
        billingDay: 1,
      },
    })

    await publishUnitTypeRate(owner(), facilityId, unitTypeId, {
      streetRateCents: 25_000,
      webRateCents: 24_000,
      effectiveFrom: new Date(Date.now() - 1000),
    })

    const after = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
    expect(after.monthlyRateCents).toBe(12_000)
  })
})

describe.skipIf(!hasDatabase)('constraints', () => {
  it('rejects a negative rate', async () => {
    await expect(
      publishUnitTypeRate(owner(), facilityId, unitTypeId, {
        streetRateCents: -1,
        webRateCents: 0,
        effectiveFrom: new Date('2050-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow()
  })

  it('rejects two rates with the same effective date for one type', async () => {
    const when = new Date('2051-01-01T00:00:00Z')
    await publishUnitTypeRate(owner(), facilityId, unitTypeId, {
      streetRateCents: 13_000,
      webRateCents: 12_000,
      effectiveFrom: when,
    })
    await expect(
      publishUnitTypeRate(owner(), facilityId, unitTypeId, {
        streetRateCents: 14_000,
        webRateCents: 13_000,
        effectiveFrom: when,
      }),
    ).rejects.toThrow()
  })
})
