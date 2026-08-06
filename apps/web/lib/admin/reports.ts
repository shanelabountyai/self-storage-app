import { prisma } from '@storage/db'
import {
  arAging,
  daysPastDue,
  economicOccupancy,
  moveCounts,
  normalizeSource,
  occupancy,
  rateVariance,
  reservationConversion,
  sumArAging,
  sumEconomicOccupancy,
  sumMoveCounts,
  sumOccupancy,
  wholeMonthsBetween,
  type ArAging,
  type ConversionResult,
  type EconomicOccupancyResult,
  type MoveCounts,
  type OccupancyResult,
  type RateVarianceRow,
} from '@storage/core/metrics'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { facilityAccess, ForbiddenError, can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-39 / US-2. The adapter between real rows and @storage/core/metrics.
//
// This file fetches and shapes; it never computes a metric. Every ratio,
// bucket and count comes back from the core module, which is what makes
// §4.11's "one metrics definition layer" true rather than aspirational.

/// Facilities this actor may report on. Everything below scopes through here,
/// so a roll-up can never include a facility the viewer cannot open.
async function reportableFacilities(actor: Actor): Promise<{ id: string; name: string }[]> {
  const access = facilityAccess(actor)
  return prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}

function assertCanReport(actor: Actor, facilityId: string): void {
  if (!can(actor, 'reports:operational', facilityId) && !can(actor, 'reports:financial', facilityId)) {
    throw new ForbiddenError('Missing permission to run reports', 'reports:operational', facilityId)
  }
}

export type FacilityOccupancy = {
  facilityId: string
  facilityName: string
  occupancy: OccupancyResult
  economic: EconomicOccupancyResult
}

/// US-39.1 + US-39.2 for one facility.
///
/// `collectedCents` is rent actually collected in the window — read from the
/// ledger, which is the tenant-facing source of truth (§7.3) and the only
/// place payments exist until invoicing lands (B-044).
async function occupancyForFacility(
  facilityId: string,
  facilityName: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<FacilityOccupancy> {
  const [units, rates, collected] = await Promise.all([
    prisma.unit.findMany({
      where: { facilityId },
      select: {
        status: true,
        unitTypeId: true,
        unitType: { select: { widthFt: true, lengthFt: true } },
      },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId, effectiveFrom: { lte: periodEnd } },
      orderBy: { effectiveFrom: 'desc' },
      select: { unitTypeId: true, streetRateCents: true, effectiveFrom: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { facilityId, type: 'payment', occurredAt: { gte: periodStart, lt: periodEnd } },
      _sum: { amountCents: true },
    }),
  ])

  // The rate in force at period end, per unit type — first row wins because
  // the query is already ordered newest-effective-first.
  const streetRateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!streetRateByType.has(rate.unitTypeId)) streetRateByType.set(rate.unitTypeId, rate.streetRateCents)
  }

  const forOccupancy = units.map((unit) => ({
    status: unit.status,
    squareFeet: unit.unitType.widthFt * unit.unitType.lengthFt,
  }))

  // Payments are stored negative on the ledger (they reduce what is owed);
  // collected revenue is the positive magnitude of that.
  const collectedCents = Math.abs(collected._sum.amountCents ?? 0)

  return {
    facilityId,
    facilityName,
    occupancy: occupancy(forOccupancy),
    economic: economicOccupancy(
      collectedCents,
      units.map((unit) => ({
        rentable: unit.status !== 'unrentable',
        streetRateCents: streetRateByType.get(unit.unitTypeId) ?? 0,
      })),
    ),
  }
}

export type OccupancyReport = {
  rows: FacilityOccupancy[]
  total: { occupancy: OccupancyResult; economic: EconomicOccupancyResult }
}

export async function occupancyReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
): Promise<OccupancyReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map((facility) =>
      occupancyForFacility(facility.id, facility.name, periodStart, periodEnd),
    ),
  )

  return {
    rows,
    total: {
      occupancy: sumOccupancy(rows.map((row) => row.occupancy)),
      economic: sumEconomicOccupancy(rows.map((row) => row.economic)),
    },
  }
}

export type RentRollRow = {
  facilityName: string
  unitNumber: string
  unitTypeName: string
  tenantName: string
  inPlaceRateCents: number
  streetRateCents: number
  gapCents: number
  monthsSinceLastChange: number | null
  balanceCents: number
  startDate: Date
}

/// US-39.1's rent roll, which doubles as US-39.2's rate-variance worklist —
/// the same rows, sorted by the gap. Occupied units only: a rent roll is what
/// is being paid, so an empty unit has no line.
export async function rentRoll(actor: Actor, facilityId: string): Promise<RentRollRow[]> {
  const access = facilityAccess(actor)
  if (!access.all && !access.facilityIds.includes(facilityId)) {
    throw new ForbiddenError(`No access to facility ${facilityId}`, undefined, facilityId)
  }
  assertCanReport(actor, facilityId)

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      monthlyRateCents: true,
      startDate: true,
      facility: { select: { name: true } },
      tenant: { select: { firstName: true, lastName: true } },
      unit: {
        select: { number: true, unitTypeId: true, unitType: { select: { name: true } } },
      },
      rateChanges: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { effectiveFrom: true } },
    },
  })
  if (leases.length === 0) return []

  const [rates, balances] = await Promise.all([
    prisma.unitTypeRate.findMany({
      where: { facilityId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { unitTypeId: true, streetRateCents: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: leases.map((lease) => lease.id) } },
      _sum: { amountCents: true },
    }),
  ])

  const streetRateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!streetRateByType.has(rate.unitTypeId)) streetRateByType.set(rate.unitTypeId, rate.streetRateCents)
  }
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const now = new Date()
  const rows: (RentRollRow & RateVarianceRow)[] = leases.map((lease) => {
    const streetRateCents = streetRateByType.get(lease.unit.unitTypeId) ?? 0
    const lastChange = lease.rateChanges[0]?.effectiveFrom ?? lease.startDate
    return {
      facilityName: lease.facility.name,
      unitNumber: lease.unit.number,
      unitTypeName: lease.unit.unitType.name,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      inPlaceRateCents: lease.monthlyRateCents,
      streetRateCents,
      gapCents: streetRateCents - lease.monthlyRateCents,
      monthsSinceLastChange: wholeMonthsBetween(lastChange, now),
      balanceCents: balanceByLease.get(lease.id) ?? 0,
      startDate: lease.startDate,
    }
  })

  // Sorted by the core module, not here — the ordering IS part of the rate
  // variance definition (§4.11: "sorted by gap").
  return rateVariance(rows) as (RentRollRow & RateVarianceRow)[]
}

