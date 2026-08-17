import { prisma } from '@storage/db'
import {
  arAging,
  daysPastDue,
  economicOccupancy,
  moveCounts,
  normalizeChannel,
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
export async function reportableFacilities(actor: Actor): Promise<{ id: string; name: string }[]> {
  const access = facilityAccess(actor)
  return prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}

/// Facilities this actor may see MONEY for.
///
/// A narrower list than `reportableFacilities`, and the distinction is the
/// catalog's own: `reports:financial` is described as "Revenue, AR, and
/// delinquency aging", while `reports:operational` is "Occupancy, move-ins,
/// and daily activity". A role holding only the operational key — the counter
/// agent — has no business reading the portfolio's receivables.
///
/// Filters rather than throwing, because a regional manager can legitimately
/// hold financial access at one site and operational at another; throwing
/// would deny them the report entirely instead of showing the half they are
/// entitled to.
export async function financialFacilities(actor: Actor): Promise<{ id: string; name: string }[]> {
  const facilities = await reportableFacilities(actor)
  return facilities.filter((facility) => can(actor, 'reports:financial', facility.id))
}

export function assertCanReport(actor: Actor, facilityId: string): void {
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
          select: { id: true, acquisitionSource: true, acquisitionChannel: true },
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
// B-097 filled the gap this comment used to describe. `acquisitionSource`
        // is stamped at move-in from the reservation that produced it, so a
        // phone lead that became a rental reports as `phone` rather than as
        // `web`. A lease from before capture has a null column and reports as
        // `unknown`, which stays visible rather than being folded into `web` —
        // quietly crediting the channel this report exists to evaluate is the
        // failure the whole item was written to prevent.
        //
        // B-082 part 1 added the second axis. `acquisitionSource` says how the
        // deal was taken; `acquisitionChannel` says where the renter came from,
        // and until it existed every marketplace rental reported as `web` —
        // identical to an organic one, in the report an owner uses to decide
        // what to keep paying for. Both splits count the SAME move-ins, so the
        // two totals agree by construction.
        moves: moveCounts(
          moveIns.map((lease) => ({
            source: normalizeSource(lease.acquisitionSource),
            channel: normalizeChannel(lease.acquisitionChannel),
          })),
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

/// US-39.4's aging.
///
/// Live since B-044: `Invoice` rows with real original due dates now exist, so
/// the buckets report rather than collapsing every lease into the first one.
/// The ageing is `daysPastDue` from @storage/core/metrics — the single shared
/// definition (D-25), anchored to the OLDEST unpaid invoice's ORIGINAL due
/// date and never to a retry attempt, which is what keeps a lease that has
/// declined four times (B-046) ageing rather than resetting to current.
///
/// The outstanding figure is still the ledger balance rather than a sum of
/// invoice remainders. They agree once every charge is invoiced, and the
/// ledger is the source of truth for balance by PRD 01 §7.3 — so a lease
/// carrying a pre-billing move-in charge still shows the money it owes.
export async function delinquencyReport(actor: Actor): Promise<DelinquencyReport> {
  // Financial, not operational: AR is money. Before B-055 this used the looser
  // either-or check, which put the portfolio's receivables in front of a role
  // whose only reporting key is `reports:operational`.
  const facilities = await financialFacilities(actor)

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
