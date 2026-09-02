import { describe, expect, it } from 'vitest'
import { formatCalendarDate, formatDay } from '@/lib/format'
import { parseDate } from '@/lib/admin/form-state'

// B-228. The same payment-plan installment was due on two different days, one
// tap apart: the portal dashboard formatted the date in the facility's
// timezone, the schedule and the staff-side profile did not. `graceEndsOn`
// derives from the same value, so the tenant who paid on the day the schedule
// named could have had their plan marked broken.
//
// What is under test is the reading, not the storage. A date typed into a
// `yyyy-mm-dd` field is a calendar day with no time in it; `parseDate` holds it
// at UTC midnight, the shape `businessDateFor` already produces, and it has to
// be read back in UTC or it names the day before.
describe('a calendar date is read back as the day that was typed', () => {
  const typed = parseDate('2026-10-15')
  if (!('value' in typed)) throw new Error('parseDate rejected a valid date')
  const dueDate = typed.value

  it('names the day the staffer entered', () => {
    expect(formatCalendarDate(dueDate)).toBe('October 15, 2026')
  })

  // The defect itself, kept runnable: this is what the dashboard was doing, and
  // it is a day early in every US timezone. If someone ever "fixes" a
  // disagreement by handing `formatCalendarDate` a facility timezone, the
  // assertion above fails and this one says why.
  it('would have been the day before through a facility timezone', () => {
    const throughFacility = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(dueDate)
    expect(throughFacility).toBe('October 14, 2026')
  })

  // The grace deadline is the date a tenant is actually held to, and it is
  // `dueDate` plus whole days — so it has to survive the same reading, DST
  // crossing included. 2026-11-01 is the US fall-back day; a local-midnight
  // reckoning lands on 23:00 the previous evening and reads as 15 November.
  it('survives a grace window that crosses a DST boundary', () => {
    const graceEndsOn = new Date(dueDate.getTime() + 31 * 86_400_000)
    expect(formatCalendarDate(graceEndsOn)).toBe('November 15, 2026')
  })

  // Every surface reads the same day, whatever shape it prints it in — the
  // dashboard's month-and-day, the schedules' short form, and `formatDay` for
  // the `yyyy-mm-dd` strings the notice paths carry.
  it('agrees across every shape a surface prints it in', () => {
    expect(formatCalendarDate(dueDate, { month: 'long', day: 'numeric' })).toBe('October 15')
    expect(formatCalendarDate(dueDate, { day: 'numeric', month: 'short', year: 'numeric' })).toBe(
      'Oct 15, 2026',
    )
    expect(formatDay('2026-10-15')).toBe('Oct 15, 2026')
  })
})
