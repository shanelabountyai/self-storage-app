import { describe, expect, it } from 'vitest'
import {
  apiKeyMode,
  keyAllowed,
  letterRequest,
  mailingAddress,
  noticeTypeLabel,
  proofFromLetter,
  type MailingAddress,
} from '../packages/core/notices'

// PRD 02 §4.6 US-30 (B-083). Certified mail, the pure half.

const ADDRESS: MailingAddress = {
  name: 'Ada Renter',
  line1: '400 Congress Ave',
  line2: 'Apt 12',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
}

describe('the mailing address', () => {
  it('accepts a complete one and trims it', () => {
    const result = mailingAddress({
      name: '  Ada Renter ',
      line1: ' 400 Congress Ave',
      line2: ' Apt 12 ',
      city: 'Austin ',
      state: ' TX',
      postalCode: '78701 ',
    })
    expect(result).toEqual({ ok: true, address: ADDRESS })
  })

  it('treats line 2 as genuinely optional', () => {
    const result = mailingAddress({ ...ADDRESS, line2: '   ' })
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.address.line2).toBeNull()
  })

  it('names every missing part rather than saying the address is bad', () => {
    // A letter posted with a blank city comes back — AFTER the deadline the
    // notice sets — so this refuses, and it has to say what to go and fix.
    const result = mailingAddress({ ...ADDRESS, city: '', postalCode: null })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.missing).toEqual(['city', 'postal code'])
  })

  it('refuses a name-only address', () => {
    const result = mailingAddress({
      name: 'Ada Renter',
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
    })
    expect(result.ok === false && result.missing).toHaveLength(4)
  })
})

describe('the letter request', () => {
  it('always asks for the certified extra service', () => {
    // Without it the provider posts an ordinary letter that looks identical in
    // our records and is not certified mail in a courtroom.
    const request = letterRequest({
      noticeId: 'ntc_1',
      noticeLabel: 'Lien notice',
      to: ADDRESS,
      from: { ...ADDRESS, name: 'Demo Storage' },
      html: '<p>owed</p>',
    })
    expect(request.extraService).toBe('certified')
    expect(request.color).toBe(false)
    expect(request.doubleSided).toBe(false)
  })

  it('puts the notice id in the description so a letter traces back', () => {
    const request = letterRequest({
      noticeId: 'ntc_1',
      noticeLabel: 'Lien notice',
      to: ADDRESS,
      from: ADDRESS,
      html: '<p>owed</p>',
    })
    expect(request.description).toContain('ntc_1')
    expect(request.description).toContain('Lien notice')
  })
})

describe('the proof that comes back', () => {
  it('records the tracking number and the extras the provider actually sent', () => {
    const result = proofFromLetter({
      id: 'ltr_abc',
      tracking_number: '9407 1111 2222 3333',
      carrier: 'USPS',
      expected_delivery_date: '2026-08-25',
      url: 'https://lob.com/letters/ltr_abc',
    })
    expect(result).toEqual({
      ok: true,
      proof: {
        tracking_number: '9407 1111 2222 3333',
        provider_id: 'ltr_abc',
        carrier: 'USPS',
        expected_delivery: '2026-08-25',
        provider_url: 'https://lob.com/letters/ltr_abc',
      },
    })
  })

  it('omits an absent extra rather than recording an empty one', () => {
    // An empty string in an evidence field reads as "we asked and got nothing";
    // an absent key reads as "we did not ask". Only the second is true.
    const result = proofFromLetter({ tracking_number: '9407', carrier: '   ' })
    expect(result.ok === true && result.proof).toEqual({ tracking_number: '9407' })
  })

  it('REFUSES a response with no tracking number', () => {
    // The load-bearing one. A delivery recorded without a tracking number
    // produces a Notice row that reads as served, satisfies the auction
    // pipeline's served-notice precondition, and has nothing behind it.
    for (const response of [{}, { tracking_number: '' }, { tracking_number: '  ' }, { tracking_number: 42 }]) {
      const result = proofFromLetter(response)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('no tracking number')
    }
  })

  it('warns that the letter may already be in the post', () => {
    // The refusal has to stop somebody pressing send again blindly: the
    // provider accepted it, so a second press without checking is a second
    // legal notice in the post.
    const result = proofFromLetter({})
    expect(result.ok === false && result.reason).toContain('already be in the post')
  })
})

describe('which API key may be used where', () => {
  it('reads the mode off the provider prefix', () => {
    expect(apiKeyMode('test_abc123')).toBe('test')
    expect(apiKeyMode('  live_abc123 ')).toBe('live')
    expect(apiKeyMode('abc123')).toBe('unknown')
  })

  it('allows the two correct pairings and nothing else', () => {
    expect(keyAllowed('test', false)).toEqual({ allowed: true })
    expect(keyAllowed('live', true)).toEqual({ allowed: true })
  })

  it('refuses a live key outside production, because post cannot be recalled', () => {
    // Email has a sandbox inbox for this (FR-20). Physical mail has no such
    // thing, so the refusal is absolute rather than redirected.
    const verdict = keyAllowed('live', false)
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('cannot be recalled')
  })

  it('refuses a test key IN production, because it fabricates proof', () => {
    // The quieter and worse direction: a valid-looking tracking number for a
    // letter that was never posted, written into a lien file. That is the
    // fabricated evidence this module refuses to build a simulator for,
    // arrived at through a configuration mistake.
    const verdict = keyAllowed('test', true)
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('mails nothing')
  })

  it('refuses a key it cannot classify rather than guessing', () => {
    const verdict = keyAllowed('unknown', true)
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('neither a test key nor a live key')
  })
})

describe('notice type labels', () => {
  it('covers the whole database enum, not only the two lien types', () => {
    // Both admin screens render `notice.type` straight from the database and
    // used to hold two-entry maps, so a late notice printed as `late_notice`.
    expect(noticeTypeLabel('late_notice')).toBe('Late notice')
    expect(noticeTypeLabel('pre_lien')).toBe('Pre-lien notice')
    expect(noticeTypeLabel('lien')).toBe('Lien notice')
    expect(noticeTypeLabel('auction')).toBe('Auction notice')
    expect(noticeTypeLabel('rate_change')).toBe('Rate-change notice')
    expect(noticeTypeLabel('move_out')).toBe('Move-out notice')
  })

  it('falls back to the raw value rather than a blank on an unknown type', () => {
    expect(noticeTypeLabel('something_new')).toBe('something_new')
  })
})
