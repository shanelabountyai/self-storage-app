import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// K10 (scorecard 2026-11-13). In a deployed production with no mail provider a
// sign-in link must fail loudly, not "send" through the log-only provider and
// print the live link to the function log.

const sendDirectEmail = vi.fn(async (_args: unknown) => ({ sent: true }))
vi.mock('../apps/web/lib/comms/service', () => ({ sendDirectEmail }))

const { sendAuthEmail } = await import('../apps/web/lib/auth/send-auth-email')

const args = {
  to: 'renter@example.com',
  purpose: 'magic_link' as const,
  url: 'https://example.test/login/magic?token=secret-token-value',
  expiresAt: new Date(Date.now() + 15 * 60_000),
  locale: 'en' as const,
}

const saved = { vercel: process.env.VERCEL_ENV, resend: process.env.RESEND_API_KEY }
let info: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sendDirectEmail.mockClear()
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  info.mockRestore()
  for (const [key, value] of [
    ['VERCEL_ENV', saved.vercel],
    ['RESEND_API_KEY', saved.resend],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('K10: sign-in email in production', () => {
  it('throws, sends nothing and logs nothing when production has no provider', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.RESEND_API_KEY
    await expect(sendAuthEmail(args)).rejects.toThrow(/RESEND_API_KEY/)
    expect(sendDirectEmail).not.toHaveBeenCalled()
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret-token-value')
  })

  it('sends and never logs the link in production with a provider', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.RESEND_API_KEY = 're_test'
    await sendAuthEmail(args)
    expect(sendDirectEmail).toHaveBeenCalledTimes(1)
    expect(info).not.toHaveBeenCalled()
  })

  it('still prints the link locally with no provider, for development sign-in', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.RESEND_API_KEY
    await sendAuthEmail(args)
    expect(JSON.stringify(info.mock.calls)).toContain('secret-token-value')
  })
})
