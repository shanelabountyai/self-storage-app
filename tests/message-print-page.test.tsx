import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagePrint } from '../apps/web/lib/admin/message-print'

// B-340. The print page, rendered: the print-time line outside the letter, no
// Print control on an incomplete address, and accessible names that start with
// the visible words (SC 2.5.3).

let letter: MessagePrint

vi.mock('@/lib/admin/context', () => ({ getAdminActor: async () => ({ kind: 'staff' }) }))
vi.mock('@/app/admin/messages/actions', () => ({ printLetterAction: async () => ({}) }))
vi.mock('@/lib/admin/message-print', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/web/lib/admin/message-print')>()),
  messageForPrint: async () => letter,
}))

const { default: MessagePrintPage } = await import('../apps/web/app/admin/messages/[messageId]/print/page')
const { printForMailingName } = await import('../apps/web/lib/admin/message-print')

const BODY = 'Your rent is past due.\n\nPay here: https://example.com/pay/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd'
const ADDRESS = { name: 'Cash Renter', line1: '77 New Street', line2: null, city: 'Austin', state: 'TX', postalCode: '78704' }

async function render(): Promise<string> {
  return renderToStaticMarkup(await MessagePrintPage({ params: Promise.resolve({ messageId: 'm1' }) }))
}

/// Every aria-label on the page, paired with the visible text of its element.
function namedControls(html: string): Array<{ name: string; visible: string }> {
  return [...html.matchAll(/<(a|button)[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({
    name: m[2]!,
    visible: m[3]!.replace(/<[^>]+>/g, '').trim(),
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-21T15:00:00Z'))
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://storage.example')
  letter = {
    messageId: 'm1',
    tenantId: 't1',
    facilityId: 'f1',
    tenantName: 'Cash Renter',
    facilityName: 'Print Test',
    facilityPhone: '(512) 555-0100',
    timezone: 'America/Chicago',
    subject: 'Your rent is past due',
    body: BODY,
    createdAt: new Date('2026-09-01T15:00:00Z'),
    to: { ok: true, address: ADDRESS },
    from: { ok: true, address: { ...ADDRESS, name: 'Print Test', line1: '1 Storage Way' } },
    openTaskId: 'task1',
  }
})

describe('the letter print page', () => {
  it('adds a print-time line outside the letter, and leaves the stored body unchanged', async () => {
    const html = await render()

    const [article, after] = html.slice(html.indexOf('<article')).split('</article>')
    // CN-18: the stored bytes, verbatim.
    expect(article).toContain(BODY.replace(/&/g, '&amp;'))
    // The composed date is still the letter's date.
    expect(article).toContain('September 1, 2026')
    // SC 1.3.1: the print-time line is not part of the letter.
    expect(article).not.toContain('Printed September')
    expect(after).toContain(
      'Printed September 21, 2026. To pay, call (512) 555-0100 or sign in at storage.example/login.',
    )
  })

  it('without a facility phone, the line offers sign-in only', async () => {
    letter = { ...letter, facilityPhone: null }
    expect(await render()).toContain('Printed September 21, 2026. To pay, sign in at storage.example/login.')
  })

  it('offers no Print control on an incomplete address, and names the gap', async () => {
    letter = { ...letter, to: { ok: false, missing: ['city', 'postal code'] } }
    const html = await render()

    expect(html).not.toContain('<button')
    expect(html).toContain('missing its city, postal code')
  })

  it('names each control starting with its visible label', async () => {
    for (const closesTask of [true, false]) {
      letter = { ...letter, openTaskId: closesTask ? 'task1' : null }
      const controls = namedControls(await render())
      expect(controls.length).toBeGreaterThan(0)
      for (const { name, visible } of controls) expect(name.startsWith(visible)).toBe(true)
    }
  })

  it("the profile's print link starts with its visible label and never speaks a template key", () => {
    expect(printForMailingName('Your rent is past due')).toBe('Print this for mailing: Your rent is past due')
    // No subject: the visible text is the whole name — never `invoice_past_due`.
    expect(printForMailingName(null)).toBeUndefined()
  })
})
