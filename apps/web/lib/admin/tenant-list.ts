import { prisma } from '@storage/db'
import { daysPastDue } from '@storage/core/metrics'
import { leaseStatusLabel } from '@storage/core/labels'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { facilityScope, ForbiddenError, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.4 US-13, §5.5 FR-22/FR-23 (B-114). The Tenants screen, listing
// tenants.
//
// It was a heading, a search box and nothing else until you typed — so the
// screen named after them answered none of "who are my tenants", "who owes me
// money" or "who moved in this week", and every past-due question routed
// through Reports. A list you have to guess a name to see is a lookup tool, not
// a list.
//
// The two money columns come from `@storage/core/metrics` (D-25) rather than
// being computed here: `daysPastDue` is anchored to the OLDEST unpaid invoice's
// ORIGINAL due date, and getting that subtly different on one more screen is
// exactly how a tenant appears current on one page and 40 days late on another.

export const TENANT_FILTERS = [
  'all',
  'past_due',
  'moved_in_this_month',
  'ending_soon',
  'former',
] as const
export type TenantFilter = (typeof TENANT_FILTERS)[number]

export const TENANT_FILTER_LABELS: Record<TenantFilter, string> = {
  all: 'All',
  past_due: 'Past due',
  moved_in_this_month: 'Moved in this month',
  ending_soon: 'Ending soon',
  former: 'Former tenants',
}

export function isTenantFilter(value: string | undefined): value is TenantFilter {
  return TENANT_FILTERS.includes(value as TenantFilter)
}

export const TENANT_PAGE_SIZE = 25

/// Days ahead that counts as "ending soon".
///
/// Thirty rather than the facility's own `moveOutNoticeDays`: this is a
/// browsing filter, not a compliance window, and a list whose meaning changes
/// per facility cannot be a portfolio view.
const ENDING_SOON_DAYS = 30

export type TenantListRow = {
  tenantId: string
  name: string
  units: { facilityName: string; unitNumber: string }[]
  /// Already in plain words. B-109's rule: admin may use industry vocabulary,
  /// it may not render enum identifiers.
  statusLabel: string
  balanceCents: number
  daysPastDue: number
}

export type TenantList = {
  rows: TenantListRow[]
  total: number
  page: number
  pageSize: number
  filter: TenantFilter
}

/// The tenants an actor can see, newest lease first.
///
/// ponytail: aggregates in memory over the leases in scope, because the two
/// columns that matter most — balance and days past due — are not columns. A
/// ledger sum and an invoice age cannot be ordered or filtered by the database
/// without either materialising them or writing the aging as SQL. At a few
/// thousand leases this is fine; past that, denormalise the balance onto
/// `Lease` and page in the query.
export async function listTenants(
  actor: Actor,
  options: { facilityId?: string; filter?: TenantFilter; page?: number; asOf?: Date } = {},
): Promise<TenantList> {
  if (!hasPermissionAnywhere(actor, ['tenants:view'])) {
    throw new ForbiddenError('Missing permission tenants:view', 'tenants:view')
  }

  const filter = options.filter ?? 'all'
  const page = Math.max(1, options.page ?? 1)
  const asOf = options.asOf ?? new Date()

  // The switcher's facility narrows the actor's scope; it never widens it.
  const scope = facilityScope(actor)
  const where = options.facilityId
    ? { ...scope, facilityId: options.facilityId }
    : scope

  const leases = await prisma.lease.findMany({
    where: { ...where, tenant: { deletedAt: null } },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      tenantId: true,
      tenant: { select: { firstName: true, lastName: true } },
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      invoices: { select: { dueDate: true, totalCents: true, amountPaidCents: true } },
    },
  })
  if (leases.length === 0) {
    return { rows: [], total: 0, page: 1, pageSize: TENANT_PAGE_SIZE, filter }
  }

  const balances = await prisma.ledgerEntry.groupBy({
    by: ['leaseId'],
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    _sum: { amountCents: true },
  })
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const monthStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1),
  )
  const endingSoonBy = new Date(asOf.getTime() + ENDING_SOON_DAYS * 24 * 60 * 60 * 1000)

  type Aggregate = {
    tenantId: string
    name: string
    units: { facilityName: string; unitNumber: string }[]
    statuses: string[]
    balanceCents: number
    daysPastDue: number
    latestStart: number
    movedInThisMonth: boolean
    endingSoon: boolean
    everOccupying: boolean
  }
  const byTenant = new Map<string, Aggregate>()

  for (const lease of leases) {
    const occupying = OCCUPYING_LEASE_STATUSES.includes(
      lease.status as (typeof OCCUPYING_LEASE_STATUSES)[number],
    )
    const entry = byTenant.get(lease.tenantId) ?? {
      tenantId: lease.tenantId,
      name: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      units: [],
      statuses: [],
      balanceCents: 0,
      // Across every lease, the worst one: a tenant 60 days late on one unit
      // and current on another is 60 days late.
      daysPastDue: 0,
      latestStart: 0,
      movedInThisMonth: false,
      endingSoon: false,
      everOccupying: false,
    }

    if (occupying) {
      entry.units.push({ facilityName: lease.facility.name, unitNumber: lease.unit.number })
      entry.everOccupying = true
    }
    entry.statuses.push(lease.status)
    entry.balanceCents += balanceByLease.get(lease.id) ?? 0
    entry.daysPastDue = Math.max(entry.daysPastDue, daysPastDue(lease.invoices, asOf))
    entry.latestStart = Math.max(entry.latestStart, lease.startDate.getTime())
    if (lease.startDate >= monthStart) entry.movedInThisMonth = true
    if (occupying && lease.endDate && lease.endDate > asOf && lease.endDate <= endingSoonBy) {
      entry.endingSoon = true
    }

    byTenant.set(lease.tenantId, entry)
  }

  const all = [...byTenant.values()]
  const matching = all.filter((entry) => {
    switch (filter) {
      // Money owed AND actually late. A balance alone is an invoice raised
      // yesterday; this column is the one somebody acts on.
      case 'past_due':
        return entry.balanceCents > 0 && entry.daysPastDue > 0
      case 'moved_in_this_month':
        return entry.movedInThisMonth
      case 'ending_soon':
        return entry.endingSoon
      // Nothing occupying anywhere. A tenant who ended one lease and holds
      // another is a current tenant, not a former one.
      case 'former':
        return !entry.everOccupying
      default:
        return true
    }
  })

  matching.sort((a, b) => b.latestStart - a.latestStart || a.name.localeCompare(b.name))

  const start = (page - 1) * TENANT_PAGE_SIZE
  return {
    rows: matching.slice(start, start + TENANT_PAGE_SIZE).map((entry) => ({
      tenantId: entry.tenantId,
      name: entry.name,
      units: entry.units,
      statusLabel: statusLabelFor(entry.statuses),
      balanceCents: entry.balanceCents,
      daysPastDue: entry.daysPastDue,
    })),
    total: matching.length,
    page,
    pageSize: TENANT_PAGE_SIZE,
    filter,
  }
}

/// One tenant, several leases, one word. The most serious status wins, because
/// "Ended" beside a tenant who also holds an active unit is the answer to a
/// question nobody asked.
function statusLabelFor(statuses: readonly string[]): string {
  const order = ['pending_auction', 'delinquent', 'active', 'pending', 'ended']
  const worst = order.find((status) => statuses.includes(status))
  return leaseStatusLabel(worst ?? statuses[0] ?? 'ended')
}
