import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  LIMIT_FIELD,
  REQUIRED_PERMISSION,
  requirePermission,
  type MonetaryAction,
} from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { formatCents } from '@/lib/format'

// PRD 02 RBAC-2 (B-197). The four monetary authority limits on a role, edited
// where a person can reach them.
//
// RBAC-2 says the limits "are starting values the owner can change in
// configuration; they are not hardcoded policy". Until this file existed that
// sentence was false: `packages/db/rbac-catalog.ts` seeded them and nothing
// anywhere wrote them again, so an operator who wanted their managers to waive
// $100 rather than $50 had to open a database client.
//
// Org-level, not per-facility, because the columns are on `Role` and a role is
// one row for the whole portfolio — there is no per-site version of a limit to
// edit. That is why the gate is `users:manage` asked with a null facilityId,
// the same question `/admin/settings/staff` asks: only an owner, or a manager
// assigned to every facility, satisfies it.

export const MONETARY_ACTIONS = [
  'fee_waiver',
  'refund',
  'credit',
  'payment_plan',
] as const satisfies readonly MonetaryAction[]

/// What each limit is called on screen. Named after the ACT, not after the
/// column — the person setting it is deciding how much of a refund a manager
/// may give back, not editing `maxRefundCents`.
export const MONETARY_ACTION_LABELS: Record<MonetaryAction, string> = {
  fee_waiver: 'Fee waiver',
  refund: 'Refund',
  credit: 'Manual credit',
  payment_plan: 'Payment-plan deferral',
}

/// The one-line "what does this actually let them do", shown as the field hint.
export const MONETARY_ACTION_HINTS: Record<MonetaryAction, string> = {
  fee_waiver: 'The most a single late, lien or damage fee may be forgiven by.',
  refund: 'The most a single refund of a taken payment may be for.',
  credit: 'The most a single manual credit onto an account may be for.',
  payment_plan: 'The most ARREARS may be deferred onto one payment plan (D-98). Not a waiver — the money is still owed.',
}

export type RoleLimits = Record<MonetaryAction, number | null>

export type RoleLimitRow = {
  roleKey: string
  roleName: string
  rank: number
  limits: RoleLimits
  /// Whether the role holds the permission each limit gates. A limit on a role
  /// that cannot perform the act at all is inert, and saying so on the screen
  /// is cheaper than letting somebody raise a number that changes nothing.
  holds: Record<MonetaryAction, boolean>
}

type RoleWithPermissions = {
  key: string
  name: string
  rank: number
  maxFeeWaiverCents: number | null
  maxRefundCents: number | null
  maxCreditCents: number | null
  maxPlanDeferralCents: number | null
  permissions: { permissionKey: string }[]
}

function toRow(role: RoleWithPermissions): RoleLimitRow {
  const held = new Set(role.permissions.map((p) => p.permissionKey))
  const limits = {} as RoleLimits
  const holds = {} as Record<MonetaryAction, boolean>
  for (const action of MONETARY_ACTIONS) {
    limits[action] = role[LIMIT_FIELD[action]]
    holds[action] = held.has(REQUIRED_PERMISSION[action])
  }
  return { roleKey: role.key, roleName: role.name, rank: role.rank, limits, holds }
}

async function staffRoles(): Promise<RoleWithPermissions[]> {
  return prisma.role.findMany({
    where: { isStaffRole: true },
    orderBy: [{ rank: 'asc' }, { name: 'asc' }],
    select: {
      key: true,
      name: true,
      rank: true,
      maxFeeWaiverCents: true,
      maxRefundCents: true,
      maxCreditCents: true,
      maxPlanDeferralCents: true,
      permissions: { select: { permissionKey: true } },
    },
  })
}

export async function roleLimitRows(actor: Actor): Promise<RoleLimitRow[]> {
  requirePermission(actor, 'users:manage', null)
  return (await staffRoles()).map(toRow)
}

