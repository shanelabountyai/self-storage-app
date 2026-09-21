import { describe, expect, it } from 'vitest'
import { COMMS_TEMPLATES } from '../packages/db/comms-catalog'
import { en } from '../apps/web/lib/i18n/en'

// B-345 (D-15). Customer English is US English. B-182 removed "ring the
// office"; this catches the next British "post" (mail) before it ships.
const BRITISH = /in the post|post to you|ring the office/i

describe('customer English is US English', () => {
  it('the en dictionary', () => {
    expect(Object.entries(en).filter(([, text]) => BRITISH.test(String(text)))).toEqual([])
  })

  it('the English template catalog', () => {
    const hits = COMMS_TEMPLATES.filter(({ subject, bodyText }) => BRITISH.test(`${subject ?? ''} ${bodyText}`))
    expect(hits.map((template) => template.key)).toEqual([])
  })
})
