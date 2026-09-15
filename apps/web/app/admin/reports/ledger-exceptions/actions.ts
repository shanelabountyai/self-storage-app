'use server'

import { revalidatePath } from 'next/cache'

import { acknowledgeLedgerException } from '@/lib/admin/ledger'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { requireStaffActor } from '@/lib/rbac/session'

// B-304. "Reviewed, known" — the acknowledgement that stops the daily sweep
// re-raising a lease somebody has already judged unrepairable.

export async function acknowledgeExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const leaseId = String(formData.get('leaseId') ?? '')

  const result = await acknowledgeLedgerException(actor, leaseId, {
    note: String(formData.get('note') ?? ''),
  })

  if (!result.ok) {
    switch (result.reason) {
      case 'missing_note':
        return fieldError({
          note: 'Say what you found — the next person to open this report starts from it.',
        })
      case 'forbidden':
        return {
          status: 'error',
          message:
            'Acknowledging needs the same authority as correcting the ledger. Ask a manager.',
          fieldErrors: {},
        }
      case 'reconciles':
        return {
          status: 'error',
          message: 'This lease now agrees with its invoices, so there is nothing to acknowledge.',
          fieldErrors: {},
        }
      default:
        return { status: 'error', message: 'That lease could not be found.', fieldErrors: {} }
    }
  }

  revalidatePath('/admin/reports/ledger-exceptions')
  return success(
    'Recorded. The daily task will not name this lease again unless the difference changes.',
  )
}
