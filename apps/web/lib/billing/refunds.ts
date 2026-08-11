import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
import { checkMonetaryAuthority } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { stripeClient } from '@/lib/payments/stripe'
import { recomputeInvoices } from '@/lib/billing/allocation'
import { openSessionFor } from '@/lib/admin/drawer'

// PRD 02 US-23 (B-048). Refunds.
//
// "Card refunds to original payment method via provider; cash/check refunds
// recorded as payable with a check-number field; all refunds require reason
// code and permission per RBAC-2."
//
// ── The shape, and why a refund is its own Payment row ───────────────────────
//
// A refund is recorded as a second `Payment` pointing at the first through
// `refundOfPaymentId`, not as a mutation of the original. The original payment
// is a fact — money arrived on a date, against a receipt number a tenant is
// holding — and editing it would make the receipt disagree with the record.
// The refund is a separate fact with its own date and its own actor.
//
// The ledger gets a `refund` entry, which INCREASES the balance: the money went
// back, so the tenant owes it again.

export type RefundMethod = 'card' | 'cash' | 'check'

export type RefundResult =
  | { ok: true; refundPaymentId: string; amountCents: number; method: RefundMethod }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'missing_reason'
        | 'not_refundable'
        | 'over_original'
        | 'forbidden'
        | 'over_limit'
        | 'card_unavailable'
        | 'provider_error'
      limitCents?: number
      escalateToRank?: number | null
      message?: string
    }

export type RefundInput = {
  amountCents: number
  reasonCode: string
  note?: string
  /// Required for a cheque so the payable can be reconciled against the bank.
  checkNumber?: string | null
  /// Force a cash/cheque refund of a card payment — the counter case where the
  /// card is closed and the tenant wants cash. Audited as such.
  asMethod?: RefundMethod
}

