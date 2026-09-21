import { describe, expect, it, vi } from 'vitest'

// B-342. The business-account access mail is unrequested, so it must not be
// framed as a password reset — that is what people are trained to delete as
// phishing — and its recovery line links `/forgot-password` rather than naming it.

const sendDirectEmail = vi.fn(async (_args: { subject: string; text: string; html: string }) => ({
  id: 'msg',
}))
vi.mock('../apps/web/lib/comms/service', () => ({ sendDirectEmail }))

const { sendAuthEmail } = await import('../apps/web/lib/auth/send-auth-email')
const { proseFor } = await import('../apps/web/lib/comms/prose')

const RESET = /reset|restablec/i

for (const locale of ['en', 'es'] as const) {
  describe(`account-access email (${locale})`, () => {
    it('is not framed as a reset, and links the recovery page', async () => {
      await sendAuthEmail({
        to: 'member@example.com',
        purpose: 'password_reset',
        url: 'https://example.test/reset-password?token=t',
        expiresAt: new Date(Date.now() + 60 * 60_000),
        locale,
        accountName: 'Vance Roofing',
      })
      const { subject, text, html } = sendDirectEmail.mock.calls.at(-1)![0]
      const say = proseFor(locale).direct

      expect(subject).not.toMatch(RESET)
      expect(subject).toContain('Vance Roofing')
      expect(text).toContain(say.authAccountAccessIntro)
      expect(say.authAccountAccessIntro).not.toMatch(RESET)
      expect(text).not.toContain(say.authIntro.password_reset)

      const recovery = say.authAccountAccessRecovery('https://example.test/forgot-password')
      expect(text).toContain(recovery)
      expect(html).toContain('<a href="https://example.test/forgot-password">')
    })
  })
}

it('leaves the ordinary reset email as it was', async () => {
  await sendAuthEmail({
    to: 'tenant@example.com',
    purpose: 'password_reset',
    url: 'https://example.test/reset-password?token=t',
    expiresAt: new Date(Date.now() + 60 * 60_000),
    locale: 'en',
  })
  const { subject, text } = sendDirectEmail.mock.calls.at(-1)![0]
  expect(subject).toMatch(/^Reset your /)
  expect(text).toContain('Use this link to choose a new password:')
  expect(text).not.toContain('forgot-password')
})
