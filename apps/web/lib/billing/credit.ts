import type { Prisma } from '@prisma/client'
import { prisma } from '@storage/db'

import { recordAudit } from '@storage/core/audit'

import { recomputeInvoices } from '@/lib/billing/allocation'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// B-225 / PRD 02 US-22, US-24. Money a tenant has handed over that no invoice
// has claimed.
//
// `applyPayment` has returned `unappliedCents` since B-044 and NOTHING
// downstream read it. A tenant hands the counter $600 in December for six
// months: $150 settles the open invoice and $450 sits nowhere. In January the
// new invoice is issued at full value, `assessLateFees` charges a fee, and
// `runAutopay` takes another $150 from their card — a chargeback and a lost
// tenant, produced by their own money. The month-end journal has already posted
// the $450 to Customer Deposits, so the liability is on the books with nothing
// anywhere that can discharge it.
//
// **There is no new column, and that is deliberate.** The credit is already
// derivable from data the ledger keeps: what we took, less what sits against an
// invoice, less what went back out. `lib/admin/revenue-report.ts` has computed
// exactly this figure for months to fill the "Unapplied" column — it was
// reported and never acted on. A stored balance would be a second copy of a
// number the allocations already determine, and the two would drift the first
// time a refund or a reversal moved without it.
//
// **Scope is TENANT × FACILITY, not lease, and the backlog row's "lease-level
// credit" is narrower than what the data can support.** `Payment` has no
// `leaseId` — money arrives from a tenant at a facility — and `applyPayment`
// already spreads a payment across that tenant's invoices at that facility in
// the facility's own allocation order. Deriving credit at the same grain means
// prepaid money behaves exactly like the payment it came from, which is the
// behaviour the product already has and the one an operator already expects.
// Anchoring it to a lease would mean inventing an attribution that the payment
// never carried, and a tenant with two units would find money they handed over
// refusing to pay the unit it was not labelled for.

/// The payment states whose money is genuinely in hand.
///
/// The same set `allocation.ts` settles invoices on, and for the same reason: a
/// refund TRIMS THE ALLOCATIONS rather than marking them, so a partially
/// refunded payment still legitimately settles what was not given back. Reading
/// `succeeded` alone would make a partial refund erase the credit entirely.
const IN_HAND = ['succeeded', 'partially_refunded', 'refunded'] as const

/// What one payment is still carrying, unclaimed by any invoice.
///
/// Floored at zero. A refund unwinds allocations BEFORE it touches unapplied
/// money (`refunds.ts` walks the allocation rows first), so a refund larger
/// than the allocations leaves the remainder simply unwound rather than
/// negative — and a negative "credit" is nonsense on a screen and dangerous in
/// a subtraction.
export function unclaimedCents(payment: {
  amountCents: number
  allocations: readonly { amountCents: number }[]
  refunds: readonly { status: string; amountCents: number }[]
}): number {
  const allocated = payment.allocations.reduce((sum, one) => sum + one.amountCents, 0)
  const refunded = payment.refunds
    .filter((refund) => refund.status !== 'failed')
    .reduce((sum, refund) => sum + refund.amountCents, 0)
  return Math.max(0, payment.amountCents - allocated - refunded)
}

/// Credit on account for every named tenant at one facility, in cents.
///
/// Batched deliberately: the three jobs that need this (`generateInvoices`,
/// `assessLateFees`, `runAutopay`) each run over a whole facility, and a
/// per-lease query inside those loops is the shape that made the late-fee run
/// slow enough to notice.
export async function creditByTenant(
  facilityId: string,
  tenantIds: readonly string[],
): Promise<Map<string, number>> {
  const credit = new Map<string, number>()
  if (tenantIds.length === 0) return credit

  const payments = await prisma.payment.findMany({
    where: {
      facilityId,
      tenantId: { in: [...new Set(tenantIds)] },
      status: { in: [...IN_HAND] },
      // A refund is itself a Payment row pointing at what it reverses. It is
      // money going OUT; counting it as credit would hand the tenant the same
      // money twice.
      refundOfPaymentId: null,
    },
    select: {
      tenantId: true,
      amountCents: true,
      allocations: { select: { amountCents: true } },
      refunds: { select: { status: true, amountCents: true } },
    },
  })

  for (const payment of payments) {
    const unclaimed = unclaimedCents(payment)
    if (unclaimed > 0) credit.set(payment.tenantId, (credit.get(payment.tenantId) ?? 0) + unclaimed)
  }
  return credit
}

/// Credit on account for one tenant at one facility, in cents.
export async function creditCentsFor(tenantId: string, facilityId: string): Promise<number> {
  return (await creditByTenant(facilityId, [tenantId])).get(tenantId) ?? 0
}

