import type Stripe from 'stripe'
import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { provisionMoveIn, requestDownstream } from '@/lib/checkout/provision'
import { cancelOpenTask, createTask } from '@/lib/admin/tasks'
import { applyPayment } from '@/lib/billing/allocation'
import { restoreAccessIfSettled } from '@/lib/access/delinquency-gate'

/// How Stripe actually took the money.
///
/// `createChargeIntent` writes every row as `card`, because at creation time
/// nobody knows what the payer will choose in the Payment Element. This is the
/// first moment the truth is available, and it matters: the deposits report,
/// the receipt and the tenant's own history all read `Payment.method`, and a
/// bank debit filed as a card is wrong on all three.
function methodOf(intent: Stripe.PaymentIntent): 'card' | 'ach' {
  const types = intent.payment_method_types ?? []
  const used =
    typeof intent.payment_method === 'object' && intent.payment_method
      ? intent.payment_method.type
      : types.length === 1
        ? types[0]
        : null
  return used === 'us_bank_account' ? 'ach' : 'card'
}

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
  // B-103. Bank debit only. A card never emits this — it is approved or
  // declined in seconds — so this event IS the ACH case, and handling it is
  // what stops a renter waiting four business days for a unit they have paid
  // for, and a tenant being dunned for money already taken from their account.
  'payment_intent.processing',
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


/// Applies a succeeded payment across what the tenant owes (US-22, B-048).
///
/// Replaces B-045's single-invoice settlement: autopay still names its invoice
/// and that still wins, but a counter or portal payment that named none is now
/// allocated across the open invoices in the facility's configured order rather
/// than only posting to the ledger and leaving every invoice open.
///
/// Also withdraws the failed-payment task once an invoice is fully settled —
/// staff must not be chasing a tenant who has already paid.
async function settlePayment(
  tx: Prisma.TransactionClient,
  payment: { id: string; facilityId: string; tenantId: string; amountCents: number },
  explicitInvoiceId: string | null,
): Promise<void> {
  // The named invoice is checked against this payment's own tenant and
  // facility before it is trusted: it arrives through Stripe metadata, and
  // money must not settle an invoice on the strength of a round trip through a
  // third party.
  const named = explicitInvoiceId
    ? await tx.invoice.findFirst({
        where: {
          id: explicitInvoiceId,
          facilityId: payment.facilityId,
          lease: { tenantId: payment.tenantId },
        },
        select: { id: true },
      })
    : null

  const applied = await applyPayment(tx, payment, { explicitInvoiceId: named?.id ?? null })

  for (const line of applied.lines) {
    const invoice = await tx.invoice.findUnique({
      where: { id: line.invoiceId },
      select: { status: true },
    })
    if (invoice?.status === 'paid') await cancelOpenTask('failed_payment', line.invoiceId, tx)
  }
}

/// Applies one Stripe event to our records. Assumes the caller has already
/// verified the signature and claimed the event id.
export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent
      let checkoutSessionId: string | null = null
      // A one-element box rather than a `let`: TypeScript narrows a variable
      // only ever assigned inside a callback to `never` at the point it is
      // read, and the cast that silences that would also silence a real error.
      const settled: { tenantId: string; facilityId: string }[] = []

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
        await settlePayment(tx, payment, referenceInvoiceId(intent))
        settled.push({ tenantId: payment.tenantId, facilityId: payment.facilityId })
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

      // US-45's ~2-minute restore, outside the transaction and deliberately
      // after it: the balance this reads must include the payment that just
      // committed. Failing here must not roll back money we have taken, so it
      // is best-effort like provisioning below — the nightly pass at 4am is the
      // net if it throws.
      if (settled[0]) {
        try {
          await restoreAccessIfSettled(settled[0].tenantId, settled[0].facilityId)
        } catch {
          // Swallowed on purpose. A gate that stays shut an extra few hours is
          // recoverable; a payment rolled back because a gate controller was
          // unreachable is not.
        }
      }

      // Outside the payment transaction on purpose (FR-4.6): provisioning
      // failing must not roll back a payment that succeeded. The renter has
      // paid; if this throws, the webhook retries and the money stays received.
      if (checkoutSessionId) {
        const result = await provisionMoveIn(checkoutSessionId)
        if (result.ok) await requestDownstream(result.leaseId)
      }
      return
    }

    case 'payment_intent.processing': {
      const intent = event.data.object as Stripe.PaymentIntent
      let checkoutSessionId: string | null = null

      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { stripePaymentIntentId: intent.id },
        })
        if (!payment) return
        // A late redelivery must not walk a settled payment backwards. Stripe
        // retries for days, and `processing` arriving after `succeeded` is an
        // ordinary out-of-order delivery rather than a problem.
        if (payment.status !== 'pending') return

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'processing',
            // The method as Stripe actually charged it, not as we guessed:
            // `createChargeIntent` writes every row as `card` because it cannot
            // know which method the payer will pick in the Element.
            method: methodOf(intent),
          },
        })

        // Deliberately NOT posted to the ledger and NOT allocated to an
        // invoice. The money has not arrived, and an invoice that reads paid on
        // an unsettled debit is a lie the moment the bank reverses it. What
        // this state does buy the tenant is silence from the dunning ladder —
        // see `leasesWithSettlingPayment`.
        await emitEvent(
          {
            name: 'payment.processing',
            facilityId: payment.facilityId,
            entityType: 'Payment',
            entityId: payment.id,
            payload: {
              amountCents: payment.amountCents,
              paymentIntentId: intent.id,
              method: methodOf(intent),
            },
          },
          tx,
        )
        checkoutSessionId = referenceSessionId(intent)
      })

      // The move-in does NOT wait for settlement.
      //
      // Making a renter wait four business days for a unit they have paid for
      // is not a product, and the risk is the one the operator opted into by
      // switching bank debit on at checkout (`achAtCheckoutEnabled`). If the
      // debit later fails, `payment_intent.payment_failed` raises a task and
      // the ordinary delinquency path takes it from there — the tenant has a
      // unit and an unpaid balance, which is a situation this system already
      // knows how to handle.
      if (checkoutSessionId) {
        const result = await provisionMoveIn(checkoutSessionId)
        if (result.ok) await requestDownstream(result.leaseId)
      }
      return
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent
      // B-103. A debit that had already been accepted and is now bouncing —
      // days later, on money the tenant believes they have paid. Captured
      // before the update, because the update is what erases the distinction.
      const wasSettling: { payment: { id: string; facilityId: string; tenantId: string } }[] = []

      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { stripePaymentIntentId: intent.id },
        })
        if (!payment || payment.status === 'succeeded') return
        if (payment.status === 'processing') {
          wasSettling.push({
            payment: {
              id: payment.id,
              facilityId: payment.facilityId,
              tenantId: payment.tenantId,
            },
          })
        }

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

      // A bank debit that bounces after acceptance needs a person, not just a
      // ledger entry. Nothing was posted (the money never arrived), so the
      // balance is already correct — but the tenant has been told it was paid,
      // may have been let through a gate on it, and the ordinary dunning ladder
      // will now start chasing somebody who thinks they are square. Raised
      // outside the transaction so a task-store failure cannot roll back the
      // record of the failure itself.
      if (wasSettling[0]) {
        await createTask({
          facilityId: wasSettling[0].payment.facilityId,
          type: 'settling_payment_failed',
          entityType: 'Payment',
          entityId: wasSettling[0].payment.id,
          priority: 'high',
        })
      }
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
