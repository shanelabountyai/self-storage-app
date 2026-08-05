'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { MoveOutReason } from '@storage/db'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeMoveOut } from '@/lib/admin/move-out'
import { fieldError, type FormState } from '@/lib/admin/form-state'

// PRD 02 US-14. Thin session wrapper; lib/admin/move-out.ts holds the rules.

const PROBLEM_COPY: Record<string, string> = {
  not_occupying: 'That lease has already ended.',
  needs_manager: 'This lease owes more than the write-off threshold — a manager has to close it.',
  reason_code_required: 'Choose a reason for the write-off.',
}

export async function completeMoveOutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  const result = await completeMoveOut(actor, {
    leaseId: String(formData.get('leaseId') ?? ''),
    // Parsed as a UTC calendar date, matching how `Lease.moveOutDate` is
    // stored (@db.Date) — a move-out is a day, not an instant.
    moveOutDate: new Date(`${String(formData.get('moveOutDate') ?? '')}T00:00:00.000Z`),
    reason: String(formData.get('reason') ?? 'tenant_request') as MoveOutReason,
    writeOff: formData.get('writeOff') === 'yes',
    reasonCode: String(formData.get('reasonCode') ?? ''),
  })

  if (!result.ok) {
    return fieldError({ reason: PROBLEM_COPY[result.problem] ?? 'That move-out could not be completed.' })
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath('/admin/units')
  redirect(`/admin/tenants/${tenantId}?movedOut=1`)
}
