import { prisma, type Prisma } from '@storage/db'
import {
  allocatePayment,
  byInvoice,
  describeAllocation,
  isAllocationCategory,
  DEFAULT_ALLOCATION_ORDER,
  type AllocationCategory,
  type AllocationLine,
  type AllocationTarget,
} from '@storage/core/billing'

// PRD 02 US-22 (B-048). Applying a payment across what a lease owes.
//
// Generalises what B-045 built for the single-invoice case. Autopay still names
// its invoice and that still wins — a charge raised for one invoice must settle
// that invoice, not whatever the order happens to reach first. Everything else
// (a counter payment, a portal payment, a pay-link payment) is allocated across
// the open invoices in the facility's configured order.

/// The category a line item belongs to for allocation purposes.
///
/// `discount` is deliberately absent: a discount reduces what is owed rather
/// than being something a payment settles, so it never becomes a claim.
function categoryOf(lineType: string): AllocationCategory | null {
  switch (lineType) {
    case 'tax':
      return 'tax'
    case 'fee':
      return 'fee'
    case 'protection':
      return 'protection'
    case 'rent':
      return 'rent'
    default:
      return null
  }
}

export function orderFor(raw: readonly string[]): readonly AllocationCategory[] {
  const parsed = raw.filter(isAllocationCategory)
  return parsed.length > 0 ? parsed : DEFAULT_ALLOCATION_ORDER
}

/// What a tenant owes at a facility, split into claims the order can rank.
///
/// An invoice's outstanding amount is split across its categories in
/// proportion to what each contributed, because `Invoice` stores one paid
/// total rather than a paid amount per line. The proportion is computed on
/// whole cents with the remainder going to the LAST category in the invoice's
/// own line order, so the split always sums back to the outstanding amount —
/// a rounding remainder that vanished would leave an invoice that can never
/// reach zero.
export async function claimsFor(
  tenantId: string,
  facilityId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AllocationTarget[]> {
  const invoices = await client.invoice.findMany({
    where: {
      facilityId,
      status: { in: ['open', 'partially_paid'] },
      lease: { tenantId },
    },
    select: {
      id: true,
      dueDate: true,
      totalCents: true,
      amountPaidCents: true,
      lineItems: { select: { type: true, amountCents: true } },
    },
  })

  const targets: AllocationTarget[] = []
  for (const invoice of invoices) {
    const outstanding = invoice.totalCents - invoice.amountPaidCents
    if (outstanding <= 0) continue

    const claimable = invoice.lineItems
      .map((line) => ({ category: categoryOf(line.type), amountCents: line.amountCents }))
      .filter((line): line is { category: AllocationCategory; amountCents: number } =>
        line.category !== null && line.amountCents > 0,
      )
    const gross = claimable.reduce((sum, line) => sum + line.amountCents, 0)

    if (gross <= 0) {
      // An invoice with no categorised lines still owes money — treat it as
      // rent rather than dropping it, because unallocatable money is worse
      // than money in a slightly wrong bucket.
      targets.push({ invoiceId: invoice.id, category: 'rent', outstandingCents: outstanding, dueDate: invoice.dueDate })
      continue
    }

    const byCategory = new Map<AllocationCategory, number>()
    for (const line of claimable) {
      byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + line.amountCents)
    }

    const entries = [...byCategory.entries()]
    let assigned = 0
    entries.forEach(([category, categoryGross], index) => {
      const share =
        index === entries.length - 1
          ? outstanding - assigned
          : Math.round((outstanding * categoryGross) / gross)
      assigned += share
      if (share > 0) {
        targets.push({ invoiceId: invoice.id, category, outstandingCents: share, dueDate: invoice.dueDate })
      }
    })
  }

  return targets
}

export type AppliedPayment = {
  lines: AllocationLine[]
  unappliedCents: number
  /// US-22's "displayed at payment time and on the receipt".
  summary: { label: string; amountCents: number }[]
}

