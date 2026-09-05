import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { presetFor, SHARED_ACCESS_PRESETS } from '@storage/core/access'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { businessDateFor } from '@storage/core/jobs'
import { accessCodeEncryptionKey, decryptCode } from '@/lib/access/secret'
import type { MessageKey } from '@/lib/i18n'

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
  /// US-8 AC1's scope, rendered back. A control whose value never appears on
  /// the screen again is one a tenant cannot check, correct, or trust.
  /// B-260: a message key, rendered by the page in the reader's language.
  hoursLabel: MessageKey
  /// The last day they can get in, as a facility-local `YYYY-MM-DD`, or null
  /// for no limit.
  ///
  /// An absolute date, never a countdown — PRD 01 §6.8.1's standing rule, and
  /// the one B-142 applied to the transfer hold: "3 days left" is a value a
  /// screen-reader user has to re-poll to read, and it is wrong the moment the
  /// page has been open for a day.
  expiresOn: string | null
}

export type LeaseAccessView = {
  leaseId: string
  unitNumber: string
  facilityName: string
  cap: number
  /// Facility-local today, as `YYYY-MM-DD`. The date field's `min`: a browser
  /// would otherwise offer yesterday at a site five hours behind the server.
  today: string
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
      facility: { select: { name: true, authorizedAccessCap: true, timezone: true } },
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
            accessHours: true,
            expiresAt: true,
            grant: {
              select: {
                state: true,
                credentials: {
                  // B-086 part 2. An authorized person cannot enrol phone
                  // unlock today, so this filter changes nothing yet — it is
                  // here because the query means "the code they key in", and
                  // the day that changes this line should not be the bug.
                  where: { state: 'active', type: 'pin' },
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
        today: localDate(new Date(), lease.facility.timezone),
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
          hoursLabel: hoursLabel(person.accessHours),
          // Stored as the local midnight that ENDS the last day, so the day a
          // person reads back is the day before the stored instant.
          expiresOn: person.expiresAt
            ? localDate(
                new Date(person.expiresAt.getTime() - 1),
                lease.facility.timezone,
              )
            : null,
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

function localDate(instant: Date, timezone: string): string {
  return businessDateFor(instant, timezone).toISOString().slice(0, 10)
}

/// A preset's own words where the schedule is one of them, and a deliberately
/// vague "limited hours" where it is not — a manager's custom window has no
/// short honest name, and inventing one that is subtly wrong about when
/// somebody can reach their own belongings is worse than saying to ring.
function hoursLabel(accessHours: unknown): MessageKey {
  const preset = presetFor(parseWeeklySchedule(accessHours ?? null))
  return preset === 'custom' ? 'acc.hours.custom' : SHARED_ACCESS_PRESETS[preset].labelKey
}
