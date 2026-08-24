import { describe, expect, it } from 'vitest'
import {
  applyIsDue,
  DEFAULT_ECRI_POLICY,
  earliestEffectiveDate,
  isCancellable,
  isEligibleForIncrease,
  decreaseProblem,
  isRateDecrease,
  noticeDateFor,
  noticeDeliveryVerdict,
  noticeIsDue,
  projectedMonthlyDeltaCents,
  scheduleProblem,
  targetRateFor,
} from '../packages/core/pricing/rate-increase'

// PRD 02 §4.3 US-11 (B-076). The rules that decide whether a tenant's rent
// goes up, pinned exhaustively — the notice-period check in particular is the
// one thing here that has a legal consequence if it is off by a day.

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

// B-153 made both predicates direction-aware, so every row now carries the two
// figures the direction is derived from. `UP` is an increase, `DOWN` a
// retention save.
const UP = { currentRateCents: 12_900, newRateCents: 14_900 }
const DOWN = { currentRateCents: 14_900, newRateCents: 12_900 }

describe('noticeDateFor', () => {
  it('is the effective date minus the notice period', () => {
    expect(noticeDateFor(day('2026-10-01'), 30)).toEqual(day('2026-09-01'))
  })

  it('crosses a month boundary correctly', () => {
    expect(noticeDateFor(day('2026-03-01'), 30)).toEqual(day('2026-01-30'))
  })
})

describe('scheduleProblem — US-11’s "blocks effective dates that violate the notice period"', () => {
  const base = {
    currentRateCents: 12_900,
    newRateCents: 14_900,
    noticeDays: 30,
    today: day('2026-09-01'),
  }

  it('allows an effective date exactly the notice period out', () => {
    // 30 days' notice means the tenant gets 30 days. Requiring 31 would make
    // every facility's configured figure quietly mean one more than it says.
    expect(scheduleProblem({ ...base, effectiveDate: day('2026-10-01') })).toBeNull()
  })

  it('blocks one day inside the notice period', () => {
    expect(scheduleProblem({ ...base, effectiveDate: day('2026-09-30') })).toBe('insufficient_notice')
  })

  it('blocks an effective date in the past', () => {
    expect(scheduleProblem({ ...base, effectiveDate: day('2026-08-01') })).toBe('effective_not_in_future')
  })

  it('blocks today', () => {
    expect(scheduleProblem({ ...base, effectiveDate: day('2026-09-01') })).toBe('effective_not_in_future')
  })

  it('refuses a decrease — this workflow is for increases', () => {
    expect(
      scheduleProblem({ ...base, newRateCents: 10_000, effectiveDate: day('2026-12-01') }),
    ).toBe('not_an_increase')
  })

  it('refuses an unchanged rate', () => {
    expect(
      scheduleProblem({ ...base, newRateCents: base.currentRateCents, effectiveDate: day('2026-12-01') }),
    ).toBe('not_an_increase')
  })

  it('refuses a zero-day notice period rather than treating it as "no notice needed"', () => {
    expect(
      scheduleProblem({ ...base, noticeDays: 0, effectiveDate: day('2026-12-01') }),
    ).toBe('notice_days_not_positive')
  })

  it('reports the misconfiguration before the date problem', () => {
    // An operator with no notice period configured should be told THAT, not
    // sent to fix a date that was never the real problem.
    expect(
      scheduleProblem({ ...base, noticeDays: 0, effectiveDate: day('2020-01-01') }),
    ).toBe('notice_days_not_positive')
  })

  it('honours a longer configured period', () => {
    expect(
      scheduleProblem({ ...base, noticeDays: 60, effectiveDate: day('2026-10-01') }),
    ).toBe('insufficient_notice')
  })
})

describe('earliestEffectiveDate', () => {
  it('is the notice period out from today', () => {
    expect(earliestEffectiveDate(day('2026-09-01'), 30)).toEqual(day('2026-10-01'))
  })

  it('is never today, even with a nonsense notice period', () => {
    expect(earliestEffectiveDate(day('2026-09-01'), 0)).toEqual(day('2026-09-02'))
  })
})

