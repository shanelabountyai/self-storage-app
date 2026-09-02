import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { counterPayableLeases } from '../apps/web/lib/admin/pos'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-231 / D-110(A). What the counter may be shown when someone walks up.
//
// The bug this exists against: the picker scoped itself to
// `OCCUPYING_LEASE_STATUSES`, so a former tenant holding $400 in cash could not
// be given a receipt anywhere in the product — while `/admin/tenants/former`
// listed the debt and `recordCounterPayment` would have taken the money.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let activeLeaseId = ''
let endedOwingLeaseId = ''
let endedSettledLeaseId = ''

function actor(permissions: PermissionKey[]): Actor {
  return {
    kind: 'staff',
    staffUserId: 'staff-fixture',
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('what the counter can take a payment for', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Counter Payable ${suffix}`,
        slug: `counter-payable-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const tenant = await prisma.tenant.create({
      data: { email: `cp-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    async function makeLease(number: string, status: 'active' | 'ended', chargeCents: number) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status,
          startDate: new Date('2026-06-01T00:00:00Z'),
          moveOutDate: status === 'ended' ? new Date('2026-08-01T00:00:00Z') : null,
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      if (chargeCents > 0) {
        await prisma.ledgerEntry.create({
          data: { facilityId, leaseId: lease.id, type: 'charge', amountCents: chargeCents, description: 'Rent' },
        })
      }
      return lease.id
    }

    activeLeaseId = await makeLease(`CP-A-${suffix}`, 'active', 12_900)
    endedOwingLeaseId = await makeLease(`CP-B-${suffix}`, 'ended', 40_000)
    endedSettledLeaseId = await makeLease(`CP-C-${suffix}`, 'ended', 0)

    // The aging the screen prints beside the money: an unpaid RENT invoice,
    // dated so `daysPastDue` is a fixed, known number of days.
    await prisma.invoice.create({
      data: {
        facilityId,
        leaseId: activeLeaseId,
        number: `INV-CP-${suffix}`,
        kind: 'rent',
        status: 'open',
        issueDate: new Date('2026-08-01T00:00:00Z'),
        dueDate: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000),
        periodStart: new Date('2026-08-01T00:00:00Z'),
        periodEnd: new Date('2026-09-01T00:00:00Z'),
        subtotalCents: 12_900,
        taxCents: 0,
        totalCents: 12_900,
        amountPaidCents: 0,
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('includes an ENDED lease that still owes money, and drops one that does not', async () => {
    const leases = await counterPayableLeases(actor(['tenants:view']), tenantId, facilityId)
    const ids = leases.map((lease) => lease.leaseId)

    expect(ids).toContain(activeLeaseId)
    // The whole point of the row: former-tenant AR is collectable at the desk.
    expect(ids).toContain(endedOwingLeaseId)
    // Nothing to pay, so nothing to pick — a closed lease at $0.00 in the unit
    // list is a way to misapply a payment, not a feature.
    expect(ids).not.toContain(endedSettledLeaseId)

    expect(leases.find((lease) => lease.leaseId === endedOwingLeaseId)).toMatchObject({
      isFormer: true,
      balanceCents: 40_000,
    })
  })

  it('carries the balance and the aging the screen prints, oldest debt first', async () => {
    const leases = await counterPayableLeases(actor(['tenants:view']), tenantId, facilityId)

    const active = leases.find((lease) => lease.leaseId === activeLeaseId)
    expect(active).toMatchObject({ balanceCents: 12_900, daysPastDue: 41, isFormer: false })

    // Sorted by how far past due, so the unit about to be overlocked is the one
    // already selected when the staffer looks up. The ended lease has no unpaid
    // rent invoice, so it ages at 0 and sorts below.
    expect(leases[0].leaseId).toBe(activeLeaseId)
  })

  it('reads under tenants:view, and refuses a staffer without it (D-110(A))', async () => {
    // The same permission that already shows this person `lease.balanceCents`
    // on the tenant profile. `reports:financial` gates portfolio figures, not
    // the balance on the account in front of them.
    await expect(
      counterPayableLeases(actor(['payments:take']), tenantId, facilityId),
    ).rejects.toThrow(ForbiddenError)
  })
})
