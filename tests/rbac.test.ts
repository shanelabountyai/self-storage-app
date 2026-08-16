import { describe, expect, it } from 'vitest'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import {
  assertFacilityAccess,
  can,
  checkMonetaryAuthority,
  facilityAccess,
  facilityScope,
  ForbiddenError,
  hasPermissionAnywhere,
  requirePermission,
  resolveFacilityFilter,
} from '../apps/web/lib/rbac/authorize'
import { PERMISSIONS, ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '../packages/db/rbac-catalog'

const FACILITY_A = 'facility-a'
const FACILITY_B = 'facility-b'

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
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

function staff(...assignments: Assignment[]): Actor {
  return { kind: 'staff', staffUserId: 'staff-1', assignments }
}

const tenant: Actor = { kind: 'tenant', tenantId: 'tenant-1' }

describe('permission catalog', () => {
  it('grants only permissions that exist', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key))
    for (const role of ROLES) {
      for (const permission of role.permissions) {
        expect(known, `${role.key} grants unknown ${permission}`).toContain(permission)
      }
    }
  })

  it('gives the owner every permission', () => {
    const owner = ROLES.find((r) => r.key === 'owner')!
    expect([...owner.permissions].sort()).toEqual(PERMISSIONS.map((p) => p.key).sort())
  })

  it('keeps ranks ordered so escalation has somewhere to go', () => {
    const rank = (key: string) => ROLES.find((r) => r.key === key)!.rank
    expect(rank('counter')).toBeLessThan(rank('manager'))
    expect(rank('manager')).toBeLessThan(rank('regional'))
    expect(rank('regional')).toBeLessThan(rank('owner'))
  })

  it('does not let the system role act as a superuser', () => {
    const system = ROLES.find((r) => r.key === 'system')!
    expect(system.permissions).not.toContain('users:manage')
    expect(system.permissions).not.toContain('refunds:approve')
    expect(system.permissions.length).toBeLessThan(PERMISSIONS.length)
  })

  it('gives read-only roles no mutating permissions', () => {
    const bookkeeper = ROLES.find((r) => r.key === 'bookkeeper')!
    const mutating: PermissionKey[] = [
      'units:edit',
      'payments:take',
      'fees:waive',
      'leases:move_out',
      'users:manage',
    ]
    for (const permission of mutating) {
      expect(bookkeeper.permissions).not.toContain(permission)
    }
  })
})

describe('facility scoping', () => {
  it('confines a manager to the facility they are assigned', () => {
    const actor = staff(assignmentFor('manager', FACILITY_A))

    expect(can(actor, 'units:edit', FACILITY_A)).toBe(true)
    expect(can(actor, 'units:edit', FACILITY_B)).toBe(false)
    expect(() => assertFacilityAccess(actor, FACILITY_B)).toThrow(ForbiddenError)
  })

  it('produces a query filter that cannot reach another facility', () => {
    const actor = staff(assignmentFor('manager', FACILITY_A))
    expect(facilityScope(actor)).toEqual({ facilityId: { in: [FACILITY_A] } })
  })

  it('fails closed for a staff user with no assignments', () => {
    const actor = staff()
    // Never `{}` — an empty filter would return every facility's rows.
    expect(facilityScope(actor)).toEqual({ facilityId: { in: [] } })
    expect(facilityAccess(actor)).toEqual({ all: false, facilityIds: [] })
    expect(can(actor, 'tenants:view', FACILITY_A)).toBe(false)
  })

  it('fails closed for tenants and unassigned system actors', () => {
    expect(facilityScope(tenant)).toEqual({ facilityId: { in: [] } })
    expect(can(tenant, 'tenants:view', FACILITY_A)).toBe(false)
    expect(facilityScope({ kind: 'system', label: 'billing-run' })).toEqual({
      facilityId: { in: [] },
    })
  })

  it('treats a null assignment as every facility', () => {
    const actor = staff(assignmentFor('owner', null))
    expect(facilityAccess(actor)).toEqual({ all: true })
    expect(facilityScope(actor)).toEqual({})
    expect(can(actor, 'users:manage', FACILITY_B)).toBe(true)
    expect(() => assertFacilityAccess(actor, 'any-facility-at-all')).not.toThrow()
  })

  it('combines several single-facility assignments', () => {
    const actor = staff(
      assignmentFor('manager', FACILITY_A),
      assignmentFor('counter', FACILITY_B),
    )
    expect(facilityScope(actor)).toEqual({ facilityId: { in: [FACILITY_A, FACILITY_B] } })

    // Permissions do not leak across the assignments that granted them.
    expect(can(actor, 'units:edit', FACILITY_A)).toBe(true)
    expect(can(actor, 'units:edit', FACILITY_B)).toBe(false)
  })

  it('requires an all-facility assignment for org-wide actions', () => {
    const scoped = staff(assignmentFor('owner', FACILITY_A))
    // Owner of one facility is not owner of the org.
    expect(can(scoped, 'users:manage', null)).toBe(false)
    expect(can(staff(assignmentFor('owner', null)), 'users:manage', null)).toBe(true)
  })

  it('narrows, never widens, when a facility is requested', () => {
    const actor = staff(
      assignmentFor('manager', FACILITY_A),
      assignmentFor('manager', FACILITY_B),
    )
    expect(resolveFacilityFilter(actor, FACILITY_A)).toEqual({ facilityId: { in: [FACILITY_A] } })
    expect(resolveFacilityFilter(actor, null)).toEqual({
      facilityId: { in: [FACILITY_A, FACILITY_B] },
    })
    expect(() => resolveFacilityFilter(actor, 'facility-c')).toThrow(ForbiddenError)
  })

  it('throws with the permission and facility attached', () => {
    const actor = staff(assignmentFor('counter', FACILITY_A))
    try {
      requirePermission(actor, 'users:manage', FACILITY_A)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).permission).toBe('users:manage')
      expect((error as ForbiddenError).facilityId).toBe(FACILITY_A)
    }
  })
})

