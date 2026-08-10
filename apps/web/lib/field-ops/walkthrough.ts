import { createTask } from '@/lib/admin/tasks'

// PRD 02 §4.9 US-35 (B-060). "Daily walkthrough checklist: a mobile-web
// checklist generated daily per facility."
//
// One `Task` per facility per business day, standing for the walk itself — the
// real per-unit work it bundles (overlocks, units awaiting a post-move-out
// check) is each already its own Task or its own list; this is what makes
// "did anyone walk the property today" a visible, completable fact rather than
// an inference from whether anything else happened to get done. Idempotent via
// `createTask`'s (type, entityId, businessDate) key, so a caught-up run raises
// one per missed day, not a pile for the same day.
export async function raiseDailyWalkthrough(
  facilityId: string,
  businessDate: Date,
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<void> {
  const task = await createTask({
    facilityId,
    type: 'daily_walkthrough',
    entityType: 'Facility',
    entityId: facilityId,
    at: businessDate,
  })
  recordItem?.({ itemId: facilityId, ok: true, message: task.created ? 'raised' : 'already raised' })
}
