import { prisma } from '@storage/db'
import {
  ledgerTotals,
  reconcile,
  runningBalance,
  type LedgerEntryKind,
  type LedgerLine,
  type LedgerTotals,
  type Reconciliation,
  type ReconciliationInput,
} from '@storage/core/billing'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { SETTLING_STATUSES } from '@/lib/billing/allocation'
import { financialFacilities } from '@/lib/admin/reports'
import { createTask } from '@/lib/admin/tasks'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-24 (B-049). The tenant ledger, read.
//
// The adapter fetches and shapes; every figure comes back from
// `@storage/core/billing` — the same division D-25 settled for metrics, and for
// the same reason. A running balance computed here as well as there is a
// running balance that will eventually disagree with itself.

export type LeaseLedger = {
  leaseId: string
  facilityId: string
  facilityName: string
  unitNumber: string
  tenantName: string
  tenantId: string
  lines: LedgerLine[]
  totals: LedgerTotals
  reconciliation: Reconciliation
}

/// The ledger for one lease.
///
/// Authorization and lookup in one query, the same shape `payableLease` uses:
/// a version that fetched first and checked second is the one that eventually
/// ships with the check dropped.
export async function leaseLedger(actor: Actor, leaseId: string): Promise<LeaseLedger | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      id: true,
      facilityId: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      tenant: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  if (!lease) return null

  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'tenants:view', lease.facilityId)) {
    throw new ForbiddenError('Missing permission to read a ledger', 'tenants:view', lease.facilityId)
  }

  const [entries, inputs] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        type: true,
        description: true,
        occurredAt: true,
        amountCents: true,
        invoice: { select: { number: true } },
      },
    }),
    reconciliationInputs({ leaseIds: [leaseId] }),
  ])

  const rows = entries.map((entry) => ({
    id: entry.id,
    kind: entry.type as LedgerEntryKind,
    description: entry.description,
    occurredAt: entry.occurredAt,
    amountCents: entry.amountCents,
    invoiceNumber: entry.invoice?.number ?? null,
  }))

  const lines = runningBalance(rows)
  const totals = ledgerTotals(rows)

  return {
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    unitNumber: lease.unit.number,
    tenantId: lease.tenant.id,
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    lines,
    totals,
    reconciliation: reconcile(inputs.get(leaseId) ?? NO_MONEY),
  }
}

const NO_MONEY: ReconciliationInput = {
  ledgerBalanceCents: 0,
  invoiceOutstandingCents: 0,
  uninvoicedChargeCents: 0,
}

/// The three terms `reconcile` compares, for every lease in scope.
///
/// ONE loader for the ledger screen, the notice gate and the exception sweep
/// (B-277). Each used to add the terms up itself, and a second copy is how two
/// of them come to disagree about whether a lease reconciles.
///
/// B-292. A payment's ledger entry names no invoice — `postPaymentLedger` posts
/// per lease, and which invoices the money settled lives in `PaymentAllocation`.
/// The invoice side already counts that money (the invoice reads paid), so the
/// same amount has to come back out of the uninvoiced term or it is counted
/// twice. Until B-292 it was, and every lease that had ever paid an invoice
/// reported a discrepancy the size of what it paid — and had its lien notice
/// refused for it.
///
/// Only allocations whose payment has an uninvoiced entry on the SAME lease come
/// back out. An entry that already names its invoice is on the invoice side, and
/// money that settled another lease's invoice must stay visible as that lease's
/// gap, which is the shape every pre-B-257 multi-unit payment left behind.
export async function reconciliationInputs(
  scope: { leaseIds: readonly string[] } | { facilityIds: readonly string[] },
): Promise<Map<string, ReconciliationInput>> {
  const where =
    'leaseIds' in scope
      ? { leaseId: { in: [...scope.leaseIds] } }
      : { facilityId: { in: [...scope.facilityIds] } }

  const [balances, uninvoiced, invoices, allocations, paymentEntries] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ['leaseId'], where, _sum: { amountCents: true } }),
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { ...where, invoiceId: null },
      _sum: { amountCents: true },
    }),
    prisma.invoice.findMany({
      where: { ...where, status: { in: ['open', 'partially_paid'] } },
      select: { leaseId: true, totalCents: true, amountPaidCents: true },
    }),
    prisma.paymentAllocation.findMany({
      where: { invoice: where, payment: { status: { in: [...SETTLING_STATUSES] } } },
      select: { paymentId: true, amountCents: true, invoice: { select: { leaseId: true } } },
    }),
    prisma.ledgerEntry.findMany({
      where: { ...where, type: 'payment', invoiceId: null, paymentId: { not: null } },
      select: { leaseId: true, paymentId: true },
      distinct: ['leaseId', 'paymentId'],
    }),
  ])

  const inputs = new Map<string, ReconciliationInput>()
  const at = (leaseId: string): ReconciliationInput => {
    let input = inputs.get(leaseId)
    if (!input) inputs.set(leaseId, (input = { ...NO_MONEY }))
    return input
  }

  for (const row of balances) at(row.leaseId).ledgerBalanceCents = row._sum.amountCents ?? 0
  for (const row of uninvoiced) at(row.leaseId).uninvoicedChargeCents += row._sum.amountCents ?? 0
  for (const invoice of invoices) {
    at(invoice.leaseId).invoiceOutstandingCents += Math.max(
      0,
      invoice.totalCents - invoice.amountPaidCents,
    )
  }
  const posted = new Set(paymentEntries.map((entry) => `${entry.paymentId}:${entry.leaseId}`))
  for (const allocation of allocations) {
    const leaseId = allocation.invoice.leaseId
    if (posted.has(`${allocation.paymentId}:${leaseId}`)) {
      at(leaseId).uninvoicedChargeCents += allocation.amountCents
    }
  }
  return inputs
}

