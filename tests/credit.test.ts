import { describe, expect, it } from 'vitest'
import { unclaimedCents } from '@/lib/billing/credit'

// B-225. The arithmetic that decides how much of a tenant's money is still
// theirs to spend. Pure, so every boundary is testable without a database —
// the same reason `validatePaymentAmount` is pure.
describe('what one payment is still carrying', () => {
  it('banks the remainder when a payment outruns the invoice it settled', () => {
    // The row's own scenario: $600 at the counter in December against a $150
    // invoice. The $450 is the whole defect — it was returned by `applyPayment`
    // and read by nothing.
    expect(
      unclaimedCents({ amountCents: 60_000, allocations: [{ amountCents: 15_000 }], refunds: [] }),
    ).toBe(45_000)
  })

  it('carries nothing when every cent found an invoice', () => {
    expect(
      unclaimedCents({
        amountCents: 15_000,
        allocations: [{ amountCents: 10_000 }, { amountCents: 5_000 }],
        refunds: [],
      }),
    ).toBe(0)
  })

  it('does not count money that has been given back', () => {
    // A refund UNWINDS ALLOCATIONS FIRST (`refunds.ts` walks the allocation
    // rows before anything else), so a $200 refund against $150 of allocations
    // leaves the allocations at zero and $50 simply unwound. $600 in, $200 out,
    // nothing settled: $400 is still the tenant's.
    expect(
      unclaimedCents({
        amountCents: 60_000,
        allocations: [],
        refunds: [{ status: 'succeeded', amountCents: 20_000 }],
      }),
    ).toBe(40_000)
  })

  it('ignores a refund that failed', () => {
    // The money never left. Counting an attempted refund would quietly delete
    // credit the tenant still has.
    expect(
      unclaimedCents({
        amountCents: 60_000,
        allocations: [],
        refunds: [{ status: 'failed', amountCents: 20_000 }],
      }),
    ).toBe(60_000)
  })

  it('floors at zero rather than reporting negative credit', () => {
    // Refunds and allocations can overlap within a rounding of each other while
    // an unwind is in flight. A negative credit is nonsense on a screen and
    // actively dangerous in the three subtractions that are about to consume
    // it: it would ADD to what a tenant owes.
    expect(
      unclaimedCents({
        amountCents: 10_000,
        allocations: [{ amountCents: 10_000 }],
        refunds: [{ status: 'succeeded', amountCents: 10_000 }],
      }),
    ).toBe(0)
  })

  it('is not confused by a fully refunded payment that kept its allocations', () => {
    // `refunded` is an IN_HAND status on purpose — a refund trims allocations
    // rather than marking them — so this row must still contribute zero.
    expect(
      unclaimedCents({
        amountCents: 60_000,
        allocations: [],
        refunds: [{ status: 'succeeded', amountCents: 60_000 }],
      }),
    ).toBe(0)
  })
})
