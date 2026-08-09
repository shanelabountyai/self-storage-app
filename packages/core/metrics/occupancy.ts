import type { EffectiveUnitStatus } from '../inventory/unit-status.ts'

// PRD 02 US-39, §8. The occupancy definitions, written once.
//
// The AC these exist for is blunt about why: "The first time the owner
// dashboard says 91% and the rent roll says 88%, he stops trusting both, and a
// week goes on proving which one was right." So no screen, tile, or export
// computes any of this inline — they all call in here.

/// A unit counts toward the denominator if it could be rented to somebody.
///
/// **Rentable excludes `unrentable` and INCLUDES `maintenance`.** Stated
/// rather than inferred, because it is the one judgement call in the formula:
/// a unit held for cleaning between tenants is temporarily out of service but
/// still part of the portfolio you are measured on, whereas one marked
/// `unrentable` (flood damage, no door) is not sellable inventory at all.
/// Excluding maintenance would flatter every occupancy number by exactly the
/// units the operator is slowest to turn around — the opposite of useful.
export function isRentable(status: EffectiveUnitStatus): boolean {
  return status !== 'unrentable'
}

/// A unit counts toward the numerator if a lease is on it.
///
/// **`overlocked` counts as occupied.** An overlocked unit has a delinquent
/// tenant and their goods still in it — the lease has not ended. Nothing
/// produces `overlocked` — B-058 does, from a fitted `UnitOverlock` — so this
/// is only `occupied`; but the moment B-057 lands, an occupancy figure that
/// forgot this would silently *drop* as tenants went delinquent, which reads
/// as units emptying when in fact nobody moved out.
export function isOccupied(status: EffectiveUnitStatus): boolean {
  return status === 'occupied' || status === 'overlocked'
}

export type UnitForOccupancy = {
  status: EffectiveUnitStatus
  /// width × length, in whole square feet.
  squareFeet: number
}

export type OccupancyResult = {
  occupiedCount: number
  rentableCount: number
  /// occupied ÷ rentable, 0–1. Zero when nothing is rentable — a facility
  /// with no sellable units is 0% occupied, not undefined and not 100%.
  ratio: number
  occupiedSquareFeet: number
  rentableSquareFeet: number
  /// Square-foot occupancy, 0–1. Differs from unit occupancy whenever the
  /// large units and the small ones rent at different rates, which is the
  /// entire reason both are reported.
  squareFootRatio: number
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/// US-39.1: unit occupancy and square-foot occupancy, from one pass.
///
/// Formula:
///   unit occupancy  = count(occupied) / count(rentable)
///   sq-ft occupancy = sum(sqft of occupied) / sum(sqft of rentable)
///
/// Returned together rather than as two functions because they must always be
/// computed over the same unit set — reporting a unit occupancy from one
/// filter and a square-foot occupancy from another is exactly the kind of
/// quiet disagreement this module exists to prevent.
export function occupancy(units: readonly UnitForOccupancy[]): OccupancyResult {
  let occupiedCount = 0
  let rentableCount = 0
  let occupiedSquareFeet = 0
  let rentableSquareFeet = 0

  for (const unit of units) {
    if (!isRentable(unit.status)) continue
    rentableCount += 1
    rentableSquareFeet += unit.squareFeet
    if (isOccupied(unit.status)) {
      occupiedCount += 1
      occupiedSquareFeet += unit.squareFeet
    }
  }

  return {
    occupiedCount,
    rentableCount,
    ratio: ratio(occupiedCount, rentableCount),
    occupiedSquareFeet,
    rentableSquareFeet,
    squareFootRatio: ratio(occupiedSquareFeet, rentableSquareFeet),
  }
}

/// Adds occupancy results together — the roll-up.
///
/// Sums the components and recomputes the ratios rather than averaging the
/// ratios, which is the classic error: a 100%-occupied 4-unit site and a
/// 50%-occupied 400-unit site average to 75% and roll up to 50.5%. The second
/// is the true portfolio figure. US-39's own AC ("roll-up equals the sum of
/// the facility reports with no double counting") is asserted against this in
/// tests/metrics.test.ts.
export function sumOccupancy(results: readonly OccupancyResult[]): OccupancyResult {
  const totals = results.reduce(
    (acc, result) => ({
      occupiedCount: acc.occupiedCount + result.occupiedCount,
      rentableCount: acc.rentableCount + result.rentableCount,
      occupiedSquareFeet: acc.occupiedSquareFeet + result.occupiedSquareFeet,
      rentableSquareFeet: acc.rentableSquareFeet + result.rentableSquareFeet,
    }),
    { occupiedCount: 0, rentableCount: 0, occupiedSquareFeet: 0, rentableSquareFeet: 0 },
  )

  return {
    ...totals,
    ratio: ratio(totals.occupiedCount, totals.rentableCount),
    squareFootRatio: ratio(totals.occupiedSquareFeet, totals.rentableSquareFeet),
  }
}
