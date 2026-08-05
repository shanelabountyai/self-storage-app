import { prisma } from '@storage/db'
import { ensureStripeCustomer } from './customers'
import { idempotencyKey, requireStripe, stripeClient } from './stripe'

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
  /// Which lease this money is for, when the caller knows.
  ///
  /// Travels to Stripe as metadata and comes back on the webhook, where it is
  /// what `postPaymentToLedger` posts against. Without it that function has to
  /// *guess* the lease from the tenant and facility, which is right only while
  /// a tenant can have one lease per facility — B-035 lets a tenant with two
  /// units choose which one to pay, so the guess became a way to credit the
  /// wrong unit. Optional because move-in (B-025) genuinely has no lease yet
  /// at the moment it charges.
  leaseId?: string
  /// Keep the card on file for later charges. Default true: move-in enrols in
  /// autopay by default (§4.6/D-11a) and needs the method retained. A portal
  /// one-time payment passes false — the tenant asked to pay a bill, not to
  /// store a card, and B-036 owns method management.
  saveMethod?: boolean
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
      setup_future_usage:
        input.offSession || input.saveMethod === false ? undefined : 'off_session',
      off_session: input.offSession ?? undefined,
      confirm: input.offSession ?? undefined,
      metadata: {
        paymentId: payment.id,
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        reference: input.reference,
        ...(input.leaseId ? { leaseId: input.leaseId } : {}),
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

/// Lets the Payment Element show the cards this tenant already has on file.
///
/// US-703's "saved method or a new one" — without this the Element only ever
/// offers a blank card form, because it has no way to know who the customer
/// is beyond the intent. Read-only on purpose: `payment_method_save` and
/// `payment_method_remove` both stay off, so this can display a stored card
/// but never add or delete one. Managing methods is B-036, and a remove
/// control here would detach the card autopay is running on.
///
/// Null when Stripe is unconfigured, so the caller degrades to the same
/// "call us" path the rest of the payment surface uses rather than throwing.
export async function createCustomerSession(tenantId: string): Promise<string | null> {
  const stripe = stripeClient()
  if (!stripe) return null
  const customerId = await ensureStripeCustomer(tenantId)

  const session = await stripe.customerSessions.create({
    customer: customerId,
    components: {
      payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay: 'enabled',
          payment_method_save: 'disabled',
          payment_method_remove: 'disabled',
        },
      },
    },
  })
  return session.client_secret
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
