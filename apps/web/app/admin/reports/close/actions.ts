'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  closePeriod,
  periodLabel,
  reopenPeriod,
  saveChartOfAccounts,
} from '@/lib/admin/accounting-close'

// PRD 02 §8, US-40 (B-084 part 1). Both gates live in
// lib/admin/accounting-close.ts; these turn a refusal into a sentence.

function periodFrom(formData: FormData): { facilityId: string; year: number; month: number } {
  return {
    facilityId: String(formData.get('facilityId') ?? ''),
    year: Number(formData.get('year')),
    month: Number(formData.get('month')),
  }
}

export async function closePeriodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const { facilityId, year, month } = periodFrom(formData)

  const result = await closePeriod(actor, facilityId, year, month)
  revalidatePath('/admin/reports/close')
  if (!result.ok) return { status: 'error', message: result.reason, fieldErrors: {} }

  return success(
    `${periodLabel(year, month)} is closed. Its figures are filed and will not move again unless somebody reopens it.`,
  )
}

export async function reopenPeriodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const { facilityId, year, month } = periodFrom(formData)
  const reason = String(formData.get('reason') ?? '')

  const result = await reopenPeriod(actor, facilityId, year, month, reason)
  revalidatePath('/admin/reports/close')
  // Attached to the field, not raised as a form-level message: the missing
  // reason IS the reason box, and 3.3.3 wants the message on the control.
  if (!result.ok) {
    return reason.trim()
      ? { status: 'error', message: result.reason, fieldErrors: {} }
      : fieldError({ reason: result.reason })
  }

  return success(
    `${periodLabel(year, month)} is open again. The figures that were filed are in the audit log; nothing else has them.`,
  )
}

/// B-084 part 2. The account names the journal export posts to.
export async function saveChartAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const input: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (key !== 'facilityId') input[key] = String(value)
  }

  const result = await saveChartOfAccounts(actor, facilityId, input)
  revalidatePath('/admin/reports/close')
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  return success('Saved. The next journal export posts to these accounts.')
}
