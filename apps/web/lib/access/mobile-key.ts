import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { GrantState } from '@storage/core/access'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { SITE } from '@/lib/site-config'
import { accessCodeEncryptionKey, decryptCode } from './secret'
import { usesManualAdapter } from './manual-adapter'
import { drainGateCommands, issueCredential, revokeCredential } from './service'
import { pushGateHoursForGrant } from './time-windows'
import { evaluateKeypadEntry, simulatorConfigFor } from './simulator'

// PRD 03 US-8 AC1/AC4, OQ-2 (B-086 part 2). Phone unlock.
//
// **The transport is our server, not Bluetooth, and that is the answer to OQ-2
// rather than a shortcut** (D-121). Web Bluetooth does not exist on iOS — every
// browser there is WebKit, and WebKit has declined to ship it — so a BLE unlock
// written into this web app would work for some Android tenants and silently
// not exist for roughly half the people holding a lease. The vendors who do
// ship BLE (Nokē/Janus) do it from their own native app against their own
// locks, which is a partnership this project does not have and cannot
// simulate honestly (D-63). What every cloud gate API *does* expose, including
// the PTI driver already in this repo, is a server-side "open it now" — so the
// phone asks us, and we tell the controller.
//
// What that buys, and it is the reason to prefer it even with a partnership:
// it works on every phone with a browser, it needs no install, and the unlock
// is decided by the same grant state, the same schedule and the same
// suspension the keypad obeys, because it goes through the same credential.
//
// What it costs, stated because a tenant will hit it: a phone with no signal
// standing in front of the gate cannot unlock. The keypad and the tenant's PIN
// are the fallback and are never taken away — which is exactly why enrolling a
// phone must not disturb the PIN, and why `revokeCredential` exists.

/// A `mobile_key` is one credential on the tenant's own grant per facility —
/// the same grant their PIN hangs off, so delinquency suspension, gate hours,
/// revocation and reconciliation all reach it with no second code path (the
/// rule US-9 settled and B-105 re-applied).
export type MobileKey = {
  facilityId: string
  facilityName: string
  facilityPhone: string
  /// Null until the tenant enrols. The credential id, for the revoke form.
  credentialId: string | null
  enrolledAt: Date | null
  /// True when the tenant's access at this site is switched off — delinquency,
  /// almost always. Enrolling is still allowed; unlocking will be refused by
  /// the controller, which is the honest place for it to be refused.
  suspended: boolean
  /// A site whose keypad is driven by a person with a clipboard has no
  /// controller to ask, so there is nothing here to offer. Stated rather than
  /// hidden: a missing button is a support call.
  unavailableReason: string | null
}

const MANUAL_SITE_REASON =
  'This gate is opened at the keypad only. Call the office and we will let you in.'

/// No `ACCESS_CODE_ENCRYPTION_KEY` configured.
///
/// A PIN degrades honestly without one: `issueCredential` stores
/// `unrevealable:`, the controller still has the digits, and the tenant was
/// told them once at move-in. **A mobile key cannot.** Its secret has to be
/// read back on every single unlock, so an unenrollable environment would
/// otherwise hand a tenant a working-looking button attached to a credential
/// that can never open anything — the failure surfacing in a car park rather
/// than at the moment it was created.
const NO_KEY_REASON =
  'Phone unlock is not available on this site yet. Your gate code works at the keypad.'

function unlockConfigured(): boolean {
  return accessCodeEncryptionKey() !== null
}

