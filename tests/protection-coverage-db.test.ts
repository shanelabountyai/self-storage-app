import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { coverageGaps } from '../apps/web/lib/protection/coverage'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-163 / PRD 02 §4.3 US-44. Occupied units carrying neither a plan nor an
// unexpired certificate — the number US-44's policy is actually about, and the
// one B-155's attach rate cannot show: attach rate is a period metric about
// how move-ins were SOLD, and a tenant who waived two years ago and lapsed
// last month has never appeared in it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let staffId = ''

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ASOF = d('2026-08-24')

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['reports:operational'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

let counter = 0
/// One occupied lease, with whatever cover the case is about.
async function occupiedLease(options: {
  planName?: string | null
  proofExpiresAt?: Date | null
  /// A waiver row with no expiry — US-44's manager override.
  overrideWaiver?: boolean
  startDate?: Date
}): Promise<{ leaseId: string; unitNumber: string }> {
  counter += 1
  const tenant = await prisma.tenant.create({
    data: { email: `cov-${suffix}-${counter}@example.com`, firstName: 'Ada', lastName: 'Renter' },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `C-${suffix.slice(0, 4)}-${counter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate: options.startDate ?? d('2026-01-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      protectionPlanName: options.planName ?? null,
      protectionCents: options.planName ? 1_400 : 0,
    },
  })
  if (options.proofExpiresAt !== undefined || options.overrideWaiver) {
    await prisma.protectionWaiver.create({
      data: {
        facilityId,
        leaseId: lease.id,
        tenantId: tenant.id,
        expiresAt: options.overrideWaiver ? null : (options.proofExpiresAt ?? null),
        overrideReason: options.overrideWaiver ? 'Tenant would not produce one' : null,
      },
    })
  }
  return { leaseId: lease.id, unitNumber: unit.number }
}

describeDb('uncovered units (US-44, B-163)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Coverage ${suffix}`,
        slug: `coverage-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        protectionRequired: true,
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `cov-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterEach(async () => {
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: `cov-${suffix}-` } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('lists a lease whose certificate has expired, with how long it has been uncovered', async () => {
    const { unitNumber } = await occupiedLease({ proofExpiresAt: d('2026-08-04') })

    const gap = await coverageGaps(manager(), facilityId, ASOF)

    expect(gap.rows).toHaveLength(1)
    expect(gap.rows[0].unitNumber).toBe(unitNumber)
    expect(gap.rows[0].reason).toBe('lapsed')
    expect(gap.rows[0].daysUncovered).toBe(20)
  })

  it('lists a lease that never produced a certificate at all', async () => {
    await occupiedLease({})

    const gap = await coverageGaps(manager(), facilityId, ASOF)

    expect(gap.rows).toHaveLength(1)
    expect(gap.rows[0].reason).toBe('never_recorded')
    // No lapse date to count from — the screen shows the lease start instead.
    expect(gap.rows[0].daysUncovered).toBeNull()
    expect(gap.rows[0].proofExpiredOn).toBeNull()
  })

  it('leaves out a lease on one of our plans, and one with a current certificate', async () => {
    await occupiedLease({ planName: 'Standard cover' })
    await occupiedLease({ proofExpiresAt: d('2027-01-01') })

    const gap = await coverageGaps(manager(), facilityId, ASOF)

    expect(gap.rows).toEqual([])
    expect(gap.occupiedLeases).toBe(2)
  })

  it('treats a manager override with no expiry as cover', async () => {
    // US-44's counter case: the tenant will not produce a declaration page and
    // somebody senior accepted it with a reason code. That is a decision on the
    // record, not an absence, and it has no date to lapse.
    await occupiedLease({ overrideWaiver: true })

    expect((await coverageGaps(manager(), facilityId, ASOF)).rows).toEqual([])
  })

  it('leaves out an ended lease — the policy is about units somebody is in', async () => {
    const { leaseId } = await occupiedLease({ proofExpiresAt: d('2026-01-01') })
    await prisma.lease.update({
      where: { id: leaseId },
      data: { status: 'ended', endDate: d('2026-02-01'), moveOutReason: 'tenant_request' },
    })

    const gap = await coverageGaps(manager(), facilityId, ASOF)
    expect(gap.rows).toEqual([])
    expect(gap.occupiedLeases).toBe(0)
  })

  it('puts the longest-uncovered first, mixing both reasons', async () => {
    await occupiedLease({ proofExpiresAt: d('2026-08-01') })
    const oldest = await occupiedLease({ startDate: d('2024-05-01') })
    await occupiedLease({ proofExpiresAt: d('2026-06-01') })

    const gap = await coverageGaps(manager(), facilityId, ASOF)

    // A `never_recorded` row has no lapse date, so it sorts on the only date
    // it has — the lease start, which is the same question asked of it.
    expect(gap.rows[0].leaseId).toBe(oldest.leaseId)
    expect(gap.rows.map((row) => row.reason)).toEqual(['never_recorded', 'lapsed', 'lapsed'])
  })

  it('refuses a staffer without reports access', async () => {
    await occupiedLease({})
    const nobody: Actor = {
      kind: 'staff',
      staffUserId: staffId,
      assignments: [
        {
          facilityId,
          roleKey: 'counter',
          rank: 10,
          permissions: new Set<PermissionKey>(['tenants:view'] as never),
          limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
        },
      ],
    }
    await expect(coverageGaps(nobody, facilityId, ASOF)).rejects.toThrow()
  })
})
