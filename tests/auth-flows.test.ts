import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { authenticateWithPassword, LoginThrottledError, setPassword } from '../apps/web/lib/auth/accounts'
import { completePasswordReset } from '../apps/web/lib/auth/flows'
import { LIMITS } from '../apps/web/lib/auth/rate-limit'
import { consumeToken, mintToken } from '../apps/web/lib/auth/tokens'

// Integration tests against a real Postgres — the token burn and the throttle
// are both concurrency-sensitive, and neither is meaningfully testable in a
// mock. Skipped when no database is configured; CI provisions one.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const EMAIL = 'auth-flows-test@example.com'
/// Deliberately has no account — used to prove failures don't enumerate users.
const ABSENT_EMAIL = 'auth-flows-absent@example.com'
const TEST_EMAILS = [EMAIL, ABSENT_EMAIL]
let tenantId = ''

beforeAll(async () => {
  if (!hasDatabase) return
  const tenant = await prisma.tenant.create({
    data: { email: EMAIL, firstName: 'Test', lastName: 'Subject' },
  })
  tenantId = tenant.id
})

afterEach(async () => {
  if (!hasDatabase) return
  await prisma.authToken.deleteMany({ where: { subjectId: tenantId } })
  await prisma.loginAttempt.deleteMany({ where: { email: { in: TEST_EMAILS } } })
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.auditLog.deleteMany({ where: { entityId: tenantId } })
  await prisma.authToken.deleteMany({ where: { subjectId: tenantId } })
  await prisma.loginAttempt.deleteMany({ where: { email: { in: TEST_EMAILS } } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.$disconnect()
})

const mint = (purpose: 'magic_link' | 'password_reset' = 'magic_link') =>
  mintToken({ purpose, audience: 'tenant', subjectId: tenantId, email: EMAIL })

describe.skipIf(!hasDatabase)('auth tokens', () => {
  it('accepts a fresh token exactly once', async () => {
    const { token } = await mint()
    await expect(consumeToken(token, 'magic_link')).resolves.toMatchObject({
      subjectId: tenantId,
      audience: 'tenant',
    })
    await expect(consumeToken(token, 'magic_link')).resolves.toBeNull()
  })

  it('survives a double click without issuing two sessions', async () => {
    const { token } = await mint()
    const results = await Promise.all([
      consumeToken(token, 'magic_link'),
      consumeToken(token, 'magic_link'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('rejects a token presented for the wrong purpose', async () => {
    const { token } = await mint('magic_link')
    await expect(consumeToken(token, 'password_reset')).resolves.toBeNull()
  })

  it('rejects an expired token', async () => {
    const { token } = await mint()
    // Age the whole row rather than only its expiry — the database enforces
    // expiresAt > createdAt, so a half-backdated row is not a state that can
    // actually occur.
    await prisma.authToken.updateMany({
      where: { subjectId: tenantId, usedAt: null },
      data: {
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 45 * 60 * 1000),
      },
    })
    await expect(consumeToken(token, 'magic_link')).resolves.toBeNull()
  })

  it('invalidates the previous link when a new one is requested', async () => {
    const first = await mint()
    const second = await mint()
    await expect(consumeToken(first.token, 'magic_link')).resolves.toBeNull()
    await expect(consumeToken(second.token, 'magic_link')).resolves.not.toBeNull()
  })

  it('rejects unknown and empty tokens', async () => {
    await expect(consumeToken('', 'magic_link')).resolves.toBeNull()
    await expect(consumeToken('not-a-real-token', 'magic_link')).resolves.toBeNull()
  })

  it('stores only the hash, never the token itself', async () => {
    const { token } = await mint()
    const rows = await prisma.authToken.findMany({ where: { subjectId: tenantId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toEqual(token)
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('expires magic links in 15 minutes per PRD 01 FR-5.2', async () => {
    const { expiresAt } = await mint()
    const minutes = (expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(14)
    expect(minutes).toBeLessThanOrEqual(15)
  })
})

describe.skipIf(!hasDatabase)('login throttle', () => {
  it('locks an identity out after repeated failures', async () => {
    await setPassword(tenantId, 'tenant', 'correct horse battery staple')

    for (let i = 0; i < LIMITS.perIdentity; i++) {
      await expect(
        authenticateWithPassword(EMAIL, 'wrong-password', 'tenant'),
      ).resolves.toBeNull()
    }

    // The correct password must not get through once the limit is hit.
    await expect(
      authenticateWithPassword(EMAIL, 'correct horse battery staple', 'tenant'),
    ).rejects.toBeInstanceOf(LoginThrottledError)
  })

  it('lets a correct password through below the limit', async () => {
    await setPassword(tenantId, 'tenant', 'correct horse battery staple')
    await authenticateWithPassword(EMAIL, 'wrong-password', 'tenant')

    await expect(
      authenticateWithPassword(EMAIL, 'correct horse battery staple', 'tenant'),
    ).resolves.toMatchObject({ id: tenantId, audience: 'tenant' })
  })

  it('clears the counter after a success', async () => {
    await setPassword(tenantId, 'tenant', 'correct horse battery staple')

    for (let i = 0; i < LIMITS.perIdentity - 1; i++) {
      await authenticateWithPassword(EMAIL, 'wrong-password', 'tenant')
    }
    await authenticateWithPassword(EMAIL, 'correct horse battery staple', 'tenant')
    for (let i = 0; i < LIMITS.perIdentity - 1; i++) {
      await authenticateWithPassword(EMAIL, 'wrong-password', 'tenant')
    }

    await expect(
      authenticateWithPassword(EMAIL, 'correct horse battery staple', 'tenant'),
    ).resolves.not.toBeNull()
  })

  it('does not reveal whether an account exists', async () => {
    await expect(
      authenticateWithPassword(ABSENT_EMAIL, 'whatever', 'tenant'),
    ).resolves.toBeNull()
  })

  it('refuses an account that has no password set', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { passwordHash: null } })
    await expect(authenticateWithPassword(EMAIL, 'anything at all', 'tenant')).resolves.toBeNull()
  })
})

describe.skipIf(!hasDatabase)('password reset', () => {
  it('sets a new password and burns the token', async () => {
    const { token } = await mint('password_reset')

    await expect(completePasswordReset(token, 'a-brand-new-password')).resolves.toEqual({
      ok: true,
    })
    await expect(
      authenticateWithPassword(EMAIL, 'a-brand-new-password', 'tenant'),
    ).resolves.toMatchObject({ id: tenantId })

    await expect(completePasswordReset(token, 'another-password')).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a weak password without consuming the token', async () => {
    const { token } = await mint('password_reset')
    await expect(completePasswordReset(token, 'short')).resolves.toEqual({
      ok: false,
      reason: 'weak_password',
    })
    await expect(completePasswordReset(token, 'long-enough-password')).resolves.toEqual({
      ok: true,
    })
  })

  it('writes the reset to the audit log', async () => {
    const { token } = await mint('password_reset')
    await completePasswordReset(token, 'audited-password-123')

    const entries = await prisma.auditLog.findMany({
      where: { entityId: tenantId, action: 'password.reset_completed' },
    })
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })
})
