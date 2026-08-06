import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ALLOCATION_ORDER,
  allocatePayment,
  byInvoice,
  describeAllocation,
  type AllocationTarget,
} from '../packages/core/billing'

// PRD 02 US-22 (B-048). Where a partial payment goes.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function target(overrides: Partial<AllocationTarget> = {}): AllocationTarget {
  return {
    invoiceId: 'inv-1',
    category: 'rent',
    outstandingCents: 10_000,
    dueDate: d('2026-09-01'),
    ...overrides,
  }
}

describe('the default order', () => {
  it('is the PRD’s: taxes, fees, insurance, then rent', () => {
    expect([...DEFAULT_ALLOCATION_ORDER]).toEqual(['tax', 'fee', 'protection', 'rent'])
  })

  it('pays tax before rent', () => {
    // Tax is money the operator holds for the state rather than earns.
    const result = allocatePayment(1_000, [
      target({ invoiceId: 'a', category: 'rent', outstandingCents: 10_000 }),
      target({ invoiceId: 'b', category: 'tax', outstandingCents: 800 }),
    ])
    expect(result.lines).toEqual([
      { invoiceId: 'b', category: 'tax', amountCents: 800 },
      { invoiceId: 'a', category: 'rent', amountCents: 200 },
    ])
  })

  it('pays fees before rent, so a fee cannot age into another fee', () => {
    const result = allocatePayment(2_000, [
      target({ invoiceId: 'a', category: 'rent' }),
      target({ invoiceId: 'b', category: 'fee', outstandingCents: 2_000 }),
    ])
    expect(result.lines).toEqual([{ invoiceId: 'b', category: 'fee', amountCents: 2_000 }])
  })
})

describe('within a category', () => {
  it('pays the oldest first', () => {
    const result = allocatePayment(10_000, [
      target({ invoiceId: 'new', dueDate: d('2026-10-01'), outstandingCents: 10_000 }),
      target({ invoiceId: 'old', dueDate: d('2026-09-01'), outstandingCents: 10_000 }),
    ])
    expect(result.lines[0].invoiceId).toBe('old')
  })

  it('is stable for two invoices due the same day', () => {
    // A receipt reprinted tomorrow must not disagree with the one the tenant
    // was handed today.
    const targets = [
      target({ invoiceId: 'b', outstandingCents: 5_000 }),
      target({ invoiceId: 'a', outstandingCents: 5_000 }),
    ]
    const first = allocatePayment(5_000, targets)
    const second = allocatePayment(5_000, [...targets].reverse())
    expect(first.lines).toEqual(second.lines)
    expect(first.lines[0].invoiceId).toBe('a')
  })
})

describe('a configured order', () => {
  it('is honoured', () => {
    const result = allocatePayment(1_000, [
      target({ invoiceId: 'a', category: 'rent', outstandingCents: 10_000 }),
      target({ invoiceId: 'b', category: 'tax', outstandingCents: 800 }),
    ], ['rent', 'tax', 'fee', 'protection'])
    expect(result.lines[0]).toEqual({ invoiceId: 'a', category: 'rent', amountCents: 1_000 })
  })

  it('pays a category left out of the order LAST rather than never', () => {
    // A misconfigured order should degrade to a worse sequence, not make money
    // uncollectable.
    const result = allocatePayment(3_000, [
      target({ invoiceId: 'a', category: 'fee', outstandingCents: 2_000 }),
      target({ invoiceId: 'b', category: 'rent', outstandingCents: 2_000 }),
    ], ['rent'])
    expect(result.lines.map((line) => line.category)).toEqual(['rent', 'fee'])
    expect(result.unappliedCents).toBe(0)
  })
})

describe('the edges', () => {
  it('splits a payment that does not cover a claim', () => {
    const result = allocatePayment(3_000, [target({ outstandingCents: 10_000 })])
    expect(result.lines).toEqual([{ invoiceId: 'inv-1', category: 'rent', amountCents: 3_000 }])
  })

  it('never allocates more than a claim is owed', () => {
    const result = allocatePayment(10_000, [target({ outstandingCents: 400 })])
    expect(result.lines[0].amountCents).toBe(400)
    expect(result.unappliedCents).toBe(9_600)
  })

  it('reports an over-payment rather than inventing somewhere to put it', () => {
    // An over-payment is a decision — refuse it, hold it, refund it — and this
    // function does not make it. Money allocated to "the oldest thing" is how
    // it ends up somewhere nobody can explain.
    const result = allocatePayment(50_000, [target({ outstandingCents: 10_000 })])
    expect(result.unappliedCents).toBe(40_000)
  })

  it('does nothing with nothing', () => {
    expect(allocatePayment(0, [target()])).toEqual({ lines: [], unappliedCents: 0 })
    expect(allocatePayment(-500, [target()]).lines).toEqual([])
  })

  it('ignores a claim that is already settled', () => {
    const result = allocatePayment(1_000, [target({ outstandingCents: 0 })])
    expect(result.lines).toEqual([])
    expect(result.unappliedCents).toBe(1_000)
  })

  it('always sums back to what was allocated', () => {
    const result = allocatePayment(7_531, [
      target({ invoiceId: 'a', category: 'tax', outstandingCents: 812 }),
      target({ invoiceId: 'b', category: 'fee', outstandingCents: 2_000 }),
      target({ invoiceId: 'c', category: 'rent', outstandingCents: 12_900 }),
    ])
    const allocated = result.lines.reduce((sum, line) => sum + line.amountCents, 0)
    expect(allocated + result.unappliedCents).toBe(7_531)
  })
})

describe('byInvoice', () => {
  it('sums categories on one invoice into the single row the schema stores', () => {
    expect(
      byInvoice([
        { invoiceId: 'a', category: 'tax', amountCents: 800 },
        { invoiceId: 'a', category: 'rent', amountCents: 1_200 },
        { invoiceId: 'b', category: 'fee', amountCents: 500 },
      ]),
    ).toEqual([
      { invoiceId: 'a', amountCents: 2_000 },
      { invoiceId: 'b', amountCents: 500 },
    ])
  })
})

describe('describeAllocation', () => {
  it('answers the question a tenant asks — what did my money pay for', () => {
    expect(
      describeAllocation([
        { invoiceId: 'a', category: 'rent', amountCents: 1_200 },
        { invoiceId: 'b', category: 'tax', amountCents: 800 },
        { invoiceId: 'c', category: 'rent', amountCents: 300 },
      ]),
    ).toEqual([
      { label: 'Tax', amountCents: 800 },
      { label: 'Rent', amountCents: 1_500 },
    ])
  })

  it('leaves out a category nothing went to', () => {
    expect(describeAllocation([{ invoiceId: 'a', category: 'rent', amountCents: 100 }])).toEqual([
      { label: 'Rent', amountCents: 100 },
    ])
  })
})
