import { type AccessHolderType, type Prisma, prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { GrantCause } from '@storage/core/access'
import type { WeeklySchedule } from '@storage/core/facility-settings'
import { requirePermission } from '@/lib/rbac/authorize'
import { systemActor, type Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { endOfLocalDay } from './authorized-persons'
import { drainGateCommands, issueCredential, transitionGrant } from './service'

// PRD 03 US-10 (B-436). Gate codes for people who are not tenants: staff,
// vendors, and dated visitors such as an auction buyer.
//
// The holder is columns on `AccessGrant` rather than a model of its own, and
// everything after the grant row is the tenant's path: `transitionGrant`,
// `issueCredential`, the outbox and the adapter. A second way to put a working
// code on a gate is a second place for revocation to be wrong.

export type NonTenantHolderType = AccessHolderType

export type IssueNonTenantInput = {
  facilityId: string
  holderType: NonTenantHolderType
  /// Required for `vendor` and `temporary`. A `staff` code takes the staff
  /// user's own name.
  holderName?: string
  /// Required for `staff`.
  staffUserId?: string
  auctionCaseId?: string
  /// Narrowed against the facility's gate hours. Null is the facility's hours.
  accessHours?: WeeklySchedule | null
  /// Facility-local `YYYY-MM-DD`, the last day the code works, inclusive.
  /// Required for `temporary`.
  expiresOn?: string | null
}

export type IssueNonTenantRefusal =
  | 'name_required'
  | 'staff_required'
  | 'staff_not_active'
  | 'staff_has_code'
  | 'expiry_required'
  | 'expiry_in_past'

export type IssueNonTenantResult =
  | { ok: true; grantId: string; credentialId: string; code: string }
  | { ok: false; reason: IssueNonTenantRefusal }

export async function issueNonTenantCode(
  actor: Actor,
  input: IssueNonTenantInput,
): Promise<IssueNonTenantResult> {
  requirePermission(actor, 'access:manage_grants', input.facilityId)
  if (actor.kind !== 'staff') throw new Error('A non-tenant gate code is issued by staff')

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { timezone: true },
  })

  let holderName = input.holderName?.trim() ?? ''
  let staffUserId: string | null = null
  if (input.holderType === 'staff') {
    if (!input.staffUserId) return { ok: false, reason: 'staff_required' }
    const staff = await prisma.staffUser.findUnique({
      where: { id: input.staffUserId },
      select: { firstName: true, lastName: true, status: true, deletedAt: true },
    })
    if (!staff || staff.deletedAt !== null || staff.status !== 'active') {
      return { ok: false, reason: 'staff_not_active' }
    }
    // One live code per person per site. A second one is a code nobody
    // remembers is still working.
    const live = await prisma.accessGrant.findFirst({
      where: {
        facilityId: input.facilityId,
        staffUserId: input.staffUserId,
        state: { not: 'revoked' },
      },
      select: { id: true },
    })
    if (live) return { ok: false, reason: 'staff_has_code' }
    staffUserId = input.staffUserId
    holderName = `${staff.firstName} ${staff.lastName}`.trim()
  }
  if (!holderName) return { ok: false, reason: 'name_required' }

  if (input.holderType === 'temporary' && !input.expiresOn) {
    return { ok: false, reason: 'expiry_required' }
  }
  const expiresAt = input.expiresOn ? endOfLocalDay(input.expiresOn, facility.timezone) : null
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
    return { ok: false, reason: 'expiry_in_past' }
  }

  const cause: GrantCause = `staff:${input.holderType}_code_issued`
  const grant = await prisma.accessGrant.create({
    data: {
      facilityId: input.facilityId,
      holderType: input.holderType,
      holderName,
      staffUserId,
      auctionCaseId: input.auctionCaseId ?? null,
      accessHours: (input.accessHours ?? undefined) as Prisma.InputJsonValue | undefined,
      expiresAt,
      createdByStaffId: actor.staffUserId,
      state: 'pending',
      stateCause: cause,
    },
  })
  await transitionGrant(grant.id, 'active', cause)
  // `set_credential` carries the grant's window (adapter.ts), so no separate
  // `set_time_window` push is needed for a first credential.
  const credential = await issueCredential(grant.id, null)
  await drainGateCommands(new Date(), input.facilityId)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.granted',
    entityType: 'AccessGrant',
    entityId: grant.id,
    facilityId: input.facilityId,
    context: {
      holderType: input.holderType,
      holderName,
      staffUserId,
      auctionCaseId: input.auctionCaseId ?? null,
      expiresOn: input.expiresOn ?? null,
    },
  })

  return { ok: true, grantId: grant.id, credentialId: credential.credentialId, code: credential.code }
}

/// The one place a non-tenant grant is revoked. A person, the nightly sweep,
/// a staff deactivation and an auction cancellation all end here, so each
/// leaves the same command in the outbox and the same audit row.
async function revokeHeld(
  grant: { id: string; facilityId: string; holderType: AccessHolderType | null; holderName: string | null },
  actor: Actor,
  cause: GrantCause,
  reasonCode: string,
): Promise<boolean> {
  const moved = await transitionGrant(grant.id, 'revoked', cause)
  if (!moved.ok || !moved.changed) return false
  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.revoked',
    entityType: 'AccessGrant',
    entityId: grant.id,
    facilityId: grant.facilityId,
    reasonCode,
    context: { holderType: grant.holderType, holderName: grant.holderName },
  })
  return true
}

