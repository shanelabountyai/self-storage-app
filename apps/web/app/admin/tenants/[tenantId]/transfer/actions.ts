'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeTransfer, TRANSFER_PROBLEM_COPY, type TransferProblem } from '@/lib/admin/transfer'
import { fieldError, type FormState } from '@/lib/admin/form-state'

// PRD 02 US-14 (B-077). Thin session wrapper; lib/admin/transfer.ts holds
// every rule and re-runs the preview so the confirmed figure is the posted one.

export async function completeTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  const result = await completeTransfer(actor, {
    leaseId: String(formData.get('leaseId') ?? ''),
    toUnitId: String(formData.get('toUnitId') ?? ''),
    // A UTC calendar date, matching how the lease's own dates are stored —
    // a transfer happens on a day, not at an instant.
    transferDate: new Date(`${String(formData.get('transferDate') ?? '')}T00:00:00.000Z`),
  })

  if (!result.ok) {
    return fieldError({ toUnitId: TRANSFER_PROBLEM_COPY[result.problem as TransferProblem] })
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath('/admin/units')
  redirect(`/admin/tenants/${tenantId}?transferred=1`)
}
