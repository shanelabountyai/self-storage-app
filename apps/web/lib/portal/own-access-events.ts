import { prisma } from '@storage/db'

// PRD 03 US-5 "AC (the tenant sees their own entries)" (B-431). Gate events on
// the tenant's own grant and on their authorized persons' grants, last 30 days.
//
// Deliberately NOT `accessEventLog`: that one is scoped by an actor's
// `access:events` permission and shows tenant names. A tenant has no such key,
// and the only safe filter here is ownership — the tenant's grant, or a grant
// whose authorized person belongs to one of the tenant's leases. A person the
// tenant has since withdrawn still counts: their past entries are the
// tenant's history, and `active` is not filtered for that reason.

export const OWN_ACCESS_DAYS = 30

export type OwnAccessEvent = {
  id: string
  occurredAt: Date
  timezone: string
  facilityName: string
  result: 'granted' | 'denied'
  entryMethod: 'pin' | 'mobile_key' | null
  /// Null means the tenant themselves.
  personName: string | null
}

export async function ownAccessEvents(tenantId: string, now = new Date()): Promise<OwnAccessEvent[]> {
  const since = new Date(now.getTime() - OWN_ACCESS_DAYS * 24 * 60 * 60 * 1000)
  const rows = await prisma.accessEvent.findMany({
    where: {
      occurredAt: { gte: since, lte: now },
      credential: {
        grant: { OR: [{ tenantId }, { authorizedPerson: { lease: { tenantId } } }] },
      },
    },
    orderBy: { occurredAt: 'desc' },
    take: 500,
    select: {
      id: true,
      occurredAt: true,
      result: true,
      facility: { select: { name: true, timezone: true } },
      credential: {
        select: { type: true, grant: { select: { authorizedPerson: { select: { name: true } } } } },
      },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt,
    timezone: row.facility.timezone,
    facilityName: row.facility.name,
    result: row.result,
    entryMethod: row.credential?.type ?? null,
    personName: row.credential?.grant.authorizedPerson?.name ?? null,
  }))
}
