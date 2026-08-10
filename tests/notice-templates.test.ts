import { describe, expect, it } from 'vitest'
import {
  EXAMPLE_SALE_STATEMENTS,
  EXAMPLE_TEMPLATE_LABEL,
  EXAMPLE_TEMPLATES,
  NOTICE_DISCLAIMER,
  NOTICE_TYPES,
  REQUIRED_NOTICE_FIELDS,
  validateNoticeTemplate,
} from '../packages/core/notices/templates'
import {
  canDeliver,
  DELIVERY_PROOF_FIELDS,
  isElectronicDelivery,
  missingDeliveryProof,
  NOTICE_DELIVERY_METHODS,
} from '../packages/core/notices/delivery'
import { renderTemplate, MissingMergeFieldsError } from '../apps/web/lib/documents/render'

// B-061 / PRD 02 §4.6 US-27, US-29, §4.2 US-13.

describe('validateNoticeTemplate — US-27’s required facts', () => {
  const complete = REQUIRED_NOTICE_FIELDS.map((field) => `{{${field}}}`).join(' ')

  it('accepts a template carrying every required field', () => {
    expect(validateNoticeTemplate(complete)).toEqual([])
  })

  it('refuses an empty template', () => {
    expect(validateNoticeTemplate('   ')).toHaveLength(1)
  })

  it.each(REQUIRED_NOTICE_FIELDS)('refuses a template missing %s', (field) => {
    const body = complete.replace(`{{${field}}}`, '')
    const problems = validateNoticeTemplate(body)
    expect(problems.map((one) => one.field)).toContain(field)
  })

  it('refuses at SAVE time, not only at render time', () => {
    // An operator must not discover their template is unusable on day 15 of a
    // lien cycle with a statutory clock running.
    const withoutDeadline = complete.replace('{{deadlineDate}}', '')
    expect(validateNoticeTemplate(withoutDeadline).length).toBeGreaterThan(0)
  })
})

describe('the example templates — US-29’s guardrails', () => {
  it.each(NOTICE_TYPES)('%s passes its own validation, so it can be saved unedited', (type) => {
    expect(validateNoticeTemplate(EXAMPLE_TEMPLATES[type].body)).toEqual([])
  })

  it.each(NOTICE_TYPES)('%s carries the disclaimer in its own body', (type) => {
    // On the face of the document, not just on the editing screen: a notice
    // generated from an unedited draft has to say it is a draft to whoever
    // reads it.
    expect(EXAMPLE_TEMPLATES[type].body).toContain(NOTICE_DISCLAIMER)
  })

  it('says plainly that nothing here is legal advice or state-compliant', () => {
    const text = NOTICE_DISCLAIMER.toLowerCase()
    expect(text).toContain('not legal advice')
    expect(text).toContain('attorney')
    expect(text).toContain('state')
  })

  it('labels the example as an example, in its own name', () => {
    expect(EXAMPLE_TEMPLATE_LABEL.toLowerCase()).toContain('example')
    expect(EXAMPLE_TEMPLATE_LABEL.toLowerCase()).toContain('not legal advice')
  })

  it.each(NOTICE_TYPES)('%s hedges the sale statement rather than asserting the law', (type) => {
    // "Governed by state law" is the honest version. A draft that stated a
    // specific statutory consequence would be exactly the false authority
    // US-29 exists to prevent.
    expect(EXAMPLE_SALE_STATEMENTS[type].toLowerCase()).toContain('state law')
  })

  it('renders end to end once every merge value is supplied', () => {
    const values = Object.fromEntries(REQUIRED_NOTICE_FIELDS.map((field) => [field, `value-${field}`]))
    const html = renderTemplate(EXAMPLE_TEMPLATES.lien.body, values)
    expect(html).toContain('value-deadlineDate')
    expect(html).toContain('value-claimTotal')
  })

  it('fails loudly rather than rendering a notice with a hole in it', () => {
    // PRD 02 FR-6. "Dear ____" on a lien notice is a legal artifact with a gap.
    const values = Object.fromEntries(
      REQUIRED_NOTICE_FIELDS.filter((field) => field !== 'deadlineDate').map((field) => [field, 'x']),
    )
    expect(() => renderTemplate(EXAMPLE_TEMPLATES.lien.body, values)).toThrow(MissingMergeFieldsError)
  })
})

describe('delivery methods and their proof', () => {
  it.each(NOTICE_DELIVERY_METHODS)('%s requires some proof — none is a free pass', (method) => {
    expect(DELIVERY_PROOF_FIELDS[method].length).toBeGreaterThan(0)
    expect(missingDeliveryProof(method, null)).toEqual([...DELIVERY_PROOF_FIELDS[method]])
  })

  it('wants a tracking number for certified mail', () => {
    expect(missingDeliveryProof('certified_mail', { tracking_number: '9400 1234' })).toEqual([])
    expect(missingDeliveryProof('certified_mail', { note: 'posted it' })).toEqual(['tracking_number'])
  })

  it('wants a photo for a notice posted on the unit', () => {
    // The claim a tenant most easily denies.
    expect(missingDeliveryProof('posted_on_unit', { note: 'stuck it on the door' })).toEqual([
      'photo_reference',
    ])
  })

  it('treats a blank string as missing, not as present', () => {
    expect(missingDeliveryProof('certified_mail', { tracking_number: '   ' })).toEqual(['tracking_number'])
  })

  it('counts only email as electronic service', () => {
    for (const method of NOTICE_DELIVERY_METHODS) {
      expect(isElectronicDelivery(method)).toBe(method === 'email')
    }
  })
})

describe('canDeliver — US-13’s notice_email consent', () => {
  it('allows mail without asking about consent at all', () => {
    expect(
      canDeliver({
        method: 'certified_mail',
        proof: { tracking_number: '9400 1234' },
        noticeEmailConsent: null,
      }),
    ).toEqual({ allowed: true })
  })

  it('allows email when the tenant granted notice-by-email consent', () => {
    expect(
      canDeliver({
        method: 'email',
        proof: { email_address: 'ada@example.com' },
        noticeEmailConsent: 'granted',
      }),
    ).toEqual({ allowed: true })
  })

  it('refuses email when nobody ever asked', () => {
    // Texas permits electronic notice only where the tenant agreed. Never
    // having been asked is not agreement.
    const verdict = canDeliver({
      method: 'email',
      proof: { email_address: 'ada@example.com' },
      noticeEmailConsent: null,
    })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.reason).toContain('never been asked')
  })

  it('refuses email when consent was withdrawn, and says so differently', () => {
    // Never-asked and said-no need different things from the person at the
    // counter, so the messages must not collapse into one.
    const verdict = canDeliver({
      method: 'email',
      proof: { email_address: 'ada@example.com' },
      noticeEmailConsent: 'revoked',
    })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.reason).toContain('withdrawn')

    const neverAsked = canDeliver({
      method: 'email',
      proof: { email_address: 'ada@example.com' },
      noticeEmailConsent: null,
    })
    if (neverAsked.allowed) throw new Error('unreachable')
    expect(verdict.reason).not.toEqual(neverAsked.reason)
  })

  it('checks proof before consent, so a missing tracking number is reported plainly', () => {
    const verdict = canDeliver({ method: 'certified_mail', proof: {}, noticeEmailConsent: null })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.missingProof).toEqual(['tracking_number'])
  })
})
