import { prisma } from '@storage/db'
import { opensGate, type GrantState } from '@storage/core/access'
import type {
  AdapterResult,
  ControllerEntry,
  ControllerSnapshot,
  GateAdapter,
  GateCommandInput,
} from '../adapter'
import {
  assignTimeZone,
  deleteKeypadUser,
  listKeypadUsers,
  pinHash,
  PTI_TIME_ZONE_ALWAYS,
  PTI_TIME_ZONE_SITE_HOURS,
  setUserStatus,
  upsertKeypadUser,
  type PtiResponse,
} from './pti-emulator'

// PRD 03 §8 Phase 2 / D-18 (B-080). THE ONE vendor stub.
//
// This is our DRIVER; `pti-emulator.ts` is the fake vendor it drives. The split
// matters: everything ugly below is ugly because the vendor's shape and our
// port's shape genuinely differ, and that friction is the entire thing D-18
// kept this item for. A second stub would reproduce the friction, not teach
// anything new about it.
//
// What the port survived, and what it did not:
//
//   1. `suspend_access` / `resume_access` map to one vendor call each — fine.
//   2. `set_credential` maps to a call that sets the PIN *and* the status *and*
//      the time zone together, so the driver has to know the grant state to
//      send a code at all. It reads that from our own database, which is a
//      thing an adapter would rather not do; the alternative is sending a code
//      that silently enables a suspended tenant.
//   3. `revoke_access` deletes rather than disabling, because the vendor has no
//      "revoked" state. That makes revocation lossy on the vendor side and is
//      why reconciliation reports a revoked credential the controller has
//      forgotten as fine rather than as drift.
//   4. `set_time_window` collapses a weekly schedule into a NUMBER (1 = always,
//      2 = site hours). The vendor cannot express an arbitrary schedule, so the
//      driver cannot promise our schedule reached the gate — only which of the
//      vendor's two windows is in force. Reconciliation compares that
//      faithfully rather than pretending.
//
// Point 4 is the real finding, and it is worth stating plainly: our port lets a
// caller push any weekly schedule, and a real vendor may simply not have that
// shape. The port did not need changing — the adapter degrades honestly and the
// window fingerprint tells the truth about what the gate is enforcing — but a
// future driver author should expect this rather than discover it.

const VENDOR_TIME_ZONE_FINGERPRINT = `sched:${JSON.stringify({ ptiTimeZone: PTI_TIME_ZONE_SITE_HOURS })}`

/// Vendor status codes → the port's retryable/not decision.
///
/// The mapping IS the driver's job. 429 and 5xx are the controller having a bad
/// day and will succeed on retry; 400 and 404 will fail identically forever and
/// retrying them only delays the staff alert that is the actual fix.
function resultFrom(response: PtiResponse<unknown>): AdapterResult {
  if (response.status === 200) return { ok: true }
  if (response.status === 429 || response.status >= 500) {
    return { ok: false, retryable: true, message: `PTI ${response.status}: ${response.error}` }
  }
  return { ok: false, retryable: false, message: `PTI ${response.status}: ${response.error}` }
}

