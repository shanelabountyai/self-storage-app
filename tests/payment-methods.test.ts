import { describe, expect, it } from 'vitest'
import {
  ACH_SETTLEMENT_BUSINESS_DAYS,
  methodsFor,
  offersBankDebit,
  settlementNotice,
} from '../packages/core/billing'

// B-103 / PRD 01 §3: "Methods: cards, Apple Pay, Google Pay, Link, and ACH bank
// debit (ACH: portal payments and autopay; optional at checkout)."
//
// The policy is small and every clause of it is a money decision, so it is
// pinned here rather than left implicit in two call sites.

const OPTED_IN = { achAtCheckoutEnabled: true }
const OPTED_OUT = { achAtCheckoutEnabled: false }

describe('methodsFor', () => {
  it('always offers card and Link', () => {
    // Card covers Apple Pay and Google Pay — they are wallets over a card, and
    // the Payment Element surfaces them itself. Link needs no facility switch:
    // it is a faster way to present a card, not a different kind of money.
    for (const surface of ['checkout', 'portal', 'setup', 'counter'] as const) {
      expect(methodsFor(surface, OPTED_OUT)).toContain('card')
      expect(methodsFor(surface, OPTED_OUT)).toContain('link')
    }
  })

  it('offers bank debit in the portal whatever the facility says', () => {
    // The tenant already has the unit. A debit that bounces four days later is
    // an unpaid balance — exactly what the dunning ladder is for.
    expect(offersBankDebit('portal', OPTED_OUT)).toBe(true)
    expect(offersBankDebit('portal', OPTED_IN)).toBe(true)
  })

  it('offers bank debit for autopay setup whatever the facility says', () => {
    // §3 names autopay-on-a-bank-account first, and it is the cheapest money
    // this business can take.
    expect(offersBankDebit('setup', OPTED_OUT)).toBe(true)
  })

  it('withholds bank debit at checkout unless the operator opted in', () => {
    // A move-in hands over a unit and a gate code. That is the risk the
    // per-facility switch exists to let an operator decline.
    expect(offersBankDebit('checkout', OPTED_OUT)).toBe(false)
    expect(offersBankDebit('checkout', OPTED_IN)).toBe(true)
  })

  it('never offers bank debit at the counter, however the facility is set (B-230)', () => {
    // Somebody is at the desk wanting their gate to reopen now, and a debit
    // that clears in four business days does not do that — they would leave
    // believing they had paid while the delinquency hold stayed on.
    //
    // Both polarities, because the bug this guards against is invisible in
    // one of them: the ACH rule used to be written as `else if
    // (achAtCheckoutEnabled)`, a rule about ONE surface expressed as a rule
    // about every surface that is not portal or setup. Adding `counter` would
    // have silently handed it bank debit at every facility with ACH at
    // checkout switched on, and a test that only checked OPTED_OUT would have
    // passed.
    expect(offersBankDebit('counter', OPTED_OUT)).toBe(false)
    expect(offersBankDebit('counter', OPTED_IN)).toBe(false)
  })

  it('never returns a duplicate method', () => {
    for (const surface of ['checkout', 'portal', 'setup', 'counter'] as const) {
      const methods = methodsFor(surface, OPTED_IN)
      expect(new Set(methods).size).toBe(methods.length)
    }
  })
})

describe('settlementNotice', () => {
  it('says how long and promises no late fee', () => {
    // Both halves matter. "About four business days" stops the support call;
    // "no late fee" is the thing the tenant is actually worried about, and it
    // is a promise the late-fee job keeps (`leasesWithSettlingPayment`).
    const notice = settlementNotice('bank')
    expect(notice).toContain(`${ACH_SETTLEMENT_BUSINESS_DAYS} business days`)
    expect(notice).toMatch(/late fee/i)
  })
})
