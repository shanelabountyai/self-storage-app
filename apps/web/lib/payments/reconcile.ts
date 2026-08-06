import type Stripe from 'stripe'
import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { provisionMoveIn, requestDownstream } from '@/lib/checkout/provision'
import { cancelOpenTask } from '@/lib/admin/tasks'

/// The checkout session a PaymentIntent belongs to, from the reference B-025
/// set when it created the intent (`checkout:<sessionId>`).
function referenceSessionId(intent: Stripe.PaymentIntent): string | null {
  const reference = intent.metadata?.reference
  return reference?.startsWith('checkout:') ? reference.slice('checkout:'.length) : null
}

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

/// The lease a PaymentIntent was raised against, when its creator knew.
/// Set by `createChargeIntent`'s `leaseId` input (B-035).
function referenceLeaseId(intent: Stripe.PaymentIntent): string | null {
  return intent.metadata?.leaseId ?? null
}

/// The invoice a PaymentIntent settles, when its creator named one (B-045).
function referenceInvoiceId(intent: Stripe.PaymentIntent): string | null {
  return intent.metadata?.invoiceId ?? null
}

/// Posts a payment to the ledger, if it belongs to a lease.
///
/// Ledger entries require a lease, and at B-019 nothing creates one yet —
/// move-in is B-021 and billing is B-044. A payment with no lease is recorded
/// as a Payment row and left unposted rather than invented against a lease it
/// does not have. The reconciliation report is what surfaces those; making one
/// up would be worse than leaving it visible.
///
/// `explicitLeaseId` is the lease the payer actually chose (B-035's portal
/// payment says which unit it is for). It is preferred over the fallback
/// below, but still checked against this payment's own tenant and facility
/// first: it arrives via Stripe metadata, and money must not move to a lease
/// on the strength of a round trip through a third party. A mismatch posts
/// nothing rather than guessing — an unposted payment is visible in the
/// reconciliation report, a misposted one is not.
async function postPaymentToLedger(
  tx: Prisma.TransactionClient,
  payment: { id: string; facilityId: string; tenantId: string; amountCents: number },
  explicitLeaseId?: string | null,
): Promise<void> {
  const lease = explicitLeaseId
    ? await tx.lease.findFirst({
        where: { id: explicitLeaseId, tenantId: payment.tenantId, facilityId: payment.facilityId },
        select: { id: true },
      })
    : // No stated lease: the only remaining option is the tenant's occupying
      // lease at this facility. Correct for move-in, where the payment
      // predates the lease it will pay for, and safe while a tenant has one
      // lease per facility — which is exactly why a caller that DOES know
      // states it rather than relying on this.
      await tx.lease.findFirst({
        where: {
          tenantId: payment.tenantId,
          facilityId: payment.facilityId,
          status: { not: 'ended' },
        },
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


/// Settles the invoice a payment was raised against, when it named one.
///
/// B-045's autopay charges exactly one invoice, and the whole "never
/// double-charge" guarantee rests on the invoice reading as paid afterwards:
/// without this the charge would succeed, post to the ledger, and leave the
/// invoice open for the next night's run to charge again.
///
/// Idempotent on the `(paymentId, invoiceId)` unique constraint, because
/// Stripe redelivers. `amountPaidCents` is recomputed from the allocations
/// rather than incremented — an increment applied twice is exactly the bug the
/// redelivery would cause, and the sum is the fact anyway.
///
/// B-048 generalises this to a payment spread across several invoices in a
/// configurable order. This is the single-invoice case the billing engine
/// creates on its own, and it deliberately does not invent an allocation for a
/// payment that never named one.
async function settleNamedInvoice(
  tx: Prisma.TransactionClient,
  payment: { id: string; facilityId: string; tenantId: string; amountCents: number },
  invoiceId: string | null,
): Promise<void> {
  if (!invoiceId) return

  // Checked against this payment's own tenant and facility: the id arrives
  // through Stripe metadata, and money must not settle an invoice on the
  // strength of a round trip through a third party.
  const invoice = await tx.invoice.findFirst({
    where: {
      id: invoiceId,
      facilityId: payment.facilityId,
      lease: { tenantId: payment.tenantId },
    },
    select: { id: true, totalCents: true },
  })
  if (!invoice) return

  const existing = await tx.paymentAllocation.findUnique({
    where: { paymentId_invoiceId: { paymentId: payment.id, invoiceId: invoice.id } },
    select: { id: true },
  })
  if (!existing) {
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: invoice.id, amountCents: payment.amountCents },
    })
  }

  const allocations = await tx.paymentAllocation.aggregate({
    where: { invoiceId: invoice.id, payment: { status: 'succeeded' } },
    _sum: { amountCents: true },
  })
  const paid = allocations._sum.amountCents ?? 0

  const settled = paid >= invoice.totalCents
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaidCents: paid,
      status: settled ? 'paid' : paid > 0 ? 'partially_paid' : 'open',
    },
  })

  // B-046. The failed-payment task exists because autopay gave up on this
  // invoice; the invoice being paid is exactly the thing that resolves it, and
  // leaving it open would have staff chasing a tenant who has already paid.
  // Withdrawn rather than completed — nobody did the work, the reason went away.
  if (settled) await cancelOpenTask('failed_payment', invoice.id, tx)
}

/// Applies one Stripe event to our records. Assumes the caller has already
/// verified the signature and claimed the event id.
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      let checkoutSessionId: string | null = null

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
        await postPaymentToLedger(tx, payment, referenceLeaseId(intent))
        // Order matters: the allocation sums only SUCCEEDED payments, and the
        // status update above is what makes this one count.
        await settleNamedInvoice(tx, payment, referenceInvoiceId(intent))
        // FR-4.4: finalisation is webhook-driven. The reference carries which
        // checkout this was, so a renter who closed the tab still gets moved in.
        checkoutSessionId = referenceSessionId(intent)
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

      // Outside the payment transaction on purpose (FR-4.6): provisioning
      // failing must not roll back a payment that succeeded. The renter has
      // paid; if this throws, the webhook retries and the money stays received.
      if (checkoutSessionId) {
        const result = await provisionMoveIn(checkoutSessionId)
        if (result.ok) await requestDownstream(result.leaseId)
      }
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
            // B-046's retry schedule branches on the code, never the message.
            failureCode: intent.last_payment_error?.code ?? null,
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