/// `null` is unlimited and outranks every number, which is why this is
/// `Infinity` and not a large integer.
function effective(limit: number | null): number {
  return limit === null ? Infinity : limit
}

/// The ladder has to be non-decreasing in rank, per action.
///
/// `nextApproverRole` walks roles above the actor's rank in ASCENDING rank
/// order and stops at the first one whose limit covers the amount. Give a
/// facility manager a bigger waiver limit than the regional above them and
/// every over-limit waiver escalates to somebody with LESS authority than the
/// person who asked — the approval goes through a rung that cannot actually
/// authorise it, and the one above never sees it. So this is refused at the
/// point of editing rather than left to surface as a strange approval chain.
///
/// Only roles that HOLD the action's permission are compared, because they are
/// exactly the roles `nextApproverRole` considers — a number sitting on a role
/// that cannot waive a fee has no bearing on where a waiver escalates to.
/// Equal ranks are not compared: neither is above the other.
export function ladderViolation(
  rows: RoleLimitRow[],
  action: MonetaryAction,
): string | null {
  const ladder = rows
    .filter((row) => row.holds[action])
    .sort((a, b) => a.rank - b.rank)

  for (let i = 1; i < ladder.length; i++) {
    const above = ladder[i]
    for (let j = 0; j < i; j++) {
      const below = ladder[j]
      if (below.rank === above.rank) continue
      if (effective(below.limits[action]) > effective(above.limits[action])) {
        return (
          `${below.roleName} would be able to approve ${describe(below.limits[action])} while ` +
          `${above.roleName}, who is ranked above them and is who an over-limit ` +
          `${MONETARY_ACTION_LABELS[action].toLowerCase()} escalates to, is held to ` +
          `${describe(above.limits[action])}. Raise ${above.roleName} first.`
        )
      }
    }
  }
  return null
}

/// The words, never the blank alone (3.3.2). "Unlimited" and "no authority" are
/// different facts and an empty cell says neither.
export function describe(limit: number | null): string {
  if (limit === null) return 'unlimited'
  if (limit === 0) return 'nothing (no authority)'
  return formatCents(limit)
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_role' }
  | { ok: false; reason: 'ladder'; errors: Partial<Record<MonetaryAction, string>> }

export async function saveRoleLimits(
  actor: Actor,
  input: { roleKey: string; limits: RoleLimits },
): Promise<SaveResult> {
  requirePermission(actor, 'users:manage', null)

  const roles = await staffRoles()
  const target = roles.find((role) => role.key === input.roleKey)
  if (!target) return { ok: false, reason: 'unknown_role' }

  const before = toRow(target)
  const rows = roles.map(toRow).map((row) =>
    row.roleKey === input.roleKey ? { ...row, limits: input.limits } : row,
  )

  const errors: Partial<Record<MonetaryAction, string>> = {}
  for (const action of MONETARY_ACTIONS) {
    // Only the actions this save actually MOVED are checked. A ladder that was
    // already crooked when the screen loaded — a seed edited by hand, a role
    // added below an existing one — must not block an unrelated field, or the
    // only way to fix it is the database client this row exists to remove.
    if (before.limits[action] === input.limits[action]) continue
    const violation = ladderViolation(rows, action)
    if (violation) errors[action] = violation
  }
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'ladder', errors }

  await prisma.role.update({
    where: { key: input.roleKey },
    data: {
      maxFeeWaiverCents: input.limits.fee_waiver,
      maxRefundCents: input.limits.refund,
      maxCreditCents: input.limits.credit,
      maxPlanDeferralCents: input.limits.payment_plan,
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'role.limits_changed',
    entityType: 'Role',
    entityId: input.roleKey,
    // Cents both sides, and all four every time even where only one moved:
    // `diffSnapshots` drops what did not change, and "what was this role
    // allowed to do in March" needs the whole set to be answerable at all.
    before: { ...before.limits },
    after: { ...input.limits },
  })

  return { ok: true }
}
