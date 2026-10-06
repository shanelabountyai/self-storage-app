import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
import { checkMonetaryAuthority } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { systemActor, type Actor } from '@/lib/rbac/actor'
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
        // Keyed on the payment, what has already gone back and the amount. A
        // double-submit reads the same total and gets the original refund; a
        // second, deliberate refund of the same amount reads a higher total
        // and is a new one (MONEY-03: keyed on the amount alone, Stripe
        // answered it with the first refund and the books recorded two).
        { idempotencyKey: `refund:${payment.id}:${alreadyRefunded}:${input.amountCents}` },
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

  // B-078 / US-33. A cash or cheque refund comes out of the open drawer, so
  // it belongs to that session: the close-out's expected-cash figure has to
  // account for money that went back over the counter, and closing the
  // session is what finally settles the payable B-048 left `pending`.
  const drawerSession = method === 'card' ? null : await openSessionFor(payment.facilityId)

  const write = writeRefund(actor, payment.id, {
    amountCents: input.amountCents,
    method,
    providerRefundId,
    reasonCode: input.reasonCode,
    note: input.note,
    checkNumber: input.checkNumber,
    drawerSessionId: drawerSession?.id ?? null,
  })

  // MONEY-03. Stripe returned a refund that is already in the books: the same
  // submit sent twice, both reading the same refunded total. The unique
  // `stripeRefundId` refused the second row and rolled the whole write back, so
  // the answer is the refund that exists. Anything else is a real failure.
  const refundPaymentId = await write.catch(async (error: unknown) => {
    const existing = providerRefundId
      ? await prisma.payment.findUnique({ where: { stripeRefundId: providerRefundId }, select: { id: true } })
      : null
    if (!existing) throw error
    return existing.id
  })

  return { ok: true, refundPaymentId, amountCents: input.amountCents, method }
}

type RefundWrite = {
  amountCents: number
  method: RefundMethod
  providerRefundId: string | null
  reasonCode: string
  note?: string
  checkNumber?: string | null
  drawerSessionId?: string | null
}

