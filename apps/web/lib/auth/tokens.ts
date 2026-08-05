import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma, type AuthAudience, type AuthTokenPurpose } from '@storage/db'

/// PRD 01 FR-5.2: magic links expire in 15 minutes and are single-use.
export const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  magic_link: 15 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  // Longer than a password reset on purpose: this link goes to an address the
  // person may not have open, and the failure mode of it expiring is that
  // they cannot receive mail from us at all until they notice and retry.
  email_change: 24 * 60 * 60 * 1000,
}

/// 256 bits of entropy, URL-safe. Well above the ≥128-bit floor the comms PRD
/// sets for single-purpose links (PRD 05 FR-12).
function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

type MintArgs = {
  purpose: AuthTokenPurpose
  audience: AuthAudience
  subjectId: string
  email: string
  ipAddress?: string | null
}

/// Returns the plaintext token exactly once — only its SHA-256 is persisted.
/// Any previous live token for the same subject and purpose is consumed, so a
/// freshly requested link always invalidates the one before it.
export async function mintToken({
  purpose,
  audience,
  subjectId,
  email,
  ipAddress,
}: MintArgs): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose])

  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { subjectId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        tokenHash: hashToken(token),
        purpose,
        audience,
        subjectId,
        email: email.toLowerCase(),
        expiresAt,
        ipAddress: ipAddress ?? null,
      },
    }),
  ])

  return { token, expiresAt }
}

export type ConsumedToken = {
  audience: AuthAudience
  subjectId: string
  email: string
}

/// Verifies and burns a token in one atomic step. Returns null for every
/// failure mode — unknown, expired, or already used — so a caller cannot probe
/// which one it hit.
export async function consumeToken(
  token: string,
  purpose: AuthTokenPurpose,
): Promise<ConsumedToken | null> {
  if (!token) return null

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
  })
  if (!record || record.purpose !== purpose) return null
  if (record.usedAt !== null) return null
  if (record.expiresAt.getTime() <= Date.now()) return null

  // Conditioned on usedAt still being null, so two simultaneous clicks can
  // never both succeed.
  const burned = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (burned.count !== 1) return null

  return {
    audience: record.audience,
    subjectId: record.subjectId,
    email: record.email,
  }
}

/// Constant-time compare for callers that hold two tokens directly.
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(hashToken(a), 'hex')
  const bufB = Buffer.from(hashToken(b), 'hex')
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
