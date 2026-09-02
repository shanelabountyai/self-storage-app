'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { chargeableLease, chargeCardOnFile } from '@/lib/admin/pos'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { formatCents } from '@/lib/format'

// PRD 02 §4.8 US-32 / PRD 01 US-601 (B-230). The counter's card screen.
//
// Only the card-on-file charge is a server action. The card the tenant is
// holding is confirmed by Stripe's Payment Element in the browser, which is
// what keeps the PAN out of this process entirely — there is no action here
// that receives one, and there must never be.

const PROBLEM_COPY: Record<string, string> = {
  unavailable: 'Card payments are not configured right now. Take cash or a check instead.',
  no_method: 'This tenant has no saved card. Ask them to present one and use the form above.',
}

export async function chargeCardOnFileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()

  const lease = await chargeableLease(actor, String(formData.get('leaseId') ?? ''))
  if (!lease) return fieldError({ amount: 'That unit is no longer rented.' })

  // The amount comes from the form, but the FIGURE it is checked against comes
  // from the ledger read a line above — never from a hidden field. Same rule
  // as the portal's own payment: a total the browser could name is a total the
  // browser could choose.
  const amountCents = Number(formData.get('amountCents') ?? '')
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return fieldError({ amount: 'Enter an amount greater than zero.' })
  }
  if (amountCents > lease.balanceCents) {
    // Deliberately NOT the portal's twelve-month prepayment ceiling. That
    // ceiling exists so a tenant can pay ahead from their own account; this is
    // a staffer charging a card the tenant is not holding, and prepaying
    // somebody's account off-session is not a thing a counter should be able
    // to do by mistyping a figure.
    return fieldError({
      amount: `That is more than the ${formatCents(lease.balanceCents)} owed on unit ${lease.unitNumber}.`,
    })
  }

  const result = await chargeCardOnFile(actor, lease, amountCents)
  if (!result.ok) {
    return fieldError({
      amount:
        result.problem === 'declined'
          ? `That card was declined${result.message ? ` — ${result.message}` : ''}. Ask for another card, or take cash or a check.`
          : (PROBLEM_COPY[result.problem] ?? 'That charge could not be made.'),
    })
  }

  revalidatePath('/admin/pos/card')
  // "Charged", not "paid": the webhook is what marks it succeeded and moves
  // the balance, and a message asserting a settled payment the ledger has not
  // seen yet is the one a staffer reads out to the tenant.
  return success(
    `${formatCents(result.amountCents)} charged to the card on file for unit ${lease.unitNumber}. The balance updates when it clears — usually within a few seconds.`,
  )
}
