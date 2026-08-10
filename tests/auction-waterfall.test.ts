import { describe, expect, it } from 'vitest'
import { distribute, ledgerPostings, WaterfallError } from '../packages/core/auctions/waterfall'

// B-062 / PRD 02 §4.6 US-28. "Applied by the system in a fixed and stated
// order — reasonable sale costs → lien balance → surplus."

describe('distribute — the fixed order', () => {
  it('takes sale costs first, then the lien, then leaves the surplus', () => {
    const result = distribute({
      grossProceedsCents: 100_000,
      saleCostsCents: 15_000,
      lienBalanceCents: 60_000,
    })
    expect(result).toEqual({
      costsRecoveredCents: 15_000,
      appliedToLienCents: 60_000,
      surplusCents: 25_000,
      deficiencyCents: 0,
    })
  })

  it('produces no surplus when the sale barely covers the debt', () => {
    const result = distribute({
      grossProceedsCents: 75_000,
      saleCostsCents: 15_000,
      lienBalanceCents: 60_000,
    })
    expect(result.surplusCents).toBe(0)
    expect(result.deficiencyCents).toBe(0)
  })

  it('records a deficiency when the sale falls short — the debt does not vanish', () => {
    // The goods are gone; what they did not cover is still owed.
    const result = distribute({
      grossProceedsCents: 40_000,
      saleCostsCents: 15_000,
      lienBalanceCents: 60_000,
    })
    expect(result.costsRecoveredCents).toBe(15_000)
    expect(result.appliedToLienCents).toBe(25_000)
    expect(result.surplusCents).toBe(0)
    expect(result.deficiencyCents).toBe(35_000)
  })

  it('recovers only part of the sale costs when the sale raised less than they were', () => {
    const result = distribute({
      grossProceedsCents: 5_000,
      saleCostsCents: 15_000,
      lienBalanceCents: 60_000,
    })
    expect(result.costsRecoveredCents).toBe(5_000)
    expect(result.appliedToLienCents).toBe(0)
    // The 10,000 of unrecovered costs is part of what is still owed.
    expect(result.deficiencyCents).toBe(70_000)
  })

  it('handles a sale that raised nothing', () => {
    const result = distribute({
      grossProceedsCents: 0,
      saleCostsCents: 15_000,
      lienBalanceCents: 60_000,
    })
    expect(result.surplusCents).toBe(0)
    expect(result.deficiencyCents).toBe(75_000)
  })

  it('gives the whole proceeds to the former tenant when nothing is owed and nothing was spent', () => {
    const result = distribute({ grossProceedsCents: 50_000, saleCostsCents: 0, lienBalanceCents: 0 })
    expect(result.surplusCents).toBe(50_000)
  })
})

describe('distribute — the identity', () => {
  // The property the file exists for: every cent lands in exactly one bucket.
  const cases = [
    { grossProceedsCents: 100_000, saleCostsCents: 15_000, lienBalanceCents: 60_000 },
    { grossProceedsCents: 1, saleCostsCents: 0, lienBalanceCents: 0 },
    { grossProceedsCents: 0, saleCostsCents: 0, lienBalanceCents: 0 },
    { grossProceedsCents: 33_333, saleCostsCents: 11_111, lienBalanceCents: 11_111 },
    { grossProceedsCents: 999_999, saleCostsCents: 1, lienBalanceCents: 999_997 },
    { grossProceedsCents: 7, saleCostsCents: 100_000, lienBalanceCents: 100_000 },
  ]

  it.each(cases)('accounts for every cent of %j', (input) => {
    const result = distribute(input)
    expect(result.costsRecoveredCents + result.appliedToLienCents + result.surplusCents).toBe(
      input.grossProceedsCents,
    )
  })

  it.each(cases)('never returns a negative bucket for %j', (input) => {
    const result = distribute(input)
    expect(result.costsRecoveredCents).toBeGreaterThanOrEqual(0)
    expect(result.appliedToLienCents).toBeGreaterThanOrEqual(0)
    expect(result.surplusCents).toBeGreaterThanOrEqual(0)
    expect(result.deficiencyCents).toBeGreaterThanOrEqual(0)
  })

  it('never produces a surplus and a deficiency at once', () => {
    for (const input of cases) {
      const result = distribute(input)
      expect(result.surplusCents > 0 && result.deficiencyCents > 0).toBe(false)
    }
  })

  it('is exhaustive over a swept range', () => {
    // A cheap sweep rather than a property-testing dependency. If the identity
    // can be broken by an off-by-one anywhere in this space, this finds it.
    for (let gross = 0; gross <= 2_000; gross += 137) {
      for (let costs = 0; costs <= 1_000; costs += 91) {
        for (let lien = 0; lien <= 1_500; lien += 113) {
          const result = distribute({
            grossProceedsCents: gross,
            saleCostsCents: costs,
            lienBalanceCents: lien,
          })
          expect(result.costsRecoveredCents + result.appliedToLienCents + result.surplusCents).toBe(gross)
        }
      }
    }
  })
})

