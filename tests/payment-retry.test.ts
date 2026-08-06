import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRY_DAYS,
  isFinalAttempt,
  isTerminalDecline,
  nextAttemptDate,
  retryDecision,
} from '../packages/core/billing'

// PRD 02 US-20 (B-046). The retry schedule.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const DUE = d('2026-09-01')

function decide(options: {
  on: string
  failed: number
  code?: string | null
  retryDays?: number[]
}) {
  return retryDecision({
    dueDate: DUE,
    businessDate: d(options.on),
    failedAttempts: options.failed,
    retryDays: options.retryDays,
    lastDeclineCode: options.code,
  })
}

describe('the default schedule', () => {
  it('is US-20’s +1/+3/+5', () => {
    expect([...DEFAULT_RETRY_DAYS]).toEqual([1, 3, 5])
  })

  it('is four attempts in total — the due date plus three retries', () => {
    // "max 3 retries" (US-20). The first try is not a retry.
    expect(decide({ on: '2026-09-01', failed: 0 })).toEqual({ attempt: true, attemptNumber: 1 })
    expect(decide({ on: '2026-09-02', failed: 1 })).toEqual({ attempt: true, attemptNumber: 2 })
    expect(decide({ on: '2026-09-04', failed: 2 })).toEqual({ attempt: true, attemptNumber: 3 })
    expect(decide({ on: '2026-09-06', failed: 3 })).toEqual({ attempt: true, attemptNumber: 4 })
    expect(decide({ on: '2026-09-07', failed: 4 })).toMatchObject({
      attempt: false,
      reason: 'retries_exhausted',
    })
  })
})

describe('offsets are measured from the original due date', () => {
  it('does not slide the schedule forward as attempts fail', () => {
    // The bug this prevents: measuring +1/+3/+5 from the LAST ATTEMPT stretches
    // a 5-day schedule into a 9-day one, so the tenant drifts further past due
    // on every decline instead of the schedule converging. Same anchoring rule
    // as daysPastDue (D-25).
    expect(nextAttemptDate(DUE, 0)).toEqual(d('2026-09-01'))
    expect(nextAttemptDate(DUE, 1)).toEqual(d('2026-09-02'))
    expect(nextAttemptDate(DUE, 2)).toEqual(d('2026-09-04'))
    expect(nextAttemptDate(DUE, 3)).toEqual(d('2026-09-06'))
    expect(nextAttemptDate(DUE, 4)).toBeNull()
  })

  it('holds the attempt until its own day arrives', () => {
    expect(decide({ on: '2026-09-01', failed: 1 })).toMatchObject({
      attempt: false,
      reason: 'not_due_yet',
    })
    expect(decide({ on: '2026-09-03', failed: 2 })).toMatchObject({
      attempt: false,
      reason: 'not_due_yet',
    })
  })

  it('still makes an attempt whose day passed while nothing ran', () => {
    // `>=`, not `===`. A run catching up after an outage must make the attempts
    // that came due while it was down rather than skipping past them.
    expect(decide({ on: '2026-09-20', failed: 1 })).toEqual({ attempt: true, attemptNumber: 2 })
  })

  it('does not attempt before the invoice is even due', () => {
    expect(decide({ on: '2026-08-30', failed: 0 })).toMatchObject({
      attempt: false,
      reason: 'not_due_yet',
    })
  })
})

describe('terminal declines short-circuit the schedule', () => {
  it('stops on an expired card, however many retries are left', () => {
    // US-20: "card-expired failures skip retries and notify the tenant to
    // update the card." Retrying it three more times tells the tenant three
    // more times about something they cannot fix from their side.
    expect(decide({ on: '2026-09-02', failed: 1, code: 'expired_card' })).toMatchObject({
      attempt: false,
      reason: 'terminal_decline',
    })
  })

  it('reports the terminal reason rather than exhaustion when both are true', () => {
    // "The card has expired" is actionable; "we ran out of retries" is not.
    expect(decide({ on: '2026-09-20', failed: 9, code: 'expired_card' })).toMatchObject({
      reason: 'terminal_decline',
    })
  })

  it('keeps retrying an ordinary decline', () => {
    // `card_declined` is often temporary — insufficient funds today, fine on
    // Friday. That is the case the schedule exists for.
    expect(decide({ on: '2026-09-02', failed: 1, code: 'card_declined' })).toEqual({
      attempt: true,
      attemptNumber: 2,
    })
  })

  it('recognises the terminal codes and only those', () => {
    expect(isTerminalDecline('expired_card')).toBe(true)
    expect(isTerminalDecline('stolen_card')).toBe(true)
    expect(isTerminalDecline('card_declined')).toBe(false)
    expect(isTerminalDecline('insufficient_funds')).toBe(false)
    expect(isTerminalDecline(null)).toBe(false)
    expect(isTerminalDecline(undefined)).toBe(false)
  })
})

describe('a configured schedule', () => {
  it('honours a facility that retries once', () => {
    expect(decide({ on: '2026-09-03', failed: 1, retryDays: [2] })).toEqual({
      attempt: true,
      attemptNumber: 2,
    })
    expect(decide({ on: '2026-09-20', failed: 2, retryDays: [2] })).toMatchObject({
      reason: 'retries_exhausted',
    })
  })

  it('honours a facility that does not retry at all', () => {
    // Empty means one attempt and no more — a real operator choice, not a
    // misconfiguration to guess around.
    expect(decide({ on: '2026-09-01', failed: 0, retryDays: [] })).toEqual({
      attempt: true,
      attemptNumber: 1,
    })
    expect(decide({ on: '2026-09-02', failed: 1, retryDays: [] })).toMatchObject({
      reason: 'retries_exhausted',
    })
  })
})

describe('isFinalAttempt', () => {
  it('is true once the schedule has nothing left', () => {
    expect(isFinalAttempt(3)).toBe(false)
    expect(isFinalAttempt(4)).toBe(true)
    expect(isFinalAttempt(1, [])).toBe(true)
  })
})
