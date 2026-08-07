import { prisma } from '@storage/db'
import { ensureGrant, issueCredential, transitionGrant, drainGateCommands } from './service'
import { accessCodeEncryptionKey, decryptCode } from './secret'
import { pushGateHoursForGrant } from './time-windows'

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

  // PRD 03 US-4. Push the facility's gate hours to this grant now. Without it a
  // tenant who moved in on Tuesday would have unrestricted access until the
  // next time somebody happened to save the settings form — the controller
  // enforces the window it was told about, and it has not been told anything
  // about this credential yet.
  await pushGateHoursForGrant(grant.grantId)

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

/// US-501 step 7: the confirmation page's own read of the code it just had
/// issued for it. Distinct from `revealCode()` in service.ts — that is staff
/// auditing someone else's code; this is the renter reading the one just made
/// for them, gated by the checkout token that already controls the whole
/// page rather than a staff permission. Null whenever there is nothing to
/// show (no key configured, no credential yet) — the page falls back to the
/// "texted within 15 minutes" copy either way.
export async function codeForLease(leaseId: string): Promise<string | null> {
  const key = accessCodeEncryptionKey()
  if (!key) return null

  const credential = await prisma.accessCredential.findFirst({
    where: { leaseId, state: 'active' },
    orderBy: { createdAt: 'desc' },
    select: { valueRef: true },
  })
  if (!credential) return null

  try {
    return decryptCode(credential.valueRef, key)
  } catch {
    return null
  }
}
