import { prisma } from '@storage/db'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { resetMfaForStaff } from '@/lib/auth/mfa'
import { recordAudit } from '@storage/core/audit'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { revokeStaffGateCodes } from '@/lib/access/non-tenant'

// B-079. The administrative side of staff MFA: who has it on, and the one
// button that gets somebody back in after they drop their phone in a river.

export type StaffSecurityRow = {
  staffUserId: string
  name: string
  email: string
  status: string
  enrolled: boolean
  enrolledAt: Date | null
  unusedRecoveryCodes: number
  facilities: string[]
}

export async function staffSecurityRows(actor: Actor): Promise<StaffSecurityRow[]> {
  requirePermission(actor, 'users:manage', null)

  const staff = await prisma.staffUser.findMany({
    where: { deletedAt: null },
    orderBy: [{ status: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      totpConfirmedAt: true,
      recoveryCodes: { where: { usedAt: null }, select: { id: true } },
      assignments: {
        select: { facility: { select: { name: true } } },
      },
    },
  })

  return staff.map((row) => ({
    staffUserId: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email,
    status: row.status,
    enrolled: row.totpConfirmedAt !== null,
    enrolledAt: row.totpConfirmedAt,
    unusedRecoveryCodes: row.recoveryCodes.length,
    // A null facilityId on the assignment is the all-facilities grant (D-12).
    facilities: row.assignments.map((a) => a.facility?.name ?? 'All facilities'),
  }))
}

export type ResetResult = { ok: true } | { ok: false; reason: 'self' | 'not_found' }

/// Clears somebody else's second factor. Requires `users:manage` org-wide —
/// asked with a null facilityId, which only an all-facilities assignment
/// satisfies, because staff accounts are org-level and a manager at one site
/// must not be able to re-key the owner's login.
export async function resetStaffMfa(
  actor: Actor,
  input: { staffUserId: string; reasonCode: string },
): Promise<ResetResult> {
  requirePermission(actor, 'users:manage', null)
  if (actor.kind !== 'staff') return { ok: false, reason: 'not_found' }

  // Resetting your OWN second factor here would be a one-click way to strip
  // MFA off the account you are already signed in to — which is exactly what
  // somebody who stole a live session would do first. Your own is managed at
  // /mfa, which re-verifies before it changes anything.
  if (input.staffUserId === actor.staffUserId) return { ok: false, reason: 'self' }

  const exists = await prisma.staffUser.findUnique({
    where: { id: input.staffUserId },
    select: { id: true },
  })
  if (!exists) return { ok: false, reason: 'not_found' }

  await resetMfaForStaff({
    staffUserId: input.staffUserId,
    actorStaffId: actor.staffUserId,
    reasonCode: input.reasonCode,
  })

  return { ok: true }
}

export type DeactivateResult =
  | { ok: true; gateCodesRevoked: number }
  | { ok: false; reason: 'self' | 'not_found' | 'already_inactive' }

/// PRD 03 US-10 AC2 (B-436). Deactivates a staff account and revokes every
/// gate code it holds, in the same request.
///
/// `user.deactivated` had been in the audit catalog with nothing writing it:
/// until this, an account could only be suspended from a database client.
/// Same authority as `resetStaffMfa`, and the same refusal of your own
/// account, which also means the last person able to do this cannot lock
/// everybody out. `loadStaffActor` already refuses a non-active account, so
/// the session dies on its next request.
// ponytail: no reactivation control. A reactivated account would need a new
// gate code anyway (revoked is terminal); add one when somebody asks.
export async function deactivateStaffUser(
  actor: Actor,
  input: { staffUserId: string; reasonCode: string },
): Promise<DeactivateResult> {
  requirePermission(actor, 'users:manage', null)
  if (actor.kind !== 'staff') return { ok: false, reason: 'not_found' }
  if (input.staffUserId === actor.staffUserId) return { ok: false, reason: 'self' }

  const claimed = await prisma.staffUser.updateMany({
    where: { id: input.staffUserId, status: 'active', deletedAt: null },
    data: { status: 'suspended' },
  })
  if (claimed.count === 0) {
    const exists = await prisma.staffUser.findUnique({
      where: { id: input.staffUserId },
      select: { id: true },
    })
    return { ok: false, reason: exists ? 'already_inactive' : 'not_found' }
  }

  const gateCodesRevoked = await revokeStaffGateCodes(input.staffUserId)
  await recordAudit({
    actor: toAuditActor(actor),
    action: 'user.deactivated',
    entityType: 'StaffUser',
    entityId: input.staffUserId,
    reasonCode: input.reasonCode,
    context: { gateCodesRevoked },
  })
  return { ok: true, gateCodesRevoked }
}
