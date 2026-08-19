import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor } from '@/lib/rbac/actor'
import { can, facilityAccess, hasPermissionAnywhere, type FacilityAccess } from '@/lib/rbac/authorize'

/// PRD 09 §5.2 — the escalation guard. G2 ("never a privilege-escalation path")
/// made concrete, and SR-1 names this file as the security boundary: one
/// function, one adversarial suite.
///
/// **It is deliberately not a `can()` branch.** D-12 forbids a permission
/// bypass, and PRD 09 §3 is explicit that if an implementation finds itself
/// adding a branch to `can()` to make impersonation work, that implementation is
/// wrong. Nothing here touches `can()`; it *asks* `can()` questions about the
/// impersonator, exactly as any other caller does.

/// Everything the guard needs to know about who is being impersonated, gathered
/// by `loadSubject()` in ./service.ts. A plain value so the rules can be tested
/// without a database.
export type ImpersonationSubject = {
  type: 'tenant' | 'staff'
  id: string
  /// False for a soft-deleted tenant, or a suspended or soft-deleted staff user
  /// (FR-10).
  active: boolean
  /// The facilities the subject reaches: a staff user's assignments, or the
  /// facilities a tenant holds a lease at.
  scope: FacilityAccess
  /// Every role rank the subject holds. Tenants hold none, which is FR-6's
  /// "tenants are rank 0 and always satisfy this".
  ranks: readonly number[]
}

export type ImpersonationRefusal =
  | 'not_staff'
  | 'nested'
  | 'self'
  | 'subject_inactive'
  | 'missing_permission'
  | 'rank'
  | 'scope'
  | 'unscopable_subject'

export type GuardDecision =
  | { allowed: true; permission: PermissionKey }
  | { allowed: false; refusal: ImpersonationRefusal; message: string }

const PERMISSION_FOR: Record<ImpersonationSubject['type'], PermissionKey> = {
  tenant: 'impersonation:tenant',
  staff: 'impersonation:staff',
}

function highestRank(actor: Actor): number {
  if (actor.kind !== 'staff' || actor.assignments.length === 0) return 0
  return Math.max(...actor.assignments.map((assignment) => assignment.rank))
}

function deny(refusal: ImpersonationRefusal, message: string): GuardDecision {
  return { allowed: false, refusal, message }
}

/// The whole of FR-6, FR-7, FR-8 and FR-10, evaluated at session start **and
/// again on every request** (FR-9). Same function both times, against freshly
/// loaded assignments — a subject promoted mid-session must stop being
/// impersonable immediately, not at expiry.
export function canImpersonate(
  actor: Actor,
  subject: ImpersonationSubject,
  options: { alreadyImpersonating?: boolean } = {},
): GuardDecision {
  if (actor.kind !== 'staff') {
    return deny('not_staff', 'Only a signed-in staff user can start a support session.')
  }

  // FR-4. Checked here rather than only at the route, so the rule holds for
  // every caller including a future job or API.
  if (options.alreadyImpersonating) {
    return deny('nested', 'A support session cannot start another support session.')
  }

  if (subject.type === 'staff' && subject.id === actor.staffUserId) {
    return deny('self', 'You are already signed in as yourself.')
  }

  if (!subject.active) {
    return deny(
      'subject_inactive',
      'This account is suspended or deleted, so it cannot be impersonated.',
    )
  }

  const permission = PERMISSION_FOR[subject.type]
  if (!hasPermissionAnywhere(actor, [permission])) {
    return deny('missing_permission', `Missing permission ${permission}.`)
  }

  // FR-6, the rank rule. EVERY role the subject holds must be at or below the
  // impersonator's highest — not their lowest, and not just one of them. A
  // manager who also holds a regional assignment is reachable only by someone
  // who is at least a regional.
  //
  // This is what stops the exploit the whole feature is judged on: a manager
  // impersonating an owner and inheriting owner authority. It also, for free,
  // makes the `system` role (rank 100) unreachable by every human.
  const actorRank = highestRank(actor)
  const subjectRank = subject.ranks.length === 0 ? 0 : Math.max(...subject.ranks)
  if (subjectRank > actorRank) {
    return deny(
      'rank',
      'This account holds a role above your own, so impersonating it would grant you authority you do not have.',
    )
  }

  // FR-7 and FR-8, the scope rule — expressed as "does the impersonator hold
  // the impersonation permission AT every facility the subject reaches".
  //
  // That is deliberately stronger than a bare subset of facility ids, and the
  // difference is a real hole rather than pedantry: an actor who is `owner` at
  // A and `counter` at B passes a subset test for a tenant with leases at both,
  // and would then be reading that tenant's facility-B history through a role
  // that grants no impersonation there at all. Asking `can()` per facility is
  // also how the rest of the codebase decides this, so there is no second
  // definition of "scoped" to drift.
  //
  // FR-8 falls out of the same expression rather than needing its own rule: an
  // all-facilities subject is checked with a null facility, and `can()` already
  // treats null as "only an all-facilities assignment satisfies this".
  if (subject.scope.all) {
    if (!can(actor, permission, null)) {
      return deny(
        'scope',
        'This account is assigned to every facility, so only another all-facilities user can impersonate it.',
      )
    }
    return { allowed: true, permission }
  }

  // An empty scope is refused rather than treated as trivially-a-subset. A
  // subject who reaches no facility is one the scope rule cannot confine, and
  // FR-1 says the subject is always an entity the actor can already see under
  // normal facility scoping — a tenant with no lease appears in nobody's
  // facility-scoped tenant list. Failing closed here matches `facilityScope()`,
  // which returns "matches nothing" rather than "matches everything" for an
  // actor with no assignments.
  if (subject.scope.facilityIds.length === 0) {
    if (!facilityAccess(actor).all) {
      return deny(
        'unscopable_subject',
        'This account is not linked to any facility you are assigned to.',
      )
    }
    return { allowed: true, permission }
  }

  const unreachable = subject.scope.facilityIds.filter((id) => !can(actor, permission, id))
  if (unreachable.length > 0) {
    return deny(
      'scope',
      'This account reaches a facility you are not assigned to, so impersonating it would widen your access.',
    )
  }

  return { allowed: true, permission }
}