describe('distribute — refusals', () => {
  it('refuses a negative gross, cost or balance', () => {
    expect(() =>
      distribute({ grossProceedsCents: -1, saleCostsCents: 0, lienBalanceCents: 0 }),
    ).toThrow(WaterfallError)
    expect(() =>
      distribute({ grossProceedsCents: 0, saleCostsCents: -1, lienBalanceCents: 0 }),
    ).toThrow(WaterfallError)
    expect(() =>
      distribute({ grossProceedsCents: 0, saleCostsCents: 0, lienBalanceCents: -1 }),
    ).toThrow(WaterfallError)
  })

  it('refuses fractional cents', () => {
    // Money is integer cents (the project rule). A float here would round into
    // or out of somebody's surplus.
    expect(() =>
      distribute({ grossProceedsCents: 100.5, saleCostsCents: 0, lienBalanceCents: 0 }),
    ).toThrow(WaterfallError)
  })
})

describe('ledgerPostings — "never typed in as a total"', () => {
  it('charges the sale costs and applies the proceeds', () => {
    const input = { grossProceedsCents: 100_000, saleCostsCents: 15_000, lienBalanceCents: 60_000 }
    const postings = ledgerPostings(input, distribute(input))

    expect(postings).toEqual([
      { type: 'charge', amountCents: 15_000, description: 'Auction sale costs' },
      { type: 'payment', amountCents: -75_000, description: 'Auction proceeds applied' },
    ])
  })

  it('settles the lease exactly when the sale covered it', () => {
    // Charges +15,000 onto a 60,000 balance = 75,000 owed; the payment is
    // -75,000. The ledger nets to zero, which is what "the lien was satisfied"
    // has to mean on the record.
    const input = { grossProceedsCents: 100_000, saleCostsCents: 15_000, lienBalanceCents: 60_000 }
    const postings = ledgerPostings(input, distribute(input))
    const net = 60_000 + postings.reduce((sum, posting) => sum + posting.amountCents, 0)
    expect(net).toBe(0)
  })

  it('leaves the deficiency on the ledger when the sale fell short', () => {
    const input = { grossProceedsCents: 40_000, saleCostsCents: 15_000, lienBalanceCents: 60_000 }
    const result = distribute(input)
    const postings = ledgerPostings(input, result)
    const net = 60_000 + postings.reduce((sum, posting) => sum + posting.amountCents, 0)
    expect(net).toBe(result.deficiencyCents)
  })

  it('never posts the surplus against the lease', () => {
    // The surplus is owed to a PERSON, not to a closed lease. Posting it as a
    // credit would make it read as discharged the moment it was recorded —
    // exactly how a surplus gets quietly retained.
    const input = { grossProceedsCents: 100_000, saleCostsCents: 0, lienBalanceCents: 10_000 }
    const postings = ledgerPostings(input, distribute(input))
    expect(postings.some((posting) => /surplus/i.test(posting.description))).toBe(false)
    expect(postings.reduce((sum, posting) => sum + posting.amountCents, 0)).toBe(-10_000)
  })

  it('posts no cost charge when the sale cost nothing', () => {
    const input = { grossProceedsCents: 50_000, saleCostsCents: 0, lienBalanceCents: 20_000 }
    expect(ledgerPostings(input, distribute(input))).toHaveLength(1)
  })

  it('posts nothing at all for a sale that raised nothing and cost nothing', () => {
    const input = { grossProceedsCents: 0, saleCostsCents: 0, lienBalanceCents: 20_000 }
    expect(ledgerPostings(input, distribute(input))).toEqual([])
  })
})
