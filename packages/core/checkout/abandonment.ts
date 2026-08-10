// PRD 04 §3.6 US-9, FR-LEAD-4 (B-073). Abandoned-checkout follow-up.
//
// Hour-counted, not day-counted — the first email fires within an hour of
// abandonment, which none of this codebase's existing day-granular jobs
// (SCHEDULED_JOBS, businessDateFor) can express. This is checked every cron
// tick (hourly, see the note in apps/web/app/api/cron/route.ts) against real
// elapsed milliseconds, the same shape B-031's `sendExpiringSoonReminders`
// already uses for its own time-window (not once-daily) check.

export const ABANDONMENT_STEPS = [1, 2, 3] as const
export type AbandonmentStep = (typeof ABANDONMENT_STEPS)[number]

/// AC2: "Follow-up sequence: +1h, +24h, +72h (configurable)." The STRUCTURE —
/// three steps — is fixed, matching US-14's own "operators can edit copy, not
/// sequence logic" precedent; only these default offsets are a starting point
/// for the per-facility setting.
export const DEFAULT_ABANDONMENT_HOURS: readonly [number, number, number] = [1, 24, 72]

/// Whether a step is due, given the facility's configured hour offsets.
/// `>=`, not `===` — the hourly cron tick will not land on the exact minute a
/// threshold crosses, and a missed tick must still catch up on the next one.
export function abandonmentStepDue(
  sessionCreatedAt: Date,
  step: AbandonmentStep,
  hours: readonly number[],
  now: Date,
): boolean {
  const delayHours = hours[step - 1]
  if (delayHours === undefined) return false
  return now.getTime() - sessionCreatedAt.getTime() >= delayHours * 3_600_000
}

export type AbandonmentState = { status: string }

/// AC2: "sequence halts immediately on reservation completion." Unsubscribe is
/// not checked here — it is a consent fact, not a checkout fact, and the
/// comms engine's own suppression path already covers it uniformly for every
/// marketing send. Deliberately does NOT treat `expired` as an exit: a lapsed
/// 30-minute lock is the ORDINARY case by the time 60 minutes have passed —
/// it is the premise of the whole sequence, not a reason to skip it.
export function abandonmentExitReason(state: AbandonmentState): 'completed' | null {
  return state.status === 'completed' ? 'completed' : null
}

export class InvalidAbandonmentScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAbandonmentScheduleError'
  }
}

/// Parses "1, 24, 72" into the three configured offsets. Exactly three,
/// strictly increasing, because the sequence structure itself (AC2) is not
/// something a facility may change — only the timing.
export function parseAbandonmentHours(raw: string): [number, number, number] {
  const parts = raw
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
  if (parts.length !== 3) {
    throw new InvalidAbandonmentScheduleError(
      'Enter exactly three offsets in hours, like "1, 24, 72" — one per follow-up step.',
    )
  }

  const hours: number[] = []
  for (const part of parts) {
    const value = Number(part)
    if (!Number.isInteger(value) || value < 1 || value > 720) {
      throw new InvalidAbandonmentScheduleError(
        `"${part}" is not a whole number of hours between 1 and 720 (30 days).`,
      )
    }
    if (hours.length > 0 && value <= hours[hours.length - 1]) {
      throw new InvalidAbandonmentScheduleError('List the offsets in increasing order.')
    }
    hours.push(value)
  }
  return hours as [number, number, number]
}
