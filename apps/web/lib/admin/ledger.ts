import { prisma } from '@storage/db'
import {
  ledgerTotals,
  reconcile,
  runningBalance,
  type LedgerEntryKind,
  type LedgerLine,
  type LedgerTotals,
  type Reconciliation,
} from '@storage/core/billing'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
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

  const [entries, invoices] = await Promise.all([
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
    prisma.invoice.findMany({
      where: { leaseId, status: { in: ['open', 'partially_paid'] } },
      select: { totalCents: true, amountPaidCents: true },
    }),
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

  // Charges with no invoice behind them — the move-in charge B-026 posts
  // before invoicing exists. Counted so the reconciliation does not report a
  // discrepancy on every tenant who ever moved in.
  const uninvoicedChargeCents = entries
    .filter((entry) => entry.type === 'charge' && entry.invoice === null)
    .reduce((sum, entry) => sum + entry.amountCents, 0)
  const uninvoicedSettledCents = entries
    .filter((entry) => entry.type !== 'charge' && entry.invoice === null)
    .reduce((sum, entry) => sum + entry.amountCents, 0)

  return {
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    unitNumber: lease.unit.number,
    tenantId: lease.tenant.id,
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    lines,
    totals,
    reconciliation: reconcile({
      ledgerBalanceCents: totals.balanceCents,
      invoiceOutstandingCents: invoices.reduce(
        (sum, invoice) => sum + Math.max(0, invoice.totalCents - invoice.amountPaidCents),
        0,
      ),
      // Payments against an uninvoiced charge reduce it, so the residual is the
      // net — a move-in charge paid at the counter leaves nothing outstanding
      // and must not read as a discrepancy in the other direction.
      uninvoicedChargeCents: uninvoicedChargeCents + uninvoicedSettledCents,
    }),
  }
}
