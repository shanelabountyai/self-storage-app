import { prisma } from '@storage/db'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
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
    where: { tenantId },
    select: {
      id: true,
      startDate: true,
      moveOutDate: true,
      unit: { select: { number: true } },
      facility: { select: { name: true } },
    },
    orderBy: { startDate: 'desc' },
  })

  return leases.flatMap((lease) =>
    statementMonths({
      startDate: lease.startDate,
      endDate: lease.moveOutDate,
      now,
    }).map(({ year, month }) => ({
      leaseId: lease.id,
      unitNumber: lease.unit.number,
      facilityName: lease.facility.name,
      year,
      month,
      label: statementLabel(year, month),
    })),
  )
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

/// True when this tenant owns this lease. The statements screens take a lease
/// id from the URL, and a statement is a full financial history — an unscoped
/// read would hand one tenant another's.
export async function tenantOwnsLease(tenantId: string, leaseId: string): Promise<boolean> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { tenantId: true },
  })
  return lease?.tenantId === tenantId
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
