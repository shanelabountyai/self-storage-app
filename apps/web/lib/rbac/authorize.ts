import { prisma } from '@storage/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor, Assignment } from './actor'

export class ForbiddenError extends Error {
  // Explicit fields, not TS constructor-parameter-property sugar: Node's
  // type-stripping (used to run apps/web/scripts/*.mts directly) only erases
  // types, it doesn't transform syntax, and errors on that shorthand.
  readonly permission?: PermissionKey
  readonly facilityId?: string | null

  constructor(message: string, permission?: PermissionKey, facilityId?: string | null) {
    super(message)
    this.name = 'ForbiddenError'
    this.permission = permission
    this.facilityId = facilityId
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

/// "Does this actor hold this permission at ANY facility they're assigned to"
/// — for UI decisions that aren't yet scoped to one facility, like which nav
/// items to show. Deliberately distinct from `can()`: it never gates an actual
/// action (nothing here should authorize a write), only whether a menu item or
/// route is worth showing before a specific facility is in play.
export function hasPermissionAnywhere(
  actor: Actor,
  permissions: readonly PermissionKey[],
): boolean {
  if (actor.kind === 'tenant') return false
  if (actor.kind === 'system') return permissions.some((p) => SYSTEM_PERMISSIONS.has(p))
  return actor.assignments.some((assignment) =>
    permissions.some((permission) => assignment.permissions.has(permission)),
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

export type MonetaryAction = 'fee_waiver' | 'refund' | 'credit' | 'payment_plan'

/// Which column on `Role` carries each action's limit. Exported so the screen
/// that EDITS those limits (B-197) reads the mapping from here rather than
/// keeping a second copy of it.
export const LIMIT_FIELD = {
  fee_waiver: 'maxFeeWaiverCents',
  refund: 'maxRefundCents',
  credit: 'maxCreditCents',
  payment_plan: 'maxPlanDeferralCents',
} as const

export const REQUIRED_PERMISSION: Record<MonetaryAction, PermissionKey> = {
  fee_waiver: 'fees:waive',
  refund: 'refunds:approve',
  credit: 'credits:manual',
  // D-98 (B-190). The same permission that already gates agreeing a plan —
  // this adds an AMOUNT to it, it does not mint a second gate.
  payment_plan: 'delinquency:execute_step',
}

/// The highest rank this actor holds at a facility, or null where they hold
/// none. Exported for D-98's repeat-plan rule, which needs "is this person a
/// level above the floor" and cannot ask `can()` — every role that may agree a
/// plan holds the same permission, and the whole point is to tell them apart.
export function actorRank(actor: Actor, facilityId: string): number | null {
  const assignments = assignmentsFor(actor, facilityId)
  if (assignments.length === 0) return null
  return Math.max(...assignments.map((assignment) => assignment.rank))
}

/// The lowest staff rank that holds a permission anywhere in the role table.
/// Data-driven so a new role slots into the ladder without a code change, the
/// same rule `nextApproverRole` follows.
export async function lowestRankWith(permission: PermissionKey): Promise<number | null> {
  const role = await prisma.role.findFirst({
    where: { isStaffRole: true, permissions: { some: { permissionKey: permission } } },
    orderBy: { rank: 'asc' },
    select: { rank: true },
  })
  return role?.rank ?? null
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
  // `undefined` is NOT `null` here, and the difference decides whether an
  // owner is unlimited: `null` means unlimited by design, while a field an
  // assignment does not carry at all is no authority (see
  // `MonetaryLimits.maxPlanDeferralCents`). `?? 0` would collapse the two and
  // cap every owner at zero.
  const limits = relevant.map((assignment) => {
    const limit = assignment.limits[LIMIT_FIELD[action]]
    return limit === undefined ? 0 : limit
  })
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
