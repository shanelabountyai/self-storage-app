'use server'

import { revalidatePath } from 'next/cache'

import {
  postLedgerAdjustment,
  voidRentInvoice,
  writeOffOpenLeaseBalance,
  type CorrectionRefusal,
} from '@/lib/billing/corrections'
import { fieldError, parseScaled, success, type FormState } from '@/lib/admin/form-state'
import { formatCents } from '@/lib/format'
import { requireStaffActor } from '@/lib/rbac/session'

// B-303. The three repairs, from the ledger screen the exception report already
// links to. Every gate is the domain function's; this only turns its refusals
// into sentences with a control attached.

function revalidateLedger(tenantId: string, leaseId: string): void {
  revalidatePath(`/admin/tenants/${tenantId}/ledger/${leaseId}`)
  revalidatePath(`/admin/tenants/${tenantId}`)
  // The whole point of the repair: the lease leaves the exception list.
  revalidatePath('/admin/reports/ledger-exceptions')
}

/// The refusals the three share, onto the field a reader can actually change.
///
/// An authority refusal goes on the AMOUNT wherever there is one — B-167's
/// rule. On a write-off there is no amount field, because the amount is the
/// balance, so it goes on the form.
function refusalState(
  refusal: CorrectionRefusal,
  options: { amountField?: string; nothingToDo: string },
): FormState {
  const amountField = options.amountField ?? null
  switch (refusal.reason) {
    case 'missing_reason':
      return fieldError({ reasonCode: 'Choose why this is being posted — it is the record.' })
    case 'bad_amount':
      return fieldError({
        [amountField ?? 'amountDollars']: 'Enter an amount in dollars, like -161.00.',
      })
    case 'forbidden':
      return {
        status: 'error',
        message: 'You do not have permission to correct a ledger at this facility.',
        fieldErrors: {},
      }
    case 'over_limit': {
      const sentence = `That is more than your ${formatCents(refusal.limitCents)} limit.${
        refusal.escalateTo ? ` A ${refusal.escalateTo} can carry it.` : ''
      }`
      return amountField
        ? fieldError({ [amountField]: sentence })
        : { status: 'error', message: sentence, fieldErrors: {} }
    }
    case 'nothing_to_do':
      return {
        status: 'error',
        message: options.nothingToDo,
        fieldErrors: {},
      }
    default:
      return { status: 'error', message: 'That lease could not be found.', fieldErrors: {} }
  }
}

export async function adjustLedgerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  // A ceiling in both directions, and it is the point: this is the one control
  // in the product that can move a balance by an arbitrary signed number, and a
  // fat-fingered "16100" for a $161 correction is a $16,100 restatement of what
  // somebody owes. $100,000 is past any single lease's ledger.
  //
  // Zero is deliberately inside the range. It is the answer for a lease whose
  // balance is already right and whose invoices are what moved — B-292's
  // transfer shape — and `postLedgerAdjustment` refuses it only when there is
  // nothing to reconcile either.
  const amount = parseScaled(formData.get('amountDollars'), {
    scale: 100,
    min: -100_000,
    max: 100_000,
    unit: 'dollars',
  })
  if ('error' in amount) return fieldError({ amountDollars: amount.error })

  const result = await postLedgerAdjustment(actor, {
    leaseId,
    balanceChangeCents: amount.value,
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  })
  if (!result.ok) {
    return refusalState(result, {
      amountField: 'amountDollars',
      nothingToDo:
        'Nothing to correct: this lease already agrees with its invoices and you asked for no change to the balance.',
    })
  }

  revalidateLedger(tenantId, leaseId)
  return success(
    result.balanceChangeCents === 0
      ? 'Corrected. The balance is unchanged and this lease now agrees with its invoices.'
      : `Balance corrected by ${formatCents(result.balanceChangeCents)}. This lease now agrees with its invoices.`,
  )
}

export async function writeOffLedgerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  const result = await writeOffOpenLeaseBalance(actor, {
    leaseId,
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  })
  if (!result.ok) {
    return refusalState(result, { nothingToDo: 'This lease owes nothing, so there is nothing to write off.' })
  }

  revalidateLedger(tenantId, leaseId)
  return success(
    `${formatCents(result.amountCents)} written off. ${
      result.invoicesMarked === 1
        ? 'One invoice is marked uncollectible'
        : `${result.invoicesMarked} invoices are marked uncollectible`
    }, and the lease still reconciles.`,
  )
}

export async function voidInvoiceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  const result = await voidRentInvoice(actor, {
    invoiceId: String(formData.get('invoiceId') ?? ''),
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  })
  if (!result.ok) {
    return refusalState(result, {
      nothingToDo: 'That invoice has already been paid, voided or written off.',
    })
  }

  revalidateLedger(tenantId, leaseId)
  return success(
    `Invoice ${result.number} voided and ${formatCents(result.amountCents)} taken off the ledger. If it was for the current period and the lease is active, the next billing run bills it again at the current rate.`,
  )
}