/// Allocates a payment and writes the rows, inside the caller's transaction.
///
/// Idempotent on `PaymentAllocation`'s `(paymentId, invoiceId)` unique
/// constraint: a redelivered webhook finds the allocation already there and
/// recomputes the invoice totals to the same values rather than doubling them.
export async function applyPayment(
  tx: Prisma.TransactionClient,
  payment: { id: string; tenantId: string; facilityId: string; amountCents: number },
  options: { explicitInvoiceId?: string | null } = {},
): Promise<AppliedPayment> {
  const facility = await tx.facility.findUniqueOrThrow({
    where: { id: payment.facilityId },
    select: { paymentAllocationOrder: true },
  })

  let targets = await claimsFor(payment.tenantId, payment.facilityId, tx)

  // An explicitly named invoice (autopay, B-045) wins outright. The charge was
  // raised for that invoice and settling a different one would leave the
  // invoice autopay believes it paid still open — and the next night's run
  // would charge the card again.
  if (options.explicitInvoiceId) {
    const named = targets.filter((target) => target.invoiceId === options.explicitInvoiceId)
    // Only narrow if the named invoice is genuinely claimable by this tenant;
    // the id reaches us through Stripe metadata (B-045's own caution).
    if (named.length > 0) targets = named
  }

  const result = allocatePayment(payment.amountCents, targets, orderFor(facility.paymentAllocationOrder))

  for (const { invoiceId, amountCents } of byInvoice(result.lines)) {
    const existing = await tx.paymentAllocation.findUnique({
      where: { paymentId_invoiceId: { paymentId: payment.id, invoiceId } },
      select: { id: true },
    })
    if (existing) {
      await tx.paymentAllocation.update({ where: { id: existing.id }, data: { amountCents } })
    } else {
      await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId, amountCents } })
    }
  }

  await recomputeInvoices(
    tx,
    byInvoice(result.lines).map((line) => line.invoiceId),
  )

  return {
    lines: result.lines,
    unappliedCents: result.unappliedCents,
    summary: describeAllocation(result.lines),
  }
}

/// The payment states whose allocations count toward an invoice's paid total.
///
/// `pending` and `failed` are excluded: a charge in flight reserves an invoice
/// (which is what stops autopay charging it again) without having paid it.
///
/// `partially_refunded` and `refunded` ARE included, and that is not an
/// oversight. A refund trims the allocation rows themselves — a fully refunded
/// payment has none left and contributes zero either way. Filtering on
/// `succeeded` alone meant that the moment a partial refund flipped the
/// original payment's status, the money the tenant had NOT been given back
/// stopped counting, and an invoice they had part-paid snapped to
/// `amountPaidCents: 0`. The allocations are the truth; the status is a summary
/// of the payment, not of what it settled.
const SETTLING_STATUSES = ['succeeded', 'partially_refunded', 'refunded'] as const

/// Recomputes paid totals from the allocations rather than incrementing them.
///
/// The rule D-28 settled and the reason it is worth repeating: Stripe
/// redelivers, and an increment applied twice is exactly the bug redelivery
/// causes.
export async function recomputeInvoices(
  tx: Prisma.TransactionClient,
  invoiceIds: readonly string[],
): Promise<void> {
  for (const invoiceId of new Set(invoiceIds)) {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { totalCents: true, status: true },
    })
    // A voided invoice — a waived fee (B-047) — stays voided. Recomputing it to
    // `open` because an allocation moved would resurrect a charge a manager
    // deliberately forgave.
    if (!invoice || invoice.status === 'void') continue

    const sum = await tx.paymentAllocation.aggregate({
      where: { invoiceId, payment: { status: { in: [...SETTLING_STATUSES] } } },
      _sum: { amountCents: true },
    })
    const paid = sum._sum.amountCents ?? 0

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaidCents: paid,
        status: paid >= invoice.totalCents ? 'paid' : paid > 0 ? 'partially_paid' : 'open',
      },
    })
  }
}

/// Leases with money in flight — a bank debit accepted but not yet settled.
///
/// B-103. Only ACH reaches `processing`, and while it is there the tenant has
/// paid as far as they are concerned: the money has left their account and
/// nothing they can do makes it arrive faster. Charging a late fee or starting
/// a dunning ladder against that is the single most avoidable way to make
/// somebody who paid on time feel cheated, and it is the reason the state
/// exists at all.
///
/// Scoped by TENANT at the facility rather than by invoice, deliberately. A
/// portal payment does not always name an invoice, so an allocation-based
/// lookup would silently miss the commonest case. The cost of the coarser rule
/// is that a tenant with two units at one site gets both left alone for the few
/// days a debit is settling — an error in the tenant's favour, bounded by the
/// settlement window, and far cheaper than the alternative.
///
/// One query for the whole facility, mirroring `effectsByLease` above: these
/// run per facility per night, and a per-lease lookup would be a query per
/// lease.
export async function leasesWithSettlingPayment(
  facilityId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Set<string>> {
  const settling = await client.payment.findMany({
    where: { facilityId, status: 'processing' },
    select: { tenantId: true },
    distinct: ['tenantId'],
  })
  if (settling.length === 0) return new Set()

  const leases = await client.lease.findMany({
    where: { facilityId, tenantId: { in: settling.map((payment) => payment.tenantId) } },
    select: { id: true },
  })
  return new Set(leases.map((lease) => lease.id))
}
