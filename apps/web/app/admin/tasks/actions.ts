'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeTask } from '@/lib/admin/tasks'

// PRD 02 §4.9 US-41. A plain form action, not the FormState pattern: the
// per-task inline form on the list has nowhere natural to render a field
// error, and "missing proof" here just means the row stays open — which the
// revalidated list already shows.
export async function completeTaskAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const taskId = String(formData.get('taskId') ?? '')
  const note = String(formData.get('note') ?? '')

  await completeTask(actor, taskId, { note })
  revalidatePath('/admin/tasks')
  // B-065's keypad queue renders the same tasks; completing one there has to
  // clear it there too.
  revalidatePath('/admin/access/queue')
}
