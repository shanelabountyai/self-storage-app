'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { addSuppression, removeSuppression } from '@/lib/admin/suppressions'

// CN-20's two writes. Every rule lives in lib/admin/suppressions.ts; these turn
// a refusal into a sentence and nothing else.

export async function addSuppressionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await addSuppression(actor, facilityId, {
    channel: formData.get('channel') === 'sms' ? 'sms' : 'email',
    address: String(formData.get('address') ?? ''),
    note: String(formData.get('note') ?? ''),
  })
  if (!result.ok) return fieldError({ address: result.problem })

  revalidatePath('/admin/settings/suppressions')
  return success('Suppressed. Nothing further will be sent to that address.')
}

export async function removeSuppressionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await removeSuppression(actor, facilityId, {
    id: String(formData.get('id') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  })
  if (!result.ok) return fieldError({ reason: result.problem })

  revalidatePath('/admin/settings/suppressions')
  return success('Lifted. Messages to that address will go out again.')
}
