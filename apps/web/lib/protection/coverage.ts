import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.3 US-44 (B-163). Occupied units with no cover at all.
//
// US-44's policy is "every move-in either carries a plan or carries evidence
// of the tenant's own cover", and until this nothing counted the leases that
// carry neither. B-155 made the attach RATE reportable — a period metric about
// how move-ins were sold — which is a different question: attach rate says how
// well protection was sold last month, this says which units are uncovered
// right now. A tenant who waived at signing and let the certificate lapse
// never appears in the first number and is exactly who the policy is about.
//
// A worklist rather than a metric, so it is ordered by how long the gap has
// been open: the oldest lapse is the one that has been uncovered longest, and
// on the day a unit floods it is the row somebody will ask about.

export type UncoveredLease = {
  leaseId: string
  unitNumber: string
  tenantId: string
  tenantName: string
  startDate: Date
  /// Why this lease has no cover, which is the difference between a phone call
  /// and a conversation:
  ///   * `never_recorded` — waived at signing and no certificate was ever
  ///     captured, or a manager override with no expiry that has since been
  ///     cleared. Nothing has lapsed; nothing was ever there.
  ///   * `lapsed` — a certificate was recorded and its date has passed.
  reason: 'never_recorded' | 'lapsed'
  /// The expiry that passed, for a `lapsed` row. Null on `never_recorded`.
  proofExpiredOn: Date | null
  /// Days since the certificate expired. Null on `never_recorded`, where there
  /// is no date to count from — the lease start is shown instead.
  daysUncovered: number | null
}

export type CoverageGap = {
  facilityId: string
  facilityName: string
  /// US-44's per-facility policy. A facility where protection is OPTIONAL can
  /// legitimately have uncovered leases, so the list still renders and the
  /// screen says so rather than implying a violation.
  protectionRequired: boolean
  occupiedLeases: number
  rows: UncoveredLease[]
}

/// Occupying leases at one facility carrying neither a protection plan nor an
/// unexpired waiver.
///
/// A waiver with a NULL `expiresAt` counts as cover: that is US-44's manager
/// override — the tenant would not produce a declaration page and somebody
/// senior accepted it with a reason code — and it has no date to lapse. It is
/// a deliberate decision on the record, not an absence.
export async function coverageGaps(
  actor: Actor,
  facilityId: string,
  asOf: Date = new Date(),
): Promise<CoverageGap> {
  requirePermission(actor, 'reports:operational', facilityId)

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { id: true, name: true, protectionRequired: true },
  })

  const leases = await prisma.lease.findMany({
    where: {
      facilityId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
      // A plan we sell is cover. Everything below is about the other path.
      OR: [{ protectionPlanName: null }, { protectionPlanName: '' }],
    },
    select: {
      id: true,
      startDate: true,
      tenantId: true,
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  })

  const occupiedLeases = await prisma.lease.count({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
  })
  if (leases.length === 0) {
    return {
      facilityId: facility.id,
      facilityName: facility.name,
      protectionRequired: facility.protectionRequired,
      occupiedLeases,
      rows: [],
    }
  }

  const waivers = await prisma.protectionWaiver.findMany({
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    select: { leaseId: true, expiresAt: true },
  })
  const waiverByLease = new Map(waivers.map((waiver) => [waiver.leaseId!, waiver]))

  const rows: UncoveredLease[] = []
  for (const lease of leases) {
    const waiver = waiverByLease.get(lease.id)
    const expiresAt = waiver?.expiresAt ?? null
    // The override case: accepted with no expiry, so nothing to lapse.
    if (waiver && expiresAt === null) continue
    if (expiresAt !== null && expiresAt.getTime() > asOf.getTime()) continue

    rows.push({
      leaseId: lease.id,
      unitNumber: lease.unit?.number ?? '—',
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      startDate: lease.startDate,
      reason: waiver ? 'lapsed' : 'never_recorded',
      proofExpiredOn: expiresAt,
      daysUncovered:
        expiresAt === null
          ? null
          : Math.floor((asOf.getTime() - expiresAt.getTime()) / 86_400_000),
    })
  }

  // Longest-uncovered first. A `never_recorded` row has no lapse date, so it
  // sorts by how long the lease has been running — which is the same question
  // asked of the only date it has.
  rows.sort((a, b) => {
    const aFrom = (a.proofExpiredOn ?? a.startDate).getTime()
    const bFrom = (b.proofExpiredOn ?? b.startDate).getTime()
    return aFrom - bFrom
  })

  return {
    facilityId: facility.id,
    facilityName: facility.name,
    protectionRequired: facility.protectionRequired,
    occupiedLeases,
    rows,
  }
}