export type FacilityMoves = {
  facilityId: string
  facilityName: string
  moves: MoveCounts
  conversion: ConversionResult
}

export type MovesReport = {
  rows: FacilityMoves[]
  total: { moves: MoveCounts; conversion: ConversionResult }
}

/// US-39.3, the report §4.11 calls out as having been orphaned: counts and
/// net by facility and date range, by source, with reservation conversion and
/// average days to move-in.
export async function movesReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
): Promise<MovesReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map(async (facility) => {
      const [moveIns, moveOutCount, reservations] = await Promise.all([
        prisma.lease.findMany({
          where: { facilityId: facility.id, startDate: { gte: periodStart, lt: periodEnd } },
          select: { id: true },
        }),
        prisma.lease.count({
          where: { facilityId: facility.id, moveOutDate: { gte: periodStart, lt: periodEnd }, status: 'ended' },
        }),
        prisma.reservation.findMany({
          where: { facilityId: facility.id, createdAt: { gte: periodStart, lt: periodEnd } },
          select: { createdAt: true, status: true, updatedAt: true },
        }),
      ])

      return {
        facilityId: facility.id,
        facilityName: facility.name,
        // Every move-in reports `unknown` today, and that is the honest
        // answer rather than a bug: nothing on `Lease` records an acquisition
        // channel. Both the public checkout and B-039's counter walk-in go
        // through the same `startCheckout`, so they are indistinguishable
        // after the fact — there is no derivation to write, only a column
        // nobody has added. **B-097 is the item that captures source**
        // (`phone`/`walk_in`/`referral`/`drive_by` on a `Lead`) and is where
        // carrying it through reservation → move-in belongs. Attributing
        // everything to `web` in the meantime would quietly credit the
        // channel this report exists to evaluate.
        moves: moveCounts(
          moveIns.map(() => ({ source: normalizeSource(null) })),
          moveOutCount,
        ),
        conversion: reservationConversion(
          reservations.map((reservation) => ({
            createdAt: reservation.createdAt,
            // `updatedAt` is when the status last moved; for a converted
            // reservation that is the conversion itself. Approximate, and
            // noted as such — a dedicated `convertedAt` column belongs with
            // whichever item next touches the reservation lifecycle.
            convertedAt: reservation.status === 'converted' ? reservation.updatedAt : null,
          })),
        ),
      }
    }),
  )

  return {
    rows,
    total: {
      moves: sumMoveCounts(rows.map((row) => row.moves)),
      conversion: reservationConversion(
        rows.flatMap((row) =>
          Array.from({ length: row.conversion.reservations }, (_, index) => ({
            createdAt: new Date(0),
            convertedAt: index < row.conversion.converted ? new Date(0) : null,
          })),
        ),
      ),
    },
  }
}

export type DelinquencyReport = {
  rows: { facilityId: string; facilityName: string; aging: ArAging }[]
  total: ArAging
}

/// US-39.4's aging, to the extent the data allows.
///
/// **`daysPastDue` needs invoices and nothing creates them yet (B-044.)** The
/// definition itself is built and tested (@storage/core/metrics), because it
/// is the shared one every later consumer must use — but with no `Invoice`
/// rows, every lease reports 0 days past due and lands in the first bucket.
/// The total is real (it is the ledger balance); the *aging* is not yet, and
/// this is documented rather than faked with a ledger-entry age that would
/// look plausible and mean something different.
export async function delinquencyReport(actor: Actor): Promise<DelinquencyReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map(async (facility) => {
      const leases = await prisma.lease.findMany({
        where: { facilityId: facility.id },
        select: {
          id: true,
          invoices: { select: { dueDate: true, totalCents: true, amountPaidCents: true } },
        },
      })
      if (leases.length === 0) {
        return { facilityId: facility.id, facilityName: facility.name, aging: arAging([]) }
      }

      const balances = await prisma.ledgerEntry.groupBy({
        by: ['leaseId'],
        where: { leaseId: { in: leases.map((lease) => lease.id) } },
        _sum: { amountCents: true },
      })
      const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

      const now = new Date()
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        aging: arAging(
          leases.map((lease) => ({
            daysPastDue: daysPastDue(lease.invoices, now),
            outstandingCents: balanceByLease.get(lease.id) ?? 0,
          })),
        ),
      }
    }),
  )

  return { rows, total: sumArAging(rows.map((row) => row.aging)) }
}
