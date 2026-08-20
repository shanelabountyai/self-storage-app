import { prisma } from '@storage/db'
import type { PeriodSnapshot } from '@storage/core/accounting'
import type { Actor } from '@/lib/rbac/actor'
import { reportableFacilities } from './reports'

// PRD 00 §6 Phase 3 — the owner KPI dashboard (B-088 part 2).
//
// **Built from the FILED month-end snapshots, not from a recomputation**, and
// that is the whole design rather than an optimisation. D-65 settled that
// point-in-time figures — unit occupancy, square-foot occupancy, AR aging —
// are frozen at close because they cannot be observed again: `Unit.status` had
// no history before B-131 and `delinquencyReport` still takes no date, so
// re-running them for a past month answers a different question under the same
// name. The close already froze the right answer; this reads it.
//
// It is also the only shape that is fast. Recomputing twelve months across a
// portfolio means twelve `occupancyForFacility` calls per facility, each with
// its own `DISTINCT ON` over the status history — over a hundred round trips to
// a remote database for one page. This is one query.

export type KpiPoint = {
  year: number
  month: number
  /// Facility ids that contributed. A month is only comparable to its
  /// neighbour when the same sites filed, which the screen has to be able to
  /// say.
  facilityIds: string[]
  unitOccupancyRatio: number
  squareFootRatio: number
  economicOccupancyRatio: number
  occupiedUnits: number
  rentableUnits: number
  billedCents: number
  collectedCents: number
  arTotalCents: number
  moveIns: number
  moveOuts: number
  netMoves: number
}

export type KpiTrend = {
  points: KpiPoint[]
  /// Months in the requested window that no facility has filed. Reported so the
  /// screen can say "not closed yet" instead of drawing a gap the reader has to
  /// interpret — a missing month rendered as zero reads as a catastrophe.
  missing: { year: number; month: number }[]
  /// Facilities in scope, so a reader can tell a portfolio dip from a site that
  /// simply has not closed its books.
  facilityCount: number
}

/// Every field this dashboard reads, present in `CLOSE_SNAPSHOT_VERSION` 1 and
/// 2 alike — the category split was the only thing v2 added, and no KPI here
/// needs it.
///
/// So this deliberately does NOT refuse by version the way `buildJournal` does.
/// That refusal is right there and wrong here: a journal without the category
/// split cannot be posted at all, whereas occupancy and collected mean exactly
/// the same thing in both versions. Refusing a v1 month would blank a year of
/// history to protect against a field nothing on this page reads.
///
/// What it DOES refuse is a missing number. A snapshot that lacks one of these
/// is skipped rather than read as zero, because a zero here is indistinguishable
/// from a real collapse.
function usable(snapshot: PeriodSnapshot | null): snapshot is PeriodSnapshot {
  if (!snapshot?.pointInTime || !snapshot.periodDerived) return false
  const numbers = [
    snapshot.pointInTime.unitOccupancyRatio,
    snapshot.pointInTime.squareFootRatio,
    snapshot.pointInTime.occupiedUnits,
    snapshot.pointInTime.rentableUnits,
    snapshot.pointInTime.arTotalCents,
    snapshot.periodDerived.billedCents,
    snapshot.periodDerived.collectedCents,
    snapshot.periodDerived.economicOccupancyRatio,
    snapshot.periodDerived.moveIns,
    snapshot.periodDerived.moveOuts,
  ]
  return numbers.every((value) => typeof value === 'number' && Number.isFinite(value))
}

export type FiledPeriod = {
  facilityId: string
  year: number
  month: number
  snapshot: PeriodSnapshot
}

