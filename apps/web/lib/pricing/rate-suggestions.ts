import { prisma } from '@storage/db'
import { occupancy } from '@storage/core/metrics'
import { businessDateFor } from '@storage/core/jobs'
import { recordAudit } from '@storage/core/audit'
import {
  isSurveyStale,
  projectedMonthlyUpliftCents,
  suggestStreetRate,
  type Suggestion,
} from '@storage/core/pricing'
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
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
  /// B-438. The latest survey line for this size, or null when nobody has
  /// looked. Beside the suggestion, never inside it: D-74's rule does not read it.
  competitor: {
    competitorName: string
    priceCents: number
    observedOn: Date
    stale: boolean
  } | null
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

  const [unitTypes, units, rates, scheduled, facility, surveyed] = await Promise.all([
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
    prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true } }),
    prisma.competitorPrice.findMany({
      where: { facilityId },
      orderBy: [{ observedOn: 'desc' }, { createdAt: 'desc' }],
      distinct: ['unitTypeId'],
    }),
  ])

  const today = businessDateFor(asOf, facility.timezone)
  const latestSurvey = new Map(surveyed.map((row) => [row.unitTypeId, row]))

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
    const survey = latestSurvey.get(unitType.id)
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
      competitor: survey
        ? {
            competitorName: survey.competitorName,
            priceCents: survey.priceCents,
            observedOn: survey.observedOn,
            stale: isSurveyStale(survey.observedOn, today),
          }
        : null,
    }
  })

  return { rows, upliftCents: projectedMonthlyUpliftCents(rows) }
}

/// B-438. One line of the competitor survey. Whoever may see a suggestion may
/// record what the store down the road charges, so this is `propose`, not
/// `change`: it moves no price.
export async function recordCompetitorPrice(
  actor: Actor,
  facilityId: string,
  unitTypeId: string,
  input: { competitorName: string; priceCents: number; observedOn: Date },
  asOf: Date = new Date(),
) {
  requirePermission(actor, 'rates:street:propose', facilityId)
  if (actor.kind !== 'staff') throw new ForbiddenError('Only staff record a competitor price')

  const unitType = await prisma.unitType.findUniqueOrThrow({
    where: { id: unitTypeId },
    select: { facilityId: true, name: true, facility: { select: { timezone: true } } },
  })
  if (unitType.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit type ${unitTypeId} belongs to another facility`)
  }
  // A price nobody has seen yet is a typo, and it would sit at the top of the
  // survey as "latest" until its date arrived.
  if (input.observedOn > businessDateFor(asOf, unitType.facility.timezone)) {
    return { ok: false as const, reason: 'future_date' as const }
  }

  const created = await prisma.competitorPrice.create({
    data: { facilityId, unitTypeId, enteredByStaffId: actor.staffUserId, ...input },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'rate.competitor_price_recorded',
    entityType: 'UnitType',
    entityId: unitTypeId,
    facilityId,
    before: null,
    after: {
      competitorName: created.competitorName,
      priceCents: created.priceCents,
      observedOn: created.observedOn,
    },
    context: { unitTypeName: unitType.name },
  })

  return { ok: true as const, created }
}
