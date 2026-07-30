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
export function DayScheduleRow({ namePrefix, day, value }: Props) {
  const [closed, setClosed] = useState(value.closed)
  const closedId = useId()

  return (
    <tr>
      <td className="py-1 pr-4 capitalize">{day}</td>
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
        </label>
      </td>
      <td className="py-1 pr-4">
        <label htmlFor={`${closedId}-open`} className="sr-only">
          {day} opening time
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
          {day} closing time
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
