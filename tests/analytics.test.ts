import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENTS,
  APPROVED_UTM_MEDIUMS,
  APPROVED_UTM_SOURCES,
  checkUtm,
  emptyFunnel,
  FUNNEL_STEPS,
  funnelFrom,
  isAnalyticsEvent,
  isServerOnly,
  SERVER_ONLY_EVENTS,
} from '../packages/core/analytics/events'

// B-069 / PRD 04 US-15, FR-AN-1/2/4.

describe('the event vocabulary — US-15 AC2', () => {
  it('carries every event the AC names', () => {
    for (const event of [
      'page_view',
      'quote_form_submit',
      'callback_request',
      'reservation_started',
      'reservation_completed',
      'move_in_completed',
      'promo_applied',
      'review_request_click',
    ]) {
      expect(ANALYTICS_EVENTS).toContain(event)
    }
  })

  it('rejects an event nobody declared', () => {
    expect(isAnalyticsEvent('page_view')).toBe(true)
    expect(isAnalyticsEvent('add_to_cart')).toBe(false)
  })

  it('marks move_in_completed as server-only — AC3', () => {
    // "client analytics can't see it." Naming it lets a client-side call be
    // refused rather than silently producing a duplicate the funnel counts.
    expect(isServerOnly('move_in_completed')).toBe(true)
    expect(isServerOnly('page_view')).toBe(false)
    for (const event of SERVER_ONLY_EVENTS) expect(ANALYTICS_EVENTS).toContain(event)
  })

  it('builds every funnel step from a declared event', () => {
    // A step whose event nothing fires is a step that reads zero forever, and
    // the conversion rate above it reads 0% rather than "no data".
    for (const step of FUNNEL_STEPS) expect(ANALYTICS_EVENTS).toContain(step.event)
  })
})

describe('funnelFrom — US-15 AC4', () => {
  it('computes conversion from the step above and from the top', () => {
    const steps = funnelFrom({
      sessions: 1000,
      leads: 100,
      reservations_started: 50,
      reservations_completed: 40,
      move_ins: 10,
    })

    expect(steps.map((step) => step.count)).toEqual([1000, 100, 50, 40, 10])
    // The top step has nothing above it.
    expect(steps[0].fromPrevious).toBeNull()
    expect(steps[0].fromTop).toBe(1)
    expect(steps[1].fromPrevious).toBeCloseTo(0.1)
    // 40 of the 50 who started finished — the number somebody can act on.
    expect(steps[3].fromPrevious).toBeCloseTo(0.8)
    expect(steps[4].fromTop).toBeCloseTo(0.01)
  })

  it('reports null rather than 0% when there is nothing to divide by', () => {
    // 0% implies a measured failure; "no sessions yet" is not one.
    const steps = funnelFrom(emptyFunnel())
    for (const step of steps) {
      expect(step.count).toBe(0)
      expect(step.fromTop).toBeNull()
    }
    expect(steps[1].fromPrevious).toBeNull()
  })

  it('handles a step wider than the one above it without breaking', () => {
    // Possible in a date range that clips a session's first page view. Reported
    // honestly as over 100% rather than clamped, because clamping hides the
    // clipping that caused it.
    const steps = funnelFrom({
      sessions: 10,
      leads: 12,
      reservations_started: 0,
      reservations_completed: 0,
      move_ins: 0,
    })
    expect(steps[1].fromPrevious).toBeCloseTo(1.2)
  })
})

describe('the UTM registry — FR-AN-4', () => {
  it('accepts an approved lower-case pair', () => {
    expect(checkUtm({ utm_source: 'google', utm_medium: 'cpc' })).toEqual([])
  })

  it('accepts the GBP medium the PRD names explicitly', () => {
    expect(checkUtm({ utm_source: 'google', utm_medium: 'organic_gbp' })).toEqual([])
  })

  it('catches mixed case, which silently splits every report', () => {
    const problems = checkUtm({ utm_source: 'Google' })
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toContain('lower case')
  })

  it('catches a value nobody registered', () => {
    const problems = checkUtm({ utm_medium: 'e-mail-blast' })
    expect(problems).toHaveLength(1)
    expect(problems[0].field).toBe('utm_medium')
  })

  it('says nothing about absent tags', () => {
    // An untagged link is direct or organic traffic, not a mistake.
    expect(checkUtm({})).toEqual([])
    expect(checkUtm({ utm_source: null, utm_medium: null })).toEqual([])
  })

  it('registers the aggregator sources PRD 04 §2 calls structural', () => {
    expect(APPROVED_UTM_SOURCES).toContain('sparefoot')
    expect(APPROVED_UTM_MEDIUMS).toContain('aggregator')
  })
})
