import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  ladderViolation,
  roleLimitRows,
  saveRoleLimits,
  type RoleLimitRow,
} from '../apps/web/lib/admin/role-limits'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-197 / PRD 02 RBAC-2. The four monetary limits, edited rather than seeded.
//
// ── Why the fixture roles sit at rank 11 and 12 with $0 in every box ────────
//
// `role` is a GLOBAL table on a schema several suites share, so a fixture role
// that holds a real permission and a real limit is visible to every other
// suite's `nextApproverRole` for as long as this file runs. Both fixtures
// therefore hold $0 throughout: `checkMonetaryAuthority` only escalates an
// amount it cannot cover, and `nextApproverRole` skips any role whose limit is
// below that amount, so a $0 role can never be picked. The one test that raises
// a limit above $0 on a role holding `fees:waive` is the one that is REFUSED,
// and a refused save writes nothing.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const JUNIOR = `test-b197-junior-${suffix}`
const SENIOR = `test-b197-senior-${suffix}`

let staffId = ''

function owner(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId: null,
        roleKey: 'owner',
        rank: 40,
        permissions: new Set<PermissionKey>(['users:manage'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

function manager(facilityId: string): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['users:manage'] as never),
        limits: { maxFeeWaiverCents: 5_000, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const ZERO = { fee_waiver: 0, refund: 0, credit: 0, payment_plan: 0 } as const

async function resetFixtures() {
  for (const key of [JUNIOR, SENIOR]) {
    await prisma.role.update({
      where: { key },
      data: {
        maxFeeWaiverCents: 0,
        maxRefundCents: 0,
        maxCreditCents: 0,
        maxPlanDeferralCents: 0,
      },
    })
  }
}

describeDb('role monetary limits (RBAC-2, B-197)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `roles-${suffix}@example.com`, firstName: 'Ada', lastName: 'Owner' },
    })
    staffId = staff.id

    for (const [key, name, rank] of [
      [JUNIOR, `Junior ${suffix}`, 11],
      [SENIOR, `Senior ${suffix}`, 12],
    ] as const) {
      await prisma.role.create({
        data: {
          key,
          name,
          rank,
          isStaffRole: true,
          maxFeeWaiverCents: 0,
          maxRefundCents: 0,
          maxCreditCents: 0,
          maxPlanDeferralCents: 0,
          permissions: { create: [{ permissionKey: 'fees:waive' }] },
        },
      })
    }
  })

  beforeEach(resetFixtures)

  afterAll(async () => {
    // `RolePermission` cascades from the role, so one delete is the whole
    // fixture — and it has to run, because a fixture role left behind is a rung
    // every other suite's escalation chain has to step over.
    await prisma.role.deleteMany({ where: { key: { in: [JUNIOR, SENIOR] } } })
    // The staff fixture is NOT reclaimed, and cannot be: `audit_log` carries a
    // RESTRICT foreign key to `staff_user` and refuses UPDATE, DELETE and
    // TRUNCATE on itself (B-185), so anything this suite audited against pins
    // its author forever. `npm run db:reset-test` is the only cleanup.
  })

  it('saves a limit, keeps blank and zero apart, and audits both sides', async () => {
    // `refund` is chosen deliberately: neither fixture holds `refunds:approve`,
    // so the ladder check filters both out and this exercises the save alone.
    const first = await saveRoleLimits(owner(), {
      roleKey: JUNIOR,
      limits: { ...ZERO, refund: 25_000 },
    })
    expect(first).toEqual({ ok: true })

    const saved = await prisma.role.findUniqueOrThrow({ where: { key: JUNIOR } })
    expect(saved.maxRefundCents).toBe(25_000)
    expect(saved.maxFeeWaiverCents).toBe(0)

    // Blank is unlimited and is NOT zero — the distinction the whole screen
    // turns on, and the one a `?? 0` anywhere in the chain would collapse.
    const second = await saveRoleLimits(owner(), {
      roleKey: JUNIOR,
      limits: { ...ZERO, refund: null },
    })
    expect(second).toEqual({ ok: true })
    expect((await prisma.role.findUniqueOrThrow({ where: { key: JUNIOR } })).maxRefundCents).toBeNull()

    const entries = await prisma.auditLog.findMany({
      where: { action: 'role.limits_changed', entityId: JUNIOR },
      orderBy: { occurredAt: 'asc' },
    })
    expect(entries).toHaveLength(2)
    expect(entries[0].before).toMatchObject({ refund: 0 })
    expect(entries[0].after).toMatchObject({ refund: 25_000 })
    expect(entries[1].before).toMatchObject({ refund: 25_000 })
    expect(entries[1].after).toMatchObject({ refund: null })
  })

  it('refuses a limit that would out-rank the role an escalation goes to', async () => {
    const result = await saveRoleLimits(owner(), {
      roleKey: JUNIOR,
      limits: { ...ZERO, fee_waiver: 100_000 },
    })

    expect(result.ok).toBe(false)
    if (result.ok || result.reason !== 'ladder') throw new Error('expected a ladder refusal')
    // Keyed to the action, because that is the name of the input it belongs
    // beside on the form (3.3.1).
    expect(Object.keys(result.errors)).toEqual(['fee_waiver'])
    expect(result.errors.fee_waiver).toContain(`Senior ${suffix}`)

    // A refusal writes nothing — neither the offending field nor its siblings.
    const after = await prisma.role.findUniqueOrThrow({ where: { key: JUNIOR } })
    expect(after.maxFeeWaiverCents).toBe(0)
  })

  it('refuses an unknown role rather than creating one', async () => {
    expect(await saveRoleLimits(owner(), { roleKey: `nope-${suffix}`, limits: { ...ZERO } })).toEqual({
      ok: false,
      reason: 'unknown_role',
    })
  })

  it('is org-level: a manager at one facility cannot read or write the limits', async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Roles ${suffix}`,
        slug: `roles-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })

    await expect(roleLimitRows(manager(facility.id))).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      saveRoleLimits(manager(facility.id), { roleKey: JUNIOR, limits: { ...ZERO } }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    await prisma.facility.delete({ where: { id: facility.id } })
  })

  it('lists every staff role with whether the permission behind each limit is held', async () => {
    const rows = await roleLimitRows(owner())
    const junior = rows.find((row) => row.roleKey === JUNIOR)

    expect(junior?.holds.fee_waiver).toBe(true)
    expect(junior?.holds.refund).toBe(false)
    // The tenant role is not a staff role and has no business on this screen.
    expect(rows.some((row) => row.roleKey === 'tenant')).toBe(false)
    expect(rows.map((row) => row.rank)).toEqual([...rows.map((row) => row.rank)].sort((a, b) => a - b))
  })
})

