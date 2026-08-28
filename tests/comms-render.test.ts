import { describe, expect, it } from 'vitest'
import { messageIdempotencyKey, RenderError, renderEmail, renderString } from '../apps/web/lib/comms/render'

// B-030 / PRD 05 FR-9, FR-16. Pure, no database.

describe('merge-field rendering', () => {
  const context = { 'tenant.first_name': 'Ada', 'unit.number': 'B-12', 'facility.name': 'Acme Storage' }

  it('substitutes declared fields', () => {
    expect(renderString('Hi {{tenant.first_name}}, unit {{unit.number}}', context)).toBe('Hi Ada, unit B-12')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderString('Hi {{ tenant.first_name }}', context)).toBe('Hi Ada')
  })

  it('fails loudly when a required field is missing, rather than sending a blank', () => {
    // PRD 02 FR-6 inherited: never mail a blank merge field.
    expect(() => renderString('Balance: {{balance.total}}', context, ['balance.total'])).toThrow(RenderError)
  })

  it('fails loudly when a placeholder has no value even if it was not declared required', () => {
    // A template referencing a field nobody supplied would otherwise mail a
    // literal "{{balance.total}}" to a tenant.
    try {
      renderString('Balance: {{balance.total}}', context)
      throw new Error('expected a RenderError')
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError)
      expect((error as RenderError).missing).toContain('balance.total')
    }
  })

  it('treats an empty-string value as missing', () => {
    expect(() => renderString('Call {{facility.phone}}', { 'facility.phone': '' }, ['facility.phone'])).toThrow(
      RenderError,
    )
  })

  it('renders both parts of an email from the one body', () => {
    const email = renderEmail(
      { subject: 'Welcome {{tenant.first_name}}', bodyText: 'Unit {{unit.number}} is ready', requiredMergeFields: [] },
      context,
    )
    expect(email.subject).toBe('Welcome Ada')
    expect(email.text).toBe('Unit B-12 is ready')
    expect(email.html).toContain('Unit B-12 is ready')
  })

  // PRD 05 FR-9a (B-191 / CN-24 / B-198). A template is ONE document; the HTML
  // part is that document rendered as markup. It used to be one `<p>` with
  // `<br>`s in it, and there used to be a second `bodyHtml` body that could
  // disagree with this one.
  describe('the HTML part', () => {
    const email = () =>
      renderEmail(
        {
          subject: 'Your payment plan at {{facility.name}}',
          bodyText: 'Hi Ada,\n\nLine one.\nLine two.\n\nCall {{facility.phone}}.',
          requiredMergeFields: [],
        },
        { ...context, 'facility.name': 'Bob & Sons <Storage>', 'facility.phone': '512-555-0100' },
      )

    it('declares a language and gives the message one real heading', () => {
      expect(email().html).toContain('<div lang="en">')
      expect(email().html).toContain('<h1>Your payment plan at Bob &amp; Sons &lt;Storage&gt;</h1>')
    })

    it('makes each block a paragraph, keeping single line breaks inside one', () => {
      expect(email().html).toContain('<p>Line one.<br>Line two.</p>')
      expect(email().html).toContain('<p>Hi Ada,</p>')
    })

    it('escapes the merged values rather than emitting them as markup', () => {
      // A facility genuinely called "Bob & Sons <Storage>" used to emit broken
      // HTML into every message it sent.
      expect(email().html).not.toContain('<Storage>')
      expect(email().subject).toBe('Your payment plan at Bob & Sons <Storage>')
    })

    // B-198 / CN-24. The one criterion the old string-only context could not
    // meet: a schedule as a real table. The structured value carries its own
    // markup; the text part still reads as a list.
    describe('a structured merge value', () => {
      const schedule = {
        text: '1. September 15, 2026 — $600.00\n2. October 15, 2026 — $600.00',
        html: '<table><caption>Your payment plan</caption><tr><th scope="row">1</th></tr></table>',
      }
      const planEmail = (body: string) =>
        renderEmail({ subject: 'Your plan', bodyText: body, requiredMergeFields: ['plan.schedule'] }, {
          ...context,
          'plan.schedule': schedule,
        })

      it('contributes its own markup, unwrapped, when it owns its paragraph', () => {
        // A <table> inside a <p> is invalid: the browser closes the paragraph
        // early and strands the caption.
        const html = planEmail('Here it is:\n\n{{plan.schedule}}\n\nCall us.').html
        expect(html).toContain(`<caption>Your payment plan</caption>`)
        expect(html).toContain('<th scope="row">1</th>')
        expect(html).not.toContain('<p><table')
      })

      it('gives the text part the list, not the markup', () => {
        const text = planEmail('Here it is:\n\n{{plan.schedule}}').text
        expect(text).toContain('1. September 15, 2026 — $600.00')
        expect(text).not.toContain('<table>')
      })

      it('still renders, escaped-free but inline, when a staffer moves it into a sentence', () => {
        expect(planEmail('Your plan: {{plan.schedule}}').html).toContain('<table>')
      })

      it('counts as missing when it has no installments', () => {
        expect(() =>
          renderEmail({ subject: 'S', bodyText: '{{plan.schedule}}', requiredMergeFields: ['plan.schedule'] }, {
            'plan.schedule': { text: '', html: '' },
          }),
        ).toThrow(RenderError)
      })
    })
  })
})

describe('idempotency key', () => {
  it('is deterministic for the same inputs', () => {
    expect(messageIdempotencyKey('e1', 'r1', 't1', 'email')).toBe(messageIdempotencyKey('e1', 'r1', 't1', 'email'))
  })

  it('differs by event, rule, recipient and channel — so the fallback pair never collides', () => {
    const base = messageIdempotencyKey('e1', 'r1', 't1', 'email')
    expect(messageIdempotencyKey('e2', 'r1', 't1', 'email')).not.toBe(base)
    expect(messageIdempotencyKey('e1', 'r2', 't1', 'email')).not.toBe(base)
    expect(messageIdempotencyKey('e1', 'r1', 't2', 'email')).not.toBe(base)
    expect(messageIdempotencyKey('e1', 'r1', 't1', 'sms')).not.toBe(base)
  })
})
