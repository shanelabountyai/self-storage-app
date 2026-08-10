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
  const photoReference = formData.get('photo_reference')

  await completeTask(actor, taskId, {
    note,
    // Only some types require this (B-058's `overlock_apply`); omitted rather
    // than sent as an empty string so `missingProofFields` reports it as
    // missing, not as present-but-blank, when a form has no such field at all.
    ...(photoReference ? { photo_reference: String(photoReference) } : {}),
  })
  revalidatePath('/admin/tasks')
  // B-065's keypad queue, B-059's delinquency queue and B-060's walkthrough all
  // render the same tasks; completing one anywhere has to clear it everywhere.
  revalidatePath('/admin/access/queue')
  revalidatePath('/admin/delinquency')
  revalidatePath('/admin/walkthrough')
  // Completing an overlock_apply/overlock_remove task is what moves the
  // reconciliation view's rows between states.
  revalidatePath('/admin/overlocks')
}
