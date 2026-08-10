import { describe, expect, it } from 'vitest'
import {
  applyIsDue,
  DEFAULT_ELIGIBILITY,
  earliestEffectiveDate,
  isCancellable,
  isEligibleForIncrease,
  noticeDateFor,
  noticeIsDue,
  projectedMonthlyDeltaCents,
  scheduleProblem,
  targetRateFor,
} from '../packages/core/pricing/rate-increase'

// PRD 02 §4.3 US-11 (B-076). The rules that decide whether a tenant's rent
// goes up, pinned exhaustively — the notice-period check in particular is the
// one thing here that has a legal consequence if it is off by a day.

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

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
    expect(isEligibleForIncrease(candidate, DEFAULT_ELIGIBILITY)).toBe(true)
  })

  it('rejects a big gap on a recently-raised lease', () => {
    expect(isEligibleForIncrease({ ...candidate, monthsSinceLastChange: 3 }, DEFAULT_ELIGIBILITY)).toBe(false)
  })

  it('rejects a long-untouched lease already at street', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 }, DEFAULT_ELIGIBILITY),
    ).toBe(false)
  })

  it('rejects a gap just under the threshold', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 + 1_499 }, DEFAULT_ELIGIBILITY),
    ).toBe(false)
  })

  it('accepts a gap exactly at the threshold', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 12_900 + 1_500 }, DEFAULT_ELIGIBILITY),
    ).toBe(true)
  })

  it('accepts exactly the month threshold', () => {
    expect(isEligibleForIncrease({ ...candidate, monthsSinceLastChange: 9 }, DEFAULT_ELIGIBILITY)).toBe(true)
  })

  it('rejects a lease with unknown history rather than assuming it is old enough', () => {
    expect(
      isEligibleForIncrease({ ...candidate, monthsSinceLastChange: null }, DEFAULT_ELIGIBILITY),
    ).toBe(false)
  })

  it('rejects a lease priced ABOVE street', () => {
    expect(
      isEligibleForIncrease({ ...candidate, streetRateCents: 10_000 }, DEFAULT_ELIGIBILITY),
    ).toBe(false)
  })
})

describe('targetRateFor', () => {
  it('raises to street', () => {
    expect(targetRateFor({ leaseId: 'l', inPlaceRateCents: 12_900, streetRateCents: 14_900, monthsSinceLastChange: 12 })).toBe(14_900)
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
    expect(noticeIsDue({ status: 'approved', noticeDate: day('2026-09-01') }, day('2026-09-01'))).toBe(true)
  })

  it('catches up on a later run', () => {
    expect(noticeIsDue({ status: 'approved', noticeDate: day('2026-09-01') }, day('2026-09-05'))).toBe(true)
  })

  it('is not due before the notice date', () => {
    expect(noticeIsDue({ status: 'approved', noticeDate: day('2026-09-02') }, day('2026-09-01'))).toBe(false)
  })

  it('never fires without approval — US-11’s "approval is required before notices go out"', () => {
    expect(noticeIsDue({ status: 'pending_approval', noticeDate: day('2026-09-01') }, day('2026-09-01'))).toBe(false)
  })

  it('never re-fires once sent', () => {
    expect(noticeIsDue({ status: 'notice_sent', noticeDate: day('2026-09-01') }, day('2026-09-05'))).toBe(false)
  })
})

describe('applyIsDue', () => {
  it('is due on the effective date once the notice has gone out', () => {
    expect(applyIsDue({ status: 'notice_sent', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(true)
  })

  it('never applies an increase whose notice never went out', () => {
    // The guard that makes "no tenant is charged more without having been
    // told" true by construction rather than by job ordering.
    expect(applyIsDue({ status: 'approved', effectiveDate: day('2026-10-01') }, day('2026-10-01'))).toBe(false)
  })

  it('is not due before the effective date', () => {
    expect(applyIsDue({ status: 'notice_sent', effectiveDate: day('2026-10-02') }, day('2026-10-01'))).toBe(false)
  })

  it('never re-applies', () => {
    expect(applyIsDue({ status: 'applied', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
  })

  it('never applies a cancelled increase', () => {
    expect(applyIsDue({ status: 'cancelled', effectiveDate: day('2026-10-01') }, day('2026-10-05'))).toBe(false)
  })
})
