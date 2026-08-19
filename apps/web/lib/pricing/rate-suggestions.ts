import { prisma } from '@storage/db'
import { occupancy } from '@storage/core/metrics'
import {
  projectedMonthlyUpliftCents,
  suggestStreetRate,
  type Suggestion,
} from '@storage/core/pricing'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { currentRatesForFacility } from './unit-type-rates'

// PRD 02 US-12 (B-088 part 1). Assembling what the rule needs, and nothing
// more: every definition it reasons about comes from somewhere that already
// owns it — occupancy from the metrics module (D-25's "no screen computes any
// of these inline"), the current rate from the effective-dated history, and the
// decision itself from packages/core/pricing.

export type RateSuggestionRow = {
  unitTypeId: string
  unitTypeName: string
  occupiedCount: number
  rentableCount: number
  occupancyRatio: number
  streetRateCents: number
  webRateCents: number
  rateEffectiveFrom: Date | null
  daysSinceRateChange: number | null
  suggestion: Suggestion
}

export type RateSuggestionReport = {
  rows: RateSuggestionRow[]
  /// What applying every `raise` row would add per month at today's occupancy.
  /// See `projectedMonthlyUpliftCents` for why this counts occupied units only.
  upliftCents: number
}

const DAY_MS = 86_400_000

/// Every unit type at a facility, with its occupancy, its current price and
/// what the rule makes of the two.
///
/// Gated on `rates:street:propose` rather than `rates:street:change`: a manager
/// holds propose and not change, and being able to SEE that a type is tight is
/// what makes the propose-then-approve split meaningful. Applying is a separate
/// permission and is enforced by `publishUnitTypeRate`, not here.
export async function rateSuggestionsForFacility(
  actor: Actor,
  facilityId: string,
  asOf: Date = new Date(),
): Promise<RateSuggestionReport> {
  requirePermission(actor, 'rates:street:propose', facilityId)

  const [unitTypes, units, rates, scheduled] = await Promise.all([
    prisma.unitType.findMany({
      where: { facilityId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.unit.findMany({
      where: { facilityId },
      select: {
        status: true,
        unitTypeId: true,
        unitType: { select: { widthFt: true, lengthFt: true } },
      },
    }),
    currentRatesForFacility(facilityId, asOf),
    // Rate rows queued for the future. One query for the facility rather than
    // one per type — the set is small and this is a screen, not a job.
    prisma.unitTypeRate.findMany({
      where: { facilityId, effectiveFrom: { gt: asOf } },
      select: { unitTypeId: true },
    }),
  ])

  const scheduledTypes = new Set(scheduled.map((row) => row.unitTypeId))

  const unitsByType = new Map<string, { status: (typeof units)[number]['status']; squareFeet: number }[]>()
  for (const unit of units) {
    const list = unitsByType.get(unit.unitTypeId) ?? []
    list.push({
      status: unit.status,
      squareFeet: unit.unitType.widthFt * unit.unitType.lengthFt,
    })
    unitsByType.set(unit.unitTypeId, list)
  }

  const rows = unitTypes.map((unitType): RateSuggestionRow => {
    // The metrics module's own function, over this type's units. Calling it
    // per group rather than reimplementing "occupied ÷ rentable" is the whole
    // reason that module exists: a rate screen disagreeing with the occupancy
    // report about the same unit type is exactly the failure D-25 names.
    const result = occupancy(unitsByType.get(unitType.id) ?? [])
    const rate = rates.get(unitType.id)
    const rateEffectiveFrom = rate?.effectiveFrom ?? null
    const daysSinceRateChange = rateEffectiveFrom
      ? Math.floor((asOf.getTime() - rateEffectiveFrom.getTime()) / DAY_MS)
      : null

    return {
      unitTypeId: unitType.id,
      unitTypeName: unitType.name,
      occupiedCount: result.occupiedCount,
      rentableCount: result.rentableCount,
      occupancyRatio: result.ratio,
      streetRateCents: rate?.streetRateCents ?? 0,
      webRateCents: rate?.webRateCents ?? 0,
      rateEffectiveFrom,
      daysSinceRateChange,
      suggestion: suggestStreetRate({
        unitTypeId: unitType.id,
        occupiedCount: result.occupiedCount,
        rentableCount: result.rentableCount,
        occupancyRatio: result.ratio,
        streetRateCents: rate?.streetRateCents ?? 0,
        webRateCents: rate?.webRateCents ?? 0,
        daysSinceRateChange,
        hasScheduledChange: scheduledTypes.has(unitType.id),
      }),
    }
  })

  return { rows, upliftCents: projectedMonthlyUpliftCents(rows) }
}
