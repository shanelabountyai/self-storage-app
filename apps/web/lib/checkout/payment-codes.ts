// B-392. Client-safe (payment.ts imports the database).

/// Stripe error `code`s meaning "this intent is already paid or paying", so the
/// renter is shown the confirming state rather than Stripe's raw message.
const ALREADY_PAID_CODES = new Set(['payment_intent_unexpected_state'])

export function alreadyPaidCode(code: string | undefined): boolean {
  return code !== undefined && ALREADY_PAID_CODES.has(code)
}
