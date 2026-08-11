// PRD 01 §3 (B-103). "Methods: cards, Apple Pay, Google Pay, Link, and ACH bank
// debit (ACH: portal payments and autopay; optional at checkout)."
//
// Which methods a given payment surface may offer, as a pure decision. It is
// here rather than inline at the two call sites because the rule is a policy —
// bank debit is allowed in some places and not others, for reasons that have
// nothing to do with Stripe — and a policy split across two files is a policy
// that will disagree with itself.

export type PaymentSurface =
  /// Move-in. The renter has not got the unit yet.
  | 'checkout'
  /// A tenant paying a balance they already owe.
  | 'portal'
  /// Saving a method for later, charging nothing today.
  | 'setup'

export type MethodPolicy = {
  /// Whether this facility permits bank debit at checkout at all.
  achAtCheckoutEnabled: boolean
}

/// Stripe payment-method type identifiers.
export type StripeMethodType = 'card' | 'us_bank_account' | 'link'

/// The methods to offer, in the order Stripe should consider them.
///
/// `card` covers Apple Pay and Google Pay — they are wallets over a card, not
/// separate types, and the Payment Element surfaces them on its own when the
/// device supports one. `link` is Stripe's saved-details network; it needs no
/// per-facility switch because it is a faster way to present a card, not a
/// different kind of money.
///
/// Bank debit is the one with a rule:
///
///   - **portal**: always. The tenant already has the unit, so a debit that
///     fails four days later is an unpaid balance — exactly the situation the
///     dunning ladder exists for, and no worse than never having paid.
///   - **checkout**: only where the operator has opted in. A move-in hands over
///     a unit and a gate code, and a reversed debit means somebody is in the
///     building on money that went back.
///   - **setup**: always, because autopay on a bank account is the case §3
///     names first and the cheapest money this business can take.
export function methodsFor(surface: PaymentSurface, policy: MethodPolicy): StripeMethodType[] {
  const methods: StripeMethodType[] = ['card', 'link']

  if (surface === 'portal' || surface === 'setup') methods.push('us_bank_account')
  else if (policy.achAtCheckoutEnabled) methods.push('us_bank_account')

  return methods
}

export function offersBankDebit(surface: PaymentSurface, policy: MethodPolicy): boolean {
  return methodsFor(surface, policy).includes('us_bank_account')
}

/// Business days a bank debit typically takes to settle.
///
/// Used for copy, never for a deadline: nothing in this system waits for this
/// number to elapse, because the answer comes from Stripe as a webhook. It
/// exists so a renter is told "about four business days" rather than being left
/// to wonder why their balance has not moved — which is the support call this
/// whole state exists to prevent.
export const ACH_SETTLEMENT_BUSINESS_DAYS = 4

/// What a tenant is told about a payment that has been taken but not settled.
export function settlementNotice(methodLabel: string): string {
  return `Your ${methodLabel} payment has been submitted. Bank payments take about ${ACH_SETTLEMENT_BUSINESS_DAYS} business days to clear — your balance updates when it does, and we will not charge a late fee while it is on its way.`
}
