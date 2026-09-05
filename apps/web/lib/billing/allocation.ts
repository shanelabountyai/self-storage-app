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
import { payableLeaseFilter } from './accounts'

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
      // B-090 part 5. `payableLeaseFilter` is `{ tenantId }` widened by the
      // billing account this tenant pays for, so a business account's one
      // payment settles all eleven units and nothing else in the money path had
      // to learn about accounts.
      lease: payableLeaseFilter(tenantId, facilityId),
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

/// The invoices each active plan at this facility froze, keyed by lease.
///
/// B-203. Kept per lease rather than as one flat set because a tenant can hold
/// two leases here — one on a plan, one not — and money handed over for the
/// second must not be dragged onto the first's arrears.
async function coveredByPlan(
  tenantId: string,
  facilityId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, Set<string>>> {
  const plans = await client.paymentPlan.findMany({
    // Widened with `claimsFor` and for the same reason: a plan on an account's
    // lease must defer the payer's money exactly as it defers the tenant's, or
    // the consolidated payment walks straight over the arrears the plan froze
    // and B-203's defect comes back through the business-account door.
    where: { status: 'active', lease: payableLeaseFilter(tenantId, facilityId) },
    select: { leaseId: true, invoiceIds: true },
  })
  const byLease = new Map<string, Set<string>>()
  for (const plan of plans) {
    const existing = byLease.get(plan.leaseId) ?? new Set<string>()
    for (const id of plan.invoiceIds) existing.add(id)
    byLease.set(plan.leaseId, existing)
  }
  return byLease
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
  options: { explicitInvoiceId?: string | null; restrictToInvoiceIds?: readonly string[] | null } = {},
): Promise<AppliedPayment> {
  const facility = await tx.facility.findUniqueOrThrow({
    where: { id: payment.facilityId },
    select: { paymentAllocationOrder: true },
  })

  let targets = await claimsFor(payment.tenantId, payment.facilityId, tx)
  let deferred: AllocationTarget[] = []

  // B-189. A payment plan installment settles a SLICE of the arrears the plan
  // froze, so it narrows to that set rather than naming one invoice — and the
  // facility's own allocation order still decides which of them it lands on.
  //
  // The narrowing is what stops an installment paying current rent. A plan is
  // forbearance on what was already owed, not a rent holiday; rent invoiced
  // after the plan started is collected by ordinary autopay, and if an
  // installment could settle it the plan's own progress (measured as
  // outstanding on the covered invoices, D-96) would not move at all and the
  // tenant would be broken for a payment they made.
  //
  // Not applied when it would leave nothing to allocate against: the covered
  // invoices can all be settled by the time a redelivered webhook arrives, and
  // an empty target list would strand real money as unapplied rather than
  // crediting the tenant. That case falls back to the ordinary order.
  if (options.restrictToInvoiceIds && options.restrictToInvoiceIds.length > 0) {
    const covered = new Set(options.restrictToInvoiceIds)
    const narrowed = targets.filter((target) => covered.has(target.invoiceId))
    if (narrowed.length > 0) targets = narrowed
  }

  // B-203. A payment nobody narrowed — the counter, the portal, a pay link —
  // pays a plan's arrears BEFORE the current rent of the same lease.
  //
  // Only autopay's installment charge carried `restrictToInvoiceIds`, so a
  // tenant on a plan who handed over the exact installment at the counter had
  // it allocated by the ordinary order: tax first, and every open invoice's tax
  // share outranks every arrears rent share. This month's $12 tax and $12
  // protection came out of a $300 installment, `installmentViews` reads partial
  // coverage as uncovered, and three days later the breach job ended the plan
  // and demanded the lot. The tenant paid, on time, exactly what we asked for.
  //
  // Deferring rather than RESTRICTING is the difference that matters here. The
  // amount is whatever the tenant chose to hand over, not a figure we raised:
  // $300 covers the installment and stops, $500 covers it and spills onto the
  // current month the way the payer plainly intended. A hard restrict would
  // strand that $200 as unapplied credit, which is a second surprise on top of
  // the one being fixed.
  //
  // Scoped to the plan's OWN lease. A tenant with two leases here, one on a
  // plan and one not, has the second untouched — its invoices are not deferred
  // and keep their ordinary rank.
  if (!options.explicitInvoiceId && !options.restrictToInvoiceIds) {
    const byLease = await coveredByPlan(payment.tenantId, payment.facilityId, tx)
    if (byLease.size > 0) {
      const covered = new Set([...byLease.values()].flatMap((ids) => [...ids]))
      const postPlan = new Set(
        (
          await tx.invoice.findMany({
            where: {
              facilityId: payment.facilityId,
              leaseId: { in: [...byLease.keys()] },
              id: { notIn: [...covered] },
            },
            select: { id: true },
          })
        ).map((invoice) => invoice.id),
      )
      if (postPlan.size > 0) {
        deferred = targets.filter((target) => postPlan.has(target.invoiceId))
        targets = targets.filter((target) => !postPlan.has(target.invoiceId))
      }
    }
  }

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

  const order = orderFor(facility.paymentAllocationOrder)
  const first = allocatePayment(payment.amountCents, targets, order)
  // Whatever the plan's arrears did not absorb falls through to the current
  // rent that was deferred above, in the facility's ordinary order.
  const second =
    first.unappliedCents > 0 && deferred.length > 0
      ? allocatePayment(first.unappliedCents, deferred, order)
      : { lines: [], unappliedCents: first.unappliedCents }
  const result = {
    lines: [...first.lines, ...second.lines],
    unappliedCents: second.unappliedCents,
  }

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

/// Writes the ledger side of a payment, SPLIT ACROSS THE LEASES IT SETTLED.
///
/// B-257. One payment settles as many leases as the facility's allocation order
/// reaches — `claimsFor` has spread money across every lease a tenant holds at a
/// facility since B-048, and across a billing account's leases since B-090e —
/// but both money-in paths wrote a SINGLE ledger entry for the whole amount
/// against one named lease. The invoices came out right and the per-lease
/// balances did not: a tenant with two $100 units who paid $200 at the counter
/// ended with both invoices `paid`, unit A reading a $100 credit and unit B
/// still reading $100 owed. The portal then asks them for money they have
/// already handed over, and the statement for each unit is wrong in opposite
/// directions.
///
/// Mirrored off the allocation rather than re-deriving the arithmetic, which is
/// the device `postMoveInPaymentToLedger` (B-255) already uses for a multi-unit
/// basket, and for the same reason: the allocation is what decided where the
/// money went, so anything else is a second opinion that can disagree with it.
///
/// **The unallocated remainder goes to the anchor lease**, which is the lease
/// the payer named — the unit whose Pay button they pressed, or the one the
/// counter had open. That is money over and above what any invoice claimed, and
/// it must still land somewhere on a lease ledger or a prepayment would vanish
/// from the balance a tenant is shown. Credit on account stays derived at
/// tenant × facility (B-225); this is only the per-lease view of it, and it
/// keeps the behaviour a single-lease prepayment has always had.
///
/// Idempotent on the same `paymentId` + `type: 'payment'` guard the single-entry
/// version used, so a Stripe redelivery is a no-op.
export async function postPaymentLedger(
  tx: Prisma.TransactionClient,
  payment: { id: string; facilityId: string; amountCents: number },
  applied: AppliedPayment,
  anchorLeaseId: string | null,
  description: string,
): Promise<void> {
  const existing = await tx.ledgerEntry.findFirst({
    where: { paymentId: payment.id, type: 'payment' },
    select: { id: true },
  })
  if (existing) return

  const byLease = new Map<string, number>()
  if (applied.lines.length > 0) {
    const invoices = await tx.invoice.findMany({
      where: { id: { in: [...new Set(applied.lines.map((line) => line.invoiceId))] } },
      select: { id: true, leaseId: true },
    })
    const leaseOf = new Map(invoices.map((invoice) => [invoice.id, invoice.leaseId]))
    for (const line of applied.lines) {
      const leaseId = leaseOf.get(line.invoiceId)
      if (!leaseId) continue
      byLease.set(leaseId, (byLease.get(leaseId) ?? 0) + line.amountCents)
    }
  }

  // Whatever no invoice claimed — a prepayment, or an overpayment the allocator
  // deliberately refused to invent a home for. Computed from the payment total
  // rather than read from `unappliedCents` so that the entries always sum to the
  // amount actually taken, even if a line failed to resolve its lease above.
  const allocated = [...byLease.values()].reduce((sum, cents) => sum + cents, 0)
  const remainder = payment.amountCents - allocated
  if (remainder > 0 && anchorLeaseId) {
    byLease.set(anchorLeaseId, (byLease.get(anchorLeaseId) ?? 0) + remainder)
  }

  // Nothing to post is a real state — a merchandise sale, or a payment by
  // somebody holding no lease at this facility — and inventing an entry would
  // attach the money to a lease it never touched.
  for (const [leaseId, amountCents] of byLease) {
    if (amountCents === 0) continue
    await tx.ledgerEntry.create({
      data: {
        facilityId: payment.facilityId,
        leaseId,
        type: 'payment',
        // Signed: a payment reduces what is owed (see the enum's own comment).
        amountCents: -amountCents,
        description,
        paymentId: payment.id,
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
