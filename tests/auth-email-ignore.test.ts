import { beforeEach, describe, expect, it, vi } from 'vitest'

// B-300. The one branch in `sendAuthEmail`'s text assembly, in both languages.
//
// "If you did not request this, you can ignore this email" is true of a magic
// link and a self-served password reset, and FALSE of the one auth mail that
// staff cause: B-287's business-account access mail tells a member they were
// given sight of an account, and a recipient who follows the ignore sentence
// discards the access the mail exists to give them. It shipped on every one of
// them because `authExpiry` carried both sentences in one string.

// Typed on `text` alone: that is the only field this row asserts, and a full
// `SendDirectArgs` here would make the test track every unrelated field the
// real signature grows.
const sendDirectEmail = vi.fn(async (_args: { text: string }) => ({ id: 'msg' }))
vi.mock('../apps/web/lib/comms/service', () => ({ sendDirectEmail }))

const { sendAuthEmail } = await import('../apps/web/lib/auth/send-auth-email')

const base = {
  to: 'member@example.com',
  purpose: 'password_reset' as const,
  url: 'https://example.test/reset?token=t',
  expiresAt: new Date(Date.now() + 30 * 60_000),
}

function textOf(): string {
  return sendDirectEmail.mock.calls.at(-1)![0].text
}

beforeEach(() => sendDirectEmail.mockClear())

describe('sendAuthEmail', () => {
  it('tells a self-served reset it can be ignored', async () => {
    await sendAuthEmail({ ...base, locale: 'en' })
    expect(textOf()).toContain('you can ignore this email')
  })

  it('does NOT tell a business-account member to ignore it', async () => {
    await sendAuthEmail({ ...base, locale: 'en', accountName: 'Vance Roofing' })
    const text = textOf()
    expect(text).toContain('gave you access to see the business account Vance Roofing')
    expect(text).not.toContain('ignore this email')
    // The expiry half is still said — it is the true half.
    expect(text).toContain('This link expires in 30 minutes.')
  })

  it('draws the same line in Spanish', async () => {
    await sendAuthEmail({ ...base, locale: 'es' })
    expect(textOf()).toContain('puede ignorar este correo')

    await sendAuthEmail({ ...base, locale: 'es', accountName: 'Techos Vance' })
    const text = textOf()
    expect(text).not.toContain('ignorar este correo')
    expect(text).toContain('vence en 30 minutos')
  })
})
