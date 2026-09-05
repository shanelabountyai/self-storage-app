import { prisma } from '@storage/db'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { payableLeaseWhere } from './accounts'
import type { Actor } from '@/lib/rbac/actor'
import {
  buildStatement,
  monthBounds,
  reconciles,
  statementLabel,
  statementMonths,
  type Statement,
  type StatementLine,
} from '@storage/core/billing'

// PRD 01 US-705 / FR-6.1 (B-102). The statements centre's read model.
//
// The maths is pure and lives in packages/core/billing/statements.ts. This is
// the part that has to touch the ledger, and the only interesting thing it does
// is fetch the opening balance as ONE aggregate rather than replaying six years
// of rows to get to January.

export class StatementDoesNotReconcileError extends Error {
  readonly leaseId: string
  readonly label: string

  constructor(leaseId: string, label: string) {
    super(`The ${label} statement for lease ${leaseId} does not reconcile`)
    this.name = 'StatementDoesNotReconcileError'
    this.leaseId = leaseId
    this.label = label
  }
}

export type StatementSummary = {
  leaseId: string
  unitNumber: string
  facilityName: string
  year: number
  month: number
  label: string
  /// B-232. What was still owed at the end of that month. The list was a month
  /// label and the word "View" — so a bookkeeper looking for the month a
  /// balance appeared in opened five statements to find one, and a tenant
  /// asking "what is this charge" got no help from this screen at all.
  closingBalanceCents: number
  /// B-256. The business account this unit is billed to, when it is on one.
  /// The list groups by it, so a payer with eleven units gets one account
  /// heading rather than eleven unit headings they have to add up themselves.
  account: { id: string; name: string } | null
}

/// Every month every one of this tenant's leases has a statement for, newest
/// first.
///
/// Includes ENDED leases, deliberately: a moved-out tenant still needs last
/// year's statements, which is most of why this screen exists (persona P5's
/// "receipts/statements for bookkeeping"). It is also the reason nothing here
/// filters on lease status.
export async function statementsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<StatementSummary[]> {
  const leases = await prisma.lease.findMany({
    // B-256. Widened to what this tenant may PAY, not only what they hold: a
    // business account's payer needs the statements for the units they settle,
    // which is most of why persona P5 asked for this screen — the small-business
    // tenant "needs receipts/statements for bookkeeping", and the bookkeeping is
    // for the company's eleven units, not for the payer's own zero.
    //
    // Still no status filter, for the reason above: an ENDED lease keeps its
    // statements, and a unit somebody moved out of is still on the account that
    // paid for it.
    where: payableLeaseWhere(tenantId),
    select: {
      id: true,
      startDate: true,
      moveOutDate: true,
      unit: { select: { number: true } },
      billingAccount: { select: { id: true, name: true, payerTenantId: true } },
      facility: { select: { name: true, timezone: true } },
    },
    orderBy: { startDate: 'desc' },
  })
  if (leases.length === 0) return []

  // B-232. One read of every entry on these leases, and the closing balances
  // are a prefix sum over it. The alternative — an aggregate per month per
  // lease — is one query per row on a screen that lists every month a tenant
  // has ever had, and the arithmetic is a running addition either way.
  const entries = await prisma.ledgerEntry.findMany({
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    orderBy: { occurredAt: 'asc' },
    select: { leaseId: true, amountCents: true, occurredAt: true },
  })
  const byLease = new Map<string, { amountCents: number; occurredAt: Date }[]>()
  for (const entry of entries) {
    byLease.set(entry.leaseId, [...(byLease.get(entry.leaseId) ?? []), entry])
  }

  return leases.flatMap((lease) => {
    const ledger = byLease.get(lease.id) ?? []
    // `statementMonths` returns newest first; the prefix sum has to run oldest
    // first, so it is built in calendar order and read back by key.
    const closingByMonth = new Map<string, number>()
    const months = statementMonths({
      startDate: lease.startDate,
      endDate: lease.moveOutDate,
      now,
    })

    let cursor = 0
    let running = 0
    for (const { year, month } of [...months].reverse()) {
      const period = monthBounds(year, month, lease.facility.timezone)
      // Everything that occurred before this month ENDED. Entries are sorted,
      // so the cursor only moves forward — the whole ledger is walked once per
      // lease however many months it has.
      while (cursor < ledger.length && ledger[cursor].occurredAt < period.end) {
        running += ledger[cursor].amountCents
        cursor += 1
      }
      closingByMonth.set(`${year}-${month}`, running)
    }

    // Only when the viewer is the PAYER. A tenant whose own unit is on somebody
    // else's account still sees it as their unit, under its own heading — the
    // account is not theirs to be grouped under.
    const account =
      lease.billingAccount && lease.billingAccount.payerTenantId === tenantId
        ? { id: lease.billingAccount.id, name: lease.billingAccount.name }
        : null

    return months.map(({ year, month }) => ({
      leaseId: lease.id,
      unitNumber: lease.unit.number,
      facilityName: lease.facility.name,
      year,
      month,
      label: statementLabel(year, month),
      closingBalanceCents: closingByMonth.get(`${year}-${month}`) ?? 0,
      account,
    }))
  })
}

