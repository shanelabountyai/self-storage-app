'use client'

import { useId, useState } from 'react'
import type { DayOfWeek, DaySchedule } from '@storage/core/facility-settings'

type Props = {
  /// Prefix so office-hours and gate-hours fields don't collide on the same form.
  namePrefix: string
  day: DayOfWeek
  value: DaySchedule
}

/// One row of a weekly-hours editor. Native <input type="time"> and a
/// checkbox — the only client-side behavior is disabling the time inputs
/// while "closed" is checked, so a closed day can't submit stale times.
///
/// Every control names its row (B-094). The two schedules render fourteen
/// checkboxes on one page and their accessible name used to be "Closed" for
/// all fourteen, with the day sitting in a <td> rather than a <th scope="row">
/// — so there was no way to tell Monday's office closure from Sunday's gate
/// closure by ear. The time inputs beside them were already labelled per day;
/// the pattern was known and just not applied to the checkbox.
export function DayScheduleRow({ namePrefix, day, value }: Props) {
  const [closed, setClosed] = useState(value.closed)
  const closedId = useId()
  const schedule = namePrefix === 'gateHours' ? 'Gate hours' : 'Office hours'

  return (
    <tr>
      <th scope="row" className="py-1 pr-4 text-left font-normal capitalize">
        {day}
      </th>
      <td className="py-1 pr-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            id={closedId}
            type="checkbox"
            name={`${namePrefix}.${day}.closed`}
            checked={closed}
            onChange={(e) => setClosed(e.target.checked)}
          />
          Closed
          <span className="sr-only">
            {' '}
            — {schedule}, {day}
          </span>
        </label>
      </td>
      <td className="py-1 pr-4">
        <label htmlFor={`${closedId}-open`} className="sr-only">
          {schedule}, {day} opening time
        </label>
        <input
          id={`${closedId}-open`}
          type="time"
          name={`${namePrefix}.${day}.open`}
          defaultValue={value.closed ? '' : value.open}
          disabled={closed}
          required={!closed}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm disabled:opacity-50"
        />
      </td>
      <td className="py-1">
        <label htmlFor={`${closedId}-close`} className="sr-only">
          {schedule}, {day} closing time
        </label>
        <input
          id={`${closedId}-close`}
          type="time"
          name={`${namePrefix}.${day}.close`}
          defaultValue={value.closed ? '' : value.close}
          disabled={closed}
          required={!closed}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm disabled:opacity-50"
        />
      </td>
    </tr>
  )
}
