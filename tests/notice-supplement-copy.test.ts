import { describe, expect, it } from 'vitest'
import { COMMS_RULES, COMMS_TEMPLATES } from '../packages/db/comms-catalog'

// B-063 / PRD 05 CN-12. "The message never claims to *be* the statutory
// notice; template copy states a formal notice was sent per the lease/state
// law." Checked against the actual seeded text, the same way B-056 checks the
// delinquency-timeline disclaimer — a courtesy email that reads like service
// of process is worse than no email, because it invites a tenant to argue they
// were served by something that is not the notice.

const SUPPLEMENT_KEYS = ['pre_lien_notice_supplement', 'lien_notice_supplement'] as const

function templateFor(key: string) {
  const template = COMMS_TEMPLATES.find((one) => one.key === key)
  if (!template) throw new Error(`No seeded template for ${key}`)
  return template
}

// Phrasing that would read as the email BEING the notice, rather than
// describing one sent separately. None of these may appear anywhere in the
// supplement bodies.
const CLAIMS_TO_BE_THE_NOTICE = [
  /this email is your (formal )?notice/i,
  /this (email|message) constitutes/i,
  /this serves as (your )?(formal )?notice/i,
  /consider this your notice/i,
]

describe('pre-lien/lien courtesy supplements — CN-12’s own rule', () => {
  it.each(SUPPLEMENT_KEYS)('%s says plainly it is a courtesy, not the notice', (key) => {
    const body = templateFor(key).bodyText.toLowerCase()
    expect(body).toContain('courtesy')
    expect(body).toContain('not the formal notice')
  })

  it.each(SUPPLEMENT_KEYS)('%s says the real notice went by mail', (key) => {
    const body = templateFor(key).bodyText.toLowerCase()
    expect(body).toContain('by mail')
  })

  it.each(SUPPLEMENT_KEYS)('%s references the lease and state law, not a specific statute', (key) => {
    // "As required by your lease and state law" — never a claim to know which
    // law, which is the false-authority US-29 already guards against for the
    // timeline and B-061 guards for the notice templates themselves.
    const body = templateFor(key).bodyText.toLowerCase()
    expect(body).toContain('lease and state law')
  })

  it.each(SUPPLEMENT_KEYS)('%s never uses language that claims to BE the notice', (key) => {
    const text = `${templateFor(key).subject} ${templateFor(key).bodyText}`
    for (const pattern of CLAIMS_TO_BE_THE_NOTICE) {
      expect(text, `${key} matched ${pattern}`).not.toMatch(pattern)
    }
  })

  it.each(SUPPLEMENT_KEYS)('%s quotes the balance and deadline from the notice, not a live figure', (key) => {
    // These come off the generated document's own snapshot (packages/db's
    // `Notice.claimTotalCents`/`deadlineDate`), never a re-derived balance —
    // an email disagreeing with the notice it describes would be worse than
    // not sending one.
    const template = templateFor(key)
    expect(template.bodyText).toContain('{{notice.balance}}')
    expect(template.bodyText).toContain('{{notice.deadline_date}}')
    expect(template.requiredMergeFields).toContain('notice.balance')
    expect(template.requiredMergeFields).toContain('notice.deadline_date')
  })

  it('the lien supplement explains the sale consequence; the pre-lien one does not overreach', () => {
    expect(templateFor('lien_notice_supplement').bodyText.toLowerCase()).toContain('sold')
    // The pre-lien stage has not reached a sale yet — stating one here would
    // overstate what the actual pre-lien notice says.
    expect(templateFor('pre_lien_notice_supplement').bodyText.toLowerCase()).not.toContain('sold')
  })

  it('each supplement is wired to notice.generated, filtered to its own type', () => {
    const preLienRule = COMMS_RULES.find((r) => r.templateKey === 'pre_lien_notice_supplement')!
    const lienRule = COMMS_RULES.find((r) => r.templateKey === 'lien_notice_supplement')!

    expect(preLienRule.event).toBe('notice.generated')
    expect(lienRule.event).toBe('notice.generated')
    expect(preLienRule.skipConditions).toContain('notice_type_not_pre_lien')
    expect(lienRule.skipConditions).toContain('notice_type_not_lien')
  })
})

describe('the overlock stage notices — CN-11’s remaining pair', () => {
  it('says what happened without moralising, states the amount, and how it stops', () => {
    const body = templateFor('unit_overlocked').bodyText.toLowerCase()
    expect(body).toContain('lock')
    expect(body).toContain('{{balance.total}}'.toLowerCase())
    expect(body).toContain('safe')
  })

  it('is a real pair — both transitions are notified, per D-16’s precedent', () => {
    expect(COMMS_RULES.some((r) => r.event === 'overlock.required')).toBe(true)
    expect(COMMS_RULES.some((r) => r.event === 'overlock.cleared')).toBe(true)
  })
})