/// Rolls filed periods up into one point per month.
///
/// **Ratios are recomputed from the components, never averaged**, which is the
/// same error `sumOccupancy` documents: a 100%-occupied 4-unit site and a
/// 50%-occupied 400-unit site average to 75% and roll up to 50.5%, and the
/// second is the portfolio. Economic occupancy has no components in the
/// snapshot, so it is weighted by rentable units — stated because a plain mean
/// there would be the same mistake in a place the type system cannot catch.
export function rollUpByMonth(filed: readonly FiledPeriod[]): KpiPoint[] {
  const byMonth = new Map<string, FiledPeriod[]>()
  for (const period of filed) {
    const key = `${period.year}-${String(period.month).padStart(2, '0')}`
    byMonth.set(key, [...(byMonth.get(key) ?? []), period])
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, periods]) => {
      const occupiedUnits = sum(periods, (p) => p.snapshot.pointInTime.occupiedUnits)
      const rentableUnits = sum(periods, (p) => p.snapshot.pointInTime.rentableUnits)
      const weightedEconomic = sum(
        periods,
        (p) => p.snapshot.periodDerived.economicOccupancyRatio * p.snapshot.pointInTime.rentableUnits,
      )

      return {
        year: periods[0].year,
        month: periods[0].month,
        facilityIds: periods.map((p) => p.facilityId),
        occupiedUnits,
        rentableUnits,
        unitOccupancyRatio: rentableUnits === 0 ? 0 : occupiedUnits / rentableUnits,
        // Square-foot occupancy has no square-foot components on the snapshot,
        // only the ratio — so it is weighted by rentable units too. Less exact
        // than recomputing from square feet would be, and named rather than
        // presented as if it were the same thing.
        squareFootRatio: weightedBy(periods, (p) => p.snapshot.pointInTime.squareFootRatio),
        economicOccupancyRatio: rentableUnits === 0 ? 0 : weightedEconomic / rentableUnits,
        billedCents: sum(periods, (p) => p.snapshot.periodDerived.billedCents),
        collectedCents: sum(periods, (p) => p.snapshot.periodDerived.collectedCents),
        arTotalCents: sum(periods, (p) => p.snapshot.pointInTime.arTotalCents),
        moveIns: sum(periods, (p) => p.snapshot.periodDerived.moveIns),
        moveOuts: sum(periods, (p) => p.snapshot.periodDerived.moveOuts),
        netMoves: sum(periods, (p) => p.snapshot.periodDerived.netMoves ?? 0),
      }
    })
}

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0)
}

function weightedBy(rows: readonly FiledPeriod[], pick: (row: FiledPeriod) => number): number {
  const weight = sum(rows, (row) => row.snapshot.pointInTime.rentableUnits)
  if (weight === 0) return 0
  return sum(rows, (row) => pick(row) * row.snapshot.pointInTime.rentableUnits) / weight
}

/// The months in the window, oldest first, as {year, month}.
export function monthsBack(from: Date, count: number): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))
    months.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 })
  }
  return months
}

export const DEFAULT_MONTHS = 12

/// The trend for every facility the actor can report on.
export async function kpiTrend(
  actor: Actor,
  options: { months?: number; now?: Date } = {},
): Promise<KpiTrend> {
  const facilities = await reportableFacilities(actor)
  const facilityIds = facilities.map((facility) => facility.id)
  const window = monthsBack(options.now ?? new Date(), options.months ?? DEFAULT_MONTHS)

  if (facilityIds.length === 0) {
    return { points: [], missing: window, facilityCount: 0 }
  }

  const oldest = window[0]
  const rows = await prisma.accountingPeriod.findMany({
    where: {
      facilityId: { in: facilityIds },
      closedAt: { not: null },
      // Cheap coarse bound; the exact window is applied below, because
      // (year, month) is not orderable as a single column comparison.
      OR: [{ year: { gt: oldest.year } }, { year: oldest.year, month: { gte: oldest.month } }],
    },
    select: { facilityId: true, year: true, month: true, snapshot: true },
  })

  const wanted = new Set(window.map((m) => `${m.year}-${m.month}`))
  const filed: FiledPeriod[] = []
  for (const row of rows) {
    if (!wanted.has(`${row.year}-${row.month}`)) continue
    const snapshot = row.snapshot as PeriodSnapshot | null
    if (!usable(snapshot)) continue
    filed.push({ facilityId: row.facilityId, year: row.year, month: row.month, snapshot })
  }

  const points = rollUpByMonth(filed)
  const present = new Set(points.map((point) => `${point.year}-${point.month}`))

  return {
    points,
    missing: window.filter((month) => !present.has(`${month.year}-${month.month}`)),
    facilityCount: facilityIds.length,
  }
}

/// Month-over-month change, as a signed difference. Null when there is no
/// previous point — an arrow with nothing behind it is worse than no arrow.
export function delta(points: readonly KpiPoint[], pick: (point: KpiPoint) => number): number | null {
  if (points.length < 2) return null
  return pick(points[points.length - 1]) - pick(points[points.length - 2])
}