async function send(command: GateCommandInput): Promise<AdapterResult> {
  const siteId = command.facilityId

  switch (command.type) {
    case 'set_credential': {
      const pin = command.payload.code
      if (typeof pin !== 'string' || !command.credentialId) {
        return { ok: false, retryable: false, message: 'set_credential requires a credentialId and a code' }
      }

      // See note 2 above. The vendor sets PIN and status in one call, so a code
      // pushed without knowing the grant state would silently re-enable a
      // suspended tenant the moment their code was rotated.
      const credential = await prisma.accessCredential.findUnique({
        where: { id: command.credentialId },
        select: { grant: { select: { state: true, extendedHours: true } } },
      })
      if (!credential) return { ok: false, retryable: false, message: 'Unknown credential' }

      return resultFrom(
        await upsertKeypadUser({
          siteId,
          externalRef: command.credentialId,
          pin,
          status: opensGate(credential.grant.state as GrantState) ? 'enabled' : 'disabled',
          timeZoneId: credential.grant.extendedHours ? PTI_TIME_ZONE_ALWAYS : PTI_TIME_ZONE_SITE_HOURS,
        }),
      )
    }

    case 'grant_access':
    case 'resume_access':
    case 'suspend_access': {
      if (!command.grantId) {
        return { ok: false, retryable: false, message: `${command.type} requires a grantId` }
      }
      const enable = command.type !== 'suspend_access'
      const credentials = await prisma.accessCredential.findMany({
        where: { grantId: command.grantId },
        select: { id: true },
      })
      // Same as the simulator: nothing to flip yet is not a failure, because
      // `grant_access` is issued before a credential necessarily exists.
      for (const credential of credentials) {
        const response = await setUserStatus({
          siteId,
          externalRef: credential.id,
          status: enable ? 'enabled' : 'disabled',
        })
        // A 404 here means the vendor has no such user — which for an enable is
        // a real problem worth surfacing, and for a disable is the outcome we
        // wanted. Not treating those differently is how a revoke gets
        // dead-lettered for succeeding.
        if (response.status === 404 && !enable) continue
        if (response.status !== 200) return resultFrom(response)
      }
      return { ok: true }
    }

    case 'revoke_access': {
      if (!command.grantId) {
        return { ok: false, retryable: false, message: 'revoke_access requires a grantId' }
      }
      const credentials = await prisma.accessCredential.findMany({
        where: { grantId: command.grantId },
        select: { id: true },
      })
      for (const credential of credentials) {
        // See note 3: the vendor has no "revoked", so this deletes.
        const response = await deleteKeypadUser({ siteId, externalRef: credential.id })
        if (response.status !== 200) return resultFrom(response)
      }
      return { ok: true }
    }

    case 'set_time_window': {
      if (!command.grantId) {
        return { ok: false, retryable: false, message: 'set_time_window requires a grantId' }
      }
      const credentials = await prisma.accessCredential.findMany({
        where: { grantId: command.grantId },
        select: { id: true },
      })
      // See note 4. The schedule itself cannot be expressed; all the vendor
      // offers is "always" or "the site hours configured in the vendor portal".
      const timeZoneId =
        command.payload.extendedHours === true ? PTI_TIME_ZONE_ALWAYS : PTI_TIME_ZONE_SITE_HOURS

      for (const credential of credentials) {
        const response = await assignTimeZone({ siteId, externalRef: credential.id, timeZoneId })
        if (response.status === 404) continue
        if (response.status !== 200) return resultFrom(response)
      }
      return { ok: true }
    }

    default:
      return { ok: false, retryable: false, message: `Unhandled command type: ${command.type}` }
  }
}

async function snapshot(facilityId: string): Promise<ControllerSnapshot> {
  const known = new Set(
    (
      await prisma.accessCredential.findMany({ where: { facilityId }, select: { id: true } })
    ).map((credential) => credential.id),
  )

  const entries: ControllerEntry[] = []
  let cursor: string | undefined

  // Paged, because the vendor's list endpoint is. A driver that read the first
  // page and stopped would report every credential past the first fifty as
  // missing from the controller, which is a drift report that cries wolf at
  // exactly the sites big enough to need one.
  do {
    const response = await listKeypadUsers({ siteId: facilityId, cursor })
    if (response.status !== 200) {
      return { verifiable: false, reason: `PTI ${response.status}: ${response.error}` }
    }
    for (const user of response.body.users) {
      entries.push({
        credentialId: known.has(user.externalRef) ? user.externalRef : null,
        externalId: user.ptiUserId,
        codeHash: pinHash(user.pin),
        opens: user.status === 'enabled',
        windowFingerprint:
          user.timeZoneId === PTI_TIME_ZONE_ALWAYS ? 'exempt' : VENDOR_TIME_ZONE_FINGERPRINT,
      })
    }
    cursor = response.body.nextCursor ?? undefined
  } while (cursor)

  return { verifiable: true, entries }
}

export const ptiCloudAdapter: GateAdapter = {
  name: 'pti_cloud',
  send,
  snapshot,
}

/// What our side thinks the window should be, in the vendor's terms.
///
/// Exported because reconciliation has to compare like with like: our
/// `AccessGrant` carries a weekly schedule and a boolean, and this facility's
/// controller can only be in one of two states. Comparing our schedule against
/// the vendor's number would report drift on every credential at every
/// PTI site, forever.
export function ptiExpectedWindowFingerprint(extendedHours: boolean): string {
  return extendedHours ? 'exempt' : VENDOR_TIME_ZONE_FINGERPRINT
}
