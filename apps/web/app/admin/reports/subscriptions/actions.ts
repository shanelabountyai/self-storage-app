'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { addSubscription, removeSubscription } from '@/lib/admin/report-subscriptions'

// PRD 02 US-40 (B-084 part 3). The gates live in
// lib/admin/report-subscriptions.ts; these turn a refusal into a sentence.

export async function addSubscriptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await addSubscription(actor, facilityId, {
    reportKey: String(formData.get('reportKey') ?? ''),
    cadence: String(formData.get('cadence') ?? ''),
    recipients: String(formData.get('recipients') ?? ''),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  revalidatePath('/admin/reports/subscriptions')
  return success('Scheduled. The first one goes out at 6am at this facility, on its next due day.')
}

export async function removeSubscriptionAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  await removeSubscription(actor, String(formData.get('subscriptionId') ?? ''))
  revalidatePath('/admin/reports/subscriptions')
}
