import { describe, expect, it } from 'vitest'
import {
  cashNeedsApproval,
  requiresAttribution,
  settleTender,
} from '../packages/core/pos'

// B-039 / PRD 02 US-32. Pure counter arithmetic — no database, no session.

describe('settleTender', () => {
  it('computes change for cash', () => {
    expect(settleTender({ method: 'cash', amountCents: 16_100, tenderedCents: 20_000 })).toEqual({
      ok: true,
      amountCents: 16_100,
      tenderedCents: 20_000,
      changeCents: 3_900,
    })
  })

  it('gives no change when cash is exact', () => {
    const result = settleTender({ method: 'cash', amountCents: 5_000, tenderedCents: 5_000 })
    expect(result).toMatchObject({ ok: true, changeCents: 0 })
  })

  it('refuses cash tendered below the amount', () => {
    expect(settleTender({ method: 'cash', amountCents: 5_000, tenderedCents: 4_999 })).toEqual({
      ok: false,
      problem: 'tender_below_amount',
    })
  })

  it('refuses cash with no tender recorded', () => {
    expect(settleTender({ method: 'cash', amountCents: 5_000 })).toEqual({
      ok: false,
      problem: 'tender_required',
    })
    expect(settleTender({ method: 'cash', amountCents: 5_000, tenderedCents: null })).toEqual({
      ok: false,
      problem: 'tender_required',
    })
  })

  it('requires a check number for a check or money order', () => {
    expect(settleTender({ method: 'check', amountCents: 5_000 })).toEqual({
      ok: false,
      problem: 'check_number_required',
    })
    expect(settleTender({ method: 'money_order', amountCents: 5_000, checkNumber: '  ' })).toEqual({
      ok: false,
      problem: 'check_number_required',
    })
    expect(settleTender({ method: 'check', amountCents: 5_000, checkNumber: '1041' })).toMatchObject({
      ok: true,
      changeCents: null,
    })
  })

  it('never invents change for a non-cash method', () => {
    // Overpaying by cheque is real, but it is a ledger credit to resolve, not
    // notes out of a drawer.
    const result = settleTender({
      method: 'check',
      amountCents: 5_000,
      tenderedCents: 9_999,
      checkNumber: '1041',
    })
    expect(result).toMatchObject({ ok: true, tenderedCents: null, changeCents: null })
  })

  it('refuses a zero, negative, or fractional amount', () => {
    expect(settleTender({ method: 'cash', amountCents: 0, tenderedCents: 100 })).toEqual({
      ok: false,
      problem: 'amount_not_positive',
    })
    expect(settleTender({ method: 'cash', amountCents: -500, tenderedCents: 100 })).toEqual({
      ok: false,
      problem: 'amount_not_positive',
    })
    expect(settleTender({ method: 'cash', amountCents: 10.5, tenderedCents: 100 })).toEqual({
      ok: false,
      problem: 'amount_not_integer',
    })
  })
})

describe('requiresAttribution', () => {
  it('names a human for anything physically handed over', () => {
    expect(requiresAttribution('cash')).toBe(true)
    expect(requiresAttribution('check')).toBe(true)
    expect(requiresAttribution('money_order')).toBe(true)
  })

  it('does not for a card, which may have no one behind a counter', () => {
    expect(requiresAttribution('card')).toBe(false)
    expect(requiresAttribution('ach')).toBe(false)
  })
})

describe('cashNeedsApproval', () => {
  it('triggers at the threshold, not only above it', () => {
    // A $500 threshold has to catch a $500 note.
    expect(cashNeedsApproval('cash', 50_000, 50_000)).toBe(true)
    expect(cashNeedsApproval('cash', 49_999, 50_000)).toBe(false)
    expect(cashNeedsApproval('cash', 60_000, 50_000)).toBe(true)
  })

  it('only applies to cash', () => {
    expect(cashNeedsApproval('check', 100_000, 50_000)).toBe(false)
    expect(cashNeedsApproval('card', 100_000, 50_000)).toBe(false)
  })
})
