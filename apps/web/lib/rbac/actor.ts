import { prisma } from '@storage/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'

export type MonetaryLimits = {
  maxFeeWaiverCents: number | null
  maxRefundCents: number | null
  maxCreditCents: number | null
  /// D-98 (B-190). The most arrears this role may defer onto a payment plan.
  ///
  /// **Optional, and absent means zero rather than unlimited.** Every actor
  /// built by `loadStaffActor` carries it; the optionality is for the test
  /// fixtures that predate it, and the safe direction for a limit nobody has
  /// set is "no authority", never "any amount".
  maxPlanDeferralCents?: number | null
}

export type Assignment = {
  /// null means every facility, present and future.
  facilityId: string | null
  roleKey: string
  rank: number
  permissions: ReadonlySet<PermissionKey>
  limits: MonetaryLimits
}

export type Actor =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'staff'; staffUserId: string; assignments: readonly Assignment[] }
  /// Background jobs and integrations (master PRD §7.1). Carries a label so the
  /// audit log records which job acted.
  | { kind: 'system'; label: string }

/// Loads a staff actor with every role assignment resolved. Deliberately one
/// query per request rather than a cache: a revoked role must take effect
/// immediately, not at the end of a TTL.
export async function loadStaffActor(staffUserId: string): Promise<Actor | null> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    include: {
      assignments: {
        include: { role: { include: { permissions: true } } },
      },
    },
  })

  // A suspended or soft-deleted staff user has no authority at all, regardless
  // of what assignments still exist.
  if (!staff || staff.deletedAt !== null || staff.status !== 'active') return null

  return {
    kind: 'staff',
    staffUserId: staff.id,
    assignments: staff.assignments.map((assignment) => ({
      facilityId: assignment.facilityId,
      roleKey: assignment.role.key,
      rank: assignment.role.rank,
      permissions: new Set(
        assignment.role.permissions.map((p) => p.permissionKey as PermissionKey),
      ),
      limits: {
        maxFeeWaiverCents: assignment.role.maxFeeWaiverCents,
        maxRefundCents: assignment.role.maxRefundCents,
        maxCreditCents: assignment.role.maxCreditCents,
        maxPlanDeferralCents: assignment.role.maxPlanDeferralCents,
      },
    })),
  }
}

export function systemActor(label: string): Actor {
  return { kind: 'system', label }
}
