import { describe, expect, it } from 'vitest'
import { isPortalPathActive } from '../apps/web/lib/portal/nav-match'

// B-372. `/portal/payment-plan` marked Pay current in both navs.
describe('isPortalPathActive', () => {
  it('matches /portal exactly, so it is not current on every route below it', () => {
    expect(isPortalPathActive('/portal', '/portal')).toBe(true)
    expect(isPortalPathActive('/portal/pay', '/portal')).toBe(false)
  })

  it('does not treat /portal/pay as a prefix of /portal/payment-plan', () => {
    expect(isPortalPathActive('/portal/payment-plan', '/portal/pay')).toBe(false)
    expect(isPortalPathActive('/portal/payment-plan', '/portal/payment-plan')).toBe(true)
  })

  it('ignores the query and fragment on the href', () => {
    expect(isPortalPathActive('/portal/pay', '/portal/pay?lease=abc')).toBe(true)
    expect(isPortalPathActive('/portal', '/portal#gate-code')).toBe(true)
  })

  it('matches a child route of the href', () => {
    expect(isPortalPathActive('/portal/pay/done', '/portal/pay')).toBe(true)
  })
})
