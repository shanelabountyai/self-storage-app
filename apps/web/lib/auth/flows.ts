import type { AuthAudience } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { findSubjectByEmail, resolveAudience, setPassword } from './accounts'
import { sendAuthEmail } from './send-auth-email'
import { consumeToken, mintToken } from './tokens'

function baseUrl(): string {
  return process.env.AUTH_URL ?? 'http://localhost:3000'
}

/// Requests a magic link. Always resolves the same way whether or not the
/// address belongs to an account — the caller must not branch on the result.
///
/// Staff are refused outright (B-079). A magic link signs somebody in on
/// possession of their inbox alone, which is exactly the second factor the
/// password path now demands — so leaving it available to staff would mean
/// every MFA enrolment could be walked around by clicking "email me a link".
/// Master PRD §7.1 already assigns the two mechanisms separately: "Staff auth
/// requires MFA (TOTP)... Tenants use email/password + magic-link fallback."
/// Staff who forget a password still have the reset flow, which lands them back
/// at a sign-in that asks for the code.
export async function requestMagicLink(
  email: string,
  hint: AuthAudience | null,
  ipAddress?: string | null,
): Promise<void> {
  // Resolved from the address, not assumed from the URL — see resolveAudience.
  // The staff refusal below now applies to the account that actually exists,
  // rather than to whatever the query parameter implied: previously a staff
  // member on the tenant-shaped form was refused only as a side effect of not
  // existing in the Tenant table, which happened to be the right outcome for
  // the wrong reason and stopped being reliable the moment resolution improved.
  const audience = await resolveAudience(email, hint)
  if (audience === 'staff') return

  const subject = audience && (await findSubjectByEmail(email, audience))
  if (!subject) return

  const { token, expiresAt } = await mintToken({
    purpose: 'magic_link',
    audience,
    subjectId: subject.id,
    email: subject.email,
    ipAddress,
  })

  await sendAuthEmail({
    to: subject.email,
    purpose: 'magic_link',
    url: `${baseUrl()}/login/magic?token=${token}`,
    expiresAt,
  })
}

export async function requestPasswordReset(
  email: string,
  hint: AuthAudience | null,
  ipAddress?: string | null,
): Promise<void> {
  const audience = await resolveAudience(email, hint)
  const subject = audience && (await findSubjectByEmail(email, audience))
  if (!subject || !audience) return

  const { token, expiresAt } = await mintToken({
    purpose: 'password_reset',
    audience,
    subjectId: subject.id,
    email: subject.email,
    ipAddress,
  })

  await sendAuthEmail({
    to: subject.email,
    purpose: 'password_reset',
    url: `${baseUrl()}/reset-password?token=${token}`,
    expiresAt,
  })
}

/// Consumes the reset token and sets the new password. The token burn and the
/// password write are separate steps by necessity — the burn is atomic and
/// happens first, so a failure here cannot leave a reusable token behind.
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid_token' | 'weak_password' }> {
  if (newPassword.length < 8) return { ok: false, reason: 'weak_password' }

  const consumed = await consumeToken(token, 'password_reset')
  if (!consumed) return { ok: false, reason: 'invalid_token' }

  await setPassword(consumed.subjectId, consumed.audience, newPassword)

  // Password changes are privileged actions and belong in the audit log
  // (master PRD §7.1).
  await recordAudit({
    actor:
      consumed.audience === 'staff'
        ? { type: 'staff', staffUserId: consumed.subjectId, label: consumed.email }
        : { type: 'tenant', tenantId: consumed.subjectId, label: consumed.email },
    action: 'password.reset_completed',
    entityType: consumed.audience === 'staff' ? 'StaffUser' : 'Tenant',
    entityId: consumed.subjectId,
    reasonCode: 'self_service',
  })

  return { ok: true }
}