/// Spends a tenant's credit on one invoice, up to what that invoice still owes.
///
/// Returns the cents actually applied. **This is the only way credit is ever
/// consumed** — the invoice sweep, autopay's netting and the counter's "apply
/// to this invoice" control all route through here, so there is one definition
/// of what spending credit means and one place a bug in it can live.
///
/// Credit is not a balance that gets decremented; it is the unclaimed part of
/// real payments. Spending it therefore means writing the `PaymentAllocation`
/// rows those payments should have had, which is exactly what `applyPayment`
/// would have written had the invoice existed at the time. Nothing new is
/// invented: the same rows, the same recompute, the same audit surface.
///
/// Oldest payment first. A tenant's money is spent in the order they handed it
/// over, which is what a statement reads like and what an operator explains at
/// a counter.
export async function applyCreditToInvoice(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; facilityId: string; invoiceId: string },
): Promise<number> {
  const invoice = await tx.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, totalCents: true, amountPaidCents: true },
  })
  if (!invoice) return 0

  let room = invoice.totalCents - invoice.amountPaidCents
  if (room <= 0) return 0

  const payments = await tx.payment.findMany({
    where: {
      facilityId: input.facilityId,
      tenantId: input.tenantId,
      status: { in: [...IN_HAND] },
      refundOfPaymentId: null,
    },
    select: {
      id: true,
      amountCents: true,
      allocations: { select: { invoiceId: true, amountCents: true } },
      refunds: { select: { status: true, amountCents: true } },
    },
    orderBy: { receivedAt: 'asc' },
  })

  let applied = 0
  for (const payment of payments) {
    if (room <= 0) break
    const spare = unclaimedCents(payment)
    if (spare <= 0) continue

    const take = Math.min(spare, room)
    // This payment may already sit against this invoice — a partial settlement
    // that left change over. Add to that row rather than creating a second one:
    // `PaymentAllocation` is unique on (paymentId, invoiceId), so a create
    // would throw and a blind overwrite would erase what it already settled.
    const existing = payment.allocations.find((one) => one.invoiceId === invoice.id)
    if (existing) {
      await tx.paymentAllocation.update({
        where: { paymentId_invoiceId: { paymentId: payment.id, invoiceId: invoice.id } },
        data: { amountCents: existing.amountCents + take },
      })
    } else {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amountCents: take },
      })
    }
    applied += take
    room -= take
  }

  if (applied > 0) await recomputeInvoices(tx, [invoice.id])
  return applied
}

export type ApplyCreditResult =
  | { ok: true; appliedCents: number }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'no_credit' | 'nothing_owed' }

/// The counter's "put this credit against that invoice" control.
///
/// Gated on `payments:take`, NOT `credits:manual`, and deliberately carries no
/// monetary limit. A manual credit posts value that did not exist and is
/// therefore capped by a role's authority; this moves money the tenant has
/// already handed over onto one of their own invoices. Nothing is created, the
/// facility is no worse off at any amount, and capping it would mean a counter
/// staffer could take $600 at the desk and then need a manager to let the
/// tenant spend it.
export async function applyCreditByStaff(
  actor: Actor,
  input: { invoiceId: string },
): Promise<ApplyCreditResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      number: true,
      facilityId: true,
      totalCents: true,
      amountPaidCents: true,
      lease: { select: { tenantId: true } },
    },
  })
  if (!invoice) return { ok: false, reason: 'not_found' }
  if (!can(actor, 'payments:take', invoice.facilityId)) return { ok: false, reason: 'forbidden' }
  if (invoice.totalCents - invoice.amountPaidCents <= 0) return { ok: false, reason: 'nothing_owed' }

  const applied = await prisma.$transaction(async (tx) => {
    const cents = await applyCreditToInvoice(tx, {
      tenantId: invoice.lease.tenantId,
      facilityId: invoice.facilityId,
      invoiceId: invoice.id,
    })
    if (cents > 0) {
      // Audited even though no money moved and no new value was created. What
      // changed is which debt a tenant's money settled, and that is exactly the
      // decision somebody will want to reconstruct when a statement is queried
      // at a counter six months later.
      await recordAudit(
        {
          actor: toAuditActor(actor),
          action: 'credit.applied',
          entityType: 'Invoice',
          entityId: invoice.id,
          facilityId: invoice.facilityId,
          context: { invoiceNumber: invoice.number, amountCents: cents },
        },
        tx,
      )
    }
    return cents
  })

  return applied > 0 ? { ok: true, appliedCents: applied } : { ok: false, reason: 'no_credit' }
}