/// Puts one refund in the books: the refund row, the ledger entry, the trimmed
/// allocations and the audit row, in one transaction. Shared by a refund made
/// here and one Stripe reports that was made somewhere else (MONEY-07), so the
/// two cannot come to mean different things.
function writeRefund(actor: Actor, paymentId: string, input: RefundWrite): Promise<string> {
  const { method, providerRefundId } = input
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        id: true,
        facilityId: true,
        tenantId: true,
        amountCents: true,
        method: true,
        refunds: { select: { amountCents: true, status: true } },
      },
    })
    const alreadyRefunded = payment.refunds
      .filter((refund) => refund.status !== 'failed')
      .reduce((sum, refund) => sum + refund.amountCents, 0)

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
        drawerSessionId: input.drawerSessionId ?? null,
        stripePaymentIntentId: null,
        stripeRefundId: providerRefundId,
        failureReason: null,
      },
    })

    // The refunded money is no longer settling anything. Trimming the
    // allocations and recomputing is what keeps an invoice from reading `paid`
    // on money that went back — which would leave it uncollected forever and
    // invisible to every ageing report.
    //
    // MONEY-08. It runs BEFORE the ledger post, and newest invoice first,
    // because where the allocations come off is what decides which lease owes
    // the money again. The post used to go whole to whichever ledger entry the
    // database returned first, so a payment that settled two units could
    // re-open unit B's invoice and debit unit A (B-257's defect on the way out).
    const allocations = await tx.paymentAllocation.findMany({
      where: { paymentId: payment.id },
      select: { id: true, invoiceId: true, amountCents: true, invoice: { select: { leaseId: true } } },
      orderBy: [{ invoice: { dueDate: 'desc' } }, { id: 'desc' }],
    })
    const byLease = new Map<string, number>()
    const post = (leaseId: string, cents: number) => byLease.set(leaseId, (byLease.get(leaseId) ?? 0) + cents)
    let toUnwind = input.amountCents
    for (const allocation of allocations) {
      if (toUnwind <= 0) break
      const reduction = Math.min(toUnwind, allocation.amountCents)
      toUnwind -= reduction
      post(allocation.invoice.leaseId, reduction)
      const remaining = allocation.amountCents - reduction
      if (remaining > 0) {
        await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { amountCents: remaining } })
      } else {
        await tx.paymentAllocation.delete({ where: { id: allocation.id } })
      }
    }
    await recomputeInvoices(tx, allocations.map((allocation) => allocation.invoiceId))

    // What no allocation accounts for is money the payment left as a credit (a
    // prepayment, on the anchor lease) or already-unwound money. It comes off
    // the leases this payment still holds a credit on, largest first: the
    // payment's own entries, less what earlier refunds of it put back.
    if (toUnwind > 0) {
      const held = await tx.ledgerEntry.groupBy({
        by: ['leaseId'],
        where: { OR: [{ paymentId: payment.id }, { payment: { refundOfPaymentId: payment.id } }] },
        _sum: { amountCents: true },
      })
      const room = held
        .map((row) => ({
          leaseId: row.leaseId,
          cents: -(row._sum.amountCents ?? 0) - (byLease.get(row.leaseId) ?? 0),
        }))
        .sort((a, b) => b.cents - a.cents || a.leaseId.localeCompare(b.leaseId))
      for (const { leaseId, cents } of room) {
        const take = Math.min(toUnwind, cents)
        if (take <= 0) continue
        post(leaseId, take)
        toUnwind -= take
      }
      // Books that already disagree (a payment posted before B-257, or refunded
      // before this item) still get the whole refund on a lease the payment
      // touched. A payment that touched none posts nothing, as before.
      const fallback = room[0]?.leaseId ?? byLease.keys().next().value
      if (toUnwind > 0 && fallback) post(fallback, toUnwind)
    }

    for (const [leaseId, amountCents] of byLease) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: payment.facilityId,
          leaseId,
          type: 'refund',
          // Signed: the money went back, so the tenant owes it again.
          amountCents,
          description: `Refund of ${method} payment${providerRefundId ? '' : ' (payable)'}`,
          paymentId: refund.id,
        },
      })

      // B-414. This lease's move-out left money owed back, and this is it
      // going. The tenant is told on every refund; the task closes only once
      // the lease holds no credit, so a part refund leaves it on the queue.
      const owed = await tx.task.findFirst({
        where: { type: 'move_out_refund_due', entityId: leaseId, status: 'open' },
        select: { id: true },
      })
      if (owed) {
        const balance = await tx.ledgerEntry.aggregate({ where: { leaseId }, _sum: { amountCents: true } })
        if ((balance._sum.amountCents ?? 0) >= 0) {
          await tx.task.update({
            where: { id: owed.id },
            data: {
              status: 'completed',
              completedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
              completedAt: new Date(),
              proof: { note: 'Refund recorded.' },
            },
          })
        }
        await emitEvent(
          {
            name: 'refund.sent',
            facilityId: payment.facilityId,
            entityType: 'Lease',
            entityId: leaseId,
            payload: {
              refundPaymentId: refund.id,
              amountCents: input.amountCents,
              method,
              checkNumber: input.checkNumber?.trim() || null,
            },
          },
          tx,
        )
      }
    }

    const totalRefunded = alreadyRefunded + input.amountCents
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: totalRefunded >= payment.amountCents ? 'refunded' : 'partially_refunded' },
    })

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
}

/// MONEY-07. A refund Stripe made that the books do not have: one made in the
/// Stripe dashboard, or our own call that died after Stripe accepted it.
///
/// Not a staff decision, so no permission and no limit: the money has already
/// gone back and the only choice left is whether the records say so. The
/// unique `stripeRefundId` is what makes it safe beside `refundPayment`: when
/// both write the same refund, the second is refused.
export async function recordStripeRefund(
  paymentId: string,
  refund: { id: string; amount: number; reason: string | null },
): Promise<void> {
  await writeRefund(systemActor('stripe:refund'), paymentId, {
    amountCents: refund.amount,
    method: 'card',
    providerRefundId: refund.id,
    reasonCode: `stripe_${refund.reason ?? 'refund'}`,
    note: `Stripe refund ${refund.id}, not made through this system`,
  })
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
