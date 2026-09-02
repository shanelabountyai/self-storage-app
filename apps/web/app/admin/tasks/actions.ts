'use server'

import { revalidatePath } from 'next/cache'
import { PROOF_FIELDS, PROOF_FIELD_LABELS } from '@storage/core/delinquency'
import { requireStaffActor } from '@/lib/rbac/session'
import { assignTask, completeTask } from '@/lib/admin/tasks'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

/// The paths every task queue is rendered at. One list, because a task shows on
/// more than one of them and a claim that only refreshes the screen it was
/// pressed on leaves the same card unclaimed on the next.
const TASK_QUEUE_PATHS = [
  '/admin/tasks',
  '/admin/access/queue',
  '/admin/delinquency',
  '/admin/walkthrough',
  '/admin/overlocks',
]

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

  for (const path of TASK_QUEUE_PATHS) revalidatePath(path)

  // B-170. Named, because this message is announced from a region ABOVE the
  // list and the row it reports on is gone by the time it is read — and because
  // two identical completions in a row would otherwise write identical text
  // into a live region, which is no mutation and so no announcement at all.
  const subject = String(formData.get('subjectLabel') ?? '').trim()
  return success(subject ? `Task completed: ${subject}` : 'Task completed.')
}

// PRD 02 §4.9 US-41 (B-233). "My day" was everyone's day: `assignTask` shipped
// in B-095 with tests and no caller, so both queues rendered "Unassigned" as a
// fact nobody could act on. Two staff on a Saturday worked one undifferentiated
// list and could cut the same lock twice.
//
// One action for both buttons, and for both queues, the same way
// `completeTaskAction` is: `take` claims, anything else gives back. The
// authority question ("may I hold this?") is `assignTask`'s, not this one's —
// this reads the form and renders the answer.
export async function assignTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const taskId = String(formData.get('taskId') ?? '')
  const take = String(formData.get('intent') ?? '') === 'take'

  const result = await assignTask(actor, taskId, take ? actor.staffUserId : null)

  if (!result.ok) {
    // No field to hang this on: the refusal is about who holds the task, not
    // about anything typed. `message` carries it whole, into the alert summary.
    return { status: 'error', message: result.reason, fieldErrors: {} }
  }

  for (const path of TASK_QUEUE_PATHS) revalidatePath(path)

  // Named for the same reason completion is (B-170): this is announced from a
  // region above the list, and under the Unassigned filter the card it reports
  // on is gone by the time it is read. Two claims in a row would otherwise
  // write identical text into a live region, which is no mutation and so no
  // announcement at all.
  const subject = String(formData.get('subjectLabel') ?? '').trim()
  return success(
    take
      ? subject ? `You took: ${subject}` : 'You took this task.'
      : subject ? `You gave back: ${subject}` : 'You gave this task back.',
  )
}
