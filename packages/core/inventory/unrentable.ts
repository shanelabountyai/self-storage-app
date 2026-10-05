// PRD 02 US-8 "AC (unrentable says why)" (B-433). Pure, so the arithmetic and
// the two limits are testable without a database.

export const UNRENTABLE_REASONS = ['company_use', 'damaged', 'owner_use', 'held_for_demolition'] as const
export type UnrentableReason = (typeof UNRENTABLE_REASONS)[number]

export const UNRENTABLE_REASON_LABELS: Record<UnrentableReason, string> = {
  company_use: 'Company use',
  damaged: 'Damaged',
  owner_use: 'Owner use',
  held_for_demolition: 'Held for demolition',
}

export function isUnrentableReason(value: string): value is UnrentableReason {
  return (UNRENTABLE_REASONS as readonly string[]).includes(value)
}

/// The owner's defaults (2026-10-04). `OrgSetting`'s column defaults say the
/// same; these are what a caller gets before the row exists.
export const DEFAULT_UNRENTABLE_LIMITS = { maxUnits: 5, maxDays: 30 }
export type UnrentableLimits = typeof DEFAULT_UNRENTABLE_LIMITS

const DAY_MS = 86_400_000

/// Whole days a unit has been unrentable. The day it was set counts as 0.
export function daysUnrentable(setAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - setAt.getTime()) / DAY_MS))
}

/// Rent not collected over `days` at a monthly street rate, in integer cents.
/// A day is 12/365 of the monthly rate, so a year of days is twelve months of
/// rent whatever the month lengths were.
export function rentLostCents(monthlyStreetRateCents: number, days: number): number {
  return Math.round((monthlyStreetRateCents * 12 * days) / 365)
}

/// Null when the change is within the org's limits or the actor may exceed
/// them; otherwise the sentence to show. Both limits are checked, units first.
export function unrentableLimitRefusal(input: {
  /// Units at the facility that would be unrentable AFTER this change.
  unitsAfter: number
  setAt: Date
  /// Null is "no review date", which is open-ended and so past any limit.
  reviewAt: Date | null
  limits: UnrentableLimits
  mayExceed: boolean
}): string | null {
  if (input.mayExceed) return null
  const { maxUnits, maxDays } = input.limits
  if (input.unitsAfter > maxUnits) {
    return `This would make ${input.unitsAfter} units unrentable at this facility. More than ${maxUnits} needs a district manager.`
  }
  if (!input.reviewAt || input.reviewAt.getTime() > input.setAt.getTime() + maxDays * DAY_MS) {
    return `A unit can stay unrentable for ${maxDays} days. A later review date, or none, needs a district manager.`
  }
  return null
}
