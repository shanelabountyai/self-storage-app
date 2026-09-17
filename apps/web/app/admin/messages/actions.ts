'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { recordLetterPrinted } from '@/lib/admin/message-print'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// B-318. The print action, and the only thing that closes a
// `no_reachable_channel` task — the catalog refuses a note for that type.

export async function printLetterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const messageId = String(formData.get('messageId') ?? '')

  const result = await recordLetterPrinted(actor, messageId)

  // On the submit button rather than a field: this form has no fields, and the
  // refusals it can return ("no address of record", "nothing was composed") are
  // about the letter the reader is looking at, not about anything they typed.
  if (!result.ok) return fieldError({ print: result.reason })

  // The task queue and the deliverability report both count this task, and the
  // tenant's own profile shows the message log the reader came from.
  revalidatePath('/admin/tasks')
  revalidatePath('/admin/reports/deliverability')
  revalidatePath('/admin/tenants/[tenantId]', 'page')

  return success(
    result.taskClosed
      ? 'Letter printed. The task for this tenant is closed — the letter is the record that they were told.'
      : 'Letter printed. There was no open task for this tenant, so nothing was closed.',
  )
}
