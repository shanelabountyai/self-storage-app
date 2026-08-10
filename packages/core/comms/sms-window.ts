import { localParts } from '../jobs/schedule.ts'

// PRD 05 FR-8 / §6.4 (B-074). "No SMS outside 8:00am-9:00pm recipient local
// time (TCPA window for telephone solicitations, adopted here for ALL SMS as
// a conservative default), with a per-org stricter override."
//
// Unlike `isMarketingQuietHours` (B-072), this applies to every classification
// — transactional and operational SMS included, not just marketing — because
// TCPA's timing restriction is about the CHANNEL (a text lands on a phone in
// someone's pocket at any hour), not the content. And unlike that fixed
// 9pm-8am window, the bounds here are configurable per facility
// (`Facility.smsQuietHoursStartHour/EndHour`), since §6.4 names Florida's
// stricter mini-TCPA window as a real reason an operator needs to narrow it.

/// True during the hours an SMS must NOT go out. `start`/`end` are the
/// facility's configured open/close hour (default 8/21); half-open like every
/// other hour-window in this codebase — `start` is reachable, `end` is not.
export function isSmsQuietHours(instant: Date, timezone: string, start: number, end: number): boolean {
  const hour = localParts(instant, timezone).hour
  return hour < start || hour >= end
}
