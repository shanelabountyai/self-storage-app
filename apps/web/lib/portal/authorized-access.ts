import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { accessCodeEncryptionKey, decryptCode } from '@/lib/access/secret'

// PRD 03 US-9 AC4 (B-105). What the tenant sees on their own authorized-access
// list.
//
// Reads only. Every write goes through `lib/access/authorized-persons.ts`, the
// same functions the counter uses — a second path to a working gate code is a
// second place for the cap, the audit entry and the suspension state to be
// wrong.

export type AuthorizedPersonView = {
  id: string
  name: string
  phone: string
  relationship: string
  addedByTenant: boolean
  addedAt: Date
  /// Their own code, so the tenant can pass it on again. Null when no
  /// encryption key is configured, or the credential predates one.
  code: string | null
  /// True when this person's access is off because the TENANT'S is — the
  /// delinquency cascade (AC2), not something they did.
  suspended: boolean
}

export type LeaseAccessView = {
  leaseId: string
  unitNumber: string
  facilityName: string
  cap: number
  people: AuthorizedPersonView[]
  /// True when the tenant's own access is suspended. Anyone added now starts
  /// suspended too, and saying so up front is better than letting somebody hand
  /// out a code that does not work.
  tenantSuspended: boolean
}

export async function authorizedAccessForTenant(tenantId: string): Promise<LeaseAccessView[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    orderBy: { startDate: 'asc' },
    select: {
      id: true,
      facilityId: true,
      unit: { select: { number: true } },
      facility: { select: { name: true, authorizedAccessCap: true } },
    },
  })

  const key = accessCodeEncryptionKey()

  return Promise.all(
    leases.map(async (lease) => {
      const [people, tenantGrant] = await Promise.all([
        prisma.authorizedAccessPerson.findMany({
          where: { leaseId: lease.id, active: true },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            phone: true,
            relationship: true,
            createdAt: true,
            createdByTenantId: true,
            grant: {
              select: {
                state: true,
                credentials: {
                  where: { state: 'active' },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { valueRef: true },
                },
              },
            },
          },
        }),
        prisma.accessGrant.findUnique({
          where: { facilityId_tenantId: { facilityId: lease.facilityId, tenantId } },
          select: { state: true },
        }),
      ])

      return {
        leaseId: lease.id,
        unitNumber: lease.unit.number,
        facilityName: lease.facility.name,
        cap: lease.facility.authorizedAccessCap,
        tenantSuspended: tenantGrant?.state === 'suspended',
        people: people.map((person) => ({
          id: person.id,
          name: person.name,
          phone: person.phone,
          relationship: person.relationship,
          addedByTenant: person.createdByTenantId !== null,
          addedAt: person.createdAt,
          // Shown to the tenant, who is the person expected to pass it on — the
          // same posture the portal already takes with the tenant's own code.
          // An unreadable code degrades to null rather than throwing: a list
          // that 500s because one old credential predates the encryption key is
          // worse than one that says "call us" for that row.
          code: readCode(person.grant?.credentials[0]?.valueRef ?? null, key),
          suspended: person.grant?.state === 'suspended',
        })),
      }
    }),
  )
}

function readCode(valueRef: string | null, key: Buffer | null): string | null {
  if (!valueRef || !key) return null
  try {
    return decryptCode(valueRef, key)
  } catch {
    return null
  }
}
