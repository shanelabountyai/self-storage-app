'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@storage/db'
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

  // B-333. The subject, because the message no longer arrives in the row.
  //
  // Until B-333 this sentence was announced from inside the acknowledged
  // row's own cell, so "this lease" had an antecedent a reader could see. The
  // region now lives above the table — the only place a revalidation cannot
  // unmount it — and up there, on a report that can carry a facility's worth
  // of rows, "this lease" names nothing at all.
  //
  // Read back from the database rather than taken from a hidden field: the
  // form could supply the label it already renders, but then the success
  // message would be whatever the client posted, and the one guarantee worth
  // having about a confirmation is that it describes what the SERVER did.
  const subject = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { unit: { select: { number: true } }, tenant: { select: { firstName: true, lastName: true } } },
  })
  const named = subject
    ? `${subject.tenant.firstName} ${subject.tenant.lastName}, unit ${subject.unit.number}`
    : null

  return success(
    named
      ? `Recorded for ${named}. The daily task will not name this lease again unless the difference changes.`
      : 'Recorded. The daily task will not name this lease again unless the difference changes.',
  )
}
