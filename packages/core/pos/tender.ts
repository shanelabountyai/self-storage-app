// PRD 02 US-32. The counter's money arithmetic, kept pure so every boundary is
// testable without a database, a session, or a facility — this is the code
// that decides how much cash to hand back.

/// Methods where a human physically received something and must be named.
/// Card is deliberately absent: an online card payment has no one behind a
/// counter, and requiring attribution there would be a lie.
export const ATTRIBUTED_METHODS = ['cash', 'check', 'money_order'] as const
export type AttributedMethod = (typeof ATTRIBUTED_METHODS)[number]

/// Methods a staffer can record by hand at the counter. `ach` is excluded —
/// nothing in this system originates an ACH debit, and a hand-typed one would
/// be a claim we cannot substantiate.
export const COUNTER_METHODS = ['card', 'cash', 'check', 'money_order'] as const
export type CounterMethod = (typeof COUNTER_METHODS)[number]

export function requiresAttribution(method: string): method is AttributedMethod {
  return (ATTRIBUTED_METHODS as readonly string[]).includes(method)
}

export type TenderProblem =
  | 'amount_not_positive'
  | 'amount_not_integer'
  | 'tender_required'
  | 'tender_below_amount'
  | 'check_number_required'

export type TenderResult =
  | { ok: true; amountCents: number; tenderedCents: number | null; changeCents: number | null }
  | { ok: false; problem: TenderProblem }

/// Validates one counter payment and works out the change.
///
/// Change is only meaningful for cash: a check or money order is written for
/// an amount and there is nothing to hand back, and a card is charged exactly.
/// Overpaying by check is a real thing, but it produces a credit to be
/// resolved on the ledger, not notes out of a drawer — so this refuses to
/// invent change for it rather than quietly treating the two the same.
export function settleTender(input: {
  method: CounterMethod
  amountCents: number
  tenderedCents?: number | null
  checkNumber?: string | null
}): TenderResult {
  const { method, amountCents } = input

  if (!Number.isInteger(amountCents)) return { ok: false, problem: 'amount_not_integer' }
  if (amountCents <= 0) return { ok: false, problem: 'amount_not_positive' }

  if ((method === 'check' || method === 'money_order') && !input.checkNumber?.trim()) {
    // US-32 AC: "check # required". A cheque with no number cannot be traced
    // to a bank line on the day it bounces.
    return { ok: false, problem: 'check_number_required' }
  }

  if (method !== 'cash') {
    return { ok: true, amountCents, tenderedCents: null, changeCents: null }
  }

  const tenderedCents = input.tenderedCents
  if (tenderedCents == null || !Number.isInteger(tenderedCents)) {
    return { ok: false, problem: 'tender_required' }
  }
  if (tenderedCents < amountCents) return { ok: false, problem: 'tender_below_amount' }

  return { ok: true, amountCents, tenderedCents, changeCents: tenderedCents - amountCents }
}

/// The rank a facility requires before a staffer may take this much cash.
/// `manager` is 20 in the seeded catalog; counter staff are 10.
export const MANAGER_RANK = 20

/// US-32 AC: "cash payments over a configurable amount... require
/// manager-or-above". At-or-above the threshold rather than strictly over, so
/// a threshold of exactly $500 catches a $500 note rather than being the one
/// amount that slips through.
export function cashNeedsApproval(
  method: string,
  amountCents: number,
  thresholdCents: number,
): boolean {
  return method === 'cash' && amountCents >= thresholdCents
}