describe('isEligibleForIncrease — US-11’s rule-based selection', () => {
  const candidate = {
    leaseId: 'lease-1',
    inPlaceRateCents: 12_900,
    streetRateCents: 14_900, // $20 gap
    monthsSinceLastChange: 12,
  }

  it('accepts a lease meeting both conditions', () => {
    expect(isEligibleForIncrease(candidate, DEFAULT_ECRI_POLICY)).toBe(true)
  })

  it('rejects a big gap on a recently-raised lease', () => {
    expect(isEligibleForIncrease({ ...candidate, monthsSinceLastChange: 3 }, DEFAULT_ECRI_POLICY)).toBe(false)
  })

  it('rejects a long-untouched lease already at street', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 }, DEFAULT_ECRI_POLICY),
    ).toBe(false)
  })

  it('rejects a gap just under the threshold', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 + 1_499 }, DEFAULT_ECRI_POLICY),
    ).toBe(false)
  })

  it('accepts a gap exactly at the threshold', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 + 1_500 }, DEFAULT_ECRI_POLICY),
    ).toBe(true)
  })

  it('accepts exactly the month threshold', () => {
    expect(isEligibleForIncrease({ ...candidate, monthsSinceLastChange: 9 }, DEFAULT_ECRI_POLICY)).toBe(true)
  })

  it('rejects a lease with unknown history rather than assuming it is old enough', () => {
    expect(
      isEligibleForIncrease({ ...candidate, monthsSinceLastChange: null }, DEFAULT_ECRI_POLICY),
    ).toBe(false)
  })

  it('rejects a lease priced ABOVE street', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 10_000 }, DEFAULT_ECRI_POLICY),
    ).toBe(false)
  })
})

describe('targetRateFor — B-165 / D-94, the step rule', () => {
  const lease = (inPlace: number, street: number) => ({
    leaseId: 'l',
    inPlaceRateCents: inPlace,
    streetRateCents: street,
    monthsSinceLastChange: 12,
  })

  it('takes a percentage of the in-place rate, not the gap', () => {
    // $129 × 10% = $12.90 → $141.90 → $142.
    expect(targetRateFor(lease(12_900, 20_000), DEFAULT_ECRI_POLICY)).toBe(14_200)
  })

  it('is the row this item exists for: $89 against a $145 street is not a 63% letter', () => {
    // 89 × 1.10 = 97.90 → $98, and street is nowhere near it.
    expect(targetRateFor(lease(8_900, 14_500), DEFAULT_ECRI_POLICY)).toBe(9_800)
  })

  it('never carries a tenant past street while capAtStreet holds', () => {
    // 10% of $140 is $14, which would overshoot a $145 street rate.
    expect(targetRateFor(lease(14_000, 14_500), DEFAULT_ECRI_POLICY)).toBe(14_500)
  })

  it('lets the step overshoot street when the cap is off', () => {
    expect(
      targetRateFor(lease(14_000, 14_500), { ...DEFAULT_ECRI_POLICY, capAtStreet: false }),
    ).toBe(15_400)
  })

  it('raises a too-small step to the floor', () => {
    // 10% of $30 is $3, below the $5 floor.
    expect(targetRateFor(lease(3_000, 20_000), DEFAULT_ECRI_POLICY)).toBe(3_500)
  })

  it('clamps a too-large step to the ceiling', () => {
    // 10% of $400 is $40, above the $30 ceiling.
    expect(targetRateFor(lease(40_000, 90_000), DEFAULT_ECRI_POLICY)).toBe(43_000)
  })

  it('rounds the rate to a whole dollar, not the step', () => {
    // $89.50 + $8.95 = $98.45 → $98. A notice quoting cents invites a call.
    expect(targetRateFor(lease(8_950, 30_000), DEFAULT_ECRI_POLICY) % 100).toBe(0)
    expect(targetRateFor(lease(8_950, 30_000), DEFAULT_ECRI_POLICY)).toBe(9_800)
  })

  it('is a real increase under the seeded default, which is the point', () => {
    const target = targetRateFor(lease(8_900, 14_500), DEFAULT_ECRI_POLICY)
    expect(target).toBeGreaterThan(8_900)
    expect(target).toBeLessThan(14_500)
  })
})

