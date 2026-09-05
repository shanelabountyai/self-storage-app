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

  const grant = await ensureGrant(lease.facilityId, lease.tenantId, 'system:move_in')
  await transitionGrant(grant.grantId, 'active', 'system:move_in')

  // D-54. The idempotency check is on the GRANT, not on the lease.
  //
  // It used to ask "does this LEASE have a credential", which made a
  // three-unit checkout mint three PINs — and the grant is keyed
  // `(facilityId, tenantId)`, so all three opened the same gate with the same
  // permissions and the same hours. Three codes for one door is not a smaller
  // version of per-unit access; it is three times as much for a tenant to leak
  // and for staff to revoke, for no door it can distinguish.
  //
  // Kept AFTER `transitionGrant` deliberately: a tenant whose access was
  // suspended and who is now renting another unit must have the grant
  // reactivated whether or not a credential already exists, which is what the
  // per-lease version did too. Only the minting changes.
  //
  // B-086 part 2: scoped to `pin`. A tenant who enrolled phone unlock holds a
  // second active credential on this grant, and without the filter their next
  // move-in would read as already provisioned and mint no gate code at all —
  // a renter handed a phone button and no digits for the keypad.
  const existing = await prisma.accessCredential.findFirst({
    where: { grantId: grant.grantId, state: 'active', type: 'pin' },
    select: { id: true, grantId: true },
  })
  if (existing) return { ok: true, grantId: existing.grantId, alreadyProvisioned: true }

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

  // D-54. The code is the tenant's, not the lease's, so this resolves through
  // the lease to the tenant's grant rather than matching on `leaseId`.
  //
  // The credential still RECORDS the lease that first caused it to exist, and
  // a per-lease match still finds it — but only for that one lease. A tenant
  // renting a second unit would have seen "your gate code will be texted to
  // you" on the portal card for a unit whose code was already in their hand,
  // for a code that opens the same gate. The lease is the way in to the
  // tenant; the grant is what actually holds the credential.
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { facilityId: true, tenantId: true },
  })
  if (!lease) return null

  // B-086 part 2: `type: 'pin'` is load-bearing, not defensive. A `mobile_key`
  // is a newer active credential on the same grant, so `createdAt desc` would
  // hand the portal a 43-character token and render it as the tenant's gate
  // code — unusable at the keypad, and a working credential splashed across a
  // screen for no reason.
  const credential = await prisma.accessCredential.findFirst({
    where: {
      state: 'active',
      type: 'pin',
      grant: { facilityId: lease.facilityId, tenantId: lease.tenantId },
    },
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
