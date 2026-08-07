import { describe, expect, it } from 'vitest'
import {
  businessMinutesBetween,
  isOverdue,
  neverOpens,
} from '../packages/core/access/business-hours'
import { CLOSED_ALL_WEEK, type WeeklySchedule } from '../packages/core/facility-settings/weekly-schedule'
import { instructionFor } from '../apps/web/lib/access/manual-adapter'

// B-065 / PRD 03 US-6 AC2. Business hours, not elapsed hours.

const CHICAGO = 'America/Chicago'

// Office open 09:00–17:00 weekdays; closed at weekends.
const OFFICE: WeeklySchedule = {
  monday: { closed: false, open: '09:00', close: '17:00' },
  tuesday: { closed: false, open: '09:00', close: '17:00' },
  wednesday: { closed: false, open: '09:00', close: '17:00' },
  thursday: { closed: false, open: '09:00', close: '17:00' },
  friday: { closed: false, open: '09:00', close: '17:00' },
  saturday: { closed: true },
  sunday: { closed: true },
}

// July, so Chicago is UTC-5: 14:00Z is 09:00 local.
const local = (iso: string) => new Date(`${iso}-05:00`)

describe('businessMinutesBetween', () => {
  it('counts time inside the open window', () => {
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T10:00:00'), local('2026-07-15T13:00:00'), CHICAGO),
    ).toBe(180)
  })

  it('ignores time before opening', () => {
    // Raised at 7am, asked at 10am: only one business hour has passed.
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T07:00:00'), local('2026-07-15T10:00:00'), CHICAGO),
    ).toBe(60)
  })

  it('ignores time after closing', () => {
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T16:00:00'), local('2026-07-15T23:00:00'), CHICAGO),
    ).toBe(60)
  })

  it('skips the night between two working days', () => {
    // 16:00 Wednesday to 10:00 Thursday: one hour Wednesday, one Thursday.
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T16:00:00'), local('2026-07-16T10:00:00'), CHICAGO),
    ).toBe(120)
  })

  it('skips the whole weekend', () => {
    // The case the AC is really about: raised 6pm Friday, still open 10am
    // Monday. Wall-clock says 64 hours; business hours say one.
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-17T18:00:00'), local('2026-07-20T10:00:00'), CHICAGO),
    ).toBe(60)
  })

  it('counts a full working day as the window, not 24 hours', () => {
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T00:00:00'), local('2026-07-16T00:00:00'), CHICAGO),
    ).toBe(8 * 60)
  })

  it('is zero for a backwards or empty span', () => {
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T13:00:00'), local('2026-07-15T10:00:00'), CHICAGO),
    ).toBe(0)
    expect(
      businessMinutesBetween(OFFICE, local('2026-07-15T10:00:00'), local('2026-07-15T10:00:00'), CHICAGO),
    ).toBe(0)
  })

  it('counts every hour when no schedule is configured', () => {
    // Silent-failure direction matters: treating an unset schedule as
    // permanently closed would mean nothing ever escalates.
    expect(
      businessMinutesBetween(null, local('2026-07-18T00:00:00'), local('2026-07-18T05:00:00'), CHICAGO),
    ).toBe(300)
  })

  it('never advances at a facility that is closed all week', () => {
    expect(
      businessMinutesBetween(CLOSED_ALL_WEEK, local('2026-07-13T00:00:00'), local('2026-07-20T00:00:00'), CHICAGO),
    ).toBe(0)
    expect(neverOpens(CLOSED_ALL_WEEK)).toBe(true)
    expect(neverOpens(OFFICE)).toBe(false)
  })

  it('crosses a DST boundary without gaining or losing an hour', () => {
    // Chicago springs forward 2026-03-08 (a Sunday, closed here). Monday
    // 09:00–17:00 is still eight business hours on the far side.
    const monday = new Date('2026-03-09T14:00:00Z') // 09:00 CDT
    const evening = new Date('2026-03-09T22:00:00Z') // 17:00 CDT
    expect(businessMinutesBetween(OFFICE, monday, evening, CHICAGO)).toBe(8 * 60)
  })
})

describe('isOverdue — the 4-business-hour SLA', () => {
  it('is not overdue three business hours in', () => {
    expect(
      isOverdue({
        schedule: OFFICE,
        createdAt: local('2026-07-15T10:00:00'),
        now: local('2026-07-15T13:00:00'),
        slaHours: 4,
        timezone: CHICAGO,
      }),
    ).toBe(false)
  })

  it('is overdue at exactly four', () => {
    expect(
      isOverdue({
        schedule: OFFICE,
        createdAt: local('2026-07-15T10:00:00'),
        now: local('2026-07-15T14:00:00'),
        slaHours: 4,
        timezone: CHICAGO,
      }),
    ).toBe(true)
  })

  it('does not escalate overnight', () => {
    // Raised at 4pm, checked at 8am the next morning. Wall clock: 16 hours.
    // Business hours: one. A queue that shouted on every overnight item is one
    // staff learn to scroll past.
    expect(
      isOverdue({
        schedule: OFFICE,
        createdAt: local('2026-07-15T16:00:00'),
        now: local('2026-07-16T08:00:00'),
        slaHours: 4,
        timezone: CHICAGO,
      }),
    ).toBe(false)
  })

  it('escalates by mid-morning the next working day', () => {
    expect(
      isOverdue({
        schedule: OFFICE,
        createdAt: local('2026-07-15T16:00:00'),
        now: local('2026-07-16T12:00:00'),
        slaHours: 4,
        timezone: CHICAGO,
      }),
    ).toBe(true)
  })

  it('never escalates when the SLA is zero', () => {
    expect(
      isOverdue({
        schedule: OFFICE,
        createdAt: local('2026-07-15T10:00:00'),
        now: local('2026-07-30T10:00:00'),
        slaHours: 0,
        timezone: CHICAGO,
      }),
    ).toBe(false)
  })
})

describe('instructionFor — AC1’s "exact keypad action, code value, and reason"', () => {
  const context = { code: '482913', tenantName: 'Ada Renter', unitNumber: 'A-12' }

  it('names the person and the unit', () => {
    const instruction = instructionFor('set_credential', context)
    expect(instruction.action).toContain('Ada Renter')
    expect(instruction.action).toContain('A-12')
    expect(instruction.code).toBe('482913')
  })

  it('tells staff not to delete a suspended code', () => {
    // "Suspend" and "delete" are the same button on some legacy panels, and
    // deleting loses the history US-3 AC3 requires be kept.
    const instruction = instructionFor('suspend_access', context)
    expect(instruction.action).toContain('do not delete')
    expect(instruction.reason).toContain('stay on file')
  })

  it('asks for removal on a move-out, not suspension', () => {
    expect(instructionFor('revoke_access', context).action).toContain('Remove')
  })

  it('carries no code for a schedule change', () => {
    expect(instructionFor('set_time_window', context).code).toBeNull()
  })

  it('degrades to something actionable when the tenant is unknown', () => {
    const instruction = instructionFor('grant_access', {
      code: null,
      tenantName: null,
      unitNumber: null,
    })
    expect(instruction.action).toContain('this tenant')
    expect(instruction.reason).toBeTruthy()
  })
})
