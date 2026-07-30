import { prisma, type AuthAudience } from '@storage/db'

// PRD 01 FR-5.2 requires rate-limited login without naming numbers. These are
// the knobs; they live here so there is one place to tune them.
export const LIMITS = {
  /// Failures against a single identity before it is locked out.
  perIdentity: 5,
  /// Failures from one IP across all identities — catches spraying.
  perIp: 20,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export type ThrottleResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; reason: 'identity' | 'ip' }

// ponytail: counts rows in a time window rather than keeping a token bucket.
// Fine at this scale (one indexed query per login); swap for Redis/Upstash if
// login volume ever makes the count query hot.
export async function checkLoginThrottle(
  email: string,
  audience: AuthAudience,
  ipAddress?: string | null,
): Promise<ThrottleResult> {
  const since = new Date(Date.now() - LIMITS.windowMs)
  const normalizedEmail = email.toLowerCase()

  // A successful login clears the identity counter, so only failures after the
  // last success count against it.
  const lastSuccess = await prisma.loginAttempt.findFirst({
    where: { email: normalizedEmail, audience, succeeded: true, attemptedAt: { gte: since } },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  })

  const identityFailures = await prisma.loginAttempt.findMany({
    where: {
      email: normalizedEmail,
      audience,
      succeeded: false,
      attemptedAt: { gte: lastSuccess?.attemptedAt ?? since },
    },
    orderBy: { attemptedAt: 'desc' },
    take: LIMITS.perIdentity,
    select: { attemptedAt: true },
  })

  if (identityFailures.length >= LIMITS.perIdentity) {
    const oldest = identityFailures[identityFailures.length - 1].attemptedAt
    const retryAfterMs = oldest.getTime() + LIMITS.lockoutMs - Date.now()
    if (retryAfterMs > 0) return { allowed: false, retryAfterMs, reason: 'identity' }
  }

  if (ipAddress) {
    const ipFailures = await prisma.loginAttempt.count({
      where: { ipAddress, succeeded: false, attemptedAt: { gte: since } },
    })
    if (ipFailures >= LIMITS.perIp) {
      return { allowed: false, retryAfterMs: LIMITS.lockoutMs, reason: 'ip' }
    }
  }

  return { allowed: true }
}

export async function recordLoginAttempt(
  email: string,
  audience: AuthAudience,
  succeeded: boolean,
  ipAddress?: string | null,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.toLowerCase(), audience, succeeded, ipAddress: ipAddress ?? null },
  })
}

/// Attempts older than the window are only useful for forensics; the audit log
/// keeps the security-relevant record. Called from the nightly job in B-006.
export async function pruneLoginAttempts(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
  const { count } = await prisma.loginAttempt.deleteMany({
    where: { attemptedAt: { lt: new Date(Date.now() - olderThanMs) } },
  })
  return count
}
