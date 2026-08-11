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
// code (FR-1). The admin screen that calls this is B-038's, the same split
// B-096 used for lease holds.
//
// B-105 opened it to tenants, which AC4 always intended: "the list is
// staff-managed at MVP... tenant self-service from the portal is Phase 2 and
// inherits the same cap." Both actors run through the functions below rather
// than the portal getting its own copy — a second way to put a working code on
// a gate is a second place for the cap, the audit entry and the suspension
// state to be wrong.

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

/// Who is asking, and whether they may touch this lease.
///
/// Staff need `access:manage_grants` at the facility; a tenant needs only to
/// own the lease. Returned as a discriminated pair so every write below records
/// WHICH kind of actor did it — AC1 asks for "the actor who changed it", and
/// after a theft claim "the tenant added their own brother" and "a manager
/// added somebody at the counter" are different answers.
type ActingParty = { staffUserId: string; tenantId: null } | { staffUserId: null; tenantId: string }

export class NotYourLeaseError extends Error {
  constructor() {
    super('That unit is not on your account.')
    this.name = 'NotYourLeaseError'
  }
}

async function actingParty(actor: Actor, leaseId: string, facilityId: string): Promise<ActingParty> {
  if (actor.kind === 'staff') {
    requirePermission(actor, 'access:manage_grants', facilityId)
    return { staffUserId: actor.staffUserId, tenantId: null }
  }

  // The `system` actor has no business on this list: every path that reaches
  // here is a person deciding who may walk through a gate.
  if (actor.kind !== 'tenant') throw new NotYourLeaseError()

  // A lease id in a portal form. Checked here rather than at the screen so
  // there is exactly one place that decides it, shared by every caller.
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { tenantId: true },
  })
  if (lease?.tenantId !== actor.tenantId) throw new NotYourLeaseError()
  return { staffUserId: null, tenantId: actor.tenantId }
}

/// Adds a person to a lease's authorized-access list and issues their
/// credential immediately — the same "hand it over now" expectation move-in
/// provisioning has, not a pending state waiting on a later step.
export async function createAuthorizedPerson(
  actor: Actor,
  leaseId: string,
  input: CreateAuthorizedPersonInput,
): Promise<CreatedAuthorizedPerson> {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: {
      facilityId: true,
      tenantId: true,
      facility: { select: { authorizedAccessCap: true } },
    },
  })
  const party: ActingParty = await actingParty(actor, leaseId, lease.facilityId)

  // AC4: tenant self-service "inherits the same cap". One check for both
  // actors, which is most of why they share this function.
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
      createdByStaffId: party.staffUserId,
      createdByTenantId: party.tenantId,
    },
  })

  const cause: GrantCause = party.tenantId
    ? 'tenant:authorized_person_added'
    : 'staff:authorized_person_added'

  const grant = await ensureGrantForHolder(
    lease.facilityId,
    { authorizedPersonId: person.id },
    cause,
  )

  // B-105. A person added while the TENANT'S own access is suspended starts
  // suspended too, rather than active.
  //
  // Without this, a delinquent tenant locked out under D-16 could add their
  // brother from the portal and be back in the building ten minutes later with
  // a code the system issued — and the same hole exists for a manager doing it
  // at the counter. The credential is still created and still belongs to that
  // person, so it comes up on its own when the balance clears and the cascade
  // restores the lease.
  const tenantGrant = lease.tenantId
    ? await prisma.accessGrant.findUnique({
        where: { facilityId_tenantId: { facilityId: lease.facilityId, tenantId: lease.tenantId } },
        select: { state: true },
      })
    : null
  const startSuspended = tenantGrant?.state === 'suspended'

  // Always through `active` first. The state machine is
  // `pending → active ⇄ suspended` (FR-1), so `pending → suspended` is not a
  // legal edge — and `transitionGrant` REFUSES rather than throwing, which
  // means getting this wrong leaves the grant sitting in `pending` with no
  // error anywhere and a credential nobody notices does not work.
  await transitionGrant(grant.grantId, 'active', cause)
  if (startSuspended) {
    await transitionGrant(grant.grantId, 'suspended', 'system:delinquency')
  }
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
  const person = await prisma.authorizedAccessPerson.findUnique({
    where: { id: personId },
    select: { id: true, facilityId: true, leaseId: true, active: true, grant: { select: { id: true } } },
  })
  if (!person) return { ok: false, reason: 'not_found' }

  const party = await actingParty(actor, person.leaseId, person.facilityId)
  if (!person.active) return { ok: false, reason: 'already_revoked' }

  await prisma.authorizedAccessPerson.update({
    where: { id: personId },
    data: {
      active: false,
      revokedAt: new Date(),
      revokedByStaffId: party.staffUserId,
      revokedByTenantId: party.tenantId,
    },
  })
  if (person.grant) {
    // A tenant may revoke somebody a MANAGER added, deliberately. It is their
    // unit; the point of the list is that the tenant controls who gets in, and
    // making them ring the office to withdraw access is how a person keeps
    // access they should not have over a weekend.
    await transitionGrant(
      person.grant.id,
      'revoked',
      party.tenantId ? 'tenant:authorized_person_removed' : 'staff:authorized_person_removed',
    )
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
