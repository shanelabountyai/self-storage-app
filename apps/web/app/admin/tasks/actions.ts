'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeTask } from '@/lib/admin/tasks'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

const PROOF_FIELD_ERRORS: Record<string, string> = {
  note: 'A note is required to complete this.',
  photo_reference: 'A photo reference is required to complete this.',
}

// PRD 02 §4.9 US-41, §5.5 FR-19/FR-20 (B-141). Used to be a plain
// `Promise<void>` action that discarded `completeTask`'s `{ ok: false,
// missingFields }` refusal — the button was pressed, the page re-rendered
// identically, and the task stayed open, indistinguishable from a broken
// control. All four task queues share this one action, so returning `FormState`
// here (and rendering it through `TaskCompleteForm`/`AdminForm`) fixes the
// refusal for every one of them at once.
export async function completeTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const taskId = String(formData.get('taskId') ?? '')
  const note = String(formData.get('note') ?? '')
  const photoReference = formData.get('photo_reference')

  const result = await completeTask(actor, taskId, {
    note,
    ...(photoReference ? { photo_reference: String(photoReference) } : {}),
  })

  if (!result.ok) {
    // B-166. A refusal with no field to hang it on — this type cannot be
    // closed by completing a form at all. On the note, because that is the
    // control the reader just used and the one the message is about.
    if (result.reason) return fieldError({ note: result.reason })
    return fieldError(
      Object.fromEntries(
        result.missingFields.map((field) => [field, PROOF_FIELD_ERRORS[field] ?? `${field} is required.`]),
      ),
    )
  }

  revalidatePath('/admin/tasks')
  revalidatePath('/admin/access/queue')
  revalidatePath('/admin/delinquency')
  revalidatePath('/admin/walkthrough')
  revalidatePath('/admin/overlocks')
  return success('Task completed.')
}
