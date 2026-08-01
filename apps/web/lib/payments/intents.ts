import { prisma } from '@storage/db'
import { ensureStripeCustomer } from './customers'
import { idempotencyKey, requireStripe } from './stripe'

// PRD 01 §7.3 / D-6. One-time charges are PaymentIntents created by us, from
// what our ledger says is owed. Saved cards for autopay are SetupIntents.

export type ChargeIntentInput = {
  facilityId: string
  tenantId: string
  amountCents: number
  /// What this charge is for, in our terms — a move-in, an invoice, a one-off.
  /// Becomes the idempotency key and travels to Stripe as metadata, so a retry
  /// of "the August invoice for lease X" can never become a second charge.
  reference: string
  description: string
  /// Charge a stored method without the renter present (autopay). Off by
  /// default: a charge the customer is not watching has different rules, and
  /// defaulting to it would be the wrong way round.
  offSession?: boolean
}

export type ChargeIntent = {
  paymentId: string
  paymentIntentId: string
  /// Handed to the Payment Element in the browser. Not a secret we store.
  clientSecret: string
}

/// Creates a PaymentIntent and the local `pending` Payment row that mirrors it.
///
/// The Payment row is written FIRST, in the same reference namespace as the
/// idempotency key, so a crash between "Stripe charged the card" and "we wrote
/// it down" leaves a row we can reconcile rather than a silent charge. The
/// webhook is what marks it succeeded — never this function's return value,
/// because a client that never comes back must not lose the payment.
export async function createChargeIntent(input: ChargeIntentInput): Promise<ChargeIntent> {
  if (input.amountCents <= 0) {
    throw new Error(`Refusing to create a charge for ${input.amountCents} cents`)
  }

  const stripe = requireStripe()
  const customerId = await ensureStripeCustomer(input.tenantId)

  const payment = await prisma.payment.create({
    data: {
      facilityId: input.facilityId,
      tenantId: input.tenantId,
      amountCents: input.amountCents,
      method: 'card',
      status: 'pending',
    },
  })

  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: 'usd',
      customer: customerId,
      description: input.description,
      // Lets a later autopay run charge this method without the renter there.
      setup_future_usage: input.offSession ? undefined : 'off_session',
      off_session: input.offSession ?? undefined,
      confirm: input.offSession ?? undefined,
      metadata: {
        paymentId: payment.id,
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        reference: input.reference,
      },
    },
    { idempotencyKey: idempotencyKey('charge', input.reference) },
  )

  await prisma.payment.update({
    where: { id: payment.id },
    data: { stripePaymentIntentId: intent.id },
  })

  return {
    paymentId: payment.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret!,
  }
}

/// A SetupIntent saves a card without charging it — how autopay enrolment works
/// when there is nothing due today (B-025 owns the UI).
export async function createSetupIntent(tenantId: string): Promise<{ clientSecret: string }> {
  const stripe = requireStripe()
  const customerId = await ensureStripeCustomer(tenantId)

  const intent = await stripe.setupIntents.create(
    {
      customer: customerId,
      usage: 'off_session',
      metadata: { tenantId },
    },
    { idempotencyKey: idempotencyKey('setup', tenantId) },
  )

  return { clientSecret: intent.client_secret! }
}