export type LeaseStatement = Statement & {
  leaseId: string
  unitNumber: string
  facilityName: string
  facilityTimezone: string
  tenantName: string
  year: number
  month: number
  label: string
}

/// One lease, one calendar month.
///
/// Throws rather than returning a statement that does not add up. Rendering it
/// anyway would put a document in front of somebody's accountant that is wrong
/// in a way nobody noticed — and since the arithmetic here is a single addition
/// over an append-only table, a failure means something is badly wrong upstream
/// rather than that this month is unlucky.
export async function leaseStatement(input: {
  leaseId: string
  year: number
  month: number
}): Promise<LeaseStatement> {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: input.leaseId },
    select: {
      id: true,
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
      facility: { select: { name: true, timezone: true } },
    },
  })

  const period = monthBounds(input.year, input.month, lease.facility.timezone)

  const [opening, entries] = await Promise.all([
    // One aggregate for everything before the period. The alternative — reading
    // every entry since the lease started and summing in memory — is the same
    // number and gets slower every month the tenant stays.
    prisma.ledgerEntry.aggregate({
      where: { leaseId: input.leaseId, occurredAt: { lt: period.start } },
      _sum: { amountCents: true },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        leaseId: input.leaseId,
        occurredAt: { gte: period.start, lt: period.end },
      },
      orderBy: { occurredAt: 'asc' },
      select: { type: true, amountCents: true, description: true, occurredAt: true },
    }),
  ])

  const statement = buildStatement({
    period,
    openingBalanceCents: opening._sum.amountCents ?? 0,
    lines: entries.map(
      (entry): StatementLine => ({
        type: entry.type,
        amountCents: entry.amountCents,
        description: entry.description,
        occurredAt: entry.occurredAt,
      }),
    ),
  })

  const label = statementLabel(input.year, input.month)
  if (!reconciles(statement)) throw new StatementDoesNotReconcileError(input.leaseId, label)

  return {
    ...statement,
    leaseId: lease.id,
    unitNumber: lease.unit.number,
    facilityName: lease.facility.name,
    facilityTimezone: lease.facility.timezone,
    tenantName: `${lease.tenant?.firstName ?? ''} ${lease.tenant?.lastName ?? ''}`.trim(),
    year: input.year,
    month: input.month,
    label,
  }
}

/// True when this tenant may see this lease's statements. The statements screens
/// take a lease id from the URL, and a statement is a full financial history —
/// an unscoped read would hand one tenant another's.
///
/// B-256. Was `tenantOwnsLease`, and ownership is no longer the whole of who may
/// look: a business account's payer settles these invoices out of their own
/// money and gets the bookkeeping record for them. `payableLeaseWhere` is the
/// same union that decides which leases their payment can settle, so what a
/// payer can SEE and what they can PAY cannot drift apart.
///
/// It is deliberately not symmetric — a unit's own tenant never gains sight of
/// the rest of the account through this. Being billed for something does not
/// make the other units' history yours.
export async function tenantMayViewLease(tenantId: string, leaseId: string): Promise<boolean> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, ...payableLeaseWhere(tenantId) },
    select: { id: true },
  })
  return lease !== null
}

/// The statements a staff member may see for one lease.
///
/// Gated exactly the way the ledger is (`assertFacilityAccess` + `tenants:view`
/// at the lease's own facility), because it is the same money seen a different
/// way — a statement a manager could open for a facility they hold no
/// assignment for would be a hole in the ledger's own scoping, reached by a
/// different URL.
export async function staffStatementsForLease(
  actor: Actor,
  leaseId: string,
  now: Date = new Date(),
): Promise<{ months: { year: number; month: number; label: string }[]; tenantId: string } | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      facilityId: true,
      tenantId: true,
      startDate: true,
      moveOutDate: true,
    },
  })
  if (!lease?.tenantId) return null

  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'tenants:view', lease.facilityId)) {
    throw new ForbiddenError('Missing permission to read a statement', 'tenants:view', lease.facilityId)
  }

  return {
    tenantId: lease.tenantId,
    months: statementMonths({ startDate: lease.startDate, endDate: lease.moveOutDate, now }).map(
      ({ year, month }) => ({ year, month, label: statementLabel(year, month) }),
    ),
  }
}
