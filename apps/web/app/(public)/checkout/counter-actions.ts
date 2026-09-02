'use server'

import { revalidatePath } from 'next/cache'
import type { CounterMethod } from '@storage/core/pos'
import { requireStaffActor } from '@/lib/rbac/session'
import { takeCounterMoveInPayment } from '@/lib/checkout/counter-tender'
import { sessionByToken } from '@/lib/checkout/session'
import { fieldError, type FormState } from '@/lib/admin/form-state'

// PRD 02 §4.8 US-32 (B-230). The counter's tender on a public checkout.
//
// Its own file rather than another export in `actions.ts`, and the reason is
// mechanical rather than tidiness: this is the only checkout action that needs
// `requireStaffActor`, which reaches `@/auth` and therefore next-auth — and
// next-auth's `env.js` does a bare `next/server` import that Vitest cannot
// resolve. Adding it to `actions.ts` broke `checkout-consent-db.test.ts`, which
// imports the renter-facing actions to exercise the real consent writes. The
// staff action and the renter actions have no reason to share a module, so
// they do not.

/// PRD 02 §4.8 US-32 (B-230). Cash or a check for a move-in, taken at the
/// counter, on the same checkout the website uses.
///
/// Staff-only, and gated on the ACTOR rather than on anything the session
/// carries: this is a public route, and a session flag saying "this checkout
/// started at the counter" would be a fact about where it began, not authority
/// to settle it with money nobody can see. `counterTenderRefusal` inside
/// `takeCounterMoveInPayment` is what checks `payments:take` at this facility;
/// `requireStaffActor` here is what makes a tenant's own browser get the
/// ordinary card step and nothing else.
export async function takeCounterMoveInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()

  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: 'We could not find that checkout.', fieldErrors: {} }
  }

  const rawTender = String(formData.get('tendered') ?? '').trim()
  const tenderedCents = rawTender ? parseCounterDollars(rawTender) : null
  if (rawTender && tenderedCents === null) {
    return fieldError({ tendered: 'Enter an amount like 200 or 200.00.' })
  }

  const result = await takeCounterMoveInPayment(actor, session, {
    method: String(formData.get('method') ?? '') as CounterMethod,
    tenderedCents,
    checkNumber: String(formData.get('checkNumber') ?? ''),
  })

  if (!result.ok) {
    const field =
      result.problem === 'tender_required' || result.problem === 'tender_below_amount'
        ? 'tendered'
        : result.problem === 'check_number_required'
          ? 'checkNumber'
          : 'method'
    return fieldError({ [field]: COUNTER_MOVE_IN_COPY[result.problem] })
  }

  revalidatePath('/checkout')
  const change =
    result.changeCents && result.changeCents > 0
      ? ` Change due: $${(result.changeCents / 100).toFixed(2)}.`
      : ''
  return {
    status: 'success',
    message: `Move-in complete. Receipt #${result.receiptNumber} for $${(result.amountCents / 100).toFixed(2)}.${change}`,
  }
}

const COUNTER_MOVE_IN_COPY: Record<string, string> = {
  amount_not_positive: 'There is nothing due on this move-in, so there is nothing to take.',
  amount_not_integer: 'The move-in total could not be worked out. Refresh and try again.',
  tender_required: 'Enter how much cash they handed over.',
  tender_below_amount: 'Cash tendered is less than the move-in total.',
  check_number_required: 'Enter the check or money-order number.',
  needs_manager: 'Cash this large needs a manager. Ask one to take it, or split the payment.',
  card_not_supported: 'Use the card form below for a card.',
  not_at_payment: 'This checkout is not at the payment step. Refresh and start again.',
  // B-230. The one refusal that means "somebody else already finished this".
  // Named plainly, because the alternative is a staffer taking the money a
  // second time on the reasonable assumption that nothing happened.
  already_provisioned:
    'This move-in is already complete — do not take payment again. Check today’s payments to see whether it was recorded.',
  no_unit: 'This checkout is not holding a unit any more. Start a new move-in.',
  // The tenant IS moved in. Anything that reads like "that didn't work" here
  // sends a staffer round the loop again and moves somebody in twice.
  moved_in_unpaid:
    'The move-in completed but the payment did not record. The unit is theirs — take the payment on the POS screen against their new lease before they leave.',
}

/// Dollars as typed to integer cents, without floating point. The same parse
/// as the POS screen's; here rather than imported because that one lives in an
/// admin route's own actions file and a public route importing it would be a
/// module boundary crossed for eight lines.
function parseCounterDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [dollars, fraction = ''] = cleaned.split('.')
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}
