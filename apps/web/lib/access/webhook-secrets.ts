import { randomBytes } from 'node:crypto'
import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { accessCodeEncryptionKey, decryptCode, encryptCode } from './secret'
import { hardwareWebhookSecret } from './webhook-signature'

// PRD 03 SR-4 (B-080): "HMAC signature verification, timestamp tolerance
// (±5 min), nonce replay cache, per-facility secrets, rotation without
// downtime (dual-secret window)."
//
// The first two shipped with B-028. This is the last two.
//
// Why rotation needs two secrets at once: a vendor cannot change its signing
// key at the same instant we change ours. There is always a window — minutes,
// sometimes hours while somebody pastes a value into a vendor portal — where
// messages signed with either key are in flight. A single-secret rotation drops
// every gate event sent during that window, and gate events are the record of
// who came through the door. So rotation issues a NEW active secret and leaves
// the previous one accepted until `retiresAt`.
//
// Per facility, per SR-1: "per-facility scoping so one leaked credential
// exposes one site."

/// How long a superseded secret keeps being accepted. Long enough for somebody
/// to update a vendor portal during a working day; short enough that a leaked
/// key is not honoured for a week.
export const ROTATION_GRACE_HOURS = 24

/// Every secret a signature may currently be verified against, newest first.
///
/// Returns the process/environment secret when a facility has none of its own,
/// which is what keeps B-028's simulator and every existing test working
/// unchanged: rotation is opt-in per site, and a facility nobody has rotated
/// behaves exactly as it did before this file existed.
export async function acceptableSecrets(facilityId: string, now: Date = new Date()): Promise<string[]> {
  const key = accessCodeEncryptionKey()
  const rows = key
    ? await prisma.gateWebhookSecret.findMany({
        where: {
          facilityId,
          OR: [{ active: true }, { retiresAt: { gt: now } }],
        },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      })
    : []

  const secrets = rows
    .map((row) => {
      try {
        return decryptCode(row.secretRef, key!)
      } catch {
        // A row we cannot decrypt is not a reason to reject every webhook at
        // this site — the other secrets in the list may still verify. It is a
        // reason to have nothing to say about this one.
        return null
      }
    })
    .filter((secret): secret is string => secret !== null)

  if (secrets.length > 0) return secrets

  const fallback = hardwareWebhookSecret()
  return fallback ? [fallback] : []
}

/// The secret to SIGN with — the active one, or the environment fallback.
/// Only ever one, because "which key did we sign this with" must have one
/// answer even while two are being accepted.
export async function signingSecret(facilityId: string): Promise<string | null> {
  const key = accessCodeEncryptionKey()
  if (key) {
    const active = await prisma.gateWebhookSecret.findFirst({
      where: { facilityId, active: true },
    })
    if (active) {
      try {
        return decryptCode(active.secretRef, key)
      } catch {
        return null
      }
    }
  }
  return hardwareWebhookSecret()
}

export type RotationResult =
  | { ok: true; secret: string; previousRetiresAt: Date | null }
  | { ok: false; reason: 'no_encryption_key' }

/// Issues a new active secret and puts the old one into its grace window.
///
/// Returns the plaintext ONCE — it is never readable again from any screen,
/// because the only party that needs it is the vendor portal it is about to be
/// pasted into. Storing it retrievably would make the admin UI a place to read
/// every site's signing key, which is the thing SR-1 is about.
export async function rotateWebhookSecret(
  actor: Actor,
  facilityId: string,
  now: Date = new Date(),
): Promise<RotationResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const key = accessCodeEncryptionKey()
  // Degrades honestly rather than storing a signing key in the clear — the
  // same posture `revealCode` takes with an unconfigured key.
  if (!key) return { ok: false, reason: 'no_encryption_key' }

  const secret = randomBytes(32).toString('hex')
  const retiresAt = new Date(now.getTime() + ROTATION_GRACE_HOURS * 60 * 60 * 1000)

  const previous = await prisma.$transaction(async (tx) => {
    const current = await tx.gateWebhookSecret.findFirst({
      where: { facilityId, active: true },
      select: { id: true },
    })

    // Cleared BEFORE the insert, in one transaction: the partial unique index
    // permits exactly one active row per facility, so doing it the other way
    // round would fail the constraint rather than replace the row.
    if (current) {
      await tx.gateWebhookSecret.update({
        where: { id: current.id },
        data: { active: false, retiresAt },
      })
    }

    await tx.gateWebhookSecret.create({
      data: {
        facilityId,
        secretRef: encryptCode(secret, key),
        active: true,
        createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      },
    })

    return current
  })

  // SR-3: "immutable audit records for... every webhook secret rotation."
  await recordAudit({
    actor: toAuditActor(actor),
    action: 'gate.webhook_secret_rotated',
    entityType: 'Facility',
    entityId: facilityId,
    facilityId,
    context: {
      replacedPrevious: previous !== null,
      previousAcceptedUntil: previous ? retiresAt.toISOString() : null,
      graceHours: ROTATION_GRACE_HOURS,
    },
  })

  return { ok: true, secret, previousRetiresAt: previous ? retiresAt : null }
}

export type SecretStatus = {
  configured: boolean
  activeSince: Date | null
  /// Secrets still being accepted from a recent rotation, with when they stop.
  retiring: { retiresAt: Date }[]
  /// True when no encryption key is configured, so rotation is unavailable.
  unavailable: boolean
}

export async function webhookSecretStatus(
  facilityId: string,
  now: Date = new Date(),
): Promise<SecretStatus> {
  if (!accessCodeEncryptionKey()) {
    return { configured: false, activeSince: null, retiring: [], unavailable: true }
  }

  const rows = await prisma.gateWebhookSecret.findMany({
    where: { facilityId },
    orderBy: { createdAt: 'desc' },
  })
  const active = rows.find((row) => row.active)

  return {
    configured: Boolean(active),
    activeSince: active?.createdAt ?? null,
    retiring: rows
      .filter((row) => !row.active && row.retiresAt && row.retiresAt > now)
      .map((row) => ({ retiresAt: row.retiresAt! })),
    unavailable: false,
  }
}

/// Deletes secrets whose grace window has closed. Called from the daily job.
///
/// A retired secret that is still on file is a key that could still be leaked
/// for no remaining benefit — the whole point of the window is that it ends.
export async function pruneRetiredSecrets(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.gateWebhookSecret.deleteMany({
    where: { active: false, retiresAt: { lt: now } },
  })
  return count
}