/// Refunds a payment, in full or in part.
///
/// Three gates, all US-23's: the `refunds:approve` permission at that facility,
/// the amount within the actor's refund limit (RBAC-2, and an over-limit
/// refusal names the rank that can approve it), and a reason code — enforced
/// here and again by `recordAudit`, since `refund.issued` is `requiresReason`.
export async function refundPayment(
  actor: Actor,
  paymentId: string,
  input: RefundInput,
): Promise<RefundResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: 'missing_reason' }
  if (input.amountCents <= 0) return { ok: false, reason: 'over_original' }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      amountCents: true,
      method: true,
      status: true,
      stripePaymentIntentId: true,
      refunds: { select: { amountCents: true, status: true } },
      ledgerEntries: { select: { leaseId: true }, take: 1 },
    },
  })
  if (!payment) return { ok: false, reason: 'not_found' }

  // Only money we actually received can go back. A failed or pending payment
  // has nothing to return, and refunding one would create money.
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    return { ok: false, reason: 'not_refundable' }
  }

  const alreadyRefunded = payment.refunds
    .filter((refund) => refund.status !== 'failed')
    .reduce((sum, refund) => sum + refund.amountCents, 0)
  if (input.amountCents > payment.amountCents - alreadyRefunded) {
    return { ok: false, reason: 'over_original' }
  }

  const decision = checkMonetaryAuthority(actor, 'refund', input.amountCents, payment.facilityId)
  if (!decision.allowed) {
    return decision.reason === 'forbidden'
      ? { ok: false, reason: 'forbidden' }
      : {
          ok: false,
          reason: 'over_limit',
          limitCents: decision.limitCents,
          escalateToRank: decision.escalateToRank,
        }
  }

  const method: RefundMethod =
    input.asMethod ?? (payment.method === 'card' ? 'card' : payment.method === 'check' ? 'check' : 'cash')

  // US-23: card refunds go back to the original payment method. Done BEFORE the
  // local write, because a refund we recorded and the provider never made is
  // the worse direction to fail in — the tenant would be told they had their
  // money back and would not.
  let providerRefundId: string | null = null
  if (method === 'card') {
    const stripe = stripeClient()
    if (!stripe || !payment.stripePaymentIntentId) return { ok: false, reason: 'card_unavailable' }
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: payment.stripePaymentIntentId, amount: input.amountCents },
        // Keyed on the payment and the amount so a double-submit returns the
        // original refund rather than making a second one.
        { idempotencyKey: `refund:${payment.id}:${input.amountCents}` },
      )
      providerRefundId = refund.id
    } catch (error) {
      return {
        ok: false,
        reason: 'provider_error',
        message: error instanceof Error ? error.message : 'The card refund was declined.',
      }
    }
  }

  const leaseId = payment.ledgerEntries[0]?.leaseId ?? null

  // B-078 / US-33. A cash or cheque refund comes out of the open drawer, so
  // it belongs to that session: the close-out's expected-cash figure has to
  // account for money that went back over the counter, and closing the
  // session is what finally settles the payable B-048 left `pending`.
  const drawerSession = method === 'card' ? null : await openSessionFor(payment.facilityId)

  const refundPaymentId = await prisma.$transaction(async (tx) => {
    const refund = await tx.payment.create({
      data: {
        facilityId: payment.facilityId,
        tenantId: payment.tenantId,
        amountCents: input.amountCents,
        method: method === 'card' ? 'card' : method === 'check' ? 'check' : 'cash',
        // A card refund is settled the moment Stripe accepts it. A cash or
        // cheque refund is a PAYABLE — the money has not left yet, somebody has
        // to hand it over or write the cheque, and marking it succeeded would
        // put a refund in the books that nobody has made.
        status: method === 'card' ? 'succeeded' : 'pending',
        refundOfPaymentId: payment.id,
        checkNumber: input.checkNumber?.trim() || null,
        receivedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        drawerSessionId: drawerSession?.id ?? null,
        stripePaymentIntentId: null,
        failureReason: null,
      },
    })

    if (leaseId) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: payment.facilityId,
          leaseId,
          type: 'refund',
          // Signed: the money went back, so the tenant owes it again.
          amountCents: input.amountCents,
          description: `Refund of ${method} payment${providerRefundId ? '' : ' (payable)'}`,
          paymentId: refund.id,
        },
      })
    }

    const totalRefunded = alreadyRefunded + input.amountCents
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: totalRefunded >= payment.amountCents ? 'refunded' : 'partially_refunded' },
    })

    // The refunded money is no longer settling anything. Trimming the
    // allocations and recomputing is what keeps an invoice from reading `paid`
    // on money that went back — which would leave it uncollected forever and
    // invisible to every ageing report.
    const allocations = await tx.paymentAllocation.findMany({
      where: { paymentId: payment.id },
      select: { id: true, invoiceId: true, amountCents: true },
    })
    let toUnwind = input.amountCents
    for (const allocation of allocations) {
      if (toUnwind <= 0) break
      const reduction = Math.min(toUnwind, allocation.amountCents)
      toUnwind -= reduction
      const remaining = allocation.amountCents - reduction
      if (remaining > 0) {
        await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { amountCents: remaining } })
      } else {
        await tx.paymentAllocation.delete({ where: { id: allocation.id } })
      }
    }
    await recomputeInvoices(tx, allocations.map((allocation) => allocation.invoiceId))

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'refund.issued',
        entityType: 'Payment',
        entityId: payment.id,
        facilityId: payment.facilityId,
        reasonCode: input.reasonCode,
        context: {
          refundPaymentId: refund.id,
          amountCents: input.amountCents,
          method,
          providerRefundId,
          checkNumber: input.checkNumber ?? null,
          note: input.note ?? null,
          // Recorded explicitly: refunding a card payment in cash is the shape
          // an internal fraud looks like, and the log should say it happened
          // rather than leave it to be inferred.
          methodChanged: method !== payment.method,
        },
      },
      tx,
    )

    await emitEvent(
      {
        name: 'payment.refunded',
        facilityId: payment.facilityId,
        entityType: 'Payment',
        entityId: payment.id,
        payload: {
          amountRefundedCents: totalRefunded,
          full: totalRefunded >= payment.amountCents,
          method,
        },
      },
      tx,
    )

    return refund.id
  })

  return { ok: true, refundPaymentId, amountCents: input.amountCents, method }
}

export type RefundableRow = {
  paymentId: string
  amountCents: number
  refundedCents: number
  refundableCents: number
  method: string
  receivedAt: Date
  receiptNumber: number | null
  facilityId: string
}

/// Payments on this tenant that still have something to give back.
export async function refundablePayments(tenantId: string): Promise<RefundableRow[]> {
  const payments = await prisma.payment.findMany({
    where: {
      tenantId,
      status: { in: ['succeeded', 'partially_refunded'] },
      // A refund is itself a Payment row; refunding one would be a charge.
      refundOfPaymentId: null,
    },
    orderBy: { receivedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      facilityId: true,
      amountCents: true,
      method: true,
      receivedAt: true,
      receiptNumber: true,
      refunds: { select: { amountCents: true, status: true } },
    },
  })

  return payments
    .map((payment) => {
      const refunded = payment.refunds
        .filter((refund) => refund.status !== 'failed')
        .reduce((sum, refund) => sum + refund.amountCents, 0)
      return {
        paymentId: payment.id,
        facilityId: payment.facilityId,
        amountCents: payment.amountCents,
        refundedCents: refunded,
        refundableCents: payment.amountCents - refunded,
        method: payment.method,
        receivedAt: payment.receivedAt,
        receiptNumber: payment.receiptNumber,
      }
    })
    .filter((row) => row.refundableCents > 0)
}
