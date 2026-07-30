import { prisma, type AuthAudience } from '@storage/db'
import { hashPassword, needsRehash, verifyPassword } from './password'
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
/// wrong password, disabled account — so the caller has nothing to enumerate
/// with. Throws only when the request is throttled, which the user must be told.
export async function authenticateWithPassword(
  email: string,
  password: string,
  audience: AuthAudience,
  ipAddress?: string | null,
): Promise<AuthenticatedSubject | null> {
  const throttle = await checkLoginThrottle(email, audience, ipAddress)
  if (!throttle.allowed) throw new LoginThrottledError(throttle.retryAfterMs)

  const account = await findAccount(email, audience)
  // Still runs the KDF when there's no account, so timing doesn't reveal it.
  const ok = await verifyPassword(password, account?.passwordHash)
  const success = ok && account !== null && !account.disabled

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