describe('projectedMonthlyDeltaCents — the figure an approver decides on', () => {
  it('sums the per-lease deltas', () => {
    expect(
      projectedMonthlyDeltaCents([
        { currentRateCents: 12_900, newRateCents: 14_900 },
        { currentRateCents: 10_000, newRateCents: 11_000 },
      ]),
    ).toBe(3_000)
  })

  it('is zero for an empty worklist', () => {
    expect(projectedMonthlyDeltaCents([])).toBe(0)
  })
})

describe('isCancellable — US-11’s "cancellable up to the effective date"', () => {
  it('allows cancelling before approval', () => {
    expect(isCancellable('pending_approval')).toBe(true)
  })

  it('allows cancelling after approval', () => {
    expect(isCancellable('approved')).toBe(true)
  })

  it('allows cancelling after the notice has gone out', () => {
    // The case that matters most: an operator who changes their mind after
    // the letter went out must be able to stop the charge.
    expect(isCancellable('notice_sent')).toBe(true)
  })

  it('refuses to cancel one that already took effect', () => {
    expect(isCancellable('applied')).toBe(false)
  })

  it('refuses to cancel one already cancelled', () => {
    expect(isCancellable('cancelled')).toBe(false)
  })
})

describe('noticeIsDue', () => {
  it('is due on the notice date once approved', () => {
    expect(noticeIsDue({ ...UP, status: 'approved', noticeDate: day('2026-09-01') }, day('2026-09-01'))).toBe(true)
  })

  it('catches up on a later run', () => {
    expect(noticeIsDue({ ...UP, status: 'approved', noticeDate: day('2026-09-01') }, day('2026-09-05'))).toBe(true)
  })

  it('is not due before the notice date', () => {
    expect(noticeIsDue({ ...UP, status: 'approved', noticeDate: day('2026-09-02') }, day('2026-09-01'))).toBe(false)
  })

  it('never fires without approval — US-11’s "approval is required before notices go out"', () => {
    expect(noticeIsDue({ ...UP, status: 'pending_approval', noticeDate: day('2026-09-01') }, day('2026-09-01'))).toBe(false)
  })

  it('never re-fires once sent', () => {
    expect(noticeIsDue({ ...UP, status: 'notice_sent', noticeDate: day('2026-09-01') }, day('2026-09-05'))).toBe(false)
  })
})

