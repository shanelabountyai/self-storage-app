import { describe, expect, it } from 'vitest'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { canImpersonate, type ImpersonationSubject } from '../apps/web/lib/impersonation/guard'
import { PERMISSIONS, ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '../packages/db/rbac-catalog'

// PRD 09 SR-1: "FR-6/FR-7/FR-8 are the security boundary. They belong in one
// function with a dedicated adversarial test suite." This is that suite, and it
// is written from the attacker's side: every case asks whether authority can be
// acquired that the impersonator did not already hold.

const A = 'facility-a'
const B = 'facility-b'

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

function staff(id: string, ...assignments: Assignment[]): Actor {
  return { kind: 'staff', staffUserId: id, assignments }
}

const rankOf = (roleKey: string) => ROLES.find((r) => r.key === roleKey)!.rank

function staffSubject(
  id: string,
  roles: { roleKey: string; facilityId: string | null }[],
  overrides: Partial<ImpersonationSubject> = {},
): ImpersonationSubject {
  const all = roles.some((r) => r.facilityId === null)
  return {
    type: 'staff',
    id,
    active: true,
    scope: all
      ? { all: true }
      : {
          all: false,
          facilityIds: [...new Set(roles.map((r) => r.facilityId!))],
        },
    ranks: roles.map((r) => rankOf(r.roleKey)),
    ...overrides,
  }
}

function tenantSubject(facilityIds: string[], overrides: Partial<ImpersonationSubject> = {}): ImpersonationSubject {
  return {
    type: 'tenant',
    id: 'tenant-1',
    active: true,
    scope: { all: false, facilityIds },
    ranks: [],
    ...overrides,
  }
}

const ownerEverywhere = staff('owner-1', assignmentFor('owner', null))
const ownerAtA = staff('owner-a', assignmentFor('owner', A))
const managerAtA = staff('manager-a', assignmentFor('manager', A))

describe('the catalog carries the four permissions, owner-only (D-13b)', () => {
  const keys = ['impersonation:tenant', 'impersonation:staff', 'impersonation:write', 'impersonation:oversee']

  it('defines all four', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key))
    for (const key of keys) expect(known.has(key as PermissionKey)).toBe(true)
  })

  it('grants them to owner and to nobody else', () => {
    for (const role of ROLES) {
      const held = keys.filter((key) => (role.permissions as readonly string[]).includes(key))
      expect(role.key === 'owner' ? held.length : held.length, `role ${role.key}`).toBe(
        role.key === 'owner' ? keys.length : 0,
      )
    }
  })
})

describe('FR-6 — the rank rule', () => {
  it('refuses manager -> owner, which is the exploit the feature is judged on', () => {
    const decision = canImpersonate(managerAtA, staffSubject('owner-2', [{ roleKey: 'owner', facilityId: A }]))
    expect(decision).toMatchObject({ allowed: false, refusal: 'missing_permission' })
  })

  it('refuses even when the manager somehow holds the permission', () => {
    // The realistic version of the same attack: the owner widens
    // `impersonation:staff` to managers (a seed change, per §4) and the rank
    // rule is then the only thing standing between a manager and an owner
    // account. It has to hold on its own.
    const permissive = assignmentFor('manager', A)
    const withImpersonation: Assignment = {
      ...permissive,
      permissions: new Set<PermissionKey>([...permissive.permissions, 'impersonation:staff']),
    }
    const decision = canImpersonate(
      staff('manager-a', withImpersonation),
      staffSubject('owner-2', [{ roleKey: 'owner', facilityId: A }]),
    )
    expect(decision).toMatchObject({ allowed: false, refusal: 'rank' })
  })

  it('permits owner -> owner at the same facility (equal rank is peer troubleshooting)', () => {
    expect(canImpersonate(ownerAtA, staffSubject('owner-2', [{ roleKey: 'owner', facilityId: A }])).allowed).toBe(true)
  })

  it('takes the subject’s HIGHEST role, not their lowest', () => {
    // A counter at A who is also a regional at A is reachable only by someone
    // at or above regional. Reading the first assignment, or the lowest, would
    // hand a regional account to whoever can reach a counter one.
    const subject = staffSubject('mixed', [
      { roleKey: 'counter', facilityId: A },
      { roleKey: 'regional', facilityId: A },
    ])
    const regionalAtA = staff('regional-a', assignmentFor('regional', A))
    expect(canImpersonate(regionalAtA, subject)).toMatchObject({ allowed: false, refusal: 'missing_permission' })
    expect(canImpersonate(ownerAtA, subject).allowed).toBe(true)
  })

  it('leaves the system role unreachable by every human', () => {
    const decision = canImpersonate(ownerEverywhere, staffSubject('sys', [{ roleKey: 'system', facilityId: null }]))
    expect(decision).toMatchObject({ allowed: false, refusal: 'rank' })
  })

  it('always satisfies the rank rule for tenants', () => {
    expect(canImpersonate(ownerAtA, tenantSubject([A])).allowed).toBe(true)
  })
})

