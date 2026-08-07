import { prisma, type Prisma } from '@storage/db'
import { isAccessFlag, type AccessFlag } from '@storage/core/access'
import { facilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 03 US-5 (B-064). "I can see who entered and left, when, and spot
// anomalies."
//
// One query behind both the facility-wide log and the tenant's own history on
// their profile (AC1 and AC2), because they are the same list with a different
// filter — and two implementations would eventually disagree about what
// "denied" means.

export type AccessEventRow = {
  id: string
  facilityId: string
  facilityName: string
  occurredAt: Date
  result: 'granted' | 'denied'
  reason: string
  flags: AccessFlag[]
  /// Null for an unknown code — which is the whole point of retaining those
  /// rows (FR-4): somebody was at the gate, and we cannot say who.
  tenantId: string | null
  tenantName: string | null
  unitNumber: string | null
}

export type EventLogFilters = {
  facilityId?: string
  tenantId?: string
  from?: Date
  /// Exclusive, matching every other range in this codebase.
  to?: Date
  result?: 'granted' | 'denied'
  flag?: string
  limit?: number
}

const DEFAULT_LIMIT = 200

/// AC1's filterable log, scoped to what the actor may see.
///
/// Scoping is by `access:events`, not by tenant-view: a gate log says where a
/// named person physically was and when, which is a sharper fact than their
/// billing history and deserves its own key.
export async function accessEventLog(
  actor: Actor,
  filters: EventLogFilters = {},
): Promise<AccessEventRow[]> {
  const access = facilityAccess(actor)
  if (!access.all && access.facilityIds.length === 0) return []

  if (filters.facilityId && !can(actor, 'access:events', filters.facilityId)) {
    throw new ForbiddenError('Missing permission to read gate events', 'access:events', filters.facilityId)
  }

  const allowed = access.all
    ? undefined
    : access.facilityIds.filter((id) => can(actor, 'access:events', id))
  if (allowed && allowed.length === 0) return []

  const where: Prisma.AccessEventWhereInput = {
    facilityId: filters.facilityId ?? (allowed ? { in: allowed } : undefined),
    result: filters.result,
    // Postgres array containment. A row carries every flag that applied, so
    // filtering by one never hides an event that also carries three others.
    flags: filters.flag && isAccessFlag(filters.flag) ? { has: filters.flag } : undefined,
    occurredAt:
      filters.from || filters.to
        ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) }
        : undefined,
    credential: filters.tenantId ? { grant: { tenantId: filters.tenantId } } : undefined,
  }

  const rows = await prisma.accessEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: filters.limit ?? DEFAULT_LIMIT,
    select: {
      id: true,
      facilityId: true,
      occurredAt: true,
      result: true,
      reason: true,
      flags: true,
      facility: { select: { name: true } },
      credential: {
        select: {
          lease: { select: { unit: { select: { number: true } } } },
          grant: {
            select: {
              tenantId: true,
              tenant: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    occurredAt: row.occurredAt,
    result: row.result,
    reason: row.reason,
    flags: row.flags.filter(isAccessFlag),
    tenantId: row.credential?.grant.tenantId ?? null,
    tenantName: row.credential?.grant.tenant
      ? `${row.credential.grant.tenant.firstName} ${row.credential.grant.tenant.lastName}`
      : null,
    unitNumber: row.credential?.lease?.unit?.number ?? null,
  }))
}

/// AC2: "Tenant detail page shows that tenant's recent access history."
export async function tenantAccessHistory(
  actor: Actor,
  tenantId: string,
  limit = 20,
): Promise<AccessEventRow[]> {
  return accessEventLog(actor, { tenantId, limit })
}

export type FlagSummary = { flag: AccessFlag; count: number }

/// How many of each flag in the window, for the counters above the log.
///
/// Read from the same rows the list reads, so a manager who sees "3 unknown
/// code" and clicks it gets three rows — a separate count query with slightly
/// different bounds is how those two numbers start disagreeing.
export function summariseFlags(rows: readonly AccessEventRow[]): FlagSummary[] {
  const counts = new Map<AccessFlag, number>()
  for (const row of rows) {
    for (const flag of row.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count)
}
