import { describe, expect, it } from 'vitest'
import {
  paybackMonths,
  redemptionCost,
  roiTotals,
  type PromotionRoi,
} from '../packages/core/promotions'

// PRD 04 §3.2 US-4 (B-082 part 4). The ROI arithmetic, without a database.

const SCHEDULE = [
  { periodIndex: 0, amountCents: 12_900 },
  { periodIndex: 1, amountCents: 6_450 },
  { periodIndex: 2, amountCents: 6_450 },
]
const TOTAL = 25_800

describe('what one redemption cost', () => {
  it('separates what was promised from what has come off an invoice', () => {
    // The whole reason this report exists. "First month free then half off for
    // two" commits three periods the day it is redeemed; a tenant billed once
    // has realised one of them.
    const cost = redemptionCost(SCHEDULE, [0], TOTAL)
    expect(cost.committedCents).toBe(25_800)
    expect(cost.realisedCents).toBe(12_900)
    expect(cost.outstandingCents).toBe(12_900)
  })

  it('reports nothing realised before billing has run', () => {
    const cost = redemptionCost(SCHEDULE, [], TOTAL)
    expect(cost.realisedCents).toBe(0)
    expect(cost.outstandingCents).toBe(TOTAL)
  })

  it('reports nothing outstanding once every period is applied', () => {
    const cost = redemptionCost(SCHEDULE, [0, 1, 2], TOTAL)
    expect(cost.realisedCents).toBe(TOTAL)
    expect(cost.outstandingCents).toBe(0)
  })

  it('takes the committed figure from the stored total, not the schedule', () => {
    // `PromoRedemption.totalCents` is what billing and the ledger were built
    // against. Recomputing it here would make this report a second opinion
    // about a number the money path already committed to.
    expect(redemptionCost(SCHEDULE, [], 999).committedCents).toBe(999)
  })

  it('never reports a negative outstanding', () => {
    // If billing ever applied a period outside the schedule, a negative
    // "still to give" would read as the promotion having earned money back.
    expect(redemptionCost(SCHEDULE, [0, 1, 2, 3], 12_900).outstandingCents).toBe(0)
  })

  it('survives a malformed schedule rather than poisoning the total', () => {
    // The schedule is JSON out of the database. One bad entry must not turn a
    // whole report's total into NaN with no indication which row did it.
    const broken = [
      { periodIndex: 0, amountCents: 5_000 },
      { periodIndex: 1, amountCents: Number.NaN },
      null,
      undefined,
    ] as unknown as typeof SCHEDULE
    const cost = redemptionCost(broken, [0, 1], 10_000)
    expect(cost.realisedCents).toBe(5_000)
    expect(Number.isFinite(cost.realisedCents)).toBe(true)
  })

  it('ignores applied periods that are not in the schedule', () => {
    expect(redemptionCost(SCHEDULE, [5], TOTAL).realisedCents).toBe(0)
  })
})

function row(overrides: Partial<PromotionRoi> = {}): PromotionRoi {
  return {
    promotionId: 'p1',
    name: 'Half off month one',
    redemptions: 4,
    moveIns: 3,
    stillRenting: 2,
    committedCents: 25_800,
    realisedCents: 12_900,
    outstandingCents: 12_900,
    monthlyRentCents: 25_800,
    ...overrides,
  }
}

describe('months to earn back', () => {
  it('divides what was given by what those tenants pay each month', () => {
    expect(paybackMonths(row({ realisedCents: 12_900, monthlyRentCents: 25_800 }))).toBeCloseTo(0.5)
    expect(paybackMonths(row({ realisedCents: 25_800, monthlyRentCents: 12_900 }))).toBeCloseTo(2)
  })

  it('is null, not infinity, when nobody who took it is still renting', () => {
    // Rendering "∞ months" invites a reader to treat it as a very large number
    // rather than as "this did not work".
    expect(paybackMonths(row({ stillRenting: 0, monthlyRentCents: 0 }))).toBeNull()
  })

  it('is zero when a promotion has committed but not yet given anything away', () => {
    expect(paybackMonths(row({ realisedCents: 0 }))).toBe(0)
  })
})

describe('the footer totals', () => {
  it('sums every column from the rows the table renders', () => {
    // A footer queried separately from the rows above it is the classic report
    // bug; the only way it cannot happen is for there to be one source.
    const totals = roiTotals([row(), row({ promotionId: 'p2', redemptions: 1, moveIns: 1, stillRenting: 1, realisedCents: 5_000, outstandingCents: 0, committedCents: 5_000, monthlyRentCents: 9_900 })])
    expect(totals.redemptions).toBe(5)
    expect(totals.moveIns).toBe(4)
    expect(totals.stillRenting).toBe(3)
    expect(totals.realisedCents).toBe(17_900)
    expect(totals.outstandingCents).toBe(12_900)
    expect(totals.monthlyRentCents).toBe(35_700)
  })

  it('is all zeroes for an empty report rather than undefined', () => {
    expect(roiTotals([])).toEqual({
      redemptions: 0,
      moveIns: 0,
      stillRenting: 0,
      committedCents: 0,
      realisedCents: 0,
      outstandingCents: 0,
      monthlyRentCents: 0,
    })
  })
})
