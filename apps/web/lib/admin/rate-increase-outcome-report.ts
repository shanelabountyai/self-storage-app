import { prisma } from '@storage/db'
import { businessDateFor } from '@storage/core/jobs'
import {
  normalizeMoveOutCause,
  rateIncreaseOutcome,
  sumRateIncreaseOutcome,
  type AppliedIncrease,
  type OutcomeWindow,
  type RateIncreaseOutcome,
} from '@storage/core/metrics'
import { financialFacilities } from './reports'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-39 "AC (a rate increase is measured after it lands)" — B-400.
// Fetches and shapes; every figure comes from `rateIncreaseOutcome`.
//
// Money, so `reports:financial` scopes it (`financialFacilities`). An increase
// is in range by its EFFECTIVE date — a calendar day, the date every window is
// counted from — not by `appliedAt`, which is only when the job got to it.

export type OutcomeBatch = {
  /// `null` groups the one-off increases scheduled outside any batch.
  batchId: string | null
  effectiveDate: Date
  outcome: RateIncreaseOutcome
}

export type FacilityOutcome = {
  facilityId: string
  facilityName: string
  batches: OutcomeBatch[]
  outcome: RateIncreaseOutcome
}

export type RateIncreaseOutcomeReport = {
  facilities: FacilityOutcome[]
  total: RateIncreaseOutcome
}

export async function rateIncreaseOutcomeReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
  now: Date = new Date(),
): Promise<RateIncreaseOutcomeReport> {
  const facilities = await financialFacilities(actor)
  const rows = await Promise.all(
    facilities.map((facility) => outcomeForFacility(facility, periodStart, periodEnd, now)),
  )
  const withIncreases = rows.filter((row) => row.outcome.count > 0)
  return { facilities: withIncreases, total: sumRateIncreaseOutcome(withIncreases.map((row) => row.outcome)) }
}

async function outcomeForFacility(
  facility: { id: string; name: string; timezone: string },
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): Promise<FacilityOutcome> {
  const today = businessDateFor(now, facility.timezone)
  const increases = await prisma.tenantRateIncrease.findMany({
    where: {
      facilityId: facility.id,
      status: 'applied',
      effectiveDate: {
        gte: businessDateFor(periodStart, facility.timezone),
        lt: businessDateFor(periodEnd, facility.timezone),
      },
    },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      leaseId: true,
      batchId: true,
      currentRateCents: true,
      newRateCents: true,
      effectiveDate: true,
      lease: { select: { status: true, moveOutDate: true, moveOutCause: true } },
    },
  })
  // A retention save (B-153) is the same row in the other direction; it is
  // an outcome of an increase, never one itself.
  const raised = increases.filter((row) => row.newRateCents > row.currentRateCents)

  const cuts = raised.length
    ? await prisma.tenantRateIncrease.findMany({
        where: { leaseId: { in: raised.map((row) => row.leaseId) }, status: 'applied' },
        select: { leaseId: true, currentRateCents: true, newRateCents: true, effectiveDate: true },
      })
    : []
  const cutsByLease = new Map<string, { effectiveDate: Date; reductionCents: number }[]>()
  for (const cut of cuts) {
    if (cut.newRateCents >= cut.currentRateCents) continue
    const list = cutsByLease.get(cut.leaseId) ?? []
    list.push({ effectiveDate: cut.effectiveDate, reductionCents: cut.currentRateCents - cut.newRateCents })
    cutsByLease.set(cut.leaseId, list)
  }

  const groups = new Map<string, { batchId: string | null; effectiveDate: Date; items: AppliedIncrease[] }>()
  for (const row of raised) {
    const key = row.batchId ?? 'one-off'
    const group = groups.get(key) ?? { batchId: row.batchId, effectiveDate: row.effectiveDate, items: [] }
    group.items.push({
      inPlaceCents: row.currentRateCents,
      newRateCents: row.newRateCents,
      effectiveDate: row.effectiveDate,
      // `ended` only, the same set the move-out report counts (B-399): a
      // scheduled move-out has not happened yet.
      moveOut:
        row.lease.status === 'ended' && row.lease.moveOutDate
          ? { date: row.lease.moveOutDate, cause: normalizeMoveOutCause(row.lease.moveOutCause) }
          : null,
      retentionCuts: cutsByLease.get(row.leaseId) ?? [],
    })
    groups.set(key, group)
  }

  const batches = [...groups.values()].map((group) => ({
    batchId: group.batchId,
    effectiveDate: group.effectiveDate,
    outcome: rateIncreaseOutcome(group.items, today),
  }))
  return {
    facilityId: facility.id,
    facilityName: facility.name,
    batches,
    outcome: sumRateIncreaseOutcome(batches.map((batch) => batch.outcome)),
  }
}

/// What a window cell says, on screen and in the CSV alike: "not yet" until
/// the window has elapsed for at least one increase, never a zero it has not
/// earned. "of N" appears when only part of the group has been measured.
export function windowCell(outcome: RateIncreaseOutcome, days: OutcomeWindow): string {
  const window = outcome.windows[days]
  if (window.measured === 0) return NOT_YET
  const partial = window.measured < outcome.count ? ` of ${window.measured}` : ''
  return `${window.movedOut}${partial} (${window.movedOutForPrice} for price)`
}

export const NOT_YET = 'not yet'

/// The 90-day figures (retention cuts, net change) are measured once day 90
/// has passed for at least one increase in the group.
export function ninetyDayMeasured(outcome: RateIncreaseOutcome): boolean {
  return outcome.windows[90].measured > 0
}

export function batchLabel(batch: OutcomeBatch): string {
  return batch.batchId === null
    ? 'One-off increases'
    : `Batch effective ${batch.effectiveDate.toISOString().slice(0, 10)}`
}