const HELD = { id: true, facilityId: true, holderType: true, holderName: true } as const

export type RevokeNonTenantResult = { ok: true } | { ok: false; reason: 'not_found' | 'already_revoked' }

export async function revokeNonTenantCode(
  actor: Actor,
  grantId: string,
  reasonCode: string,
): Promise<RevokeNonTenantResult> {
  const grant = await prisma.accessGrant.findFirst({
    where: { id: grantId, holderType: { not: null } },
    select: HELD,
  })
  if (!grant) return { ok: false, reason: 'not_found' }
  requirePermission(actor, 'access:manage_grants', grant.facilityId)

  const revoked = await revokeHeld(grant, actor, 'staff:non_tenant_code_revoked', reasonCode)
  if (!revoked) return { ok: false, reason: 'already_revoked' }
  await drainGateCommands(new Date(), grant.facilityId)
  return { ok: true }
}

async function revokeAll(
  where: Prisma.AccessGrantWhereInput,
  cause: GrantCause,
  reasonCode: string,
  at: Date,
): Promise<number> {
  const grants = await prisma.accessGrant.findMany({
    where: { ...where, holderType: { not: null }, state: { not: 'revoked' } },
    select: HELD,
  })
  let revoked = 0
  for (const grant of grants) {
    if (await revokeHeld(grant, systemActor('access.non-tenant-codes'), cause, reasonCode)) revoked += 1
  }
  // The cutoff is taken HERE, after the revokes are queued, and never earlier
  // than now: a command is due from the moment it was enqueued (B-158), so an
  // `at` captured by the caller before the loop would drain nothing and leave
  // the code working until the next cron tick.
  const cutoff = new Date(Math.max(at.getTime(), Date.now()))
  for (const facilityId of new Set(grants.map((grant) => grant.facilityId))) {
    await drainGateCommands(cutoff, facilityId)
  }
  return revoked
}

/// US-10 AC2. Called by the deactivation itself, so the keypad is told in the
/// same request rather than at the next sweep.
export async function revokeStaffGateCodes(staffUserId: string): Promise<number> {
  return revokeAll({ staffUserId }, 'system:staff_deactivated', 'staff_deactivated', new Date())
}

/// US-10 AC3. A cancelled sale has no buyer to let in.
export async function revokeAuctionBuyerCodes(auctionCaseId: string): Promise<number> {
  return revokeAll({ auctionCaseId }, 'system:auction_cancelled', 'auction_cancelled', new Date())
}

/// The nightly half, run with `access.expire-shared`. Revokes rather than
/// filters, for the reason `expireSharedAccess` gives: the keypad decides from
/// what it was last told.
///
/// The second and third passes repeat what `revokeStaffGateCodes` and
/// `revokeAuctionBuyerCodes` do at the time. They are here because a staff
/// user can also be suspended or soft-deleted straight in the database, and a
/// working gate code must not depend on which path somebody used.
export async function expireNonTenantCodes(
  at: Date,
  facilityId?: string,
): Promise<{ expired: number }> {
  const scope = facilityId ? { facilityId } : {}
  const dated = await revokeAll(
    { ...scope, expiresAt: { lte: at } },
    'system:non_tenant_code_expired',
    'non_tenant_code_expired',
    at,
  )
  const staff = await revokeAll(
    { ...scope, staffUser: { OR: [{ status: { not: 'active' } }, { deletedAt: { not: null } }] } },
    'system:staff_deactivated',
    'staff_deactivated',
    at,
  )
  const auction = await revokeAll(
    { ...scope, auctionCase: { status: 'cancelled' } },
    'system:auction_cancelled',
    'auction_cancelled',
    at,
  )
  return { expired: dated + staff + auction }
}

export type NonTenantCodeRow = {
  grantId: string
  holderType: NonTenantHolderType
  holderName: string
  /// True when the code was issued from an auction case.
  auctionBuyer: boolean
  accessHours: unknown
  expiresAt: Date | null
  createdAt: Date
}

/// The live staff, vendor and temporary codes at one facility.
export async function nonTenantCodes(actor: Actor, facilityId: string): Promise<NonTenantCodeRow[]> {
  requirePermission(actor, 'access:manage_grants', facilityId)
  const grants = await prisma.accessGrant.findMany({
    where: { facilityId, holderType: { not: null }, state: { not: 'revoked' } },
    orderBy: [{ holderType: 'asc' }, { holderName: 'asc' }],
    select: {
      id: true,
      holderType: true,
      holderName: true,
      auctionCaseId: true,
      accessHours: true,
      expiresAt: true,
      createdAt: true,
    },
  })
  return grants.map((grant) => ({
    grantId: grant.id,
    holderType: grant.holderType!,
    holderName: grant.holderName ?? '',
    auctionBuyer: grant.auctionCaseId !== null,
    accessHours: grant.accessHours,
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
  }))
}

/// Who can be picked for a `staff` code: active accounts assigned to this
/// facility or to every facility.
export async function staffForGateCodes(
  actor: Actor,
  facilityId: string,
): Promise<{ staffUserId: string; name: string }[]> {
  requirePermission(actor, 'access:manage_grants', facilityId)
  const staff = await prisma.staffUser.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      assignments: { some: { OR: [{ facilityId: null }, { facilityId }] } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  })
  return staff.map((row) => ({
    staffUserId: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
  }))
}
