import type { Consumer } from '@storage/core/events'

// Consumer and job registration. Both are empty at B-006 — this item builds the
// machinery, and the things that use it arrive with their own backlog items:
// reservation expiry (B-018), Stripe reconciliation (B-019), gate command
// outbox (B-027), comms (B-030), billing scheduler (B-043).

export const CONSUMERS: readonly Consumer[] = []

export type ScheduledJob = {
  name: string
  /// Facility-local hour this runs at, 0–23. Jobs that are not per-facility use
  /// `scope: 'global'` and run at this hour UTC.
  localHour: number
  scope: 'per_facility' | 'global'
  handler: (context: {
    facilityId: string | null
    businessDate: Date
    recordItem: (outcome: { itemId: string; ok: boolean; message?: string }) => void
  }) => Promise<void>
}

export const SCHEDULED_JOBS: readonly ScheduledJob[] = []
