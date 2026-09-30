import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { GrantCause, GrantState } from '@storage/core/access'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { drainGateCommands, issueCredential, revokeCredential } from './service'
import { pushGateHoursForGrant } from './time-windows'

// PRD 03 US-1 AC "a tenant can replace their own code" (B-418).
//
// "Somebody knows my code" used to be a phone call and a database client.
// The tenant's PIN is one credential on their own grant, so replacing it is
// `revokeCredential` plus `issueCredential` on that grant — the same two calls
// the mobile key uses, in that order, and nothing else on the grant moves:
// authorized persons keep their codes, a phone key keeps working, and the
// grant's state (suspended for a balance, say) is untouched, so the new code
// is exactly as usable as the old one was.

export class NoActiveCodeError extends Error {
  constructor() {
    super('We could not find a gate code for you at that facility.')
    this.name = 'NoActiveCodeError'
  }
}

export type ReplacedCode = { credentialId: string; code: string }

/// Revokes every active PIN on the tenant's grant at `facilityId` and issues
/// one new one. A tenant may only replace their own; staff need
/// `access:manage_grants` there. One audit row either way.
export async function replaceGateCode(
  actor: Actor,
  tenantId: string,
  facilityId: string,
): Promise<ReplacedCode> {
  let cause: GrantCause
  if (actor.kind === 'tenant') {
    if (actor.tenantId !== tenantId) throw new NoActiveCodeError()
    cause = `tenant:${actor.tenantId}`
  } else {
    requirePermission(actor, 'access:manage_grants', facilityId)
    cause = `staff:${actor.kind === 'staff' ? actor.staffUserId : actor.label}`
  }

  const grant = await prisma.accessGrant.findUnique({
    where: { facilityId_tenantId: { facilityId, tenantId } },
    select: { id: true, state: true },
  })
  // A revoked grant is a moved-out tenant; minting a code on it would be a
  // way back through the gate nobody approved.
  if (!grant || (grant.state as GrantState) === 'revoked') throw new NoActiveCodeError()

  // Revoke and issue in one transaction: a failure between the two would
  // leave a tenant with no code at all, which is worse than the leak they
  // came here about.
  const issued = await prisma.$transaction(async (tx) => {
    const old = await tx.accessCredential.findMany({
      where: { grantId: grant.id, type: 'pin', state: 'active' },
      select: { id: true, leaseId: true },
    })
    if (old.length === 0) throw new NoActiveCodeError()
    for (const credential of old) await revokeCredential(credential.id, cause, tx)
    return issueCredential(grant.id, old[0].leaseId, tx)
  })

  // Same as move-in: the controller has not been told this credential's hours
  // yet, and the outbox dedupes the push if it has nothing new to say.
  await pushGateHoursForGrant(grant.id)
  await drainGateCommands(new Date(), facilityId)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.code_replaced',
    entityType: 'AccessCredential',
    entityId: issued.credentialId,
    facilityId,
    reasonCode: actor.kind === 'tenant' ? 'tenant_request' : undefined,
    context: { tenantId },
  })

  return issued
}