export type LedgerException = {
  leaseId: string
  facilityId: string
  facilityName: string
  tenantId: string
  tenantName: string
  unitNumber: string
  ledgerBalanceCents: number
  invoiceOutstandingCents: number
  reconciliation: Reconciliation
}

/// B-277. Every lease at these facilities whose ledger and invoices disagree.
///
/// `reconcile` had two callers, and neither looks for trouble: the ledger
/// screen answers for the one lease somebody opened, and the notice gate only
/// runs when somebody tries to send a notice. Meanwhile the delinquency engine
/// cures on the LEDGER balance, so a phantom balance keeps a paid-up tenant
/// overlocked and on the ladder with nothing anywhere saying so. Largest gap
/// first within each facility.
export async function ledgerExceptions(facilityIds: readonly string[]): Promise<LedgerException[]> {
  if (facilityIds.length === 0) return []

  const failing = [...(await reconciliationInputs({ facilityIds }))]
    .map(([leaseId, input]) => ({ leaseId, input, reconciliation: reconcile(input) }))
    .filter((row) => !row.reconciliation.reconciles)
  if (failing.length === 0) return []

  const leases = await prisma.lease.findMany({
    where: { id: { in: failing.map((row) => row.leaseId) } },
    select: {
      id: true,
      facilityId: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      tenant: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  const byId = new Map(leases.map((lease) => [lease.id, lease]))

  return failing
    .flatMap(({ leaseId, input, reconciliation }) => {
      const lease = byId.get(leaseId)
      if (!lease) return []
      return [
        {
          leaseId,
          facilityId: lease.facilityId,
          facilityName: lease.facility.name,
          tenantId: lease.tenant.id,
          tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
          unitNumber: lease.unit.number,
          ledgerBalanceCents: input.ledgerBalanceCents,
          invoiceOutstandingCents: input.invoiceOutstandingCents,
          reconciliation,
        },
      ]
    })
    .sort(
      (a, b) =>
        a.facilityName.localeCompare(b.facilityName) ||
        Math.abs(b.reconciliation.differenceCents) - Math.abs(a.reconciliation.differenceCents),
    )
}

/// The exception list a staffer may see: the facilities they hold
/// `reports:financial` at, the scoping every other money report uses.
export async function ledgerExceptionsFor(actor: Actor): Promise<LedgerException[]> {
  return ledgerExceptions((await financialFacilities(actor)).map((facility) => facility.id))
}

/// B-277. The sweep's alarm, through B-229's channel: one high-priority task
/// per facility per business day while anything there fails to reconcile, so
/// the list reaches somebody rather than waiting to be visited. Returns how
/// many leases failed, for the cron response.
export async function raiseLedgerExceptionTasks(
  now: Date,
  facilityIds: readonly string[],
): Promise<number> {
  const exceptions = await ledgerExceptions(facilityIds)

  const counts = new Map<string, number>()
  for (const exception of exceptions) {
    counts.set(exception.facilityId, (counts.get(exception.facilityId) ?? 0) + 1)
  }
  for (const [facilityId, count] of counts) {
    await createTask({
      facilityId,
      type: 'ledger_does_not_reconcile',
      entityType: 'Facility',
      entityId: facilityId,
      at: now,
      priority: 'high',
      // The count as of the first sweep today — later ticks find today's task
      // and leave it alone, so the sentence says when it was true.
      detail: `When this was raised, ${count} ${count === 1 ? 'lease’s ledger' : 'leases’ ledgers'} disagreed with the invoices. Reports → Ledger exceptions lists them.`,
    })
  }
  return exceptions.length
}
