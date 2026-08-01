import type Stripe from 'stripe'
import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'

// PRD 01 §7.3: "webhook events post to the admin ledger; the ledger, not
// Stripe, is the tenant-facing source of truth for balance."
//
// Everything here is idempotent by construction. Stripe delivers at-least-once
// and retries a non-2xx for days, so every handler must be safe to run on the
// same event twice — the StripeEvent row is the outer guard, and the checks
// inside are the inner one.

/// The events we act on. Anything else is recorded and acknowledged: an
/// unhandled type is not an error, and returning non-2xx for it would make
/// Stripe retry something we were never going to process.
export const HANDLED_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'setup_intent.succeeded',
] as const

export type HandledEvent = (typeof HANDLED_EVENTS)[number]

export function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type)
}

/// Posts a payment to the ledger, if it belongs to a lease.
///
/// Ledger entries require a lease, and at B-019 nothing creates one yet —
/// move-in is B-021 and billing is B-044. A payment with no lease is recorded
/// as a Payment row and left unposted rather than invented against a lease it
/// does not have. The reconciliation report is what surfaces those; making one
/// up would be worse than leaving it visible.
async function postPaymentToLedger(
  tx: Prisma.TransactionClient,
  payment: { id: string; facilityId: string; tenantId: string; amountCents: number },
): Promise<void> {
  const lease = await tx.lease.findFirst({
    where: { tenantId: payment.tenantId, facilityId: payment.facilityId, status: { not: 'ended' } },
    select: { id: true },
    orderBy: { startDate: 'desc' },
  })
  if (!lease) return

  // Already posted? Stripe redelivering the same event must not double-credit.
  const existing = await tx.ledgerEntry.findFirst({
    where: { paymentId: payment.id, type: 'payment' },
    select: { id: true },
  })
  if (existing) return

  await tx.ledgerEntry.create({
    data: {
      facilityId: payment.facilityId,
      leaseId: lease.id,
      type: 'payment',
      // Signed: a payment reduces what is owed (see the enum's own comment).
      amountCents: -payment.amountCents,
      description: 'Card payment',
      paymentId: payment.id,
    },
  })
}


/// Applies one Stripe event to our records. Assumes the caller has already
/// verified the signature and claimed the event id.
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { stripePaymentIntentId: intent.id },
        })
        // A PaymentIntent we have no row for is not a crash: it may have been
        // created by a replay or by another environment sharing the account.
        // Recording nothing and acknowledging is right; the event row keeps it
        // visible.
        if (!payment) return
        if (payment.status === 'succeeded') return

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'succeeded', receivedAt: new Date(intent.created * 1000) },
        })
        await postPaymentToLedger(tx, payment)
        await emitEvent(
          {
            name: 'payment.succeeded',
            facilityId: payment.facilityId,
            entityType: 'Payment',
            entityId: payment.id,
            payload: { amountCents: payment.amountCents, paymentIntentId: intent.id },
          },
          tx,
        )
      })
      return
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { stripePaymentIntentId: intent.id },
        })
        if (!payment || payment.status === 'succeeded') return

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'failed',
            // Stripe's decline message, kept verbatim. The dunning ladder and
            // the failed-payment queue (B-046) both need to tell a manager why.
            failureReason: intent.last_payment_error?.message ?? 'declined',
          },
        })
        await emitEvent(
          {
            name: 'payment.failed',
            facilityId: payment.facilityId,
            entityType: 'Payment',
            entityId: payment.id,
            payload: {
              paymentIntentId: intent.id,
              code: intent.last_payment_error?.code ?? null,
            },
          },
          tx,
        )
      })
      return
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
      if (!intentId) return

      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { stripePaymentIntentId: intentId } })
        if (!payment) return

        // Stripe reports the running total refunded, not this refund's amount,
        // so partial and full are the same comparison rather than a sum we keep
        // ourselves.
        const fullyRefunded = charge.amount_refunded >= charge.amount
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: fullyRefunded ? 'refunded' : 'partially_refunded' },
        })
        await emitEvent(
          {
            name: 'payment.refunded',
            facilityId: payment.facilityId,
            entityType: 'Payment',
            entityId: payment.id,
            payload: { amountRefundedCents: charge.amount_refunded, full: fullyRefunded },
          },
          tx,
        )
      })
      return
    }

    case 'setup_intent.succeeded': {
      const intent = event.data.object as Stripe.SetupIntent
      const tenantId = intent.metadata?.tenantId
      const method = typeof intent.payment_method === 'string' ? intent.payment_method : null
      if (!tenantId || !method) return

      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeDefaultPaymentMethodId: method },
      })
      return
    }

    default:
      // Recorded and acknowledged. See HANDLED_EVENTS.
      return
  }
}

/// Events accepted but never processed — the reconciliation gap between Stripe
/// and the ledger. PRD 01 §7.3 makes the ledger the source of truth, which is
/// only defensible if we can see where the two have drifted apart.
export async function unreconciledEvents(limit = 100) {
  return prisma.stripeEvent.findMany({
    where: { processedAt: null },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  })
}