// The ladder rule on its own, with no database in the way — every shape the
// comparison has to get right, including the two it must NOT complain about.
describe('ladderViolation', () => {
  function row(rank: number, limit: number | null, holds = true): RoleLimitRow {
    return {
      roleKey: `r${rank}`,
      roleName: `Role ${rank}`,
      rank,
      limits: { fee_waiver: limit, refund: 0, credit: 0, payment_plan: 0 },
      holds: { fee_waiver: holds, refund: false, credit: false, payment_plan: false },
    }
  }

  it('accepts a ladder that only ever goes up', () => {
    expect(ladderViolation([row(10, 0), row(20, 5_000), row(30, null)], 'fee_waiver')).toBeNull()
  })

  it('catches a lower rank with more authority than a higher one', () => {
    expect(ladderViolation([row(10, 9_000), row(20, 5_000)], 'fee_waiver')).toContain('Role 20')
  })

  it('treats unlimited as the top of the ladder, not as zero', () => {
    // Rank 10 unlimited under a capped rank 20 is the failure; the reverse is
    // fine. `null` sorting as 0 would get both of these backwards.
    expect(ladderViolation([row(10, null), row(20, 5_000)], 'fee_waiver')).not.toBeNull()
    expect(ladderViolation([row(10, 5_000), row(20, null)], 'fee_waiver')).toBeNull()
  })

  it('does not compare two roles at the same rank', () => {
    // Counter staff and the bookkeeper are both rank 10. Neither is above the
    // other, so neither is where the other's over-limit request escalates to.
    expect(ladderViolation([row(10, 9_000), row(10, 0)], 'fee_waiver')).toBeNull()
  })

  it('ignores a role that cannot perform the action at all', () => {
    // An inert number on a role without the permission is not in the chain
    // `nextApproverRole` walks, so it cannot break it either.
    expect(ladderViolation([row(10, 9_000, false), row(20, 5_000)], 'fee_waiver')).toBeNull()
  })
})
