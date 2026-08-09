import { prisma } from '@storage/db'
import { createTask } from '@/lib/admin/tasks'

// PRD 02 US-43 (B-097). "A lead not contacted within the facility's configured
// window generates a follow-up task... A lead with no disposition is visible,
// never silently ageing in `new`."
//
// A job rather than a computed view, unlike B-065's keypad SLA. The difference
// is who needs to see it: an overdue keypad task is read off a queue somebody
// already has open, while an uncontacted lead has to reach the ONE list a
// part-timer checks on a Saturday (US-41). That means a real `Task` row.

export type FollowUpResult = { raised: number }

/// Raises a follow-up for every lead past its facility's window with no
/// disposition. Idempotent: `createTask` dedupes on (type, entityId, business
/// date), so re-running the same night is a no-op rather than a second nudge.
export async function raiseLeadFollowUps(
  facilityId: string,
  now: Date = new Date(),
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<FollowUpResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { leadFollowUpHours: true },
  })

  const cutoff = new Date(now.getTime() - facility.leadFollowUpHours * 3_600_000)

  const stale = await prisma.lead.findMany({
    where: {
      facilityId,
      // `new` only. A lead somebody marked `contacted` and then left alone is a
      // different problem — they HAVE been called — and nagging about it would
      // teach staff that the queue does not mean anything.
      status: 'new',
      contactedAt: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
  })

  let raised = 0
  for (const lead of stale) {
    const task = await createTask({
      facilityId,
      type: 'lead_follow_up',
      entityType: 'Lead',
      entityId: lead.id,
      at: now,
      // Normal, not high. A prospect who has not been called in four hours is
      // worth chasing today; putting it at the same level as a gate that will
      // not open for a paying tenant is how a queue stops sorting.
      priority: 'normal',
    })
    if (task.created) raised += 1
  }

  recordItem?.({
    itemId: facilityId,
    ok: true,
    message: `${raised} lead follow-up${raised === 1 ? '' : 's'} raised`,
  })

  return { raised }
}
