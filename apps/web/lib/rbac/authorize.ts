import { prisma } from '@storage/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor, Assignment } from './actor'

export class ForbiddenError extends Error {
  constructor(
    message: string,
    readonly permission?: PermissionKey,
    readonly facilityId?: string | null,
  ) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/// Every check funnels through here, so "fail closed" is decided in one place.
/// An unknown actor shape, a missing assignment, or an absent facility context
/// all deny.
function assignmentsFor(actor: Actor, facilityId: string | null | undefined): Assignment[] {
  if (actor.kind !== 'staff') return []
  return actor.assignments.filter(
    // A null facilityId on the assignment grants every facility. A null
    // facilityId in the *request* means an org-wide action, which only an
    // all-facilities assignment can satisfy.
    (assignment) =>
      assignment.facilityId === null ||
      (facilityId != null && assignment.facilityId === facilityId),
  )
}

export function can(
  actor: Actor,
  permission: PermissionKey,
  facilityId?: string | null,
): boolean {
  // The system actor is not a superuser — it holds exactly the permissions its
  // seeded role grants, checked below like anyone else.
  if (actor.kind === 'tenant') return false
  if (actor.kind === 'system') return SYSTEM_PERMISSIONS.has(permission)

  return assignmentsFor(actor, facilityId).some((assignment) =>
    assignment.permissions.has(permission),
  )
}

/// Loaded once from the seeded `system` role rather than hardcoded, so the
/// catalog stays the single source of truth.
let SYSTEM_PERMISSIONS: ReadonlySet<PermissionKey> = new Set()

export async function loadSystemPermissions(): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { key: 'system' },
    include: { permissions: true },
  })
  SYSTEM_PERMISSIONS = new Set(
    (role?.permissions ?? []).map((p) => p.permissionKey as PermissionKey),
  )
}

export function requirePermission(
  actor: Actor,
  permission: PermissionKey,
  facilityId?: string | null,
): void {
  if (!can(actor, permission, facilityId)) {
    throw new ForbiddenError(
      `Missing permission ${permission}${facilityId ? ` for facility ${facilityId}` : ''}`,
      permission,
      facilityId,
    )
  }
}

// ------------------------------------------------------------- scoping ----

export type FacilityAccess =
  | { all: true }
  | { all: false; facilityIds: string[] }

export function facilityAccess(actor: Actor): FacilityAccess {
  if (actor.kind !== 'staff') return { all: false, facilityIds: [] }
  if (actor.assignments.some((assignment) => assignment.facilityId === null)) {
    return { all: true }
  }
  return {
    all: false,
    facilityIds: [
      ...new Set(
        actor.assignments
          .map((assignment) => assignment.facilityId)
          .filter((id): id is string => id !== null),
      ),
    ],
  }
}

/// Prisma `where` fragment to spread into every facility-scoped query
/// (PRD 02 RBAC-1/RBAC-4). A staff user with no assignments gets
/// `{ facilityId: { in: [] } }`, which matches nothing — never everything.
export function facilityScope(actor: Actor): { facilityId?: { in: string[] } } {
  const access = facilityAccess(actor)
  return access.all ? {} : { facilityId: { in: access.facilityIds } }
}

export function assertFacilityAccess(actor: Actor, facilityId: string): void {
  const access = facilityAccess(actor)
  if (access.all) return
  if (!access.facilityIds.includes(facilityId)) {
    throw new ForbiddenError(`No access to facility ${facilityId}`, undefined, facilityId)
  }
}

/// Resolves the facility context a request asked for against what the actor may
/// see. Passing no facility means "all the ones I'm allowed", never "all".
export function resolveFacilityFilter(
  actor: Actor,
  requestedFacilityId?: string | null,
): { facilityId?: { in: string[] } } {
  if (requestedFacilityId) {
    assertFacilityAccess(actor, requestedFacilityId)
    return { facilityId: { in: [requestedFacilityId] } }
  }
  return facilityScope(actor)
}

// ---------------------------------------------------- monetary authority ----

export type MonetaryAction = 'fee_waiver' | 'refund' | 'credit'

const LIMIT_FIELD = {
  fee_waiver: 'maxFeeWaiverCents',
  refund: 'maxRefundCents',
  credit: 'maxCreditCents',
} as const

const REQUIRED_PERMISSION: Record<MonetaryAction, PermissionKey> = {
  fee_waiver: 'fees:waive',
  refund: 'refunds:approve',
  credit: 'credits:manual',
}

export type MonetaryDecision =
  | { allowed: true }
  | { allowed: false; reason: 'forbidden' }
  | { allowed: false; reason: 'over_limit'; limitCents: number; escalateToRank: number | null }

/// PRD 02 RBAC-2: over-limit does not simply fail — it routes to the next role
/// up. Returning the target rank lets the caller create the approval request
/// (the approval workflow itself lands with refunds in B-048).
export function checkMonetaryAuthority(
  actor: Actor,
  action: MonetaryAction,
  amountCents: number,
  facilityId: string,
): MonetaryDecision {
  if (amountCents < 0) throw new Error('Monetary amounts are non-negative cents')
  if (!can(actor, REQUIRED_PERMISSION[action], facilityId)) {
    return { allowed: false, reason: 'forbidden' }
  }

  const relevant = assignmentsFor(actor, facilityId).filter((assignment) =>
    assignment.permissions.has(REQUIRED_PERMISSION[action]),
  )

  // A user with several assignments gets the most generous limit they hold for
  // this facility; null (unlimited) wins outright.
  const limits = relevant.map((assignment) => assignment.limits[LIMIT_FIELD[action]])
  if (limits.some((limit) => limit === null)) return { allowed: true }

  const best = Math.max(...limits.map((limit) => limit ?? 0))
  if (amountCents <= best) return { allowed: true }

  const currentRank = Math.max(...relevant.map((assignment) => assignment.rank))
  return {
    allowed: false,
    reason: 'over_limit',
    limitCents: best,
    escalateToRank: currentRank,
  }
}

/// The role that should approve an amount this actor cannot. Data-driven, so a
/// new role slots into the chain without a code change.
export async function nextApproverRole(
  action: MonetaryAction,
  amountCents: number,
  aboveRank: number,
): Promise<{ key: string; name: string } | null> {
  const candidates = await prisma.role.findMany({
    where: { isStaffRole: true, rank: { gt: aboveRank } },
    orderBy: { rank: 'asc' },
    include: { permissions: true },
  })

  const permission = REQUIRED_PERMISSION[action]
  for (const role of candidates) {
    if (!role.permissions.some((p) => p.permissionKey === permission)) continue
    const limit = role[LIMIT_FIELD[action]]
    if (limit === null || limit >= amountCents) return { key: role.key, name: role.name }
  }
  return null
}
