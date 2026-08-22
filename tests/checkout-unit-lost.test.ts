import { describe, expect, it } from 'vitest'
import { alternativeSizes } from '../apps/web/lib/checkout/session'
import { phoneFor } from '../apps/web/components/marketing/call-link'
import { SITE } from '../apps/web/lib/site-config'

// B-149 / PRD 01 FR-4.1. What the unit-lost branch is allowed to offer.

const type = (unitTypeId: string, availableCount: number) => ({ unitTypeId, availableCount })

describe('alternativeSizes', () => {
  it('never offers back the size that was just lost', () => {
    const rows = [type('lost', 3), type('other', 2)]
    expect(alternativeSizes(rows, 'lost').map((row) => row.unitTypeId)).toEqual(['other'])
  })

  it('drops sizes with nothing rentable behind them', () => {
    const rows = [type('a', 0), type('b', 1)]
    expect(alternativeSizes(rows, 'lost').map((row) => row.unitTypeId)).toEqual(['b'])
  })

  it('returns nothing when the facility is full, so the branch falls to the waitlist', () => {
    expect(alternativeSizes([type('lost', 0), type('other', 0)], 'lost')).toEqual([])
  })
})

describe('phoneFor', () => {
  it('prefers the facility line and dials it without the formatting', () => {
    expect(phoneFor('(512) 555-0100')).toEqual({
      href: '5125550100',
      display: '(512) 555-0100',
      isMain: false,
    })
  })

  it('falls back to the org line and says so, so a transfer is no surprise', () => {
    expect(phoneFor(null)).toEqual({
      href: SITE.phone.href,
      display: SITE.phone.display,
      isMain: true,
    })
  })
})
