'use server'

import { revalidatePath } from 'next/cache'
import { PROOF_FIELDS, PROOF_FIELD_LABELS } from '@storage/core/delinquency'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeTask } from '@/lib/admin/tasks'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

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

  // B-170. Every proof field the catalogue knows about, not `note` and a
  // conditional photo. What is actually REQUIRED is decided in one place
  // (`requiredProofFieldsFor`); this reads whatever the form put up, and an
  // absent key is simply absent — `completeTask` is the gate, not this.
  const proof: Record<string, string> = {}
  for (const field of PROOF_FIELDS) {
    const value = formData.get(field)
    if (typeof value === 'string' && value.trim() !== '') proof[field] = value.trim()
  }

  const result = await completeTask(actor, taskId, proof)

  if (!result.ok) {
    // B-166. A refusal with no field to hang it on — this type cannot be
    // closed by completing a form at all. On the note, because that is the
    // control the reader just used and the one the message is about.
    if (result.reason) return fieldError({ note: result.reason })
    return fieldError(
      Object.fromEntries(
        result.missingFields.map((field) => [
          field,
          `${PROOF_FIELD_LABELS[field].label} is required to complete this.`,
        ]),
      ),
    )
  }

  revalidatePath('/admin/tasks')
  revalidatePath('/admin/access/queue')
  revalidatePath('/admin/delinquency')
  revalidatePath('/admin/walkthrough')
  revalidatePath('/admin/overlocks')

  // B-170. Named, because this message is announced from a region ABOVE the
  // list and the row it reports on is gone by the time it is read — and because
  // two identical completions in a row would otherwise write identical text
  // into a live region, which is no mutation and so no announcement at all.
  const subject = String(formData.get('subjectLabel') ?? '').trim()
  return success(subject ? `Task completed: ${subject}` : 'Task completed.')
}
