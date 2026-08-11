import { prisma } from '@storage/db'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { resetMfaForStaff } from '@/lib/auth/mfa'

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
