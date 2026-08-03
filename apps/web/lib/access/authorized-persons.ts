import { type Prisma, prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { WeeklySchedule } from '@storage/core/facility-settings'
import type { GrantCause } from '@storage/core/access'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { drainGateCommands, ensureGrantForHolder, issueCredential, transitionGrant } from './service'

// PRD 03 US-9. The authorized-access list: named people on a lease, each with
// their own individually-revocable credential — never a copy of the tenant's
// code (FR-1). Staff-managed at MVP (AC4); the admin screen that calls this
// is B-038's, the same split B-096 used for lease holds.

export class AuthorizedAccessCapError extends Error {
  readonly cap: number

  constructor(cap: number) {
    super(`This lease already has ${cap} authorized people, the facility's cap.`)
    this.name = 'AuthorizedAccessCapError'
    this.cap = cap
  }
}

export type CreateAuthorizedPersonInput = {
  name: string
  phone: string
  relationship: string
  /// AC1: optional. Nothing enforces it yet — gate-hours enforcement
  /// including per-grant overrides is FR-5 / B-064's — it is captured and
  /// unread until that item exists.
  accessHours?: WeeklySchedule | null
}

export type CreatedAuthorizedPerson = { personId: string; credentialId: string; code: string }

function requireStaffActor(actor: Actor): string {
  if (actor.kind !== 'staff') {
    throw new Error('Authorized-access people are staff-managed at MVP (US-9 AC4)')
  }
  return actor.staffUserId
}

/// Adds a person to a lease's authorized-access list and issues their
/// credential immediately — the same "hand it over now" expectation move-in
/// provisioning has, not a pending state waiting on a later step.
export async function createAuthorizedPerson(
  actor: Actor,
  leaseId: string,
  input: CreateAuthorizedPersonInput,
): Promise<CreatedAuthorizedPerson> {
  const staffUserId = requireStaffActor(actor)
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: { facilityId: true, facility: { select: { authorizedAccessCap: true } } },
  })
  requirePermission(actor, 'access:manage_grants', lease.facilityId)

  const activeCount = await prisma.authorizedAccessPerson.count({ where: { leaseId, active: true } })
  if (activeCount >= lease.facility.authorizedAccessCap) {
    throw new AuthorizedAccessCapError(lease.facility.authorizedAccessCap)
  }

  const person = await prisma.authorizedAccessPerson.create({
    data: {
      facilityId: lease.facilityId,
      leaseId,
      name: input.name,
      phone: input.phone,
      relationship: input.relationship,
      accessHours: (input.accessHours ?? undefined) as Prisma.InputJsonValue | undefined,
      createdByStaffId: staffUserId,
    },
  })

  const grant = await ensureGrantForHolder(
    lease.facilityId,
    { authorizedPersonId: person.id },
    'staff:authorized_person_added',
  )
  await transitionGrant(grant.grantId, 'active', 'staff:authorized_person_added')
  const credential = await issueCredential(grant.grantId, leaseId)
  await drainGateCommands(new Date(), lease.facilityId)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.granted',
    entityType: 'AuthorizedAccessPerson',
    entityId: person.id,
    facilityId: lease.facilityId,
    context: { leaseId, name: input.name, relationship: input.relationship },
  })

  return { personId: person.id, credentialId: credential.credentialId, code: credential.code }
}

export type RevokeResult = { ok: true } | { ok: false; reason: 'not_found' | 'already_revoked' }

/// AC5: individually revocable — revoking one person never touches the
/// tenant's own access or anyone else on the same lease.
export async function revokeAuthorizedPerson(
  actor: Actor,
  personId: string,
  reasonCode: string,
): Promise<RevokeResult> {
  const staffUserId = requireStaffActor(actor)
  const person = await prisma.authorizedAccessPerson.findUnique({
    where: { id: personId },
    select: { id: true, facilityId: true, leaseId: true, active: true, grant: { select: { id: true } } },
  })
  if (!person) return { ok: false, reason: 'not_found' }
  requirePermission(actor, 'access:manage_grants', person.facilityId)
  if (!person.active) return { ok: false, reason: 'already_revoked' }

  await prisma.authorizedAccessPerson.update({
    where: { id: personId },
    data: { active: false, revokedAt: new Date(), revokedByStaffId: staffUserId },
  })
  if (person.grant) {
    await transitionGrant(person.grant.id, 'revoked', 'staff:authorized_person_removed')
  }

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.revoked',
    entityType: 'AuthorizedAccessPerson',
    entityId: personId,
    facilityId: person.facilityId,
    reasonCode,
    context: { leaseId: person.leaseId },
  })

  return { ok: true }
}

/// The lease-suspension cascade (AC-implied "suspended with the lease"): a
/// seam, not yet wired to a caller. Nothing suspends a tenant's own grant for
/// delinquency yet either — that lands with the delinquency steps — so this
/// exists for that future caller to invoke alongside the tenant's own
/// transition, the same "built ahead of its trigger" posture B-026 took with
/// downstream comms before B-030 existed.
export async function cascadeAuthorizedAccess(
  leaseId: string,
  to: 'suspended' | 'active' | 'revoked',
  cause: GrantCause,
): Promise<void> {
  const people = await prisma.authorizedAccessPerson.findMany({
    where: { leaseId, active: true },
    select: { grant: { select: { id: true } } },
  })
  for (const person of people) {
    if (person.grant) await transitionGrant(person.grant.id, to, cause)
  }
}
