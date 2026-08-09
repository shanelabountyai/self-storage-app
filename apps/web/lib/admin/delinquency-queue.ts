import { facilityTasks, type TaskRow } from './tasks'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.6 US-26 (B-059). "Today's due steps grouped by type (overlocks to
// apply/remove, notices to mail, proofs to record), so nothing is missed."
//
// US-41's AC is explicit that this is a filtered view of the one `Task` list,
// not a table of its own — so this reads `facilityTasks` and groups, rather
// than querying `Task` again.

const GROUPS = [
  { type: 'overlock_apply', heading: 'Overlocks to apply' },
  { type: 'overlock_remove', heading: 'Overlocks to remove' },
  { type: 'delinquency_step', heading: 'Notices to mail, proofs to record' },
] as const

export type DelinquencyQueueGroup = { type: string; heading: string; tasks: TaskRow[] }

export async function delinquencyQueue(actor: Actor, facilityId: string): Promise<DelinquencyQueueGroup[]> {
  const tasks = await facilityTasks(actor, facilityId)

  return GROUPS.map((group) => ({
    ...group,
    tasks: tasks.filter((task) => task.type === group.type),
  })).filter((group) => group.tasks.length > 0)
}
