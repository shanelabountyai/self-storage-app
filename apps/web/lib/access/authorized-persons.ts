import { type Prisma, prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { WeeklySchedule } from '@storage/core/facility-settings'
import type { GrantCause } from '@storage/core/access'
import { zonedMidnight } from '@storage/core/jobs'
import { requirePermission } from '@/lib/rbac/authorize'
import { systemActor, type Actor } from '@/lib/rbac/actor'
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

export class ExpiryInThePastError extends Error {
  constructor() {
    super('Pick a date in the future — their code has to work for at least today.')
    this.name = 'ExpiryInThePastError'
  }
}

/// The instant a facility-local calendar day ENDS: local midnight beginning the
/// following day. "Until the 14th" includes the 14th, which is what a person
/// filling in a date field means and what `access.expire-shared`'s hour-0 sweep
/// then matches exactly.
function endOfLocalDay(isoDate: string, timezone: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return zonedMidnight(year, month, day + 1, timezone)
}

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
  /// AC1: optional. Enforced from B-086 — narrowed against the facility's own
  /// gate hours and pushed to the controller by `scheduleForGrant`. Before that
  /// it was written and read by nothing, so a manager who set "weekends only"
  /// had configured precisely nothing.
  accessHours?: WeeklySchedule | null
  /// US-8 AC1's time-boxing, as a facility-local calendar date (`YYYY-MM-DD`)
  /// — the last day this person may enter, inclusive. Null means "until
  /// somebody withdraws it", which is what the counter case usually wants and
  /// what every row predating B-086 is.
  ///
  /// A date rather than an instant because that is the promise a portal makes;
  /// it is resolved here to the local midnight that ENDS it, so the stored
  /// value and `access.expire-shared`'s hour-0 sweep are the same moment.
  expiresOn?: string | null
}

export type CreatedAuthorizedPerson = { personId: string; credentialId: string; code: string }

/// Who is asking, and whether they may touch this lease.
///
/// Staff need `access:manage_grants` at the facility; a tenant needs only to
/// own the lease. Returned as a discriminated pair so every write below records
/// WHICH kind of actor did it — AC1 asks for "the actor who changed it", and
/// after a theft claim "the tenant added their own brother" and "a manager
/// added somebody at the counter" are different answers.
type ActingParty =
  | { staffUserId: string; tenantId: null }
  | { staffUserId: null; tenantId: string }
  /// B-086. The expiry sweep, which revokes on a date the tenant chose earlier.
  /// It goes through the same function a person does rather than getting its
  /// own copy — a second way to stop a gate code working is a second place for
  /// the grant transition and the audit entry to be wrong.
  | { staffUserId: null; tenantId: null }

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

  // B-086: `system` is admitted for exactly one caller, the expiry sweep, and
  // it is admitted with no lease check because there is no session to check it
  // against — the authority is the `expiresAt` the tenant set. Every other
  // path that reaches here is a person deciding who may walk through a gate,
  // and creation refuses `system` outright below.
  if (actor.kind === 'system') return { staffUserId: null, tenantId: null }
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
  // The sweep revokes; it never adds. Refused here rather than relying on
  // `actingParty`, which admits `system` for that one caller.
  if (actor.kind === 'system') throw new NotYourLeaseError()

  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: {
      facilityId: true,
      tenantId: true,
      facility: { select: { authorizedAccessCap: true, timezone: true } },
    },
  })
  const party: ActingParty = await actingParty(actor, leaseId, lease.facilityId)
  const expiresAt = input.expiresOn
    ? endOfLocalDay(input.expiresOn, lease.facility.timezone)
    : null
  // A date already past would issue a working code and revoke it on the next
  // sweep — a code handed out that stops within hours, which reads as a broken
  // gate rather than as the form having accepted something it should not have.
  if (expiresAt && expiresAt <= new Date()) throw new ExpiryInThePastError()

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
      expiresAt,
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
    context: {
      leaseId,
      name: input.name,
      relationship: input.relationship,
      expiresOn: input.expiresOn ?? null,
    },
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
    // Three causes, not two (B-086). A system revoke is the expiry sweep, and
    // labelling it `staff:` — which the old two-way ternary did for anything
    // without a tenantId — would put a manager's name on a gate log entry
    // nobody was present for.
    const cause: GrantCause = party.tenantId
      ? 'tenant:authorized_person_removed'
      : party.staffUserId
        ? 'staff:authorized_person_removed'
        : 'system:shared_access_expired'
    await transitionGrant(person.grant.id, 'revoked', cause)
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

/// PRD 03 US-8 AC1 (B-086). The time-boxed half: revokes every shared-access
/// person whose date has passed, at the facility whose local day has just
/// turned over.
///
/// **Revokes rather than filters, and that is the whole point.** A keypad
/// decides from the codes it was last told about — it does not stop working
/// because our server is down, and a real standalone controller does not ask
/// us anything at entry time. So an expired person we merely hide from our own
/// reads still opens the gate. Going through `revokeAuthorizedPerson` puts the
/// revoke command in the outbox, which is what eventually reaches the
/// hardware.
///
/// Idempotent: `revokeAuthorizedPerson` returns `already_revoked` rather than
/// throwing, so a catch-up run over missed business dates is a no-op per row.
export async function expireSharedAccess(
  at: Date,
  facilityId?: string,
): Promise<{ expired: number }> {
  const due = await prisma.authorizedAccessPerson.findMany({
    where: { active: true, expiresAt: { lte: at }, ...(facilityId ? { facilityId } : {}) },
    select: { id: true, facilityId: true },
  })

  let expired = 0
  for (const person of due) {
    const result = await revokeAuthorizedPerson(
      systemActor('access.expire-shared'),
      person.id,
      'shared_access_expired',
    )
    if (result.ok) expired += 1
  }

  // One drain per facility rather than per person: the outbox is FIFO per
  // facility (FR-3) and draining inside the loop would be N passes over the
  // same queue.
  for (const id of new Set(due.map((person) => person.facilityId))) {
    await drainGateCommands(at, id)
  }

  return { expired }
}
