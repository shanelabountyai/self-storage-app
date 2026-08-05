'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { CounterMethod } from '@storage/core/pos'
import { requireStaffActor } from '@/lib/rbac/session'
import { can, ForbiddenError } from '@/lib/rbac/authorize'
import { recordCounterPayment } from '@/lib/admin/pos'
import { startCheckout } from '@/lib/checkout/session'
import { currentRateForUnitType } from '@/lib/pricing/unit-type-rates'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 §4.8 US-32. Thin session wrappers; the decisions live in
// lib/admin/pos.ts and @storage/core/pos.

const PROBLEM_COPY: Record<string, string> = {
  amount_not_positive: 'Enter an amount greater than zero.',
  amount_not_integer: 'Enter a whole number of cents.',
  tender_required: 'Enter how much cash the tenant handed over.',
  tender_below_amount: 'Cash tendered is less than the amount being paid.',
  check_number_required: 'Enter the check or money-order number.',
  lease_not_found: 'That unit is not on this tenant’s account at this facility.',
  needs_manager: 'Cash this large needs a manager. Ask one to take it, or split the payment.',
  card_not_supported: 'Card payments go through the online payment screen — there is no card terminal here yet.',
}

/// Dollars as typed to integer cents, without floating point: Math.round of
/// (parseFloat * 100) turns 16.10 into 1609.999… on some inputs, and money
/// that rounds is money that is wrong. Same rule as B-035's portal amount.
function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [dollars, fraction = ''] = cleaned.split('.')
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export async function takePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()

  const amountCents = parseDollars(String(formData.get('amount') ?? ''))
  if (amountCents === null) return fieldError({ amount: 'Enter an amount like 75 or 75.50.' })

  const rawTender = String(formData.get('tendered') ?? '').trim()
  const tenderedCents = rawTender ? parseDollars(rawTender) : null
  if (rawTender && tenderedCents === null) {
    return fieldError({ tendered: 'Enter an amount like 100 or 100.00.' })
  }

  const result = await recordCounterPayment(actor, {
    facilityId: String(formData.get('facilityId') ?? ''),
    tenantId: String(formData.get('tenantId') ?? ''),
    leaseId: String(formData.get('leaseId') ?? ''),
    method: String(formData.get('method') ?? '') as CounterMethod,
    amountCents,
    tenderedCents,
    checkNumber: String(formData.get('checkNumber') ?? ''),
  })

  if (!result.ok) {
    const message = PROBLEM_COPY[result.problem] ?? 'That payment could not be recorded.'
    // Attached to the field the operator can actually fix.
    const field =
      result.problem === 'tender_required' || result.problem === 'tender_below_amount'
        ? 'tendered'
        : result.problem === 'check_number_required'
          ? 'checkNumber'
          : 'amount'
    return fieldError({ [field]: message })
  }

  revalidatePath('/admin/pos')
  const change =
    result.changeCents && result.changeCents > 0
      ? ` Change due: $${(result.changeCents / 100).toFixed(2)}.`
      : ''
  return success(`Payment recorded. Receipt #${result.receiptNumber}.${change}`)
}

/// US-32's walk-in move-in: the *same* wizard the website uses, started from
/// behind the counter. Deliberately not a parallel staff-only flow — the
/// lease, e-signature, protection choice and gate-code issuance all already
/// happen in that path, and a second implementation would be a second set of
/// rules to keep in step.
export async function startWalkInMoveInAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')

  if (!can(actor, 'leases:move_in', facilityId)) {
    throw new ForbiddenError('Missing permission leases:move_in', 'leases:move_in', facilityId)
  }

  const rate = await currentRateForUnitType(unitTypeId)
  if (!rate) throw new Error(`No published rate for unit type ${unitTypeId}`)

  // The counter quotes the in-store price, not the online one — that is the
  // whole difference between the two rates (D-15's lexicon).
  const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: rate.streetRateCents })
  if (!started.ok) redirect('/admin/pos?soldOut=1')

  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}