describe('FR-7 — the scope rule', () => {
  it('refuses a tenant whose only lease is at another facility', () => {
    expect(canImpersonate(ownerAtA, tenantSubject([B]))).toMatchObject({ allowed: false, refusal: 'scope' })
  })

  it('refuses a tenant with a lease at one facility the impersonator cannot reach', () => {
    // Subset, not overlap. A tenant at A and B is not reachable from A alone,
    // because the session would render their B history too.
    expect(canImpersonate(ownerAtA, tenantSubject([A, B]))).toMatchObject({ allowed: false, refusal: 'scope' })
  })

  it('refuses a peer manager assigned to a facility the impersonator is not', () => {
    const decision = canImpersonate(
      ownerAtA,
      staffSubject('manager-b', [
        { roleKey: 'manager', facilityId: A },
        { roleKey: 'manager', facilityId: B },
      ]),
    )
    expect(decision).toMatchObject({ allowed: false, refusal: 'scope' })
  })

  it('refuses when the impersonation permission is held at only SOME of the subject’s facilities', () => {
    // The hole a bare facility-id subset check would leave open: owner at A,
    // counter at B, subject reaching both. The ids are a subset; the authority
    // is not.
    const ownerAtA_counterAtB = staff('mixed-1', assignmentFor('owner', A), assignmentFor('counter', B))
    expect(canImpersonate(ownerAtA_counterAtB, tenantSubject([A, B]))).toMatchObject({
      allowed: false,
      refusal: 'scope',
    })
    expect(canImpersonate(ownerAtA_counterAtB, tenantSubject([A])).allowed).toBe(true)
  })
})

describe('FR-8 — all-facilities subjects', () => {
  it('refuses an all-facilities subject to a facility-scoped impersonator', () => {
    expect(canImpersonate(ownerAtA, staffSubject('owner-all', [{ roleKey: 'owner', facilityId: null }]))).toMatchObject(
      { allowed: false, refusal: 'scope' },
    )
  })

  it('permits an all-facilities subject to an all-facilities impersonator', () => {
    expect(
      canImpersonate(ownerEverywhere, staffSubject('owner-all', [{ roleKey: 'owner', facilityId: null }])).allowed,
    ).toBe(true)
  })
})

describe('FR-10 and the fail-closed edges', () => {
  it('refuses self-impersonation', () => {
    expect(canImpersonate(ownerAtA, staffSubject('owner-a', [{ roleKey: 'owner', facilityId: A }]))).toMatchObject({
      allowed: false,
      refusal: 'self',
    })
  })

  it('refuses a suspended or soft-deleted subject', () => {
    expect(canImpersonate(ownerEverywhere, tenantSubject([A], { active: false }))).toMatchObject({
      allowed: false,
      refusal: 'subject_inactive',
    })
  })

  it('refuses a tenant actor outright', () => {
    expect(canImpersonate({ kind: 'tenant', tenantId: 't' }, tenantSubject([A]))).toMatchObject({
      allowed: false,
      refusal: 'not_staff',
    })
  })

  it('refuses the system actor, which holds no impersonation permission', () => {
    expect(canImpersonate({ kind: 'system', label: 'job' }, tenantSubject([A]))).toMatchObject({
      allowed: false,
      refusal: 'not_staff',
    })
  })

  it('refuses nesting (FR-4)', () => {
    expect(
      canImpersonate(ownerEverywhere, tenantSubject([A]), { alreadyImpersonating: true }),
    ).toMatchObject({ allowed: false, refusal: 'nested' })
  })

  it('refuses a subject who reaches no facility, unless the actor reaches every one', () => {
    // A tenant with no lease appears in nobody's facility-scoped tenant list,
    // so a scoped impersonator has no business reaching one. Empty is failed
    // closed rather than treated as trivially a subset.
    expect(canImpersonate(ownerAtA, tenantSubject([]))).toMatchObject({
      allowed: false,
      refusal: 'unscopable_subject',
    })
    expect(canImpersonate(ownerEverywhere, tenantSubject([])).allowed).toBe(true)
  })

  it('refuses a staff actor holding no assignments at all', () => {
    expect(canImpersonate(staff('nobody'), tenantSubject([A]))).toMatchObject({
      allowed: false,
      refusal: 'missing_permission',
    })
  })
})