describe('applyIsDue', () => {
  it('is due on the effective date once the notice has gone out', () => {
    expect(applyIsDue({ ...UP, status: 'notice_sent', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(true)
  })

  it('never applies an increase whose notice never went out', () => {
    // The guard that makes "no tenant is charged more without having been
    // told" true by construction rather than by job ordering.
    expect(applyIsDue({ ...UP, status: 'approved', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(false)
  })

  it('is not due before the effective date', () => {
    expect(applyIsDue({ ...UP, status: 'notice_sent', effectiveDate: day('2026-10-02') }, day('2026-10-01'))).toBe(false)
  })

  it('never re-applies', () => {
    expect(applyIsDue({ ...UP, status: 'applied', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
  })

  it('never applies a cancelled increase', () => {
    expect(applyIsDue({ ...UP, status: 'cancelled', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
  })
})

// B-152 / D-88. US-11's minimum-notice block is a guarantee about DELIVERY,
// and until this the code made it about intent.
describe('noticeDeliveryVerdict', () => {
  it('treats no message at all as no notice — D-88\u2019s "no send record blocks"', () => {
    expect(noticeDeliveryVerdict([])).toBe('no_send_record')
  })

  it('blocks when every message bounced', () => {
    expect(noticeDeliveryVerdict(['bounced'])).toBe('undeliverable')
  })

  it('blocks on a suppression hit — a notice we chose not to send is not notice', () => {
    expect(noticeDeliveryVerdict(['suppressed'])).toBe('undeliverable')
    expect(noticeDeliveryVerdict(['cancelled'])).toBe('undeliverable')
    expect(noticeDeliveryVerdict(['failed'])).toBe('undeliverable')
  })

  it('does not block on a webhook that has not called back yet', () => {
    // `sent` is not proof of arrival, but it is not evidence of failure, and
    // holding every increase whose provider callback is a minute late would
    // block far more increases than bad addresses ever will.
    expect(noticeDeliveryVerdict(['sent'])).toBe('reached')
    expect(noticeDeliveryVerdict(['queued'])).toBe('reached')
    expect(noticeDeliveryVerdict(['deferred'])).toBe('reached')
  })

  it('reaching them on either channel is reaching them', () => {
    expect(noticeDeliveryVerdict(['bounced', 'delivered'])).toBe('reached')
  })
})

describe('isCancellable', () => {
  it('covers a held increase — D-88\u2019s remedy is to cancel and re-notice', () => {
    expect(isCancellable('notice_failed')).toBe(true)
  })

  it('still refuses one that already happened', () => {
    expect(isCancellable('applied')).toBe(false)
    expect(isCancellable('cancelled')).toBe(false)
  })
})

// B-153 / PRD 02 §4.3 US-11. The retention save: the same workflow in the
// other direction, and the direction is derived from the two figures rather
// than stored.
describe('decreaseProblem', () => {
  const base = { currentRateCents: 14_900, effectiveDate: day('2026-10-01'), today: day('2026-09-15') }

  it('allows a real decrease with no notice period at all', () => {
    // The whole point: an increase from the same date would be refused for
    // insufficient notice, and a decrease is not.
    expect(decreaseProblem({ ...base, newRateCents: 12_900 })).toBeNull()
    expect(
      scheduleProblem({ ...base, newRateCents: 12_900, noticeDays: 30 }),
    ).toBe('not_an_increase')
  })

  it('allows today — a retention save is agreed on the phone, not next month', () => {
    expect(
      decreaseProblem({ ...base, newRateCents: 12_900, effectiveDate: day('2026-09-15') }),
    ).toBeNull()
  })

  it('refuses a past date — an invoiced rate is a fact', () => {
    expect(
      decreaseProblem({ ...base, newRateCents: 12_900, effectiveDate: day('2026-09-14') }),
    ).toBe('effective_in_past')
  })

  it('refuses an increase, and refuses no change at all', () => {
    expect(decreaseProblem({ ...base, newRateCents: 15_900 })).toBe('not_a_decrease')
    expect(decreaseProblem({ ...base, newRateCents: 14_900 })).toBe('not_a_decrease')
  })

  it('refuses a negative rate before anything else', () => {
    // A trust boundary: this figure lands on `Lease.monthlyRateCents` and
    // would invoice as a credit every month forever.
    expect(decreaseProblem({ ...base, newRateCents: -100 })).toBe('rate_below_zero')
  })

  it('allows a rate of zero — a comped unit is a decision, not a bug', () => {
    expect(decreaseProblem({ ...base, newRateCents: 0 })).toBeNull()
  })
})

describe('direction-aware notice and apply', () => {
  it('a decrease is never noticed — it would email a rate-INCREASE letter', () => {
    // A decrease is `approved` from creation, which is exactly the state
    // `noticeIsDue` fires on. Without the direction check the tenant whose
    // rent just came down gets told it is going up.
    expect(noticeIsDue({ ...DOWN, status: 'approved', noticeDate: day('2026-09-01') }, day('2026-09-05'))).toBe(false)
  })

  it('a decrease applies from approved, because it never reaches notice_sent', () => {
    expect(applyIsDue({ ...DOWN, status: 'approved', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(true)
  })

  it('an approved INCREASE still cannot apply — the property that had to survive', () => {
    expect(applyIsDue({ ...UP, status: 'approved', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(false)
  })

  it('a decrease is not due early either', () => {
    expect(applyIsDue({ ...DOWN, status: 'approved', effectiveDate: day('2026-10-02') }, day('2026-10-01'))).toBe(false)
  })

  it('a cancelled or held decrease never applies', () => {
    expect(applyIsDue({ ...DOWN, status: 'cancelled', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
    expect(applyIsDue({ ...DOWN, status: 'notice_failed', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
  })

  it('reads the direction off the figures', () => {
    expect(isRateDecrease(DOWN)).toBe(true)
    expect(isRateDecrease(UP)).toBe(false)
  })
})
