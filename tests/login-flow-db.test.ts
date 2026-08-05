import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { requestMagicLinkAction } from '../apps/web/app/login/magic-link-actions'
import { requestPasswordResetAction } from '../apps/web/app/forgot-password/actions'
import { resetPasswordAction } from '../apps/web/app/reset-password/actions'
import { authenticateWithPassword } from '../apps/web/lib/auth/accounts'
import { mintToken } from '../apps/web/lib/auth/tokens'

// B-033 / PRD 01 US-701. The action-level wiring on top of B-003's auth
// primitives (already covered by tests/auth-flows.test.ts) — form parsing,
// audience inference, and error shaping.
//
// NOT covered here: `signInWithPasswordAction`, `reauthWithPasswordAction`,
// `reauthWithMagicLinkAction` — anything that imports `signIn`/`auth` from
// `@/auth`. Importing that module at all fails under Vitest ("Cannot find
// module '.../node_modules/next/server' ... Did you mean to import
// 'next/server.js'?"): `next-auth@5.0.0-beta.32`'s internals import
// `next/server` as a bare, extensionless specifier, which Next 16.2.12's
// bundler resolves fine (webpack/Turbopack are lenient about it) but Node's
// own strict ESM resolution — what Vitest uses — refuses. This is a real,
// pre-existing gap between this dependency pair and this test runner, not
// something introduced here; `tests/auth-flows.test.ts` never touches `@/auth`
// for the same reason. Those three actions are verified against a real
// running dev server instead (see PROGRESS.md), where Next's own bundler
// resolution is what actually runs.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const EMAIL = `login-flow-${suffix}@example.com`

let tenantId = ''

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describeDb('login action wiring', () => {
  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.authToken.deleteMany({ where: { subjectId: tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('requests a magic link identically whether or not the account exists', async () => {
    const tenant = await prisma.tenant.create({
      data: { email: EMAIL, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const real = await requestMagicLinkAction({} as never, form({ email: EMAIL }))
    const fake = await requestMagicLinkAction({} as never, form({ email: `nope-${suffix}@example.com` }))
    expect(real.status).toBe('success')
    expect(fake.status).toBe('success')
    expect(real).toEqual(fake)

    expect(await prisma.authToken.count({ where: { subjectId: tenantId, purpose: 'magic_link' } })).toBe(1)
  })

  it('rejects a missing email before ever touching the database', async () => {
    const result = await requestPasswordResetAction({} as never, form({}))
    expect(result).toMatchObject({ status: 'error', fieldErrors: { email: expect.any(String) } })
  })

  it('requests a password reset for a real account', async () => {
    await requestPasswordResetAction({} as never, form({ email: EMAIL }))
    const tokenRow = await prisma.authToken.findFirstOrThrow({
      where: { subjectId: tenantId, purpose: 'password_reset' },
    })
    // Only the hash is ever queryable back out — same rule as every other
    // token in this codebase (reservations, checkout, magic links).
    expect(tokenRow.tokenHash).toBeDefined()
  })

  it('rejects a reset with mismatched confirmation before ever touching a token', async () => {
    const result = await resetPasswordAction(
      {} as never,
      form({ token: 'irrelevant', password: 'new-password-here', confirmPassword: 'different' }),
    )
    expect(result).toMatchObject({ status: 'error', fieldErrors: { confirmPassword: expect.any(String) } })
  })

  it('rejects a password shorter than 8 characters', async () => {
    const result = await resetPasswordAction(
      {} as never,
      form({ token: 'irrelevant', password: 'short', confirmPassword: 'short' }),
    )
    expect(result).toMatchObject({ status: 'error', fieldErrors: { password: expect.any(String) } })
  })

  it('rejects an invalid or already-used reset token by name, not by field', async () => {
    const result = await resetPasswordAction(
      {} as never,
      form({ token: 'not-a-real-token', password: 'new-password-here', confirmPassword: 'new-password-here' }),
    )
    expect(result).toMatchObject({ status: 'error', fieldErrors: { token: expect.any(String) } })
  })

  it('completes a real reset end to end through the action, not just completePasswordReset directly', async () => {
    const email = `login-flow-complete-${suffix}@example.com`
    const tenant = await prisma.tenant.create({ data: { email, firstName: 'Beau', lastName: 'Renter' } })
    // Minted directly (not through requestPasswordResetAction) because that
    // path only ever emails the raw token — this test needs the raw value in
    // hand, the same reason auth-flows.test.ts does the same for the primitive.
    const { token } = await mintToken({ purpose: 'password_reset', audience: 'tenant', subjectId: tenant.id, email })

    const result = await resetPasswordAction(
      {} as never,
      form({ token, password: 'a-fine-new-password', confirmPassword: 'a-fine-new-password' }),
    )
    expect(result).toMatchObject({ status: 'success' })

    const authenticated = await authenticateWithPassword(email, 'a-fine-new-password', 'tenant')
    expect(authenticated?.id).toBe(tenant.id)

    // Single-use: the same token does not work a second time.
    const second = await resetPasswordAction(
      {} as never,
      form({ token, password: 'another-password-entirely', confirmPassword: 'another-password-entirely' }),
    )
    expect(second).toMatchObject({ status: 'error', fieldErrors: { token: expect.any(String) } })

    await prisma.authToken.deleteMany({ where: { subjectId: tenant.id } })
    await prisma.loginAttempt.deleteMany({ where: { email } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
  })
})
