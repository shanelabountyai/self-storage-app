import { prisma } from '@storage/db'
import { ensureGrant, issueCredential, transitionGrant, drainGateCommands } from './service'

// PRD 01 FR-4.5 / PRD 03 US-1. Giving a new tenant a way through the gate.

export type AccessProvisionResult =
  | { ok: true; grantId: string; credentialId: string; code: string }
  | { ok: true; grantId: string; alreadyProvisioned: true }
  | { ok: false; reason: 'lease_not_found' }

/// Grants access for a lease and issues its gate code.
///
/// Idempotent: a redelivered `lease.moved_in` must not mint a second code for
/// the same lease. A tenant who already holds an active credential here has
/// been provisioned, and re-running returns rather than issuing again.
export async function provisionAccessForLease(leaseId: string): Promise<AccessProvisionResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { id: true, facilityId: true, tenantId: true },
  })
  if (!lease) return { ok: false, reason: 'lease_not_found' }

  const existing = await prisma.accessCredential.findFirst({
    where: { leaseId, state: 'active' },
    select: { id: true, grantId: true },
  })
  if (existing) return { ok: true, grantId: existing.grantId, alreadyProvisioned: true }

  const grant = await ensureGrant(lease.facilityId, lease.tenantId, 'system:move_in')
  await transitionGrant(grant.grantId, 'active', 'system:move_in')
  const credential = await issueCredential(grant.grantId, leaseId)

  // Try immediately rather than waiting for the scheduled drain — US-501 wants
  // the code in the renter's hand at the end of checkout, and the queue is the
  // fallback for when that does not work, not the normal path.
  await drainGateCommands(new Date(), lease.facilityId)

  return {
    ok: true,
    grantId: grant.grantId,
    credentialId: credential.credentialId,
    code: credential.code,
  }
}
