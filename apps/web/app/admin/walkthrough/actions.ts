'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { createMaintenanceTicket } from '@/lib/admin/maintenance'
import { recordVacantCheck, VACANT_CHECK_RESULTS, type VacantCheckResult } from '@/lib/field-ops/vacant-checks'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 §4.9 US-35's "free-form findings that convert to maintenance
// tickets" — this is that conversion.
export async function reportFindingAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitId = String(formData.get('unitId') ?? '')
  const title = String(formData.get('title') ?? '')
  const blocksAvailability = formData.get('blocksAvailability') === 'on'

  await createMaintenanceTicket(actor, facilityId, {
    unitId,
    title,
    notes: null,
    priority: 'normal',
    blocksAvailability,
    source: 'walkthrough',
  })

  revalidatePath('/admin/walkthrough')
  revalidatePath('/admin/maintenance')
  revalidatePath('/admin/units')
}

// PRD 02 §4.9 US-35 (B-406). Records one vacant-unit check.
export async function recordVacantCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const result = String(formData.get('result') ?? '')
  if (!(VACANT_CHECK_RESULTS as readonly string[]).includes(result)) {
    return fieldError({ result: 'Choose what you found.' })
  }

  const outcome = await recordVacantCheck(actor, String(formData.get('taskId') ?? ''), result as VacantCheckResult)

  for (const path of ['/admin/walkthrough', '/admin/tasks', '/admin/maintenance', '/admin/units']) revalidatePath(path)
  return success(outcome.message)
}
