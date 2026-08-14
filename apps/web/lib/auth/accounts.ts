import { prisma, type AuthAudience } from '@storage/db'
import { hashPassword, needsRehash, verifyPassword } from './password'
import { verifySecondFactor } from './mfa'
import { checkLoginThrottle, recordLoginAttempt } from './rate-limit'

export type AuthenticatedSubject = {
  id: string
  email: string
  audience: AuthAudience
  name: string
}

/// Shared shape across the two audiences so the rest of auth doesn't branch.
type AccountRecord = {
  id: string
  email: string
  passwordHash: string | null
  firstName: string
  lastName: string
  disabled: boolean
}

async function findAccount(
  email: string,
  audience: AuthAudience,
): Promise<AccountRecord | null> {
  const normalized = email.trim().toLowerCase()

  if (audience === 'tenant') {
    const tenant = await prisma.tenant.findUnique({ where: { email: normalized } })
    if (!tenant) return null
    return { ...tenant, disabled: tenant.deletedAt !== null }
  }

  const staff = await prisma.staffUser.findUnique({ where: { email: normalized } })
  if (!staff) return null
  return { ...staff, disabled: staff.deletedAt !== null || staff.status !== 'active' }
}

/// Which audience an email address belongs to, for the surfaces that cannot know.
///
/// `/login` and `/forgot-password` serve both audiences from one form, and until
/// now they inferred the audience from the `from` query parameter alone —
/// defaulting to `tenant` when it was absent. That default is wrong far more
/// often than it looks: a staff member who types either URL, follows a bookmark,
/// or is redirected there by the reset flow (which does not carry `from`) is
/// looked up in the Tenant table, where they do not exist. Password reset then
/// reports "a link is on its way" and sends nothing, and sign-in reports
/// "incorrect email or password" about a password that is correct. Both failures
/// blame the user for a query parameter they never saw. It cost this project's
/// own owner three rounds of debugging on the day the first real account was
/// created, and both the UX and accessibility reviews raised it as their
/// top finding.
///
/// The `hint` is now a preference rather than a verdict: the hinted audience is
/// tried first, and the other is tried when there is no usable account there.
/// So a correct `from` still steers, a missing one no longer decides, and a
/// wrong one no longer locks anybody out.
///
/// Disabled accounts are skipped rather than claimed, so a deactivated staff
/// member who is also a tenant resolves to their tenant account instead of
/// resolving to nothing.
///
/// **Nothing here is enumerable**: every caller responds identically whether
/// this returns an audience or null — the same "if that email has an account"
/// message, the same generic sign-in failure.
///
/// When an address is BOTH staff and tenant — an employee who rents a unit —
/// and there is no hint, staff wins. That case is genuinely ambiguous and this
/// is the safer half: the portal's own links carry `from`, so a tenant arriving
/// the ordinary way still resolves to tenant, whereas a locked-out staff member
/// is the one with no other route in.
export async function resolveAudience(
  email: string,
  hint?: AuthAudience | null,
): Promise<AuthAudience | null> {
  const order: AuthAudience[] = hint === 'tenant' ? ['tenant', 'staff'] : ['staff', 'tenant']

  for (const audience of order) {
    const account = await findAccount(email, audience)
    if (account && !account.disabled) return audience
  }

  return null
}

export class LoginThrottledError extends Error {
  // Explicit field, not a constructor-parameter-property: see the comment on
  // ForbiddenError in lib/rbac/authorize.ts.
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('Too many attempts. Try again later.')
    this.name = 'LoginThrottledError'
    this.retryAfterMs = retryAfterMs
  }
}

/// Returns null for every ordinary failure — unknown email, no password set,
/// wrong password, disabled account, missing or wrong second factor — so the
/// caller has nothing to enumerate with. Throws only when the request is
/// throttled, which the user must be told.
///
/// `secondFactor` is a TOTP code or a recovery code, and is required only for
/// staff who have completed enrolment (B-079). It is checked BEFORE the login
/// attempt is recorded, which is the point: recording a success on a correct
/// password and then failing MFA afterwards would clear the throttle counter on
/// every attempt, leaving the second factor itself unthrottled and free to
/// brute-force at a million codes an hour.
export async function authenticateWithPassword(
  email: string,
  password: string,
  audience: AuthAudience,
  ipAddress?: string | null,
  secondFactor?: string | null,
): Promise<AuthenticatedSubject | null> {
  const throttle = await checkLoginThrottle(email, audience, ipAddress)
  if (!throttle.allowed) throw new LoginThrottledError(throttle.retryAfterMs)

  const account = await findAccount(email, audience)
  // Still runs the KDF when there's no account, so timing doesn't reveal it.
  const ok = await verifyPassword(password, account?.passwordHash)
  const passwordOk = ok && account !== null && !account.disabled

  const success =
    passwordOk && account
      ? await secondFactorOk(account.id, audience, secondFactor)
      : false

  await recordLoginAttempt(email, audience, success, ipAddress)
  if (!success || !account) return null

  if (needsRehash(account.passwordHash)) {
    await setPassword(account.id, audience, password)
  }

  return {
    id: account.id,
    email: account.email,
    audience,
    name: `${account.firstName} ${account.lastName}`.trim(),
  }
}

/// True when the second factor is satisfied — which for a tenant, or for a
/// staff member who has not enrolled yet, means "there is nothing to satisfy".
///
/// An unenrolled staff member is let through deliberately. Enforcement lives in
/// the admin layout, which sends them to /mfa before they can reach any screen;
/// blocking the sign-in itself would leave a new hire with no way to ever
/// enrol, and would break the `system` integration accounts that authenticate
/// but never browse the admin.
async function secondFactorOk(
  subjectId: string,
  audience: AuthAudience,
  submitted: string | null | undefined,
): Promise<boolean> {
  if (audience !== 'staff') return true

  const result = await verifySecondFactor(subjectId, (submitted ?? '').trim())
  return result.ok || result.reason === 'not_enrolled'
}

/// Used after a magic link or password-reset token has already been consumed.
export async function loadSubject(
  subjectId: string,
  audience: AuthAudience,
): Promise<AuthenticatedSubject | null> {
  const account =
    audience === 'tenant'
      ? await prisma.tenant.findUnique({ where: { id: subjectId } })
      : await prisma.staffUser.findUnique({ where: { id: subjectId } })

  if (!account) return null
  const disabled =
    account.deletedAt !== null || ('status' in account && account.status !== 'active')
  if (disabled) return null

  return {
    id: account.id,
    email: account.email,
    audience,
    name: `${account.firstName} ${account.lastName}`.trim(),
  }
}

export async function setPassword(
  subjectId: string,
  audience: AuthAudience,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password)
  if (audience === 'tenant') {
    await prisma.tenant.update({ where: { id: subjectId }, data: { passwordHash } })
  } else {
    await prisma.staffUser.update({ where: { id: subjectId }, data: { passwordHash } })
  }
}

/// Looks an account up for magic-link and password-reset requests. Callers must
/// respond identically whether or not this returns null (no account enumeration).
export async function findSubjectByEmail(
  email: string,
  audience: AuthAudience,
): Promise<AuthenticatedSubject | null> {
  const account = await findAccount(email, audience)
  if (!account || account.disabled) return null
  return {
    id: account.id,
    email: account.email,
    audience,
    name: `${account.firstName} ${account.lastName}`.trim(),
  }
}
