import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  base32Encode,
  base32Decode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  recoveryCodeFromBytes,
  RECOVERY_CODE_COUNT,
  verifyTotp,
} from '@storage/core/auth/totp'
import { SITE } from '@/lib/site-config'
import { decryptTotpSecret, encryptTotpSecret } from './totp-secret'

// PRD 00 §7.1 (B-079): "Staff auth requires MFA (TOTP) from Phase 2."
//
// Two separate ideas, kept apart on purpose:
//
//   VERIFICATION happens at sign-in, inside the credentials provider, and only
//   for staff who have completed enrolment. There is never a half-authenticated
//   session: no JWT is issued until the second factor has passed, so there is no
//   "MFA pending" state for anything to forget to check.
//
//   ENFORCEMENT happens in the admin layout, which redirects a staff member who
//   has not enrolled to /mfa before they can reach any admin screen. Putting it
//   there rather than in a JWT claim means it is re-evaluated from the database
//   on every request — a claim minted at sign-in would still say "enrolled" for
//   thirty days after an administrator reset somebody's second factor.
//
// The split is also what keeps a `system` integration account working. Such an
// account authenticates but never browses /admin, so it is never enrolled and
// never gated — while a human who signs in and goes anywhere is.

const SECRET_BYTES = 20 // 160 bits, the RFC 4226 §4 R6 recommendation.

export type MfaStatus = {
  enrolled: boolean
  confirmedAt: Date | null
  /// Non-null only while an enrolment is started but unconfirmed.
  pending: boolean
  unusedRecoveryCodes: number
}

export async function mfaStatus(staffUserId: string): Promise<MfaStatus> {
  const [staff, unused] = await Promise.all([
    prisma.staffUser.findUnique({
      where: { id: staffUserId },
      select: { totpSecret: true, totpConfirmedAt: true },
    }),
    prisma.staffRecoveryCode.count({ where: { staffUserId, usedAt: null } }),
  ])

  return {
    enrolled: Boolean(staff?.totpConfirmedAt),
    confirmedAt: staff?.totpConfirmedAt ?? null,
    pending: Boolean(staff?.totpSecret) && !staff?.totpConfirmedAt,
    unusedRecoveryCodes: unused,
  }
}

/// True when this person must enrol before doing anything else. Read on every
/// admin request, so it selects two columns and nothing else.
export async function needsMfaEnrollment(staffUserId: string): Promise<boolean> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    select: { totpConfirmedAt: true },
  })
  return staff !== null && staff.totpConfirmedAt === null
}

export type EnrollmentOffer = { secret: string; uri: string }

/// The secret of an enrolment that has been started but not confirmed, so the
/// screen can be re-rendered (or reloaded, or reopened tomorrow) without
/// issuing a new one — which would silently invalidate the entry the person
/// already made in their authenticator.
///
/// Reading it is safe: it is only ever shown to the signed-in owner of the
/// account, and the account is already authenticated. A CONFIRMED secret is
/// never returned, so this cannot be used to re-display a live one.
export async function pendingEnrollment(staffUserId: string): Promise<EnrollmentOffer | null> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    select: { email: true, totpSecret: true, totpConfirmedAt: true },
  })
  if (!staff?.totpSecret || staff.totpConfirmedAt) return null

  const secret = decryptTotpSecret(staff.totpSecret)
  if (!secret) return null

  return { secret, uri: otpauthUri({ secret, account: staff.email, issuer: SITE.name }) }
}

/// Issues a fresh secret and stores it UNCONFIRMED.
///
/// Re-running this before confirming replaces the secret, which is what makes
/// "start again, I closed the tab" work. It refuses once confirmed: silently
/// re-keying a working second factor would lock somebody out of their own
/// account with no warning and no way back except an administrator.
export async function beginEnrollment(
  staffUserId: string,
): Promise<EnrollmentOffer | { error: 'already_enrolled' }> {
  const staff = await prisma.staffUser.findUniqueOrThrow({
    where: { id: staffUserId },
    select: { email: true, totpConfirmedAt: true },
  })
  if (staff.totpConfirmedAt) return { error: 'already_enrolled' }

  const secret = base32Encode(randomBytes(SECRET_BYTES))
  await prisma.staffUser.update({
    where: { id: staffUserId },
    data: { totpSecret: encryptTotpSecret(secret), totpLastStep: null },
  })

  return {
    secret,
    uri: otpauthUri({ secret, account: staff.email, issuer: SITE.name }),
  }
}

export type ConfirmResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'no_pending_enrollment' | 'bad_code' }

