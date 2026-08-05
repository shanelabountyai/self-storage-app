import { describe, expect, it } from 'vitest'
import { noticeShortfallDays, proratedCredit, settleMoveOut } from '../packages/core/move-out'

// B-040 / PRD 02 US-14 (move-out). Pure money math — no database, no clock.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('proratedCredit', () => {
  it('credits the unused days of a paid month', () => {
    // Paid through 31 Aug, left on the 15th → 16 unused days of a 31-day month.
    expect(proratedCredit(31_000, d('2026-08-31'), d('2026-08-15'))).toBe(16_000)
  })

  it('credits nothing when the tenant leaves on the day they are paid to', () => {
    expect(proratedCredit(31_000, d('2026-08-15'), d('2026-08-15'))).toBe(0)
  })

  it('credits nothing when the tenant leaves after what they paid for', () => {
    // They owe for the overrun; that is the balance's job, not a negative credit.
    expect(proratedCredit(31_000, d('2026-08-10'), d('2026-08-20'))).toBe(0)
  })

  it('uses the length of the month the move-out falls in', () => {
    // February: 28 days in 2026, so a day is worth more than in August.
    expect(proratedCredit(28_000, d('2026-02-28'), d('2026-02-14'))).toBe(14_000)
  })

  it('rounds down rather than inventing a fraction of a cent', () => {
    // 10000 * 10 / 31 = 3225.8… → 3225, never 3226.
    expect(proratedCredit(10_000, d('2026-08-31'), d('2026-08-21'))).toBe(3_225)
  })
})

describe('settleMoveOut', () => {
  const base = {
    monthlyRateCents: 31_000,
    paidThroughDate: d('2026-08-31'),
    moveOutDate: d('2026-08-15'),
    prorateOnMoveOut: true,
    writeOffThresholdCents: 1_000,
  }

  it('refunds the unused part when the tenant is paid up', () => {
    const result = settleMoveOut({ ...base, balanceCents: 0 })
    expect(result.prorationCreditCents).toBe(16_000)
    expect(result.refundDueCents).toBe(16_000)
    expect(result.amountDueCents).toBe(0)
    expect(result.needsManagerOverride).toBe(false)
  })

  it('credits nothing when the facility does not prorate', () => {
    // The common lease term, and the shipped default.
    const result = settleMoveOut({ ...base, prorateOnMoveOut: false, balanceCents: 0 })
    expect(result.prorationCreditCents).toBe(0)
    expect(result.refundDueCents).toBe(0)
  })

  it('nets a proration credit against what is owed', () => {
    const result = settleMoveOut({ ...base, balanceCents: 20_000 })
    expect(result.netBalanceCents).toBe(4_000)
    expect(result.amountDueCents).toBe(4_000)
  })

  it('lets a small residual debt be written off', () => {
    const result = settleMoveOut({ ...base, prorateOnMoveOut: false, balanceCents: 800 })
    expect(result.canWriteOff).toBe(true)
    expect(result.needsManagerOverride).toBe(false)
  })

  it('needs a manager once the debt is over the threshold', () => {
    const result = settleMoveOut({ ...base, prorateOnMoveOut: false, balanceCents: 1_001 })
    expect(result.canWriteOff).toBe(false)
    expect(result.needsManagerOverride).toBe(true)
  })

  it('treats the threshold itself as writable off, not as an override', () => {
    const result = settleMoveOut({ ...base, prorateOnMoveOut: false, balanceCents: 1_000 })
    expect(result.canWriteOff).toBe(true)
    expect(result.needsManagerOverride).toBe(false)
  })

  it('never calls a credit balance a write-off', () => {
    // Writing off money we owe back would be keeping it.
    const result = settleMoveOut({ ...base, prorateOnMoveOut: false, balanceCents: -5_000 })
    expect(result.canWriteOff).toBe(false)
    expect(result.refundDueCents).toBe(5_000)
    expect(result.needsManagerOverride).toBe(false)
  })

  it('has nothing to prorate when nothing was paid ahead', () => {
    const result = settleMoveOut({ ...base, paidThroughDate: null, balanceCents: 6_000 })
    expect(result.prorationCreditCents).toBe(0)
    expect(result.amountDueCents).toBe(6_000)
  })
})

describe('noticeShortfallDays', () => {
  it('is zero when the full notice was given', () => {
    expect(noticeShortfallDays(d('2026-08-01'), d('2026-08-15'), 10)).toBe(0)
  })

  it('is zero when exactly the required notice was given', () => {
    expect(noticeShortfallDays(d('2026-08-05'), d('2026-08-15'), 10)).toBe(0)
  })

  it('reports how many days short a late notice was', () => {
    expect(noticeShortfallDays(d('2026-08-11'), d('2026-08-15'), 10)).toBe(6)
  })

  it('counts no notice at all as the whole requirement', () => {
    expect(noticeShortfallDays(null, d('2026-08-15'), 10)).toBe(10)
  })

  it('is zero at a facility that requires no notice', () => {
    expect(noticeShortfallDays(null, d('2026-08-15'), 0)).toBe(0)
  })
})
