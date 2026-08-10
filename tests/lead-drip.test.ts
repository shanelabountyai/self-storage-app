import { describe, expect, it } from 'vitest'
import { leadDripExitReason, leadDripStepDue, LEAD_DRIP_DELAY_DAYS } from '../packages/core/leads/drip'
import { isMarketingQuietHours } from '../packages/core/comms/marketing-window'

// B-072 / PRD 04 §3.7 US-14, PRD 05 FR-MSG-5.

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('leadDripStepDue — US-14 AC1’s cadence', () => {
  it('step 1 is due immediately', () => {
    expect(leadDripStepDue(d('2026-07-01'), 1, d('2026-07-01'))).toBe(true)
  })

  it('step 2 waits 2 days', () => {
    expect(leadDripStepDue(d('2026-07-01'), 2, d('2026-07-02'))).toBe(false)
    expect(leadDripStepDue(d('2026-07-01'), 2, d('2026-07-03'))).toBe(true)
  })

  it('step 3 waits 5 days', () => {
    expect(leadDripStepDue(d('2026-07-01'), 3, d('2026-07-05'))).toBe(false)
    expect(leadDripStepDue(d('2026-07-01'), 3, d('2026-07-06'))).toBe(true)
  })

  it('stays due after its day — a catch-up run still fires it', () => {
    expect(leadDripStepDue(d('2026-07-01'), 2, d('2026-07-20'))).toBe(true)
  })

  it('matches AC1’s literal offsets', () => {
    expect(LEAD_DRIP_DELAY_DAYS).toEqual({ 1: 0, 2: 2, 3: 5 })
  })
})

describe('leadDripExitReason — US-14 AC1’s exits', () => {
  const inFlight = { status: 'new' as const, hasUnitType: true }

  it('stays in the sequence while new or contacted, with a unit type', () => {
    expect(leadDripExitReason(inFlight)).toBeNull()
    expect(leadDripExitReason({ ...inFlight, status: 'contacted' })).toBeNull()
  })

  it('exits on a reservation or a completed move-in', () => {
    expect(leadDripExitReason({ ...inFlight, status: 'reserved' })).toBe('converted')
    expect(leadDripExitReason({ ...inFlight, status: 'converted' })).toBe('converted')
  })

  it('exits when marked lost', () => {
    expect(leadDripExitReason({ ...inFlight, status: 'lost' })).toBe('lost')
  })

  it('never enters for a lead with no quoted size — a "recap" of nothing', () => {
    expect(leadDripExitReason({ ...inFlight, hasUnitType: false })).toBe('no_unit_type')
  })
})

describe('isMarketingQuietHours — FR-MSG-5', () => {
  it('is quiet from 9pm to 8am facility-local', () => {
    // 03:00 UTC = 21:00 CDT (America/Chicago, summer) the PREVIOUS day locally.
    expect(isMarketingQuietHours(new Date('2026-07-02T02:00:00Z'), 'America/Chicago')).toBe(true)
    expect(isMarketingQuietHours(new Date('2026-07-02T12:00:00Z'), 'America/Chicago')).toBe(true) // 07:00 local
  })

  it('is open from 8am to 9pm facility-local', () => {
    expect(isMarketingQuietHours(new Date('2026-07-02T13:00:00Z'), 'America/Chicago')).toBe(false) // 08:00 local
    expect(isMarketingQuietHours(new Date('2026-07-02T20:00:00Z'), 'America/Chicago')).toBe(false) // 15:00 local
  })

  it('is exactly quiet at the boundary hours', () => {
    // 21:00 local is the FIRST quiet hour; 08:00 local is the FIRST open hour.
    expect(isMarketingQuietHours(new Date('2026-07-03T02:00:00Z'), 'America/Chicago')).toBe(true) // 21:00 local
    expect(isMarketingQuietHours(new Date('2026-07-02T13:00:00Z'), 'America/Chicago')).toBe(false) // 08:00 local
  })

  it('uses the FACILITY’s timezone, not UTC', () => {
    // Same instant, two facilities: one quiet, one not.
    const instant = new Date('2026-07-02T03:00:00Z')
    expect(isMarketingQuietHours(instant, 'America/Chicago')).toBe(true) // 22:00 CDT
    expect(isMarketingQuietHours(instant, 'Pacific/Honolulu')).toBe(false) // 17:00 HST
  })
})