/// Completes enrolment by proving the authenticator actually produces codes
/// from the stored secret, then issues the recovery codes.
export async function confirmEnrollment(
  staffUserId: string,
  submittedCode: string,
): Promise<ConfirmResult> {
  const staff = await prisma.staffUser.findUniqueOrThrow({
    where: { id: staffUserId },
    select: { totpSecret: true, totpConfirmedAt: true },
  })
  if (!staff.totpSecret || staff.totpConfirmedAt) return { ok: false, reason: 'no_pending_enrollment' }

  const secret = staff.totpSecret ? decryptTotpSecret(staff.totpSecret) : null
  if (!secret) return { ok: false, reason: 'no_pending_enrollment' }

  const result = verifyTotp(base32Decode(secret), submittedCode, Date.now())
  if (!result.ok) return { ok: false, reason: 'bad_code' }

  const codes = await replaceRecoveryCodes(staffUserId, () =>
    prisma.staffUser.update({
      where: { id: staffUserId },
      data: { totpConfirmedAt: new Date(), totpLastStep: result.step },
    }),
  )

  await recordAudit({
    actor: { type: 'staff', staffUserId },
    action: 'mfa.enrolled',
    entityType: 'StaffUser',
    entityId: staffUserId,
  })

  return { ok: true, recoveryCodes: codes }
}

export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: boolean }
  | { ok: false; reason: 'not_enrolled' | 'invalid' | 'replayed' }

/// The check the login path runs. Accepts either a TOTP code or a recovery
/// code in the same field — they are told apart by length, so somebody whose
/// phone is in a puddle does not first have to find a different form.
export async function verifySecondFactor(
  staffUserId: string,
  submitted: string,
): Promise<SecondFactorResult> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    select: { totpSecret: true, totpConfirmedAt: true, totpLastStep: true },
  })
  if (!staff?.totpConfirmedAt || !staff.totpSecret) return { ok: false, reason: 'not_enrolled' }

  if (looksLikeRecoveryCode(submitted)) {
    return consumeRecoveryCode(staffUserId, submitted)
  }

  const secret = decryptTotpSecret(staff.totpSecret)
  // An unreadable secret — AUTH_SECRET rotated, or the column tampered with —
  // fails closed. Treating it as "no second factor configured" here would turn
  // a key rotation into a silent MFA bypass for every staff account at once.
  if (!secret) return { ok: false, reason: 'invalid' }

  const result = verifyTotp(base32Decode(secret), submitted, Date.now(), {
    lastUsedStep: staff.totpLastStep,
  })
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'replayed' ? 'replayed' : 'invalid' }
  }

  // Conditional on the step still being what we read, so two requests racing
  // with the same code cannot both win: the second updates zero rows.
  const claimed = await prisma.staffUser.updateMany({
    where: { id: staffUserId, totpLastStep: staff.totpLastStep },
    data: { totpLastStep: result.step },
  })
  if (claimed.count === 0) return { ok: false, reason: 'replayed' }

  return { ok: true, usedRecoveryCode: false }
}

async function consumeRecoveryCode(
  staffUserId: string,
  submitted: string,
): Promise<SecondFactorResult> {
  const codeHash = hashRecoveryCode(submitted)

  // updateMany with `usedAt: null` in the WHERE is the burn: single-use is
  // enforced by the write, not by a read-then-write that two requests could
  // both pass. The staffUserId is in the predicate too, so a code belonging to
  // somebody else cannot be spent here even though the hash is globally unique.
  const burned = await prisma.staffRecoveryCode.updateMany({
    where: { codeHash, staffUserId, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (burned.count === 0) return { ok: false, reason: 'invalid' }

  await recordAudit({
    actor: { type: 'staff', staffUserId },
    action: 'mfa.recovery_code_used',
    entityType: 'StaffUser',
    entityId: staffUserId,
  })

  return { ok: true, usedRecoveryCode: true }
}

/// Issues a fresh set and invalidates every previous one, used or not. Returns
/// the plaintext codes — the only time they exist outside the person's hands.
export async function regenerateRecoveryCodes(staffUserId: string): Promise<string[]> {
  const codes = await replaceRecoveryCodes(staffUserId)

  await recordAudit({
    actor: { type: 'staff', staffUserId },
    action: 'mfa.recovery_codes_regenerated',
    entityType: 'StaffUser',
    entityId: staffUserId,
  })

  return codes
}

async function replaceRecoveryCodes(
  staffUserId: string,
  alsoInTransaction?: () => Promise<unknown>,
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    recoveryCodeFromBytes(randomBytes(16)),
  )

  await prisma.$transaction(async (tx) => {
    await tx.staffRecoveryCode.deleteMany({ where: { staffUserId } })
    await tx.staffRecoveryCode.createMany({
      data: codes.map((code) => ({ staffUserId, codeHash: hashRecoveryCode(code) })),
    })
    if (alsoInTransaction) await alsoInTransaction()
  })

  return codes
}

/// SHA-256, not argon2 — see the comment on the StaffRecoveryCode model.
function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

/// Clears somebody else's second factor so they can enrol again. The account
/// is left signed-out-able but ungated until they do: the admin layout will
/// send them straight back to /mfa on their next request.
export async function resetMfaForStaff(input: {
  staffUserId: string
  actorStaffId: string
  reasonCode: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.staffRecoveryCode.deleteMany({ where: { staffUserId: input.staffUserId } })
    await tx.staffUser.update({
      where: { id: input.staffUserId },
      data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
    })
  })

  await recordAudit({
    actor: { type: 'staff', staffUserId: input.actorStaffId },
    action: 'mfa.reset_by_admin',
    entityType: 'StaffUser',
    entityId: input.staffUserId,
    reasonCode: input.reasonCode,
  })
}