describe('monetary authority', () => {
  const manager = staff(assignmentFor('manager', FACILITY_A))
  const regional = staff(assignmentFor('regional', FACILITY_A))
  const owner = staff(assignmentFor('owner', null))

  it('allows a waiver within the role limit', () => {
    expect(checkMonetaryAuthority(manager, 'fee_waiver', 5_000, FACILITY_A)).toEqual({
      allowed: true,
    })
  })

  it('escalates a waiver over the limit instead of failing outright', () => {
    const decision = checkMonetaryAuthority(manager, 'fee_waiver', 5_001, FACILITY_A)
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'over_limit',
      limitCents: 5_000,
    })
  })

  it('denies an action the role cannot perform at all', () => {
    expect(checkMonetaryAuthority(manager, 'refund', 100, FACILITY_A)).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
    expect(checkMonetaryAuthority(regional, 'refund', 25_000, FACILITY_A)).toEqual({
      allowed: true,
    })
  })

  it('treats a null limit as unlimited', () => {
    expect(checkMonetaryAuthority(owner, 'refund', 99_999_999, FACILITY_A)).toEqual({
      allowed: true,
    })
  })

  it('does not let authority cross facilities', () => {
    expect(checkMonetaryAuthority(manager, 'fee_waiver', 100, FACILITY_B)).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })

  it('rejects negative amounts rather than treating them as a credit', () => {
    expect(() => checkMonetaryAuthority(owner, 'refund', -1, FACILITY_A)).toThrow()
  })

  it('gives a tenant no monetary authority', () => {
    expect(checkMonetaryAuthority(tenant, 'fee_waiver', 1, FACILITY_A)).toEqual({
      allowed: false,
      reason: 'forbidden',
    })
  })
})

describe('hasPermissionAnywhere (nav/UI visibility, not authorization)', () => {
  it('finds a permission granted at a specific facility with no facility given', () => {
    // The gap can() closes on purpose: calling can() with no facilityId only
    // matches all-facilities assignments. Nav visibility has no "current
    // facility" yet, so it must check across every assignment instead.
    const actor = staff(assignmentFor('manager', FACILITY_A))
    expect(can(actor, 'units:edit')).toBe(false)
    expect(hasPermissionAnywhere(actor, ['units:edit'])).toBe(true)
  })

  it('is false when none of the assignments grant it anywhere', () => {
    const actor = staff(assignmentFor('counter', FACILITY_A))
    expect(hasPermissionAnywhere(actor, ['facility:settings'])).toBe(false)
  })

  it('is false for tenants and true only for a system role that has it', () => {
    expect(hasPermissionAnywhere(tenant, ['tenants:view'])).toBe(false)
    expect(hasPermissionAnywhere({ kind: 'system', label: 'job' }, ['users:manage'])).toBe(false)
  })
})
