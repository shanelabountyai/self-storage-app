import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createAccount } from '../apps/web/lib/billing/accounts'
import { createLeaselessTenant, searchTenants, tenantProfile } from '../apps/web/lib/admin/tenants'
import { occupancyForFacility, movesForFacility } from '../apps/web/lib/admin/reports'
import { delinquencyQueue } from '../apps/web/lib/admin/delinquency-queue'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-312. Nothing in the product could create a `Tenant` with no lease, so the
// only way to make a business account's payer someone who rents nothing was a
// fake move-in. These assert the leaseless path stays invisible everywhere a
// real move-in would show up, while still being reachable by search, the
// profile page, and an account's payer/member fields.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''

function assignment(permissions: PermissionKey[]) {
  return {
    facilityId,
    roleKey: 'manager',
    rank: 20,
    permissions: new Set<PermissionKey>(permissions),
    limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
  }
}

function editor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [assignment(['tenants:edit', 'tenants:view', 'billing_accounts:manage'])],
  }
}

function viewerOnly(): Actor {
  return { kind: 'staff', staffUserId: staffId, assignments: [assignment(['tenants:view'])] }
}

describeDb('leaseless tenant (B-312)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Leaseless Test ${suffix}`,
        slug: `lt-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `lt-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('creates a Tenant with no lease, audited, invisible to occupancy/moves/delinquency, and reachable by search, the profile page, and an account payer field', async () => {
    const lastName = `Contact${suffix}`
    const email = `leaseless-${suffix}@example.com`

    const result = await createLeaselessTenant(editor(), {
      facilityId,
      firstName: 'Pat',
      lastName,
      email,
      phone: '5125551234',
      address: { addressLine1: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const tenantId = result.tenantId

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    expect(tenant.facilityId).toBe(facilityId)
    expect(await prisma.lease.count({ where: { tenantId } })).toBe(0)

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Tenant', entityId: tenantId, action: 'tenant.created_leaseless' },
    })
    expect(audit).not.toBeNull()

    // Absent from occupancy, moves, and the delinquency queue — all three are
    // driven by Lease/Unit/Task rows, and this tenant holds none.
    const occupancy = await occupancyForFacility(
      facilityId,
      'Test',
      new Date('2020-01-01'),
      new Date('2020-02-01'),
    )
    expect(occupancy.occupancy.occupiedCount).toBe(0)

    const moves = await movesForFacility(
      facilityId,
      'Test',
      new Date('2020-01-01'),
      new Date('2030-01-01'),
    )
    expect(moves.moves.moveIns).toBe(0)

    const queue = await delinquencyQueue(editor(), facilityId)
    expect(queue.flatMap((group) => group.tasks)).toEqual([])

    // Present in search and the profile page.
    const found = await searchTenants(editor(), lastName)
    expect(found.map((row) => row.tenantId)).toContain(tenantId)

    const profile = await tenantProfile(editor(), tenantId)
    expect(profile.leases).toEqual([])

    // Present as a business account's payer field.
    const account = await createAccount(editor(), {
      facilityId,
      name: `Biz ${suffix}`,
      payerEmail: email,
    })
    const created = await prisma.billingAccount.findUniqueOrThrow({ where: { id: account.id } })
    expect(created.payerTenantId).toBe(tenantId)
  })

  it('refuses without tenants:edit', async () => {
    await expect(
      createLeaselessTenant(viewerOnly(), {
        facilityId,
        firstName: 'No',
        lastName: 'Access',
        address: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('refuses a blank name or an unmailable address, and creates nothing', async () => {
    const before = await prisma.tenant.count({ where: { facilityId } })

    const result = await createLeaselessTenant(editor(), {
      facilityId,
      firstName: '',
      lastName: '',
      address: { addressLine1: '', city: '', state: '', postalCode: '' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.problems.firstName).toBeDefined()
    expect(result.problems.lastName).toBeDefined()
    expect(result.problems.addressLine1).toBeDefined()

    expect(await prisma.tenant.count({ where: { facilityId } })).toBe(before)
  })
})