export async function mobileKeysForTenant(tenantId: string): Promise<MobileKey[]> {
  const grants = await prisma.accessGrant.findMany({
    where: { tenantId, state: { in: ['pending', 'active', 'suspended'] } },
    select: {
      id: true,
      state: true,
      facilityId: true,
      facility: { select: { name: true, phone: true, gateAdapter: true } },
      credentials: {
        where: { type: 'mobile_key', state: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return grants.map((grant) => ({
    facilityId: grant.facilityId,
    facilityName: grant.facility.name,
    facilityPhone: grant.facility.phone ?? SITE.phone.display,
    credentialId: grant.credentials[0]?.id ?? null,
    enrolledAt: grant.credentials[0]?.createdAt ?? null,
    suspended: (grant.state as GrantState) === 'suspended',
    unavailableReason: !unlockConfigured()
      ? NO_KEY_REASON
      : grant.facility.gateAdapter === 'manual'
        ? MANUAL_SITE_REASON
        : null,
  }))
}

export class NoGrantError extends Error {
  constructor() {
    super('We could not find a unit for you at that facility.')
    this.name = 'NoGrantError'
  }
}

async function grantFor(tenantId: string, facilityId: string) {
  const grant = await prisma.accessGrant.findUnique({
    where: { facilityId_tenantId: { facilityId, tenantId } },
    select: { id: true, state: true },
  })
  // A revoked grant is a moved-out tenant. The history of why access ended is
  // evidence (see `transitionGrant`), and re-arming it from the portal would be
  // a way back through the gate that no staff member approved.
  if (!grant || (grant.state as GrantState) === 'revoked') throw new NoGrantError()
  return grant
}

export type EnrollResult = { ok: true; credentialId: string } | { ok: false; reason: string }

/// Turns phone unlock on for one tenant at one facility.
///
/// Idempotent on the credential, not on the request: a tenant who taps twice
/// gets one key back, because two live mobile keys on one grant is two things
/// to revoke when one phone is lost.
export async function enrollMobileKey(
  actor: Extract<Actor, { kind: 'tenant' }>,
  facilityId: string,
): Promise<EnrollResult> {
  if (!unlockConfigured()) return { ok: false, reason: NO_KEY_REASON }
  if (await usesManualAdapter(facilityId)) return { ok: false, reason: MANUAL_SITE_REASON }

  const grant = await grantFor(actor.tenantId, facilityId)

  const existing = await prisma.accessCredential.findFirst({
    where: { grantId: grant.id, type: 'mobile_key', state: 'active' },
    select: { id: true },
  })
  if (existing) return { ok: true, credentialId: existing.id }

  // `leaseId: null` on purpose. The credential belongs to the grant — one per
  // tenant per site (D-54) — and pinning it to whichever lease happened to be
  // first would make it look per-unit on every screen that joins through it.
  const credential = await issueCredential(grant.id, null, prisma, 'mobile_key')

  // Belt and braces beside the window `set_credential` now carries itself: if
  // this grant's schedule genuinely has not been pushed yet, this is what
  // pushes it, and if it has, the outbox dedupes this away.
  await pushGateHoursForGrant(grant.id)
  await drainGateCommands(new Date(), facilityId)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.granted',
    entityType: 'AccessCredential',
    entityId: credential.credentialId,
    facilityId,
    context: { type: 'mobile_key' },
  })

  return { ok: true, credentialId: credential.credentialId }
}

/// "I lost my phone." Stops the key and nothing else — the tenant's PIN is a
/// different credential on the same grant and keeps working, which is the
/// whole reason `revokeCredential` is credential-scoped.
export async function revokeMobileKey(
  actor: Extract<Actor, { kind: 'tenant' }>,
  facilityId: string,
): Promise<{ ok: boolean }> {
  const grant = await grantFor(actor.tenantId, facilityId)

  const credential = await prisma.accessCredential.findFirst({
    where: { grantId: grant.id, type: 'mobile_key', state: 'active' },
    select: { id: true },
  })
  if (!credential) return { ok: false }

  const result = await revokeCredential(credential.id, `tenant:${actor.tenantId}`)
  await drainGateCommands(new Date(), facilityId)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.revoked',
    entityType: 'AccessCredential',
    entityId: credential.id,
    facilityId,
    // US-38 wants a reason on `access.revoked`. The tenant switching off their
    // own phone IS the reason; a free-text box here would collect "because".
    reasonCode: 'tenant_request',
    context: { type: 'mobile_key' },
  })

  return result
}

export type UnlockOutcome = {
  opened: boolean
  /// One sentence a tenant standing at a gate can act on. Never a code, never
  /// a status word on its own — the failure state here is somebody outside in
  /// the dark.
  message: string
}

/// Opens the gate on the tenant's behalf.
///
/// Runs the tenant's own mobile-key secret through `evaluateKeypadEntry` — the
/// same function the virtual keypad calls — rather than a second "unlock"
/// path. That is the load-bearing choice: the delinquency suspension, the gate
/// hours the controller was last told about, the fault injection and the signed
/// webhook that writes the `AccessEvent` are all things this would otherwise
/// have had to reimplement and eventually disagree about. A phone unlock is
/// somebody presenting a credential at a gate; the only difference is that the
/// credential is not typed.
export async function unlockWithMobileKey(
  tenantId: string,
  facilityId: string,
): Promise<UnlockOutcome> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { phone: true },
  })
  const phone = facility?.phone ?? SITE.phone.display

  const grant = await prisma.accessGrant.findUnique({
    where: { facilityId_tenantId: { facilityId, tenantId } },
    select: { id: true },
  })
  const credential = grant
    ? await prisma.accessCredential.findFirst({
        where: { grantId: grant.id, type: 'mobile_key', state: 'active' },
        select: { valueRef: true },
      })
    : null

  if (!credential) {
    return { opened: false, message: `Phone unlock is not switched on for this gate. Set it up below, or call ${phone}.` }
  }

  const key = accessCodeEncryptionKey()
  let secret: string
  try {
    if (!key) throw new Error('no key')
    secret = decryptCode(credential.valueRef, key)
  } catch {
    // Degrade honestly rather than throwing a 500 at somebody in a car park.
    return { opened: false, message: `We could not open the gate from here. Use your gate code at the keypad, or call ${phone}.` }
  }

  // A keypad is standalone: a real one keeps deciding from its own memory
  // while the network is down, which is why `evaluateKeypadEntry` ignores the
  // offline fault. A REMOTE unlock is the opposite — it is the network — so
  // the same fault has to refuse here, or the one honest limitation of
  // choosing a server-side transport (D-121) is the one thing the simulation
  // hides.
  const config = await simulatorConfigFor(facilityId)
  if (config.offline) {
    return {
      opened: false,
      message: `We cannot reach this gate at the moment. Use your gate code at the keypad, or call ${phone}.`,
    }
  }

  const outcome = await evaluateKeypadEntry(facilityId, secret)

  if (outcome.result === 'granted') {
    return { opened: true, message: 'The gate is opening. It stays open for the usual few seconds.' }
  }

  switch (outcome.reason) {
    case 'outside_hours':
      return { opened: false, message: `The gate is closed right now. Call ${phone} if you need to get in outside the posted hours.` }
    case 'inactive':
      return { opened: false, message: `Your access is switched off. If there is a balance owing, paying it turns it back on — or call ${phone}.` }
    default:
      // `unknown_code`: the controller has never heard of this key. Almost
      // always a `set_credential` still sitting in the outbox because the gate
      // was offline when it was enrolled.
      return { opened: false, message: `The gate has not picked up your phone yet. Use your gate code at the keypad, or call ${phone}.` }
  }
}
