import { describe, expect, it } from 'vitest'
import {
  bounceRate,
  dailyFailureRateExceeds,
  deliveryRate,
  emptyMessageCounts,
  smsFailureRate,
  totalAttempted,
  type MessageCounts,
} from '../packages/core/metrics/comms'

// PRD 05 CN-19 / §7 success metrics / FR-19 (B-075). The delivery-rate
// definitions, pinned so the dashboard and the alert threshold can never
// silently disagree about what "sent" or "failed" means.

function counts(overrides: Partial<MessageCounts>): MessageCounts {
  return { ...emptyMessageCounts(), ...overrides }
}

describe('totalAttempted', () => {
  it('excludes queued — an unresolved send is not yet an attempt', () => {
    expect(totalAttempted(counts({ queued: 5 } as Partial<MessageCounts>))).toBe(0)
  })

  it('sums sent, delivered, bounced and failed', () => {
    expect(totalAttempted(counts({ sent: 1, delivered: 2, bounced: 3, failed: 4 }))).toBe(10)
  })

  it('excludes suppressed and cancelled — neither was an attempt', () => {
    expect(totalAttempted(counts({ suppressed: 5, cancelled: 5 }))).toBe(0)
  })
})

describe('deliveryRate', () => {
  it('is null with nothing attempted, not 0% — "no sends" is not a failure', () => {
    expect(deliveryRate(emptyMessageCounts())).toBeNull()
  })

  it('counts sent and delivered as successful', () => {
    expect(deliveryRate(counts({ sent: 8, delivered: 1, bounced: 1 }))).toBeCloseTo(0.9)
  })

  it('is 100% when nothing bounced or failed', () => {
    expect(deliveryRate(counts({ sent: 10 }))).toBe(1)
  })
})

describe('bounceRate', () => {
  it('is null with nothing attempted', () => {
    expect(bounceRate(emptyMessageCounts())).toBeNull()
  })

  it('is the share of attempts that bounced', () => {
    expect(bounceRate(counts({ sent: 90, bounced: 10 }))).toBeCloseTo(0.1)
  })
})

describe('smsFailureRate', () => {
  it('is null with nothing attempted', () => {
    expect(smsFailureRate(emptyMessageCounts())).toBeNull()
  })

  it('does not count suppressed SMS as a failure — that is an opt-out, not a delivery failure', () => {
    expect(smsFailureRate(counts({ sent: 10, suppressed: 90 }))).toBe(0)
  })

  it('is the share of attempts that failed outright', () => {
    expect(smsFailureRate(counts({ sent: 97, failed: 3 }))).toBeCloseTo(0.03)
  })
})

describe('dailyFailureRateExceeds (FR-19)', () => {
  it('is false with nothing attempted', () => {
    expect(dailyFailureRateExceeds(emptyMessageCounts())).toBe(false)
  })

  it('is false at exactly the 2% threshold — the AC says "over 2%"', () => {
    expect(dailyFailureRateExceeds(counts({ sent: 98, failed: 2 }))).toBe(false)
  })

  it('is true just over 2%', () => {
    expect(dailyFailureRateExceeds(counts({ sent: 969, failed: 31 }))).toBe(true) // 3.1%
  })

  it('counts bounces toward the same threshold as outright failures', () => {
    expect(dailyFailureRateExceeds(counts({ sent: 95, bounced: 5 }))).toBe(true)
  })

  it('respects a custom threshold', () => {
    expect(dailyFailureRateExceeds(counts({ sent: 90, failed: 10 }), 0.2)).toBe(false)
  })
})
