import { DAYS_OF_WEEK, type WeeklySchedule } from '../facility-settings/weekly-schedule.ts'

// PRD 03 US-8 AC1 (B-086). The "schedule" half of a shared-access scope, as
// three presets rather than a weekly-schedule editor.
//
// The column underneath is a full `WeeklySchedule` and stays that way — a
// manager at the counter may eventually need an arbitrary window, and the
// storage is already general. What is deliberately NOT built is the UI for
// one: a seven-row open/close grid in a tenant portal, to express a choice
// that in practice is "whenever I can get in", "while I'm at work" or "at the
// weekend". Every preset narrows against the facility's own hours anyway
// (`narrowSchedule`), so the exact minutes matter less than the shape.

export const SHARED_ACCESS_PRESETS = {
  anytime: { label: 'Any time the gate is open', schedule: null },
  weekdays: { label: 'Weekdays only', schedule: weekly({ weekdays: true, weekend: false }) },
  weekends: { label: 'Weekends only', schedule: weekly({ weekdays: false, weekend: true }) },
} as const

export type SharedAccessPreset = keyof typeof SHARED_ACCESS_PRESETS

export function isSharedAccessPreset(value: string): value is SharedAccessPreset {
  return value in SHARED_ACCESS_PRESETS
}

/// Which preset a stored schedule came from, for rendering a list back.
///
/// Compared by value rather than stored as an enum beside the JSON, so the two
/// can never disagree. A schedule that matches no preset — a manager's custom
/// window, or a preset whose definition later changes — reads as `custom`,
/// which the caller renders as "limited hours" rather than as a wrong label.
export function presetFor(schedule: WeeklySchedule | null): SharedAccessPreset | 'custom' {
  if (!schedule) return 'anytime'
  const json = JSON.stringify(canonical(schedule))
  for (const [key, preset] of Object.entries(SHARED_ACCESS_PRESETS)) {
    if (preset.schedule && JSON.stringify(canonical(preset.schedule)) === json) {
      return key as SharedAccessPreset
    }
  }
  return 'custom'
}

function canonical(schedule: WeeklySchedule): unknown[] {
  return DAYS_OF_WEEK.map((day) => {
    const entry = schedule[day]
    return entry.closed ? 'closed' : `${entry.open}-${entry.close}`
  })
}

/// Full days, not office hours. The facility's own gate hours are the outer
/// bound and this is narrowed against them, so naming a tighter window here
/// would silently override a site's 24-hour access for one guest and be
/// invisible on every screen.
function weekly(days: { weekdays: boolean; weekend: boolean }): WeeklySchedule {
  const open = { closed: false, open: '00:00', close: '23:59' } as const
  return Object.fromEntries(
    DAYS_OF_WEEK.map((day) => {
      const isWeekend = day === 'saturday' || day === 'sunday'
      const allowed = isWeekend ? days.weekend : days.weekdays
      return [day, allowed ? open : { closed: true }]
    }),
  ) as WeeklySchedule
}
